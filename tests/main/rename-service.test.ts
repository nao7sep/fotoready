import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewRename, runRename } from "@main/rename-service";
import { ProjectSession } from "@main/session";
import { defaultGlobalSettings, defaultPipeline } from "@shared/defaults";
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
  await fs.writeFile(sidecarPath, '{"formatVersion":1}\n');
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
    expect(preview.items[0].issue).toBe("overlaps-slug");
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
    expect(preview.items[0].issue).toBe("overlaps-original");
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
    expect(preview.items[0].issue).toBe("name-exists");
  });

  it("blocks an intra-batch conflict that only differs by directory case (case-insensitive key fold)", async () => {
    // Two tasks share the exact same slug and would land in destination
    // directories that are literal string case-variants of one another (e.g. a
    // messy source tree with "Set" and "set" subfolders). On any volume, per
    // the storage-path-conventions' hard invariant, this pair must never be
    // treated as non-conflicting just because the directory strings differ in
    // case — a bare path.resolve() (case-preserving) would miss this.
    const a = await writeImage("staged-a.jpg");
    const b = await writeImage("staged-b.jpg");
    const project: Project = {
      outputDir: null,
      originals: [makeOriginal("o1", "Set/DSC_0001.jpg"), makeOriginal("o2", "set/DSC_0002.jpg")],
      tasks: [
        makeTask({ id: "t1", originalId: "o1", customSlug: "same-slug", stagedPath: a, createdAt: "2026-06-04T00:00:00.000Z" }),
        makeTask({ id: "t2", originalId: "o2", customSlug: "same-slug", stagedPath: b, createdAt: "2026-06-04T00:00:01.000Z" })
      ]
    };
    const preview = await previewRename(project, SLUG_ONLY);
    expect(preview.items.every((item) => item.status === "blocked")).toBe(true);
    expect(preview.blockedCount).toBe(2);
  });

  it("detects an on-disk case-only sibling even when an exact-case lookup would miss it", async () => {
    const staged = await writeImage("staged-1.jpg");
    // A pre-existing, untracked file differing only in case from the proposed name.
    await fs.writeFile(path.join(workDir, "IMG_1.jpg"), "existing");
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "img_1.jpg")],
      tasks: [makeTask({ id: "t1", originalId: "o1", customSlug: null, stagedPath: staged })]
    };

    // Simulate a case-sensitive volume, where an exact-case stat/lstat lookup
    // for "img_1.jpg" would not find "IMG_1.jpg". The fix must not depend on an
    // OS-level case-insensitive lstat to find the sibling — it enumerates the
    // directory and folds case itself.
    vi.spyOn(fs, "lstat").mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    const preview = await previewRename(project, ORIGINAL_ONLY);
    expect(preview.items[0].status).toBe("blocked");
    expect(preview.items[0].issue).toBe("name-exists");
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

  it("leaves a file being described where it is", async () => {
    const staged = await writeImage("describing.jpg");
    await writeSidecar(staged);
    const task = makeTask({ id: "t1", originalId: "o1", customSlug: "final", stagedPath: staged });
    task.visionRunning = true;
    const project: Project = { outputDir: workDir, originals: [makeOriginal("o1", "DSC_0001.jpg")], tasks: [task] };

    expect(await runRename(project, SLUG_ONLY)).toEqual({ completedTaskIds: [], warnings: [] });
    await expect(fs.access(staged)).resolves.toBeUndefined();
    expect(task.output?.finalPath ?? null).toBeNull();
  });

  it("keeps the image's and sidecar's modified time and mode when the move crosses volumes", async () => {
    const staged = await writeImage("staged-1.jpg");
    const stagedSidecar = await writeSidecar(staged);
    const modified = new Date("2024-03-04T05:06:07.000Z");
    for (const file of [staged, stagedSidecar]) {
      await fs.chmod(file, 0o640);
      await fs.utimes(file, modified, modified);
    }
    const task = makeTask({ id: "t1", originalId: "o1", customSlug: "final", stagedPath: staged });
    const project: Project = { outputDir: workDir, originals: [makeOriginal("o1", "DSC_0001.jpg")], tasks: [task] };
    // A cross-volume source link fails with EXDEV; the destination staging can be linked.
    const realLink = fs.link;
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (!path.dirname(String(from)).endsWith(".tmp")) throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      return realLink(from as never, to as never);
    });

    await runRename(project, SLUG_ONLY);

    for (const file of [path.join(workDir, "final.jpg"), path.join(workDir, "final.json")]) {
      const stat = await fs.stat(file);
      expect(stat.mtime.toISOString()).toBe(modified.toISOString());
      if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o640);
    }
    await expect(fs.access(staged)).rejects.toThrow();
    expect((await fs.readdir(workDir)).sort()).toEqual(["final.jpg", "final.json"]);
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
    const realLink = fs.link;
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (String(to).endsWith(".json")) {
        const error = new Error("simulated sidecar failure") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return realLink(from as never, to as never);
    });

    await expect(runRename(project, SLUG_ONLY)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/sidecar failure/i) })
    });

    // Image is back at its staged path; the proposed name was not left behind.
    await expect(fs.access(staged)).resolves.toBeUndefined();
    await expect(fs.access(path.join(workDir, "final.jpg"))).rejects.toThrow();
    // The task output still points at the staged location (never committed the rename).
    expect(task.output?.finalPath).toBeNull();
    expect(task.output?.renamedAt).toBeNull();
  });

  it("reports completed task ids and leaves the project snapshot truthful after a later failure", async () => {
    const staged1 = await writeImage("staged-1.jpg");
    const staged2 = await writeImage("staged-2.jpg");
    await writeSidecar(staged1);
    await writeSidecar(staged2);
    const first = makeTask({ id: "t1", originalId: "o1", customSlug: "first", stagedPath: staged1 });
    const second = makeTask({ id: "t2", originalId: "o2", customSlug: "second", stagedPath: staged2 });
    const project: Project = {
      outputDir: workDir,
      originals: [makeOriginal("o1", "one.jpg"), makeOriginal("o2", "two.jpg")],
      tasks: [first, second]
    };
    const realLink = fs.link;
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (String(to).endsWith("second.json")) {
        throw Object.assign(new Error("simulated second sidecar failure"), { code: "EACCES" });
      }
      return realLink(from as never, to as never);
    });

    await expect(runRename(project, SLUG_ONLY)).rejects.toMatchObject({ completedTaskIds: ["t1"] });
    expect(first.output?.finalPath).toBe(path.join(workDir, "first.jpg"));
    expect(second.output?.finalPath).toBeNull();
    await expect(fs.access(staged2)).resolves.toBeUndefined();
  });
  it("moves the sidecar without reading it, since editing it outside FotoReady during a session is unsupported", async () => {
    const staged = await writeImage("unread.jpg", 8, 8);
    const params = await writeSidecar(staged);
    await fs.writeFile(params, '{"formatVersion":2,"future":"keep"}');
    const task = makeTask({ id: "t1", originalId: "o1", customSlug: "final", stagedPath: staged });
    const readFile = vi.spyOn(fs, "readFile");
    expect(await runRename({ outputDir: workDir, originals: [makeOriginal("o1", "original.jpg")], tasks: [task] }, SLUG_ONLY)).toEqual({ completedTaskIds: ["t1"], warnings: [] });
    expect(readFile.mock.calls.map(([file]) => file)).not.toContain(params);
    expect(await fs.readFile(path.join(workDir, "final.json"), "utf8")).toBe('{"formatVersion":2,"future":"keep"}');
  });

  it("reports the committed image as partial if sidecar failure cannot be rolled back", async () => {
    const staged = await writeImage("partial.jpg", 8, 8);
    const params = await writeSidecar(staged);
    const task = makeTask({ id: "t1", originalId: "o1", customSlug: "final", stagedPath: staged });
    const modified = task.updatedAt;
    const link = fs.link;
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (from === params || to === staged) throw Object.assign(new Error("move denied"), { code: "EACCES" });
      return link(from, to);
    });
    await expect(runRename({ outputDir: workDir, originals: [makeOriginal("o1", "original.jpg")], tasks: [task] }, SLUG_ONLY)).rejects.toMatchObject({ completedTaskIds: [], partialTaskIds: ["t1"] });
    expect(task.output?.finalPath).toBe(path.join(workDir, "final.jpg"));
    expect(task.output?.stagedParamsPath).toBe(params);
    expect(task.updatedAt).toBe(modified);
    await expect(fs.access(path.join(workDir, "final.jpg"))).resolves.toBeUndefined();
    await expect(fs.access(params)).resolves.toBeUndefined();
  });

  it("keeps the committed task identity and warning when source cleanup is denied", async () => {
    const staged = await writeImage("retained.jpg", 8, 8);
    await writeSidecar(staged);
    const task = makeTask({ id: "t1", originalId: "o1", customSlug: "final", stagedPath: staged });
    const modified = task.updatedAt;
    const rm = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (file, options) => {
      if (file === staged) throw Object.assign(new Error("diagnostic cleanup sentinel"), { code: "EACCES" });
      return rm(file, options);
    });
    expect(await runRename({ outputDir: workDir, originals: [makeOriginal("o1", "original.jpg")], tasks: [task] }, SLUG_ONLY)).toEqual({
      completedTaskIds: ["t1"], warnings: [{ key: "renameComplete.sourceRetained", values: { path: staged } }]
    });
    expect(task.output?.finalPath).toBe(path.join(workDir, "final.jpg"));
    expect(task.output?.finalParamsPath).toBe(path.join(workDir, "final.json"));
    expect(task.updatedAt).toBe(modified);
    await expect(fs.access(staged)).resolves.toBeUndefined();
  });

  it("returns the actual partial identity through the session when the sidecar move and rollback both fail", async () => {
    const staged = await writeImage("session.jpg", 8, 8);
    const params = await writeSidecar(staged);
    const task = makeTask({ id: "t1", originalId: "o1", customSlug: "final", stagedPath: staged });
    const session = new ProjectSession(defaultGlobalSettings(), null as never, null as never, null as never, "resources/stamps");
    const project = session.snapshot().project;
    project.outputDir = workDir;
    project.tasks.push(task); project.originals.push(makeOriginal("o1", "original.jpg"));
    const link = fs.link;
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (to === staged) throw Object.assign(new Error("rollback denied"), { code: "EACCES" });
      if (from === params) throw Object.assign(new Error("sidecar move denied"), { code: "EACCES" });
      await link(from, to);
    });
    const result = await session.runRename(SLUG_ONLY);
    expect(result).toEqual(expect.objectContaining({ status: "stopped", completedTaskIds: [], partialTaskIds: ["t1"], warnings: [] }));
    expect(result).not.toHaveProperty("reason");
    expect(result.snapshot.project.tasks[0].output?.finalPath).toBe(path.join(workDir, "final.jpg"));
    expect(result.snapshot.project.tasks[0].output?.stagedParamsPath).toBe(params);
    await expect(fs.access(params)).resolves.toBeUndefined();

    // A later change rewrites the sidecar where it is, rather than starting a second one at the new name.
    vi.restoreAllMocks();
    await session.setCustomSlug("t1", "changed");
    expect((await fs.readdir(workDir)).filter((name) => name.endsWith(".json"))).toEqual([path.basename(params)]);
    expect(JSON.parse(await fs.readFile(params, "utf8")).task.customSlug).toBe("changed");
  });

});
