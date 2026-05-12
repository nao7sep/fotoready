import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");
const codeExtensions = new Set([".ts", ".tsx"]);
const ignoredAssetExtensions = new Set([".css", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp", ".avif", ".ico", ".icns", ".cube"]);

const aliasRoots = {
  "@shared/": "shared",
  "@core/": "core",
  "@runtime/": "runtime",
  "@adapters/": "adapters",
  "@main/": "main",
  "@renderer/": "renderer"
};

const allowedImports = {
  shared: new Set(["shared"]),
  core: new Set(["shared", "core"]),
  runtime: new Set(["shared", "core", "runtime"]),
  adapters: new Set(["shared", "core", "runtime", "adapters"]),
  main: new Set(["shared", "core", "runtime", "adapters", "main"]),
  preload: new Set(["shared", "preload"]),
  renderer: new Set(["shared", "renderer"])
};

const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

const files = await collectFiles(srcRoot);
const errors = [];

for (const filePath of files) {
  const sourceRing = ringForFile(filePath);
  if (!sourceRing) continue;
  const source = await fs.readFile(filePath, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (!specifier || shouldIgnoreSpecifier(specifier)) continue;

    const resolved = resolveRepoImport(filePath, specifier);
    if (!resolved) continue;

    const targetRing = ringForFile(resolved);
    if (!targetRing) continue;
    if (!allowedImports[sourceRing]?.has(targetRing)) {
      errors.push(`${relativeFromRepo(filePath)} -> ${specifier} (${relativeFromRepo(resolved)}) violates ${sourceRing} import boundaries.`);
    }
  }
}

if (errors.length > 0) {
  console.error("Import boundary violations found:\n");
  for (const error of errors.sort()) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Import boundaries OK (${files.length} files checked).`);

async function collectFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }
    if (codeExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function ringForFile(filePath) {
  const relativePath = path.relative(srcRoot, filePath);
  const [ring] = relativePath.split(path.sep);
  return allowedImports[ring] ? ring : null;
}

function shouldIgnoreSpecifier(specifier) {
  if (!specifier.startsWith(".") && !specifier.startsWith("@")) {
    return true;
  }
  return ignoredAssetExtensions.has(path.extname(specifier));
}

function resolveRepoImport(fromFile, specifier) {
  if (specifier.startsWith(".")) {
    return resolveWithCandidates(path.resolve(path.dirname(fromFile), specifier));
  }

  for (const [prefix, ring] of Object.entries(aliasRoots)) {
    if (specifier.startsWith(prefix)) {
      const remainder = specifier.slice(prefix.length);
      return resolveWithCandidates(path.join(srcRoot, ring, remainder));
    }
  }

  return null;
}

function resolveWithCandidates(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx")
  ];

  for (const candidate of candidates) {
    const extension = path.extname(candidate);
    if (ignoredAssetExtensions.has(extension)) {
      return null;
    }
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function relativeFromRepo(filePath) {
  return path.relative(repoRoot, filePath);
}
