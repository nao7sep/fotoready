import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);

it.runIf(process.platform === "win32")("stops only the disposable launcher runtime and leaves an unrelated process alive", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-launcher-stop-"));
  const scripts = path.join(dir, "scripts");
  await fs.mkdir(scripts);
  const helper = path.join(scripts, "launcher-runtime.mjs");
  // The script derives ownership from its own repository root. Copying it confines
  // the stop command to this fixture, even if the developer has FotoReady running.
  await fs.copyFile(new URL("../../scripts/launcher-runtime.mjs", import.meta.url), helper);
  const code = "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)";
  const owned = spawn(process.execPath, ["-e", code, path.join(scripts, "run-dev.ps1")]);
  const unrelated = spawn(process.execPath, ["-e", code, path.join(dir, "unrelated.js")]);
  const ownedClosed = once(owned, "close");
  const unrelatedClosed = once(unrelated, "close");
  try {
    await Promise.all([once(owned.stdout!, "data"), once(unrelated.stdout!, "data")]);
    const { stdout } = await exec(process.execPath, [helper, "stop", "electron", "FotoReady", "FotoReady"]);
    expect(stdout).toContain(`pid ${owned.pid}`);
    await ownedClosed;
    expect(unrelated.exitCode).toBeNull();
    expect(unrelated.signalCode).toBeNull();
    const second = await exec(process.execPath, [helper, "stop", "electron", "FotoReady", "FotoReady"]);
    expect(second.stdout).toBe("");
  } finally {
    owned.kill();
    unrelated.kill();
    await Promise.all([ownedClosed, unrelatedClosed]);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
