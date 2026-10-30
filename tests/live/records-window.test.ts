/**
 * The real Records window in Electron, over a throwaway data folder seeded with 10,000 records while
 * three more arrive each second: the first page, paging through every record, live records at the
 * top, a list that holds still while scrolled down, including under a newest read held in flight
 * until the list has left the top, and a window that keeps answering. The checks
 * themselves are the demo's `--check` mode (`tests/dev/records-demo.ts`), which shows no window;
 * this builds it, runs it and reads its verdict. It needs the built app, so it runs in the full gate.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ownLiveChild } from "../helpers/live-child";

const repo = fileURLToPath(new URL("../..", import.meta.url));

async function run(command: string, args: string[], label: string): Promise<string> {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const owned = ownLiveChild(spawn(command, args, { cwd: repo, env, stdio: ["pipe", "pipe", "pipe"] }), label);
  let output = "";
  owned.child.stdout.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  try {
    await owned.waitClosed();
  } finally {
    await owned.stop();
  }
  expect(owned.child.exitCode, output).toBe(0);
  return output;
}

it("pages, updates live and holds still over 10,000 records in the real window", async () => {
  await run(process.execPath, ["node_modules/electron-vite/bin/electron-vite.js", "build", "--config", "tests/dev/records-demo.config.ts"], "records demo build");
  const root = mkdtempSync(path.join(tmpdir(), "fotoready-records-live-"));
  try {
    const electron = createRequire(import.meta.url)("electron") as string;
    const output = await run(electron, ["out-records-demo/main/records-demo.js", "--check", "--seed=10000", `--root=${root}`], "records demo");
    const line = output.split("\n").find((text) => text.startsWith("RECORDS-CHECK "));
    expect(line, output).toBeDefined();
    process.stdout.write(`${line}\n`);
    const result = JSON.parse(line!.slice("RECORDS-CHECK ".length)) as { pass: boolean };
    expect(result, line).toMatchObject({ pass: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
