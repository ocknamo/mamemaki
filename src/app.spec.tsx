import { test, expect } from "bun:test";
import { renderTest, queryByTag, fireEvent } from "@kanabun/testing";
import { App } from "./app";

test("clicking counts up", () => {
  const { html, container, dispose } = renderTest(() => <App />);
  expect(html()).toContain("count is 0");
  fireEvent.click(queryByTag(container, "button")!);
  expect(html()).toContain("count is 1");
  dispose();
});
