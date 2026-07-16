/**
 * Nostr Wallet Connect (NIP-47) client: parse the connection URI, talk to the
 * wallet's relay over WebSocket, and execute `pay_invoice` requests.
 */
import { type NostrEvent, nip04Decrypt, nip04Encrypt, signEvent } from "./nostr";

export interface NwcConnection {
  walletPubkey: string;
  relayUrl: string;
  secret: string;
}

const URI_PREFIX = "nostr+walletconnect://";
const HEX64_RE = /^[0-9a-f]{64}$/i;

/** Parse `nostr+walletconnect://<pubkey>?relay=...&secret=...`. Throws on bad input. */
export function parseNwcUri(uri: string): NwcConnection {
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith(URI_PREFIX)) {
    throw new Error("NWC URIは nostr+walletconnect:// で始まる必要があります");
  }
  const rest = trimmed.slice(URI_PREFIX.length);
  const qIndex = rest.indexOf("?");
  const walletPubkey = (qIndex === -1 ? rest : rest.slice(0, qIndex)).toLowerCase();
  if (!HEX64_RE.test(walletPubkey)) {
    throw new Error("NWC URIのウォレット公開鍵が不正です");
  }
  const params = new URLSearchParams(qIndex === -1 ? "" : rest.slice(qIndex + 1));
  const relayUrl = params.get("relay") ?? "";
  if (!/^wss?:\/\//i.test(relayUrl)) {
    throw new Error("NWC URIに relay パラメータがありません");
  }
  const secret = (params.get("secret") ?? "").toLowerCase();
  if (!HEX64_RE.test(secret)) {
    throw new Error("NWC URIに secret パラメータがありません");
  }
  return { walletPubkey, relayUrl, secret };
}

/** The subset of WebSocket the client needs — injectable for tests. */
export interface WsLike {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export type WsFactory = (url: string) => WsLike;

const WS_OPEN = 1;
const REQUEST_KIND = 23194;
const RESPONSE_KIND = 23195;

interface NwcErrorShape {
  code?: string;
  message?: string;
}

export class NwcClient {
  private ws: WsLike | null = null;
  private subs = new Map<string, (event: NostrEvent) => void>();
  private oks = new Map<string, (ok: boolean, message: string) => void>();
  private nextSubId = 1;

  constructor(
    readonly conn: NwcConnection,
    private wsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike,
  ) {}

  connect(timeoutMs = 10_000): Promise<void> {
    if (this.ws && this.ws.readyState === WS_OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let ws: WsLike;
      try {
        ws = this.wsFactory(this.conn.relayUrl);
      } catch {
        reject(new Error("リレーに接続できません"));
        return;
      }
      this.ws = ws;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error("リレー接続タイムアウト"));
      }, timeoutMs);
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("リレーに接続できません"));
      };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
      };
      ws.onmessage = (e) => this.dispatch(String(e.data));
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.subs.clear();
    this.oks.clear();
  }

  private dispatch(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    if (msg[0] === "EVENT" && typeof msg[1] === "string") {
      this.subs.get(msg[1])?.(msg[2] as NostrEvent);
    } else if (msg[0] === "OK" && typeof msg[1] === "string") {
      this.oks.get(msg[1])?.(Boolean(msg[2]), String(msg[3] ?? ""));
    }
  }

  private send(message: unknown): void {
    this.ws?.send(JSON.stringify(message));
  }

  /** Pay a BOLT11 invoice via NIP-47 `pay_invoice`. Resolves with the preimage. */
  async payInvoice(invoice: string, timeoutMs = 30_000): Promise<string> {
    await this.connect();
    const { walletPubkey, secret } = this.conn;
    const content = await nip04Encrypt(
      secret,
      walletPubkey,
      JSON.stringify({ method: "pay_invoice", params: { invoice } }),
    );
    const event = signEvent({ kind: REQUEST_KIND, tags: [["p", walletPubkey]], content }, secret);
    const subId = `pay-${this.nextSubId++}`;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.subs.delete(subId);
        this.oks.delete(event.id);
        this.send(["CLOSE", subId]);
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error("タイムアウト: ウォレットから応答がありません"))),
        timeoutMs,
      );

      this.subs.set(subId, (response) => {
        void (async () => {
          try {
            const plain = await nip04Decrypt(secret, walletPubkey, response.content);
            const body = JSON.parse(plain) as {
              error?: NwcErrorShape | null;
              result?: { preimage?: string } | null;
            };
            if (body.error) {
              const reason = body.error.message || body.error.code || "不明なエラー";
              finish(() => reject(new Error(`支払い失敗: ${reason}`)));
            } else {
              finish(() => resolve(body.result?.preimage ?? ""));
            }
          } catch {
            finish(() => reject(new Error("支払い失敗: ウォレット応答を解読できません")));
          }
        })();
      });
      this.oks.set(event.id, (ok, message) => {
        if (!ok) finish(() => reject(new Error(`支払い拒否: ${message || "リレーに拒否されました"}`)));
      });

      this.send([
        "REQ",
        subId,
        { kinds: [RESPONSE_KIND], authors: [walletPubkey], "#e": [event.id], limit: 1 },
      ]);
      this.send(["EVENT", event]);
    });
  }
}
