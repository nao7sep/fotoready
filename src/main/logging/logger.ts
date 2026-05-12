import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { utcStamp } from "@shared/time";

export type AppLogger = pino.Logger;

export async function rotateLogs(logsDir: string, keep = 50): Promise<void> {
  await fsp.mkdir(logsDir, { recursive: true });
  const entries = await fsp.readdir(logsDir);
  const logs = entries.filter((entry) => entry.endsWith(".log")).sort().reverse();

  await Promise.all(
    logs.slice(keep).map((entry) => fsp.rm(path.join(logsDir, entry), { force: true }))
  );
}

export async function createLogger(logsDir: string): Promise<AppLogger> {
  await rotateLogs(logsDir);
  const destination = pino.destination({ dest: path.join(logsDir, `${utcStamp()}.log`), sync: false });
  const logger = pino(
    {
      base: null,
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: {
        level(label) {
          return { level: label };
        }
      }
    },
    destination
  );

  process.on("exit", () => {
    destination.flushSync();
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error, mod: "main" }, "uncaught exception");
    destination.flushSync();
    throw error;
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason, mod: "main" }, "unhandled rejection");
    destination.flushSync();
    process.exitCode = 1;
  });

  fs.mkdirSync(logsDir, { recursive: true });
  return logger;
}
