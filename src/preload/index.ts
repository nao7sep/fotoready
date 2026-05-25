import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { FotoReadyApi } from "@shared/types/ipc";

const api: FotoReadyApi = {
  system: {
    getInfo: () => ipcRenderer.invoke("system.getInfo"),
    filePathForFile: (file) => webUtils.getPathForFile(file),
    log: (level, message, detail) => ipcRenderer.invoke("system.log", level, message, detail),
    openExternal: (url) => ipcRenderer.invoke("system.openExternal", url),
    pickFile: (options) => ipcRenderer.invoke("system.pickFile", options),
    pickFiles: (options) => ipcRenderer.invoke("system.pickFiles", options),
    pickDirectory: (options) => ipcRenderer.invoke("system.pickDirectory", options),
    revealInFolder: (filePath) => ipcRenderer.invoke("system.revealInFolder", filePath)
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get"),
    update: (patch) => ipcRenderer.invoke("settings.update", patch),
    hasGeminiApiKey: () => ipcRenderer.invoke("settings.hasGeminiApiKey"),
    setGeminiApiKey: (apiKey) => ipcRenderer.invoke("settings.setGeminiApiKey", apiKey),
    clearGeminiApiKey: () => ipcRenderer.invoke("settings.clearGeminiApiKey")
  },
  state: {
    get: () => ipcRenderer.invoke("state.get"),
    update: (patch) => ipcRenderer.invoke("state.update", patch)
  },
  project: {
    current: () => ipcRenderer.invoke("project.current"),
    setOutputDirFromDialog: () => ipcRenderer.invoke("project.setOutputDirFromDialog"),
    clearOutputDir: () => ipcRenderer.invoke("project.clearOutputDir"),
    addOriginals: (sourcePaths) => ipcRenderer.invoke("project.addOriginals", sourcePaths),
    addOriginalsFromDialog: () => ipcRenderer.invoke("project.addOriginalsFromDialog"),
    removeOriginal: (originalId) => ipcRenderer.invoke("project.removeOriginal", originalId),
    selectOriginal: (originalId) => ipcRenderer.invoke("project.selectOriginal", originalId)
  },
  task: {
    select: (taskId) => ipcRenderer.invoke("task.select", taskId),
    fork: (taskId) => ipcRenderer.invoke("task.fork", taskId),
    delete: (taskId, options) => ipcRenderer.invoke("task.delete", taskId, options),
    deleteSavedOutput: (taskId) => ipcRenderer.invoke("task.deleteSavedOutput", taskId),
    dismissError: (taskId) => ipcRenderer.invoke("task.dismissError", taskId),
    retry: (taskId) => ipcRenderer.invoke("task.retry", taskId),
    save: (taskId) => ipcRenderer.invoke("task.save", taskId),
    saveAll: () => ipcRenderer.invoke("task.saveAll"),
    cancel: (taskId) => ipcRenderer.invoke("task.cancel", taskId),
    cancelAll: () => ipcRenderer.invoke("task.cancelAll"),
    addOp: (taskId, opType) => ipcRenderer.invoke("task.addOp", taskId, opType),
    removeOp: (taskId, opId) => ipcRenderer.invoke("task.removeOp", taskId, opId),
    moveOp: (taskId, opId, toIndex) => ipcRenderer.invoke("task.moveOp", taskId, opId, toIndex),
    setOpEnabled: (taskId, opId, enabled) => ipcRenderer.invoke("task.setOpEnabled", taskId, opId, enabled),
    updateOpParam: (taskId, opId, key, value, options) => ipcRenderer.invoke("task.updateOpParam", taskId, opId, key, value, options),
    updateOpParams: (taskId, opId, patch, options) => ipcRenderer.invoke("task.updateOpParams", taskId, opId, patch, options),
    undo: (taskId) => ipcRenderer.invoke("task.undo", taskId),
    setGenerateDescription: (taskId, generateDescription) => ipcRenderer.invoke("task.setGenerateDescription", taskId, generateDescription),
    setGenerateSlug: (taskId, generateSlug) => ipcRenderer.invoke("task.setGenerateSlug", taskId, generateSlug),
    setCustomSlug: (taskId, customSlug) => ipcRenderer.invoke("task.setCustomSlug", taskId, customSlug),
    clearVision: (taskId) => ipcRenderer.invoke("task.clearVision", taskId),
    updateOutput: (taskId, key, value, options) => ipcRenderer.invoke("task.updateOutput", taskId, key, value, options)
  },
  ops: {
    list: () => ipcRenderer.invoke("ops.list")
  },
  assets: {
    aspectRatio: (assetPath) => ipcRenderer.invoke("assets.aspectRatio", assetPath),
    thumbnail: (assetPath, longEdge) => ipcRenderer.invoke("assets.thumbnail", assetPath, longEdge)
  },
  preview: {
    render: (taskId, options) => ipcRenderer.invoke("preview.render", taskId, options),
    originalThumbnail: (originalId) => ipcRenderer.invoke("preview.originalThumbnail", originalId)
  },
  vision: {
    runForTask: (taskId, options) => ipcRenderer.invoke("vision.runForTask", taskId, options)
  },
  rename: {
    preview: (templateId, taskIds) => ipcRenderer.invoke("rename.preview", templateId, taskIds),
    run: (templateId, taskIds) => ipcRenderer.invoke("rename.run", templateId, taskIds)
  },
  luts: {
    list: () => ipcRenderer.invoke("luts.list"),
    import: (filePaths) => ipcRenderer.invoke("luts.import", filePaths),
    delete: (filePath) => ipcRenderer.invoke("luts.delete", filePath),
    restoreBuiltIns: () => ipcRenderer.invoke("luts.restoreBuiltIns"),
    preview: (taskId, options, strength, previewLongEdge) => ipcRenderer.invoke("luts.preview", taskId, options, strength, previewLongEdge)
  },
  stamps: {
    list: () => ipcRenderer.invoke("stamps.list"),
    import: (filePaths) => ipcRenderer.invoke("stamps.import", filePaths),
    delete: (filePath) => ipcRenderer.invoke("stamps.delete", filePath),
    restoreBuiltIns: () => ipcRenderer.invoke("stamps.restoreBuiltIns")
  },
  queues: {
    snapshot: () => ipcRenderer.invoke("queues.snapshot")
  },
  lifecycle: {
    approveClose: (allow) => ipcRenderer.invoke("lifecycle.approveClose", allow),
    onCloseRequest: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, request: Parameters<typeof callback>[0]) => callback(request);
      ipcRenderer.on("lifecycle.close-requested", listener);
      return () => ipcRenderer.off("lifecycle.close-requested", listener);
    }
  },
  events: {
    onProjectSnapshot: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof callback>[0]) => callback(snapshot);
      ipcRenderer.on("project.snapshot", listener);
      return () => ipcRenderer.off("project.snapshot", listener);
    },
    onQueueSnapshot: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof callback>[0]) => callback(snapshot);
      ipcRenderer.on("queue.snapshot", listener);
      return () => ipcRenderer.off("queue.snapshot", listener);
    }
  }
};

contextBridge.exposeInMainWorld("api", api);
