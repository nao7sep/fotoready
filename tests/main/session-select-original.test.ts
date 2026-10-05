import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import type { Original } from "@shared/types/project";
import { ProjectSession } from "@main/session";

/**
 * Selecting another image while the active task is untouched reuses that task's slot. The task it
 * leaves there is a new task for the newly selected image, so nothing derived from the first image
 * (its output defaults, its creation time) survives the switch.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProjectSession.selectOriginal on an untouched task", () => {
  it("gives the task the defaults and creation time of a new task for the selected image", () => {
    const { session, png, jpeg } = arrange();
    vi.setSystemTime(new Date("2026-10-05T01:00:00.000Z"));
    session.selectOriginal(png.id);
    const first = session.snapshot().project.tasks[0];
    expect(first.pipeline.output.quality).toBe(82);

    vi.setSystemTime(new Date("2026-10-05T02:00:00.000Z"));
    const snapshot = session.selectOriginal(jpeg.id);

    expect(snapshot.project.tasks).toHaveLength(1);
    const switched = snapshot.project.tasks[0];
    expect(switched.id).toBe(first.id);
    expect(snapshot.activeTaskId).toBe(first.id);
    expect(switched.originalId).toBe(jpeg.id);
    expect(switched.pipeline.output.quality).toBe("auto");
    expect(switched.createdAt).toBe("2026-10-05T02:00:00.000Z");
    expect(switched.updatedAt).toBe("2026-10-05T02:00:00.000Z");
    expect(switched.everEdited).toBe(false);
  });

  it("drops undo steps that still describe the first image", async () => {
    const { session, png, jpeg } = arrange();
    session.selectOriginal(png.id);
    const taskId = session.snapshot().project.tasks[0].id;
    // An edit that fails after its undo step is recorded leaves the task untouched but the step behind.
    await expect(session.addOp(taskId, "watermark-image")).rejects.toThrow();
    expect(session.snapshot().project.tasks[0].everEdited).toBe(false);

    session.selectOriginal(jpeg.id);
    const snapshot = session.undoTaskEdit(taskId);

    expect(snapshot.project.tasks[0].originalId).toBe(jpeg.id);
  });

  it("keeps an edited task and starts a new one for the selected image", async () => {
    const { session, png, jpeg } = arrange();
    session.selectOriginal(png.id);
    const edited = session.snapshot().project.tasks[0];
    await session.addOp(edited.id, "rotate");

    const snapshot = session.selectOriginal(jpeg.id);

    expect(snapshot.project.tasks.map((task) => task.originalId)).toEqual([png.id, jpeg.id]);
    expect(snapshot.project.tasks[0].id).toBe(edited.id);
    expect(snapshot.activeTaskId).toBe(snapshot.project.tasks[1].id);
  });
});

function arrange(): { session: ProjectSession; png: Original; jpeg: Original } {
  const settings = defaultGlobalSettings();
  settings.defaultWatermarkImage = "/missing/watermark.png";
  const session = new ProjectSession(settings, null as never, null as never, null as never, "resources/stamps");
  const png = original("original-png", "png");
  const jpeg = original("original-jpeg", "jpeg");
  session.snapshot().project.originals.push(png, jpeg);
  return { session, png, jpeg };
}

function original(id: string, format: string): Original {
  return {
    id,
    sourcePath: `/originals/${id}.${format}`,
    sourceHash: `${id}-hash`,
    size: 1024,
    format,
    jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: 1000,
    height: 800,
    addedAt: "2026-10-05T00:00:00.000Z"
  };
}
