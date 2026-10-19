# FRAME unified repository

FRAME Studio (Windows/Electron) and FRAME Mobile (Android/Capacitor) now import **the same React editor entry** from `packages/editor/src/main.jsx`, including the rendering logic, project normalization, presets, layers, and export code. This is the first shared-code migration, not yet a fully modular editor core. Desktop's Electron entry is preserved.

## Requirements
- Node.js 22+ and npm
- Android Studio/JDK/Android SDK for native Android builds
- Windows for the desktop Windows release packaging

## Setup
```bash
npm install
npm run dev:studio
npm run dev:mobile
npm run build:studio
npm run build:mobile
```

For Android native scaffolding (run after `npm install`):
```bash
cd apps/mobile
npx cap add android
cd ../..
npm run android
```

`android/` is generated locally and ignored; keep it in Git once native configuration/customization begins by removing its ignore rule.

## Key notes
- Desktop code was imported unchanged except for a shared browser project picker fallback, consistent JSON project format version, and a mobile-specific label controlled through Vite mode.
- This first milestone shares an actual editor file instead of duplicating source. Future refactors should extract project, canvas, history, preset, and export modules from the editor component.
- FRAME Mobile currently uses the existing UI with responsive styling. Touch ergonomics, native storage/gallery and export need additional implementation.
- If the desktop project requires files from `assets`, they remain in `apps/studio/assets`.
- To connect to GitHub, create one new repository and push this directory. This ZIP does **not** move or modify remote Git repositories or preserve past commit history.

## Windows Installer (FRAME Studio)

From the unified repository root on Windows, install Inno Setup 6 and run:

```cmd
npm install --include=dev
npm run package:installer
```

The setup EXE is written to `apps\studio\release\`. For a portable app
and `.frameupdate` file without requiring Inno Setup, run `npm run package:win`.
See `apps/studio/README.md` for details.
