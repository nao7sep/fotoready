import { afterEach, describe, expect, it, vi } from "vitest";
import { revealWindow } from "@main/reveal-window";

const electron = vi.hoisted(() => ({
  requestSingleInstanceLock: vi.fn<() => boolean>(),
  quit: vi.fn(),
  on: vi.fn(),
  exit: vi.fn()
}));
const bootstrap = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("electron", () => ({ app: electron }));
vi.mock("@main/bootstrap", () => ({ bootstrap }));
vi.mock("@main/startup-dialog", () => ({ notifyStartupFailure: vi.fn() }));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("single instance", () => {
  it("quits a second launch before it starts anything", async () => {
    electron.requestSingleInstanceLock.mockReturnValue(false);

    await import("@main/index");

    expect(electron.quit).toHaveBeenCalledTimes(1);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("starts the first launch", async () => {
    electron.requestSingleInstanceLock.mockReturnValue(true);

    await import("@main/index");

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(electron.quit).not.toHaveBeenCalled();
  });

  it("brings a minimized, hidden window forward", () => {
    const calls: string[] = [];
    revealWindow({
      isMinimized: () => true,
      restore: () => void calls.push("restore"),
      isVisible: () => false,
      show: () => void calls.push("show"),
      focus: () => void calls.push("focus")
    });

    expect(calls).toEqual(["restore", "show", "focus"]);
  });
});
