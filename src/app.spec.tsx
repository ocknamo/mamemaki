import { describe, expect, test } from "bun:test";
import {
  fireEvent,
  getByClass,
  getByTag,
  queryAllByClass,
  renderTest,
  setValue,
} from "@kanabun/testing";
import type { MockNode } from "@kanabun/testing";
import { signal } from "@kanabun/core";
import { App } from "./app";
import { RecipientsCard } from "./components/recipients-card";
import { makeRow } from "./model";

function type(input: MockNode, value: string) {
  setValue(input, value);
  fireEvent(input, "input");
}

describe("App", () => {
  test("renders one empty row, totals, and a disabled Send", () => {
    const { html, container, dispose } = renderTest(() => <App />);
    expect(html()).toContain("Split LN Sender");
    expect(queryAllByClass(container, "row")).toHaveLength(1);
    expect(html()).toContain("Recipients: <strong>1</strong>");
    expect(html()).toContain("Total: <strong>0</strong>");
    // not connected + empty row → Send stays disabled with a hint
    expect(getByClass(container, "send-btn").hasAttribute("disabled")).toBe(true);
    expect(html()).toContain("有効な送金先を1件以上入力してください");
    dispose();
  });

  test("component styles are attached as scoped css`` classes", () => {
    const { container, dispose } = renderTest(() => <App />);
    // every styled block carries a k-<hash> class from @kanabun/core's css``
    for (const cls of ["app", "app-header", "send-bar", "add-row"]) {
      expect(getByClass(container, cls).getAttribute("class")).toMatch(/\bk-[a-z0-9]+\b/);
    }
    for (const card of queryAllByClass(container, "card")) {
      expect(card.getAttribute("class")).toMatch(/\bk-[a-z0-9]+\b/);
    }
    dispose();
  });

  test("add/remove rows", () => {
    const { container, dispose } = renderTest(() => <App />);
    fireEvent.click(getByClass(container, "add-row"));
    fireEvent.click(getByClass(container, "add-row"));
    expect(queryAllByClass(container, "row")).toHaveLength(3);
    fireEvent.click(queryAllByClass(container, "remove")[0]);
    expect(queryAllByClass(container, "row")).toHaveLength(2);
    dispose();
  });

  test("typing an address and amount updates the total", () => {
    const { html, container, dispose } = renderTest(() => <App />);
    type(getByClass(container, "addr"), "alice@getalby.com");
    type(getByClass(container, "amt"), "100");
    fireEvent.click(getByClass(container, "add-row"));
    type(queryAllByClass(container, "amt")[1], "250");
    expect(html()).toContain("Total: <strong>350</strong>");
    dispose();
  });

  test("invalid inputs are flagged with aria-invalid", () => {
    const { container, dispose } = renderTest(() => <App />);
    const addr = getByClass(container, "addr");
    type(addr, "not-an-address");
    expect(addr.hasAttribute("aria-invalid")).toBe(true);
    type(addr, "alice@getalby.com");
    expect(addr.hasAttribute("aria-invalid")).toBe(false);
    dispose();
  });

  test("CSV add replaces the empty starter row and appends recipients", () => {
    const { html, container, dispose } = renderTest(() => <App />);
    const textarea = getByTag(getByClass(container, "csv"), "textarea");
    type(textarea, "alice@getalby.com,100\nbob@coinos.io,250");
    fireEvent.click(getByClass(container, "csv-add"));
    expect(queryAllByClass(container, "row")).toHaveLength(2);
    expect(html()).toContain("Recipients: <strong>2</strong>");
    expect(html()).toContain("Total: <strong>350</strong>");
    dispose();
  });

  test("CSV errors are listed and bad lines are not added", () => {
    const { html, container, dispose } = renderTest(() => <App />);
    const textarea = getByTag(getByClass(container, "csv"), "textarea");
    type(textarea, "alice@getalby.com,100\nbroken-line");
    fireEvent.click(getByClass(container, "csv-add"));
    expect(queryAllByClass(container, "row")).toHaveLength(1);
    expect(html()).toContain("2行目");
    dispose();
  });

  test("the whole editor locks while a batch is sending", () => {
    const rows = signal([makeRow("alice@getalby.com", "100")]);
    const { container, dispose } = renderTest(() => (
      <RecipientsCard rows={rows} sending={() => true} />
    ));
    for (const cls of ["addr", "amt", "remove", "add-row", "csv-add"]) {
      expect(getByClass(container, cls).hasAttribute("disabled")).toBe(true);
    }
    dispose();
  });

  test("an invalid NWC URI shows an error and stays disconnected", () => {
    const { html, container, dispose } = renderTest(() => <App />);
    type(getByClass(container, "nwc-uri"), "not-a-nwc-uri");
    fireEvent.click(getByClass(container, "connect"));
    expect(html()).toContain("nostr+walletconnect://");
    expect(getByClass(container, "nwc-status").textContent).toContain("未接続");
    dispose();
  });
});
