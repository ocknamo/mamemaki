import { computed, css, For, Show } from "@kanabun/core";
import type { Accessor } from "@kanabun/core";
import type { Row, RowStatus } from "../model";
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
  .result-summary {
    margin: 0.6rem 0 0;
    font-size: 0.9rem;
    font-weight: 600;
  }
`;

const STATUS_ICON: Record<RowStatus, string> = {
  idle: "",
  pending: "•",
  resolving: "…",
  paying: "…",
  success: "✓",
  failed: "✗",
};

const STATUS_LABEL: Record<RowStatus, string> = {
  idle: "",
  pending: "waiting",
  resolving: "resolving…",
  paying: "paying…",
  success: "Success",
  failed: "Failed",
};

export interface ProgressCardProps {
  rows: Accessor<Row[]>;
  phase: Accessor<"idle" | "sending" | "done">;
  doneCount: Accessor<number>;
}

/** Per-recipient send progress and, once done, the result summary. */
export function ProgressCard({ rows, phase, doneCount }: ProgressCardProps) {
  const successCount = computed(() => rows().filter((r) => r.status() === "success").length);
  const failedCount = computed(() => rows().filter((r) => r.status() === "failed").length);

  return (
    <section class={`card progress-card ${cardStyles} ${progressStyles}`}>
      <h2>{() => (phase() === "sending" ? "Sending…" : "Results")}</h2>
      <p class="progress-count">
        {() => doneCount()} / {() => rows().length}
      </p>
      <ul class="progress-list">
        <For each={() => rows()}>
          {(row: Row) => (
            <li class={() => `st-${row.status()}`}>
              <span class="st-icon">{() => STATUS_ICON[row.status()]}</span>
              <span class="st-who">{() => row.address()}</span>
              <span class="st-res">
                {() => (row.status() === "failed" ? row.error() : STATUS_LABEL[row.status()])}
              </span>
            </li>
          )}
        </For>
      </ul>
      <Show when={() => phase() === "done"}>
        <p class="result-summary">
          Success: {() => successCount()} / Failed: {() => failedCount()}
        </p>
      </Show>
    </section>
  );
}
