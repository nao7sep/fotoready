// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import { defaultUiState } from "@shared/validation/state";
import type { CloseRequest } from "@shared/types/ipc";

const owner = vi.hoisted(() => ({
  confirm: vi.fn(),
  roots: [] as Array<{ unmount(): void }>,
}));
vi.mock("@renderer/components/modals/confirmer", () => ({
  ConfirmerProvider: ({ children }: { children: ReactNode }) => children,
  useConfirmer: () => ({ confirm: owner.confirm, alert: vi.fn() }),
}));
vi.mock("react-dom/client", async (load) => {
  const original = await load<typeof import("react-dom/client")>();
  return { ...original, createRoot: (...args: Parameters<typeof original.createRoot>) => {
    const root = original.createRoot(...args);
    owner.roots.push(root);
    return root;
  } };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(approveClose: ReturnType<typeof vi.fn>) {
  let requested!: (request: CloseRequest) => void;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(window, "api", { configurable: true, value: {
    language: { current: async () => ({ language: "en", locale: "en-US" }), onChanged: () => () => {} },
    system: { getInfo: async () => ({ appName: "FotoReady", version: "0.1.0", cpuCount: 8, platform: "darwin" }), log: vi.fn(async () => {}) },
    settings: { get: async () => defaultGlobalSettings(), hasGeminiApiKey: async () => false },
    state: { get: async () => defaultUiState() },
    project: { current: async () => ({ project: { originals: [], tasks: [] }, activeTaskId: null, privacyWarnings: {} }) },
    ops: { list: async () => [] }, luts: { list: async () => [] }, stamps: { list: async () => [] },
    queues: { snapshot: async () => ({ saved: 0, total: 1, notSaved: 1, queued: 0, processing: 0, errors: 0, activeTaskId: null, activeTaskLabel: null }) },
    events: { onProjectSnapshot: () => () => {}, onQueueSnapshot: () => () => {} },
    lifecycle: { approveClose, onCloseRequest: (callback: typeof requested) => { requested = callback; return () => {}; }, onWindowActivityChanged: () => () => {} },
  } });
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await act(async () => { await import("@renderer/app"); });
  await vi.waitFor(() => expect(document.querySelector(".app-shell")).not.toBeNull());
  return (request: CloseRequest) => requested(request);
}

afterEach(async () => {
  await act(async () => { for (const root of owner.roots.splice(0)) root.unmount(); });
  owner.confirm.mockReset();
  vi.unstubAllGlobals();
});

it("rechecks an upgrade received while the old window-close approval is in flight", async () => {
  let finishApproval!: () => void;
  let answer!: (allow: boolean) => void;
  const approve = vi.fn(async () => {});
  approve.mockImplementationOnce(() => new Promise<void>((resolve) => { finishApproval = resolve; }));
  owner.confirm.mockImplementationOnce(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  const request = await mount(approve);
  await act(async () => request({ endsApp: false, requestId: 1 }));
  expect(approve).toHaveBeenCalledWith(true, 1);
  await act(async () => request({ endsApp: true, requestId: 2 }));
  expect(owner.confirm).not.toHaveBeenCalled();
  await act(async () => finishApproval());
  expect(owner.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: "Close and discard the current workspace?" }));
  expect(approve).toHaveBeenCalledOnce();
  await act(async () => answer(false));
  expect(approve).toHaveBeenLastCalledWith(false, 2);
});

it("answers with cancellation when required renderer confirmation fails", async () => {
  owner.confirm.mockRejectedValueOnce(new Error("confirmation unavailable"));
  const approve = vi.fn(async () => {});
  const request = await mount(approve);
  await act(async () => request({ endsApp: true, requestId: 3 }));
  expect(approve).toHaveBeenCalledWith(false, 3);
});
