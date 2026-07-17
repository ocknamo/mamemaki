/**
 * Nostr Wallet Connect (NIP-47) client: parse the connection URI, talk to the
 * wallet's relay over WebSocket, and execute `pay_invoice` requests.
 *
 * Trust model: the relay is NOT trusted. Subscription filters are requests,
 * not guarantees, so every event a subscription receives is validated
 * (pubkey, kind, `e` tag, recomputed id + schnorr signature) before use, and
 * anything that fails validation is ignored — never a reason to abort a
 * pending payment.
 */
import {
  type NostrEvent,
  nip04Decrypt,
  nip04Encrypt,
  signEvent,
  verifyEvent,
} from "./nostr";

export interface NwcConnection {
  walletPubkey: string;
  relayUrl: string;
  secret: string;
}

/** The wallet's NIP-47 info (kind:13194) capabilities. */
export interface NwcInfo {
  methods: string[];
  /** Encryption schemes from the `encryption` tag; null when the tag is absent (NIP-04 implied). */
  encryptions: string[] | null;
}

/**
 * The payment's outcome is unknown — it may have settled (e.g. the wallet's
 * response timed out or was malformed). Callers must surface this distinctly
 * from failure: retrying an unconfirmed payment risks paying twice.
 */
export class UnconfirmedPaymentError extends Error {}

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
const INFO_KIND = 13194;
const REQUEST_KIND = 23194;
const RESPONSE_KIND = 23195;

interface NwcErrorShape {
  code?: string;
  message?: string;
}

export class NwcClient {
  private ws: WsLike | null = null;
  private pendingConnect: Promise<void> | null = null;
  private subs = new Map<string, (event: NostrEvent) => void>();
  private eoses = new Map<string, () => void>();
  private oks = new Map<string, (ok: boolean, message: string) => void>();
  private nextSubId = 1;

  constructor(
    readonly conn: NwcConnection,
    private wsFactory: WsFactory = (url) => new WebSocket(url) as unknown as WsLike,
  ) {}

  connect(timeoutMs = 10_000): Promise<void> {
    if (this.ws && this.ws.readyState === WS_OPEN) return Promise.resolve();
    // A connect is already in flight — share it instead of leaking sockets.
    if (this.pendingConnect) return this.pendingConnect;
    const attempt = new Promise<void>((resolve, reject) => {
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
    this.pendingConnect = attempt.finally(() => {
      if (this.pendingConnect === attempt) this.pendingConnect = null;
    });
    return this.pendingConnect;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.subs.clear();
    this.eoses.clear();
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
    } else if (msg[0] === "EOSE" && typeof msg[1] === "string") {
      this.eoses.get(msg[1])?.();
    } else if (msg[0] === "OK" && typeof msg[1] === "string") {
      this.oks.get(msg[1])?.(Boolean(msg[2]), String(msg[3] ?? ""));
    }
  }

  private send(message: unknown): void {
    this.ws?.send(JSON.stringify(message));
  }

  /** True when the event really is a `kind` event from our wallet (id + sig verified). */
  private isFromWallet(event: NostrEvent | undefined, kind: number): event is NostrEvent {
    return (
      !!event &&
      event.kind === kind &&
      event.pubkey === this.conn.walletPubkey &&
      verifyEvent(event)
    );
  }

  /**
   * Fetch the wallet's NIP-47 info event (kind:13194) so a "connected" state
   * actually proves the pubkey publishes on this relay and what it supports.
   */
  async getInfo(timeoutMs = 10_000): Promise<NwcInfo> {
    await this.connect();
    const subId = `info-${this.nextSubId++}`;
    return new Promise<NwcInfo>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.subs.delete(subId);
        this.eoses.delete(subId);
        this.send(["CLOSE", subId]);
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error("タイムアウト: ウォレット情報を取得できません"))),
        timeoutMs,
      );
      this.subs.set(subId, (event) => {
        if (!this.isFromWallet(event, INFO_KIND)) return;
        const encTag = event.tags.find((t) => t[0] === "encryption")?.[1];
        finish(() =>
          resolve({
            methods: event.content.trim().split(/\s+/).filter(Boolean),
            encryptions: encTag ? encTag.trim().split(/\s+/).filter(Boolean) : null,
          }),
        );
      });
      this.eoses.set(subId, () =>
        finish(() =>
          reject(
            new Error(
              "ウォレット情報(kind:13194)が見つかりません。公開鍵とリレーを確認してください",
            ),
          ),
        ),
      );
      this.send([
        "REQ",
        subId,
        { kinds: [INFO_KIND], authors: [this.conn.walletPubkey], limit: 1 },
      ]);
    });
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
        () =>
          finish(() =>
            reject(
              new UnconfirmedPaymentError(
                "タイムアウト: ウォレットから応答がありません(支払いが成立している可能性があります)",
              ),
            ),
          ),
        timeoutMs,
      );

      this.subs.set(subId, (response) => {
        // Only a verified response from our wallet, answering THIS request,
        // may settle the promise. Everything else (junk, replays of earlier
        // responses, forged pubkeys) is ignored and we keep waiting.
        if (!this.isFromWallet(response, RESPONSE_KIND)) return;
        if (!response.tags.some((t) => t[0] === "e" && t[1] === event.id)) return;
        void (async () => {
          let body: { error?: NwcErrorShape | null; result?: { preimage?: string } | null };
          try {
            const plain = await nip04Decrypt(secret, walletPubkey, response.content);
            body = JSON.parse(plain) as typeof body;
          } catch {
            return; // undecryptable / malformed content: ignore, keep waiting
          }
          if (body.error) {
            const reason = body.error.message || body.error.code || "不明なエラー";
            finish(() => reject(new Error(`支払い失敗: ${reason}`)));
          } else if (typeof body.result?.preimage === "string" && body.result.preimage !== "") {
            const preimage = body.result.preimage;
            finish(() => resolve(preimage));
          } else {
            // No error but no preimage either — the only proof of settlement
            // is missing, so the outcome cannot be called a success.
            finish(() =>
              reject(
                new UnconfirmedPaymentError(
                  "ウォレット応答にpreimageが無く、支払いの成否を確認できません",
                ),
              ),
            );
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
