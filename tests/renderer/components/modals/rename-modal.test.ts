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

const readyPreview: RenamePreview = {
  ...preview,
  renameableCount: 1,
  blockedCount: 0,
  missingSlugCount: 0,
  items: [{
    ...preview.items[0],
    status: "ready",
    proposedPath: "/output/photo-ready.jpg",
    proposedName: "photo-ready.jpg",
    missingSlug: false,
    generatedSlug: "ready",
    effectiveSlug: "ready",
    issue: null
  }]
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
  it("announces a blocked preview without redundant severity chrome", async () => {
    await renderModal();

    const warning = document.querySelector('[role="status"]');
    expect(warning?.textContent).not.toContain("Warning:");
    expect(warning?.textContent).toContain("1 item needs attention");
    expect(warning?.getAttribute("aria-atomic")).toBe("true");
    expect(warning?.querySelector("svg")).toBeNull();
  });

  it("keeps a regeneration failure inline and offers Settings recovery", async () => {
    const onOpenSettings = vi.fn();
    await renderModal({
      onOpenSettings,
      onRegenerateSlug: async () => {
        throw new Error("Gemini API key is missing. Open Settings and save a key, then retry.");
      }
    });

    await clickButton("Generate");

    expect(document.querySelector('[role="alert"]')?.textContent)
      .toContain("A replacement slug could not be generated. Check the Gemini settings, then try again.");
    expect(button("Open Settings")).toBeDefined();
    await clickButton("Open Settings");
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("clears the previous inline failure before a successful retry", async () => {
    const regenerate = vi.fn()
      .mockRejectedValueOnce(new Error("Gemini is unavailable. Open Settings."))
      .mockResolvedValueOnce(undefined);
    await renderModal({ onRegenerateSlug: regenerate });

    await clickButton("Generate");
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await clickButton("Generate");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(regenerate).toHaveBeenCalledTimes(2);
  });

  it("announces preview failures with authored recovery copy", async () => {
    await renderModal({ onPreview: async () => { throw new Error("Preview unavailable"); } });

    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent)
      .toContain("The rename preview could not be prepared. Saved files are unchanged; try again.");
    expect(error?.querySelector("svg")).toBeNull();
  });

  it("keeps a failed rename run assertive and inside the modal", async () => {
    await renderModal({
      onPreview: async () => readyPreview,
      onRun: async () => { throw new Error("Destination is read-only"); }
    });

    await vi.waitFor(() => expect(button("Rename all")?.disabled).toBe(false));
    await clickButton("Rename all");
    expect(document.querySelector('[role="alert"]')?.textContent)
      .toContain("Files could not be renamed. Existing filenames are unchanged; resolve any blocked items and try again.");
  });
});

async function renderModal(overrides: {
  onOpenSettings?: () => void;
  onPreview?: () => Promise<RenamePreview>;
  onRegenerateSlug?: (taskId: string) => Promise<void>;
  onRun?: () => Promise<void>;
} = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(RenameModal, {
      projectSnapshot: snapshot,
      outputDirLabel: "output",
      outputDirPath: "/output",
      onClearOutputDir: async () => undefined,
      onClose: () => undefined,
      onOpenSettings: overrides.onOpenSettings ?? (() => undefined),
      onPreview: overrides.onPreview ?? (async () => preview),
      onRegenerateSlug: overrides.onRegenerateSlug ?? (async () => undefined),
      onRun: overrides.onRun ?? (async () => undefined),
      onSetRenameSlug: async () => undefined,
      onSetOutputDir: async () => undefined,
    }));
  });
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
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
