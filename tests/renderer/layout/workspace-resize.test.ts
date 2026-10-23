// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceLayout } from "@renderer/layout/workspace-layout";
import { PANE_DEFAULTS, PANE_MAXES, PANE_MINS, computeMinWindowWidth, type WorkspacePaneKey } from "@shared/layout/workspace-metrics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let containerWidth: number;
const persist = vi.fn();

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  containerWidth = 4000;
  persist.mockReset();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: containerWidth }) as DOMRect);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

function Harness(): React.JSX.Element {
  const layout = useWorkspaceLayout({ showOps: true, showOriginals: true, showTasks: true, widths: PANE_DEFAULTS, onWidthsChange: persist });
  return createElement("div", { className: "workspace", style: { gridTemplateColumns: layout.gridTemplateColumns } },
    ...(["originals", "tasks", "ops"] as const).map((pane) => createElement("button", {
      key: pane, "data-pane": pane, ...layout.splitterControls(pane), onPointerDown: layout.startResize(pane)
    })));
}

async function render(): Promise<void> {
  await act(async () => root.render(createElement(Harness)));
}

function splitter(pane: WorkspacePaneKey): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-pane="${pane}"]`)!;
}

async function key(pane: WorkspacePaneKey, type: "keydown" | "keyup", value: string): Promise<void> {
  await act(async () => splitter(pane).dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true })));
}

function shown(pane: WorkspacePaneKey): number {
  return Number(splitter(pane).getAttribute("aria-valuenow"));
}

describe("workspace resize gestures", () => {
  it.each(["originals", "tasks", "ops"] as const)("matches a rightward pointer drag with an ArrowRight press for %s", async (pane) => {
    await render();
    await key(pane, "keydown", "ArrowRight");
    const keyboardWidth = shown(pane);
    expect(keyboardWidth).toBe(PANE_DEFAULTS[pane] + (pane === "ops" ? -16 : 16));
    expect(persist).not.toHaveBeenCalled();
    await key(pane, "keyup", "ArrowRight");
    expect(persist).toHaveBeenCalledExactlyOnceWith({ ...PANE_DEFAULTS, [pane]: keyboardWidth });

    await act(async () => root.unmount());
    root = createRoot(document.querySelector("#root")!);
    persist.mockClear();
    await render();
    await act(async () => splitter(pane).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 })));
    await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 116 })));
    expect(shown(pane)).toBe(keyboardWidth);
    expect(persist).toHaveBeenLastCalledWith({ ...PANE_DEFAULTS, [pane]: keyboardWidth });
    await act(async () => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(document.body.classList.contains("is-resizing-workspace")).toBe(false);
    expect(splitter(pane).classList.contains("is-resizing")).toBe(false);
  });

  it("shows repeated arrow presses immediately and saves once on keyup or blur", async () => {
    await render();
    await act(async () => splitter("tasks").focus());
    // A held key can deliver several repeats before React paints.
    await act(async () => {
      for (let i = 0; i < 3; i += 1) splitter("tasks").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(shown("tasks")).toBe(PANE_DEFAULTS.tasks + 48);
    expect(document.querySelector<HTMLElement>(".workspace")!.style.gridTemplateColumns).toContain("248px");
    expect(persist).not.toHaveBeenCalled();
    await key("tasks", "keyup", "ArrowRight");
    await act(async () => splitter("tasks").blur());
    expect(persist).toHaveBeenCalledTimes(1);

    await act(async () => splitter("tasks").focus());
    await key("tasks", "keydown", "ArrowLeft");
    await act(async () => splitter("tasks").blur());
    expect(shown("tasks")).toBe(PANE_DEFAULTS.tasks + 32);
    expect(persist).toHaveBeenCalledTimes(2);
    await key("tasks", "keyup", "ArrowLeft");
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it.each(["originals", "tasks", "ops"] as const)("uses Home and End at the supported bounds for %s", async (pane) => {
    await render();
    await key(pane, "keydown", "End");
    expect(shown(pane)).toBe(PANE_MAXES[pane]);
    expect(splitter(pane).getAttribute("aria-valuemax")).toBe(String(PANE_MAXES[pane]));
    await key(pane, "keyup", "End");
    await key(pane, "keydown", "Home");
    expect(shown(pane)).toBe(PANE_MINS[pane]);
    expect(splitter(pane).getAttribute("aria-valuemin")).toBe(String(PANE_MINS[pane]));
    await key(pane, "keyup", "Home");
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("updates bounds after a window shrink and never persists a window resize or unrelated key", async () => {
    await render();
    containerWidth = computeMinWindowWidth();
    await act(async () => window.dispatchEvent(new Event("resize")));
    for (const pane of ["originals", "tasks", "ops"] as const) {
      expect(shown(pane)).toBe(PANE_MINS[pane]);
      expect(splitter(pane).getAttribute("aria-valuemax")).toBe(String(PANE_MINS[pane]));
    }
    await key("ops", "keydown", "Tab");
    await key("ops", "keyup", "Tab");
    expect(persist).not.toHaveBeenCalled();
    await key("ops", "keydown", "End");
    await key("ops", "keyup", "End");
    expect(persist).toHaveBeenCalledExactlyOnceWith({ ...PANE_DEFAULTS, ops: PANE_MINS.ops });
    expect(shown("ops")).toBe(PANE_MINS.ops);
  });
});
