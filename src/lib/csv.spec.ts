import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  test("parses valid lines", () => {
    const { recipients, errors } = parseCsv(
      "alice@getalby.com,100\nbob@coinos.io, 250\ncarol@blink.sv,500\n",
    );
    expect(errors).toEqual([]);
    expect(recipients).toEqual([
      { address: "alice@getalby.com", amountSats: 100 },
      { address: "bob@coinos.io", amountSats: 250 },
      { address: "carol@blink.sv", amountSats: 500 },
    ]);
  });

  test("skips blank lines and handles CRLF", () => {
    const { recipients, errors } = parseCsv("\r\nalice@getalby.com,100\r\n\r\n");
    expect(errors).toEqual([]);
    expect(recipients).toHaveLength(1);
  });

  test("reports bad lines with line numbers but keeps good ones", () => {
    const { recipients, errors } = parseCsv(
      "alice@getalby.com,100\nnot-an-address,50\nbob@coinos.io,zero\ncarol@blink.sv",
    );
    expect(recipients).toEqual([{ address: "alice@getalby.com", amountSats: 100 }]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("2行目");
    expect(errors[1]).toContain("3行目");
    expect(errors[2]).toContain("4行目");
  });
});
