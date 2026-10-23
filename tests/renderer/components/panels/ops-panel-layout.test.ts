// @vitest-environment jsdom

import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsPanel } from "@renderer/components/panels/ops-panel";
import type { Task } from "@shared/types/project";
import { message } from "@shared/i18n/translate";
import type { OwnedFailures } from "@renderer/owned-failures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("OpsPanel result geometry", () => {
  it("allocates remaining space to Ops and caps the complete scrolling Output section", async () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve("src/renderer/styles/app.css"), "utf8");
    document.head.append(style);
    try {
      await render({});
      const pane = getComputedStyle(document.querySelector(".ops-edit-pane")!);
      const ops = getComputedStyle(document.querySelector(".current-ops-section")!);
      const output = getComputedStyle(document.querySelector(".output-section")!);
      expect([pane.display, pane.flexDirection, pane.minHeight]).toEqual(["flex", "column", "0px"]);
      expect([ops.flexGrow, ops.flexShrink, ops.flexBasis, ops.minHeight]).toEqual(["1", "1", "0px", "0px"]);
      expect([output.flexGrow, output.flexShrink, output.flexBasis]).toEqual(["0", "1", "auto"]);
      expect([output.maxHeight, output.minHeight, output.overflowY]).toEqual(["50%", "0px", "auto"]);
      expect(document.querySelector(".output-section > .panel-header")).not.toBeNull();
      expect(document.querySelector(".output-section > .output-fixed > .output-controls")).not.toBeNull();
      expect(getComputedStyle(document.querySelector(".current-ops")!).overflowY).toBe("auto");
    } finally {
      style.remove();
    }
  });

  it("adds the third grid row only while an Ops result exists", async () => {
    await render({});
    expect(document.querySelector(".current-ops-section")?.classList.contains("has-owned-failures")).toBe(false);
    expect(document.querySelector(".current-ops")).not.toBeNull();

    await render({ "task-1\0ops:add": message("failure.addOp") });
    expect(document.querySelector(".current-ops-section")?.classList.contains("has-owned-failures")).toBe(true);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("keeps explicit AI commands available without a key on a saved output", async () => {
    const task = taskWithOneOp();
    task.status = "saved";
    task.output = { stagedPath: "/tmp/photo.jpg", stagedParamsPath: "/tmp/photo.json", stagedAt: "2026-10-11", outputHash: "hash", vision: null, finalPath: null, finalParamsPath: null, renamedAt: null };
    await render({}, task);
    const commands = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => ["Generate description", "Generate description and slug"].includes(button.textContent ?? ""));
    expect(commands).toHaveLength(2);
    expect(commands.every((button) => !button.disabled)).toBe(true);
  });

  it("keeps an operation failure inside the operation card", async () => {
    await render({ "task-1\0op:op-1:params": message("failure.opParam") }, taskWithOneOp());

    expect(document.querySelector(".current-ops-section")?.classList.contains("has-owned-failures")).toBe(false);
    expect(document.querySelector(".pipeline-op-card [role=\"alert\"]")?.textContent)
      .toContain("That editing value could not be changed.");
  });
});

describe("operation control focus", () => {
  it("selects the owning operation through focus alone without editing its recipe", async () => {
    const task = taskWithOneOp();
    task.pipeline.ops = [
      { id: "balance", type: "white-balance", params: { temperature: 0, tint: 0, samplePoint: null }, enabled: true },
      { id: "rotate", type: "rotate", params: { degrees: 0, fillColor: "#ffffff" }, enabled: true }
    ];
    const onSelectOp = vi.fn();
    const onOpParamChange = vi.fn();
    const onOpParamsChange = vi.fn();
    await render({}, task, { selectedOpId: "rotate", onSelectOp, onOpParamChange, onOpParamsChange });

    const cards = document.querySelectorAll(".pipeline-op-card");
    await act(async () => cards[0]!.querySelector<HTMLInputElement>('input[type="range"]')!.focus());
    expect(onSelectOp).toHaveBeenLastCalledWith("balance");
    await act(async () => cards[1]!.querySelector<HTMLButtonElement>(".geometry-controls button")!.focus());
    expect(onSelectOp).toHaveBeenLastCalledWith("rotate");
    expect(onOpParamChange).not.toHaveBeenCalled();
    expect(onOpParamsChange).not.toHaveBeenCalled();
  });

  it("preserves one continuous history group while focused and begins another on reentry", async () => {
    const task = taskWithOneOp();
    task.pipeline.ops = [{ id: "balance", type: "white-balance", params: { temperature: 0, tint: 0, samplePoint: null }, enabled: true }];
    const onOpParamsChange = vi.fn();
    await render({}, task, { onOpParamsChange });
    const sliders = document.querySelectorAll<HTMLInputElement>('.pipeline-op-card input[type="range"]');
    await act(async () => sliders[0]!.focus());
    await changeRange(sliders[0]!, 10);
    await changeRange(sliders[0]!, 20);
    expect(onOpParamsChange).toHaveBeenNthCalledWith(1, "balance", { temperature: 10 }, { historyGroup: "op:balance:1" });
    expect(onOpParamsChange).toHaveBeenNthCalledWith(2, "balance", { temperature: 20 }, { historyGroup: "op:balance:1" });
    await act(async () => sliders[1]!.focus());
    await changeRange(sliders[1]!, 10);
    expect(onOpParamsChange).toHaveBeenNthCalledWith(3, "balance", { tint: 10 }, { historyGroup: "op:balance:2" });
  });
});

async function changeRange(input: HTMLInputElement, value: number): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render(opFailures: OwnedFailures, activeTask: Task | null = null, overrides: Partial<Parameters<typeof OpsPanel>[0]> = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(OpsPanel, {
      activeOriginal: null,
      activeTask,
      addOpsWidth: 180,
      hasGeminiApiKey: false,
      luts: [],
      opCatalog: [],
      opFailures,
      outputFailures: {},
      originalSize: null,
      pendingRevealOpId: null,
      selectedOpId: null,
      settings: null,
      stamps: [],
      visionGenerating: false,
      visionGenerationMode: null,
      onAddOp: vi.fn(),
      onClearVision: vi.fn(),
      onCustomSlugChange: vi.fn(),
      onDismissFailure: vi.fn(),
      onGenerateDescriptionChange: vi.fn(),
      onGenerateSlugChange: vi.fn(),
      onGenerateVision: vi.fn(),
      onMoveOp: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpEnabledChange: vi.fn(),
      onOpParamChange: vi.fn(),
      onOpParamsChange: vi.fn(),
      onOutputChange: vi.fn(),
      onReloadLuts: vi.fn(async () => undefined),
      onReloadStamps: vi.fn(async () => undefined),
      onRemoveOp: vi.fn(),
      onRevealOpHandled: vi.fn(),
      onSelectOp: vi.fn(),
      ...overrides
    }));
  });
}

function taskWithOneOp(): Task {
  return {
    id: "task-1",
    originalId: "original-1",
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline: {
      ops: [{ id: "op-1", type: "test-op", params: {}, enabled: true }],
      output: {
        format: "original",
        quality: "auto",
        flattenTransparency: false,
        jpegProgressive: true,
        jpegChromaSubsampling: "4:2:0",
        webpMethod: 4,
        avifEffort: 4,
        pngPalette: false,
        backgroundForTransparency: "#ffffff"
      }
    },
    status: "not-saved",
    output: null,
    error: null,
    everEdited: true,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z"
  };
}
