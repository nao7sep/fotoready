# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows.

Current implementation status:

- Electron/Vite/React shell with the four-column editor layout.
- Shared domain contracts for projects, originals, tasks, pipelines, settings, ops, and IPC.
- App data directory at `~/.fotoready`, settings persistence, and session logging.
- Project session state with original import, active task selection, task forking, and pending-task processing.
- Basic sharp-backed pipeline runtime for decode, crop, rotate, resize, denoise, sharpen, and output encoding.

Vision, metadata writing, rename flow, preview rendering, full queue concurrency, and packaging polish are planned as later phases.

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
