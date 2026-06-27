import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewRename, runRename } from "@main/rename-service";
import { defaultPipeline } from "@shared/defaults";
import { BUILTIN_RENAME_TEMPLATE_IDS } from "@shared/rename-template";
import type { Original, Project, Task, TaskOutput } from "@shared/types/project";

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-rename-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(workDir, { recursive: true, force: true });
});

// Write a real JPEG of the given size so previewRename's sharp().metadata() returns w/h.
async function writeImage(name: string, width = 1024, height = 768): Promise<string> {
  const filePath = path.join(workDir, name);
  await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toFile(filePath);
  return filePath;
}

async function writeSidecar(imagePath: string): Promise<string> {
  const parsed = path.parse(imagePath);
  const sidecarPath = path.join(parsed.dir, `${parsed.name}.json`);
  await fs.writeFile(sidecarPath, "{}\n");
  return sidecarPath;
}

function makeOriginal(id: string, fileName: string): Original {
  return {
    id,
    sourcePath: path.join(workDir, fileName),
    sourceHash: `hash-${id}`,
    size: 1000,
    format: "jpeg",
    jpegQualityEstimate: 85,
    metadataSummary: { editorial: {}, dates: {}, gps: {} },
    width: 4000,
    height: 3000,
    addedAt: "2026-06-04T00:00:00.000Z"
  };
}

function makeOutput(stagedPath: string | null): TaskOutput | null {
  if (!stagedPath) return null;
  const parsed = path.parse(stagedPath);
  const sidecar = path.join(parsed.dir, `${parsed.name}.json`);
  return {
    stagedPath,
    stagedParamsPath: sidecar,
    stagedAt: "2026-06-04T00:00:00.000Z",
    outputHash: "out-hash",
    vision: null,
    finalPath: null,
    finalParamsPath: null,
    renamedAt: null
  };
}

function makeTask(opts: {
  id: string;
  originalId: string;
  customSlug: string | null;
  stagedPath: string | null;
  createdAt?: string;
}): Task {
  return {
    id: opts.id,
    originalId: opts.originalId,
    generateDescription: false,
    generateSlug: false,
    customSlug: opts.customSlug,
    visionRunning: false,
    visionRunMode: null,
    pipeline: defaultPipeline(),
    status: opts.stagedPath ? "saved" : "not-saved",
    output: makeOutput(opts.stagedPath),
    error: null,
    everEdited: false,
    createdAt: opts.createdAt ?? "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z"
  };
}

const SLUG_ONLY = BUILTIN_RENAME_TEMPLATE_IDS.slug;
const SLUG_SIZE = BUILTIN_RENAME_TEMPLATE_IDS.slugSize;
const ORIGINAL_ONLY = BUILTIN_RENAME_TEMPLATE_IDS.original;

describe("previewRename", () => {
  it("marks a task with no output as not-saved", async () => {
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "DSC_0001.jpg")],
      tasks: [makeTask({ id: "t1", originalId: "o1", customSlug: "sunset", stagedPath: null })]
    };
    const preview = await previewRename(project, SLUG_SIZE);
    expect(preview.items[0].status).toBe("not-saved");
    expect(preview.items[0].proposedPath).toBeNull();
    expect(preview.renameableCount).toBe(0);
  });

  it("renders a slug + size name from the real image dimensions", async () => {
    const staged = await writeImage("staged-1.jpg", 1024, 768);
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "DSC_0001.jpg")],
      tasks: [makeTask({ id: "t1", originalId: "o1", customSlug: "Sunset Pier", stagedPath: staged })]
    };
    const preview = await previewRename(project, SLUG_SIZE);
    expect(preview.items[0].status).toBe("ready");
    expect(preview.items[0].proposedName).toBe("sunset-pier-1024x768.jpg");
    expect(preview.renameableCount).toBe(1);
  });

  it("flags a missing slug when the template needs one", async () => {
    const staged = await writeImage("staged-1.jpg");
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "DSC_0001.jpg")],
      tasks: [makeTask({ id: "t1", originalId: "o1", customSlug: null, stagedPath: staged })]
    };
    const preview = await previewRename(project, SLUG_ONLY);
    expect(preview.items[0].status).toBe("blocked");
    expect(preview.items[0].missingSlug).toBe(true);
    expect(preview.missingSlugCount).toBe(1);
  });

  it("blocks two tasks that resolve to the same slug-based name", async () => {
    const a = await writeImage("staged-a.jpg");
    const b = await writeImage("staged-b.jpg");
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "A.jpg"), makeOriginal("o2", "B.jpg")],
      tasks: [
        makeTask({ id: "t1", originalId: "o1", customSlug: "same", stagedPath: a, createdAt: "2026-06-04T00:00:00.000Z" }),
        makeTask({ id: "t2", originalId: "o2", customSlug: "same", stagedPath: b, createdAt: "2026-06-04T00:00:01.000Z" })
      ]
    };
    const preview = await previewRename(project, SLUG_ONLY);
    expect(preview.items.every((item) => item.status === "blocked")).toBe(true);
    expect(preview.items[0].issue).toMatch(/slug/i);
    expect(preview.blockedCount).toBe(2);
  });

  it("blocks two tasks from the same original under an original-based template", async () => {
    // Two saved tasks (e.g. forks) of one original both render to the same
    // original-derived name in the same directory — the semantic original
    // conflict the slug case has, on the original axis. This exercises
    // countSemanticConflicts with usesOriginal, previously untested.
    const a = await writeImage("staged-a.jpg");
    const b = await writeImage("staged-b.jpg");
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "DSC_0001.jpg")],
      tasks: [
        makeTask({ id: "t1", originalId: "o1", customSlug: null, stagedPath: a, createdAt: "2026-06-04T00:00:00.000Z" }),
        makeTask({ id: "t2", originalId: "o1", customSlug: null, stagedPath: b, createdAt: "2026-06-04T00:00:01.000Z" })
      ]
    };
    const preview = await previewRename(project, ORIGINAL_ONLY);
    expect(preview.items.every((item) => item.status === "blocked")).toBe(true);
    expect(preview.items[0].issue).toBe("Overlaps another original-based name");
    expect(preview.blockedCount).toBe(2);
  });

  it("blocks when a file with the proposed name already exists on disk", async () => {
    const staged = await writeImage("staged-1.jpg");
    await writeImage("taken.jpg"); // a pre-existing, unrelated file
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "DSC_0001.jpg")],
      tasks: [makeTask({ id: "t1", originalId: "o1", customSlug: "taken", stagedPath: staged })]
    };
    const preview = await previewRename(project, SLUG_ONLY);
    expect(preview.items[0].status).toBe("blocked");
    expect(preview.items[0].issue).toMatch(/already exists/i);
  });
});

describe("runRename", () => {
  it("moves the image and sidecar and updates the task output paths", async () => {
    const staged = await writeImage("staged-1.jpg");
    const stagedSidecar = await writeSidecar(staged);
    const task = makeTask({ id: "t1", originalId: "o1", customSlug: "final", stagedPath: staged });
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "DSC_0001.jpg")],
      tasks: [task]
    };

    await runRename(project, SLUG_ONLY);

    const finalImage = path.join(workDir, "final.jpg");
    const finalSidecar = path.join(workDir, "final.json");
    await expect(fs.access(finalImage)).resolves.toBeUndefined();
    await expect(fs.access(finalSidecar)).resolves.toBeUndefined();
    await expect(fs.access(staged)).rejects.toThrow();
    await expect(fs.access(stagedSidecar)).rejects.toThrow();

    expect(task.output?.finalPath).toBe(finalImage);
    expect(task.output?.finalParamsPath).toBe(finalSidecar);
    expect(task.output?.renamedAt).not.toBeNull();
  });

  it("throws and renames nothing when any task is blocked", async () => {
    const staged = await writeImage("staged-1.jpg");
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "DSC_0001.jpg")],
      tasks: [makeTask({ id: "t1", originalId: "o1", customSlug: null, stagedPath: staged })]
    };
    await expect(runRename(project, SLUG_ONLY)).rejects.toThrow(/cannot be renamed/i);
    // The staged file is untouched.
    await expect(fs.access(staged)).resolves.toBeUndefined();
  });

  it("rolls the image back when the sidecar move fails", async () => {
    const staged = await writeImage("staged-1.jpg");
    await writeSidecar(staged);
    const task = makeTask({ id: "t1", originalId: "o1", customSlug: "final", stagedPath: staged });
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "DSC_0001.jpg")],
      tasks: [task]
    };

    // Make the sidecar move (destination *.json) fail with a non-collision error, after the
    // image has already moved. The service must move the image back.
    const realRename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(".json")) {
        const error = new Error("simulated sidecar failure") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return realRename(from as never, to as never);
    });

    await expect(runRename(project, SLUG_ONLY)).rejects.toThrow(/sidecar failure/i);

    // Image is back at its staged path; the proposed name was not left behind.
    await expect(fs.access(staged)).resolves.toBeUndefined();
    await expect(fs.access(path.join(workDir, "final.jpg"))).rejects.toThrow();
    // The task output still points at the staged location (never committed the rename).
    expect(task.output?.finalPath).toBeNull();
    expect(task.output?.renamedAt).toBeNull();
  });
});
