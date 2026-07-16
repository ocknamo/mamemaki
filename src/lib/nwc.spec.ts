import { describe, expect, test } from "bun:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  bytesToHex,
  getPublicKeyHex,
  nip04Decrypt,
  nip04Encrypt,
  signEvent,
  type NostrEvent,
} from "./nostr";
import { NwcClient, parseNwcUri, type NwcConnection, type WsLike } from "./nwc";

const WALLET_SECRET = bytesToHex(schnorr.utils.randomSecretKey());
const CLIENT_SECRET = bytesToHex(schnorr.utils.randomSecretKey());
const WALLET_PUBKEY = getPublicKeyHex(WALLET_SECRET);

describe("parseNwcUri", () => {
  const valid = `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss://relay.test&secret=${CLIENT_SECRET}`;

  test("parses a valid URI", () => {
    const conn = parseNwcUri(valid);
    expect(conn).toEqual({
      walletPubkey: WALLET_PUBKEY,
      relayUrl: "wss://relay.test",
      secret: CLIENT_SECRET,
    });
  });

  test("trims surrounding whitespace", () => {
    expect(parseNwcUri(`  ${valid}\n`).relayUrl).toBe("wss://relay.test");
  });

  test.each([
    "http://example.com",
    "nostr+walletconnect://nothex?relay=wss://r&secret=" + CLIENT_SECRET,
    `nostr+walletconnect://${WALLET_PUBKEY}?secret=${CLIENT_SECRET}`,
    `nostr+walletconnect://${WALLET_PUBKEY}?relay=wss://relay.test`,
    "",
  ])("rejects %j", (uri) => {
    expect(() => parseNwcUri(uri)).toThrow();
  });
});

/**
 * A fake relay+wallet behind the WsLike interface: opens asynchronously,
 * ACKs published events, and answers pay_invoice requests it can decrypt.
 */
class FakeWalletRelay implements WsLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  subs = new Map<string, Record<string, unknown>>();

  constructor(private respond: (invoice: string) => Promise<unknown>) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(raw: string): void {
    const msg = JSON.parse(raw) as unknown[];
    if (msg[0] === "REQ") {
      this.subs.set(msg[1] as string, msg[2] as Record<string, unknown>);
    } else if (msg[0] === "EVENT") {
      void this.handlePublish(msg[1] as NostrEvent);
    }
  }

  private async handlePublish(request: NostrEvent): Promise<void> {
    this.onmessage?.({ data: JSON.stringify(["OK", request.id, true, ""]) });
    const plain = await nip04Decrypt(WALLET_SECRET, request.pubkey, request.content);
    const { params } = JSON.parse(plain) as { params: { invoice: string } };
    const body = await this.respond(params.invoice);
    const content = await nip04Encrypt(WALLET_SECRET, request.pubkey, JSON.stringify(body));
    const response = signEvent(
      { kind: 23195, tags: [["p", request.pubkey], ["e", request.id]], content },
      WALLET_SECRET,
    );
    for (const [subId, filter] of this.subs) {
      const eTags = (filter["#e"] as string[]) ?? [];
      if (eTags.includes(request.id)) {
        this.onmessage?.({ data: JSON.stringify(["EVENT", subId, response]) });
      }
    }
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const CONN: NwcConnection = {
  walletPubkey: WALLET_PUBKEY,
  relayUrl: "wss://relay.test",
  secret: CLIENT_SECRET,
};

describe("NwcClient.payInvoice", () => {
  test("full roundtrip: encrypt, publish, decrypt the wallet's result", async () => {
    const seen: string[] = [];
    const client = new NwcClient(CONN, () => {
      return new FakeWalletRelay(async (invoice) => {
        seen.push(invoice);
        return { result_type: "pay_invoice", result: { preimage: "aa".repeat(32) } };
      });
    });
    await client.connect();
    const preimage = await client.payInvoice("lnbc250n1fake");
    expect(preimage).toBe("aa".repeat(32));
    expect(seen).toEqual(["lnbc250n1fake"]);
    client.close();
  });

  test("maps a wallet error response to 支払い失敗", async () => {
    const client = new NwcClient(CONN, () => {
      return new FakeWalletRelay(async () => ({
        result_type: "pay_invoice",
        error: { code: "INSUFFICIENT_BALANCE", message: "not enough funds" },
      }));
    });
    await client.connect();
    await expect(client.payInvoice("lnbc1fake")).rejects.toThrow(/支払い失敗: not enough funds/);
    client.close();
  });

  test("times out when the wallet never responds", async () => {
    const client = new NwcClient(CONN, () => {
      const ws = new FakeWalletRelay(async () => ({}));
      ws.send = (raw: string) => {
        const msg = JSON.parse(raw) as unknown[];
        if (msg[0] === "REQ") ws.subs.set(msg[1] as string, msg[2] as Record<string, unknown>);
        // published EVENTs are silently dropped
      };
      return ws;
    });
    await client.connect();
    await expect(client.payInvoice("lnbc1fake", 50)).rejects.toThrow(/タイムアウト/);
    client.close();
  });

  test("maps a relay OK=false to 支払い拒否", async () => {
    const client = new NwcClient(CONN, () => {
      const ws = new FakeWalletRelay(async () => ({}));
      ws.send = (raw: string) => {
        const msg = JSON.parse(raw) as unknown[];
        if (msg[0] === "EVENT") {
          const ev = msg[1] as NostrEvent;
          ws.onmessage?.({ data: JSON.stringify(["OK", ev.id, false, "blocked: spam"]) });
        }
      };
      return ws;
    });
    await client.connect();
    await expect(client.payInvoice("lnbc1fake")).rejects.toThrow(/支払い拒否: blocked: spam/);
    client.close();
  });
});
