// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsPanel } from "@renderer/components/panels/ops-panel";
import type { Task } from "@shared/types/project";
import type { OpInstance } from "@shared/types/op";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
});
afterEach(async () => { await act(async () => root.unmount()); });

const crop = (id = "crop"): OpInstance => ({ id, type: "crop", enabled: true, params: { x: 0, y: 0, w: 1, h: 1, aspectLock: null } });
const rotate = (enabled = true): OpInstance => ({ id: "rotate", type: "rotate", enabled, params: { degrees: 90, fillColor: "#ffffff" } });
const resize = (): OpInstance => ({ id: "resize", type: "resize", enabled: true, params: { mode: "exact", width: 80, height: 240, interpolation: "lanczos3" } });

describe("crop cards use their entering pipeline frame", () => {
  it("resets to the whole portrait after rotation and retains the landscape Original ratio", async () => {
    const onOpParamsChange = await render([rotate(), crop()]);
    await clickCropButton(0, "Reset");
    expect(onOpParamsChange).toHaveBeenLastCalledWith("crop", { x: 0, y: 0, w: 2 / 3, h: 1, aspectLock: null }, undefined);
    await clickCropButton(0, "Original");
    const patch = onOpParamsChange.mock.lastCall![1];
    expect(patch.aspectLock).toBe("original");
    expect(patch.w / patch.h).toBeCloseTo(3 / 2);
    expect(patch.x + patch.w).toBeLessThanOrEqual(2 / 3);
    expect(patch.y + patch.h).toBeLessThanOrEqual(1);
  });

  it("uses each crop's own entering frame after resize and an earlier crop", async () => {
    const first = { ...crop("first"), params: { x: 0, y: 0, w: 0.25, h: 0.5, aspectLock: null } };
    const onOpParamsChange = await render([resize(), first, crop("second")]);
    await clickCropButton(0, "Reset");
    expect(onOpParamsChange).toHaveBeenLastCalledWith("first", { x: 0, y: 0, w: 1 / 3, h: 1, aspectLock: null }, undefined);
    await clickCropButton(1, "Reset");
    expect(onOpParamsChange).toHaveBeenLastCalledWith("second", { x: 0, y: 0, w: 0.5, h: 1, aspectLock: null }, undefined);
  });

  it("keeps crop card indexing stable when an earlier rotation is disabled", async () => {
    const onOpParamsChange = await render([rotate(false), crop()]);
    await clickCropButton(0, "Reset");
    expect(onOpParamsChange).toHaveBeenLastCalledWith("crop", { x: 0, y: 0, w: 1, h: 2 / 3, aspectLock: null }, undefined);
  });
});

async function clickCropButton(index: number, label: string): Promise<void> {
  const controls = document.querySelectorAll(".geometry-controls");
  const cropControls = [...controls].filter((element) => [...element.querySelectorAll("button")].some((button) => button.textContent === "Original"));
  const button = [...cropControls[index]!.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === label)!;
  await act(async () => button.click());
}

async function render(ops: OpInstance[]) {
  const onOpParamsChange = vi.fn();
  const task = {
    id: "task", originalId: "original", status: "not-saved", customSlug: null,
    generateDescription: false, generateSlug: false, output: null,
    pipeline: { ops, output: { format: "original", quality: "auto" } }
  } as unknown as Task;
  await act(async () => root.render(createElement(OpsPanel, {
    activeOriginal: null, activeTask: task, addOpsWidth: 180, hasGeminiApiKey: false,
    luts: [], stamps: [], opCatalog: [], opFailures: {}, outputFailures: {},
    originalSize: { width: 240, height: 160 }, pendingRevealOpId: null, selectedOpId: null,
    settings: null, visionGenerating: false, visionGenerationMode: null,
    onAddOp: vi.fn(), onClearVision: vi.fn(), onCustomSlugChange: vi.fn(), onDismissFailure: vi.fn(),
    onGenerateDescriptionChange: vi.fn(), onGenerateSlugChange: vi.fn(), onGenerateVision: vi.fn(),
    onMoveOp: vi.fn(), onOpenSettings: vi.fn(), onOpEnabledChange: vi.fn(), onOpParamChange: vi.fn(),
    onOpParamsChange, onOutputChange: vi.fn(), onReloadLuts: vi.fn(async () => undefined),
    onReloadStamps: vi.fn(async () => undefined), onRemoveOp: vi.fn(), onRevealOpHandled: vi.fn(), onSelectOp: vi.fn()
  })));
  return onOpParamsChange;
}
