import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";
import { moveOutputFile } from "@main/move-output-file";
import { isRetryableIoError } from "@runtime/pipeline-error";

it.runIf(process.platform === "win32")("preserves a published output and reports cleanup when another process denies deletion", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fotoready-held-output-"));
  const source = path.join(dir, "source.jpg");
  const target = path.join(dir, "target.jpg");
  await fs.writeFile(source, "controlled output bytes");
  const holder = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; $stream=[IO.File]::Open($env:FOTOREADY_LOCK_FIXTURE, 'Open', 'Read', 'Read'); try { [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null } finally { $stream.Dispose() }"
  ], { env: { ...process.env, FOTOREADY_LOCK_FIXTURE: source }, stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(holder, "close");
  const lines = createInterface({ input: holder.stdout });
  try {
    const ready = await Promise.race([
      once(lines, "line").then(([line]) => line),
      closed.then(() => { throw new Error("Windows file holder exited before acquiring its handle"); })
    ]);
    expect(ready).toBe("ready");
    const failures = await moveOutputFile(source, target);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ path: source, kind: "source" });
    expect(isRetryableIoError(failures[0].error)).toBe(true);
    expect(await fs.readFile(source, "utf8")).toBe("controlled output bytes");
    expect(await fs.readFile(target, "utf8")).toBe("controlled output bytes");
  } finally {
    holder.stdin.end("\n");
    await closed;
    lines.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
