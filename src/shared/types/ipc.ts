import type { GlobalSettings } from "./settings";
import type { Project } from "./project";

export type QueueSnapshot = {
  done: number;
  total: number;
  processing: number;
  errors: number;
};

export type SystemInfo = {
  appName: "FotoReady";
  version: string;
  dataDir: string;
};

export type ProjectSnapshot = {
  projectPath: string | null;
  project: Project;
  activeTaskId: string | null;
};

export type FotoReadyApi = {
  system: {
    getInfo(): Promise<SystemInfo>;
  };
  settings: {
    get(): Promise<GlobalSettings>;
  };
  project: {
    current(): Promise<ProjectSnapshot>;
    newProject(name?: string): Promise<ProjectSnapshot>;
    addOriginalsFromDialog(): Promise<ProjectSnapshot>;
    selectOriginal(originalId: string): Promise<ProjectSnapshot>;
  };
  task: {
    select(taskId: string): Promise<ProjectSnapshot>;
    fork(taskId: string): Promise<ProjectSnapshot>;
    save(taskId: string): Promise<ProjectSnapshot>;
    saveAll(): Promise<ProjectSnapshot>;
  };
  queues: {
    snapshot(): Promise<QueueSnapshot>;
  };
};
