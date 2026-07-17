import { signal, computed, css, Show } from "@kanabun/core";
import { AppHeader } from "./components/header";
import { NwcCard, type NwcStatus } from "./components/nwc-card";
import { ProgressCard } from "./components/progress-card";
import { RecipientsCard } from "./components/recipients-card";
import { SendBar } from "./components/send-bar";
import { storage } from "./lib/storage";
import { NwcClient, parseNwcUri } from "./lib/nwc";
import { sendAll } from "./lib/sender";
import { isValidLightningAddress, parseAmountSats } from "./lib/validation";
import { isTerminal, makeProgressEntries, makeRow, type ProgressEntry, type Row } from "./model";

const NWC_STORAGE_KEY = "split-ln-sender.nwc-uri";

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
  input:disabled,
  textarea:disabled {
    background: var(--bg);
    color: var(--muted);
  }
  @media (min-width: 40rem) {
    padding-top: 2rem;
  }
`;

export function App() {
  const rows = signal<Row[]>([makeRow()]);

  const nwcUri = signal(storage.get(NWC_STORAGE_KEY));
  const nwcStatus = signal<NwcStatus>("disconnected");
  const nwcError = signal("");
  let client: NwcClient | null = null;

  const phase = signal<"idle" | "sending" | "done">("idle");
  const progress = signal<ProgressEntry[]>([]);
  let abortCtrl: AbortController | null = null;

  const sending = computed(() => phase() === "sending");
  const doneCount = computed(() => progress().filter((e) => isTerminal(e.status())).length);

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
  const canSend = computed(() => !sending() && nwcStatus() === "connected" && allValid());
  const sendHint = computed(() => {
    if (sending()) return "";
    if (!allValid()) return "有効な送金先を1件以上入力してください";
    if (nwcStatus() !== "connected") return "NWCウォレットを接続してください";
    return "";
  });

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
      // "Connected" must mean more than an open socket: fetch the wallet's
      // info event to prove the pubkey is live here and supports what we need.
      const info = await next.getInfo();
      if (!info.methods.includes("pay_invoice")) {
        throw new Error("このウォレットは pay_invoice に対応していません");
      }
      if (info.encryptions && !info.encryptions.some((e) => e.startsWith("nip04"))) {
        throw new Error("このウォレットは NIP-04 暗号化に対応していません");
      }
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
    const recipients = rows().map((r) => ({
      address: r.address().trim(),
      amountSats: parseAmountSats(r.amount())!,
    }));
    const entries = makeProgressEntries(recipients);
    progress.set(entries);
    phase.set("sending");
    abortCtrl = new AbortController();
    await sendAll(
      recipients,
      c,
      (i, update) => {
        entries[i].status.set(update.status);
        entries[i].error.set(update.error ?? "");
      },
      { signal: abortCtrl.signal },
    );
    abortCtrl = null;
    phase.set("done");
  }

  function cancelSend() {
    abortCtrl?.abort();
  }

  return (
    <main class={`app ${shellStyles}`}>
      <AppHeader />
      <RecipientsCard rows={rows} sending={sending} />
      <NwcCard
        uri={nwcUri}
        status={nwcStatus}
        error={nwcError}
        onConnect={() => void connectNwc()}
        onDisconnect={disconnectNwc}
      />
      <Show when={() => phase() !== "idle"}>
        <ProgressCard entries={progress} phase={phase} doneCount={doneCount} />
      </Show>
      <SendBar
        count={() => rows().length}
        totalSats={total}
        sending={sending}
        canSend={canSend}
        hint={sendHint}
        onSend={() => void send()}
        onCancel={cancelSend}
      />
    </main>
  );
}
