/** UI-side row model: editable signals per recipient row. */
import { signal } from "@kanabun/core";
import type { Signal } from "@kanabun/core";
import type { SendStatus } from "./lib/types";

export type RowStatus = "idle" | SendStatus;

export interface Row {
  id: number;
  address: Signal<string>;
  amount: Signal<string>;
  status: Signal<RowStatus>;
  error: Signal<string>;
}

let nextRowId = 1;

export function makeRow(address = "", amount = ""): Row {
  return {
    id: nextRowId++,
    address: signal(address),
    amount: signal(amount),
    status: signal<RowStatus>("idle"),
    error: signal(""),
  };
}
