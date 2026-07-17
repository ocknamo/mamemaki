import { css, For, Show, signal } from "@kanabun/core";
import type { Signal } from "@kanabun/core";
import { parseCsv } from "../lib/csv";
import { isValidLightningAddress, parseAmountSats } from "../lib/validation";
import { makeRow, type Row } from "../model";
import { cardStyles, ghostBtnStyles } from "./styles";

const recipientsStyles = css`
  .row-head {
    display: grid;
    grid-template-columns: 1fr 6.2rem 2rem;
    gap: 0.4rem;
    font-size: 0.72rem;
    color: var(--muted);
    margin-bottom: 0.3rem;
    padding: 0 0.1rem;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 6.2rem 2rem;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 0.45rem;
  }
  .amt {
    text-align: right;
  }
  .icon-btn {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 1rem;
    padding: 0.4rem 0.2rem;
    cursor: pointer;
    border-radius: 8px;
  }
  .icon-btn:active {
    background: var(--bg);
  }
  .add-row {
    width: 100%;
    margin-top: 0.15rem;
    border-style: dashed;
    color: var(--muted);
  }
  .empty {
    color: var(--muted);
    font-size: 0.9rem;
    text-align: center;
    margin: 0.5rem 0;
  }
  .csv {
    margin-top: 0.75rem;
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
  }
  .csv summary {
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .csv textarea {
    margin-top: 0.5rem;
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }
  .csv-add {
    margin-top: 0.45rem;
  }
  .error-list {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
    color: var(--danger);
    font-size: 0.82rem;
  }
`;

export interface RecipientsCardProps {
  rows: Signal<Row[]>;
}

/** Recipient list editor: row add/edit/remove plus CSV paste intake. */
export function RecipientsCard({ rows }: RecipientsCardProps) {
  const csvText = signal("");
  const csvErrors = signal<string[]>([]);

  const addRow = () => rows.update((list) => [...list, makeRow()]);
  const removeRow = (row: Row) => rows.update((list) => list.filter((r) => r !== row));

  const addressInvalid = (row: Row) => {
    const v = row.address().trim();
    return v !== "" && !isValidLightningAddress(v);
  };
  const amountInvalid = (row: Row) => {
    const v = row.amount().trim();
    return v !== "" && parseAmountSats(v) === null;
  };

  function addFromCsv(text: string) {
    const { recipients, errors } = parseCsv(text);
    csvErrors.set(errors);
    if (recipients.length > 0) {
      rows.update((list) => [
        // 完全に空の行(初期行など)は取り込み時に置き換える
        ...list.filter((r) => r.address().trim() !== "" || r.amount().trim() !== ""),
        ...recipients.map((rc) => makeRow(rc.address, String(rc.amountSats))),
      ]);
    }
    if (errors.length === 0) csvText.set("");
  }

  return (
    <section class={`card ${cardStyles} ${recipientsStyles}`}>
      <h2>Recipients</h2>
      <div class="row-head">
        <span>Lightning Address</span>
        <span>Amount (sats)</span>
        <span aria-hidden="true"></span>
      </div>
      <For each={() => rows()} fallback={<p class="empty">送金先がありません</p>}>
        {(row: Row) => (
          <div class="row">
            <input
              class="addr"
              type="text"
              autocomplete="off"
              autocapitalize="none"
              spellcheck={false}
              placeholder="alice@getalby.com"
              value={() => row.address()}
              aria-invalid={() => addressInvalid(row)}
              onInput={(e: Event) => row.address.set((e.target as HTMLInputElement).value)}
            />
            <input
              class="amt"
              type="text"
              inputmode="numeric"
              placeholder="100"
              value={() => row.amount()}
              aria-invalid={() => amountInvalid(row)}
              onInput={(e: Event) => row.amount.set((e.target as HTMLInputElement).value)}
            />
            <button
              type="button"
              class="icon-btn remove"
              aria-label="行を削除"
              onClick={() => removeRow(row)}
            >
              ✕
            </button>
          </div>
        )}
      </For>
      <button type="button" class={`ghost-btn add-row ${ghostBtnStyles}`} onClick={addRow}>
        + Add Row
      </button>

      <details class="csv">
        <summary>Paste CSV</summary>
        <textarea
          rows={3}
          placeholder={"alice@getalby.com,100\nbob@coinos.io,250"}
          value={() => csvText()}
          onInput={(e: Event) => csvText.set((e.target as HTMLTextAreaElement).value)}
          onPaste={(e: ClipboardEvent) => {
            const text = e.clipboardData?.getData("text") ?? "";
            if (text.includes("@") && text.includes(",")) {
              e.preventDefault();
              addFromCsv(text);
            }
          }}
        ></textarea>
        <button
          type="button"
          class={`ghost-btn csv-add ${ghostBtnStyles}`}
          onClick={() => addFromCsv(csvText())}
        >
          Add from CSV
        </button>
        <Show when={() => csvErrors().length > 0}>
          <ul class="error-list">
            <For each={() => csvErrors()}>{(msg: string) => <li>{msg}</li>}</For>
          </ul>
        </Show>
      </details>
    </section>
  );
}
