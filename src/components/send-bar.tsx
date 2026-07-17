import { css, Show } from "@kanabun/core";
import type { Accessor } from "@kanabun/core";

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
  .cancel-btn {
    width: 100%;
    margin-top: 0.45rem;
    border: 1px solid var(--danger);
    border-radius: 12px;
    background: #fff;
    color: var(--danger);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0.55rem;
    cursor: pointer;
  }
  .cancel-btn:active {
    background: color-mix(in srgb, var(--danger) 8%, #fff);
  }
`;

export interface SendBarProps {
  count: Accessor<number>;
  totalSats: Accessor<number>;
  sending: Accessor<boolean>;
  canSend: Accessor<boolean>;
  hint: Accessor<string>;
  onSend: () => void;
  /** Stop the batch after the in-flight payment finishes. */
  onCancel: () => void;
}

/** Sticky bottom bar: recipient count, total sats, and the Send button. */
export function SendBar({ count, totalSats, sending, canSend, hint, onSend, onCancel }: SendBarProps) {
  return (
    <div class={`send-bar ${sendBarStyles}`}>
      <div class="totals">
        <span>
          Recipients: <strong>{() => count()}</strong>
        </span>
        <span>
          Total: <strong>{() => totalSats().toLocaleString("en-US")}</strong> sats
        </span>
      </div>
      <button type="button" class="send-btn" disabled={() => !canSend()} onClick={onSend}>
        {() => (sending() ? "Sending…" : "Send")}
      </button>
      <Show when={() => sending()}>
        <button type="button" class="cancel-btn" onClick={onCancel}>
          Cancel(実行中の1件は完了を待ちます)
        </button>
      </Show>
      <Show when={() => hint() !== ""}>
        <p class="send-hint">{() => hint()}</p>
      </Show>
    </div>
  );
}
