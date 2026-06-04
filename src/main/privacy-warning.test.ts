import { describe, expect, it } from "vitest";
import { computePrivacyWarning } from "@main/privacy-warning";
import { defaultPipeline } from "@shared/defaults";
import type { Original, SourceMetadataSummary, Task } from "@shared/types/project";
import type { OpInstance } from "@shared/types/op";

function makeTask(ops: OpInstance[]): Task {
  return {
    id: "task-1",
    originalId: "orig-1",
    generateDescription: false,
    generateSlug: false,
    customSlug: null,
    visionRunning: false,
    visionRunMode: null,
    pipeline: { ...defaultPipeline(), ops },
    status: "not-saved",
    output: null,
    error: null,
    everEdited: false,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z"
  };
}

function makeOriginal(summary: SourceMetadataSummary): Original {
  return {
    id: "orig-1",
    sourcePath: "/photos/DSC_0001.jpg",
    sourceHash: "hash",
    size: 1000,
    format: "jpeg",
    jpegQualityEstimate: 85,
    metadataSummary: summary,
    width: 4000,
    height: 3000,
    addedAt: "2026-06-04T00:00:00.000Z"
  };
}

const fullSummary: SourceMetadataSummary = {
  editorial: { author: "Jane" },
  dates: { DateTimeOriginal: "2026:01:01 00:00:00" },
  gps: { GPSLatitude: "35.0" }
};

const stripOp = (keep: string[]): OpInstance => ({
  id: "s",
  type: "strip-metadata",
  enabled: true,
  params: { keep }
});

describe("computePrivacyWarning", () => {
  it("warns about every group with data when there is no strip card", () => {
    const warning = computePrivacyWarning(makeTask([]), makeOriginal(fullSummary));
    expect(warning).toEqual({ kept: ["editorial", "dates", "gps"] });
  });

  it("returns null when the source has no editorial/time/gps data", () => {
    const warning = computePrivacyWarning(
      makeTask([]),
      makeOriginal({ editorial: {}, dates: {}, gps: {} })
    );
    expect(warning).toBeNull();
  });

  it("treats whitespace-only and empty values as no data", () => {
    const warning = computePrivacyWarning(
      makeTask([]),
      makeOriginal({ editorial: { author: "   " }, dates: {}, gps: {} })
    );
    expect(warning).toBeNull();
  });

  it("narrows the warning to the kept groups when a strip card keeps a subset", () => {
    const warning = computePrivacyWarning(makeTask([stripOp(["editorial"])]), makeOriginal(fullSummary));
    expect(warning).toEqual({ kept: ["editorial"] });
  });

  it("returns null when the strip card removes every group that has data", () => {
    const warning = computePrivacyWarning(makeTask([stripOp([])]), makeOriginal(fullSummary));
    expect(warning).toBeNull();
  });

  it("only flags a kept group that actually has data", () => {
    const warning = computePrivacyWarning(
      makeTask([stripOp(["editorial", "gps"])]),
      makeOriginal({ editorial: { author: "Jane" }, dates: {}, gps: {} })
    );
    expect(warning).toEqual({ kept: ["editorial"] });
  });
});
