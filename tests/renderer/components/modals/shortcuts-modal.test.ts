// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShortcutsModal, balancedSplit } from "@renderer/components/modals/shortcuts-modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("balancedSplit", () => {
  it("divides where the heavier column is lightest", () => {
    expect(balancedSplit([1, 1])).toBe(1);
    expect(balancedSplit([5, 1, 1, 1])).toBe(1); // 5 | 3 beats 6 | 2
    expect(balancedSplit([369, 164, 107, 676, 502, 92])).toBe(3); // 640 | 1270 beats 1316 | 594
  });

  it("puts a lone section, or none, in the first column", () => {
    expect(balancedSplit([3])).toBe(0);
    expect(balancedSplit([])).toBe(0);
  });
});

describe("ShortcutsModal", () => {
  it("lays the sections out in two columns, in order and each exactly once", () => {
    act(() => {
      root.render(createElement(ShortcutsModal, { systemInfo: null, onClose: () => {} }));
    });

    const columns = Array.from(document.querySelectorAll(".shortcut-column"));
    expect(columns).toHaveLength(2);

    const titles = columns.map((column) =>
      Array.from(column.querySelectorAll("section.shortcut-group > h3")).map((h) => h.textContent)
    );
    // Every section lands once, and the reading order is down the first column, then the
    // second. App sits before the navigation groups on purpose: the columns then divide by
    // kind, commands on the left and moving around on the right, and they come out close in
    // height rather than one being half the other.
    expect(titles.flat()).toEqual([
      "Import and save",
      "Editing",
      "View",
      "App",
      "Lists and controls",
      "Asset picker (LUTs and stamps)"
    ]);
    expect(titles[0], "the commands, App included, share the first column").toEqual([
      "Import and save",
      "Editing",
      "View",
      "App"
    ]);
    expect(titles[0].length).toBeGreaterThan(0);
    expect(titles[1].length).toBeGreaterThan(0);
  });

  it("uses the wide surface, because its rows carry a sentence each", () => {
    act(() => {
      root.render(createElement(ShortcutsModal, { systemInfo: null, onClose: () => {} }));
    });

    expect(document.querySelector(".modal")?.className).toContain("modal-wide");
  });
});
