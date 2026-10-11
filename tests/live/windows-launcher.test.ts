import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { ownLiveChild } from "../helpers/live-child";

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
  const owned = ownLiveChild(spawn(process.execPath, ["-e", code, path.join(scripts, "run-dev.ps1")]), "owned launcher fixture");
  const unrelated = ownLiveChild(spawn(process.execPath, ["-e", code, path.join(dir, "unrelated.js")]), "unrelated fixture");
  try {
    await Promise.all([owned.waitReady(), unrelated.waitReady()]);
    const commandOptions = { timeout: 30_000, killSignal: "SIGKILL" as const };
    const { stdout } = await exec(process.execPath, [helper, "stop", "electron", "FotoReady", "FotoReady"], commandOptions);
    expect(stdout).toContain(`pid ${owned.child.pid}`);
    await owned.waitClosed();
    expect(unrelated.child.exitCode).toBeNull();
    expect(unrelated.child.signalCode).toBeNull();
    const second = await exec(process.execPath, [helper, "stop", "electron", "FotoReady", "FotoReady"], commandOptions);
    expect(second.stdout).toBe("");
  } finally {
    await Promise.all([owned.stop(), unrelated.stop()]);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
