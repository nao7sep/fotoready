import { contextBridge, ipcRenderer } from "electron";
import type { FotoReadyApi } from "@shared/types/ipc";

const api: FotoReadyApi = {
  system: {
    getInfo: () => ipcRenderer.invoke("system.getInfo")
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get"),
    setGeminiApiKey: (apiKey) => ipcRenderer.invoke("settings.setGeminiApiKey", apiKey)
  },
  project: {
    current: () => ipcRenderer.invoke("project.current"),
    newProject: (name?: string) => ipcRenderer.invoke("project.new", name),
    openFromDialog: () => ipcRenderer.invoke("project.openFromDialog"),
    saveAsFromDialog: () => ipcRenderer.invoke("project.saveAsFromDialog"),
    addOriginalsFromDialog: () => ipcRenderer.invoke("project.addOriginalsFromDialog"),
    selectOriginal: (originalId) => ipcRenderer.invoke("project.selectOriginal", originalId)
  },
  task: {
    select: (taskId) => ipcRenderer.invoke("task.select", taskId),
    fork: (taskId) => ipcRenderer.invoke("task.fork", taskId),
    save: (taskId) => ipcRenderer.invoke("task.save", taskId),
    saveAll: () => ipcRenderer.invoke("task.saveAll"),
    addOp: (taskId, opType) => ipcRenderer.invoke("task.addOp", taskId, opType),
    removeOp: (taskId, opIndex) => ipcRenderer.invoke("task.removeOp", taskId, opIndex),
    setOpEnabled: (taskId, opIndex, enabled) => ipcRenderer.invoke("task.setOpEnabled", taskId, opIndex, enabled),
    updateOpParam: (taskId, opIndex, key, value) => ipcRenderer.invoke("task.updateOpParam", taskId, opIndex, key, value),
    setAnalyzeContent: (taskId, analyzeContent) => ipcRenderer.invoke("task.setAnalyzeContent", taskId, analyzeContent),
    setCustomSlug: (taskId, customSlug) => ipcRenderer.invoke("task.setCustomSlug", taskId, customSlug),
    updateOutput: (taskId, key, value) => ipcRenderer.invoke("task.updateOutput", taskId, key, value)
  },
  ops: {
    list: () => ipcRenderer.invoke("ops.list")
  },
  preview: {
    render: (taskId) => ipcRenderer.invoke("preview.render", taskId)
  },
  vision: {
    runForTask: (taskId) => ipcRenderer.invoke("vision.runForTask", taskId)
  },
  rename: {
    preview: (templateId) => ipcRenderer.invoke("rename.preview", templateId),
    run: (templateId) => ipcRenderer.invoke("rename.run", templateId)
  },
  queues: {
    snapshot: () => ipcRenderer.invoke("queues.snapshot")
  }
};

contextBridge.exposeInMainWorld("api", api);
