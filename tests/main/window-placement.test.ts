import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRestoredWindowBounds,
  createWindowPlacementController,
  type PlacementWindow
} from "@main/window-placement";
import type { WindowBounds, WindowPlacementRecord } from "@shared/types/state";

class FakeWindow extends EventEmitter implements PlacementWindow {
  bounds: WindowBounds = { x: 10, y: 20, width: 1200, height: 800 };
  maximized = false;
  minimized = false;
  fullScreen = false;

  getBounds(): WindowBounds {
    return { ...this.bounds };
  }

  setBounds(bounds: WindowBounds): void {
    this.bounds = { ...bounds };
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  isFullScreen(): boolean {
    return this.fullScreen;
  }
}

function setup(initialMode: "normal" | "maximized" = "normal") {
  const win = new FakeWindow();
  const saved: WindowPlacementRecord[] = [];
  const controller = createWindowPlacementController(win, {
    initialNormalBounds: win.getBounds(),
    initialMode,
    persist: async (record) => saved.push(record),
    onError: vi.fn()
  });
  return { win, saved, controller };
}

afterEach(() => vi.useRealTimers());

describe("createWindowPlacementController", () => {
  it("suppresses restoration-generated events until capture starts", async () => {
    vi.useFakeTimers();
    const { win, saved, controller } = setup();
    win.bounds = { x: 50, y: 60, width: 1300, height: 850 };
    win.emit("will-move");
    win.emit("move");
    win.emit("will-resize");
    win.emit("resize");

    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual([]);
    await controller.flush();
    expect(saved.at(-1)?.normalBounds).toEqual({ x: 10, y: 20, width: 1200, height: 800 });
  });

  it("debounces normal moves and resizes into one latest-bounds write", async () => {
    vi.useFakeTimers();
    const { win, saved, controller } = setup();
    controller.start();
    win.bounds = { x: 30, y: 40, width: 1250, height: 820 };
    win.emit("will-move");
    win.emit("move");
    await vi.advanceTimersByTimeAsync(250);
    win.bounds = { x: 40, y: 50, width: 1300, height: 840 };
    win.emit("will-resize");
    win.emit("resize");

    await vi.advanceTimersByTimeAsync(399);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([{ normalBounds: win.bounds, mode: "normal" }]);
  });

  it("ignores app- or OS-initiated geometry events without manual intent", async () => {
    vi.useFakeTimers();
    const { win, saved, controller } = setup();
    controller.start();
    win.bounds = { x: 200, y: 210, width: 1450, height: 900 };
    win.emit("move");
    win.emit("resize");

    await vi.advanceTimersByTimeAsync(500);
    expect(saved).toEqual([]);
  });

  it("preserves normal bounds while maximized and captures new bounds after unmaximize", async () => {
    vi.useFakeTimers();
    const { win, saved, controller } = setup();
    controller.start();
    win.maximized = true;
    win.bounds = { x: 0, y: 0, width: 1920, height: 1080 };
    win.emit("maximize");
    await Promise.resolve();
    expect(saved.at(-1)).toEqual({
      normalBounds: { x: 10, y: 20, width: 1200, height: 800 },
      mode: "maximized"
    });

    win.maximized = false;
    win.bounds = { x: 70, y: 80, width: 1400, height: 900 };
    win.emit("unmaximize");
    await vi.advanceTimersByTimeAsync(400);
    expect(saved.at(-1)).toEqual({ normalBounds: win.bounds, mode: "normal" });
  });

  it.each(["minimized", "fullScreen"] as const)("preserves stable placement when closed while %s", async (state) => {
    const { win, saved, controller } = setup("maximized");
    controller.start();
    win[state] = true;
    win.bounds = { x: 0, y: 0, width: 300, height: 200 };
    win.emit(state === "minimized" ? "minimize" : "enter-full-screen");

    await controller.flush();
    expect(saved.at(-1)).toEqual({
      normalBounds: { x: 10, y: 20, width: 1200, height: 800 },
      mode: "maximized"
    });
  });

  it("keeps the latest pending manual bounds when fullscreen interrupts the debounce", async () => {
    vi.useFakeTimers();
    const { win, saved, controller } = setup();
    controller.start();
    const latest = { x: 45, y: 55, width: 1320, height: 850 };
    win.bounds = latest;
    win.emit("will-move");
    win.emit("move");
    win.fullScreen = true;
    win.emit("enter-full-screen");

    await controller.flush();
    expect(saved).toEqual([{ normalBounds: latest, mode: "normal" }]);
  });

  it("suppresses transient event noise and captures after restoration settles", async () => {
    vi.useFakeTimers();
    const { win, saved, controller } = setup();
    controller.start();
    win.minimized = true;
    win.emit("minimize");
    win.bounds = { x: 0, y: 0, width: 300, height: 200 };
    win.emit("will-move");
    win.emit("move");
    win.emit("will-resize");
    win.emit("resize");
    win.minimized = false;
    win.bounds = { x: 90, y: 100, width: 1350, height: 860 };
    win.emit("restore");
    win.emit("will-resize");
    win.emit("resize");

    await vi.advanceTimersByTimeAsync(399);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([{ normalBounds: win.bounds, mode: "normal" }]);
  });

  it("flushes the latest pending normal bounds immediately", async () => {
    vi.useFakeTimers();
    const { win, saved, controller } = setup();
    controller.start();
    win.bounds = { x: 110, y: 120, width: 1500, height: 920 };
    win.emit("will-move");
    win.emit("move");

    await controller.flush();
    expect(saved).toEqual([{ normalBounds: win.bounds, mode: "normal" }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(saved).toHaveLength(1);
  });
});

describe("applyRestoredWindowBounds", () => {
  it("accepts an exact toolkit result", () => {
    const win = new FakeWindow();
    const target = { x: 100, y: 120, width: 1300, height: 850 };
    expect(applyRestoredWindowBounds(win, target, vi.fn())).toBe(true);
    expect(win.bounds).toEqual(target);
  });

  it("restores the opening bounds when the toolkit adjusts the rectangle", () => {
    const win = new FakeWindow();
    const opening = win.getBounds();
    const target = { x: 100, y: 120, width: 1300, height: 850 };
    const setter = vi.spyOn(win, "setBounds").mockImplementationOnce((bounds) => {
      win.bounds = { ...bounds, width: bounds.width - 1 };
    });
    const onFailure = vi.fn();

    expect(applyRestoredWindowBounds(win, target, onFailure)).toBe(false);
    expect(setter).toHaveBeenCalledTimes(2);
    expect(win.bounds).toEqual(opening);
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
