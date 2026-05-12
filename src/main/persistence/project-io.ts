import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_EXTENSION, PROJECT_VERSION } from "@shared/constants";
import type { Project } from "@shared/types/project";
import type { ProjectSettings } from "@shared/types/settings";
import { getOpDefinition } from "@core/ops/catalog";
import { validateProjectData } from "@shared/validation/project";

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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Project file is invalid JSON: ${(error as Error).message}`);
  }

  const project = validateProjectData(parsed, getOpDefinition);

  return {
    path: projectPath,
    project
  };
}

export async function saveProject(projectPath: string, project: Project): Promise<void> {
  if (!projectPath.endsWith(PROJECT_EXTENSION)) {
    throw new Error(`Project path must end with ${PROJECT_EXTENSION}`);
  }

  const validated = validateProjectData(project, getOpDefinition);
  await fs.mkdir(path.dirname(projectPath), { recursive: true });
  await fs.writeFile(projectPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}
