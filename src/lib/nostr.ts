/**
 * Minimal Nostr primitives: event signing (BIP-340 schnorr) and NIP-04
 * encryption. secp256k1 comes from @noble/curves (WebCrypto has no secp256k1);
 * AES-256-CBC uses WebCrypto.
 */
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface EventTemplate {
  kind: number;
  tags: string[][];
  content: string;
  created_at?: number;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error("不正なhex文字列です");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function getPublicKeyHex(secretHex: string): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(secretHex)));
}

/** Compute id + sig for an event template (NIP-01). */
export function signEvent(template: EventTemplate, secretHex: string): NostrEvent {
  const pubkey = getPublicKeyHex(secretHex);
  const created_at = template.created_at ?? Math.floor(Date.now() / 1000);
  const serialized = JSON.stringify([
    0,
    pubkey,
    created_at,
    template.kind,
    template.tags,
    template.content,
  ]);
  const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(secretHex)));
  return { id, pubkey, created_at, kind: template.kind, tags: template.tags, content: template.content, sig };
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** NIP-04 shared key: X coordinate of the ECDH point, used as an AES-256 key. */
async function sharedAesKey(secretHex: string, pubkeyHex: string): Promise<CryptoKey> {
  const point = secp256k1.getSharedSecret(hexToBytes(secretHex), hexToBytes("02" + pubkeyHex));
  const sharedX = point.slice(1, 33);
  return crypto.subtle.importKey("raw", sharedX as BufferSource, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function nip04Encrypt(
  secretHex: string,
  pubkeyHex: string,
  plaintext: string,
): Promise<string> {
  const key = await sharedAesKey(secretHex, pubkeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, new TextEncoder().encode(plaintext)),
  );
  return `${toBase64(ciphertext)}?iv=${toBase64(iv)}`;
}

export async function nip04Decrypt(
  secretHex: string,
  pubkeyHex: string,
  payload: string,
): Promise<string> {
  const [data, ivPart] = payload.split("?iv=");
  if (!data || !ivPart) throw new Error("NIP-04ペイロードが不正です");
  const key = await sharedAesKey(secretHex, pubkeyHex);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: fromBase64(ivPart) as BufferSource },
    key,
    fromBase64(data) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}
