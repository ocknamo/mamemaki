import { describe, expect, test } from "bun:test";
import type { LnurlPayParams } from "./lnurl";
import { UnconfirmedPaymentError } from "./nwc";
import { sendAll, type SenderDeps } from "./sender";
import type { ProgressUpdate } from "./types";

const PARAMS: LnurlPayParams = { callback: "https://x.test/cb", minSendable: 1, maxSendable: 1e9 };

function makeDeps(overrides: Partial<SenderDeps> = {}): SenderDeps {
  return {
    resolveAddress: async () => PARAMS,
    fetchInvoice: async (_p, msats) => `lnbc-${msats}`,
    ...overrides,
  };
}

describe("sendAll", () => {
  test("pays each recipient sequentially and reports success", async () => {
    const paid: string[] = [];
    const updates: Array<[number, ProgressUpdate]> = [];
    const client = {
      payInvoice: async (invoice: string) => {
        paid.push(invoice);
        return "preimage";
      },
    };
    await sendAll(
      [
        { address: "alice@x.test", amountSats: 100 },
        { address: "bob@x.test", amountSats: 250 },
      ],
      client,
      (i, u) => updates.push([i, u]),
      { deps: makeDeps() },
    );
    // amounts are converted to msats
    expect(paid).toEqual(["lnbc-100000", "lnbc-250000"]);
    expect(updates).toEqual([
      [0, { status: "resolving" }],
      [0, { status: "paying" }],
      [0, { status: "success" }],
      [1, { status: "resolving" }],
      [1, { status: "paying" }],
      [1, { status: "success" }],
    ]);
  });

  test("passes the row number as a LUD-12 comment (#1, #2, ...)", async () => {
    const comments: Array<string | undefined> = [];
    const client = { payInvoice: async () => "p" };
    const deps = makeDeps({
      fetchInvoice: async (_p, msats, comment) => {
        comments.push(comment);
        return `lnbc-${msats}`;
      },
    });
    await sendAll(
      [
        { address: "alice@x.test", amountSats: 1 },
        { address: "bob@x.test", amountSats: 2 },
        { address: "carol@x.test", amountSats: 3 },
      ],
      client,
      () => {},
      { deps },
    );
    expect(comments).toEqual(["#1", "#2", "#3"]);
  });

  test("a failure is reported with its reason and the batch continues", async () => {
    const updates: Array<[number, ProgressUpdate]> = [];
    const client = { payInvoice: async () => "p" };
    const deps = makeDeps({
      resolveAddress: async (address) => {
        if (address === "bob@x.test") throw new Error("Lightning Address取得失敗: HTTP 404");
        return PARAMS;
      },
    });
    await sendAll(
      [
        { address: "alice@x.test", amountSats: 1 },
        { address: "bob@x.test", amountSats: 2 },
        { address: "carol@x.test", amountSats: 3 },
      ],
      client,
      (i, u) => updates.push([i, u]),
      { deps },
    );
    const final = [0, 1, 2].map(
      (i) => updates.filter(([idx]) => idx === i).at(-1)![1],
    );
    expect(final[0]).toEqual({ status: "success" });
    expect(final[1]).toEqual({ status: "failed", error: "Lightning Address取得失敗: HTTP 404" });
    expect(final[2]).toEqual({ status: "success" });
  });

  test("payment failures are caught per recipient", async () => {
    const updates: Array<[number, ProgressUpdate]> = [];
    const client = {
      payInvoice: async () => {
        throw new Error("支払い失敗: not enough funds");
      },
    };
    await sendAll(
      [{ address: "alice@x.test", amountSats: 1 }],
      client,
      (i, u) => updates.push([i, u]),
      { deps: makeDeps() },
    );
    expect(updates.at(-1)![1]).toEqual({
      status: "failed",
      error: "支払い失敗: not enough funds",
    });
  });

  test("an UnconfirmedPaymentError maps to unconfirmed, not failed", async () => {
    const updates: Array<[number, ProgressUpdate]> = [];
    const client = {
      payInvoice: async () => {
        throw new UnconfirmedPaymentError("タイムアウト: 成立している可能性があります");
      },
    };
    await sendAll(
      [
        { address: "alice@x.test", amountSats: 1 },
        { address: "bob@x.test", amountSats: 2 },
      ],
      client,
      (i, u) => updates.push([i, u]),
      { deps: makeDeps() },
    );
    const final = [0, 1].map((i) => updates.filter(([idx]) => idx === i).at(-1)![1]);
    expect(final[0].status).toBe("unconfirmed");
    // the batch still continues after an unconfirmed outcome
    expect(final[1].status).toBe("unconfirmed");
  });

  test("aborting cancels the remaining recipients between payments", async () => {
    const updates: Array<[number, ProgressUpdate]> = [];
    const ctrl = new AbortController();
    const client = {
      payInvoice: async () => {
        ctrl.abort(); // user hits Cancel while the first payment is in flight
        return "p";
      },
    };
    await sendAll(
      [
        { address: "alice@x.test", amountSats: 1 },
        { address: "bob@x.test", amountSats: 2 },
        { address: "carol@x.test", amountSats: 3 },
      ],
      client,
      (i, u) => updates.push([i, u]),
      { deps: makeDeps(), signal: ctrl.signal },
    );
    const final = [0, 1, 2].map((i) => updates.filter(([idx]) => idx === i).at(-1)![1]);
    // the in-flight payment completes; everything after is cancelled unpaid
    expect(final[0]).toEqual({ status: "success" });
    expect(final[1]).toEqual({ status: "cancelled" });
    expect(final[2]).toEqual({ status: "cancelled" });
  });
});
