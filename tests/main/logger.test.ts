import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@main/logger";

let logsDir: string;

beforeEach(() => {
  logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-log-"));
});

afterEach(() => {
  fs.rmSync(logsDir, { recursive: true, force: true });
});

function readLines(dir: string): Array<Record<string, unknown>> {
  const file = fs.readdirSync(dir).find((entry) => entry.endsWith(".log"));
  if (!file) return [];
  return fs
    .readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const ISO_MS_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("createLogger", () => {
  it("names the session file with a UTC millisecond stamp and nothing else", () => {
    createLogger(logsDir, { debug: false }).close();
    const file = fs.readdirSync(logsDir).find((entry) => entry.endsWith(".log"));
    expect(file).toMatch(/^\d{8}-\d{6}-\d{3}-utc\.log$/);
  });

  it("writes one JSON object per line with the time/level/message envelope plus fields", () => {
    const logger = createLogger(logsDir, { debug: false });
    logger.info("hello", { mod: "test", count: 3 });
    logger.close();

    const lines = readLines(logsDir);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line.time).toMatch(ISO_MS_Z);
    expect(line.level).toBe("info");
    expect(line.message).toBe("hello");
    expect(line.mod).toBe("test");
    expect(line.count).toBe(3);
  });

  it("drops debug lines unless the debug gate is on", () => {
    const off = createLogger(logsDir, { debug: false });
    off.debug("nope", { mod: "test" });
    off.close();
    expect(readLines(logsDir)).toHaveLength(0);

    const onDir = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-log-"));
    const on = createLogger(onDir, { debug: true });
    on.debug("yep", { mod: "test" });
    on.close();
    expect(readLines(onDir)).toHaveLength(1);
    fs.rmSync(onDir, { recursive: true, force: true });
  });

  it("redacts denied keys non-destructively by exact, case-insensitive name", () => {
    const logger = createLogger(logsDir, { debug: false });
    logger.warn("careful with passwords in here", {
      apiKey: "sk-123",
      Token: "abc",
      tokenCount: 42,
      keep: "ok",
      nested: { password: "hunter2", note: "fine" }
    });
    logger.close();

    const [line] = readLines(logsDir);
    expect(line.apiKey).toBe("[redacted]");
    expect(line.Token).toBe("[redacted]");
    // exact match only — `tokenCount` is not `token`
    expect(line.tokenCount).toBe(42);
    expect(line.keep).toBe("ok");
    expect((line.nested as Record<string, unknown>).password).toBe("[redacted]");
    expect((line.nested as Record<string, unknown>).note).toBe("fine");
    // the message is never scrubbed, even when it contains a denied word
    expect(line.message).toBe("careful with passwords in here");
  });

  it("expands an Error in the fields to type, message, and stack", () => {
    const logger = createLogger(logsDir, { debug: false });
    logger.error("boom", { mod: "test", err: new TypeError("bad thing") });
    logger.close();

    const [line] = readLines(logsDir);
    const err = line.err as Record<string, unknown>;
    expect(err.name).toBe("TypeError");
    expect(err.message).toBe("bad thing");
    expect(typeof err.stack).toBe("string");
  });

  it("keeps an Error's own diagnostic properties and redacts denied ones", () => {
    const logger = createLogger(logsDir, { debug: false });
    const err = Object.assign(new Error("disk gone"), { code: "ENOENT", errno: -2, token: "sk-secret" });
    logger.error("io failed", { mod: "test", err });
    logger.close();

    const [line] = readLines(logsDir);
    const serialized = line.err as Record<string, unknown>;
    expect(serialized.message).toBe("disk gone");
    expect(serialized.code).toBe("ENOENT");
    expect(serialized.errno).toBe(-2);
    // a denied key carried on the error object is still redacted
    expect(serialized.token).toBe("[redacted]");
  });

  it("expands a wrapped error's cause chain", () => {
    const logger = createLogger(logsDir, { debug: false });
    const wrapper = new Error("wrapper", { cause: new Error("root cause") });
    logger.error("boom", { err: wrapper });
    logger.close();

    const [line] = readLines(logsDir);
    const cause = (line.err as Record<string, unknown>).cause as Record<string, unknown>;
    expect(cause.name).toBe("Error");
    expect(cause.message).toBe("root cause");
  });

  it("serializes Maps and Sets to their entries instead of empty objects", () => {
    const logger = createLogger(logsDir, { debug: false });
    logger.info("collections", { map: new Map([["a", 1]]), set: new Set([1, 2, 2]) });
    logger.close();

    const [line] = readLines(logsDir);
    expect(line.map).toEqual([["a", 1]]);
    expect(line.set).toEqual([1, 2]);
  });

  it("summarizes binary blobs instead of dumping bytes", () => {
    const logger = createLogger(logsDir, { debug: false });
    logger.info("binary", { buf: Buffer.from("hello"), arr: new Uint8Array([1, 2, 3]) });
    logger.close();

    const [line] = readLines(logsDir);
    expect(line.buf).toBe("[Buffer bytes=5]");
    expect(line.arr).toBe("[Uint8Array bytes=3]");
  });

  it("preserves a field named __proto__ as data without polluting the prototype", () => {
    const logger = createLogger(logsDir, { debug: false });
    // Built the way it arrives from JSON over IPC: an own enumerable key.
    const fields = JSON.parse('{"__proto__": {"polluted": true}, "mod": "test"}');
    logger.warn("proto", fields);
    logger.close();

    const file = fs.readdirSync(logsDir).find((entry) => entry.endsWith(".log"))!;
    const raw = fs.readFileSync(path.join(logsDir, file), "utf8");
    // the field survives in the serialized line ...
    expect(raw).toContain('"__proto__"');
    // ... and serializing it did not pollute Object.prototype
    expect((({}) as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("never lets fields overwrite the reserved envelope keys", () => {
    const logger = createLogger(logsDir, { debug: false });
    logger.info("real message", { time: "fake", level: "fake", message: "fake" });
    logger.close();

    const [line] = readLines(logsDir);
    expect(line.time).toMatch(ISO_MS_Z);
    expect(line.level).toBe("info");
    expect(line.message).toBe("real message");
  });

  it("never deletes existing logs (no retention)", () => {
    const stale = path.join(logsDir, "20200101-000000-utc.log");
    fs.writeFileSync(stale, "{}\n");
    createLogger(logsDir, { debug: false }).close();
    expect(fs.existsSync(stale)).toBe(true);
  });

  it("degrades to the console when the log file cannot be opened, and never throws", () => {
    const blocker = path.join(logsDir, "blocker");
    fs.writeFileSync(blocker, "x"); // a file where a directory is expected
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = createLogger(blocker, { debug: false });
    expect(() => logger.info("still alive", { mod: "test" })).not.toThrow();
    expect(logSpy).toHaveBeenCalled();

    logger.close();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("has an idempotent close", () => {
    const logger = createLogger(logsDir, { debug: false });
    logger.info("once", {});
    expect(() => {
      logger.close();
      logger.close();
    }).not.toThrow();
  });

  it("degrades the second same-millisecond session to the console instead of interleaving into one file", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T03:15:42.123Z"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const first = createLogger(logsDir, { debug: false });
      first.info("first session", { mod: "test" });

      // Same launch instant -> same filename -> the exclusive-create open must
      // fail for the second logger rather than appending into the first file.
      const second = createLogger(logsDir, { debug: false });
      second.info("second session", { mod: "test" });

      const logFiles = fs.readdirSync(logsDir).filter((entry) => entry.endsWith(".log"));
      expect(logFiles).toHaveLength(1);

      const lines = readLines(logsDir);
      expect(lines).toHaveLength(1);
      expect(lines[0].message).toBe("first session");

      // The second session's line went to the console fallback, not the file.
      expect(logSpy).toHaveBeenCalled();

      first.close();
      second.close();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
