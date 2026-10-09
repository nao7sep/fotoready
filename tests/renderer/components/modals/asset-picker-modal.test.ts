// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetImportResult, LutEntry, LutPreviewEntry, StampEntry } from "@shared/types/ipc";
import { LutPickerModal, StampPickerModal } from "@renderer/components/modals/asset-picker-modal";
import { ConfirmerProvider } from "@renderer/components/modals/confirmer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  thumbnail: vi.fn(async (assetPath: string) => ({ dataUrl: `data:${assetPath}`, width: 64, height: 64 })),
  pickFiles: vi.fn(async () => [] as string[]),
  importStamps: vi.fn<() => Promise<AssetImportResult[]>>(async () => []),
  deleteStamps: vi.fn(async () => undefined),
  lutPreview: vi.fn<() => Promise<LutPreviewEntry[] | null>>(async () => []),
  log: vi.fn(async () => undefined)
}));

vi.mock("@renderer/ipc/client", () => ({
  api: {
    assets: { thumbnail: mocks.thumbnail },
    system: { pickFiles: mocks.pickFiles },
    stamps: { import: mocks.importStamps, delete: mocks.deleteStamps },
    luts: { preview: mocks.lutPreview }
  }
}));

const stamps: StampEntry[] = [
  { slug: "cover-blob", name: "Cover blob", path: "/cover-blob.png", format: "png", builtin: true, groupId: "cover" },
  { slug: "heart", name: "Heart", path: "/heart.png", format: "png", builtin: true, groupId: "marks" },
  { slug: "laughing-face", name: "Laughing face", path: "/laughing-face.png", format: "png", builtin: true, groupId: "reactions" },
  { slug: "googly-eyes", name: "Googly eyes", path: "/googly-eyes.png", format: "png", builtin: true, groupId: "funny" },
  { slug: "mine", name: "mine.svg", path: "/mine.svg", format: "svg", builtin: false, groupId: "imported" }
];

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  mocks.thumbnail.mockReset();
  mocks.thumbnail.mockImplementation(async (assetPath: string) => ({ dataUrl: `data:${assetPath}`, width: 64, height: 64 }));
  mocks.pickFiles.mockReset();
  mocks.pickFiles.mockResolvedValue([]);
  mocks.importStamps.mockReset();
  mocks.importStamps.mockResolvedValue([]);
  mocks.deleteStamps.mockReset();
  mocks.deleteStamps.mockResolvedValue(undefined);
  mocks.log.mockReset();
  mocks.log.mockResolvedValue(undefined);
  vi.stubGlobal("api", { system: { log: mocks.log } });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("StampPickerModal groups", () => {
  it("admits one use synchronously and waits for its mutation before closing", async () => {
    let finish!: () => void;
    const onUse = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    await renderStampPicker({ onUse, onClose });
    const item = document.querySelector('[role="option"]')!;
    await act(async () => {
      item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onUse).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(button("Import…")?.disabled).toBe(true);
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("loads Reactions by default and keeps empty groups usable", async () => {
    await act(async () => {
      root.render(createElement(
        ConfirmerProvider,
        null,
        createElement(StampPickerModal, {
          onClose: () => undefined,
          onReload: async () => undefined,
          onUse: () => undefined,
          previewLongEdge: 64,
          selectedPath: "",
          stamps
        })
      ));
    });

    await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[role="dialog"]')?.classList.contains("asset-picker-modal")).toBe(true);
    const headerClose = document.querySelector<HTMLButtonElement>(".modal-header-close");
    expect(headerClose?.getAttribute("aria-label")).toBe("Close");
    expect(headerClose?.classList.contains("icon-button")).toBe(false);
    expect(headerClose?.querySelector(".modal-header-close-icon")).not.toBeNull();
    expect(mocks.thumbnail).toHaveBeenCalledWith("/laughing-face.png", 64);
    expect(selectedTab()?.textContent).toBe("Reactions");
    expect(document.body.textContent).toContain("Laughing face");
    expect(document.body.textContent).not.toContain("Cover blob");
    expect(document.body.textContent).not.toContain("Heart");
    expect(document.body.textContent).not.toContain("Googly eyes");

    await clickTab("Funny");
    await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledWith("/googly-eyes.png", 64));
    expect(selectedTab()?.textContent).toBe("Funny");
    expect(document.body.textContent).toContain("Googly eyes");
    expect(document.body.textContent).not.toContain("Laughing face");

    await clickTab("Cover");
    await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledWith("/cover-blob.png", 64));
    expect(selectedTab()?.textContent).toBe("Cover");
    expect(document.body.textContent).toContain("Cover blob");
    expect(document.body.textContent).not.toContain("Laughing face");

    await clickTab("Bubbles");
    expect(selectedTab()?.textContent).toBe("Bubbles");
    expect(document.body.textContent).toContain("No stamps in this group");
    expect(document.querySelector('[role="listbox"]')?.getAttribute("tabindex")).toBe("0");
  });

  it("keeps preview progress visible without making it a live result", async () => {
    let resolveThumbnail: ((value: { dataUrl: string; width: number; height: number }) => void) | undefined;
    mocks.thumbnail.mockImplementation(() => new Promise((resolve) => { resolveThumbnail = resolve; }));
    await renderStampPicker();

    const progress = [...document.querySelectorAll<HTMLElement>(".operation-result")]
      .find((element) => element.textContent?.includes("Preparing previews"));
    expect(progress).toBeDefined();
    expect(progress?.getAttribute("role")).toBeNull();

    await act(async () => resolveThumbnail?.({ dataUrl: "data:done", width: 64, height: 64 }));
  });

  it("imports PNG, SVG and WebP stamps", async () => {
    await renderStampPicker();
    await clickButton("Import…");

    expect(mocks.pickFiles).toHaveBeenCalledWith(expect.objectContaining({ extensions: ["png", "svg", "webp"] }));
  });

  it("announces partial import results without redundant severity chrome", async () => {
    mocks.pickFiles.mockResolvedValue(["/mine.svg"]);
    mocks.importStamps.mockResolvedValue([{
      fileName: "mine.svg",
      path: "/mine.svg",
      status: "skipped-name-conflict"
    }]);
    await renderStampPicker();
    await clickButton("Import…");

    const warning = document.querySelector('[role="status"]');
    expect(warning?.textContent).not.toContain("Warning:");
    expect(warning?.textContent).toContain("1 file already matches a library file name and was not imported: mine.svg");
    expect(warning?.querySelector("svg")).toBeNull();
  });

  it("presents authored import failure copy, logs the diagnostic, and retains dismissal", async () => {
    mocks.pickFiles.mockResolvedValue(["/broken.svg"]);
    mocks.importStamps.mockRejectedValue(new Error(
      "Error invoking remote method 'stamps.import': EACCES /private/tmp/FOTOREADY_SENTINEL"
    ));
    await renderStampPicker();
    await clickButton("Import…");

    const error = document.querySelector('[role="alert"]');
    expect(error?.textContent).toContain(
      "Assets could not be imported. The library is unchanged; check that the selected files are still available and try again."
    );
    expect(error?.textContent).not.toMatch(/EACCES|private\/tmp|FOTOREADY_SENTINEL|invoking remote method/i);
    expect(error?.querySelectorAll("svg")).toHaveLength(1); // the close X only
    expect(error?.querySelector(".operation-result-close-icon")).not.toBeNull();
    expect(button("Close import result")).toBeDefined();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      message: "renderer asset import failed",
      fields: expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining("FOTOREADY_SENTINEL") })
      })
    }));
  });
});

async function renderStampPicker(overrides: { onUse?: (path: string) => Promise<void>; onClose?: () => void } = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(
      ConfirmerProvider,
      null,
      createElement(StampPickerModal, {
        onClose: () => undefined,
        onReload: async () => undefined,
        onUse: () => undefined,
        previewLongEdge: 64,
        selectedPath: "",
        stamps,
        ...overrides
      })
    ));
  });
}

function selectedTab(): HTMLElement | null {
  return document.querySelector('[role="tab"][aria-selected="true"]');
}

async function clickTab(label: string): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    .find((entry) => entry.textContent === label);
  expect(tab).toBeDefined();
  await act(async () => tab!.click());
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label);
}

async function clickButton(label: string): Promise<void> {
  const target = button(label);
  expect(target).toBeDefined();
  await act(async () => target!.click());
}

describe("the LUT picker", () => {
  const lut = (name: string): LutEntry => ({ name, path: `/luts/${name}.cube`, builtin: false });
  const preview = (entry: LutEntry): LutPreviewEntry => ({ ...entry, dataUrl: `data:${entry.path}`, width: 64, height: 48 });
  const render = (luts: LutEntry[]) => act(async () => {
    root.render(createElement(ConfirmerProvider, null, createElement(LutPickerModal, {
      luts, previewLongEdge: 64, selectedPath: "", strength: 1, taskId: "task-1", targetOpId: "op-1",
      onClose: () => undefined, onReload: async () => undefined, onUse: () => undefined
    })));
  });

  it("lists the current LUTs at once after an import or delete, while their previews catch up", async () => {
    const [warm, cool, film] = [lut("Warm"), lut("Cool"), lut("Film")];
    mocks.lutPreview.mockResolvedValueOnce([preview(warm), preview(cool)]);
    await render([warm, cool]);
    await vi.waitFor(() => expect(document.querySelector(`img[src="data:${cool.path}"]`)).not.toBeNull());

    mocks.lutPreview.mockImplementationOnce(() => new Promise(() => {}));
    await render([warm, film]);

    expect(document.body.textContent).toContain("Warm");
    expect(document.body.textContent).toContain("Film");
    expect(document.body.textContent).not.toContain("Cool");
    expect(document.querySelector(`img[src="data:${warm.path}"]`)).not.toBeNull();
  });

  it("ignores an answer a newer request replaced", async () => {
    mocks.lutPreview.mockResolvedValueOnce(null);
    await render([lut("Warm")]);
    expect(document.body.textContent).toContain("Warm");
  });
});
