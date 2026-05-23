import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import type { AppPaths } from "@main/paths";
import type { ProjectSession } from "@main/session";
import type { AppLogger } from "@main/logger";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import { APP_NAME } from "@shared/constants";
import { listOpDefinitions } from "@core/ops/catalog";
import { readAssetAspectRatio } from "@core/ops/_asset-overlay";
import type { PreviewRenderOptions, TaskEditOptions, VisionRunOptions } from "@shared/types/ipc";
import { saveSettings } from "@main/settings-io";
import { saveState } from "@main/state-io";
import { deleteLut, importLuts, listLuts, restoreBuiltInLuts } from "@main/lut-catalog";
import { deleteStamp, importStamps, listStamps, restoreBuiltInStamps } from "@main/stamp-catalog";
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
    shell.showItemInFolder(filePath);
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
    const nextCandidate = isRecord(patch) ? { ...ctx.settings, ...patch } : ctx.settings;
    const { settings, issues } = normalizeGlobalSettings(nextCandidate, ctx.settings);
    for (const issue of issues) {
      ctx.logger.warn({ mod: "main.ipc", issue }, "settings patch contained invalid data");
    }
    await saveSettings(ctx.paths.settingsPath, settings);
    Object.assign(ctx.settings, settings);
    return ctx.settings;
  });
  ipcMain.handle("settings.hasGeminiApiKey", async () => ctx.projectSession.hasGeminiApiKey());
  ipcMain.handle("settings.setGeminiApiKey", async (_event, apiKey: string) => ctx.projectSession.setGeminiApiKey(apiKey));
  ipcMain.handle("settings.clearGeminiApiKey", async () => ctx.projectSession.clearGeminiApiKey());

  ipcMain.handle("state.get", async () => ctx.uiState);
  ipcMain.handle("state.update", async (_event, patch: Partial<UiState>) => {
    const candidate = isRecord(patch) ? { ...ctx.uiState, ...patch } : ctx.uiState;
    const { state, issues } = normalizeUiState(candidate, ctx.uiState);
    for (const issue of issues) {
      ctx.logger.warn({ mod: "main.ipc", issue }, "state patch contained invalid data");
    }
    await saveState(ctx.paths.statePath, state);
    Object.assign(ctx.uiState, state);
    return ctx.uiState;
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
        { name: "Images and FotoReady parameters", extensions: ["jpg", "jpeg", "png", "webp", "avif", "heic", "gif", "tif", "tiff", "json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return ctx.projectSession.snapshot();
    }

    return publishResult(ctx.projectSession.addOriginals(result.filePaths));
  });
  ipcMain.handle("project.addOriginals", async (_event, sourcePaths: string[]) => publishResult(ctx.projectSession.addOriginals(sourcePaths)));
  ipcMain.handle("project.removeOriginal", async (_event, originalId: string) => publishResult(ctx.projectSession.removeOriginal(originalId)));
  ipcMain.handle("project.selectOriginal", async (_event, originalId: string) => publishResult(ctx.projectSession.selectOriginal(originalId)));

  ipcMain.handle("task.select", async (_event, taskId: string) => publishResult(ctx.projectSession.selectTask(taskId)));
  ipcMain.handle("task.fork", async (_event, taskId: string) => publishResult(ctx.projectSession.forkTask(taskId)));
  ipcMain.handle("task.delete", async (_event, taskId: string, options?: { deleteStagedOutput?: boolean; deleteFinalOutput?: boolean }) =>
    publishResult(ctx.projectSession.deleteTask(taskId, options))
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
    const size = Number.isFinite(longEdge) ? Math.max(32, Math.min(512, Math.round(longEdge ?? 160))) : 160;
    const isSvg = path.extname(assetPath).toLowerCase() === ".svg";
    const { data, info } = await sharp(assetPath, { limitInputPixels: false })
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: !isSvg })
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    return {
      dataUrl: `data:image/png;base64,${data.toString("base64")}`,
      width: info.width,
      height: info.height
    };
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
  ipcMain.handle("luts.delete", async (_event, filePath: string) => deleteLut(filePath, ctx.settings.lutFolder, path.dirname(ctx.paths.dataDir), ctx.paths.bundledLutsDir));
  ipcMain.handle("luts.restoreBuiltIns", async () => restoreBuiltInLuts(ctx.settings.lutFolder, path.dirname(ctx.paths.dataDir), ctx.paths.bundledLutsDir));
  ipcMain.handle("luts.preview", async (_event, taskId: string, options: PreviewRenderOptions | undefined, strength: number) => {
    const luts = await listLuts(ctx.settings.lutFolder, path.dirname(ctx.paths.dataDir), ctx.paths.bundledLutsDir);
    return ctx.projectSession.renderLutPreviews(taskId, luts, options, strength);
  });
  ipcMain.handle("stamps.list", async () => listStamps(path.dirname(ctx.paths.dataDir), ctx.paths.bundledStampsDir));
  ipcMain.handle("stamps.import", async (_event, filePaths: string[]) => importStamps(filePaths, path.dirname(ctx.paths.dataDir), ctx.paths.bundledStampsDir));
  ipcMain.handle("stamps.delete", async (_event, filePath: string) => deleteStamp(filePath, path.dirname(ctx.paths.dataDir), ctx.paths.bundledStampsDir));
  ipcMain.handle("stamps.restoreBuiltIns", async () => restoreBuiltInStamps(path.dirname(ctx.paths.dataDir), ctx.paths.bundledStampsDir));
  ipcMain.handle("queues.snapshot", async () => ctx.projectSession.queueSnapshot());
}
