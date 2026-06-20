# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows. You stack non-destructive, reorderable edits on each image (crop, levels, curves, white balance, HSL, LUTs, watermarks, conceal, and more), control exactly which metadata survives the re-encode, and batch-rename outputs with collision-safe templates. It's for people preparing images for publication who want repeatable, privacy-aware output rather than a general-purpose darkroom. Built on Electron; runs on macOS, Windows, and Linux.

## Features

- **Stackable, non-destructive edits** — reorderable op cards with live preview, even on large originals
- **Format-aware output** — JPEG, WebP, AVIF, PNG, or same-as-original, with per-task encode settings
- **Metadata you control** — preserve, strip, or inject editorial/time/GPS fields, with a privacy pill flagging what would survive
- **Batch rename** — collision-safe templates with per-row slug overrides
- **AI assist (opt-in)** — generate descriptions and slugs with Gemini, using a key stored locally
- **Sidecar persistence** — each saved output writes a `.json` sidecar; drag it back in to re-create the task with its pipeline intact

## Window and layout

FotoReady is a light-themed app and forces its native title bar to the light theme, so it never shows a dark bar on a dark-mode host. It opens at a fixed 1280×800 default every launch and does not remember its size or position. The window's minimum size is not a hand-typed number — it is derived from the panes' own minimums plus the fixed chrome (top bar, preview toolbar, status bar), so the window can never be shrunk small enough to hide or truncate a pane. Those minimums, the splitter width, and the chrome heights all live in one place, `src/shared/layout/workspace-metrics.ts`, which is the single source of truth for both the OS window minimum and the in-page splitter clamping.

## Requirements

- macOS, Windows, or Linux
- A current Node LTS and npm — FotoReady is built from source and doesn't ship signed binaries yet, so first launch on macOS needs the usual right-click → Open to bypass Gatekeeper
- Optional: a Google Gemini API key for the AI-assist features

## Getting started

Double-click the launcher for your platform (`scripts/run-dev.command` on macOS, `scripts/run-dev.ps1` on Windows), or run from source:

```sh
npm install
npm run dev          # run from source
npm run dist         # build a packaged app into release/
```

## License

MIT © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — nao7sep@gmail.com
