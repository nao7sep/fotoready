// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StampEntry } from "@shared/types/ipc";
import { StampPickerModal } from "@renderer/components/modals/asset-picker-modal";
import { ConfirmerProvider } from "@renderer/components/modals/confirmer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  thumbnail: vi.fn(async (assetPath: string) => ({ dataUrl: `data:${assetPath}`, width: 64, height: 64 })),
  pickFiles: vi.fn(async () => [] as string[]),
  importStamps: vi.fn(async () => []),
  deleteStamps: vi.fn(async () => undefined)
}));

vi.mock("@renderer/ipc/client", () => ({
  api: {
    assets: { thumbnail: mocks.thumbnail },
    system: { pickFiles: mocks.pickFiles },
    stamps: { import: mocks.importStamps, delete: mocks.deleteStamps }
  }
}));

const stamps: StampEntry[] = [
  { slug: "cover-blob", name: "Cover blob", path: "/cover-blob.png", format: "png", builtin: true, groupId: "cover" },
  { slug: "heart", name: "Heart", path: "/heart.png", format: "png", builtin: true, groupId: "marks" },
  { slug: "laughing-face", name: "Laughing face", path: "/laughing-face.png", format: "png", builtin: true, groupId: "reactions" },
  { slug: "mine", name: "mine.svg", path: "/mine.svg", format: "svg", builtin: false, groupId: "imported" }
];

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  mocks.thumbnail.mockClear();
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("StampPickerModal groups", () => {
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
    expect(mocks.thumbnail).toHaveBeenCalledWith("/laughing-face.png", 64);
    expect(selectedTab()?.textContent).toBe("Reactions");
    expect(document.body.textContent).toContain("Laughing face");
    expect(document.body.textContent).not.toContain("Cover blob");
    expect(document.body.textContent).not.toContain("Heart");

    await clickTab("Cover");
    await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledWith("/cover-blob.png", 64));
    expect(selectedTab()?.textContent).toBe("Cover");
    expect(document.body.textContent).toContain("Cover blob");
    expect(document.body.textContent).not.toContain("Laughing face");

    await clickTab("Bubbles");
    expect(selectedTab()?.textContent).toBe("Bubbles");
    expect(document.body.textContent).toContain("No stamps in this group");
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  });
});

function selectedTab(): HTMLElement | null {
  return document.querySelector('[role="tab"][aria-selected="true"]');
}

async function clickTab(label: string): Promise<void> {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    .find((entry) => entry.textContent === label);
  expect(tab).toBeDefined();
  await act(async () => tab!.click());
}
