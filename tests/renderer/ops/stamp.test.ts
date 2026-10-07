// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetOverlayParams } from "@shared/asset-overlay";
import { StampSourceAction } from "@renderer/ops/stamp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const picker = vi.hoisted(() => ({ onUse: null as null | ((path: string) => Promise<void>), normalize: vi.fn() }));
vi.mock("@renderer/components/modals/asset-picker-modal", () => ({ StampPickerModal: (props: { onUse(path: string): Promise<void> }) => { picker.onUse = props.onUse; return null; } }));
vi.mock("@renderer/ops/_asset-overlay", async (load) => ({ ...await load<typeof import("@renderer/ops/_asset-overlay")>(), normalizeAssetOverlayForPath: picker.normalize }));

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
  it("rejects an aspect result after the captured task params changed", async () => {
    let finish!: (patch: Partial<AssetOverlayParams>) => void;
    picker.normalize.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const onParamsChange = vi.fn(async () => undefined);
    const ctx = cardContext({ reloadStamps: async () => undefined });
    const params = overlayParams();
    const render = (value: AssetOverlayParams) => root.render(createElement(StampSourceAction, { ctx, params: value, disabled: false, onParamsChange, onParamChange: () => undefined }));
    await act(async () => render(params));
    await act(async () => chooseButton("Choose stamp…").click());
    const choosing = picker.onUse!("/next.png");
    await act(async () => render({ ...params, x: 0.25 }));
    finish({ ...params, assetPath: "/next.png" });
    await expect(choosing).rejects.toThrow("task changed");
    expect(onParamsChange).not.toHaveBeenCalled();
  });

  it("carries the immutable params basis and awaits the actual mutation promise", async () => {
    let finish!: () => void;
    picker.normalize.mockResolvedValueOnce({ assetPath: "/next.png" });
    const onParamsChange = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const params = overlayParams();
    await act(async () => root.render(createElement(StampSourceAction, { ctx: cardContext({ reloadStamps: async () => undefined }), params, disabled: false, onParamsChange, onParamChange: () => undefined })));
    await act(async () => chooseButton("Choose stamp…").click());
    let settled = false;
    const choosing = picker.onUse!("/next.png").then(() => { settled = true; });
    await Promise.resolve();
    expect(onParamsChange).toHaveBeenCalledWith({ assetPath: "/next.png" }, { expectedParams: params });
    expect(settled).toBe(false);
    finish();
    await choosing;
    expect(settled).toBe(true);
  });

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

    await act(async () => chooseButton("Choose stamp…").click());

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
