/** Shared domain types for the Split LN Sender. */

/** A validated send target. */
export interface Recipient {
  address: string;
  amountSats: number;
}

/**
 * Per-recipient lifecycle while a batch send runs.
 * `unconfirmed` means the payment may or may not have settled (e.g. wallet
 * response timed out) — it must never be presented as a plain failure, since
 * retrying an unconfirmed payment risks paying twice.
 */
export type SendStatus =
  | "pending"
  | "resolving"
  | "paying"
  | "success"
  | "failed"
  | "unconfirmed"
  | "cancelled";

/** Progress callback payload from the sender. */
export interface ProgressUpdate {
  status: SendStatus;
  error?: string;
}
