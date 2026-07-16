/**
 * LNURL-pay over Lightning Address (LUD-16): resolve `name@domain` to pay
 * params, then fetch a BOLT11 invoice from the callback.
 */

export interface LnurlPayParams {
  callback: string;
  /** millisats */
  minSendable: number;
  /** millisats */
  maxSendable: number;
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
  const [name, domain] = address.split("@");
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
  if (d.tag !== "payRequest" || typeof d.callback !== "string") {
    throw new Error("Lightning Address取得失敗: LNURL-pay応答が不正です");
  }
  return {
    callback: d.callback,
    minSendable: typeof d.minSendable === "number" ? d.minSendable : 1,
    maxSendable: typeof d.maxSendable === "number" ? d.maxSendable : Number.MAX_SAFE_INTEGER,
  };
}

/** Fetch a BOLT11 invoice for `amountMsats` from the LNURL-pay callback. */
export async function fetchInvoice(
  params: LnurlPayParams,
  amountMsats: number,
  fetchFn: FetchLike = defaultFetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<string> {
  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    const min = Math.ceil(params.minSendable / 1000);
    const max = Math.floor(params.maxSendable / 1000);
    throw new Error(`Invoice取得失敗: 金額が範囲外です (${min}〜${max} sats)`);
  }
  const sep = params.callback.includes("?") ? "&" : "?";
  const url = `${params.callback}${sep}amount=${amountMsats}`;
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
  return d.pr;
}
