/**
 * QR payload → Lightning Address (LUD-16) conversion for camera scanning.
 *
 * Accepted payloads:
 * - a bare Lightning Address (`name@domain`), optionally behind a
 *   `lightning:` URI prefix
 * - a bech32 LNURL (LUD-01) whose decoded URL is a LUD-16 endpoint
 *   (`https://<domain>/.well-known/lnurlp/<name>`)
 * - a LUD-17 `lnurlp://<domain>/.well-known/lnurlp/<name>` URI
 *
 * Everything else (BOLT11 invoices, withdraw/auth LNURLs, arbitrary
 * lnurl-pay endpoints, ...) yields null — recipient rows only hold
 * Lightning Addresses, and only the well-known path maps back to one.
 */

import { isValidLightningAddress } from "./validation";

// ── bech32 (BIP-173) ─────────────────────────────────────────────
// LNURL uses plain bech32 (constant 1), with the 90-char length limit
// explicitly waived by LUD-01, so no length check here.

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

/** Decode a bech32 string, verifying the checksum. Returns the data bytes. */
export function bech32Decode(input: string): { hrp: string; bytes: Uint8Array } | null {
  // Mixed case is invalid; QR codes often carry all-uppercase bech32.
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) return null;
  const s = input.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep + 7 > s.length) return null;
  const hrp = s.slice(0, sep);
  const values: number[] = [];
  for (const c of s.slice(sep + 1)) {
    const v = CHARSET.indexOf(c);
    if (v === -1) return null;
    values.push(v);
  }
  if (polymod([...hrpExpand(hrp), ...values]) !== 1) return null;
  // Regroup 5-bit words (minus the 6-word checksum) into bytes.
  const words = values.slice(0, -6);
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 0xff);
    }
  }
  // Trailing padding must be zero and shorter than a full word.
  if (bits >= 5 || (acc << (8 - bits)) & 0xff) return null;
  return { hrp, bytes: new Uint8Array(bytes) };
}

// ── URL → Lightning Address ──────────────────────────────────────

/** Map a LUD-16 well-known lnurlp URL back to `name@domain`, else null. */
function wellKnownToAddress(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const m = /^\/\.well-known\/lnurlp\/([^/]+)$/.exec(u.pathname);
  if (!m) return null;
  let name: string;
  try {
    name = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  const address = `${name}@${u.hostname}`;
  return isValidLightningAddress(address) ? address : null;
}

// ── QR payload parsing ───────────────────────────────────────────

/**
 * Extract a Lightning Address from a scanned QR payload. Returns null when
 * the payload isn't (convertible to) a Lightning Address.
 */
export function qrToLightningAddress(payload: string): string | null {
  let s = payload.trim();
  // Wallets commonly wrap the value in a `lightning:` URI (BIP-21 style).
  if (/^lightning:/i.test(s)) s = s.slice("lightning:".length);

  if (isValidLightningAddress(s)) return s.toLowerCase();

  if (/^lnurl1/i.test(s)) {
    const decoded = bech32Decode(s);
    if (!decoded || decoded.hrp !== "lnurl") return null;
    return wellKnownToAddress(new TextDecoder().decode(decoded.bytes));
  }

  // LUD-17: scheme prefix instead of bech32; `lnurlp` maps to https.
  if (/^lnurlp:\/\//i.test(s)) {
    return wellKnownToAddress(`https://${s.slice("lnurlp://".length)}`);
  }

  return null;
}
