// Real child-process fixture for NativeProcessPool. A FIFO hold blocks native readSync, so these
// tests prove physical retirement rather than merely rejecting a promise in responsive JavaScript.
import { openSync, readSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--descendant")) {
  setInterval(() => {}, 60_000);
} else {
  process.on("message", (request) => {
    if (request.kind === "echo") {
      // Inject only the reported accounting fact; these tests never allocate that amount of RAM.
      process.send({ pid: process.pid, value: request.value, residentBytes: request.residentBytes });
      return;
    }
    if (request.kind === "hold") {
      const descendant = request.spawnDescendant
        ? spawn(process.execPath, [fileURLToPath(import.meta.url), "--descendant"], { stdio: "ignore" })
        : null;
      // Opening both ends avoids waiting for a writer during open. With no data written, the
      // following read waits inside the OS even though JavaScript cannot service further messages.
      const fd = request.fifoPath ? openSync(request.fifoPath, "r+") : null;
      writeFileSync(request.readyPath, JSON.stringify({ pid: process.pid, descendantPid: descendant?.pid ?? null }));
      if (fd !== null) readSync(fd, Buffer.alloc(1), 0, 1, null);
      else for (;;) { /* Windows fallback: an unresponsive owned helper. */ }
    }
  });
}
