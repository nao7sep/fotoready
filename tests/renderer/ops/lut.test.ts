// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LutCard } from "@renderer/ops/lut";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const log = vi.fn(async () => undefined);

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  log.mockClear();
  vi.stubGlobal("api", { system: { log } });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("LutCard chooser reload", () => {
  it("keeps the chooser closed and owns a hostile reload rejection", async () => {
    const reloadLuts = vi.fn(async () => {
      throw new Error("Error invoking remote method: EACCES /private/tmp/FOTOREADY_LUT_SENTINEL");
    });
    await act(async () => {
      root.render(createElement(LutCard, {
        ctx: cardContext({ reloadLuts }),
        disabled: false,
        onParamChange: () => undefined,
        onParamsChange: () => undefined,
        params: { cubePath: "/current/current.cube", strength: 0.5 }
      }));
    });

    await act(async () => chooseButton("Choose LUT...").click());

    const result = document.querySelector('[role="alert"]');
    expect(reloadLuts).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(result?.textContent).toContain("The chooser remains closed");
    expect(result?.textContent).not.toMatch(/EACCES|private\/tmp|FOTOREADY_LUT_SENTINEL|invoking remote method/i);
    expect(result?.querySelectorAll("svg")).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      message: "LUT library refresh before chooser failed"
    }));
  });
});

function cardContext(overrides: { reloadLuts(): Promise<void> }) {
  return {
    activeTaskId: "task-1",
    assetPickerPreviewLongEdge: 128,
    luts: [],
    opId: "op-1",
    stamps: [],
    originalMetadataSummary: null,
    originalSize: { width: 1000, height: 800 },
    ...overrides
  };
}

function chooseButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeDefined();
  return button!;
}
