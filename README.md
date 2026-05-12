# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows.

This repository is in phase 1 implementation: the Electron/Vite/React shell, shared domain contracts, app data directory, settings persistence, logging, preload IPC boundary, and core op catalog are in place. Image processing, project editing, queues, vision, metadata writing, and packaging polish are planned as later phases.

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
