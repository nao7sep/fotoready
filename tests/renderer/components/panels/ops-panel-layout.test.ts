// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsPanel } from "@renderer/components/panels/ops-panel";
import type { Task } from "@shared/types/project";

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
  it("adds the third grid row only while an Ops result exists", async () => {
    await render({});
    expect(document.querySelector(".current-ops-section")?.classList.contains("has-owned-failures")).toBe(false);
    expect(document.querySelector(".current-ops")).not.toBeNull();

    await render({ "task-1\0ops:add": "The operation could not be added." });
    expect(document.querySelector(".current-ops-section")?.classList.contains("has-owned-failures")).toBe(true);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("keeps an operation failure inside the operation card", async () => {
    await render({ "task-1\0op:op-1:params": "The editing value could not be changed." }, taskWithOneOp());

    expect(document.querySelector(".current-ops-section")?.classList.contains("has-owned-failures")).toBe(false);
    expect(document.querySelector(".pipeline-op-card [role=\"alert\"]")?.textContent)
      .toContain("The editing value could not be changed.");
  });
});

async function render(opFailures: Record<string, string>, activeTask: Task | null = null): Promise<void> {
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
      onSelectOp: vi.fn()
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
