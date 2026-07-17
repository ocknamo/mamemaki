import { computed, css, For, Show } from "@kanabun/core";
import type { Accessor } from "@kanabun/core";
import type { SendStatus } from "../lib/types";
import type { ProgressEntry } from "../model";
import { cardStyles } from "./styles";

const progressStyles = css`
  .progress-count {
    margin: 0 0 0.5rem;
    font-size: 1.2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .progress-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .progress-list li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.4rem 0.1rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .progress-list li:last-child {
    border-bottom: none;
  }
  .st-icon {
    width: 1.1rem;
    text-align: center;
    flex: none;
  }
  .st-who {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .st-res {
    color: var(--muted);
    font-size: 0.82rem;
    text-align: right;
    max-width: 45%;
    overflow-wrap: anywhere;
  }
  .st-success .st-icon,
  .st-success .st-res {
    color: var(--success);
  }
  .st-failed .st-icon,
  .st-failed .st-res {
    color: var(--danger);
  }
  .st-unconfirmed .st-icon,
  .st-unconfirmed .st-res {
    color: var(--warn);
  }
  .result-summary {
    margin: 0.6rem 0 0;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .unconfirmed-note {
    margin: 0.6rem 0 0;
    padding: 0.5rem 0.6rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--warn);
    font-size: 0.82rem;
  }
`;

const STATUS_ICON: Record<SendStatus, string> = {
  pending: "•",
  resolving: "…",
  paying: "…",
  success: "✓",
  failed: "✗",
  unconfirmed: "?",
  cancelled: "–",
};

const STATUS_LABEL: Record<SendStatus, string> = {
  pending: "waiting",
  resolving: "resolving…",
  paying: "paying…",
  success: "Success",
  failed: "Failed",
  unconfirmed: "Unknown",
  cancelled: "Cancelled",
};

export interface ProgressCardProps {
  entries: Accessor<ProgressEntry[]>;
  phase: Accessor<"idle" | "sending" | "done">;
  doneCount: Accessor<number>;
}

/**
 * Per-recipient send progress and, once done, the result summary. Renders from
 * the send-time snapshot, so edits to the recipient list afterwards can never
 * relabel what was actually paid.
 */
export function ProgressCard({ entries, phase, doneCount }: ProgressCardProps) {
  const count = (s: SendStatus) =>
    computed(() => entries().filter((e) => e.status() === s).length);
  const successCount = count("success");
  const failedCount = count("failed");
  const unconfirmedCount = count("unconfirmed");
  const cancelledCount = count("cancelled");

  return (
    <section class={`card progress-card ${cardStyles} ${progressStyles}`}>
      <h2>{() => (phase() === "sending" ? "Sending…" : "Results")}</h2>
      <p class="progress-count">
        {() => doneCount()} / {() => entries().length}
      </p>
      <ul class="progress-list">
        <For each={() => entries()}>
          {(entry: ProgressEntry) => (
            <li class={() => `st-${entry.status()}`}>
              <span class="st-icon">{() => STATUS_ICON[entry.status()]}</span>
              <span class="st-who">{entry.address}</span>
              <span class="st-res">
                {() => (entry.status() === "failed" || entry.status() === "unconfirmed"
                  ? entry.error()
                  : STATUS_LABEL[entry.status()])}
              </span>
            </li>
          )}
        </For>
      </ul>
      <Show when={() => unconfirmedCount() > 0}>
        <p class="unconfirmed-note">
          「?」の支払いは成立している可能性があります。再送する前にウォレットの履歴で成否を確認してください。
        </p>
      </Show>
      <Show when={() => phase() === "done"}>
        <p class="result-summary">
          Success: {() => successCount()} / Failed: {() => failedCount()}
          {() => (unconfirmedCount() > 0 ? ` / Unknown: ${unconfirmedCount()}` : "")}
          {() => (cancelledCount() > 0 ? ` / Cancelled: ${cancelledCount()}` : "")}
        </p>
      </Show>
    </section>
  );
}
