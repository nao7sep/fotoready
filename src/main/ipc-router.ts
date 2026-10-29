import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions, type WebContents } from "electron";
import type { AppPaths } from "@main/paths";
import type { ProjectSession } from "@main/session";
import type { AppLogger } from "@main/logger";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import { APP_NAME, IMPORT_FILE_EXTENSIONS } from "@shared/constants";
import { listOpDefinitions } from "@core/ops/catalog";
import { readAssetAspectRatio } from "@core/ops/_asset-overlay";
import type { FotoReadyApi, OriginalImportIssue, ProjectSnapshot, QueueSnapshot, PreviewRenderOptions, RendererLogEntry, TaskEditOptions, VisionRunOptions } from "@shared/types/ipc";
import { saveSettings, type SettingsFile } from "@main/settings-io";
import { StoreNotWritableError } from "@adapters/json-store";
import { applyThemePreference, osAppearance } from "@main/theme";
import { changeLanguagePreference, computerInterfaceLanguage, interfaceLanguage, mainTranslator } from "@main/i18n";
import { installApplicationMenu } from "@main/menu";
import { LANGUAGE_CHANGED_CHANNEL } from "@shared/language-channel";
import { DISPLAY_TIME_ZONE_CHANGED_CHANNEL } from "@shared/time-zone";
import type { StateCoordinator } from "@main/state-io";
import type { UnsavedWrite } from "@main/quit-save";
import { AssetThumbnailCache } from "@main/asset-thumbnail-cache";
import { deleteLuts, importLuts, listLuts } from "@main/lut-catalog";
import { resolveProjectOutputDir } from "@main/output-paths";
import { expandConfiguredPath, resolveConfiguredPath, PathVariableError, pathVariableReason } from "@main/configured-path";
import { ipcFailure } from "@shared/ipc-failure";
import { LibraryFolderError } from "@main/file-asset-catalog";
import { deleteStamps, importStamps, listStamps } from "@main/stamp-catalog";
import { isRecord } from "@shared/validation/common";
import type { RenameTemplateId } from "@shared/rename-template";
import { message } from "@shared/i18n/translate";
import type { StoreWriter } from "@main/store-writer";
import { recordSources } from "@main/records-sources";
import { assertRecordId, assertRecordKind, parseRecordsQuery } from "@shared/validation/records";

export type RouterContext = {
  paths: AppPaths;
  settings: GlobalSettings;
  settingsFile: SettingsFile;
  uiState: UiState;
  stateCoordinator: StateCoordinator;
  projectSession: ProjectSession;
  logger: AppLogger;
  version: string;
  records: {
    reader: Pick<StoreWriter, "read">;
    /** This launch's session, as its records carry it. */
    session: string;
    openWindow(): Promise<void>;
  };
};

export type IpcWork = {
  closeAdmission(): void;
  isIdle(): boolean;
  /** The latest settings save while it is not saved: the user's own work, which a quit waits for or asks about. */
  unsavedSettings(): UnsavedWrite | null;
};

export function registerIpcHandlers(ctx: RouterContext): IpcWork {
  let accepting = true;
  let active = 0;
  const assetThumbnailCache = new AssetThumbnailCache();

  // Single IPC chokepoint: every handler is logged once on completion with its
  // duration and outcome, and any thrown failure is logged at `error` before it
  // propagates to the renderer; a failure with a user-facing reason (a
  // configured path naming an unset variable, a library folder that cannot be
  // read) goes back as an IpcFailure
  // instead. `level` splits genuine user intents (`info`)
  // from high-frequency / pure-query channels (`debug`), so editing-driven
  // traffic (preview, thumbnails, slider drags) stays in the developer-only
  // firehose. Channel name and timing only — never the arguments, per
  // "summarize, don't dump". A `null` level logs failures only: the Records
  // window's reads, whose success line would itself be a new record that starts
  // the window's next read, so an open window would read once a second forever.
  const handle = (
    channel: string,
    level: "info" | "debug" | null,
    handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!accepting) throw new Error("FotoReady is quitting.");
      active += 1;
      const startedAt = performance.now();
      try {
        const result = await handler(event, ...args);
        if (level !== null) ctx.logger[level](`ipc ${channel}`, { mod: "main.ipc", channel, ms: Math.round(performance.now() - startedAt) });
        return result;
      } catch (error) {
        ctx.logger.error(`ipc ${channel} failed`, { mod: "main.ipc", channel, ms: Math.round(performance.now() - startedAt), err: error });
        if (error instanceof PathVariableError) return ipcFailure(pathVariableReason(error));
        if (error instanceof LibraryFolderError || error instanceof StoreNotWritableError) return ipcFailure(error.reason);
        throw error;
      } finally {
        active -= 1;
      }
    });
  };

  let assetWrites: Promise<unknown> = Promise.resolve();
  const mutateAssets = <T>(work: () => Promise<T>): Promise<T> => {
    const mutate = async (): Promise<T> => {
      try { return await work(); }
      finally {
        // A batch can change earlier files before a later import or trash operation fails.
        ctx.projectSession.invalidateAssetPreviews();
        assetThumbnailCache.clear();
      }
    };
    const result = assetWrites.then(mutate, mutate);
    assetWrites = result.catch(() => undefined);
    return result;
  };

  // Snapshots have one delivery path, the window's subscription: replies carry none. A reply follows
  // the events sent before it on the same channel, so a caller that awaits a reply has its snapshot.
  const sendSnapshots = (target: WebContents, project: ProjectSnapshot, queue: QueueSnapshot): void => {
    target.send("project.snapshot", project);
    target.send("queue.snapshot", queue);
  };
  const publishSnapshots = (project: ProjectSnapshot, queue: QueueSnapshot) => {
    for (const win of BrowserWindow.getAllWindows()) sendSnapshots(win.webContents, project, queue);
  };
  const publishResult = async (work: Promise<ProjectSnapshot> | ProjectSnapshot): Promise<void> => {
    publishSnapshots(await work, ctx.projectSession.queueSnapshot());
  };
  const publishWithResult = async <T extends { snapshot: ProjectSnapshot }>(work: Promise<T>): Promise<Omit<T, "snapshot">> => {
    const { snapshot, ...result } = await work;
    publishSnapshots(snapshot, ctx.projectSession.queueSnapshot());
    return result;
  };

  ctx.projectSession.setSnapshotListener((project, queue) => {
    publishSnapshots(project, queue);
  });

  let pendingOriginalFiles = 0;
  const importOriginals = async (paths: string[], issues: OriginalImportIssue[]) => {
    const publishActivity = () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send("originals.importActivity", pendingOriginalFiles);
    };
    pendingOriginalFiles += paths.length;
    publishActivity();
    try { return await ctx.projectSession.addOriginals(paths, issues); }
    finally {
      pendingOriginalFiles -= paths.length;
      publishActivity();
    }
  };

  let settingsChain: Promise<unknown> = Promise.resolve();
  let settingsSubmission = 0;
  // A later save supersedes it: each save holds the whole draft.
  let unsavedSettings: UnsavedWrite | null = null;
  const saveSettingsInTurn = (write: (retrying: boolean) => Promise<GlobalSettings>, retrying = false): Promise<GlobalSettings> => {
    const settled = settingsChain.then(() => write(retrying), () => write(retrying));
    settingsChain = settled.catch(() => {});
    const entry: UnsavedWrite = {
      work: { kind: "settings" },
      running: true,
      settled,
      retry: () => void saveSettingsInTurn(write, true).catch(() => undefined)
    };
    unsavedSettings = entry;
    settled.then(() => { if (unsavedSettings === entry) unsavedSettings = null; }, () => { entry.running = false; });
    return settled;
  };

  handle("system.getInfo", "debug", async () => ({
    appName: APP_NAME,
    version: ctx.version,
    dataDir: ctx.paths.dataDir,
    lutsDir: ctx.paths.lutsDir,
    stampsDir: ctx.paths.stampsDir,
    cpuCount: os.cpus().length,
    platform: process.platform
  }));
  // The renderer's own log forwarding — registered raw so the chokepoint doesn't
  // log a line about every forwarded log line. The renderer is sandboxed and its
  // payload is untrusted, so the level, message, and fields are all validated;
  // the `source` stamp is applied last so a renderer-supplied `source` field can
  // never overwrite it.
  ipcMain.handle("system.log", async (_event, entry: RendererLogEntry) => {
    if (!entry || (entry.level !== "warn" && entry.level !== "error") || typeof entry.message !== "string") return;
    const fields = entry.fields && typeof entry.fields === "object" && !Array.isArray(entry.fields) ? entry.fields : {};
    ctx.logger[entry.level](entry.message, { ...fields, source: "renderer" });
  });
  handle("system.revealInFolder", "info", async (_event, filePath: string, purpose?: "output") => {
    if (typeof filePath !== "string" || filePath.length === 0) return;
    const resolved = purpose === "output" ? projectOutputPath(filePath) : path.isAbsolute(filePath) ? path.resolve(filePath) : undefined;
    if (!resolved) throw new Error("The output folder needs an active photo or a shared source folder to resolve its location.");
    // A missing path rejects, so the caller can say the folder could not be shown instead of
    // the click doing nothing.
    await fs.lstat(resolved);
    shell.showItemInFolder(resolved);
  });
  handle("system.openExternal", "info", async (_event, url: string) => {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new Error(`Unsupported external URL protocol: ${target.protocol}`);
    }
    await shell.openExternal(target.toString());
  });
  handle("system.pickFile", "info", async (event, options: Parameters<FotoReadyApi["system"]["pickFile"]>[0]) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const { t } = mainTranslator();
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      properties: ["openFile"],
      defaultPath: options.defaultPath?.trim() ? resolveConfiguredPath(options.defaultPath, os.homedir()) : undefined,
      filters: [
        { name: t("dialog.filterSupported"), extensions: options.extensions },
        { name: t("dialog.filterAll"), extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle("system.pickFiles", "info", async (event, options: { title: string; extensions: string[] }) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const { t } = mainTranslator();
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: t("dialog.filterSupported"), extensions: options.extensions },
        { name: t("dialog.filterAll"), extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? [] : result.filePaths;
  });
  // Output expressions are relative to a photo, unlike asset settings, which use Home.
  // Use the active photo or one shared source folder; never invent a base from an arbitrary photo.
  const projectOutputPath = (value: string | null): string | undefined => {
    const snapshot = ctx.projectSession.snapshot();
    const { project, activeTaskId } = snapshot;
    const task = project.tasks.find((item) => item.id === activeTaskId);
    const source = project.originals.find((item) => item.id === task?.originalId);
    const parents = new Set(project.originals.map((item) => path.dirname(item.sourcePath)));
    const sourcePath = source?.sourcePath ?? (parents.size === 1 ? project.originals[0]?.sourcePath : undefined);
    if (sourcePath) return resolveProjectOutputDir(value, sourcePath);
    // Absolute and home/env expressions do not need a source-relative base.
    if (value) {
      const expanded = expandConfiguredPath(value);
      if (path.isAbsolute(expanded)) return expanded;
    }
    return undefined;
  };
  handle("system.pickDirectory", "info", async (event, options: Parameters<FotoReadyApi["system"]["pickDirectory"]>[0]) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      properties: ["openDirectory", "createDirectory"],
      defaultPath: options.purpose === "output"
        ? projectOutputPath(options.defaultPath ?? null)
        : options.defaultPath?.trim() ? resolveConfiguredPath(options.defaultPath, os.homedir()) : undefined
    };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  handle("language.current", "debug", async () => interfaceLanguage());
  // What each System choice resolves to now, for its label in Settings; the zone the renderer reads itself.
  handle("system.systemChoices", "debug", async () => ({ language: computerInterfaceLanguage(), appearance: await osAppearance() }));
  handle("settings.get", "debug", async () => ctx.settings);
  handle("settings.update", "info", async (_event, draft: unknown) => {
    const submission = ++settingsSubmission;
    const retryIsCurrent = (): boolean => submission === settingsSubmission;
    return saveSettingsInTurn(async (retrying) => {
      if (retrying && !retryIsCurrent()) return ctx.settings;
      const settings = await saveSettings(ctx.settingsFile, draft, ctx.settings, ctx.logger);
      const zoneChanged = settings.displayTimeZone !== ctx.settings.displayTimeZone;
      const fontChanged = settings.uiFontFamily !== ctx.settings.uiFontFamily;
      Object.assign(ctx.settings, settings);
      if (fontChanged) for (const win of BrowserWindow.getAllWindows()) win.webContents.send("settings.ui-font-changed", settings.uiFontFamily);
      if (zoneChanged) {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send(DISPLAY_TIME_ZONE_CHANGED_CHANNEL, settings.displayTimeZone);
      }
      // Settings apply on Save, the theme and the language included (app-chrome conventions, Theme;
      // localization-conventions). A language change rebuilds the menu bar and reaches every window.
      applyThemePreference(settings.theme);
      if (await changeLanguagePreference(settings.language)) {
        installApplicationMenu(mainTranslator());
        const language = interfaceLanguage();
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send(LANGUAGE_CHANGED_CHANNEL, language);
      }
      return ctx.settings;
    });
  });
  handle("settings.hasGeminiApiKey", "debug", async () => ctx.projectSession.hasGeminiApiKey());
  handle("settings.setGeminiApiKey", "info", async (_event, apiKey: string) => ctx.projectSession.setGeminiApiKey(apiKey));
  handle("settings.clearGeminiApiKey", "info", async () => ctx.projectSession.clearGeminiApiKey());

  handle("state.get", "debug", async () => ctx.uiState);
  handle("state.toggleHistogram", "info", async () => {
    const result = await ctx.stateCoordinator.update((current) => ({ showHistogram: !current.showHistogram }));
    return result.state;
  });

  handle("state.update", "info", async (_event, patch: Partial<UiState>) => {
    const { issues } = await ctx.stateCoordinator.update(isRecord(patch) ? patch : {});
    for (const issue of issues) {
      ctx.logger.warn("state patch contained invalid data", { mod: "main.ipc", issue });
    }
    return ctx.uiState;
  });

  handle("project.subscribe", "debug", async (event) => sendSnapshots(event.sender, ctx.projectSession.snapshot(), ctx.projectSession.queueSnapshot()));
  handle("project.setOutputDirFromDialog", "info", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: mainTranslator().t("dialog.chooseOutputFolder"),
      properties: ["openDirectory", "createDirectory"],
      defaultPath: projectOutputPath(ctx.projectSession.project().outputDir)
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    await publishResult(ctx.projectSession.setOutputDir(result.filePaths[0]));
    return { cancelled: false };
  });
  handle("project.clearOutputDir", "info", async () => publishResult(ctx.projectSession.setOutputDir("")));
  handle("project.addOriginalsFromDialog", "info", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const { t } = mainTranslator();
    const options: OpenDialogOptions = {
      title: t("dialog.addOriginals"),
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: t("dialog.filterImportable"), extensions: [...IMPORT_FILE_EXTENSIONS] },
        { name: t("dialog.filterAll"), extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return {
        canceled: true,
        acceptedImages: 0,
        addedOriginals: 0,
        restoredTasks: 0,
        succeededPaths: [],
        issues: []
      };
    }

    const normalized = normalizeAddOriginalsPaths(result.filePaths, ctx.logger);
    return publishWithResult(importOriginals(normalized.paths, normalized.issues));
  });
  handle("project.addOriginals", "info", async (event, sourcePaths: string[]) => {
    const normalized = normalizeAddOriginalsPaths(sourcePaths, ctx.logger);
    return publishWithResult(importOriginals(normalized.paths, normalized.issues));
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
  handle("task.addOp", "info", async (_event, taskId: string, opType: string, sourcePath?: string) => publishResult(ctx.projectSession.addOp(taskId, opType, sourcePath)));
  handle("task.removeOp", "info", async (_event, taskId: string, opId: string) => publishResult(ctx.projectSession.removeOp(taskId, opId)));
  handle("task.moveOp", "info", async (_event, taskId: string, opId: string, toIndex: number) => publishResult(ctx.projectSession.moveOp(taskId, opId, toIndex)));
  handle("task.setOpEnabled", "info", async (_event, taskId: string, opId: string, enabled: boolean) => publishResult(ctx.projectSession.setOpEnabled(taskId, opId, enabled)));
  // Op-parameter and output edits stream from slider drags (many per second) —
  // logged at debug so a drag cannot flood the log; the saved result is logged at info.
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
    if (typeof assetPath !== "string" || !assetPath) throw new Error("An asset path is required.");
    return readAssetAspectRatio(assetPath);
  });
  handle("assets.thumbnail", "debug", async (_event, assetPath: string, longEdge?: number) => {
    return assetThumbnailCache.get(assetPath, longEdge);
  });
  handle("ops.list", "debug", async () =>
    listOpDefinitions().map(({ type, category, defaultParams, previewBehavior, metadataOnly }) => ({
      type,
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
  handle("rename.run", "info", async (_event, templateId?: RenameTemplateId, taskIds?: string[]) => publishWithResult(ctx.projectSession.runRename(templateId, taskIds)));
  handle("luts.list", "debug", async () => listLuts(ctx.settings.lutFolder, ctx.paths.lutsDir, ctx.paths.bundledLutsDir, ctx.logger));
  handle("luts.import", "info", async (_event, filePaths: string[]) => mutateAssets(() => importLuts(filePaths, ctx.settings.lutFolder, ctx.paths.lutsDir, ctx.paths.bundledLutsDir, ctx.logger)));
  handle("luts.delete", "info", async (_event, filePaths: string[]) => mutateAssets(() => deleteLuts(filePaths, ctx.settings.lutFolder, ctx.paths.lutsDir)));
  handle("luts.cancelPreview", "debug", async () => ctx.projectSession.cancelLutPreview());
  handle("luts.preview", "debug", async (_event, taskId: string, options: PreviewRenderOptions | undefined, strength: number, previewLongEdge: number) =>
    ctx.projectSession.renderLutPreviews(taskId, () => listLuts(ctx.settings.lutFolder, ctx.paths.lutsDir, ctx.paths.bundledLutsDir, ctx.logger), options, strength, previewLongEdge));
  handle("stamps.list", "debug", async () => listStamps(ctx.settings.stampFolder, ctx.paths.stampsDir, ctx.paths.bundledStampsDir, ctx.logger));
  handle("stamps.import", "info", async (_event, filePaths: string[]) => mutateAssets(() => importStamps(filePaths, ctx.settings.stampFolder, ctx.paths.stampsDir, ctx.paths.bundledStampsDir, ctx.logger)));
  handle("stamps.delete", "info", async (_event, filePaths: string[]) => mutateAssets(() => deleteStamps(filePaths, ctx.settings.stampFolder, ctx.paths.stampsDir)));

  handle("records.open", "info", async () => ctx.records.openWindow());
  handle("records.page", null, async (_event, query: unknown) =>
    ctx.records.reader.read({ op: "page", query: parseRecordsQuery(query) })
  );
  handle("records.detail", null, async (_event, kind: unknown, id: unknown) =>
    ctx.records.reader.read({ op: "detail", kind: assertRecordKind(kind), id: assertRecordId(id) })
  );
  handle("records.sources", null, async () =>
    recordSources(await ctx.records.reader.read({ op: "sources" }), ctx.records.session, ctx.projectSession.project())
  );
  // Count admitted calls until their actual settlement, including native reads and queued work.
  return { closeAdmission: () => { accepting = false; }, isIdle: () => active === 0, unsavedSettings: () => unsavedSettings };
}

function normalizeAddOriginalsPaths(
  sourcePaths: unknown,
  logger: AppLogger
): { paths: string[]; issues: OriginalImportIssue[] } {
  if (!Array.isArray(sourcePaths)) return { paths: [], issues: [] };
  const allowed = new Set<string>(IMPORT_FILE_EXTENSIONS.map((extension) => `.${extension}`));
  const seen = new Set<string>();
  const accepted: string[] = [];
  const issues: OriginalImportIssue[] = [];
  for (const entry of sourcePaths) {
    if (typeof entry !== "string" || entry.trim().length === 0) continue;
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const extension = path.extname(resolved).toLowerCase();
    if (!allowed.has(extension)) {
      logger.warn("addOriginals rejected unsupported extension", { mod: "main.ipc", filePath: resolved, extension });
      issues.push({
        filePath: resolved,
        kind: "unsupported",
        severity: "warning",
        reason: message("importReason.unsupported")
      });
      continue;
    }
    accepted.push(resolved);
  }
  return { paths: accepted, issues };
}
