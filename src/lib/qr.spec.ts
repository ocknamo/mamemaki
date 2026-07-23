import { describe, expect, test } from "bun:test";
import { bech32Decode, qrToLightningAddress } from "./qr";

// ── test-side bech32 encoder (BIP-173) ───────────────────────────

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >>> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >>> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const chk = polymod(values) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((chk >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...words, ...checksum].map((w) => CHARSET[w]).join("");
}

const lnurlEncode = (url: string) => bech32Encode("lnurl", new TextEncoder().encode(url));

// ── bech32Decode ─────────────────────────────────────────────────

describe("bech32Decode", () => {
  test("accepts BIP-173 valid vectors", () => {
    // Empty data part, all-uppercase form.
    const a = bech32Decode("A12UEL5L");
    expect(a).not.toBeNull();
    expect(a!.hrp).toBe("a");
    expect(a!.bytes).toHaveLength(0);
    // All 32 data characters → exactly 20 bytes.
    const b = bech32Decode("abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw");
    expect(b).not.toBeNull();
    expect(b!.hrp).toBe("abcdef");
    expect(b!.bytes).toHaveLength(20);
  });

  test("rejects a corrupted checksum", () => {
    expect(bech32Decode("A12UEL5X")).toBeNull();
  });

  test("rejects mixed case", () => {
    expect(bech32Decode("a12UEL5L")).toBeNull();
  });

  test("rejects a missing separator or invalid data characters", () => {
    expect(bech32Decode("no-separator")).toBeNull();
    expect(bech32Decode("lnurl1bbbbbbb")).toBeNull(); // "b" is not in the charset
  });

  test("round-trips an encoded payload", () => {
    const bytes = new TextEncoder().encode("https://example.com/x");
    const decoded = bech32Decode(bech32Encode("lnurl", bytes));
    expect(decoded).not.toBeNull();
    expect(new TextDecoder().decode(decoded!.bytes)).toBe("https://example.com/x");
  });
});

// ── qrToLightningAddress ─────────────────────────────────────────

describe("qrToLightningAddress", () => {
  test("accepts a bare Lightning Address, trimming and lowercasing", () => {
    expect(qrToLightningAddress("alice@getalby.com")).toBe("alice@getalby.com");
    expect(qrToLightningAddress("  Alice@GetAlby.com \n")).toBe("alice@getalby.com");
  });

  test("strips a lightning: URI prefix, case-insensitively", () => {
    expect(qrToLightningAddress("lightning:alice@getalby.com")).toBe("alice@getalby.com");
    expect(qrToLightningAddress("LIGHTNING:ALICE@GETALBY.COM")).toBe("alice@getalby.com");
  });

  test("converts an LNURL for a LUD-16 well-known endpoint to an address", () => {
    const lnurl = lnurlEncode("https://getalby.com/.well-known/lnurlp/alice");
    expect(qrToLightningAddress(lnurl)).toBe("alice@getalby.com");
    // QR codes typically carry bech32 uppercase, often behind lightning:.
    expect(qrToLightningAddress(lnurl.toUpperCase())).toBe("alice@getalby.com");
    expect(qrToLightningAddress(`lightning:${lnurl.toUpperCase()}`)).toBe("alice@getalby.com");
  });

  test("converts a LUD-17 lnurlp:// URI to an address", () => {
    expect(qrToLightningAddress("lnurlp://getalby.com/.well-known/lnurlp/alice")).toBe(
      "alice@getalby.com",
    );
  });

  test("rejects LNURLs that are not LUD-16 well-known endpoints", () => {
    // Arbitrary pay endpoint (LUD-01 style): decodes fine but has no address form.
    expect(qrToLightningAddress(lnurlEncode("https://service.com/api?q=abc"))).toBeNull();
    // Non-https scheme.
    expect(qrToLightningAddress(lnurlEncode("http://getalby.com/.well-known/lnurlp/alice"))).toBeNull();
    // Nested path under the well-known prefix.
    expect(
      qrToLightningAddress(lnurlEncode("https://getalby.com/.well-known/lnurlp/alice/extra")),
    ).toBeNull();
    // Name that doesn't form a valid Lightning Address.
    expect(
      qrToLightningAddress(lnurlEncode("https://getalby.com/.well-known/lnurlp/al%20ice")),
    ).toBeNull();
  });

  test("rejects a corrupted LNURL", () => {
    const lnurl = lnurlEncode("https://getalby.com/.well-known/lnurlp/alice");
    const corrupted = lnurl.slice(0, -1) + (lnurl.endsWith("q") ? "p" : "q");
    expect(qrToLightningAddress(corrupted)).toBeNull();
  });

  test("rejects other payloads", () => {
    expect(qrToLightningAddress("")).toBeNull();
    expect(qrToLightningAddress("not a qr we understand")).toBeNull();
    expect(qrToLightningAddress("lnbc10n1fakeinvoice")).toBeNull();
    expect(qrToLightningAddress("bitcoin:bc1qexample")).toBeNull();
    expect(qrToLightningAddress("nostr+walletconnect://abc?relay=wss://r&secret=s")).toBeNull();
  });
});
