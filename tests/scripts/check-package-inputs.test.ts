import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

// The script reads package.json and resources/stamps from its working directory, so each case runs
// it in a disposable copy of that layout.
const SCRIPT = path.resolve("scripts/check-package-inputs.mjs");
const run = promisify(execFile);
const roots: string[] = [];

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8X"), Buffer.alloc(8)]);
const LFS_POINTER = Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:0\nsize 1\n");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function checkStamps(files: Record<string, Buffer>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-package-inputs-"));
  roots.push(root);
  const stamps = path.join(root, "resources", "stamps");
  await fs.mkdir(stamps, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    build: { files: ["!**/*.map", "!**/*.d.ts", "!**/*.d.mts", "!**/*.d.cts"] }
  }));
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(stamps, name), bytes);
  const { stdout } = await run(process.execPath, [SCRIPT], { cwd: root, timeout: 30_000 });
  return stdout;
}

describe("check-package-inputs built-in stamps", () => {
  it("accepts materialized PNG and WebP stamps", async () => {
    await expect(checkStamps({ "heart.png": PNG, "star.webp": WEBP, "catalog.json": Buffer.from("{}") }))
      .resolves.toContain("Verified 2 materialized built-in stamps.");
  });

  it.each(["heart.png", "heart.webp"])("rejects an LFS pointer left in place of %s", async (name) => {
    await expect(checkStamps({ [name]: LFS_POINTER })).rejects.toThrow(new RegExp(`not a materialized image.*${name.replace(".", "\\.")}`));
  });

  it("rejects a PNG signature under a WebP name", async () => {
    await expect(checkStamps({ "heart.webp": PNG })).rejects.toThrow(/not a materialized image/);
  });

  it("fails when there are no stamps to check", async () => {
    await expect(checkStamps({ "catalog.json": Buffer.from("{}") })).rejects.toThrow(/No built-in stamp PNGs or WebPs/);
  });
});
