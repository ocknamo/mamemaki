/** UI-side models: editable recipient rows and per-send progress entries. */
import { signal } from "@kanabun/core";
import type { Signal } from "@kanabun/core";
import type { Recipient, SendStatus } from "./lib/types";

export interface Row {
  id: number;
  address: Signal<string>;
  amount: Signal<string>;
}

let nextRowId = 1;

export function makeRow(address = "", amount = ""): Row {
  return {
    id: nextRowId++,
    address: signal(address),
    amount: signal(amount),
  };
}

/**
 * A snapshot taken when Send is pressed. Progress renders from these, not from
 * the live rows, so later edits/removals can never relabel what was actually
 * paid.
 */
export interface ProgressEntry {
  address: string;
  amountSats: number;
  status: Signal<SendStatus>;
  error: Signal<string>;
}

export function makeProgressEntries(recipients: Recipient[]): ProgressEntry[] {
  return recipients.map((r) => ({
    address: r.address,
    amountSats: r.amountSats,
    status: signal<SendStatus>("pending"),
    error: signal(""),
  }));
}

/** True once a recipient's outcome can no longer change. */
export function isTerminal(status: SendStatus): boolean {
  return (
    status === "success" ||
    status === "failed" ||
    status === "unconfirmed" ||
    status === "cancelled"
  );
}
