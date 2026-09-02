// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnedFailureList } from "@renderer/components/owned-failure-list";
import { dismissOwnedFailure, runOwnedAction, type OwnedFailures } from "@renderer/owned-failures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const log = vi.fn(async () => undefined);

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  log.mockClear();
  vi.stubGlobal("api", { system: { log } });
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("owned action failures", () => {
  it("retains independent authored results and clears only the successful action", async () => {
    let failures: OwnedFailures = {};
    const setFailures = (update: React.SetStateAction<OwnedFailures>): void => {
      failures = typeof update === "function" ? update(failures) : update;
    };
    const sentinel = new Error("Error invoking remote method: EACCES /private/tmp/FOTOREADY_SENTINEL");

    await runOwnedAction({
      action: async () => { throw sentinel; },
      key: "first",
      operation: "first action failed",
      setFailures,
      userMessage: "The first change could not be saved. Try again."
    });
    await runOwnedAction({
      action: async () => { throw sentinel; },
      key: "second",
      operation: "second action failed",
      setFailures,
      userMessage: "The second change could not be saved. Try again."
    });

    expect(failures).toEqual({
      first: "The first change could not be saved. Try again.",
      second: "The second change could not be saved. Try again."
    });
    expect(JSON.stringify(failures)).not.toMatch(/EACCES|private\/tmp|FOTOREADY_SENTINEL|invoking remote method/i);
    expect(log).toHaveBeenCalledTimes(2);

    await runOwnedAction({
      action: async () => undefined,
      key: "first",
      operation: "first action failed",
      setFailures,
      userMessage: "unused"
    });
    expect(failures).toEqual({ second: "The second change could not be saved. Try again." });

    await runOwnedAction({
      action: async () => "cancelled",
      key: "second",
      operation: "second action failed",
      setFailures,
      userMessage: "unused"
    });
    expect(failures).toEqual({ second: "The second change could not be saved. Try again." });

    dismissOwnedFailure(setFailures, "second");
    expect(failures).toEqual({});
  });

  it("renders each result with only a quiet close control", async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(createElement(OwnedFailureList, {
        failures: { first: "First result", second: "A much longer second result that wraps naturally." },
        onDismiss
      }));
    });

    const results = document.querySelectorAll('[role="alert"]');
    expect(results).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/Error:|Warning:/);
    expect(document.querySelectorAll("svg")).toHaveLength(2);
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close action result"]');
    expect(close?.className).toBe("operation-result-dismiss");
    await act(async () => close?.click());
    expect(onDismiss).toHaveBeenCalledWith("first");
  });

  it("lets only the latest same-key attempt settle presentation", async () => {
    let failures: OwnedFailures = {};
    const setFailures = (update: React.SetStateAction<OwnedFailures>): void => {
      failures = typeof update === "function" ? update(failures) : update;
    };
    let rejectOlder!: (error: unknown) => void;
    const older = runOwnedAction({
      action: () => new Promise<void>((_resolve, reject) => { rejectOlder = reject; }),
      key: "same",
      operation: "same action failed",
      setFailures,
      userMessage: "Older failure"
    });
    const newer = runOwnedAction({
      action: async () => undefined,
      key: "same",
      operation: "same action failed",
      setFailures,
      userMessage: "Newer failure"
    });

    await newer;
    rejectOlder(new Error("stale EACCES /private/tmp/FOTOREADY_STALE"));
    await older;
    expect(failures).toEqual({});
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("same action failed"),
    }));
  });
});
