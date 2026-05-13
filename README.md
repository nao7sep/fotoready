# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows.

## Status

- Project/session persistence with recent-project history, saved project naming, and guarded project/settings validation.
- Main/renderer IPC for import, task editing, previewing, processing, retry/delete flows, queue pause/resume, rename preview/run, and Gemini-powered description generation.
- Sharp/Piscina runtime with crop/rotate/resize/tone/LUT/redaction/watermark ops, JPEG quality strategies, metadata strip/inject/date writing, and safer unsupported-format handling.
- Canvas workflow with before/after preview, fit and 100% zoom, panning, histogram feedback, crop editing, and direct editing for the first redaction rectangle.
- Naming/template workflow with placeholder validation, inline settings errors, rename blocking for unsafe templates, and batch description generation progress.
- Queue/error UX with active-task reporting, clearer processing/error states, source reveal, retry/dismiss actions, and renderer log forwarding.
- A small Vitest foundation covering template rendering, template validation, and rename validation paths.

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
npm test
npm run build
npm run package
npm run icons
```

Packaging uses `electron-builder` and writes unpacked artifacts to `release/`.
The unpacked macOS app is written to `release/mac-arm64/FotoReady.app`.
