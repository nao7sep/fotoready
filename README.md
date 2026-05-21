# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows.

## Status

- Session-only desktop workflow with in-memory originals and tasks. There is no project file format or recent-project list. User-initiated close/quit asks for confirmation when the current workspace or a settings draft would be discarded; OS shutdown/restart bypasses that prompt.
- Main/renderer IPC for drag-anywhere image import, task editing, previewing, queued processing, retry/delete flows, rename preview/run with completion confirmation, output-sidecar save/import flows, and opt-in Gemini description/slug generation.
- Sharp/Piscina runtime with crop/rotate/resize/tone/LUT/conceal/stamp/watermark ops, staged preview caching, same-as-original output defaults, JPEG quality assumption from in-memory JPEG bytes only when enabled, transparency flatten controls, metadata strip and inject ops, and safer unsupported-format handling.
- Mouse-first geometry editing: reorderable op cards with draggable crop on the preview, crop/rotate/resize controls living in each card, rotate slider, resize presets, custom size controls, histogram feedback, and white-balance neutral-point sampling from the preview.
- Queue/error UX with active-task reporting, consistent Not saved / Saving / Generating / Saved, missing slug / Saved, slug ready / Needs attention state labels, retry/dismiss actions, renderer log forwarding, import-boundary checks, and a TypeScript production build check.

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
| User LUT directory | `~/.fotoready/luts/` |
| Stamp directory | `~/.fotoready/stamps/` |

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

Asset-backed pickers rescan their directories when opened. LUT lists reflect the current LUT folder, and stamp lists reflect `~/.fotoready/stamps/` without requiring an app restart.

## Metadata model

FotoReady re-encodes saved images and starts the metadata stage by removing embedded metadata from the output. It then writes back only the configured metadata:

- Settings can preserve source capture/creation timestamps when no Strip metadata card is present.
- A Strip metadata card overrides the source-retention setting for that task. Its keep groups are explicit: Editorial keeps the supported descriptive/rights/contact fields, Time keeps capture/create/modify date tags, and GPS keeps the supported GPS coordinate/direction/date tags.
- Inject metadata writes the nine editable fields from Settings or from the card: source, description, author, contact email, contact URL, credit, copyright, rights URL, and usage terms. These fields support Unicode text; XMP is written as UTF-8, and legacy IPTC mirrors are marked UTF-8 when present.
- Orientation, ICC/color profiles, thumbnails, camera/device data, maker notes, software history, and other metadata are not preserved by the Strip metadata card unless another save path explicitly writes them.

## Box overlays

Text watermark, image watermark, stamp, and the conceal cards (cover, blur, mosaic) all place a rectangle inside the image and share the same box-geometry rules. The convention:

- New box overlays are created at random in-bounds positions instead of a fixed corner anchor.
- All spatial fractions (`x`, `y`, `w`/`width`, `h`/`height`, paddings, border thickness, mosaic cell size) are normalized against the image's **long edge**, so "10%" represents the same physical distance on both axes regardless of orientation. Whichever axis maps to the image's short edge can top out below 100% because that axis simply cannot reach as far as the long edge.
- Each slider's full track represents the entire axis bound. Moves preserve size and refuse to overshoot.
- Resizes preserve size and slide the box inward when needed, so width/height can grow while the far edge stays inside the image.

Image watermark and stamp also expose a default-on **Lock aspect ratio** toggle. With the lock on, width and height stay in sync to the asset's visible bounds and clamping respects both axes so the ratio always holds; with it off, the asset can be stretched freely. The image's natural aspect ratio is read from the main process via Sharp, so PNG and SVG sources both report the correct ratio.

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
`Rename all` uses four built-in filename choices: `Slug + size` (default), `Slug only`, `Original + size`, and `Original only`. The modal keeps the current output folder at the top, recalculates destinations when that folder changes, shows each row's rename-specific state first, and exposes inline slug editing/generation only when the selected template uses slugs. Saved rows without a required slug show `Missing slug`; renameable rows show `Ready to rename`; unchanged rows show `Renamed`. The chosen rename slug is stored on the task; generated slug candidates are suggestions, and empty or uncommitted slug edits block slug-based rename templates. Collision checks are destination-directory aware: exact destination path and sidecar collisions always block, while semantic `{original}` / `{slug}` collisions are only treated as conflicts when those rows would land in the same destination directory. On success the modal closes and shows which files were renamed plus any skipped unchanged names; on failure the modal remains open and shows the error.
