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
import {
  NwcClient,
  parseNwcUri,
  UnconfirmedPaymentError,
  type NwcConnection,
  type WsLike,
} from "./nwc";

const WALLET_SECRET = bytesToHex(schnorr.utils.randomSecretKey());
const CLIENT_SECRET = bytesToHex(schnorr.utils.randomSecretKey());
const ATTACKER_SECRET = bytesToHex(schnorr.utils.randomSecretKey());
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

interface FakeRelayOptions {
  /** kind:13194 info event content; when set the relay serves it. */
  infoContent?: string;
  /** extra tags for the info event (e.g. [["encryption", "nip44_v2"]]). */
  infoTags?: string[][];
}

/**
 * A fake relay+wallet behind the WsLike interface: opens asynchronously,
 * ACKs published events, answers pay_invoice requests it can decrypt, and
 * serves the wallet's info event when configured.
 */
class FakeWalletRelay implements WsLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  subs = new Map<string, Record<string, unknown>>();

  constructor(
    private respond: (invoice: string) => Promise<unknown>,
    private options: FakeRelayOptions = {},
  ) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  deliver(subId: string, event: NostrEvent): void {
    this.onmessage?.({ data: JSON.stringify(["EVENT", subId, event]) });
  }

  send(raw: string): void {
    const msg = JSON.parse(raw) as unknown[];
    if (msg[0] === "REQ") {
      const subId = msg[1] as string;
      const filter = msg[2] as Record<string, unknown>;
      this.subs.set(subId, filter);
      const kinds = (filter.kinds as number[]) ?? [];
      if (kinds.includes(13194)) {
        if (this.options.infoContent !== undefined) {
          const info = signEvent(
            { kind: 13194, tags: this.options.infoTags ?? [], content: this.options.infoContent },
            WALLET_SECRET,
          );
          this.deliver(subId, info);
        }
        this.onmessage?.({ data: JSON.stringify(["EOSE", subId]) });
      }
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
      if (eTags.includes(request.id)) this.deliver(subId, response);
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

const okResult = { result_type: "pay_invoice", result: { preimage: "aa".repeat(32) } };

describe("NwcClient.payInvoice", () => {
  test("full roundtrip: encrypt, publish, decrypt the wallet's result", async () => {
    const seen: string[] = [];
    const client = new NwcClient(CONN, () => {
      return new FakeWalletRelay(async (invoice) => {
        seen.push(invoice);
        return okResult;
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

  test("times out as UNCONFIRMED (not failed) when the wallet never responds", async () => {
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
    const err = await client.payInvoice("lnbc1fake", 50).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnconfirmedPaymentError);
    expect((err as Error).message).toContain("タイムアウト");
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

  test("a success response without a preimage is UNCONFIRMED, not success", async () => {
    const client = new NwcClient(CONN, () => {
      return new FakeWalletRelay(async () => ({ result_type: "pay_invoice", result: {} }));
    });
    await client.connect();
    const err = await client.payInvoice("lnbc1fake", 200).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnconfirmedPaymentError);
    client.close();
  });
});

describe("NwcClient.payInvoice — hostile relay", () => {
  test("junk / undecryptable events are ignored and the real response still wins", async () => {
    let relay!: FakeWalletRelay;
    const client = new NwcClient(CONN, () => {
      relay = new FakeWalletRelay(async () => okResult);
      const origSend = relay.send.bind(relay);
      relay.send = (raw: string) => {
        const msg = JSON.parse(raw) as unknown[];
        if (msg[0] === "REQ" && (msg[1] as string).startsWith("pay-")) {
          relay.subs.set(msg[1] as string, msg[2] as Record<string, unknown>);
          // Attack: flood the subscription with garbage before the real answer.
          relay.deliver(msg[1] as string, { nonsense: true } as unknown as NostrEvent);
          const junk = signEvent({ kind: 23195, tags: [], content: "not-nip04!!" }, WALLET_SECRET);
          relay.deliver(msg[1] as string, junk);
          return;
        }
        origSend(raw);
      };
      return relay;
    });
    await client.connect();
    // Must NOT reject on the junk — the verified real response settles it.
    await expect(client.payInvoice("lnbc1fake")).resolves.toBe("aa".repeat(32));
    client.close();
  });

  test("a forged response signed by another key is ignored (→ unconfirmed timeout)", async () => {
    const client = new NwcClient(CONN, () => {
      const ws = new FakeWalletRelay(async () => ({}));
      ws.send = (raw: string) => {
        const msg = JSON.parse(raw) as unknown[];
        if (msg[0] === "REQ") {
          ws.subs.set(msg[1] as string, msg[2] as Record<string, unknown>);
        } else if (msg[0] === "EVENT") {
          const request = msg[1] as NostrEvent;
          void (async () => {
            // Attacker knows the request id but not the wallet's key.
            const content = await nip04Encrypt(
              ATTACKER_SECRET,
              getPublicKeyHex(CLIENT_SECRET),
              JSON.stringify(okResult),
            );
            const forged = signEvent(
              { kind: 23195, tags: [["e", request.id]], content },
              ATTACKER_SECRET,
            );
            // Claim the wallet's pubkey (breaks the signature check).
            const impersonated = { ...forged, pubkey: WALLET_PUBKEY };
            for (const subId of ws.subs.keys()) {
              ws.deliver(subId, forged);
              ws.deliver(subId, impersonated);
            }
          })();
        }
      };
      return ws;
    });
    await client.connect();
    const err = await client.payInvoice("lnbc1fake", 200).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnconfirmedPaymentError);
    client.close();
  });

  test("a replayed response for an earlier request is ignored (→ unconfirmed timeout)", async () => {
    // A genuine wallet-signed success response… for a different request id.
    const staleContent = await nip04Encrypt(
      WALLET_SECRET,
      getPublicKeyHex(CLIENT_SECRET),
      JSON.stringify(okResult),
    );
    const stale = signEvent(
      { kind: 23195, tags: [["e", "ab".repeat(32)]], content: staleContent },
      WALLET_SECRET,
    );
    const client = new NwcClient(CONN, () => {
      const ws = new FakeWalletRelay(async () => ({}));
      ws.send = (raw: string) => {
        const msg = JSON.parse(raw) as unknown[];
        if (msg[0] === "REQ") {
          ws.subs.set(msg[1] as string, msg[2] as Record<string, unknown>);
          // Attack: replay the old success response into the new subscription.
          ws.deliver(msg[1] as string, stale);
        }
      };
      return ws;
    });
    await client.connect();
    const err = await client.payInvoice("lnbc1fake", 200).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(UnconfirmedPaymentError);
    client.close();
  });
});

describe("NwcClient.getInfo", () => {
  test("returns the wallet's methods and encryption schemes", async () => {
    const client = new NwcClient(CONN, () => {
      return new FakeWalletRelay(async () => ({}), {
        infoContent: "pay_invoice get_balance get_info",
        infoTags: [["encryption", "nip44_v2 nip04"]],
      });
    });
    const info = await client.getInfo();
    expect(info.methods).toEqual(["pay_invoice", "get_balance", "get_info"]);
    expect(info.encryptions).toEqual(["nip44_v2", "nip04"]);
    client.close();
  });

  test("no encryption tag yields null (NIP-04 implied)", async () => {
    const client = new NwcClient(CONN, () => {
      return new FakeWalletRelay(async () => ({}), { infoContent: "pay_invoice" });
    });
    const info = await client.getInfo();
    expect(info.encryptions).toBeNull();
    client.close();
  });

  test("rejects when the wallet has no info event on the relay", async () => {
    const client = new NwcClient(CONN, () => new FakeWalletRelay(async () => ({})));
    await expect(client.getInfo()).rejects.toThrow(/13194.*見つかりません/);
    client.close();
  });
});
