// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuItem } from "@renderer/components/Menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const LABELS = ["Settings", "Records", "Keyboard shortcuts", "About"];

describe("Menu", () => {
  // composite-control-conventions: the keyboard target is the item the user highlighted with the
  // keys, so moving the pointer over an earlier item never retargets the next arrow or Enter.
  it("keeps the keyboard target when the pointer passes over another item", async () => {
    const selected = vi.fn<(label: string) => void>();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(Menu, {
      open: true,
      onOpenChange: () => {},
      label: "Main menu",
      trigger: (props) => createElement("button", props, "Menu"),
      children: LABELS.map((label) => createElement(MenuItem, { key: label, onSelect: () => selected(label), children: label }))
    })));
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    // Opening focuses the first item on the next frame.
    await new Promise<void>((resolve) => {
      if (document.activeElement === items[0]) resolve();
      else items[0]!.addEventListener("focus", () => resolve(), { once: true });
    });
    const press = async (key: string): Promise<void> => {
      await act(async () => {
        menu.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    };

    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowDown");
    expect(document.activeElement).toBe(items[3]);

    await act(async () => {
      for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
        items[1]!.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
    });
    expect(document.activeElement).toBe(items[3]);

    await press("ArrowUp");
    expect(document.activeElement).toBe(items[2]);
    // Enter activates the focused menuitem natively; the target is the keyboard's, not the pointer's.
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(selected).toHaveBeenCalledWith("Keyboard shortcuts");
  });
});
