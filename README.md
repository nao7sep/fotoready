# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows.

## Status

- Session-only desktop workflow with in-memory originals and tasks. There is no project file format or recent-project list. User-initiated close/quit asks for confirmation when the current workspace or a settings draft would be discarded; OS shutdown/restart bypasses that prompt.
- Main/renderer IPC for drag-anywhere image import, task editing, previewing, queued processing, retry/delete flows, rename preview/run with completion confirmation, output-sidecar save/import flows, and opt-in Gemini description/slug generation.
- Sharp/Piscina runtime with crop/rotate/resize/tone/LUT/conceal/stamp/watermark ops, staged preview caching, same-as-original output defaults, JPEG quality assumption from in-memory JPEG bytes only when enabled, transparency flatten controls, metadata strip and inject ops, and safer unsupported-format handling.
- Mouse-first geometry editing: reorderable op cards with draggable crop on the preview, crop/rotate/resize controls living in each card, rotate slider, resize presets, custom size controls, histogram feedback, and white-balance neutral-point sampling from the preview.
- Queue/error UX with active-task reporting, consistent Not saved / Saved / Description generated / Slug generated / Needs attention task states, transient Saving / Waiting to save / Generating description / Generating description and slug / Generating slug labels during active work, retry/dismiss actions, renderer log forwarding, import-boundary checks, and a TypeScript production build check.

## Current limitations

- macOS code signing is intentionally disabled, so packaged builds are unsigned.
- Packaged app creation is verified with `npm run package`, but runtime smoke launching remains environment-limited here and should still be checked manually on a target machine.
- HEIC/HEIF decode support depends on the bundled Sharp/libvips build. FotoReady now fails with a direct message when that support is unavailable.
- Animated image workflows are not a target for v1.

## Data locations

| Item | Path |
| --- | --- |
| App data root | `~/.fotoready/` |
| Settings | `~/.fotoready/settings.json` |
| Encrypted Gemini key store | `~/.fotoready/api-keys.enc` |
| Logs | `~/.fotoready/logs/` |
| Source facts cache | `~/.fotoready/cache/source-facts.json` |
| Vision cache | `~/.fotoready/cache/vision-facts.json` |
| LUT directory | Configurable; defaults to `~/.fotoready/luts/` |
| Stamp directory | Configurable; defaults to `~/.fotoready/stamps/` |

Gemini vision uses the configured model ID from Settings. The default is `gemini-3-flash-preview`.

## Development

```sh
npm install
npm run dev
```

## Commands

```sh
npm run check:imports
npm run build
npm run package
npm run icons
```

Packaging uses `electron-builder` and writes unpacked artifacts to `release/`.
The unpacked macOS app is written to `release/mac-arm64/FotoReady.app`.

## Preview model

Live previews use a staged cache. For each task, FotoReady keeps a preview-sized base image for the active original and configured preview long edge, then caches the image after each op as that stage is needed. Editing an op invalidates that op's stage and every later stage; earlier stages stay reusable. When a later card is selected, missing stages are regenerated in order from the nearest cached earlier stage.

Most cards preview the image after their current parameters are applied. Cards that edit an overlay against their input image, such as crop, can display the image before that op while still producing their after-op cached stage when a later card needs it. Preview image display fitting is separate from rendering: the resize card uses shrink-only fitting so small resized outputs are shown at actual preview size, while other cards fit the rendered preview into the available canvas area.

Asset-backed pickers rescan their directories when opened. LUT and stamp lists reflect their configured folders without requiring an app restart. The asset picker preview size is configurable in Settings → App; LUT previews render the current image at that size, PNG stamps are shrunk to fit, and SVG stamps are rasterized to fit. Built-in LUTs and stamps are copied into those folders on first run. After that, newly bundled built-ins are opt-in and are copied only when the user clicks Restore built-ins; restore fills missing files without overwriting existing filenames. A library item is treated as built-in only when its filename and contents match a bundled asset.

## Metadata model

FotoReady re-encodes saved images. By default, **all source metadata is preserved** on the output, minus fields that no longer describe the re-encoded file (thumbnails, previews, orientation, dimensions, ICC profile, maker notes). The tasks panel shows a privacy pill (E·T·G) when source editorial / time / GPS data will survive into the output.

- **Strip metadata** card is opt-in. When added, every group is stripped except those explicitly kept: Editorial (descriptive/rights/contact fields), Time (capture/create date tags), and GPS (coordinates/direction/date).
- **Inject metadata** card writes the nine editable fields from Settings or from the card: source, description, author, contact email, contact URL, credit, copyright, rights URL, and usage terms. Injected values win over any same-named source values. Text is Unicode; XMP is UTF-8 and legacy IPTC mirrors are marked UTF-8.
- **Output stamps** (Settings → Metadata): two booleans, both on by default.
  - *Software tag* — writes `Software: FotoReady` on every save.
  - *ModifyDate* — writes the save time to EXIF `ModifyDate`. The EXIF format has no timezone field, so this is the machine's **local wall-clock time** with no offset recorded. Treat it as date-resolution information; the hour/minute reveals when you were at the machine. Turn it off if that's a concern.

## Box overlays

Text watermark, image watermark, stamp, and the conceal cards (cover, blur, mosaic) all place a rectangle inside the image and share the same box-geometry rules. The convention:

- New box overlays are created at random in-bounds positions instead of a fixed corner anchor.
- All spatial fractions (`x`, `y`, `w`/`width`, `h`/`height`, paddings, border thickness, mosaic cell size) are normalized against the image's **long edge**, so "10%" represents the same physical distance on both axes regardless of orientation. Whichever axis maps to the image's short edge can top out below 100% because that axis simply cannot reach as far as the long edge.
- Each slider's full track represents the entire axis bound. Moves preserve size and refuse to overshoot.
- Resizes preserve size and slide the box inward when needed, so width/height can grow while the far edge stays inside the image.

Image watermark and stamp also expose a default-on **Lock aspect ratio** toggle plus horizontal and vertical flip toggles. With the lock on, width and height stay in sync to the asset's visible bounds and clamping respects both axes so the ratio always holds; with it off, the asset can be stretched freely. The image's natural aspect ratio is read from the main process via Sharp, so PNG and SVG sources both report the correct ratio.

## Keyboard shortcuts

| Area | Action | Shortcut |
| --- | --- | --- |
| Import and save | Add originals | `Cmd/Ctrl+N` |
| Import and save | Save current not-saved image | `Cmd/Ctrl+S` |
| Import and save | Save all not-saved images | `Cmd/Ctrl+Shift+S` |
| Import and save | Rename all | `Cmd/Ctrl+R` |
| Editing | Undo last not-saved edit | `Cmd/Ctrl+Z` |
| View | Toggle histogram | `Cmd/Ctrl+H` |
| App | Open settings | `Cmd/Ctrl+,` |
| App | Show keyboard shortcuts | `Cmd/Ctrl+/` |
| App | Close the active dialog | `Esc` |

`Save current not-saved image` queues saving for the selected not-saved task, applies its current ops, and writes the output image plus its JSON sidecar file.
`Save all not-saved images` queues every not-saved task the same way.
`Rename all` uses four built-in filename choices: `Slug + size` (default), `Slug only`, `Original + size`, and `Original only`. The modal keeps the current output folder at the top, recalculates destinations when that folder changes, shows each row's state first, and exposes inline slug editing/generation only when the selected template uses slugs. Task list and rename rows share the same persistent state model: `Not saved`, `Saved`, `Description generated`, `Slug generated`, and `Needs attention`; rename rows add context such as `Saved, missing slug`, `Description generated, missing slug`, `Ready to rename`, or `Already named` without changing the shared state color. The chosen rename slug is stored on the task; generated slug candidates are suggestions, and empty or uncommitted slug edits block slug-based rename templates. Collision checks are destination-directory aware: exact destination path and sidecar collisions always block, while semantic `{original}` / `{slug}` collisions are only treated as conflicts when those rows would land in the same destination directory. The `Rename all` button requires at least one row to actually rename; rows whose current name already matches the proposed template are shown as `Already named` and will be skipped. On success the modal closes and shows which files were renamed plus any skipped unchanged names; on failure the modal remains open and shows the affected rows and errors.
