import { describe, expect, test } from "bun:test";
import { fetchInvoice, resolveAddress, type FetchLike, type LnurlPayParams } from "./lnurl";

const json = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body }) as unknown as Response;

describe("resolveAddress", () => {
  test("resolves name@domain to pay params", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ tag: "payRequest", callback: "https://x.test/cb", minSendable: 1000, maxSendable: 5000000 });
    };
    const params = await resolveAddress("alice@getalby.com", fetchFn);
    expect(calls).toEqual(["https://getalby.com/.well-known/lnurlp/alice"]);
    expect(params.callback).toBe("https://x.test/cb");
  });

  test("categorises HTTP failures", async () => {
    const fetchFn: FetchLike = async () => json({}, false, 404);
    await expect(resolveAddress("ghost@x.test", fetchFn)).rejects.toThrow(
      /Lightning Address取得失敗/,
    );
  });

  test("rejects a non-payRequest response", async () => {
    const fetchFn: FetchLike = async () => json({ tag: "withdrawRequest" });
    await expect(resolveAddress("a@x.test", fetchFn)).rejects.toThrow(/Lightning Address取得失敗/);
  });

  test("surfaces LNURL ERROR reason", async () => {
    const fetchFn: FetchLike = async () => json({ status: "ERROR", reason: "user not found" });
    await expect(resolveAddress("a@x.test", fetchFn)).rejects.toThrow(/user not found/);
  });
});

describe("fetchInvoice", () => {
  const params: LnurlPayParams = {
    callback: "https://x.test/cb",
    minSendable: 1000,
    maxSendable: 100_000,
  };

  test("fetches the invoice for the amount in msats", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: "lnbc10n1..." });
    };
    const pr = await fetchInvoice(params, 5000, fetchFn);
    expect(pr).toBe("lnbc10n1...");
    expect(calls).toEqual(["https://x.test/cb?amount=5000"]);
  });

  test("appends with & when the callback already has a query", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: "lnbc..." });
    };
    await fetchInvoice({ ...params, callback: "https://x.test/cb?k=v" }, 5000, fetchFn);
    expect(calls[0]).toBe("https://x.test/cb?k=v&amount=5000");
  });

  test("rejects out-of-range amounts before any request", async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error("should not be called");
    };
    await expect(fetchInvoice(params, 500, fetchFn)).rejects.toThrow(/金額が範囲外/);
    await expect(fetchInvoice(params, 200_000, fetchFn)).rejects.toThrow(/金額が範囲外/);
  });

  test("surfaces callback errors", async () => {
    const fetchFn: FetchLike = async () => json({ status: "ERROR", reason: "route not found" });
    await expect(fetchInvoice(params, 5000, fetchFn)).rejects.toThrow(
      /Invoice取得失敗: route not found/,
    );
  });

  test("rejects a response with no invoice", async () => {
    const fetchFn: FetchLike = async () => json({});
    await expect(fetchInvoice(params, 5000, fetchFn)).rejects.toThrow(/Invoice取得失敗/);
  });
});
