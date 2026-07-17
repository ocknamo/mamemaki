/** Parse pasted CSV lines of the form `address,amount` into recipients. */
import type { Recipient } from "./types";
import { isValidLightningAddress, parseAmountSats } from "./validation";

export interface CsvParseResult {
  recipients: Recipient[];
  /** Human-readable errors, one per bad line, with 1-based line numbers. */
  errors: string[];
  /** The offending lines verbatim, so callers can hand them back for fixing. */
  invalidLines: string[];
}

export function parseCsv(text: string): CsvParseResult {
  const recipients: Recipient[] = [];
  const errors: string[] = [];
  const invalidLines: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const lineNo = i + 1;
    const fail = (message: string) => {
      errors.push(message);
      invalidLines.push(line);
    };
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length !== 2) {
      fail(`${lineNo}行目: "address,amount" 形式ではありません`);
      continue;
    }
    const [address, rawAmount] = parts;
    if (!isValidLightningAddress(address)) {
      fail(`${lineNo}行目: Lightning Address が不正です (${address})`);
      continue;
    }
    const amountSats = parseAmountSats(rawAmount);
    if (amountSats === null) {
      fail(`${lineNo}行目: 金額は1以上の整数で指定してください (${rawAmount})`);
      continue;
    }
    recipients.push({ address, amountSats });
  }
  return { recipients, errors, invalidLines };
}
