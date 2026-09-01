// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot, RenamePreview } from "@shared/types/ipc";
import { RenameModal } from "@renderer/components/modals/rename-modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preview: RenamePreview = {
  templateId: "builtin-slug-size",
  usesOriginal: false,
  usesSlug: true,
  renameableCount: 0,
  blockedCount: 1,
  missingSlugCount: 1,
  items: [{
    taskId: "task-1",
    originalName: "photo.jpg",
    status: "blocked",
    currentPath: "/output/photo.jpg",
    proposedPath: null,
    currentName: "photo.jpg",
    proposedName: null,
    missingSlug: true,
    customSlug: null,
    generatedSlug: null,
    effectiveSlug: null,
    issue: "Missing slug",
  }],
};

const snapshot = {
  activeTaskId: "task-1",
  privacyWarnings: {},
  project: {
    outputDir: "/output",
    originals: [],
    tasks: [{ id: "task-1", visionRunning: false, error: null }],
  },
} as unknown as ProjectSnapshot;

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("RenameModal vision recovery", () => {
  it("keeps a regeneration failure inline and offers Settings recovery", async () => {
    const onOpenSettings = vi.fn();
    await renderModal(async () => {
      throw new Error("Gemini API key is missing. Open Settings and save a key, then retry.");
    }, onOpenSettings);

    await clickButton("Generate");

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Gemini API key is missing");
    expect(button("Open Settings")).toBeDefined();
    await clickButton("Open Settings");
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("clears the previous inline failure before a successful retry", async () => {
    const regenerate = vi.fn()
      .mockRejectedValueOnce(new Error("Gemini is unavailable. Open Settings."))
      .mockResolvedValueOnce(undefined);
    await renderModal(regenerate, vi.fn());

    await clickButton("Generate");
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await clickButton("Generate");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(regenerate).toHaveBeenCalledTimes(2);
  });
});

async function renderModal(
  onRegenerateSlug: (taskId: string) => Promise<void>,
  onOpenSettings: () => void,
): Promise<void> {
  await act(async () => {
    root.render(createElement(RenameModal, {
      projectSnapshot: snapshot,
      outputDirLabel: "output",
      outputDirPath: "/output",
      onClearOutputDir: async () => undefined,
      onClose: () => undefined,
      onOpenSettings,
      onPreview: async () => preview,
      onRegenerateSlug,
      onRun: async () => undefined,
      onSetRenameSlug: async () => undefined,
      onSetOutputDir: async () => undefined,
    }));
  });
  await vi.waitFor(() => expect(button("Generate")).toBeDefined());
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === label);
}

async function clickButton(label: string): Promise<void> {
  const target = button(label);
  expect(target).toBeDefined();
  await act(async () => target!.click());
}
