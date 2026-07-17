/**
 * Sequential batch sender: for each recipient, resolve the Lightning Address,
 * fetch an invoice, pay it over NWC — one at a time, continuing past failures.
 */
import { fetchInvoice, resolveAddress } from "./lnurl";
import { UnconfirmedPaymentError, type NwcClient } from "./nwc";
import type { ProgressUpdate, Recipient } from "./types";

export interface SenderDeps {
  resolveAddress: typeof resolveAddress;
  fetchInvoice: typeof fetchInvoice;
}

export interface SendAllOptions {
  /** Abort between recipients (the in-flight payment is allowed to finish). */
  signal?: AbortSignal;
  deps?: SenderDeps;
}

const defaultDeps: SenderDeps = { resolveAddress, fetchInvoice };

export async function sendAll(
  recipients: Recipient[],
  client: Pick<NwcClient, "payInvoice">,
  onUpdate: (index: number, update: ProgressUpdate) => void,
  options: SendAllOptions = {},
): Promise<void> {
  const deps = options.deps ?? defaultDeps;
  for (let i = 0; i < recipients.length; i++) {
    if (options.signal?.aborted) {
      for (let j = i; j < recipients.length; j++) onUpdate(j, { status: "cancelled" });
      return;
    }
    const { address, amountSats } = recipients[i];
    try {
      onUpdate(i, { status: "resolving" });
      const params = await deps.resolveAddress(address);
      const invoice = await deps.fetchInvoice(params, amountSats * 1000);
      onUpdate(i, { status: "paying" });
      await client.payInvoice(invoice);
      onUpdate(i, { status: "success" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // An unconfirmed outcome is NOT a failure: the payment may have settled,
      // and a retry could pay twice. Keep the distinction all the way to the UI.
      onUpdate(i, {
        status: e instanceof UnconfirmedPaymentError ? "unconfirmed" : "failed",
        error: message,
      });
    }
  }
}
