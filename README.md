# FotoReady

FotoReady is a cross-platform desktop photo editor for blogging and publication workflows. You stack non-destructive, reorderable edits on each image (crop, levels, curves, white balance, HSL, LUTs, watermarks, conceal, and more), control exactly which metadata survives the re-encode, and batch-rename outputs with collision-safe templates. It's for people preparing images for publication who want repeatable, privacy-aware output rather than a general-purpose darkroom. Built on Electron for macOS and Windows (also runnable from source on Linux).

## Features

- **Stackable, non-destructive edits** — reorderable op cards with live preview, even on large originals
- **Format-aware input and output** — open single-image JPEG, PNG, WebP, AVIF, or TIFF files and save as JPEG, PNG, WebP, AVIF, TIFF, or the supported source format, with per-task encode settings. Animated GIF and HEIC/HEIF input are not supported; convert them first.
- **Metadata you control** — preserve, strip, or inject editorial/time/GPS fields, with a privacy pill flagging what would survive
- **Batch rename** — collision-safe templates with per-row slug overrides
- **LUTs and stamps** — apply built-in LUTs and a shipped catalogue of 363 stamps grouped as Cover, Marks, Bubbles, Reactions, Funny, Cute, Stories, and Seasonal; import your own `.cube`, PNG, or SVG assets when needed
- **AI assist (opt-in)** — generate descriptions and slugs with Gemini, using a key stored locally
- **Sidecar persistence** — each saved output writes a `.json` sidecar; drag it back in to re-create the task with its pipeline intact
- **Light and dark themes** — follow the OS appearance or pick Light or Dark in Settings › App › Appearance
- **Ten interface languages** — English, German, Spanish, French, Italian, Brazilian Portuguese, Russian, Japanese, Korean, and Simplified Chinese; follows the computer's language, or pick one in Settings › App › Language

## Requirements

- macOS or Windows (Linux runs from source)
- Metadata editing uses a bundled ExifTool: on macOS and Linux it runs on the **system Perl** interpreter (shipped with current macOS); Windows bundles a self-contained build needing no Perl
- Optional: a Google Gemini API key for the AI-assist features
- A current Node LTS and npm — only if building or running from source

## Download

Prebuilt installers and portable builds for macOS (Apple Silicon) and Windows are on the [Releases](https://github.com/nao7sep/fotoready/releases/latest) page. These builds are **unsigned**, so the OS warns the first time you open one:

- **macOS** — right-click the app and choose **Open** (or run `xattr -dr com.apple.quarantine /Applications/FotoReady.app`).
- **Windows** — on the SmartScreen prompt, click **More info → Run anyway**.

## Run from source

Double-click the launcher for your platform (`scripts/run-dev.command` on macOS, `scripts/run-dev.ps1` on Windows), or run it by hand:

```sh
npm install
npm run dev          # run from source
npm run dist         # build a packaged app into release/
```

## Tests

`npm test` typechecks and runs the whole suite, which takes a few seconds. `npm run test:full` then runs the live lane: it builds the app into `node_modules/.cache`, saves corpus photos through the built pipeline worker and the real ExifTool, and describes one through the real Gemini API. The photos come from the shared test-fixture corpus in the company repository, which must be checked out beside this one. Export `GEMINI_API_KEY` first; the lane makes a few paid Gemini calls, and the full run fails without the key.

## License

[GNU GPL v3 or later](LICENSE) © 2026 Yoshinao Inoguchi

## Contact

Yoshinao Inoguchi — yoshinao@inoguchi.com — <https://inoguchi.com>
