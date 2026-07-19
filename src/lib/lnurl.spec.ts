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

  test("lowercases the address per LUD-16", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ tag: "payRequest", callback: "https://x.test/cb", minSendable: 1000, maxSendable: 5000000 });
    };
    await resolveAddress("Alice@GetAlby.COM", fetchFn);
    expect(calls).toEqual(["https://getalby.com/.well-known/lnurlp/alice"]);
  });

  test("categorises HTTP failures", async () => {
    const fetchFn: FetchLike = async () => json({}, false, 404);
    await expect(resolveAddress("ghost@x.test", fetchFn)).rejects.toThrow(
      /Lightning Address取得失敗/,
    );
  });

  test("rejects a response missing minSendable/maxSendable (LUD-06 required)", async () => {
    const fetchFn: FetchLike = async () => json({ tag: "payRequest", callback: "https://x.test/cb" });
    await expect(resolveAddress("a@x.test", fetchFn)).rejects.toThrow(/応答が不正/);
  });

  test("rejects a non-payRequest response", async () => {
    const fetchFn: FetchLike = async () => json({ tag: "withdrawRequest" });
    await expect(resolveAddress("a@x.test", fetchFn)).rejects.toThrow(/Lightning Address取得失敗/);
  });

  test("surfaces LNURL ERROR reason", async () => {
    const fetchFn: FetchLike = async () => json({ status: "ERROR", reason: "user not found" });
    await expect(resolveAddress("a@x.test", fetchFn)).rejects.toThrow(/user not found/);
  });

  test("captures commentAllowed per LUD-12", async () => {
    const fetchFn: FetchLike = async () =>
      json({
        tag: "payRequest",
        callback: "https://x.test/cb",
        minSendable: 1000,
        maxSendable: 5000000,
        commentAllowed: 255,
      });
    const params = await resolveAddress("alice@x.test", fetchFn);
    expect(params.commentAllowed).toBe(255);
  });

  test("leaves commentAllowed undefined when absent or non-numeric", async () => {
    const base = { tag: "payRequest", callback: "https://x.test/cb", minSendable: 1000, maxSendable: 5000000 };
    const absent: FetchLike = async () => json(base);
    expect((await resolveAddress("a@x.test", absent)).commentAllowed).toBeUndefined();
    const stringy: FetchLike = async () => json({ ...base, commentAllowed: "255" });
    expect((await resolveAddress("a@x.test", stringy)).commentAllowed).toBeUndefined();
  });
});

describe("fetchInvoice", () => {
  const params: LnurlPayParams = {
    callback: "https://x.test/cb",
    minSendable: 1000,
    maxSendable: 100_000,
  };

  // 50n = 50 * 100 msat = 5000 msats — matches the requested amount below.
  const MATCHING_PR = "lnbc50n1qqxyz";

  test("fetches the invoice for the amount in msats", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: MATCHING_PR });
    };
    const pr = await fetchInvoice(params, 5000, undefined, fetchFn);
    expect(pr).toBe(MATCHING_PR);
    expect(calls).toEqual(["https://x.test/cb?amount=5000"]);
  });

  test("appends with & when the callback already has a query", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: MATCHING_PR });
    };
    await fetchInvoice({ ...params, callback: "https://x.test/cb?k=v" }, 5000, undefined, fetchFn);
    expect(calls[0]).toBe("https://x.test/cb?k=v&amount=5000");
  });

  test("rejects an invoice whose amount differs from the request (LUD-06)", async () => {
    // 10n = 1000 msats, but we ask for 5000
    const fetchFn: FetchLike = async () => json({ pr: "lnbc10n1qqxyz" });
    await expect(fetchInvoice(params, 5000, undefined, fetchFn)).rejects.toThrow(/金額がリクエストと一致しません/);
  });

  test("rejects an amountless invoice", async () => {
    const fetchFn: FetchLike = async () => json({ pr: "lnbc1qqxyz" });
    await expect(fetchInvoice(params, 5000, undefined, fetchFn)).rejects.toThrow(/金額がリクエストと一致しません/);
  });

  test("rejects out-of-range amounts before any request", async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error("should not be called");
    };
    await expect(fetchInvoice(params, 500, undefined, fetchFn)).rejects.toThrow(/金額が範囲外/);
    await expect(fetchInvoice(params, 200_000, undefined, fetchFn)).rejects.toThrow(/金額が範囲外/);
  });

  test("appends a URL-encoded comment when it fits commentAllowed (LUD-12)", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: MATCHING_PR });
    };
    await fetchInvoice({ ...params, commentAllowed: 255 }, 5000, "#1", fetchFn);
    // "#" must be percent-encoded — a raw "#" would truncate the query as a fragment
    expect(calls).toEqual(["https://x.test/cb?amount=5000&comment=%231"]);
  });

  test("appends the comment after an existing query string", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: MATCHING_PR });
    };
    await fetchInvoice(
      { ...params, callback: "https://x.test/cb?k=v", commentAllowed: 255 },
      5000,
      "#1",
      fetchFn,
    );
    expect(calls[0]).toBe("https://x.test/cb?k=v&amount=5000&comment=%231");
  });

  test("omits the comment when the server does not advertise commentAllowed", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: MATCHING_PR });
    };
    const pr = await fetchInvoice(params, 5000, "#1", fetchFn);
    expect(pr).toBe(MATCHING_PR);
    expect(calls).toEqual(["https://x.test/cb?amount=5000"]);
  });

  test("omits the comment when commentAllowed is 0", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: MATCHING_PR });
    };
    await fetchInvoice({ ...params, commentAllowed: 0 }, 5000, "#1", fetchFn);
    expect(calls).toEqual(["https://x.test/cb?amount=5000"]);
  });

  test("omits the comment when it exceeds commentAllowed", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return json({ pr: MATCHING_PR });
    };
    const pr = await fetchInvoice({ ...params, commentAllowed: 1 }, 5000, "#10", fetchFn);
    expect(pr).toBe(MATCHING_PR);
    expect(calls).toEqual(["https://x.test/cb?amount=5000"]);
  });

  test("surfaces callback errors", async () => {
    const fetchFn: FetchLike = async () => json({ status: "ERROR", reason: "route not found" });
    await expect(fetchInvoice(params, 5000, undefined, fetchFn)).rejects.toThrow(
      /Invoice取得失敗: route not found/,
    );
  });

  test("rejects a response with no invoice", async () => {
    const fetchFn: FetchLike = async () => json({});
    await expect(fetchInvoice(params, 5000, undefined, fetchFn)).rejects.toThrow(/Invoice取得失敗/);
  });
});
