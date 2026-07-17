/** Scoped styles shared across components (design tokens live in index.html). */
import { css } from "@kanabun/core";

export const cardStyles = css`
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

export const ghostBtnStyles = css`
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
