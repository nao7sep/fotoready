import type { GlobalSettings } from "./settings";

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

export type FotoReadyApi = {
  system: {
    getInfo(): Promise<SystemInfo>;
  };
  settings: {
    get(): Promise<GlobalSettings>;
  };
  queues: {
    snapshot(): Promise<QueueSnapshot>;
  };
};
