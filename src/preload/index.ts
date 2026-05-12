import { contextBridge, ipcRenderer } from "electron";
import type { FotoReadyApi } from "@shared/types/ipc";

const api: FotoReadyApi = {
  system: {
    getInfo: () => ipcRenderer.invoke("system.getInfo"),
    pickFile: (options) => ipcRenderer.invoke("system.pickFile", options),
    revealInFolder: (filePath) => ipcRenderer.invoke("system.revealInFolder", filePath)
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get"),
    update: (patch) => ipcRenderer.invoke("settings.update", patch),
    setGeminiApiKey: (apiKey) => ipcRenderer.invoke("settings.setGeminiApiKey", apiKey)
  },
  project: {
    current: () => ipcRenderer.invoke("project.current"),
    newProject: (name?: string) => ipcRenderer.invoke("project.new", name),
    openFromDialog: () => ipcRenderer.invoke("project.openFromDialog"),
    saveAsFromDialog: () => ipcRenderer.invoke("project.saveAsFromDialog"),
    setOutputDirFromDialog: () => ipcRenderer.invoke("project.setOutputDirFromDialog"),
    addOriginalsFromDialog: () => ipcRenderer.invoke("project.addOriginalsFromDialog"),
    selectOriginal: (originalId) => ipcRenderer.invoke("project.selectOriginal", originalId)
  },
  task: {
    select: (taskId) => ipcRenderer.invoke("task.select", taskId),
    fork: (taskId) => ipcRenderer.invoke("task.fork", taskId),
    delete: (taskId) => ipcRenderer.invoke("task.delete", taskId),
    dismissError: (taskId) => ipcRenderer.invoke("task.dismissError", taskId),
    retry: (taskId) => ipcRenderer.invoke("task.retry", taskId),
    save: (taskId) => ipcRenderer.invoke("task.save", taskId),
    saveAll: () => ipcRenderer.invoke("task.saveAll"),
    addOp: (taskId, opType) => ipcRenderer.invoke("task.addOp", taskId, opType),
    removeOp: (taskId, opIndex) => ipcRenderer.invoke("task.removeOp", taskId, opIndex),
    setOpEnabled: (taskId, opIndex, enabled) => ipcRenderer.invoke("task.setOpEnabled", taskId, opIndex, enabled),
    updateOpParam: (taskId, opIndex, key, value) => ipcRenderer.invoke("task.updateOpParam", taskId, opIndex, key, value),
    undo: (taskId) => ipcRenderer.invoke("task.undo", taskId),
    setAnalyzeContent: (taskId, analyzeContent) => ipcRenderer.invoke("task.setAnalyzeContent", taskId, analyzeContent),
    setCustomSlug: (taskId, customSlug) => ipcRenderer.invoke("task.setCustomSlug", taskId, customSlug),
    updateOutput: (taskId, key, value) => ipcRenderer.invoke("task.updateOutput", taskId, key, value)
  },
  ops: {
    list: () => ipcRenderer.invoke("ops.list")
  },
  preview: {
    render: (taskId) => ipcRenderer.invoke("preview.render", taskId),
    originalThumbnail: (originalId) => ipcRenderer.invoke("preview.originalThumbnail", originalId)
  },
  vision: {
    runForTask: (taskId) => ipcRenderer.invoke("vision.runForTask", taskId)
  },
  rename: {
    preview: (templateId, taskIds) => ipcRenderer.invoke("rename.preview", templateId, taskIds),
    run: (templateId, taskIds) => ipcRenderer.invoke("rename.run", templateId, taskIds)
  },
  caches: {
    sizes: () => ipcRenderer.invoke("caches.sizes"),
    clear: () => ipcRenderer.invoke("caches.clear")
  },
  queues: {
    snapshot: () => ipcRenderer.invoke("queues.snapshot")
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
