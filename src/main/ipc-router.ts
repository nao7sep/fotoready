import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import type { AppPaths } from "@main/paths";
import type { ProjectSession } from "@main/session";
import type { AppLogger } from "@main/logger";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import { APP_NAME, IMPORT_FILE_EXTENSIONS } from "@shared/constants";
import { listOpDefinitions } from "@core/ops/catalog";
import { readAssetAspectRatio } from "@core/ops/_asset-overlay";
import type { PreviewRenderOptions, RendererLogEntry, TaskEditOptions, VisionRunOptions } from "@shared/types/ipc";
import { saveSettings } from "@main/settings-io";
import { saveState } from "@main/state-io";
import { AssetThumbnailCache } from "@main/asset-thumbnail-cache";
import { deleteLuts, importLuts, listLuts } from "@main/lut-catalog";
import { deleteStamps, importStamps, listStamps } from "@main/stamp-catalog";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { normalizeUiState } from "@shared/validation/state";
import { isRecord } from "@shared/validation/common";
import type { RenameTemplateId } from "@shared/rename-template";

export type RouterContext = {
  paths: AppPaths;
  settings: GlobalSettings;
  uiState: UiState;
  projectSession: ProjectSession;
  logger: AppLogger;
  version: string;
};

export function registerIpcHandlers(ctx: RouterContext): void {
  const assetThumbnailCache = new AssetThumbnailCache();

  // Single IPC chokepoint: every handler is logged once on completion with its
  // duration and outcome, and any thrown failure is logged at `error` before it
  // propagates to the renderer. `level` splits genuine user intents (`info`)
  // from high-frequency / pure-query channels (`debug`), so editing-driven
  // traffic (preview, thumbnails, slider drags) stays in the developer-only
  // firehose. Channel name and timing only — never the arguments, per
  // "summarize, don't dump".
  const handle = (
    channel: string,
    level: "info" | "debug",
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      const startedAt = performance.now();
      try {
        const result = await handler(event, ...args);
        ctx.logger[level](`ipc ${channel}`, { mod: "main.ipc", channel, ms: Math.round(performance.now() - startedAt) });
        return result;
      } catch (error) {
        ctx.logger.error(`ipc ${channel} failed`, { mod: "main.ipc", channel, ms: Math.round(performance.now() - startedAt), err: error });
        throw error;
      }
    });
  };

  const publishSnapshots = () => {
    const project = ctx.projectSession.snapshot();
    const queue = ctx.projectSession.queueSnapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("project.snapshot", project);
      win.webContents.send("queue.snapshot", queue);
    }
  };
  const publishResult = async <T>(work: Promise<T> | T): Promise<T> => {
    const result = await work;
    publishSnapshots();
    return result;
  };

  ctx.projectSession.setSnapshotListener(async () => {
    publishSnapshots();
  });

  let settingsChain: Promise<unknown> = Promise.resolve();
  const serializeSettings = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = settingsChain.then(fn, fn);
    settingsChain = next.catch(() => {});
    return next;
  };

  let stateChain: Promise<unknown> = Promise.resolve();
  const serializeState = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = stateChain.then(fn, fn);
    stateChain = next.catch(() => {});
    return next;
  };

  handle("system.getInfo", "debug", async () => ({
    appName: APP_NAME,
    version: ctx.version,
    dataDir: ctx.paths.dataDir,
    lutsDir: ctx.paths.lutsDir,
    stampsDir: ctx.paths.stampsDir,
    cpuCount: os.cpus().length
  }));
  // The renderer's own log forwarding — registered raw so the chokepoint doesn't
  // log a line about every forwarded log line. The renderer is sandboxed and its
  // payload is untrusted, so the level, message, and fields are all validated;
  // the `source` stamp is applied last so a renderer-supplied `source` field can
  // never overwrite it. The fields then run through the same redactor as main's.
  ipcMain.handle("system.log", async (_event, entry: RendererLogEntry) => {
    if (!entry || (entry.level !== "warn" && entry.level !== "error") || typeof entry.message !== "string") return;
    const fields = entry.fields && typeof entry.fields === "object" && !Array.isArray(entry.fields) ? entry.fields : {};
    ctx.logger[entry.level](entry.message, { ...fields, source: "renderer" });
  });
  handle("system.revealInFolder", "info", async (_event, filePath: string) => {
    if (typeof filePath !== "string" || filePath.length === 0) return;
    const resolved = path.resolve(filePath);
    try {
      await fs.lstat(resolved);
    } catch (error) {
      ctx.logger.warn("revealInFolder skipped: path does not exist", { mod: "main.ipc", filePath: resolved, err: error });
      return;
    }
    shell.showItemInFolder(resolved);
  });
  handle("system.openExternal", "info", async (_event, url: string) => {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new Error(`Unsupported external URL protocol: ${target.protocol}`);
    }
    await shell.openExternal(target.toString());
  });
  handle("system.pickFile", "info", async (event, options: { title: string; extensions: string[] }) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      properties: ["openFile"],
      filters: [
        { name: "Supported files", extensions: options.extensions },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle("system.pickFiles", "info", async (event, options: { title: string; extensions: string[] }) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Supported files", extensions: options.extensions },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? [] : result.filePaths;
  });
  handle("system.pickDirectory", "info", async (event, options: { title: string }) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      properties: ["openDirectory", "createDirectory"]
    };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  handle("settings.get", "debug", async () => ctx.settings);
  handle("settings.update", "info", async (_event, patch: Partial<GlobalSettings>) => {
    return serializeSettings(async () => {
      const nextCandidate = isRecord(patch) ? { ...ctx.settings, ...patch } : ctx.settings;
      const { settings, issues } = normalizeGlobalSettings(nextCandidate, ctx.settings);
      for (const issue of issues) {
        ctx.logger.warn("settings patch contained invalid data", { mod: "main.ipc", issue });
      }
      await saveSettings(ctx.paths.settingsPath, settings);
      Object.assign(ctx.settings, settings);
      return ctx.settings;
    });
  });
  handle("settings.hasGeminiApiKey", "debug", async () => ctx.projectSession.hasGeminiApiKey());
  handle("settings.setGeminiApiKey", "info", async (_event, apiKey: string) => ctx.projectSession.setGeminiApiKey(apiKey));
  handle("settings.clearGeminiApiKey", "info", async () => ctx.projectSession.clearGeminiApiKey());

  handle("state.get", "debug", async () => ctx.uiState);
  handle("state.update", "info", async (_event, patch: Partial<UiState>) => {
    return serializeState(async () => {
      const candidate = isRecord(patch) ? { ...ctx.uiState, ...patch } : ctx.uiState;
      const { state, issues } = normalizeUiState(candidate, ctx.uiState);
      for (const issue of issues) {
        ctx.logger.warn("state patch contained invalid data", { mod: "main.ipc", issue });
      }
      await saveState(ctx.paths.statePath, state);
      Object.assign(ctx.uiState, state);
      return ctx.uiState;
    });
  });

  handle("project.current", "debug", async () => ctx.projectSession.snapshot());
  handle("project.setOutputDirFromDialog", "info", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose Output Directory",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return ctx.projectSession.snapshot();
    }
    return publishResult(ctx.projectSession.setOutputDir(result.filePaths[0]));
  });
  handle("project.clearOutputDir", "info", async () => publishResult(ctx.projectSession.setOutputDir("")));
  handle("project.addOriginalsFromDialog", "info", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Add Originals",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images and FotoReady parameters", extensions: [...IMPORT_FILE_EXTENSIONS] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return ctx.projectSession.snapshot();
    }

    return publishResult(ctx.projectSession.addOriginals(result.filePaths));
  });
  handle("project.addOriginals", "info", async (_event, sourcePaths: string[]) => {
    const normalized = normalizeAddOriginalsPaths(sourcePaths, ctx.logger);
    return publishResult(ctx.projectSession.addOriginals(normalized));
  });
  handle("project.removeOriginal", "info", async (_event, originalId: string) => publishResult(ctx.projectSession.removeOriginal(originalId)));
  handle("project.selectOriginal", "info", async (_event, originalId: string) => publishResult(ctx.projectSession.selectOriginal(originalId)));

  handle("task.select", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.selectTask(taskId)));
  handle("task.fork", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.forkTask(taskId)));
  handle("task.delete", "info", async (_event, taskId: string) =>
    publishResult(ctx.projectSession.deleteTask(taskId))
  );
  handle("task.deleteSavedOutput", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.deleteSavedOutput(taskId)));
  handle("task.dismissError", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.dismissTaskError(taskId)));
  handle("task.retry", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.retryTask(taskId)));
  handle("task.save", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.enqueueSave(taskId)));
  handle("task.saveAll", "info", async () => publishResult(ctx.projectSession.enqueueSaveAll()));
  handle("task.cancel", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.cancelTask(taskId)));
  handle("task.cancelAll", "info", async () => publishResult(ctx.projectSession.cancelAll()));
  handle("task.addOp", "info", async (_event, taskId: string, opType: string) => publishResult(ctx.projectSession.addOp(taskId, opType)));
  handle("task.removeOp", "info", async (_event, taskId: string, opId: string) => publishResult(ctx.projectSession.removeOp(taskId, opId)));
  handle("task.moveOp", "info", async (_event, taskId: string, opId: string, toIndex: number) => publishResult(ctx.projectSession.moveOp(taskId, opId, toIndex)));
  handle("task.setOpEnabled", "info", async (_event, taskId: string, opId: string, enabled: boolean) => publishResult(ctx.projectSession.setOpEnabled(taskId, opId, enabled)));
  // Op-parameter and output edits stream from slider drags (many per second) —
  // developer-only debug per the volume rules; the saved result is logged at info.
  handle("task.updateOpParam", "debug", async (_event, taskId: string, opId: string, key: string, value: unknown, options?: TaskEditOptions) =>
    publishResult(ctx.projectSession.updateOpParam(taskId, opId, key, value, options))
  );
  handle("task.updateOpParams", "debug", async (_event, taskId: string, opId: string, patch: Record<string, unknown>, options?: TaskEditOptions) =>
    publishResult(ctx.projectSession.updateOpParams(taskId, opId, patch, options))
  );
  handle("task.undo", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.undoTaskEdit(taskId)));
  handle("task.setGenerateDescription", "info", async (_event, taskId: string, generateDescription: boolean) => publishResult(ctx.projectSession.setGenerateDescription(taskId, generateDescription)));
  handle("task.setGenerateSlug", "info", async (_event, taskId: string, generateSlug: boolean) => publishResult(ctx.projectSession.setGenerateSlug(taskId, generateSlug)));
  handle("task.setCustomSlug", "info", async (_event, taskId: string, customSlug: string | null) => publishResult(ctx.projectSession.setCustomSlug(taskId, customSlug)));
  handle("task.clearVision", "info", async (_event, taskId: string) => publishResult(ctx.projectSession.clearVision(taskId)));
  handle("task.updateOutput", "debug", async (_event, taskId: string, key: string, value: unknown, options?: TaskEditOptions) =>
    publishResult(ctx.projectSession.updateOutput(taskId, key, value, options))
  );

  handle("assets.aspectRatio", "debug", async (_event, assetPath: string) => {
    if (typeof assetPath !== "string" || !assetPath) return 1;
    try {
      return await readAssetAspectRatio(assetPath);
    } catch (err) {
      ctx.logger.warn("failed to read asset aspect ratio", { mod: "main.ipc", assetPath, err });
      return 1;
    }
  });
  handle("assets.thumbnail", "debug", async (_event, assetPath: string, longEdge?: number) => {
    return assetThumbnailCache.get(assetPath, longEdge);
  });
  handle("ops.list", "debug", async () =>
    listOpDefinitions().map(({ type, label, pickerLabel, category, defaultParams, previewBehavior, metadataOnly }) => ({
      type,
      label,
      pickerLabel,
      category,
      defaultParams,
      previewBehavior,
      metadataOnly
    }))
  );
  handle("preview.render", "debug", async (_event, taskId: string, options?: PreviewRenderOptions) =>
    ctx.projectSession.renderPreview(taskId, options)
  );
  handle("preview.originalThumbnail", "debug", async (_event, originalId: string) => ctx.projectSession.renderOriginalThumbnail(originalId));
  handle("vision.runForTask", "info", async (_event, taskId: string, options?: VisionRunOptions) => publishResult(ctx.projectSession.runVision(taskId, options)));
  handle("rename.preview", "debug", async (_event, templateId?: RenameTemplateId, taskIds?: string[]) => ctx.projectSession.previewRename(templateId, taskIds));
  handle("rename.run", "info", async (_event, templateId?: RenameTemplateId, taskIds?: string[]) => publishResult(ctx.projectSession.runRename(templateId, taskIds)));
  handle("luts.list", "debug", async () => listLuts(ctx.settings.lutFolder, ctx.paths.lutsDir, ctx.paths.bundledLutsDir));
  handle("luts.import", "info", async (_event, filePaths: string[]) => importLuts(filePaths, ctx.settings.lutFolder, ctx.paths.lutsDir, ctx.paths.bundledLutsDir));
  handle("luts.delete", "info", async (_event, filePaths: string[]) => deleteLuts(filePaths, ctx.settings.lutFolder, ctx.paths.lutsDir));
  handle("luts.preview", "debug", async (_event, taskId: string, options: PreviewRenderOptions | undefined, strength: number, previewLongEdge: number) => {
    const luts = await listLuts(ctx.settings.lutFolder, ctx.paths.lutsDir, ctx.paths.bundledLutsDir);
    return ctx.projectSession.renderLutPreviews(taskId, luts, options, strength, previewLongEdge);
  });
  handle("stamps.list", "debug", async () => listStamps(ctx.settings.stampFolder, ctx.paths.stampsDir, ctx.paths.bundledStampsDir));
  handle("stamps.import", "info", async (_event, filePaths: string[]) => importStamps(filePaths, ctx.settings.stampFolder, ctx.paths.stampsDir, ctx.paths.bundledStampsDir));
  handle("stamps.delete", "info", async (_event, filePaths: string[]) => deleteStamps(filePaths, ctx.settings.stampFolder, ctx.paths.stampsDir));
  handle("queues.snapshot", "debug", async () => ctx.projectSession.queueSnapshot());
}

function normalizeAddOriginalsPaths(sourcePaths: unknown, logger: AppLogger): string[] {
  if (!Array.isArray(sourcePaths)) return [];
  const allowed = new Set<string>(IMPORT_FILE_EXTENSIONS.map((extension) => `.${extension}`));
  const seen = new Set<string>();
  const accepted: string[] = [];
  for (const entry of sourcePaths) {
    if (typeof entry !== "string" || entry.trim().length === 0) continue;
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const extension = path.extname(resolved).toLowerCase();
    if (!allowed.has(extension)) {
      logger.warn("addOriginals rejected unsupported extension", { mod: "main.ipc", filePath: resolved, extension });
      continue;
    }
    accepted.push(resolved);
  }
  return accepted;
}
