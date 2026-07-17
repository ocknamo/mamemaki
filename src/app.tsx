import { signal, computed, css, For, Show } from "@kanabun/core";
import type { Signal } from "@kanabun/core";
import { parseCsv } from "./lib/csv";
import { NwcClient, parseNwcUri } from "./lib/nwc";
import { sendAll } from "./lib/sender";
import type { SendStatus } from "./lib/types";
import { isValidLightningAddress, parseAmountSats } from "./lib/validation";

const NWC_STORAGE_KEY = "split-ln-sender.nwc-uri";

// ── Scoped styles (kanabun css``) ─────────────────────────────────
// Design tokens (--bg, --accent, …) and the body/reset base live in
// index.html; everything component-shaped is scoped here.

const shellStyles = css`
  max-width: 30rem;
  margin: 0 auto;
  padding: 1rem 0.9rem 0;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;

  input,
  textarea {
    width: 100%;
    font: inherit;
    font-size: 16px; /* prevent iOS zoom-on-focus */
    color: inherit;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 0.55rem 0.6rem;
    box-sizing: border-box;
  }
  input:focus,
  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
  }
  input[aria-invalid] {
    border-color: var(--danger);
  }
  input:disabled {
    background: var(--bg);
    color: var(--muted);
  }
  @media (min-width: 40rem) {
    padding-top: 2rem;
  }
`;

const headerStyles = css`
  padding: 0.25rem 0.2rem 0.75rem;
  h1 {
    margin: 0;
    font-size: 1.45rem;
    letter-spacing: -0.01em;
  }
  .tagline {
    margin: 0.15rem 0 0;
    color: var(--muted);
    font-size: 0.85rem;
  }
`;

const cardStyles = css`
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 0.9rem;
  margin-bottom: 0.75rem;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.05);
  h2 {
    margin: 0 0 0.6rem;
    font-size: 1rem;
    letter-spacing: 0.01em;
  }
`;

const ghostBtnStyles = css`
  display: inline-block;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  font: inherit;
  font-size: 0.9rem;
  border-radius: 9px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  &:active {
    background: var(--bg);
  }
  &:disabled {
    color: var(--muted);
    cursor: default;
    opacity: 0.6;
  }
`;

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

const nwcStyles = css`
  .nwc-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.55rem;
  }
  .nwc-status {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .nwc-status.connected {
    color: var(--success);
    font-weight: 600;
  }
  .error-text {
    margin: 0.5rem 0 0;
    color: var(--danger);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
`;

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

const sendBarStyles = css`
  position: sticky;
  bottom: 0;
  margin-top: auto;
  background: linear-gradient(to top, var(--bg) 75%, transparent);
  padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom));
  .totals {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
    color: var(--muted);
    padding: 0 0.2rem 0.5rem;
  }
  .totals strong {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .send-btn {
    width: 100%;
    border: none;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-size: 1.05rem;
    font-weight: 700;
    padding: 0.8rem;
    cursor: pointer;
    box-shadow: 0 2px 8px rgb(247 147 26 / 0.35);
  }
  .send-btn:active {
    background: var(--accent-dark);
  }
  .send-btn:disabled {
    background: #c7cbd1;
    box-shadow: none;
    cursor: default;
  }
  .send-hint {
    margin: 0.4rem 0 0;
    text-align: center;
    font-size: 0.8rem;
    color: var(--muted);
  }
`;

type RowStatus = "idle" | SendStatus;

interface Row {
  id: number;
  address: Signal<string>;
  amount: Signal<string>;
  status: Signal<RowStatus>;
  error: Signal<string>;
}

let nextRowId = 1;
function makeRow(address = "", amount = ""): Row {
  return {
    id: nextRowId++,
    address: signal(address),
    amount: signal(amount),
    status: signal<RowStatus>("idle"),
    error: signal(""),
  };
}

const storage = {
  get(key: string): string {
    try {
      return globalThis.localStorage?.getItem(key) ?? "";
    } catch {
      return "";
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private mode などで保存できなくても動作は継続する */
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

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

export function App() {
  const rows = signal<Row[]>([makeRow()]);
  const csvText = signal("");
  const csvErrors = signal<string[]>([]);

  const nwcUri = signal(storage.get(NWC_STORAGE_KEY));
  const nwcStatus = signal<"disconnected" | "connecting" | "connected">("disconnected");
  const nwcError = signal("");
  let client: NwcClient | null = null;

  const phase = signal<"idle" | "sending" | "done">("idle");
  const doneCount = signal(0);

  const total = computed(() =>
    rows().reduce((sum, r) => sum + (parseAmountSats(r.amount()) ?? 0), 0),
  );
  const allValid = computed(
    () =>
      rows().length > 0 &&
      rows().every(
        (r) =>
          isValidLightningAddress(r.address().trim()) && parseAmountSats(r.amount()) !== null,
      ),
  );
  const successCount = computed(() => rows().filter((r) => r.status() === "success").length);
  const failedCount = computed(() => rows().filter((r) => r.status() === "failed").length);
  const canSend = computed(
    () => phase() !== "sending" && nwcStatus() === "connected" && allValid(),
  );
  const sendHint = computed(() => {
    if (phase() === "sending") return "";
    if (!allValid()) return "有効な送金先を1件以上入力してください";
    if (nwcStatus() !== "connected") return "NWCウォレットを接続してください";
    return "";
  });

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

  async function connectNwc() {
    nwcError.set("");
    let conn;
    try {
      conn = parseNwcUri(nwcUri());
    } catch (e) {
      nwcError.set(e instanceof Error ? e.message : String(e));
      return;
    }
    nwcStatus.set("connecting");
    const next = new NwcClient(conn);
    try {
      await next.connect();
      client?.close();
      client = next;
      storage.set(NWC_STORAGE_KEY, nwcUri().trim());
      nwcStatus.set("connected");
    } catch (e) {
      next.close();
      nwcStatus.set("disconnected");
      nwcError.set(e instanceof Error ? e.message : String(e));
    }
  }

  function disconnectNwc() {
    client?.close();
    client = null;
    nwcStatus.set("disconnected");
    storage.remove(NWC_STORAGE_KEY);
  }

  async function send() {
    const c = client;
    if (!c || !canSend()) return;
    const list = rows();
    const recipients = list.map((r) => ({
      address: r.address().trim(),
      amountSats: parseAmountSats(r.amount())!,
    }));
    phase.set("sending");
    doneCount.set(0);
    for (const r of list) {
      r.status.set("pending");
      r.error.set("");
    }
    await sendAll(recipients, c, (i, update) => {
      list[i].status.set(update.status);
      list[i].error.set(update.error ?? "");
      if (update.status === "success" || update.status === "failed") {
        doneCount.update((n) => n + 1);
      }
    });
    phase.set("done");
  }

  return (
    <main class={`app ${shellStyles}`}>
      <header class={`app-header ${headerStyles}`}>
        <h1>⚡ Split LN Sender</h1>
        <p class="tagline">Lightning Addressへ、まとめて順番に送金</p>
      </header>

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

      <section class={`card ${cardStyles} ${nwcStyles}`}>
        <h2>NWC</h2>
        <input
          class="nwc-uri"
          type="password"
          autocomplete="off"
          placeholder="nostr+walletconnect://..."
          value={() => nwcUri()}
          disabled={() => nwcStatus() === "connected"}
          onInput={(e: Event) => nwcUri.set((e.target as HTMLInputElement).value)}
        />
        <div class="nwc-actions">
          <Show
            when={() => nwcStatus() !== "connected"}
            fallback={
              <button
                type="button"
                class={`ghost-btn disconnect ${ghostBtnStyles}`}
                onClick={disconnectNwc}
              >
                Disconnect
              </button>
            }
          >
            <button
              type="button"
              class={`ghost-btn connect ${ghostBtnStyles}`}
              disabled={() => nwcStatus() === "connecting" || nwcUri().trim() === ""}
              onClick={() => void connectNwc()}
            >
              {() => (nwcStatus() === "connecting" ? "Connecting…" : "Connect")}
            </button>
          </Show>
          <span class={() => `nwc-status ${nwcStatus()}`}>
            {() => (nwcStatus() === "connected" ? "接続済み" : nwcStatus() === "connecting" ? "接続中…" : "未接続")}
          </span>
        </div>
        <Show when={() => nwcError() !== ""}>
          <p class="error-text">{() => nwcError()}</p>
        </Show>
      </section>

      <Show when={() => phase() !== "idle"}>
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
      </Show>

      <div class={`send-bar ${sendBarStyles}`}>
        <div class="totals">
          <span>
            Recipients: <strong>{() => rows().length}</strong>
          </span>
          <span>
            Total: <strong>{() => total().toLocaleString("en-US")}</strong> sats
          </span>
        </div>
        <button type="button" class="send-btn" disabled={() => !canSend()} onClick={() => void send()}>
          {() => (phase() === "sending" ? "Sending…" : "Send")}
        </button>
        <Show when={() => sendHint() !== ""}>
          <p class="send-hint">{() => sendHint()}</p>
        </Show>
      </div>
    </main>
  );
}
