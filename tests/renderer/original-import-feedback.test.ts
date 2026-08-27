import { describe, expect, it } from "vitest";
import type { OriginalImportResult } from "@shared/types/ipc";
import {
  buildOriginalImportFeedback,
  inaccessibleOriginalImportFeedback,
  queueRefreshFailureFeedback,
  settleOriginalImportFeedback,
} from "@renderer/original-import-feedback";

function result(overrides: Partial<OriginalImportResult> = {}): OriginalImportResult {
  return {
    snapshot: {
      project: { outputDir: null, originals: [], tasks: [] },
      activeTaskId: null,
      privacyWarnings: {},
    },
    canceled: false,
    acceptedImages: 0,
    addedOriginals: 0,
    restoredTasks: 0,
    succeededPaths: [],
    issues: [],
    ...overrides,
  };
}

describe("original import feedback", () => {
  it("keeps full success and cancellation quiet", () => {
    expect(buildOriginalImportFeedback(result({ addedOriginals: 2 }))).toBeNull();
    expect(buildOriginalImportFeedback(result({ canceled: true }))).toBeNull();
  });

  it("presents a duplicate as persistent neutral information", () => {
    expect(buildOriginalImportFeedback(result({
      acceptedImages: 1,
      issues: [{
        filePath: "/photos/repeat.jpg",
        kind: "duplicate",
        severity: "info",
        reason: "This original is already in the project.",
      }],
    }))).toMatchObject({
      severity: "info",
      title: "Nothing new was added.",
      details: [{ severity: "info", text: "repeat.jpg: This original is already in the project." }],
    });
  });

  it("summarizes both successful and rejected sides of one mixed batch", () => {
    expect(buildOriginalImportFeedback(result({
      acceptedImages: 2,
      addedOriginals: 2,
      restoredTasks: 1,
      issues: [{
        filePath: "/photos/broken.json",
        kind: "invalid",
        severity: "warning",
        reason: "This JSON file is not a valid FotoReady task sidecar.",
      }],
    }))).toMatchObject({
      severity: "warning",
      title: "Added 2 originals and restored 1 task; 1 item needs attention.",
      details: [{ severity: "warning", text: "broken.json: This JSON file is not a valid FotoReady task sidecar." }],
    });
  });

  it("uses the highest issue severity and accounts for inaccessible delivered files", () => {
    expect(buildOriginalImportFeedback(result({
      addedOriginals: 1,
      issues: [{
        filePath: "/photos/animation.gif",
        kind: "unsupported",
        severity: "warning",
        reason: "Use a supported image.",
      }],
    }), ["missing.jpg"])).toMatchObject({
      severity: "error",
      title: "Added 1 original; 2 items need attention.",
      details: [
        { severity: "warning", text: "animation.gif: Use a supported image." },
        { severity: "error", text: "missing.jpg: FotoReady could not access this local file." },
      ],
    });
  });

  it("treats a drop with no accessible local paths as a failed operation", () => {
    expect(inaccessibleOriginalImportFeedback(["protected.jpg"])).toMatchObject({
      severity: "error",
      title: "Originals could not be added.",
      details: [{ severity: "error", text: "protected.jpg: FotoReady could not access this local file." }],
    });
  });

  it("clears pathless receiver feedback only after a later committed Originals import", () => {
    const prior = inaccessibleOriginalImportFeedback(["protected.jpg"]);

    expect(settleOriginalImportFeedback(prior, result({ canceled: true }))).toBe(prior);
    expect(settleOriginalImportFeedback(prior, result())).toBe(prior);
    expect(settleOriginalImportFeedback(prior, result({
      addedOriginals: 1,
      succeededPaths: ["/photos/available.jpg"],
    }))).toBeNull();
  });

  it("clears a prior issue only when a successful retry resolves the same path", () => {
    const prior = buildOriginalImportFeedback(result({
      issues: [{
        filePath: "/photos/retry.jpg",
        kind: "failed",
        severity: "error",
        reason: "FotoReady could not read this image.",
      }],
    }));
    if (!prior) throw new Error("feedback not built");

    expect(settleOriginalImportFeedback(prior, result({
      addedOriginals: 1,
      succeededPaths: ["/photos/retry.jpg"],
    }))).toBeNull();

    expect(settleOriginalImportFeedback(prior, result({
      addedOriginals: 1,
      succeededPaths: ["/photos/unrelated.jpg"],
    }))).toBe(prior);
  });

  it("removes only the corrected item from a multi-issue result", () => {
    const prior = buildOriginalImportFeedback(result({
      addedOriginals: 1,
      issues: [
        { filePath: "/photos/first.jpg", kind: "failed", severity: "error", reason: "Could not read." },
        { filePath: "/photos/second.gif", kind: "unsupported", severity: "warning", reason: "Unsupported." },
      ],
    }));
    if (!prior) throw new Error("feedback not built");

    expect(settleOriginalImportFeedback(prior, result({
      addedOriginals: 1,
      succeededPaths: ["/photos/first.jpg"],
    }))).toMatchObject({
      severity: "warning",
      title: "Added 1 original; 1 item needs attention.",
      details: [{ severity: "warning", text: "second.gif: Unsupported." }],
    });
  });

  it("clears a queue-refresh error after the next successful refresh, even on dialog cancellation", () => {
    expect(settleOriginalImportFeedback(queueRefreshFailureFeedback(), result({ canceled: true }))).toBeNull();
  });
});
