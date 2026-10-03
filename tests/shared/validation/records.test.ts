import { describe, expect, it } from "vitest";
import { assertRecordId, assertRecordKind, parseRecordsQuery } from "@shared/validation/records";

const ALL = { session: null, kind: null, level: null, taskId: null, search: "", after: null };

describe("parseRecordsQuery", () => {
  it("accepts every filter off, and every filter set", () => {
    expect(parseRecordsQuery(ALL)).toEqual(ALL);
    const full = {
      session: "2026-10-02T08:00:00.000Z", kind: "provider-call", level: "attention", taskId: "task-1", search: "quota",
      after: { time: "2026-10-02T08:00:01.000Z", kind: "log", id: 4 }
    };
    expect(parseRecordsQuery(full)).toEqual(full);
  });

  it("refuses what the database must not be asked", () => {
    expect(() => parseRecordsQuery(null)).toThrow("query must be an object.");
    expect(() => parseRecordsQuery({ ...ALL, kind: "notice" })).toThrow("query.kind");
    expect(() => parseRecordsQuery({ ...ALL, level: "fatal" })).toThrow("query.level");
    expect(() => parseRecordsQuery({ ...ALL, search: 1 })).toThrow("query.search");
    expect(() => parseRecordsQuery({ ...ALL, taskId: 3 })).toThrow("query.taskId");
    expect(() => parseRecordsQuery({ ...ALL, after: { time: "t", kind: "log", id: 1.5 } })).toThrow("query.after.id");
  });

  it("keeps only the fields it knows", () => {
    expect(parseRecordsQuery({ ...ALL, extra: "DROP TABLE" })).toEqual(ALL);
  });
});

describe("record kind and id", () => {
  it("accept only a kind and an integer", () => {
    expect(assertRecordKind("log")).toBe("log");
    expect(() => assertRecordKind("other")).toThrow();
    expect(assertRecordId(7)).toBe(7);
    expect(() => assertRecordId("7")).toThrow();
  });
});
