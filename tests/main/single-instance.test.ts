import { afterEach, describe, expect, it, vi } from "vitest";
import { revealWindow } from "@main/reveal-window";

const electron = vi.hoisted(() => ({
  quit: vi.fn(),
  on: vi.fn(),
  exit: vi.fn()
}));
const bootstrap = vi.hoisted(() => vi.fn(async () => undefined));
const recordStartupFailure = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({ app: electron }));
vi.mock("@main/bootstrap", () => ({ bootstrap, recordStartupFailure }));
vi.mock("@main/startup-dialog", () => ({ notifyStartupFailure: vi.fn() }));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("single instance", () => {
  it("delegates startup admission to bootstrap", async () => {
    await import("@main/index");

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(electron.quit).not.toHaveBeenCalled();
  });

  it("records a failed startup and exits", async () => {
    const failure = new Error("no catalogue");
    bootstrap.mockRejectedValueOnce(failure);

    await import("@main/index");
    await vi.waitFor(() => expect(electron.exit).toHaveBeenCalledWith(1));

    expect(recordStartupFailure).toHaveBeenCalledWith("startup failed", failure);
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
