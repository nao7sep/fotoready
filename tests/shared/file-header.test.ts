import { describe, expect, it } from "vitest";
import { checkFormat, headeredJson, parseHeaderedJson } from "@shared/file-header";

const writer = { name: "fotoready", version: "1.0.0" };

describe("the file identity header", () => {
  it("writes format and writer first, then the content", () => {
    const text = headeredJson("state", writer, { showHistogram: true });
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["format", "writer", "showHistogram"]);
    expect(JSON.parse(text)).toEqual({
      format: { owner: "fotoready", kind: "state", version: 1 },
      writer: { name: "fotoready", version: "1.0.0" },
      showHistogram: true
    });
  });

  it("reads its own file back as the content alone", () => {
    expect(parseHeaderedJson(headeredJson("config", writer, { a: 1 }), "config")).toEqual({ kind: "current", body: { a: 1 } });
  });

  it.each([
    ["no header", { a: 1 }],
    ["a format that is not an object", { format: 1, a: 1 }],
    ["another owner", { format: { owner: "gptimg", kind: "sidecar", version: 1 } }],
    ["another kind", { format: { owner: "fotoready", kind: "config", version: 1 } }],
    ["a version that is not a positive integer", { format: { owner: "fotoready", kind: "sidecar", version: 0 } }],
    ["a version given as text", { format: { owner: "fotoready", kind: "sidecar", version: "1" } }]
  ])("refuses a file with %s as invalid", (_label, root) => {
    expect(parseHeaderedJson(JSON.stringify(root), "sidecar").kind).toBe("invalid");
  });

  it("reports a newer version without reading the content", () => {
    expect(parseHeaderedJson(JSON.stringify({ format: { owner: "fotoready", kind: "sidecar", version: 2 } }), "sidecar")).toEqual({ kind: "newer", found: 2 });
  });

  it("ignores writer entirely, and unknown keys inside format", () => {
    for (const writerValue of [undefined, null, "anything", { name: "gptimgsdk", version: "9", caller: { name: "x" } }]) {
      const text = JSON.stringify({ format: { owner: "fotoready", kind: "sidecar", version: 1, later: true }, writer: writerValue, a: 1 });
      expect(parseHeaderedJson(text, "sidecar")).toEqual({ kind: "current", body: { a: 1 } });
    }
    expect(checkFormat({ owner: "fotoready", kind: "records", version: 1 }, "records")).toEqual({ kind: "current" });
  });
});
