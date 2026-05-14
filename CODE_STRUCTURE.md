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
  preload/      Context bridge exposing the typed api to the renderer
  renderer/     React + Konva UI; per-op cards/overlays live under renderer/ops/
  runtime/      Pure image-pipeline code (used by main and worker)
  core/ops/     Op modules — one file per op, apply + validate + meta
  adapters/     Outbound integrations (Sharp/libvips wrappers, exiftool, Gemini, .cube LUT loader, secure store)
  shared/       Types, validation, constants, defaults — imported by both main and renderer
build/          App icons, electron-builder assets
scripts/        Maintenance scripts (icon generation, import-boundary lint)
```

Path aliases (defined in `electron.vite.config.ts` and `tsconfig.json`):

| Alias | Resolves to |
| --- | --- |
| `@shared` | `src/shared` |
| `@core` | `src/core` |
| `@runtime` | `src/runtime` |
| `@adapters` | `src/adapters` |
| `@main` | `src/main` |
| `@renderer` | `src/renderer` |

Renderer can only import `@shared` and `@renderer` — never `@main`, `@runtime`, `@adapters`, or `@core`. The boundary is checked by `scripts/check-import-boundaries.mjs`. Keep it that way.

## Process model

- **Main process** (`src/main/index.ts` → `bootstrap.ts`) owns: user-data paths, settings file, all queues, the Sharp worker pool, the `ProjectSession`, all `ipcMain.handle` routes.
- **Preload** (`src/preload/index.ts`) builds a typed `FotoReadyApi` object and exposes it as `window.api`. If you add an IPC handler in `router.ts`, you also add it here.
- **Renderer** (`src/renderer/app.tsx`) is a single React tree. It calls `window.api.*`, never `ipcRenderer` directly. It listens for `project.snapshot` and `queue.snapshot` events to refresh state.
- **Worker** (`src/main/workers/pipeline-worker.ts`) runs inside Piscina worker threads. The pool is created once at bootstrap; it is required (not optional).

## Data model (`@shared/types`)

- `Project` — `{ outputDir, originals[], tasks[] }`. `outputDir: string | null` (null means "save next to source").
- `Original` — content-addressable record of an imported source file: `id`, `sourcePath`, `sourceHash`, dimensions, format.
- `Task` — `{ id, originalId, analyzeContent, customSlug, pipeline, status, output, error, everEdited, createdAt, updatedAt }`. `everEdited` is flipped to `true` on the first mutation; it's what `selectOriginal` checks to decide whether to reuse the active task slot or spawn a new one.
- `TaskStatus` — `pending → queued → processing → done` / `error`.
  - `pending`: editable. Ops, output settings, custom slug can all be changed.
  - `queued`: locked. Sitting in the processing queue.
  - `processing`: actively running in the worker.
  - `done`: file written. `task.output.stagedPath` points to it.
  - `error`: failed. `task.error` describes the stage and message; user can retry.
- `Pipeline` — `{ ops, output }`. `ops` is the ordered list of `OpInstance { type, params, enabled }`. `output` is the encoding settings; nothing else lives on Pipeline.
- `OpDefinition` (renderer-safe) — `{ type, label, category, defaultParams, previewBehavior }`. `previewBehavior` is `"show-input"` for ops that paint canvas overlays (crop, redact-*, watermark-*, white-balance) and `"show-output"` for everything else.

## IPC contract

The full surface is in `src/shared/types/ipc.ts` (`FotoReadyApi`). Every channel must have:

1. An `ipcMain.handle("namespace.action", ...)` in `src/main/ipc/router.ts`.
2. A method on `FotoReadyApi` in `src/shared/types/ipc.ts`.
3. A wrapper in `src/preload/index.ts` that just forwards arguments.

If any of those three are missing, the call will fail silently at runtime in the renderer. There is no auto-generation.

Channel namespaces: `system.*`, `settings.*`, `project.*`, `task.*`, `preview.*`, `vision.*`, `rename.*`, `ops.list`, `luts.list`, `queues.snapshot`.

**Events** (main → renderer, sent via `webContents.send`):
- `project.snapshot` — fires after any mutation. Carries the full `ProjectSnapshot`.
- `queue.snapshot` — fires when queue counts change.

## ProjectSession (`src/main/project/session.ts`)

The single source of truth on the main side. It holds the in-memory `Project` plus the `activeTaskId`. It mediates between IPC handlers and the queues. All mutations go through it.

- The `ProcessingQueue`, `QualityQueue`, `VisionQueue`, and `PipelineWorkerPool` are constructor-required (never null).
- `addOriginals` / `selectOriginal` / `removeOriginal` — manage the originals list.
- `addOp` / `updateOpParam` / `setOpEnabled` / `removeOp` — pipeline editing. All require `status === "pending"` (enforced by `editableTask`). They call into the OpModule registry to validate.
- `enqueueSave(taskId)` — flips status to `queued` and calls `processingQueue.enqueueTask` without awaiting.
- `runVision` — explicit Gemini call (never run as a side effect of save).

## Processing queue (`src/main/queues/processing-queue.ts`)

- Backed by `p-queue`, concurrency = `settings.workerPoolSize`.
- Cancel works by marking the id; when the queue worker dequeues it, it bails before calling `processTask`. Cancel cannot stop a task that is already running in the worker.
- JPEG quality detection (used by `match-source-quality` and `match-source-size`) runs inline in `processing.ts` at save time. There is no persistent quality cache.

## Image pipeline (`src/runtime/pipeline-runner.ts`)

Single entry point: `runPipeline(pipeline, ctx)`. Two output modes:

- `ctx.outputPath` set → encode and write the final file. Returns `{ kind: "file", ... }`.
- `ctx.outputPath` unset, `ctx.previewLongEdge` set → resize *first* to `previewLongEdge` (long-edge fit), then run ops on the small image, then return raw RGBA. Returns `{ kind: "buffer", ... }`.

The runner is a simple loop over `pipeline.ops`. For each enabled op it calls `module.apply(work, op.params, ctx)` from the registry; if the op is `metadataOnly` it is skipped (consumed later in the metadata stage). After ops that change dimensions (`crop`, `resize`, `rotate`) the runner materializes the sharp instance so subsequent ops see accurate width/height.

Save path (`src/main/queues/processing.ts`):

- `stagedOutputPath(project, task, sourcePath)` composes `{outputDir}/{originalName}-{nanoid8}.{ext}`.
- `resolveOutputDir(outputDir, sourcePath)`:
  - null / empty / whitespace → **`path.dirname(sourcePath)`** (save next to the original).
  - absolute → use as-is.
  - relative → resolved against `process.cwd()`.

After rendering, `metadataPolicy` walks the pipeline and lets each metadata-only op contribute to the `MetadataDecision` (keep + inject). `strip-metadata` sets `keep`; `inject-metadata` merges `inject`. No more `switch(op.type)` — each op declares `contributeMetadata` on its module.

## Ops — the plug-and-play unit (`src/core/ops/`)

The single most important architectural choice. **Every op is one file per side**:

- **`src/core/ops/<type>.ts`** — main side. Exports an `OpModule<P>` and calls `registerOp(...)`. Contains:
  - `type`, `label`, `category`, `defaultParams`, `previewBehavior`
  - `validate(params)` — runtime params validator
  - `apply(image, params, ctx)` — pure sharp transformation (omitted for `metadataOnly` ops)
  - `contributeMetadata?(params, decision)` — for `strip-metadata` and `inject-metadata`
- **`src/renderer/ops/<type>.tsx`** — renderer side. Exports an `OpRenderer<P>`. Contains:
  - `Card` — the React component shown inside the op card
  - `Overlay?` — optional Konva overlay drawn over the canvas
  - `onImageClick?` + `consumesImageClick?` — for ops like `white-balance` that sample by clicking the preview

The two sides are bridged only by the op-type string. Cards never import other cards. Overlays never import other overlays. The pipeline runner doesn't know which ops exist; it just calls `getOpModule(op.type)?.apply`. Same for the editor canvas: it iterates the pipeline and renders whatever Overlay each op exposes.

### Registries

- `src/core/ops/registry.ts` — main-side registry. `getOpModule(type)`, `listOpDefinitions()`, `requireOpModule(type)`.
- `src/core/ops/catalog.ts` — imports each `<type>.ts` once (the import side-effect calls `registerOp`).
- `src/renderer/ops/index.ts` — renderer-side registry. `getOpRenderer(type)`.

### Adding a new op

1. Add `src/core/ops/<name>.ts` exporting an `OpModule` and calling `registerOp`.
2. Add `"./<name>"` to `src/core/ops/catalog.ts`.
3. Add `src/renderer/ops/<name>.tsx` exporting an `OpRenderer`.
4. Add it to `allRenderers` in `src/renderer/ops/index.ts`.
5. If the op needs a new IPC channel, see "A new IPC channel" below.

That's it — no switches to update, no per-op branches in pipeline-runner, ops-panel, or editor-canvas.

### Shared overlay helpers

- `src/renderer/ops/_overlay-primitives.tsx` — `OverlayRect`, `CropDarkenMask`, `clampFractionRect`, `imageBoundsFromSize`, `anchorCanvasPos`, etc. Anything used by more than one overlay lives here.
- `src/renderer/ops/_redact-overlay.tsx` — the draggable-first-rect-plus-static-rest pattern shared by the three redact ops.
- `src/renderer/ops/_anchor-picker.tsx` — the 3×3 anchor grid used by both watermark ops.
- `src/renderer/components/canvas/interactive-overlays.tsx` — the `InteractiveOverlayRect` (Konva Rect + Transformer) used by crop and redact overlays.

### Execution-order hint

`reorderHintFor(op)` returns `"after-resize"` for `unsharp-mask` with `outputSharpen: true`. The runner moves any such op to immediately after the first enabled resize op. Today this is the only execution-order coupling between ops. If you find yourself adding more, push back — the user can usually just place the op where they want it.

## Renderer layout

The shell (`src/renderer/app.tsx`) is one big `<App>` component. It uses local React state, no Redux/Zustand — the source of truth is the `ProjectSnapshot` pushed from main.

DOM skeleton:

```
.app-shell                   (grid: top-bar / workspace / status-bar; height = 100vh)
  .top-bar                   Output-dir button, histogram toggle, settings, menu
  .workspace                 4-pane grid
    OriginalsPanel
    .workspace-splitter
    TasksPanel
    .workspace-splitter
    .editor-panel
      .preview-toolbar       image details + Save/Cancel/Fork/Retry/Delete actions
      .canvas-frame          EditorCanvas (Konva), plus HistogramOverlay if toggled on
      .error-strip           shown when active task is errored
    .workspace-splitter
    OpsPanel                 op cards (rendered via op renderers) + add-op buttons + output controls
  .status-bar                queue counters, errors button, version
```

Key rules:

- The shell is locked to `height: 100vh; overflow: hidden`. Each scrolling region (originals list, tasks list, ops panel) handles its own overflow. The body never scrolls.
- Panels use `flex-direction: column` with the list at `flex: 1 1 0` so footers stay fixed.
- The preview area must never be truncated. Don't add fixed-height sections inside `.editor-panel` that could push the canvas-frame out.
- Crop / rotate / resize are selected and configured in the ops panel. The preview hosts direct-manipulation overlays such as the draggable crop box and rotate framing guides.
- All colors come from CSS custom properties defined on `:root`. The app is light-only by design; the theme picker has been removed.

### Preview pipeline at a glance

1. User edits a task → renderer effect re-runs → `api.preview.render(taskId, options?)`.
2. Main: `ProjectSession.renderPreview` → `renderTaskPreview` (`src/main/preview/preview-service.ts`).
3. Worker pool: `renderBuffer({ previewLongEdge })` → `pipeline-worker.ts` → `runPipeline(pipeline, { previewLongEdge })`.
4. `runPipeline` decodes, resizes long-edge to `previewLongEdge`, applies ops via the registry, returns raw RGBA.
5. `preview-service` wraps RGBA in a `sharp(raw, { raw: ... }).png()`, returns a base64 data URL.
6. Renderer's `EditorCanvas` loads the data URL into Konva and fits it to the canvas frame.

### Per-card chain preview

When an op card is selected (`selectedOpIndex = N`), the preview reflects the image *after* applying ops 0…N. The behavior is driven by each op's `previewBehavior`:

- `"show-input"` (crop, redact-*, watermark-*, white-balance): `truncateOpsAt = selectedOpIndex` (preview shows the image *before* the selected op).
- `"show-output"` (rotate, resize, tone, effects …): `truncateOpsAt = selectedOpIndex + 1` (slider edits appear live).

The renderer reads `previewBehavior` from the IPC op catalog. No hard-coded list in app.tsx.

### Canvas overlays

`EditorCanvas` iterates `task.pipeline.ops` and, for each enabled op, asks `getOpRenderer(op.type)` for an `Overlay` and renders it. Each overlay receives:

- `params`, `opIndex`, `selected` (true if it's the active card)
- `ctx`: `{ imageSize, longEdge, imageBounds, placement, stageSize, originalAspectRatio }`
- `onParamsChange(patch)` — commit a partial param update

Overlays own their own drag/draft state internally. The canvas does no per-op switching.

For stage-level clicks (today only `white-balance`), the canvas asks the currently-selected op's renderer for `onImageClick` and forwards the local image coordinates.

## Settings

- Lives at `~/.fotoready/settings.json`. Loaded on bootstrap, normalized through `normalizeGlobalSettings` (`src/shared/validation/settings.ts`), and written via `saveSettings` after every `settings.update`.
- Add new fields in: `src/shared/types/settings.ts` (type), `src/shared/defaults.ts` (default), `src/shared/validation/settings.ts` (validator). All three are required.
- User-facing toggle UI lives in `src/renderer/components/modals/settings-modal.tsx`.
- `visionProjectContext` (replaces the old project-level field) is a global setting; the vision queue reads it and forwards to Gemini.

## What was removed and won't come back without a redesign

- **Project file format.** `loadProject` / `saveProject` are gone. `createEmptyProject(outputDir)` lives in `src/shared/defaults.ts`.
- **`Project.version`, `Project.name`, `Project.settings`.** All vestigial; deleted.
- **`Task.outputFormatOverride`, `outputQualityOverride`, `metadataStripOverride`.** Redundant aliases for the values already on `task.pipeline.output` and the `strip-metadata` op. Deleted.
- **`Pipeline.appliedColorNormalization` / `sourceSnapshot` / `toolVersions` / `specVersion`.** Constructed but never read. Deleted.
- **`OpDefinition.schema` / `paramScaling` / `visible`.** Pure documentation, no readers. Deleted.
- **Recent projects list / Open / Save as buttons.** All references to `projectPath`, `lastProjectPath`, `recentProjectPaths` have been deleted.
- **`source-resolver.ts`** (rehoming source files by hash). Originals now must stay where the user added them from. If a source file is moved during the session, processing of that task will fail with a `processing` error.
- **Queue pause / resume.** Replaced by per-task cancel and "Cancel all".
- **`runTaskInline` / `queueSnapshotFromProject` fallback.** The processing queue and worker pool are now required.
- **Dark theme, language picker, camera-timezone, max-concurrent, sidecar-location, strip-gps/thumbnail flags, cache-results.** Vestigial settings with no readers. Deleted.
- **`Pipeline.output.iccOutput` / `settings.outputIccBehavior`.** Validated and persisted but encode.ts never read them. Deleted.
- **`vision-prepare` worker kind, `metadataInjection` worker field.** Declared on `WorkerJob`/`WorkerResult` but never invoked — vision has its own prep path in vision.ts.
- **`DecodeFacts` / `ExifSubset` / `inferColorSpaceTag`.** Computed by `decodeImage` but no consumer after the Pipeline-metadata cleanup. `decodeImage` now returns just `{ image }`.
- **Cache infrastructure** (`~/.fotoready/cache/`, `QualityQueue`, vision cache, `caches.*` IPC, the cache settings tab). Detection runs inline at save time; vision calls always hit the API. Re-add only if a real perf bottleneck shows up.
- **Test infrastructure** (`vitest`, `vitest.config.ts`, `npm test`). Early-stage product; the spec drifts faster than tests would survive.
- **Vision auto-trigger on save.** `runVision` is now strictly opt-in.

If a future task wants any of these back, treat it as a fresh design — don't try to revive the deleted code from git.

## Adding things — quick recipes

**A new op type.** See "Adding a new op" above. Two files, two registry entries; no switch edits anywhere.

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

## Build / dev

- `npm run dev` — electron-vite hot reload for both main and renderer.
- `npm run build` — `tsc --noEmit` + production bundle. Run before committing structural changes.
- `npm run check:imports` — boundary lint.
- `npm run package` — electron-builder to `release/`. Mac code-signing is intentionally off.

There is no automated test suite yet (the previous one was deleted alongside the cache layer because the spec moves faster than the tests would survive). Reintroduce per-op tests once an op's behavior stops changing.

## Data locations on disk

| What | Where |
| --- | --- |
| Settings | `~/.fotoready/settings.json` |
| Logs | `~/.fotoready/logs/` |
| Encrypted Gemini key | `~/.fotoready/api-keys.enc` |
| User LUTs | `~/.fotoready/luts/` |
| Saved images | `project.outputDir` (null → next to source; non-empty → that path) |

## When the next AI picks this up

Read this doc first. If something here disagrees with the code, the code is right — fix the doc as part of your change. If you remove a section, leave a line saying *why* so the next reader doesn't try to restore it. If you add a new top-level concept, give it a section here.

**The single biggest invariant**: ops are independent and composable. Any op may follow any other op any number of times. Cards must not know about each other; overlays must not know about each other. If you find yourself reaching for a cross-op coupling, push back and prefer a per-op `executionStage` / `reorderHint` hook instead.
