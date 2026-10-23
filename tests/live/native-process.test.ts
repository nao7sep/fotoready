// Local qualification of the built native helper. Requires npm run build first; no provider calls.
// Metrics cover the helper process (including Sharp), not its ExifTool descendants. Peak RSS is
// cumulative for a reused process, so it calibrates admission estimates rather than cache eviction.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NativeProcessPool, NativeJobRetiringError } from "@main/workers/native-pool";
import type { NativeJob } from "@main/workers/pipeline-pool";
import { getOpDefinition } from "@core/ops/catalog";
import { defaultOutputSettings } from "@shared/defaults";
import { FORMAT_VERSIONS, versionedJson } from "@shared/format-versions";
import { saveCost } from "@main/queues/save-admission";
import { maximumPipelinePixels } from "@shared/pipeline-geometry";
import { createTaskSidecar } from "@shared/task-sidecar";
import type { TaskSidecarLoadResult } from "@main/task-sidecar";
import type { OpInstance } from "@shared/types/op";
import type { Pipeline } from "@shared/types/pipeline";
import type { Original } from "@shared/types/project";
import type { WorkerResult } from "@runtime/image";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ENTRY = path.join(REPO, "out/main/workers/pipeline-process.js");
const CORPUS = path.join(REPO, "../company/assets/test-fixtures");
type Metrics = { pid: number; elapsedMs: number; maxRssKiB: number; rss: number; baselineRss: number };
type Measured<T> = T & { qualification: Metrics };
type Result = WorkerResult | { kind: "original"; original: Original } | { kind: "sidecar"; result: TaskSidecarLoadResult };
let root: string;
let wrapper: string;
const pools: NativeProcessPool[] = [];
const metrics: Array<{ recipe: string; pixels: number; costMiB: number; deadlineMs: number } & Metrics> = [];

function pool(totalMemory?: number): NativeProcessPool {
  const owner = new NativeProcessPool(wrapper, 2, totalMemory);
  pools.push(owner);
  return owner;
}
function op(type: string, params: Record<string, unknown> = {}): OpInstance {
  const definition = getOpDefinition(type);
  if (!definition) throw new Error(`Unknown operation: ${type}`);
  return { id: type, type, enabled: true, params: { ...structuredClone(definition.defaultParams), ...params } };
}
function pipeline(ops: OpInstance[] = []): Pipeline {
  return { ops, output: { ...defaultOutputSettings(), format: "jpeg", quality: 90 } };
}
function run(owner: NativeProcessPool, job: NativeJob, deadlineMs = 60_000, cost = 32 * 1024 * 1024): Promise<Measured<Result>> {
  return owner.run(() => job, { lane: "background", cost, deadlineMs, queueMs: deadlineMs,
    ...(job.kind === "process" ? { outputPath: job.outputPath } : {}) });
}

beforeAll(async () => {
  await fs.access(ENTRY).catch(() => { throw new Error("Build FotoReady with npm run build before running the native-process live test."); });
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-native-live-"));
  wrapper = path.join(root, "measured-worker.mjs");
  // Instrument only this disposable entry wrapper; the production message/result path stays real.
  await fs.writeFile(wrapper, `
import fs from 'node:fs';
let baselineRss = 0;
let started = process.hrtime.bigint();
const send = process.send.bind(process);
process.send = (message, ...args) => send({ ...message, qualification: {
  pid: process.pid, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
  maxRssKiB: process.resourceUsage().maxRSS, rss: process.memoryUsage().rss, baselineRss
}}, ...args);
await import(${JSON.stringify(pathToFileURL(ENTRY).href)});
baselineRss = process.memoryUsage().rss;
process.prependListener('message', (job) => {
  started = process.hrtime.bigint();
  fs.appendFileSync(${JSON.stringify(path.join(root, "jobs.jsonl"))}, JSON.stringify({ pid: process.pid, kind: job.kind, sourcePath: job.sourcePath }) + '\\n');
});
`);
});
afterAll(async () => {
  await Promise.all(pools.map((owner) => owner.destroy()));
  if (metrics.length) {
    const resultsDir = path.join(REPO, "node_modules/.cache/fotoready-live");
    await fs.mkdir(resultsDir, { recursive: true });
    await fs.writeFile(path.join(resultsDir, "native-process-qualification.json"), JSON.stringify(metrics, null, 2) + "\n");
    console.info("Native process qualification", JSON.stringify(metrics));
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("built native process", () => {
  it("runs the compiled helper in installed Electron's Node runtime and exits on disconnect", async () => {
    // Read the installation directly: electron's package entry may download a missing executable.
    const electronDir = path.join(REPO, "node_modules/electron");
    const installedPath = (await fs.readFile(path.join(electronDir, "path.txt"), "utf8")).trim();
    const executable = path.join(electronDir, "dist", installedPath);
    await fs.access(executable);
    const coordinator = path.join(root, "electron-coordinator.mjs");
    // Advanced IPC serializes V8 data. Run both peers in Electron, matching production; a newer
    // host Node cannot deserialize an older Electron's V8 payload. Only JSON stdout crosses back.
    await fs.writeFile(coordinator, `
import { fork } from 'node:child_process';
const child = fork(${JSON.stringify(ENTRY)}, [], {
  execPath: process.execPath, execArgv: [], serialization: 'advanced',
  detached: process.platform !== 'win32', stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FOTOREADY_TEXT_CACHE_BYTES: '3355443' }
});
let exited = false;
let phase = 'reply';
const exit = new Promise(resolve => child.once('exit', () => { exited = true; resolve(); }));
let timer;
const watchdog = new Promise((_, reject) => {
  timer = setTimeout(() => reject(new Error('Electron helper did not settle during ' + phase + ' within 15 seconds.')), 15000);
});
const answer = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('message', resolve);
  child.once('exit', () => reject(new Error('Electron helper exited before its result.')));
});
try {
  child.send({ kind: 'preview-stage', jobId: 'electron-runtime', width: 2, height: 1,
    bitmap: Uint8Array.from([220, 30, 30, 255, 30, 60, 220, 255]).buffer,
    pipeline: ${JSON.stringify(pipeline([op("rotate", { degrees: 90 })]))} });
  const result = await Promise.race([answer, watchdog]);
  phase = 'disconnect exit';
  child.disconnect();
  await Promise.race([exit, watchdog]);
  let gone = false;
  try { process.kill(child.pid, 0); } catch (error) { if (error.code === 'ESRCH') gone = true; else throw error; }
  if (!gone) throw new Error('Electron helper PID is still present after exit.');
  process.stdout.write(JSON.stringify({ ...result,
    bitmap: result.kind === 'preview' ? [...new Uint8Array(result.bitmap)] : null, exited }));
} finally {
  clearTimeout(timer);
  if (!exited && child.pid !== undefined) {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await exit;
}
`);
    const { stdout } = await promisify(execFile)(executable, [coordinator], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 20_000, killSignal: "SIGKILL"
    });
    const result = JSON.parse(stdout) as { kind: string; width: number; height: number; format: string; bitmap: number[]; exited: boolean };
    expect(result).toMatchObject({ kind: "preview", width: 1, height: 2, format: "rgba8", exited: true });
    expect(result.bitmap).toEqual([220, 30, 30, 255, 30, 60, 220, 255]);
  }, 25_000);

  it("prepares original metadata/hash and sidecars, then renders preview-stage pixels", async () => {
    const owner = pool();
    const relative = "metadata/image/jpeg-metadata-rich.jpg";
    const sourcePath = path.join(root, "rich.jpg");
    await fs.copyFile(path.join(CORPUS, relative), sourcePath);
    const manifest = JSON.parse(await fs.readFile(path.join(CORPUS, "manifest.json"), "utf8")) as {
      fixtures: Array<{ path: string; sha256: string; bytes: number; probe: { width: number; height: number; exif: { Artist: string } } }>;
    };
    const fact = manifest.fixtures.find((file) => file.path === relative)!;
    expect(fact).toBeDefined();
    const prepared = await run(owner, { kind: "original", sourcePath, estimateQuality: true });
    expect(prepared.kind).toBe("original");
    if (prepared.kind !== "original") throw new Error(JSON.stringify(prepared));
    expect(prepared.original).toMatchObject({ sourcePath, sourceHash: fact.sha256, size: fact.bytes,
      width: fact.probe.width, height: fact.probe.height, format: "jpeg" });
    expect(prepared.original.metadataSummary.inspectionFailed).toBeUndefined();
    expect(prepared.original.metadataSummary.editorial.author).toBe(fact.probe.exif.Artist);
    const bytes = await fs.readFile(sourcePath);
    expect(prepared.original.sourceHash).toBe(createHash("sha256").update(bytes).digest("hex"));

    const sidecar = createTaskSidecar({ original: { fileName: "rich.jpg", sourceHash: fact.sha256,
      size: fact.bytes, format: "jpeg", width: fact.probe.width, height: fact.probe.height },
      generateDescription: false, generateSlug: false, customSlug: "native-check", pipeline: pipeline(), vision: null });
    const sidecarPath = path.join(root, "rich.json");
    await fs.writeFile(sidecarPath, versionedJson(FORMAT_VERSIONS.taskSidecar, sidecar));
    const loaded = await run(owner, { kind: "sidecar", sourcePath: sidecarPath, bundledStampsDir: path.join(REPO, "resources/stamps") });
    expect(loaded.kind).toBe("sidecar");
    if (loaded.kind !== "sidecar") throw new Error(JSON.stringify(loaded));
    expect(loaded.result.rejected).toEqual([]);
    expect(loaded.result.loaded[0]?.sidecar).toEqual(sidecar);

    const preview = await run(owner, { kind: "preview-stage", jobId: "stage", width: 2, height: 1,
      bitmap: Uint8Array.from([220, 30, 30, 255, 30, 60, 220, 255]).buffer,
      pipeline: pipeline([op("flip", { horizontal: true })]) });
    expect(preview.kind).toBe("preview");
    if (preview.kind !== "preview") throw new Error(JSON.stringify(preview));
    expect(preview).toMatchObject({ width: 2, height: 1, format: "rgba8" });
    expect([...new Uint8Array(preview.bitmap)]).toEqual([30, 60, 220, 255, 220, 30, 30, 255]);
    await owner.destroy();
  });

  it("saves 12MP and enlarged 24MP recipes and reports deadline/memory calibration", async () => {
    const owner = pool();
    const sourcePath = path.join(root, "12mp.jpg");
    // Scale a curated photo in the disposable fixture; source identity/metadata is checked above.
    await sharp(path.join(CORPUS, "metadata/image/jpeg-metadata-rich.jpg"))
      .resize(4000, 3000, { fit: "fill" }).jpeg({ quality: 90 }).toFile(sourcePath);
    const smallPath = path.join(root, "small.jpg");
    await sharp(sourcePath).resize(400, 300).jpeg().toFile(smallPath);
    const recipes = [
      { name: "12MP rotate text", source: sourcePath, size: { width: 4000, height: 3000 },
        ops: [op("rotate", { degrees: 90 }), op("watermark-text", { text: "Native qualification", x: 0.1, y: 0.2, opacity: 1 })], width: 3000, height: 4000 },
      { name: "small enlarged 24MP rotate text", source: smallPath, size: { width: 400, height: 300 },
        ops: [op("resize", { mode: "exact", width: 6000, height: 4000 }), op("rotate", { degrees: 90 }),
          op("watermark-text", { text: "Enlarged qualification", x: 0.1, y: 0.2, opacity: 1 })], width: 4000, height: 6000 }
    ];
    for (const [index, recipe] of recipes.entries()) {
      const outputPath = path.join(root, `saved-${index}.jpg`);
      const pixels = maximumPipelinePixels(recipe.size, recipe.ops);
      const deadlineMs = 120_000 + Math.ceil(pixels / 1_000_000) * Math.max(1, recipe.ops.length) * 2_000;
      const result = await run(owner, { kind: "process", jobId: recipe.name, sourcePath: recipe.source,
        pipeline: pipeline(recipe.ops), outputPath, previewLongEdge: null }, deadlineMs, saveCost(recipe.size.width, recipe.size.height, recipe.ops));
      expect(result.kind).toBe("process");
      if (result.kind !== "process") throw new Error(JSON.stringify(result));
      expect(await sharp(outputPath).metadata()).toMatchObject({ format: "jpeg", width: recipe.width, height: recipe.height });
      expect(result.bytes).toBe((await fs.stat(outputPath)).size);
      expect(result.qualification.elapsedMs).toBeLessThan(deadlineMs);
      metrics.push({ recipe: recipe.name, pixels, deadlineMs, costMiB: saveCost(recipe.size.width, recipe.size.height, recipe.ops) / 1024 ** 2, ...result.qualification });
    }
    await owner.destroy();
  }, 180_000);

  it("reports retained RSS while reusing one helper for twenty varying 2MP text jobs", async () => {
    // Two slots share the configured 2.5% cache allowance: this exercises a 3.2MiB text-cache
    // budget while the oversized-first-job guarantee still permits full-quality native output.
    const owner = pool(256 * 1024 ** 2);
    const sourcePath = path.join(root, "churn-2mp.jpg");
    const size = { width: 1920, height: 1080 };
    await sharp(path.join(CORPUS, "metadata/image/jpeg-metadata-rich.jpg"))
      .resize(size.width, size.height, { fit: "fill" }).jpeg({ quality: 90 }).toFile(sourcePath);
    const pids = new Set<number>();
    const hashes = new Set<string>();
    for (let index = 0; index < 20; index++) {
      const ops = [op("watermark-text", { text: `Varying watermark ${index + 1}`, x: 0.1, y: 0.2, opacity: 1,
        bold: index % 2 === 0, w: 0.35, h: 0.12 })];
      const outputPath = path.join(root, `churn-${index}.jpg`);
      const pixels = maximumPipelinePixels(size, ops);
      const cost = saveCost(size.width, size.height, ops);
      const deadlineMs = 120_000 + Math.ceil(pixels / 1_000_000) * ops.length * 2_000;
      const result = await run(owner, { kind: "process", jobId: `churn-${index}`, sourcePath,
        pipeline: pipeline(ops), outputPath, previewLongEdge: null }, deadlineMs, cost);
      expect(result.kind).toBe("process");
      if (result.kind !== "process") throw new Error(JSON.stringify(result));
      expect(await sharp(outputPath).metadata()).toMatchObject({ width: size.width, height: size.height });
      hashes.add(createHash("sha256").update(await fs.readFile(outputPath)).digest("hex"));
      pids.add(result.qualification.pid);
      metrics.push({ recipe: `2MP varying text ${index + 1}`, pixels, deadlineMs, costMiB: cost / 1024 ** 2, ...result.qualification });
    }
    expect(pids.size).toBe(1);
    expect(hashes.size).toBe(20);
    await owner.destroy();
  }, 120_000);

  it.skipIf(process.platform === "win32")("retires a real FIFO-blocked source and advances queued local work", async () => {
    const owner = pool();
    const fifo = path.join(root, "blocked.jpg");
    execFileSync("mkfifo", [fifo]);
    const blocked = run(owner, { kind: "original", sourcePath: fifo, estimateQuality: false }, 2_000);
    const rejection = expect(blocked).rejects.toBeInstanceOf(NativeJobRetiringError);
    const sourcePath = path.join(root, "queued.jpg");
    await fs.copyFile(path.join(CORPUS, "metadata/image/jpeg-metadata-rich.jpg"), sourcePath);
    const queued = run(owner, { kind: "original", sourcePath, estimateQuality: false });
    await rejection;
    expect((await queued).kind).toBe("original");
    const jobs = (await fs.readFile(path.join(root, "jobs.jsonl"), "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as { pid: number; sourcePath: string });
    const blockedPid = jobs.find((job) => job.sourcePath === fifo)!.pid;
    expect(() => process.kill(blockedPid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    await owner.destroy();
  }, 30_000);
});
