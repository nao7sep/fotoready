import { describe, expect, it } from "vitest";
import { renderFilenameTemplate } from "./template-render";

describe("renderFilenameTemplate", () => {
  it("renders padded indexes, hashes, and dates", () => {
    const rendered = renderFilenameTemplate(
      "{slug}-{index:03}-{hash:8}-{date:saved|utc|yyyymmdd}.{ext}",
      {
        slug: "green-square",
        w: 1200,
        h: 800,
        ext: "jpg",
        outputHash: "abcdef1234567890",
        index: 7,
        savedAt: "2026-05-12T09:10:11Z",
        sourceFileMtime: "2026-05-10T00:00:00Z",
        now: "2026-05-12T09:10:11Z",
        takenAt: null
      }
    );

    expect(rendered).toBe("green-square-007-abcdef12-20260512.jpg");
  });
});
