import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiVisionProvider } from "@adapters/gemini";
import { ApiKeyStore } from "@adapters/api-keys";
import { createLogger } from "@main/logger";
import { createRecordsStore, droppedRecordsRow, fallbackFile } from "@main/records-store";
import { startStoreWriter } from "@main/store-writer";

// Credentials never reach a persistent, console or event sink (developer decision): a fake key goes
// through a description, a provider failure and a malformed key file, then every sink is searched for
// it and for its stored `obf:` form.

const FAKE_KEY = "fake-credential-k3Jq9xZaP2";
const STORED = `obf:${Buffer.from(FAKE_KEY, "utf8").reverse().toString("base64")}`;

let root: string;
let consoleText: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fotoready-credentials-"));
  consoleText = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleText.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    });
  }
  vi.stubEnv("GEMINI_API_KEY", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

describe.each([
  ["the records database", false],
  ["the fallback text file", true],
])("credentials in %s", (_label, databaseUnavailable) => {
  it("are absent after a description, a provider failure and a malformed key file", async () => {
    const recordsPath = path.join(root, "records.sqlite3");
    if (databaseUnavailable) fs.mkdirSync(recordsPath);
    const sessionStart = new Date("2026-10-09T06:00:00.000Z");
    const writer = startStoreWriter({
      recordsPath, backupsPath: path.join(root, "backups.sqlite3"), fallbackPath: fallbackFile(path.join(root, "logs"), sessionStart),
      session: sessionStart.toISOString(), droppedRecord: droppedRecordsRow, onWarning: () => {}
    });
    const records = createRecordsStore(writer, sessionStart);
    const logger = createLogger(records, { debug: true });

    const replies = [
      new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A harbor." }] } }] })),
      new Response(JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }), { status: 400 })
    ];
    vi.stubGlobal("fetch", vi.fn(async () => replies.shift()!));
    const provider = new GeminiVisionProvider(FAKE_KEY, "https://models.example", (call) => records.writeProviderCall({ ...call, taskId: "task-1", provider: "gemini" }));
    const options = { model: "gemini-3.8-flash", thinking: null, mediaResolution: "high" as const, descriptionPrompt: "Describe", timeoutMs: 5_000, maxRetries: 0, initialBackoffMs: 1 };
    const image = { imageBytes: Buffer.from("image"), mimeType: "image/jpeg" as const, width: 4, height: 3, sourcePath: path.join(root, "photo.jpg") };

    await expect(provider.describeImage(image, options)).resolves.toBe("A harbor.");
    const failure = await provider.describeImage(image, options).catch((error: unknown) => error);
    logger.error("vision task failed", { mod: "vision", taskId: "task-1", err: failure });

    const keysPath = path.join(root, "api-keys.json");
    fs.writeFileSync(keysPath, `{"formatVersion":1,"keys":{"gemini":${STORED}}}`, { mode: 0o600 });
    await expect(new ApiKeyStore(keysPath, logger).resolve("gemini")).resolves.toBeNull();

    expect(await writer.close({ drain: true, timeoutMs: 10_000 })).toBe(true);

    const sinks = [...filesUnder(path.join(root, "logs")), ...filesUnder(root).filter((file) => path.basename(file).startsWith("records.sqlite3"))];
    expect(sinks.length).toBeGreaterThan(0);
    const contents = sinks.map((file) => fs.readFileSync(file).toString("latin1"));
    for (const text of [...contents, ...consoleText]) {
      expect(text).not.toContain(FAKE_KEY);
      // The parser's own message quotes only a few characters past the point it stopped, `obf:` included.
      expect(text).not.toContain("obf:");
      expect(text).not.toContain(STORED.slice(4, 10));
    }
    // The malformed file's warning names its kind and position, not the parser's text.
    const warned = contents.join("\n");
    expect(warned).toContain("SyntaxError");
  });
});
