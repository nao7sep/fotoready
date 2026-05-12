import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_EXTENSION, PROJECT_VERSION } from "@shared/constants";
import type { Project } from "@shared/types/project";
import type { ProjectSettings } from "@shared/types/settings";

export type LoadedProject = {
  path: string | null;
  project: Project;
};

export function createEmptyProject(name = "Untitled Project", outputDir = "./out", settings: ProjectSettings = {}): Project {
  return {
    version: PROJECT_VERSION,
    name,
    outputDir,
    settings,
    originals: [],
    tasks: []
  };
}

export async function loadProject(projectPath: string): Promise<LoadedProject> {
  const raw = await fs.readFile(projectPath, "utf8");
  const parsed = JSON.parse(raw) as Project;

  if (parsed.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${String(parsed.version)}`);
  }

  return {
    path: projectPath,
    project: parsed
  };
}

export async function saveProject(projectPath: string, project: Project): Promise<void> {
  if (!projectPath.endsWith(PROJECT_EXTENSION)) {
    throw new Error(`Project path must end with ${PROJECT_EXTENSION}`);
  }

  await fs.mkdir(path.dirname(projectPath), { recursive: true });
  await fs.writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
}
