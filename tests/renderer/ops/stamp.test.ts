// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { StampSourceAction } from "@renderer/ops/stamp";

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

describe("StampSourceAction chooser reload", () => {
  it("keeps the chooser closed and owns a hostile reload rejection", async () => {
    const reloadStamps = vi.fn(async () => {
      throw new Error("Error invoking remote method: EACCES /private/tmp/FOTOREADY_STAMP_SENTINEL");
    });
    await act(async () => {
      root.render(createElement(StampSourceAction, {
        ctx: cardContext({ reloadStamps }),
        disabled: false,
        onParamChange: () => undefined,
        onParamsChange: () => undefined,
        params: overlayParams()
      }));
    });

    await act(async () => chooseButton("Choose stamp...").click());

    const result = document.querySelector('[role="alert"]');
    expect(reloadStamps).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(result?.textContent).toContain("The chooser remains closed");
    expect(result?.textContent).not.toMatch(/EACCES|private\/tmp|FOTOREADY_STAMP_SENTINEL|invoking remote method/i);
    expect(result?.querySelectorAll("svg")).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      message: "stamp library refresh before chooser failed"
    }));
  });
});

function cardContext(overrides: { reloadStamps(): Promise<void> }) {
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

function overlayParams(): AssetOverlayParams {
  return {
    assetPath: "/current/stamp.png",
    x: 0,
    y: 0,
    width: 0.2,
    height: 0.2,
    lockAspectRatio: true,
    flipHorizontal: false,
    flipVertical: false,
    opacity: 1,
    rotation: 0
  };
}

function chooseButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === label);
  expect(button).toBeDefined();
  return button!;
}
