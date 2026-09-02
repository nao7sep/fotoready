// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutModal } from "@renderer/components/modals/about-modal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string) => Promise<void>>()
}));

vi.mock("@renderer/ipc/client", () => ({
  api: { system: { openExternal: mocks.openExternal } }
}));

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  mocks.openExternal.mockReset();
  vi.stubGlobal("api", { system: { log: vi.fn(async () => undefined) } });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("AboutModal links", () => {
  it("keeps hostile bridge diagnostics out of the retained modal result", async () => {
    mocks.openExternal.mockRejectedValue(new Error(
      "Error invoking remote method 'system.openExternal': EACCES /private/tmp/FOTOREADY_SENTINEL"
    ));
    await act(async () => {
      root.render(createElement(AboutModal, { systemInfo: null, onClose: () => undefined }));
    });

    const github = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "GitHub");
    await act(async () => github?.click());

    const result = document.querySelector('[role="alert"]');
    expect(result?.textContent).toContain("That page could not be opened");
    expect(result?.textContent).not.toMatch(/EACCES|private\/tmp|FOTOREADY_SENTINEL|invoking remote method/i);
    expect(result?.querySelectorAll("svg")).toHaveLength(1);
    expect(result?.querySelector(".operation-result-close-icon")).not.toBeNull();
  });
});
