import { describe, expect, it } from "vitest";
import { metadataPolicy } from "@main/metadata-policy";
import { defaultPipeline } from "@shared/defaults";
import type { Task } from "@shared/types/project";
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

describe("metadataPolicy", () => {
  it("returns an inert policy when there are no metadata ops", () => {
    const policy = metadataPolicy(makeTask([]));
    expect(policy).toEqual({ stripActive: false, keep: [], injectFields: {} });
  });

  it("activates strip and records the kept groups", () => {
    const policy = metadataPolicy(
      makeTask([{ id: "s", type: "strip-metadata", enabled: true, params: { keep: ["editorial"] } }])
    );
    expect(policy.stripActive).toBe(true);
    expect(policy.keep).toEqual(["editorial"]);
  });

  it("ignores a disabled strip op", () => {
    const policy = metadataPolicy(
      makeTask([{ id: "s", type: "strip-metadata", enabled: false, params: { keep: ["editorial"] } }])
    );
    expect(policy.stripActive).toBe(false);
  });

  it("collects inject fields", () => {
    const policy = metadataPolicy(
      makeTask([{ id: "i", type: "inject-metadata", enabled: true, params: { fields: { author: "Jane" } } }])
    );
    expect(policy.injectFields).toEqual({ author: "Jane" });
  });

  it("combines a strip and an inject op", () => {
    const policy = metadataPolicy(
      makeTask([
        { id: "s", type: "strip-metadata", enabled: true, params: { keep: ["gps"] } },
        { id: "i", type: "inject-metadata", enabled: true, params: { fields: { credit: "Studio" } } }
      ])
    );
    expect(policy.stripActive).toBe(true);
    expect(policy.keep).toEqual(["gps"]);
    expect(policy.injectFields).toEqual({ credit: "Studio" });
  });
});
