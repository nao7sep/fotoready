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
- Binary-search JPEG `match-source-size` encoding against the original source byte size.
- Concurrent processing queue using configured worker pool size, plus task retry/delete controls and visible error details.
- Project and queue snapshot event streaming from main to renderer.
- Initial keyboard shortcuts, panel toggles, shortcuts modal, New project, and output directory picker.
- Runtime-backed tone, LUT, redaction, and watermark ops with focused controls and file pickers.
- Filename template settings with slug, size, extension, hash, padded index, and date placeholders.
- Rename modal scope selection and inline description generation for missing slug data.
- Per-task undo history for pending task edits through the Cmd/Ctrl+Z shortcut.
- Current-task error actions for retry, source reveal, and dismiss.
- Expanded settings controls for encoding, vision, performance, preview, and path defaults.
- Runtime-backed curves and HSL tone ops, source date preservation, and post-metadata output hashing.
- Piscina-backed pipeline worker entry wired into processing and preview rendering.

Deeper settings forms and packaging polish are planned as later phases.

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
