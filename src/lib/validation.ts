/** Input validation for Lightning Addresses and sat amounts. */

// LUD-16 name@domain. Names are typically [a-z0-9-_.]; be mildly lenient on
// case, strict on having a dotted domain.
const ADDRESS_RE = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function isValidLightningAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

/** Parse a sats amount: integer, >= 1. Returns null when invalid. */
export function parseAmountSats(value: string): number | null {
  const t = value.trim();
  if (!/^[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
