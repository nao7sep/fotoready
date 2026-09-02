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
    expect(error?.querySelectorAll("svg")).toHaveLength(1);
    expect(error?.querySelector(".operation-result-close-icon")).not.toBeNull();
  });

  it("keeps a failed rename run assertive and inside the modal", async () => {
    await renderModal({
      onPreview: async () => readyPreview,
      onRun: async () => { throw new Error("Destination is read-only"); }
    });

    await vi.waitFor(() => expect(button("Rename all")?.disabled).toBe(false));
    await clickButton("Rename all");
    expect(document.querySelector('[role="alert"]')?.textContent)
      .toContain("Some files may already have their new names");
  });

  it("owns an output folder failure without exposing bridge diagnostics", async () => {
    await renderModal({
      onSetOutputDir: async () => {
        throw new Error("Error invoking remote method: EACCES /private/tmp/FOTOREADY_RENAME_SENTINEL");
      }
    });

    await clickButton("Change");
    const result = document.querySelector('[role="alert"]');
    expect(result?.textContent).toContain("The current folder is still in use");
    expect(result?.textContent).not.toMatch(/EACCES|private\/tmp|FOTOREADY_RENAME_SENTINEL|invoking remote method/i);
    expect(result?.querySelectorAll("svg")).toHaveLength(1);
  });

  it("retains unrelated preview and output-folder failures independently", async () => {
    await renderModal({
      onPreview: async () => { throw new Error("preview rejected"); },
      onSetOutputDir: async () => { throw new Error("output picker rejected"); }
    });
    await vi.waitFor(() => expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1));

    await clickButton("Change");
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(document.body.textContent).toContain("The rename preview could not be prepared");
    expect(document.body.textContent).toContain("The current folder is still in use");
  });

  it("keeps the modal open and reconciled after a stopped partial rename", async () => {
    await renderModal({ onPreview: async () => readyPreview, onRun: async () => "stopped" });
    await vi.waitFor(() => expect(button("Rename all")?.disabled).toBe(false));

    await clickButton("Rename all");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Some files may already have their new names");
  });

  it("blocks every close path while a rename batch is running", async () => {
    let finishRun: ((outcome: "stopped") => void) | undefined;
    const running = new Promise<"stopped">((resolve) => { finishRun = resolve; });
    const onClose = vi.fn();
    await renderModal({ onClose, onPreview: async () => readyPreview, onRun: async () => running });
    await vi.waitFor(() => expect(button("Rename all")?.disabled).toBe(false));

    await clickButton("Rename all");
    const cancel = button("Cancel");
    const headerClose = document.querySelector<HTMLButtonElement>(".modal-header-close");
    expect(cancel?.disabled).toBe(true);
    expect(headerClose?.disabled).toBe(true);

    await act(async () => {
      cancel?.click();
      headerClose?.click();
      document.querySelector<HTMLElement>(".modal-backdrop")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finishRun?.("stopped"));
    expect(button("Cancel")?.disabled).toBe(false);
  });
});

async function renderModal(overrides: {
  onOpenSettings?: () => void;
  onClose?: () => void;
  onPreview?: () => Promise<RenamePreview>;
  onRegenerateSlug?: (taskId: string) => Promise<void>;
  onRun?: () => Promise<"complete" | "stopped">;
  onSetOutputDir?: () => Promise<void>;
} = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(RenameModal, {
      projectSnapshot: snapshot,
      outputDirLabel: "output",
      outputDirPath: "/output",
      onClearOutputDir: async () => undefined,
      onClose: overrides.onClose ?? (() => undefined),
      onOpenSettings: overrides.onOpenSettings ?? (() => undefined),
      onPreview: overrides.onPreview ?? (async () => preview),
      onRegenerateSlug: overrides.onRegenerateSlug ?? (async () => undefined),
      onRun: overrides.onRun ?? (async () => "complete"),
      onSetRenameSlug: async () => undefined,
      onSetOutputDir: overrides.onSetOutputDir ?? (async () => undefined),
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
