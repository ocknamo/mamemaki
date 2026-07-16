/**
 * Sequential batch sender: for each recipient, resolve the Lightning Address,
 * fetch an invoice, pay it over NWC — one at a time, continuing past failures.
 */
import { fetchInvoice, resolveAddress } from "./lnurl";
import type { NwcClient } from "./nwc";
import type { ProgressUpdate, Recipient } from "./types";

export interface SenderDeps {
  resolveAddress: typeof resolveAddress;
  fetchInvoice: typeof fetchInvoice;
}

const defaultDeps: SenderDeps = { resolveAddress, fetchInvoice };

export async function sendAll(
  recipients: Recipient[],
  client: Pick<NwcClient, "payInvoice">,
  onUpdate: (index: number, update: ProgressUpdate) => void,
  deps: SenderDeps = defaultDeps,
): Promise<void> {
  for (let i = 0; i < recipients.length; i++) {
    const { address, amountSats } = recipients[i];
    try {
      onUpdate(i, { status: "resolving" });
      const params = await deps.resolveAddress(address);
      const invoice = await deps.fetchInvoice(params, amountSats * 1000);
      onUpdate(i, { status: "paying" });
      await client.payInvoice(invoice);
      onUpdate(i, { status: "success" });
    } catch (e) {
      onUpdate(i, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }
}
