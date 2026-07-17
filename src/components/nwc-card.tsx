import { css, Show } from "@kanabun/core";
import type { Accessor, Signal } from "@kanabun/core";
import { cardStyles, ghostBtnStyles } from "./styles";

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

export type NwcStatus = "disconnected" | "connecting" | "connected";

export interface NwcCardProps {
  uri: Signal<string>;
  status: Accessor<NwcStatus>;
  error: Accessor<string>;
  onConnect: () => void;
  onDisconnect: () => void;
}

/** NWC connection URI input + connect/disconnect controls. */
export function NwcCard({ uri, status, error, onConnect, onDisconnect }: NwcCardProps) {
  return (
    <section class={`card ${cardStyles} ${nwcStyles}`}>
      <h2>NWC</h2>
      <input
        class="nwc-uri"
        type="password"
        autocomplete="off"
        placeholder="nostr+walletconnect://..."
        value={() => uri()}
        disabled={() => status() === "connected"}
        onInput={(e: Event) => uri.set((e.target as HTMLInputElement).value)}
      />
      <div class="nwc-actions">
        <Show
          when={() => status() !== "connected"}
          fallback={
            <button
              type="button"
              class={`ghost-btn disconnect ${ghostBtnStyles}`}
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          }
        >
          <button
            type="button"
            class={`ghost-btn connect ${ghostBtnStyles}`}
            disabled={() => status() === "connecting" || uri().trim() === ""}
            onClick={onConnect}
          >
            {() => (status() === "connecting" ? "Connecting…" : "Connect")}
          </button>
        </Show>
        <span class={() => `nwc-status ${status()}`}>
          {() => (status() === "connected" ? "接続済み" : status() === "connecting" ? "接続中…" : "未接続")}
        </span>
      </div>
      <Show when={() => error() !== ""}>
        <p class="error-text">{() => error()}</p>
      </Show>
    </section>
  );
}
