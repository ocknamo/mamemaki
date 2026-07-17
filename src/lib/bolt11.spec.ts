import { describe, expect, test } from "bun:test";
import { decodeBolt11AmountMsats } from "./bolt11";

// Fake invoices: the data part after the bech32 separator "1" must avoid the
// character "1" (as in real bech32, whose data alphabet excludes it).
describe("decodeBolt11AmountMsats", () => {
  test("decodes each multiplier", () => {
    // 1 BTC = 100_000_000_000 msat
    expect(decodeBolt11AmountMsats("lnbc1m1qqxyz")).toBe(100_000_000n); // 0.001 BTC
    expect(decodeBolt11AmountMsats("lnbc1u1qqxyz")).toBe(100_000n);
    expect(decodeBolt11AmountMsats("lnbc10n1qqxyz")).toBe(1_000n); // 1 sat
    expect(decodeBolt11AmountMsats("lnbc2500u1qqxyz")).toBe(250_000_000n);
    expect(decodeBolt11AmountMsats("lnbc10p1qqxyz")).toBe(1n);
  });

  test("no multiplier means whole BTC", () => {
    expect(decodeBolt11AmountMsats("lnbc21qqxyz")).toBe(200_000_000_000n);
  });

  test("handles testnet/signet/regtest prefixes and uppercase", () => {
    expect(decodeBolt11AmountMsats("lntb50n1qqxyz")).toBe(5_000n);
    expect(decodeBolt11AmountMsats("lntbs50n1qqxyz")).toBe(5_000n);
    expect(decodeBolt11AmountMsats("lnbcrt50n1qqxyz")).toBe(5_000n);
    expect(decodeBolt11AmountMsats("LNBC50N1QQXYZ")).toBe(5_000n);
  });

  test("amountless invoices return null", () => {
    expect(decodeBolt11AmountMsats("lnbc1qqxyz")).toBeNull();
    expect(decodeBolt11AmountMsats("lntb1qqxyz")).toBeNull();
  });

  test("returns null for malformed input", () => {
    expect(decodeBolt11AmountMsats("lnbcm1qqxyz")).toBeNull(); // multiplier without digits
    expect(decodeBolt11AmountMsats("not-an-invoice")).toBeNull();
    expect(decodeBolt11AmountMsats("")).toBeNull();
  });

  test("rejects sub-msat precision (BOLT11 violation)", () => {
    // 1p = 0.1 msat → invalid
    expect(decodeBolt11AmountMsats("lnbc1p1qqxyz")).toBeNull();
    expect(decodeBolt11AmountMsats("lnbc15p1qqxyz")).toBeNull();
  });
});
