# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows.

Current implementation status:

- Electron/Vite/React shell with the four-column editor layout.
- Shared domain contracts for projects, originals, tasks, pipelines, settings, ops, and IPC.
- App data directory at `~/.fotoready`, settings persistence, and session logging.
- Project session state with original import, active task selection, task forking, and pending-task processing.
- Basic sharp-backed pipeline runtime for decode, crop, rotate, resize, denoise, sharpen, and output encoding.
- Editable pending-task pipelines with op add/remove/toggle controls and initial parameter forms.
- Main-process preview rendering displayed in the editor canvas.
- Rename preview/run flow for done tasks using filename templates and manual custom slugs.
- JSON cache IO and an import-time JPEG source-facts queue scaffold.
- Gemini vision adapter, encrypted API-key storage, vision input preparation, result cache, and Generate description action.
- ExifTool-backed metadata stripping and optional injection after output encoding.
- JPEG DQT quality detection cached by source hash and used for source-quality JPEG output.
- Startup recovery demotes in-flight processing tasks and reloads the last opened/saved project.
- Compact settings surface for encrypted Gemini key entry, data directory, cache sizes, and cache clearing.

Full queue concurrency, binary-search `match-source-size`, deeper settings forms, and packaging polish are planned as later phases.

## Development

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

Packaging uses `electron-builder`. Code signing is not configured, so macOS builds will show the standard unsigned-app warning.
