import { describe, expect, test } from "bun:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  bytesToHex,
  getPublicKeyHex,
  hexToBytes,
  nip04Decrypt,
  nip04Encrypt,
  signEvent,
} from "./nostr";

const alice = bytesToHex(schnorr.utils.randomSecretKey());
const bob = bytesToHex(schnorr.utils.randomSecretKey());

describe("hex helpers", () => {
  test("roundtrip", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  test("rejects invalid hex", () => {
    expect(() => hexToBytes("zz")).toThrow();
    expect(() => hexToBytes("abc")).toThrow();
  });
});

describe("signEvent", () => {
  test("produces a schnorr-verifiable event with a NIP-01 id", () => {
    const event = signEvent({ kind: 23194, tags: [["p", "ab".repeat(32)]], content: "hi" }, alice);
    expect(event.pubkey).toBe(getPublicKeyHex(alice));
    expect(event.id).toMatch(/^[0-9a-f]{64}$/);
    expect(schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))).toBe(
      true,
    );
  });
});

describe("nip04", () => {
  test("encrypt → decrypt roundtrip between two keypairs", async () => {
    const plaintext = JSON.stringify({ method: "pay_invoice", params: { invoice: "lnbc1..." } });
    const payload = await nip04Encrypt(alice, getPublicKeyHex(bob), plaintext);
    expect(payload).toContain("?iv=");
    const decrypted = await nip04Decrypt(bob, getPublicKeyHex(alice), payload);
    expect(decrypted).toBe(plaintext);
  });

  test("rejects a malformed payload", async () => {
    await expect(nip04Decrypt(bob, getPublicKeyHex(alice), "no-iv-here")).rejects.toThrow();
  });
});
