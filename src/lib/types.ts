/** Shared domain types for the Split LN Sender. */

/** A validated send target. */
export interface Recipient {
  address: string;
  amountSats: number;
}

/** Per-recipient lifecycle while a batch send runs. */
export type SendStatus = "pending" | "resolving" | "paying" | "success" | "failed";

/** Progress callback payload from the sender. */
export interface ProgressUpdate {
  status: SendStatus;
  error?: string;
}
