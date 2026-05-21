# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows.

## Status

- Session-only desktop workflow with in-memory originals and tasks. There is no project file format or recent-project list.
- Main/renderer IPC for drag-anywhere image import, task editing, previewing, queued processing, retry/delete flows, rename preview/run, output-sidecar save/import flows, and opt-in Gemini description/slug generation.
- Sharp/Piscina runtime with crop/rotate/resize/tone/LUT/conceal/stamp/watermark ops, staged preview caching, same-as-original output defaults, JPEG quality assumption from in-memory JPEG bytes only when enabled, transparency flatten controls, metadata strip and inject ops, and safer unsupported-format handling.
- Mouse-first geometry editing: reorderable op cards with draggable crop on the preview, crop/rotate/resize controls living in each card, rotate slider, resize presets, custom size controls, histogram feedback, and white-balance neutral-point sampling from the preview.
- Queue/error UX with active-task reporting, source reveal, retry/dismiss actions, renderer log forwarding, and a small Vitest foundation covering template rendering, template validation, rename validation, and crop helper behavior.

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

Image watermark and stamp now use explicit overlay rectangles (`x`, `y`, `width`, `height`) with a default-on **Lock aspect ratio** toggle. With the lock on, width and height stay in sync using the asset's visible bounds; with it off, the asset can be stretched freely.

## Keyboard shortcuts

| Area | Action | Shortcut |
| --- | --- | --- |
| Import and save | Add originals | `Cmd/Ctrl+N` |
| Import and save | Save current pending image | `Cmd/Ctrl+S` |
| Import and save | Save all pending images | `Cmd/Ctrl+Shift+S` |
| Import and save | Rename saved outputs | `Cmd/Ctrl+R` |
| Editing | Undo last pending-task edit | `Cmd/Ctrl+Z` |
| View | Toggle histogram | `Cmd/Ctrl+H` |
| App | Open settings | `Cmd/Ctrl+,` |
| App | Show keyboard shortcuts | `Cmd/Ctrl+/` |
| App | Close the active dialog | `Esc` |

`Save current pending image` queues processing for the selected pending task, applies its current ops, and writes the output image plus the FotoReady sidecar file.
