import path from "node:path";
import type { AppPaths } from "./paths";
import type { GlobalSettings } from "@shared/types/settings";
import type { UiState } from "@shared/types/state";
import { restoreBuiltInLuts } from "./lut-catalog";
import { restoreBuiltInStamps } from "./stamp-catalog";

export async function seedBuiltInAssets(paths: AppPaths, settings: GlobalSettings, uiState: UiState): Promise<UiState> {
  const homeDir = pathsHomeDir(paths);
  let next = uiState;

  if (!next.builtInAssetsSeeded.luts) {
    await restoreBuiltInLuts(settings.lutFolder, homeDir, paths.bundledLutsDir);
    next = {
      ...next,
      builtInAssetsSeeded: { ...next.builtInAssetsSeeded, luts: true }
    };
  }

  if (!next.builtInAssetsSeeded.stamps) {
    await restoreBuiltInStamps(settings.stampFolder, homeDir, paths.bundledStampsDir);
    next = {
      ...next,
      builtInAssetsSeeded: { ...next.builtInAssetsSeeded, stamps: true }
    };
  }

  return next;
}

function pathsHomeDir(paths: AppPaths): string {
  return path.dirname(paths.dataDir);
}
