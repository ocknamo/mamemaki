import { signal, computed, For, Show } from "@kanabun/core";
import type { Signal } from "@kanabun/core";
import { parseCsv } from "./lib/csv";
import { NwcClient, parseNwcUri } from "./lib/nwc";
import { sendAll } from "./lib/sender";
import type { SendStatus } from "./lib/types";
import { isValidLightningAddress, parseAmountSats } from "./lib/validation";

const NWC_STORAGE_KEY = "split-ln-sender.nwc-uri";

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
    <main class="app">
      <header class="app-header">
        <h1>⚡ Split LN Sender</h1>
        <p class="tagline">Lightning Addressへ、まとめて順番に送金</p>
      </header>

      <section class="card">
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
        <button type="button" class="ghost-btn add-row" onClick={addRow}>
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
          <button type="button" class="ghost-btn csv-add" onClick={() => addFromCsv(csvText())}>
            Add from CSV
          </button>
          <Show when={() => csvErrors().length > 0}>
            <ul class="error-list">
              <For each={() => csvErrors()}>{(msg: string) => <li>{msg}</li>}</For>
            </ul>
          </Show>
        </details>
      </section>

      <section class="card">
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
              <button type="button" class="ghost-btn disconnect" onClick={disconnectNwc}>
                Disconnect
              </button>
            }
          >
            <button
              type="button"
              class="ghost-btn connect"
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
        <section class="card progress-card">
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

      <div class="send-bar">
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
