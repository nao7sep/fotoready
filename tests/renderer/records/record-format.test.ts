import { describe, expect, it } from "vitest";
import { cursorAfter, mergeNewestPage, prettyJson, recordKey, roleLabel } from "@renderer/records/record-format";
import type { RecordSummary } from "@shared/records";

const row = (id: number, time: string, title = `row ${id}`): RecordSummary => ({
  kind: "log", id, session: "s", time, level: "info", title, text: null, taskId: null
});

const a = row(1, "2026-10-02T08:00:01.000Z");
const b = row(2, "2026-10-02T08:00:02.000Z");
const c = row(3, "2026-10-02T08:00:03.000Z");
const d = row(4, "2026-10-02T08:00:04.000Z");
const keys = (records: RecordSummary[]) => records.map(recordKey);

describe("mergeNewestPage", () => {
  it("puts new records ahead of the rows shown and keeps the pages already read", () => {
    const merged = mergeNewestPage([c, b, a], true, { records: [d, c], more: true });
    expect(keys(merged.records)).toEqual(keys([d, c, b, a]));
    expect(merged.more).toBe(true);
  });

  it("takes the page's word on whether more follow when it reaches past every row shown", () => {
    expect(mergeNewestPage([b], true, { records: [c, b, a], more: false }).more).toBe(false);
  });

  it("loses nothing to an older page that arrives after a newer one", () => {
    const merged = mergeNewestPage([d, c, b, a], true, { records: [c, b], more: true });
    expect(keys(merged.records)).toEqual(keys([d, c, b, a]));
    expect(merged.more).toBe(true);
  });

  it("takes the page's copy of a row it shares with the list", () => {
    const fresh = { ...c, title: "fresh" };
    expect(mergeNewestPage([c], false, { records: [fresh], more: false }).records[0]!.title).toBe("fresh");
  });

  it("orders a provider call ahead of a log line at the same time, as the database pages them", () => {
    const call: RecordSummary = { ...b, kind: "provider-call", id: 1 };
    expect(keys(mergeNewestPage([b], false, { records: [call], more: false }).records)).toEqual(["provider-call:1", "log:2"]);
  });
});

describe("record formatting", () => {
  it("indents stored JSON and shows other text as it is", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("not json")).toBe("not json");
  });

  it("starts the next page after the last row shown", () => {
    expect(cursorAfter([c, b])).toEqual({ time: b.time, kind: "log", id: 2 });
    expect(cursorAfter([])).toBeNull();
  });

  it("names the app's own AI roles and leaves any other as stored", () => {
    expect(roleLabel("description")).toBe("output.description");
    expect(roleLabel("slug")).toBe("output.slug");
    expect(roleLabel("toString")).toBeNull();
  });
});
