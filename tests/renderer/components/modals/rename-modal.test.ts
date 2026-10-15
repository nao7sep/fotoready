// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSnapshot, RenamePreview } from "@shared/types/ipc";
import { RenameModal } from "@renderer/components/modals/rename-modal";
import { ConfirmerProvider } from "@renderer/components/modals/confirmer";

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
    issue: "missing-slug",
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
      .mockResolvedValueOnce(true);
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
    await renderModal({ onPreview: async () => readyPreview, onRun: async () => ({ status: "stopped", warnings: [] }) });
    await vi.waitFor(() => expect(button("Rename all")?.disabled).toBe(false));

    await clickButton("Rename all");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Some files may already have their new names");
  });

  it("blocks every close path while a rename batch is running", async () => {
    let finishRun: ((outcome: { status: "complete" | "stopped"; warnings: [] }) => void) | undefined;
    const running = new Promise<{ status: "complete" | "stopped"; warnings: [] }>((resolve) => { finishRun = resolve; });
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

    await act(async () => finishRun?.({ status: "stopped", warnings: [] }));
    expect(button("Cancel")?.disabled).toBe(false);
  });
});

describe("RenameModal while a description runs", () => {
  it("keeps Rename all disabled while a listed file is being described", async () => {
    const describing = { ...snapshot, project: { ...snapshot.project, tasks: [{ id: "task-1", visionRunning: true, error: null }] } } as unknown as ProjectSnapshot;
    await renderModal({ onPreview: async () => readyPreview, projectSnapshot: describing });
    await vi.waitFor(() => expect(document.body.textContent).toContain("photo-ready.jpg"));
    expect(button("Rename all")?.disabled).toBe(true);
  });
});

describe("RenameModal preview rows", () => {
  it("tells each row's state in words alone, with no mark repeating it", async () => {
    await renderModal({ onPreview: async () => readyPreview });
    await vi.waitFor(() => expect(document.body.textContent).toContain("photo-ready.jpg"));
    const state = document.querySelector(".rename-preview-state")!;
    expect(state.children).toHaveLength(0);
    expect(state.textContent).not.toBe("");
  });
});

describe("RenameModal authored slug lifetime", () => {
  it("retains an uncommitted slug through a held snapshot refresh", async () => {
    await renderModal({ onPreview: async () => readyPreview });
    await typeSlug("harbour-draft");
    let finish!: (value: RenamePreview) => void;
    const refreshing = new Promise<RenamePreview>((resolve) => { finish = resolve; });
    await renderModal({ projectSnapshot: { ...snapshot }, onPreview: () => refreshing });
    expect(slugInput()?.value).toBe("harbour-draft");
    expect(button("Rename all")?.disabled).toBe(true);
    await act(async () => finish(readyPreview));
    expect(slugInput()?.value).toBe("harbour-draft");
    expect(button("Rename all")?.disabled).toBe(true);
  });

  it("keeps a draft when changing away from and back to a slug template", async () => {
    const onPreview = vi.fn(async (template?: string) => ({ ...readyPreview, usesSlug: template !== "builtin-original" }));
    await renderModal({ onPreview });
    await typeSlug("harbour-draft");
    const select = document.querySelector<HTMLSelectElement>("select")!;
    for (const value of ["builtin-original", "builtin-slug"]) {
      await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    expect(slugInput()?.value).toBe("harbour-draft");
  });

  it("blocks Rename all while a hidden template retains unsaved slug text", async () => {
    await renderModal({ onPreview: async (template?: string) => ({ ...readyPreview, usesSlug: template !== "builtin-original" }) });
    await typeSlug("harbour-draft");
    const select = document.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = "builtin-original"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(slugInput()).toBeNull();
    expect(button("Rename all")?.disabled).toBe(true);
  });

  it("keeps an optimistic preview from acknowledging a failed save, then permits an Enter retry", async () => {
    const onClose = vi.fn();
    let reject!: (error: Error) => void;
    const onSetRenameSlug = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }))
      .mockResolvedValueOnce(undefined);
    await renderModal({ onClose, onPreview: async () => readyPreview, onSetRenameSlug });
    await typeSlug("harbour-draft");
    await act(async () => slugInput()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    const optimistic = { ...readyPreview, items: [{ ...readyPreview.items[0], customSlug: "harbour-draft" }] };
    await renderModal({ onClose, projectSnapshot: { ...snapshot }, onPreview: async () => optimistic, onSetRenameSlug });
    await act(async () => reject(new Error("write refused")));
    expect(slugInput()?.value).toBe("harbour-draft");
    expect(button("Rename all")?.disabled).toBe(true);
    await clickButton("Cancel");
    expect(onClose).not.toHaveBeenCalled();
    await clickButton("Keep editing");
    await act(async () => slugInput()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSetRenameSlug).toHaveBeenCalledTimes(2);
    expect(button("Rename all")?.disabled).toBe(false);
  });

  it("retires only the text captured by a completed generation", async () => {
    let finish!: (completed: boolean) => void;
    const onRegenerateSlug = () => new Promise<boolean>((resolve) => { finish = resolve; });
    await renderModal({ onPreview: async () => readyPreview, onRegenerateSlug });
    await typeSlug("replace-this");
    await clickButton("Regenerate");
    const generated = { ...readyPreview, items: [{ ...readyPreview.items[0], customSlug: "generated" }] };
    await renderModal({ projectSnapshot: { ...snapshot }, onPreview: async () => generated, onRegenerateSlug });
    await act(async () => finish(true));
    expect(slugInput()?.value).toBe("generated");
    expect(button("Rename all")?.disabled).toBe(false);
  });

  it.each(["cancelled", "failed", "newer text"])("preserves a generation draft after %s", async (outcome) => {
    let finish!: (completed: boolean) => void;
    let reject!: (error: Error) => void;
    const onRegenerateSlug = () => new Promise<boolean>((resolve, fail) => { finish = resolve; reject = fail; });
    await renderModal({ onPreview: async () => readyPreview, onRegenerateSlug });
    await typeSlug("keep-this");
    await clickButton("Regenerate");
    if (outcome === "newer text") await typeSlug("newer");
    await act(async () => {
      if (outcome === "failed") reject(new Error("provider failed"));
      else finish(outcome === "newer text");
    });
    expect(slugInput()?.value).toBe(outcome === "newer text" ? "newer" : "keep-this");
    expect(button("Rename all")?.disabled).toBe(true);
  });

  it("keeps another row's draft when the first row saves successfully", async () => {
    const twoRows = { ...readyPreview, items: [readyPreview.items[0], { ...readyPreview.items[0], taskId: "task-2" }] };
    await renderModal({ onPreview: async () => twoRows });
    await typeSlug("first-row");
    await typeSlug("second-row", 1);
    await act(async () => slugInput()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(slugInput(1)?.value).toBe("second-row");
    expect(button("Rename all")?.disabled).toBe(true);
  });

  it("keeps failed blur-save text and guards Escape dismissal", async () => {
    const onClose = vi.fn();
    await renderModal({ onClose, onPreview: async () => readyPreview, onSetRenameSlug: async () => { throw new Error("write refused"); } });
    await typeSlug("harbour-draft");
    await act(async () => slugInput()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(document.body.textContent).toContain("could not be saved");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Keep editing")).toBeDefined();
    await clickButton("Keep editing");
    expect(slugInput()?.value).toBe("harbour-draft");
    await clickButton("Cancel");
    await clickButton("Discard");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not clear newer text when an earlier submitted slug succeeds", async () => {
    let finish!: () => void;
    await renderModal({ onPreview: async () => readyPreview, onSetRenameSlug: () => new Promise<void>((resolve) => { finish = resolve; }) });
    await typeSlug("first");
    await act(async () => slugInput()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await typeSlug("newer");
    await act(async () => finish());
    await renderModal({ projectSnapshot: { ...snapshot }, onPreview: async () => ({ ...readyPreview, items: [{ ...readyPreview.items[0], customSlug: "first" }] }) });
    expect(slugInput()?.value).toBe("newer");
    expect(button("Rename all")?.disabled).toBe(true);
  });
});

function slugInput(index = 0): HTMLInputElement | null { return document.querySelectorAll<HTMLInputElement>(".rename-preview-slug-input")[index] ?? null; }
async function typeSlug(value: string, index = 0): Promise<void> {
  await act(async () => {
    const input = slugInput(index)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function renderModal(overrides: {
  projectSnapshot?: ProjectSnapshot;
  onOpenSettings?: () => void;
  onClose?: () => void;
  onPreview?: () => Promise<RenamePreview>;
  onRegenerateSlug?: (taskId: string) => Promise<boolean>;
  onRun?: () => Promise<{ status: "complete" | "stopped"; warnings: [] }>;
  onSetOutputDir?: () => Promise<void>;
  onSetRenameSlug?: (taskId: string, slug: string | null) => Promise<void>;
} = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(ConfirmerProvider, null, createElement(RenameModal, {
      projectSnapshot: overrides.projectSnapshot ?? snapshot,
      outputDirLabel: "output",
      outputDirPath: "/output",
      onClearOutputDir: async () => undefined,
      onClose: overrides.onClose ?? (() => undefined),
      onOpenSettings: overrides.onOpenSettings ?? (() => undefined),
      onPreview: overrides.onPreview ?? (async () => preview),
      onRegenerateSlug: overrides.onRegenerateSlug ?? (async () => true),
      onRun: overrides.onRun ?? (async () => ({ status: "complete", warnings: [] })),
      onSetRenameSlug: overrides.onSetRenameSlug ?? (async () => undefined),
      onSetOutputDir: overrides.onSetOutputDir ?? (async () => undefined),
    })));
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
