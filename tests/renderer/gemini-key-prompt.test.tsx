// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGeminiKeyPrompt } from "@renderer/use-gemini-key-prompt";
import { GeminiKeyModal } from "@renderer/components/modals/gemini-key-modal";
import { ConfirmerProvider } from "@renderer/components/modals/confirmer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null;
let prompt: ReturnType<typeof useGeminiKeyPrompt>;
const hasKey = vi.fn<() => Promise<boolean>>();
const saveKey = vi.fn<(key: string) => Promise<void>>();
const onStored = vi.fn();
const run = vi.fn<(taskId: string, mode: string) => Promise<void>>();

function Harness() {
  prompt = useGeminiKeyPrompt({ hasKey, saveKey, onStored });
  return prompt.view ? <GeminiKeyModal {...prompt.view} onChange={prompt.changeDraft}
    onClose={() => void prompt.requestClose()} onSave={() => void prompt.save()} /> : null;
}

beforeEach(async () => {
  hasKey.mockReset().mockResolvedValue(false);
  saveKey.mockReset().mockResolvedValue(undefined);
  onStored.mockReset();
  run.mockReset().mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  await act(async () => { root!.render(<ConfirmerProvider><Harness /></ConfirmerProvider>); });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); });

function button(caption: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((entry) => entry.textContent === caption);
  if (!found) throw new Error(`Missing button: ${caption}`);
  return found;
}
async function typeKey(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function begin(taskId = "captured-task", mode = "description") {
  // Same promise boundary as the app's explicit Describe and rename-modal routes.
  const action = async () => { if (await prompt.ensureKey()) await run(taskId, mode); };
  let result!: Promise<void>;
  await act(async () => { result = action(); });
  return { result };
}

describe("explicit Gemini key request", () => {
  it("does nothing on mount and bypasses the prompt for an already resolved key", async () => {
    expect(hasKey).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    hasKey.mockResolvedValue(true);
    const { result } = await begin();
    await result;
    expect(run).toHaveBeenCalledWith("captured-task", "description");
    expect(saveKey).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(["description", "slug"])("saves before resuming the captured %s request exactly once", async (mode) => {
    let finishSave!: () => void;
    saveKey.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const { result } = await begin("task-before-selection-change", mode);
    expect(document.activeElement).toBe(document.querySelector('input[type="password"]'));
    await typeKey("  synthetic-key  ");
    await act(async () => button("Save").click());
    expect(saveKey).toHaveBeenCalledWith("synthetic-key");
    expect(run).not.toHaveBeenCalled();
    expect(button("Not now").disabled).toBe(true);
    await act(async () => { finishSave(); await result; });
    expect(run).toHaveBeenCalledExactlyOnceWith("task-before-selection-change", mode);
    expect(onStored).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Not now cancels without saving or generating", async () => {
    const { result } = await begin();
    await act(async () => { button("Not now").click(); await result; });
    expect(saveKey).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps an edited password until the user confirms discarding it", async () => {
    const { result } = await begin();
    await typeKey("synthetic-key");
    await act(async () => button("Not now").click());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await act(async () => button("Keep editing").click());
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("synthetic-key");
    await act(async () => button("Not now").click());
    await act(async () => { button("Discard").click(); await result; });
    expect(saveKey).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["rejection", "synchronous throw"])("retains a failed save (%s) for retry without displaying or logging exception text", async (failure) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      if (failure === "rejection") saveKey.mockRejectedValueOnce(new Error("synthetic-secret-must-not-be-logged"));
      else saveKey.mockImplementationOnce(() => { throw new Error("synthetic-secret-must-not-be-logged"); });
      const { result } = await begin();
      await typeKey("synthetic-key");
      await act(async () => button("Save").click());
      expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save the API key");
      expect(document.body.textContent).not.toContain("synthetic-secret");
      expect(error).not.toHaveBeenCalled();
      expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("synthetic-key");
      expect(run).not.toHaveBeenCalled();
      await act(async () => { button("Save").click(); await result; });
      expect(run).toHaveBeenCalledOnce();
    } finally { error.mockRestore(); }
  });

  it("does not submit while Enter commits an IME candidate", async () => {
    await begin();
    await typeKey("synthetic-key");
    const input = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => {
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(saveKey).not.toHaveBeenCalled();
  });

  it("settles the pending command on unmount and never resumes after a late save", async () => {
    let finishSave!: () => void;
    saveKey.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const { result } = await begin();
    await typeKey("synthetic-key");
    await act(async () => button("Save").click());
    await act(async () => { root!.unmount(); root = null; await result; });
    await act(async () => finishSave());
    expect(run).not.toHaveBeenCalled();
    expect(onStored).not.toHaveBeenCalled();
  });

  it("ordinary close waits for an admitted save without starting the AI request", async () => {
    let finishSave!: () => void;
    saveKey.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const { result } = await begin();
    await typeKey("synthetic-key");
    await act(async () => button("Save").click());
    let closing!: Promise<boolean>;
    await act(async () => { closing = prompt.requestClose(); });
    expect(run).not.toHaveBeenCalled();
    await act(async () => { finishSave(); expect(await closing).toBe(true); await result; });
    expect(run).not.toHaveBeenCalled();
    expect(onStored).toHaveBeenCalledOnce();
  });

  it("cancels ordinary close when the pending save fails, keeping the draft available", async () => {
    let failSave!: (error: Error) => void;
    saveKey.mockImplementation(() => new Promise((_resolve, reject) => { failSave = reject; }));
    await begin();
    await typeKey("synthetic-key");
    await act(async () => button("Save").click());
    let closing!: Promise<boolean>;
    await act(async () => { closing = prompt.requestClose(); });
    await act(async () => { failSave(new Error("storage unavailable")); expect(await closing).toBe(false); });
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("synthetic-key");
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
