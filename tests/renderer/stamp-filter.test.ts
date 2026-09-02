import { describe, expect, it } from "vitest";
import type { StampEntry } from "@shared/types/ipc";
import { filterStampsByGroup, initialStampGroupFilter } from "@renderer/stamp-filter";

const stamps: StampEntry[] = [
  { slug: "cover-blob", name: "Cover blob", path: "/cover-blob.png", format: "png", builtin: true, groupId: "cover" },
  { slug: "heart", name: "Heart", path: "/heart.png", format: "png", builtin: true, groupId: "marks" },
  { slug: "laughing-face", name: "Laughing face", path: "/laughing-face.png", format: "png", builtin: true, groupId: "reactions" },
  { slug: "googly-eyes", name: "Googly eyes", path: "/googly-eyes.png", format: "png", builtin: true, groupId: "funny" },
  { slug: "mine", name: "mine.svg", path: "/mine.svg", format: "svg", builtin: false, groupId: "imported" }
];

describe("filterStampsByGroup", () => {
  it("keeps the complete order for All and isolates each stored group", () => {
    expect(filterStampsByGroup(stamps, "all").map((stamp) => stamp.slug)).toEqual(["cover-blob", "heart", "laughing-face", "googly-eyes", "mine"]);
    expect(filterStampsByGroup(stamps, "cover").map((stamp) => stamp.slug)).toEqual(["cover-blob"]);
    expect(filterStampsByGroup(stamps, "funny").map((stamp) => stamp.slug)).toEqual(["googly-eyes"]);
    expect(filterStampsByGroup(stamps, "imported").map((stamp) => stamp.slug)).toEqual(["mine"]);
  });

  it("returns an empty visible collection for an unfilled group", () => {
    expect(filterStampsByGroup(stamps, "bubbles")).toEqual([]);
  });

  it("starts in the selected stamp's group, then Reactions, then the first populated group", () => {
    expect(initialStampGroupFilter(stamps, "/mine.svg")).toBe("imported");
    expect(initialStampGroupFilter(stamps, "")).toBe("reactions");
    expect(initialStampGroupFilter(stamps.filter((stamp) => stamp.groupId !== "reactions"), "")).toBe("cover");
    expect(initialStampGroupFilter([], "")).toBe("all");
  });
});
