// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useListbox } from "@renderer/components/useListbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function renderHarness(ids: string[]): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(Harness, { ids })));
}

function Harness({ ids }: { ids: string[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(ids[0] ?? null);
  const { listboxProps, getOptionProps } = useListbox({
    ids,
    selectedId,
    onSelect: setSelectedId,
  });
  return createElement(
    "div",
    { "aria-label": "Items", ...listboxProps },
    ids.map((id) => createElement("button", { key: id, ...getOptionProps(id) }, id)),
  );
}

describe("useListbox", () => {
  it("moves by a viewport with PageDown while retaining one tab stop", async () => {
    await renderHarness(Array.from({ length: 12 }, (_, index) => `item-${index + 1}`));
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const first = document.querySelector<HTMLElement>('[data-listbox-option="item-1"]')!;
    first.focus();
    await act(async () => {
      listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    });

    expect(document.activeElement).toBe(document.querySelector('[data-listbox-option="item-9"]'));
    expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].filter((option) => option.tabIndex === 0)).toHaveLength(1);
  });

  it("keeps an empty listbox reachable", async () => {
    await renderHarness([]);
    expect(document.querySelector<HTMLElement>('[role="listbox"]')?.tabIndex).toBe(0);
  });
});
