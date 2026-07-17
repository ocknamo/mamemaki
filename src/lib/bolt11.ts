/**
 * Minimal BOLT11 amount decoding — just the HRP (`ln<network><amount><mult>`),
 * enough to enforce LUD-06's "the wallet MUST verify the invoice amount equals
 * the requested amount" without pulling in a full bolt11 dependency.
 */

// Longest prefixes first so `bcrt`/`tbs` don't get eaten by `bc`/`tb`.
const HRP_RE = /^ln(bcrt|tbs|tb|bc)(\d+)?([munp])?$/;

const DIVISOR: Record<string, bigint> = {
  m: 1_000n,
  u: 1_000_000n,
  n: 1_000_000_000n,
  p: 1_000_000_000_000n,
};

const MSATS_PER_BTC = 100_000_000_000n;

/**
 * The invoice amount in millisats, or null when the invoice is amountless or
 * malformed (including sub-msat precision, which BOLT11 forbids).
 */
export function decodeBolt11AmountMsats(invoice: string): bigint | null {
  const lowered = invoice.trim().toLowerCase();
  // bech32: the separator is the last "1" (the data alphabet excludes "1").
  const sep = lowered.lastIndexOf("1");
  if (sep === -1) return null;
  const m = HRP_RE.exec(lowered.slice(0, sep));
  if (!m) return null;
  const [, , digits, multiplier] = m;
  if (!digits) return null; // amountless invoice
  const raw = BigInt(digits) * MSATS_PER_BTC;
  const divisor = multiplier ? DIVISOR[multiplier] : 1n;
  if (raw % divisor !== 0n) return null; // sub-msat precision is invalid
  return raw / divisor;
}
