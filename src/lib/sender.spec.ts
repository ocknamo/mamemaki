import { describe, expect, test } from "bun:test";
import type { LnurlPayParams } from "./lnurl";
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
      makeDeps(),
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
      deps,
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
      makeDeps(),
    );
    expect(updates.at(-1)![1]).toEqual({
      status: "failed",
      error: "支払い失敗: not enough funds",
    });
  });
});
