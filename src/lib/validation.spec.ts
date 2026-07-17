import { describe, expect, test } from "bun:test";
import { isValidLightningAddress, parseAmountSats } from "./validation";

describe("isValidLightningAddress", () => {
  test.each([
    "alice@getalby.com",
    "bob@coinos.io",
    "carol.smith+tips@blink.sv",
    "UPPER@EXAMPLE.COM",
  ])("accepts %s", (addr) => {
    expect(isValidLightningAddress(addr)).toBe(true);
  });

  test.each([
    "",
    "alice",
    "@getalby.com",
    "alice@",
    "alice@localhost",
    "alice@@getalby.com",
    "ali ce@getalby.com",
    "alice@get alby.com",
  ])("rejects %j", (addr) => {
    expect(isValidLightningAddress(addr)).toBe(false);
  });
});

describe("parseAmountSats", () => {
  test("parses positive integers", () => {
    expect(parseAmountSats("1")).toBe(1);
    expect(parseAmountSats(" 250 ")).toBe(250);
    expect(parseAmountSats("100000")).toBe(100000);
  });

  test.each(["", "0", "-5", "1.5", "abc", "10sats", "１００"])("rejects %j", (v) => {
    expect(parseAmountSats(v)).toBeNull();
  });
});
