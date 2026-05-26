import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import type { AppPaths } from "@main/paths";
import type { ProjectSession } from "@main/session";
import type { AppLogger } from "@main/logger";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import { APP_NAME, IMPORT_FILE_EXTENSIONS } from "@shared/constants";
import { listOpDefinitions } from "@core/ops/catalog";
import { readAssetAspectRatio } from "@core/ops/_asset-overlay";
import type { PreviewRenderOptions, TaskEditOptions, VisionRunOptions } from "@shared/types/ipc";
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

  ipcMain.handle("system.getInfo", async () => ({
    appName: APP_NAME,
    version: ctx.version,
    dataDir: ctx.paths.dataDir,
    cpuCount: os.cpus().length
  }));
  ipcMain.handle("system.log", async (_event, level: "warn" | "error", message: string, detail?: string | null) => {
    ctx.logger[level]({ mod: "renderer", detail: detail ?? null }, message);
  });
  ipcMain.handle("system.revealInFolder", async (_event, filePath: string) => {
    if (typeof filePath !== "string" || filePath.length === 0) return;
    const resolved = path.resolve(filePath);
    try {
      await fs.lstat(resolved);
    } catch (error) {
      ctx.logger.warn({ mod: "main.ipc", filePath: resolved, err: String(error) }, "revealInFolder skipped: path does not exist");
      return;
    }
    shell.showItemInFolder(resolved);
  });
  ipcMain.handle("system.openExternal", async (_event, url: string) => {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new Error(`Unsupported external URL protocol: ${target.protocol}`);
    }
    await shell.openExternal(target.toString());
  });
  ipcMain.handle("system.pickFile", async (event, options: { title: string; extensions: string[] }) => {
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
  ipcMain.handle("system.pickFiles", async (event, options: { title: string; extensions: string[] }) => {
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
  ipcMain.handle("system.pickDirectory", async (event, options: { title: string }) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      properties: ["openDirectory", "createDirectory"]
    };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("settings.get", async () => ctx.settings);
  ipcMain.handle("settings.update", async (_event, patch: Partial<GlobalSettings>) => {
    return serializeSettings(async () => {
      const nextCandidate = isRecord(patch) ? { ...ctx.settings, ...patch } : ctx.settings;
      const { settings, issues } = normalizeGlobalSettings(nextCandidate, ctx.settings);
      for (const issue of issues) {
        ctx.logger.warn({ mod: "main.ipc", issue }, "settings patch contained invalid data");
      }
      await saveSettings(ctx.paths.settingsPath, settings);
      Object.assign(ctx.settings, settings);
      return ctx.settings;
    });
  });
  ipcMain.handle("settings.hasGeminiApiKey", async () => ctx.projectSession.hasGeminiApiKey());
  ipcMain.handle("settings.setGeminiApiKey", async (_event, apiKey: string) => ctx.projectSession.setGeminiApiKey(apiKey));
  ipcMain.handle("settings.clearGeminiApiKey", async () => ctx.projectSession.clearGeminiApiKey());

  ipcMain.handle("state.get", async () => ctx.uiState);
  ipcMain.handle("state.update", async (_event, patch: Partial<UiState>) => {
    return serializeState(async () => {
      const candidate = isRecord(patch) ? { ...ctx.uiState, ...patch } : ctx.uiState;
      const { state, issues } = normalizeUiState(candidate, ctx.uiState);
      for (const issue of issues) {
        ctx.logger.warn({ mod: "main.ipc", issue }, "state patch contained invalid data");
      }
      await saveState(ctx.paths.statePath, state);
      Object.assign(ctx.uiState, state);
      return ctx.uiState;
    });
  });

  ipcMain.handle("project.current", async () => ctx.projectSession.snapshot());
  ipcMain.handle("project.setOutputDirFromDialog", async (event) => {
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
  ipcMain.handle("project.clearOutputDir", async () => publishResult(ctx.projectSession.setOutputDir("")));
  ipcMain.handle("project.addOriginalsFromDialog", async (event) => {
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
  ipcMain.handle("project.addOriginals", async (_event, sourcePaths: string[]) => {
    const normalized = normalizeAddOriginalsPaths(sourcePaths, ctx.logger);
    return publishResult(ctx.projectSession.addOriginals(normalized));
  });
  ipcMain.handle("project.removeOriginal", async (_event, originalId: string) => publishResult(ctx.projectSession.removeOriginal(originalId)));
  ipcMain.handle("project.selectOriginal", async (_event, originalId: string) => publishResult(ctx.projectSession.selectOriginal(originalId)));

  ipcMain.handle("task.select", async (_event, taskId: string) => publishResult(ctx.projectSession.selectTask(taskId)));
  ipcMain.handle("task.fork", async (_event, taskId: string) => publishResult(ctx.projectSession.forkTask(taskId)));
  ipcMain.handle("task.delete", async (_event, taskId: string) =>
    publishResult(ctx.projectSession.deleteTask(taskId))
  );
  ipcMain.handle("task.deleteSavedOutput", async (_event, taskId: string) => publishResult(ctx.projectSession.deleteSavedOutput(taskId)));
  ipcMain.handle("task.dismissError", async (_event, taskId: string) => publishResult(ctx.projectSession.dismissTaskError(taskId)));
  ipcMain.handle("task.retry", async (_event, taskId: string) => publishResult(ctx.projectSession.retryTask(taskId)));
  ipcMain.handle("task.save", async (_event, taskId: string) => publishResult(ctx.projectSession.enqueueSave(taskId)));
  ipcMain.handle("task.saveAll", async () => publishResult(ctx.projectSession.enqueueSaveAll()));
  ipcMain.handle("task.cancel", async (_event, taskId: string) => publishResult(ctx.projectSession.cancelTask(taskId)));
  ipcMain.handle("task.cancelAll", async () => publishResult(ctx.projectSession.cancelAll()));
  ipcMain.handle("task.addOp", async (_event, taskId: string, opType: string) => publishResult(ctx.projectSession.addOp(taskId, opType)));
  ipcMain.handle("task.removeOp", async (_event, taskId: string, opId: string) => publishResult(ctx.projectSession.removeOp(taskId, opId)));
  ipcMain.handle("task.moveOp", async (_event, taskId: string, opId: string, toIndex: number) => publishResult(ctx.projectSession.moveOp(taskId, opId, toIndex)));
  ipcMain.handle("task.setOpEnabled", async (_event, taskId: string, opId: string, enabled: boolean) => publishResult(ctx.projectSession.setOpEnabled(taskId, opId, enabled)));
  ipcMain.handle("task.updateOpParam", async (_event, taskId: string, opId: string, key: string, value: unknown, options?: TaskEditOptions) =>
    publishResult(ctx.projectSession.updateOpParam(taskId, opId, key, value, options))
  );
  ipcMain.handle("task.updateOpParams", async (_event, taskId: string, opId: string, patch: Record<string, unknown>, options?: TaskEditOptions) =>
    publishResult(ctx.projectSession.updateOpParams(taskId, opId, patch, options))
  );
  ipcMain.handle("task.undo", async (_event, taskId: string) => publishResult(ctx.projectSession.undoTaskEdit(taskId)));
  ipcMain.handle("task.setGenerateDescription", async (_event, taskId: string, generateDescription: boolean) => publishResult(ctx.projectSession.setGenerateDescription(taskId, generateDescription)));
  ipcMain.handle("task.setGenerateSlug", async (_event, taskId: string, generateSlug: boolean) => publishResult(ctx.projectSession.setGenerateSlug(taskId, generateSlug)));
  ipcMain.handle("task.setCustomSlug", async (_event, taskId: string, customSlug: string | null) => publishResult(ctx.projectSession.setCustomSlug(taskId, customSlug)));
  ipcMain.handle("task.clearVision", async (_event, taskId: string) => publishResult(ctx.projectSession.clearVision(taskId)));
  ipcMain.handle("task.updateOutput", async (_event, taskId: string, key: string, value: unknown, options?: TaskEditOptions) =>
    publishResult(ctx.projectSession.updateOutput(taskId, key, value, options))
  );

  ipcMain.handle("assets.aspectRatio", async (_event, assetPath: string) => {
    if (typeof assetPath !== "string" || !assetPath) return 1;
    try {
      return await readAssetAspectRatio(assetPath);
    } catch (err) {
      ctx.logger.warn({ mod: "main.ipc", assetPath, err: String(err) }, "failed to read asset aspect ratio");
      return 1;
    }
  });
  ipcMain.handle("assets.thumbnail", async (_event, assetPath: string, longEdge?: number) => {
    return assetThumbnailCache.get(assetPath, longEdge);
  });
  ipcMain.handle("ops.list", async () =>
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
  ipcMain.handle("preview.render", async (_event, taskId: string, options?: PreviewRenderOptions) =>
    ctx.projectSession.renderPreview(taskId, options)
  );
  ipcMain.handle("preview.originalThumbnail", async (_event, originalId: string) => ctx.projectSession.renderOriginalThumbnail(originalId));
  ipcMain.handle("vision.runForTask", async (_event, taskId: string, options?: VisionRunOptions) => publishResult(ctx.projectSession.runVision(taskId, options)));
  ipcMain.handle("rename.preview", async (_event, templateId?: RenameTemplateId, taskIds?: string[]) => ctx.projectSession.previewRename(templateId, taskIds));
  ipcMain.handle("rename.run", async (_event, templateId?: RenameTemplateId, taskIds?: string[]) => publishResult(ctx.projectSession.runRename(templateId, taskIds)));
  ipcMain.handle("luts.list", async () => listLuts(ctx.settings.lutFolder, path.dirname(ctx.paths.dataDir), ctx.paths.bundledLutsDir));
  ipcMain.handle("luts.import", async (_event, filePaths: string[]) => importLuts(filePaths, ctx.settings.lutFolder, path.dirname(ctx.paths.dataDir), ctx.paths.bundledLutsDir));
  ipcMain.handle("luts.delete", async (_event, filePaths: string[]) => deleteLuts(filePaths, ctx.settings.lutFolder, path.dirname(ctx.paths.dataDir)));
  ipcMain.handle("luts.preview", async (_event, taskId: string, options: PreviewRenderOptions | undefined, strength: number, previewLongEdge: number) => {
    const luts = await listLuts(ctx.settings.lutFolder, path.dirname(ctx.paths.dataDir), ctx.paths.bundledLutsDir);
    return ctx.projectSession.renderLutPreviews(taskId, luts, options, strength, previewLongEdge);
  });
  ipcMain.handle("stamps.list", async () => listStamps(ctx.settings.stampFolder, path.dirname(ctx.paths.dataDir), ctx.paths.bundledStampsDir));
  ipcMain.handle("stamps.import", async (_event, filePaths: string[]) => importStamps(filePaths, ctx.settings.stampFolder, path.dirname(ctx.paths.dataDir), ctx.paths.bundledStampsDir));
  ipcMain.handle("stamps.delete", async (_event, filePaths: string[]) => deleteStamps(filePaths, ctx.settings.stampFolder, path.dirname(ctx.paths.dataDir)));
  ipcMain.handle("queues.snapshot", async () => ctx.projectSession.queueSnapshot());
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
      logger.warn({ mod: "main.ipc", filePath: resolved, extension }, "addOriginals rejected unsupported extension");
      continue;
    }
    accepted.push(resolved);
  }
  return accepted;
}
