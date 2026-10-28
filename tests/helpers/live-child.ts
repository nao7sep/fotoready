import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** Own a disposable live-test process from spawn through its close event. */
export function ownLiveChild(child: ChildProcessWithoutNullStreams, label: string) {
  let ended = false;
  let spawnError: Error | undefined;
  let stdout = "";
  let stderr = "";
  let announceReady!: () => void;
  const ready = new Promise<void>((resolve) => { announceReady = resolve; });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    if (stdout.split(/\r?\n/).slice(0, -1).includes("ready")) announceReady();
  });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  // Keep close non-rejecting: a spawn error can arrive before the caller starts
  // waiting, and cleanup must still observe physical completion.
  child.on("error", (error) => { spawnError = error; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => {
      ended = true;
      resolve({ code, signal });
    });
  });
  const failure = (message: string) => new Error(`${label}: ${message}${stderr ? `\n${stderr}` : ""}`, { cause: spawnError });

  async function stop(): Promise<void> {
    if (!ended) child.kill("SIGKILL");
    await closed;
  }

  return {
    child,
    stop,
    async waitReady(): Promise<void> {
      await Promise.race([
        ready,
        closed.then(({ code, signal }) => { throw failure(`exited before readiness (code ${code}, signal ${signal})`); }),
      ]);
      if (ended || spawnError) throw failure("failed during startup");
    },
    async waitClosed(): Promise<void> {
      await closed;
      if (spawnError) throw failure("process failed");
    },
  };
}
