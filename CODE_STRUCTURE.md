# FotoReady Code Structure

This document is the authoritative living map of the codebase. AI agents and humans should both update it whenever they change something that the next reader would otherwise need to discover by grepping.

## Updating this document

- **When to update**: any time you add or remove an IPC channel, change the task lifecycle, restructure the pipeline runner, change a settings field, move a top-level directory, or introduce a new architectural rule.
- **What not to write**: line numbers, exhaustive prop lists, anything that will drift in two weeks. Describe responsibilities and contracts, not implementations.
- **Tone**: short sentences. Code paths are the source of truth. This doc just tells you *where to look*.
- **Diff discipline**: when you make non-trivial edits, also update the relevant section here in the same change.

## Product model (in one paragraph)

FotoReady is a session-only desktop image editor. The app holds an in-memory `Project` for the lifetime of the window — there is **no project file format**, no "Open / Save as", no recent-projects list. The user adds **originals** (image files on disk), each original spawns a **task** with an editable **pipeline** of ops. Editing a task only changes its pipeline; the original is never modified. Pressing **Save** locks the task and enqueues it for processing; the queue writes a new file using the slug pattern `{originalName}-{nanoid8}.{ext}`. Quitting or crashing loses the session.

## Top-level layout

```
src/
  main/         Node-side Electron main process
  preload/      Context bridge that exposes the typed api to the renderer
  renderer/     React + Konva UI
  runtime/      Pure image-pipeline code (used by main and worker)
  core/         Pure domain logic (op definitions, slug/naming rules)
  adapters/     Outbound integrations (Sharp/libvips wrappers, exiftool, Gemini, .cube LUT loader, secure store)
  shared/       Types, validation, constants, defaults — imported by both main and renderer
build/          App icons, electron-builder assets
scripts/        Maintenance scripts (icon generation, import-boundary lint)
```

Path aliases are defined in `electron.vite.config.ts` and `tsconfig.json`. Use them in new code:

| Alias | Resolves to |
| --- | --- |
| `@shared` | `src/shared` |
| `@core` | `src/core` |
| `@runtime` | `src/runtime` |
| `@adapters` | `src/adapters` |
| `@main` | `src/main` |
| `@renderer` | `src/renderer` |

Renderer can only import `@shared` and `@renderer` — never `@main`, `@runtime`, `@adapters`, or `@core`. The boundary is enforced loosely by Vite config; the script `scripts/check-import-boundaries.mjs` audits it. Keep it that way.

## Process model

- **Main process** (`src/main/index.ts` → `bootstrap.ts`) owns: user-data paths, settings file, all queues, the Sharp worker pool, the `ProjectSession`, all `ipcMain.handle` routes.
- **Preload** (`src/preload/index.ts`) builds a typed `FotoReadyApi` object and exposes it as `window.api`. Every call is a thin `ipcRenderer.invoke(channel, ...args)`. If you add an IPC handler in `router.ts`, you also add it here.
- **Renderer** (`src/renderer/app.tsx`) is a single React tree. It calls `window.api.*`, never `ipcRenderer` directly. It listens for `project.snapshot` and `queue.snapshot` events to refresh state.
- **Worker** (`src/main/workers/pipeline-worker.ts`) runs inside Piscina worker threads. It receives `WorkerJob` objects and returns `WorkerResult`. The pool is created once at bootstrap.

## Data model (`@shared/types`)

- `Project` — `{ version, name, outputDir, settings, originals[], tasks[] }`. Lives only in `ProjectSession`'s memory. The `version`, `name`, and `settings` fields are vestigial from the removed project-file format; they exist because the rename service and validators still touch them, but they're not user-visible.
- `Original` — content-addressable record of an imported source file: `id`, `sourcePath`, `sourceHash`, dimensions, format.
- `Task` — `{ id, originalId, pipeline, status, output, error, ... }`. The unit of work.
- `TaskStatus` — **`pending → queued → processing → done` / `error`**.
  - `pending`: editable. Ops, output settings, custom slug can all be changed.
  - `queued`: locked. Sitting in the processing queue.
  - `processing`: actively running in the worker.
  - `done`: file written. `task.output.stagedPath` points to it.
  - `error`: failed. `task.error` describes the stage and message; user can retry.
- `Pipeline` — `{ specVersion, ops[], output, ... }`. `ops` is the ordered list of `OpInstance { type, params, enabled }`.

## IPC contract

The full surface is in `src/shared/types/ipc.ts` (`FotoReadyApi`). Every channel must have:

1. An `ipcMain.handle("namespace.action", ...)` in `src/main/ipc/router.ts`.
2. A method on `FotoReadyApi` in `src/shared/types/ipc.ts`.
3. A wrapper in `src/preload/index.ts` that just forwards arguments.

If any of those three are missing, the call will fail silently at runtime in the renderer. There is no auto-generation.

Channel namespaces in use:

| Namespace | What it does |
| --- | --- |
| `system.*` | App info, logging, file pickers, OS reveal-in-folder |
| `settings.*` | Read/write `~/.fotoready/settings.json`, Gemini key storage |
| `project.*` | Add/remove originals, select original, change output dir |
| `task.*` | Edit pipeline, save / cancel / fork / delete a task |
| `preview.*` | Render task preview, original thumbnail |
| `vision.*` | Run Gemini description for a task (opt-in) |
| `rename.*` | Preview / run rename templates over done tasks |
| `ops.list` | Get op catalog (for the ops panel) |
| `luts.list` | List available `.cube` LUTs |
| `caches.*` | Inspect / clear `~/.fotoready/cache/` |
| `queues.snapshot` | Current queue counters |

**Events** (main → renderer, sent via `webContents.send`):
- `project.snapshot` — fires after any mutation. Carries the full `ProjectSnapshot`.
- `queue.snapshot` — fires when queue counts change.

The renderer subscribes via `api.events.onProjectSnapshot` / `onQueueSnapshot`.

## ProjectSession (`src/main/project/session.ts`)

The single source of truth on the main side. It holds the in-memory `Project` plus the `activeTaskId`. It mediates between IPC handlers and the queues. All mutations go through it. Notable methods:

- `addOriginals` / `selectOriginal` / `removeOriginal` — manage the originals list. `selectOriginal` either reuses a never-touched task or spawns a new one.
- `addOp` / `updateOpParam` / `setOpEnabled` / `removeOp` — pipeline editing. All require `status === "pending"` (enforced by `editableTask`).
- `enqueueSave(taskId)` — flips status to `queued` and calls `processingQueue.enqueueTask` without awaiting. The queue worker handles `processing → done/error` and emits snapshots.
- `enqueueSaveAll` / `cancelTask` / `cancelAll` — bulk and cancel operations.
- `runVision` — explicit Gemini call (never run as a side effect of save).
- `previewRename` / `runRename` — template-driven file rename for `done` tasks.

`ProjectSession` does **not** touch the filesystem for project data. The only on-disk state owned by main is `~/.fotoready/settings.json`, the Gemini key store, caches, and logs. See `getAppPaths()` in `src/main/paths.ts`.

## Processing queue (`src/main/queues/processing-queue.ts`)

- Backed by `p-queue`, concurrency = `settings.workerPoolSize`.
- `enqueueTask(project, taskId)` is fire-and-forget. The Task is reserved synchronously by `ProjectSession` (status flipped to `queued` before the IPC handler returns).
- Tracks `#queuedTaskIds`, `#activeTaskIds`, `#cancelledTaskIds`. Cancel works by marking the id; when the queue worker dequeues it, it bails before calling `processTask`. Cancel cannot stop a task that is already running in the worker.
- Quality-of-source facts (JPEG quality estimate, etc.) are looked up via `QualityQueue` right before processing.

## Image pipeline (`src/runtime/pipeline-runner.ts`)

Single entry point: `runPipeline(pipeline, ctx)`. Two output modes:

- `ctx.outputPath` set → encode and write the final file. Returns `{ kind: "file", outputPath, outputHash, bytes, appliedPipeline }`.
- `ctx.outputPath` unset, `ctx.previewLongEdge` set → resize *first* to `previewLongEdge` (long-edge fit), then run ops on the small image, then return raw RGBA. Returns `{ kind: "buffer", bytes, width, height, appliedPipeline }`.

**Important invariants:**

- The preview path resizes *before* applying ops. This is what makes editing feel instant. All ops that use fractional coordinates (crop, redact, watermark) are scale-invariant, so the same params produce the same composition at any resolution.
- After the resize-first proxy, `runPipeline` re-creates a fresh `sharp` instance from raw RGBA so subsequent `sharp.metadata()` calls return the *current* dimensions, not the input file's.
- At the end of the buffer path, the result uses `toBuffer({ resolveWithObject: true })` to get the post-rotation/post-crop dimensions. Don't rely on `sharp.metadata()` to know the output size — it returns input metadata.

Save path (`src/main/queues/processing.ts`):

- `stagedOutputPath(project, task, sourcePath)` composes `{outputDir}/{originalName}-{nanoid8}.{ext}`.
- `resolveOutputDir(outputDir, sourcePath)`:
  - empty / whitespace → **`path.dirname(sourcePath)`** (save next to the original).
  - absolute → use as-is.
  - relative → resolved against `process.cwd()`.

## Ops (`src/core/ops`)

Op definitions live in `geometry.ts`, `tone.ts`, `effects.ts`, `redaction.ts`, `watermark.ts`, `metadata.ts`. Each calls `registerOp({ type, label, category, defaultParams, paramScaling, schema, visible })`. The catalog is read by `catalog.ts` and exposed to the renderer via `api.ops.list`.

The execution side lives in `src/runtime/pipeline-runner.ts` in the giant `applyOp` switch. **To add a new op you must edit both places**: register in `src/core/ops/`, handle the `case` in `applyOp`, and add validation in `src/shared/validation/ops.ts`. The renderer's per-op param UI in `src/renderer/components/panels/ops-panel.tsx` also needs a branch.

The primary geometry workflow now exercises **crop**, **rotate**, and **resize** directly in the renderer. Other registered ops should still be treated as less-proven until smoke-tested.

## Renderer layout

The shell (`src/renderer/app.tsx`) is one big `<App>` component. It uses local React state, no Redux/Zustand — the source of truth is the `ProjectSnapshot` pushed from main.

DOM skeleton:

```
.app-shell                   (grid: top-bar / workspace / status-bar; height = 100vh)
  .top-bar                   Output-dir button, histogram toggle, settings, menu
  .workspace                 4-pane grid
    OriginalsPanel           thumbnails list (scrolls) + fixed footer with "Drop or add"
    .workspace-splitter
    TasksPanel               tasks list (scrolls) + fixed footer with Save all / Cancel all / Rename
    .workspace-splitter
    .editor-panel
      .preview-toolbar       image details + Save/Cancel/Fork/Retry/Delete actions
      .canvas-frame          EditorCanvas (Konva), plus HistogramOverlay if toggled on
      .error-strip           shown when active task is errored
    .workspace-splitter
    OpsPanel                 op cards + add-op buttons + output controls (scrolls)
  .status-bar                queue counters, errors button, version
```

Key rules:

- The shell is locked to `height: 100vh; overflow: hidden`. Each scrolling region (originals list, tasks list, ops panel) handles its own overflow. The body never scrolls.
- Panels use `flex-direction: column` with the list at `flex: 1 1 0` so footers stay fixed.
- The preview area must never be truncated. Don't add fixed-height sections inside `.editor-panel` that could push the canvas-frame out.
- Crop / rotate / resize are selected and configured in the ops panel. The preview stays focused on direct-manipulation guides such as the draggable crop box and rotate framing guides.
- All colors come from CSS custom properties defined on `:root`. The app is light-only by design; the theme picker has been removed.

## Settings

- Lives at `~/.fotoready/settings.json`. Loaded on bootstrap, normalized through `normalizeGlobalSettings` (`src/shared/validation/settings.ts`), and written via `saveSettings` after every `settings.update`.
- Add new fields in: `src/shared/types/settings.ts` (type), `src/shared/defaults.ts` (default), `src/shared/validation/settings.ts` (validator). All three are required.
- User-facing toggle UI lives in `src/renderer/components/modals/settings-modal.tsx`.
- The renderer also calls `api.settings.update({ showHistogram: ... })` directly from the top-bar toggle — it's the same channel any settings edit goes through, just with one field at a time.

## Preview pipeline at a glance

1. User edits a task → `task.updatedAt` changes → renderer effect re-runs → `api.preview.render(taskId, options?)`.
2. Main: `ProjectSession.renderPreview` → `renderTaskPreview` (`src/main/preview/preview-service.ts`).
3. Worker pool: `renderBuffer({ previewLongEdge })` → `pipeline-worker.ts` → `runPipeline(pipeline, { previewLongEdge })`.
4. `runPipeline` decodes, resizes long-edge to `previewLongEdge`, applies ops, returns raw RGBA.
5. `preview-service` wraps RGBA in a `sharp(raw, { raw: ... }).png()`, returns a base64 data URL.
6. Renderer's `EditorCanvas` loads the data URL into Konva and fits it to the canvas frame (1:1 scale to fit-or-fill behavior; no zoom UI).

When the selected op is **crop**, the renderer asks main to render the preview **without that crop op applied**. The canvas then recenters and zooms the pre-crop image around the current crop rectangle so crop resizing stays stable instead of recursively previewing the already-cropped image.

Default `previewLongEdge` is 256 (set deliberately low so the resize path is visually obvious). Bump it once the team is happy.

## What was removed and won't come back without a redesign

- **Project file format.** `loadProject` / `saveProject` / `createEmptyProject(name, …)` are gone. `createEmptyProject(outputDir)` lives in `src/shared/defaults.ts`.
- **Recent projects list / Open / Save as buttons.** All references to `projectPath`, `lastProjectPath`, `recentProjectPaths` have been deleted.
- **`source-resolver.ts`** (rehoming source files by hash). Originals now must stay where the user added them from. If a source file is moved during the session, processing of that task will fail with a `processing` error.
- **Queue pause / resume.** Replaced by per-task cancel and "Cancel all".
- **Dark theme.** App is light-only.
- **Vision auto-trigger on save.** `runVision` is now strictly opt-in.

If a future task wants any of these back, treat it as a fresh design — don't try to revive the deleted code from git.

## Known structural quirks

- The `Project.version`, `Project.name`, and `Project.settings` fields are still set (to constants) so the rename service and op validators can keep their shapes. Consider folding `Project` into a slimmer "session" type the next time the rename service is touched.
- `Original.sourceHash` is computed but no longer used for path recovery. It's still useful as a deduplication key (we already prevent re-adding the same content).
- `processTask` accepts a `sourceFacts` param (JPEG quality estimate). The QualityQueue is fire-and-forget; if facts haven't arrived yet by save time, the JPEG strategy "match-source-quality" falls back to `settings.jpegQualityOnDetectionFailure`. That's intentional.
- `ProcessingQueue` reuses the in-memory `Project` reference. Don't replace the project object wholesale (e.g. with `structuredClone`) — mutate it in place, then emit a snapshot.

## Adding things — quick recipes

**A new op type.**
1. Create / edit a file in `src/core/ops/` and call `registerOp`.
2. Add a `case` in `applyOp` (`src/runtime/pipeline-runner.ts`).
3. Add validation for the params in `src/shared/validation/ops.ts`.
4. Add a UI branch in `OpParams` (`src/renderer/components/panels/ops-panel.tsx`).

**A new IPC channel.**
1. Add a method on `FotoReadyApi` in `src/shared/types/ipc.ts`.
2. Add a thin wrapper in `src/preload/index.ts`.
3. Add the handler in `src/main/ipc/router.ts`, routing to `projectSession.*` (preferred) or another main-side module.

**A new settings field.**
1. Type it in `src/shared/types/settings.ts`.
2. Default it in `src/shared/defaults.ts`.
3. Validate it in `src/shared/validation/settings.ts`.
4. Optionally surface it in `src/renderer/components/modals/settings-modal.tsx`.

**A new keyboard shortcut.**
1. Add the binding in the `onKeyDown` effect in `src/renderer/app.tsx`.
2. Add a row to the "Keyboard shortcuts" modal in the same file.

## Build / dev / test

- `npm run dev` — electron-vite hot reload for both main and renderer.
- `npm run build` — `tsc --noEmit` + production bundle. Run before committing structural changes.
- `npm test` — vitest. Four tiny test files today; add more when you touch validators or pure utilities.
- `npm run check:imports` — boundary lint.
- `npm run package` — electron-builder to `release/`. Mac code-signing is intentionally off.

## Data locations on disk

| What | Where |
| --- | --- |
| Settings | `~/.fotoready/settings.json` |
| Logs | `~/.fotoready/logs/` |
| Encrypted Gemini key | `~/.fotoready/api-keys.enc` |
| Source-facts cache | `~/.fotoready/cache/source-facts.json` |
| Vision cache | `~/.fotoready/cache/vision-facts.json` |
| User LUTs | `~/.fotoready/luts/` |
| Saved images | `project.outputDir` (empty → next to source; non-empty → that path) |

## When the next AI picks this up

Read this doc first. If something here disagrees with the code, the code is right — fix the doc as part of your change. If you remove a section, leave a line saying *why* so the next reader doesn't try to restore it. If you add a new top-level concept, give it a section here.
