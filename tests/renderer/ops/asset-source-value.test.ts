// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetSourceValue } from "@renderer/ops/_asset-source-value";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ revealInFolder: vi.fn<(path: string) => Promise<void>>() }));
vi.mock("@renderer/ipc/client", () => ({ api: { system: { revealInFolder: mocks.revealInFolder } } }));

let root: Root;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  mocks.revealInFolder.mockReset();
  vi.stubGlobal("api", { system: { log: vi.fn(async () => undefined) } });
  root = createRoot(document.querySelector("#root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("an op card's asset name", () => {
  it("is a button that shows the file, so its whole name is reachable without hovering", async () => {
    mocks.revealInFolder.mockResolvedValue();
    await act(async () => root.render(createElement(AssetSourceValue, { path: "/luts/a-very-long-film-emulation.cube", label: "a-very-long-film-emulation.cube", emptyLabel: "None" })));
    const name = document.querySelector<HTMLButtonElement>("button.asset-source-value")!;
    expect(name.textContent).toBe("a-very-long-film-emulation.cube");
    await act(async () => name.click());
    expect(mocks.revealInFolder).toHaveBeenCalledExactlyOnceWith("/luts/a-very-long-film-emulation.cube");
  });

  it("says the file could not be shown when it is gone", async () => {
    mocks.revealInFolder.mockRejectedValue(new Error("ENOENT"));
    await act(async () => root.render(createElement(AssetSourceValue, { path: "/luts/gone.cube", label: "gone.cube", emptyLabel: "None" })));
    await act(async () => document.querySelector<HTMLButtonElement>("button.asset-source-value")!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("The file could not be shown.");
  });

  it("shows the empty label as plain text when nothing is chosen", async () => {
    await act(async () => root.render(createElement(AssetSourceValue, { path: "", label: null, emptyLabel: "No LUT selected" })));
    expect(document.querySelector("button")).toBeNull();
    expect(document.querySelector(".asset-source-value.empty")?.textContent).toBe("No LUT selected");
  });
});
