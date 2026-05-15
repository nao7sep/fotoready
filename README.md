# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows.

## Status

- Session-only desktop workflow with in-memory originals and tasks. There is no project file format or recent-project list.
- Main/renderer IPC for drag-anywhere image import, task editing, previewing, queued processing, retry/delete flows, rename preview/run, output-sidecar save/import flows, and opt-in Gemini description/slug generation.
- Sharp/Piscina runtime with crop/rotate/resize/tone/LUT/redaction/watermark ops, same-as-original output defaults, JPEG quality assumption from in-memory JPEG bytes only when enabled, transparency flatten controls, metadata strip/inject flows, and safer unsupported-format handling.
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
