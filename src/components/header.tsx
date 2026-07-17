import { css } from "@kanabun/core";

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

export function AppHeader() {
  return (
    <header class={`app-header ${headerStyles}`}>
      <h1>⚡ Split LN Sender</h1>
      <p class="tagline">Lightning Addressへ、まとめて順番に送金</p>
    </header>
  );
}
