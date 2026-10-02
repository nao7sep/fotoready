import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "@main/logger";
import { openRecordsStore, type RecordsStore } from "@main/records-store";

let root: string;
let records: RecordsStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-log-"));
  records = openRecordsStore(path.join(root, "records.sqlite3"), path.join(root, "logs"));
});

afterEach(() => {
  records.close();
  fs.rmSync(root, { recursive: true, force: true });
});

type Row = { time: string; level: string; message: string; fields: string };

function readRows(): Row[] {
  const db = new DatabaseSync(path.join(root, "records.sqlite3"));
  try {
    return db.prepare("SELECT time, level, message, fields FROM log_records ORDER BY id").all() as unknown as Row[];
  } finally {
    db.close();
  }
}

/** Each stored log record as one object: the envelope with its fields. */
function readLines(): Array<Record<string, unknown>> {
  return readRows().map(({ time, level, message, fields }) => ({ ...JSON.parse(fields), time, level, message }));
}

const ISO_MS_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("createLogger", () => {
  it("writes one record per line with the time/level/message envelope plus fields", () => {
    const logger = createLogger(records, { debug: false });
    logger.info("hello", { mod: "test", count: 3 });
    logger.close();

    const lines = readLines();
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line.time).toMatch(ISO_MS_Z);
    expect(line.level).toBe("info");
    expect(line.message).toBe("hello");
    expect(line.mod).toBe("test");
    expect(line.count).toBe(3);
  });

  it("drops debug lines unless the debug gate is on", () => {
    createLogger(records, { debug: false }).debug("nope", { mod: "test" });
    expect(readLines()).toHaveLength(0);

    createLogger(records, { debug: true }).debug("yep", { mod: "test" });
    expect(readLines()).toHaveLength(1);
  });

  it("expands an Error in the fields to type, message, and stack", () => {
    const logger = createLogger(records, { debug: false });
    logger.error("boom", { mod: "test", err: new TypeError("bad thing") });
    logger.close();

    const [line] = readLines();
    const err = line.err as Record<string, unknown>;
    expect(err.name).toBe("TypeError");
    expect(err.message).toBe("bad thing");
    expect(typeof err.stack).toBe("string");
  });

  it("keeps an Error's own diagnostic properties", () => {
    const logger = createLogger(records, { debug: false });
    const err = Object.assign(new Error("disk gone"), { code: "ENOENT", errno: -2 });
    logger.error("io failed", { mod: "test", err });
    logger.close();

    const [line] = readLines();
    const serialized = line.err as Record<string, unknown>;
    expect(serialized.message).toBe("disk gone");
    expect(serialized.code).toBe("ENOENT");
    expect(serialized.errno).toBe(-2);
  });

  it("expands a wrapped error's cause chain", () => {
    const logger = createLogger(records, { debug: false });
    const wrapper = new Error("wrapper", { cause: new Error("root cause") });
    logger.error("boom", { err: wrapper });
    logger.close();

    const [line] = readLines();
    const cause = (line.err as Record<string, unknown>).cause as Record<string, unknown>;
    expect(cause.name).toBe("Error");
    expect(cause.message).toBe("root cause");
  });

  it("serializes Maps and Sets to their entries instead of empty objects", () => {
    const logger = createLogger(records, { debug: false });
    logger.info("collections", { map: new Map([["a", 1]]), set: new Set([1, 2, 2]) });
    logger.close();

    const [line] = readLines();
    expect(line.map).toEqual([["a", 1]]);
    expect(line.set).toEqual([1, 2]);
  });

  it("preserves aggregate failures and nested causes in the log", () => {
    const logger = createLogger(records, { debug: false });
    const original = new TypeError("query failed", { cause: new Error("query cause") });
    const fallback = Object.assign(new Error("fallback failed"), {
      operation: "NativeQuery", nativeCode: 1400,
    });
    logger.error("native operation failed", { err: new AggregateError([original, fallback], "both failed", { cause: original }) });
    logger.close();
    const [line] = readLines();
    expect(line.err).toMatchObject({ name: "AggregateError", cause: { message: "query failed" }, errors: [
      { name: "TypeError", message: "query failed", stack: expect.any(String), cause: { message: "query cause" } },
      { message: "fallback failed", stack: expect.any(String), operation: "NativeQuery", nativeCode: 1400 }
    ] });
  });

  it("contains cycles through aggregate members without losing other failures", () => {
    const logger = createLogger(records, { debug: false });
    const aggregate = new AggregateError([], "cyclic");
    aggregate.errors.push(aggregate, new Error("retained"));
    logger.error("native operation failed", { err: aggregate });
    logger.close();
    const [line] = readLines();
    expect(line.err).toMatchObject({ errors: ["[circular]", { message: "retained" }] });
  });

  it("summarizes binary blobs instead of dumping bytes", () => {
    const logger = createLogger(records, { debug: false });
    logger.info("binary", { buf: Buffer.from("hello"), arr: new Uint8Array([1, 2, 3]) });
    logger.close();

    const [line] = readLines();
    expect(line.buf).toBe("[Buffer bytes=5]");
    expect(line.arr).toBe("[Uint8Array bytes=3]");
  });

  it("preserves a field named __proto__ as data without polluting the prototype", () => {
    const logger = createLogger(records, { debug: false });
    // Built the way it arrives from JSON over IPC: an own enumerable key.
    const fields = JSON.parse('{"__proto__": {"polluted": true}, "mod": "test"}');
    logger.warn("proto", fields);
    logger.close();

    const raw = readRows()[0]!.fields;
    // the field survives in the serialized line ...
    expect(raw).toContain('"__proto__"');
    // ... and serializing it did not pollute Object.prototype
    expect((({}) as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("never lets fields overwrite the reserved envelope keys", () => {
    const logger = createLogger(records, { debug: false });
    logger.info("real message", { time: "fake", level: "fake", message: "fake" });
    logger.close();

    const [line] = readLines();
    expect(line.time).toMatch(ISO_MS_Z);
    expect(line.level).toBe("info");
    expect(line.message).toBe("real message");
  });

  it("has an idempotent close", () => {
    const logger = createLogger(records, { debug: false });
    logger.info("once", {});
    expect(() => {
      logger.close();
      logger.close();
    }).not.toThrow();
  });
});
