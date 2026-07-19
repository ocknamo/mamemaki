/**
 * LNURL-pay over Lightning Address (LUD-16): resolve `name@domain` to pay
 * params, then fetch a BOLT11 invoice from the callback.
 */

import { decodeBolt11AmountMsats } from "./bolt11";

export interface LnurlPayParams {
  callback: string;
  /** millisats */
  minSendable: number;
  /** millisats */
  maxSendable: number;
  /** LUD-12: max comment length the server accepts (absent/0 = unsupported) */
  commentAllowed?: number;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
const REQUEST_TIMEOUT_MS = 10_000;

async function getJson(url: string, fetchFn: FetchLike, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("タイムアウト");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Resolve a Lightning Address to its LNURL-pay parameters. */
export async function resolveAddress(
  address: string,
  fetchFn: FetchLike = defaultFetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<LnurlPayParams> {
  // LUD-16 names are defined lowercase; normalize so mixed-case input resolves.
  const [name, domain] = address.trim().toLowerCase().split("@");
  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;
  let data: unknown;
  try {
    data = await getJson(url, fetchFn, timeoutMs);
  } catch (e) {
    throw new Error(`Lightning Address取得失敗: ${message(e)}`);
  }
  const d = data as Partial<LnurlPayParams> & { tag?: string; status?: string; reason?: string };
  if (d.status === "ERROR") {
    throw new Error(`Lightning Address取得失敗: ${d.reason ?? "サーバーエラー"}`);
  }
  // LUD-06 requires callback, minSendable, and maxSendable — reject rather
  // than paper over a broken/hostile server with permissive defaults.
  if (
    d.tag !== "payRequest" ||
    typeof d.callback !== "string" ||
    typeof d.minSendable !== "number" ||
    typeof d.maxSendable !== "number"
  ) {
    throw new Error("Lightning Address取得失敗: LNURL-pay応答が不正です");
  }
  return {
    callback: d.callback,
    minSendable: d.minSendable,
    maxSendable: d.maxSendable,
    // LUD-12 is optional; servers in the wild omit it or send garbage types.
    ...(typeof d.commentAllowed === "number" ? { commentAllowed: d.commentAllowed } : {}),
  };
}

/** Fetch a BOLT11 invoice for `amountMsats` from the LNURL-pay callback. */
export async function fetchInvoice(
  params: LnurlPayParams,
  amountMsats: number,
  comment?: string,
  fetchFn: FetchLike = defaultFetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<string> {
  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    const min = Math.ceil(params.minSendable / 1000);
    const max = Math.floor(params.maxSendable / 1000);
    throw new Error(`Invoice取得失敗: 金額が範囲外です (${min}〜${max} sats)`);
  }
  const sep = params.callback.includes("?") ? "&" : "?";
  let url = `${params.callback}${sep}amount=${amountMsats}`;
  // LUD-12: attach the comment only when the server accepts one this long.
  // Otherwise send without it — a successful payment beats an identifier.
  if (comment && params.commentAllowed && comment.length <= params.commentAllowed) {
    url += `&comment=${encodeURIComponent(comment)}`;
  }
  let data: unknown;
  try {
    data = await getJson(url, fetchFn, timeoutMs);
  } catch (e) {
    throw new Error(`Invoice取得失敗: ${message(e)}`);
  }
  const d = data as { pr?: string; status?: string; reason?: string };
  if (d.status === "ERROR") {
    throw new Error(`Invoice取得失敗: ${d.reason ?? "サーバーエラー"}`);
  }
  if (typeof d.pr !== "string" || d.pr === "") {
    throw new Error("Invoice取得失敗: 応答にinvoiceがありません");
  }
  // LUD-06: the payer MUST verify the invoice amount equals what was requested
  // — otherwise a hostile LNURL server can hand back an invoice for any amount.
  const invoiceMsats = decodeBolt11AmountMsats(d.pr);
  if (invoiceMsats === null || invoiceMsats !== BigInt(amountMsats)) {
    throw new Error("Invoice取得失敗: invoiceの金額がリクエストと一致しません");
  }
  return d.pr;
}
