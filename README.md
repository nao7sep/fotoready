# FotoReady

A cross-platform desktop photo editor for blogging and publication workflows. Stack non-destructive edits on each image, control exactly what metadata survives the re-encode, and batch-rename outputs with collision-safe templates.

FotoReady is built on Electron and runs on macOS, Windows, and Linux.

## Features

- **Stackable, non-destructive edits.** Reorderable op cards for crop, rotate, flip, resize, levels, curves, white balance, auto tone, HSL, LUTs, denoise, unsharp mask, conceal (cover / blur / mosaic), stamp, text and image watermarks, and metadata strip/inject. Most ops have on-canvas controls.
- **Live preview.** Each op renders against a preview-sized staged cache, so dragging a slider updates immediately even on large originals.
- **Format-aware output.** JPEG, WebP, AVIF, PNG, or "same as original". Quality, chroma subsampling, progressive encoding, AVIF effort, WebP method, PNG palette, and transparency flattening are all configurable per task or as defaults. For JPEG re-encodes, the output can automatically adopt the estimated quality of the source so files don't grow or shrink unintentionally.
- **Metadata you control.** Source metadata is preserved by default; a privacy pill flags any editorial, timestamp, or GPS data that would survive into the output. Opt-in Strip and Inject cards let you remove unwanted fields and overwrite author / copyright / contact / etc. The app records its own `Software` and `ModifyDate` tags by default (both can be turned off).
- **Batch rename.** Four built-in templates (`Slug + size`, `Slug only`, `Original + size`, `Original only`) with conflict detection across templates and destination directories, per-row slug overrides, and collision-safe rename runs.
- **AI assist (opt-in).** Generate descriptions and URL slugs with Gemini, using a key you store locally. Images are downscaled to a long edge of 1024 px before being sent, to keep latency and cost predictable.
- **Drag in, drag out.** Drop image files or output `.json` sidecars anywhere in the window. The sidecar format lets you re-import a previously processed task with its pipeline intact.
- **Safe deletes.** Removing a saved output, an imported LUT, or an imported stamp moves it to the OS trash. Source files are never touched.
- **Close protection.** If you have unsaved settings or an in-progress workspace, the app intercepts close and quit and asks before discarding. Power events (OS shutdown / restart) bypass the prompt.

## Installation

FotoReady doesn't ship signed binaries yet, so you build it from source.

```sh
git clone <this-repo> fotoready
cd fotoready
npm install
npm run dist
```

The packaged app is written to `release/`. On macOS the unpacked app is `release/mac-*/FotoReady.app` (for example `release/mac-arm64/FotoReady.app` on Apple Silicon, `release/mac/FotoReady.app` on Intel). Because code signing is intentionally disabled, first launch needs the usual right-click → Open dance to bypass Gatekeeper.

To run from source without packaging:

```sh
npm run dev
```

## Quick start

1. Launch the app.
2. Drag image files into the window, or use **Add Originals** (`Cmd/Ctrl+N`).
3. Select a task in the right-hand panel and add ops in the left-hand panel.
4. Configure the output format and (optionally) a slug for renaming.
5. Save with `Cmd/Ctrl+S` (current task) or `Cmd/Ctrl+Shift+S` (all not-saved).
6. Open the Rename modal with `Cmd/Ctrl+R` when you're ready to rename outputs.

Defaults, the Gemini API key, output metadata stamps, LUT/stamp folders, and confirmation prompts live in **Settings** (`Cmd/Ctrl+Comma`).

## Keyboard shortcuts

| Area | Action | Shortcut |
| --- | --- | --- |
| Import and save | Add originals | `Cmd/Ctrl+N` |
| Import and save | Save current not-saved image | `Cmd/Ctrl+S` |
| Import and save | Save all not-saved images | `Cmd/Ctrl+Shift+S` |
| Import and save | Rename all | `Cmd/Ctrl+R` |
| Editing | Undo last not-saved edit (outside text fields) | `Cmd/Ctrl+Z` |
| View | Toggle histogram | `Cmd/Ctrl+H` |
| App | Open settings | `Cmd/Ctrl+Comma` |
| App | Show keyboard shortcuts | `Cmd/Ctrl+Slash` |
| App | Close the active dialog | `Esc` |
| Lists and controls | Move within the focused list or control | `Arrow keys` |
| Lists and controls | Jump to the first / last item | `Home / End` |
| Lists and controls | Remove the selected original | `Delete / Backspace` |
| Lists and controls | Open a menu, move between commands, close | `Enter / Arrows / Esc` |
| Asset picker | Move and select in the grid | `Arrow keys` |
| Asset picker | Extend the selection (Shift+Click ranges, Cmd/Ctrl+Click toggles, Cmd/Ctrl+A all) | `Shift+Arrows` |
| Asset picker | Use the selected item | `Enter / Space` |
| Asset picker | Remove from library | `Delete / Backspace` |

The LUT and stamp picker is a multi-select grid; `Delete` / `Backspace` moves the selected imported files to the system trash, and built-in items are protected.

Lists (Originals, Tasks), segmented controls, swatch groups, the settings tab strip, the resize-preset toolbar, and the app menu are each a single tab stop: press `Tab` to move between them, then use the arrow keys to move inside the focused one. In the lists, tab strip, and segmented groups the selection follows as you move; in the preset toolbar and the app menu the arrows move focus and `Enter` activates. This keeps `Tab` short and predictable instead of stepping through every item.

When a text field is focused, `Cmd/Ctrl+Z` uses the field's native text undo. Move focus out of the field to undo the last task edit.

## Concepts

### Originals and tasks

An **original** is a source image you've imported. A **task** is one edit-and-save configuration for an original. You can fork a saved task to make another variant from the same source.

A FotoReady session is in-memory: closing the app without saving discards unsaved tasks (the app prompts first). To persist a task across sessions, save the output — a `.json` sidecar with the same base name is written next to it, and dragging that sidecar back into FotoReady re-creates the task with its pipeline intact.

### Preview pipeline

For each task, FotoReady keeps a preview-sized base image plus a cached image after each op. Editing an op invalidates that op's cached stage and every later stage; earlier stages stay reusable, so dragging a slider on a late op doesn't re-run the whole pipeline. The preview's long edge defaults to 1024 px and is adjustable in **Settings**.

Most cards preview the image after their parameters are applied. Cards that edit an overlay against their input image (such as Crop) display the image *before* the op so the overlay is meaningful.

### Metadata model

FotoReady re-encodes every save. By default, all source metadata is preserved on the output except fields that no longer describe the re-encoded file (thumbnails, previews, orientation, dimensions, ICC profile, maker notes). The tasks panel shows a privacy pill (E·T·G) when source editorial / time / GPS data will survive into the output.

- **Strip metadata** is opt-in. When added, every group is stripped except those explicitly kept: Editorial (descriptive / rights / contact fields), Time (capture / create dates), and GPS (coordinates / direction / date).
- **Inject metadata** writes the nine editable fields from Settings or from the card: source, description, author, contact email, contact URL, credit, copyright, rights URL, and usage terms. Injected values win over same-named source values. Text is Unicode; XMP is UTF-8 and legacy IPTC mirrors are marked UTF-8.
- **Output stamps** (Settings → Metadata) — both on by default:
  - *Software tag* writes `Software: FotoReady` on every save.
  - *ModifyDate* writes the save time to EXIF `ModifyDate`. EXIF has no timezone field, so this is the machine's **local wall-clock time** with no offset recorded. Treat it as date-resolution information; the hour/minute reveals when you were at the machine. Turn it off if that's a concern.

### Box overlays

Text watermark, image watermark, stamp, and the conceal cards (cover, blur, mosaic) all place a rectangle inside the image and share the same geometry rules:

- New box overlays start at random in-bounds positions instead of a fixed corner.
- All spatial fractions (`x`, `y`, `w`/`width`, `h`/`height`, paddings, border, mosaic cell size) are normalized against the image's **long edge**, so "10%" represents the same physical distance on both axes regardless of orientation. The short-edge axis tops out below 100% because it cannot reach as far as the long edge.
- Each slider's full track represents the entire axis bound; moves preserve size and refuse to overshoot.
- Resizes preserve size and slide the box inward when needed.

Image watermark and stamp also expose a default-on **Lock aspect ratio** toggle plus horizontal and vertical flip toggles. With the lock on, width and height stay in sync with the asset's visible bounds.

### Rename templates

The Rename modal previews proposed names, shows per-row state (Ready / Already named / Missing slug / Needs attention / collision), and only renames rows whose name would actually change. Collisions are checked per destination directory, so semantic conflicts in different folders don't block each other. Rename runs are atomic per file: a failure on the sidecar rolls the image back so the task's pointer and on-disk state stay in agreement.

## Where FotoReady stores data

| Item | Path |
| --- | --- |
| App data root | `~/.fotoready/` |
| Settings | `~/.fotoready/settings.json` |
| UI state | `~/.fotoready/state.json` |
| Obfuscated Gemini key | `~/.fotoready/api-keys.json` |
| Logs | `~/.fotoready/logs/` |
| Imported LUT directory | Configurable; default `~/.fotoready/luts/` |
| Imported stamp directory | Configurable; default `~/.fotoready/stamps/` |

If `settings.json` or `state.json` fails to parse on startup, the bad file is backed up next to itself as `<name>.<utc-timestamp>.invalid` and the app falls back to defaults.

Each launch writes one [JSON Lines](https://jsonlines.org/) session log to `~/.fotoready/logs/`, named by its UTC start time (`yyyymmdd-hhmmss-utc.log`). Logs are never auto-deleted — an old one may be exactly what is needed to debug a problem that surfaces much later. Developer-only `debug` lines are off in packaged builds; set `FOTOREADY_DEBUG=1` (or run an unpackaged dev build) to include them.

API keys are lightly obfuscated in local JSON as `obf:` + base64 of the reversed key. This is not encryption; it only keeps keys from appearing as plain text during casual file browsing. Gemini calls use the model ID configured in Settings (default `gemini-3-flash-preview`).

## Limitations

- macOS builds are unsigned — code signing is intentionally disabled in this repo.
- HEIC/HEIF decode depends on the bundled Sharp/libvips build. If the build doesn't include HEIC support, FotoReady fails fast with a clear message.
- Animated images (GIF, animated WebP) are out of scope.
- There is no project file format. Persistence is per-output via the `.json` sidecar written next to the saved image.
- Inputs above ~1 gigapixel are rejected before decoding so a malformed or absurd file can't OOM the worker.

## Development

Requirements: a current Node LTS and matching npm. The toolchain targets Electron 42 and `electron-vite` 5; the repo does not pin a specific Node version.

```sh
npm install
npm run dev            # dev mode with electron-vite
npm run check:imports  # validate inter-module import boundaries
npm test               # run the Vitest unit suite
npm run typecheck      # type-check each environment: node + web + tests
npm run build          # check:imports + typecheck (node + web) + electron-vite build
npm run package        # build an unpacked directory (no installer)
npm run dist           # build a distributable archive
```

Unit tests run on [Vitest](https://vitest.dev/) and live under `tests/`, mirroring the `src/` layout, so `src/` stays pure shipped code that neither the production typecheck nor the import-boundary check sees. They target the deterministic logic in `shared/`, `core/`, `runtime/`, and the filesystem-facing helpers in `main/` (e.g. the rename service); the React renderer, the Sharp pixel transforms, and the exiftool/Gemini adapters are intentionally left to manual and integration testing. `npm run test:watch` reruns on change.

The production typecheck is split by runtime environment so cross-environment mistakes are caught statically: `tsconfig.node.json` (the `shared`/`core`/`runtime`/`adapters`/`main`/`preload` rings — Node, no DOM) and `tsconfig.web.json` (renderer — DOM, no Node types). A main-side file reaching for a browser global, or a renderer file reaching for a Node global, is a static error. `npm run typecheck` adds `tsconfig.test.json` (both environments, for the tests) on top, and `npm run build` runs the two production configs before bundling.

### Project layout

```
src/
  main/        Main process: IPC, file IO, queues, worker pool
  preload/     Bridge exposing window.api to the renderer
  renderer/    React UI
  core/        Op implementations and slug rules
  runtime/     Pipeline runner, decode/encode, hashing
  adapters/    External-system adapters (exiftool, Gemini, api-keys, atomic-file)
  shared/      Cross-process types, validation, constants
scripts/       Build helpers and import-boundary check
resources/     Bundled LUTs and stamps shipped with the app
tests/         Vitest unit suite, mirroring the src/ layout
```

Import boundaries are enforced by `scripts/check-import-boundaries.mjs`. Each ring can only depend on itself and rings to its left:

```
shared  <  core, runtime  <  adapters  <  main  <  preload, renderer
```

### How a save works

1. `runPipeline` (Piscina worker thread) decodes the source via Sharp, runs every enabled op in order, and encodes to the requested format.
2. The encoded buffer is written to a unique staged path inside the output directory.
3. `applyMetadataToOutput` (exiftool) copies source metadata, clears stale tags, applies the strip/inject policy, and stamps `Software` / `ModifyDate`.
4. A `.json` sidecar (same base name as the output) is written alongside it.
5. A later rename can move the image and sidecar atomically into the user-chosen final name; a failure on the sidecar rolls the image back.

Pipeline jobs and Gemini calls run in pools. The pipeline worker pool defaults to `min(8, cpu_count)` threads and the vision queue defaults to 3 concurrent requests; both are adjustable in **Settings**.

Persistent files (`settings.json`, UI state, sidecars, the obfuscated key store) are written through `atomicWriteFile` (`src/adapters/atomic-file.ts`) so a crash mid-write cannot corrupt them.

## License

MIT — see [`LICENSE`](LICENSE).
