# FRAME Studio

FRAME Studio is a desktop visual editor for creating seamless multi-slide social media carousels, image layouts, and text-based designs.

It is built as a Windows desktop application using Electron, React, and Vite.

## Features

- Seamless multi-slide carousel editing
- Portrait and landscape project orientations
- Drag-and-drop image placement
- Text layers
- Shape layers
- Custom background colors
- Bundled offline fonts
- Project save/open support with `.frame` files
- Autosave and session recovery
- PNG export for individual slides
- Keyboard shortcuts
- Desktop-native menus
- Local update package support with `.frameupdate` files

## Current Fonts

FRAME Studio currently includes:

- Inter
- Lato
- Noto Serif
- Comfortaa
- Caveat
- Pacifico

Inter, Lato, Noto Serif, and Comfortaa are bundled locally for offline use. Caveat and Pacifico are currently loaded from Google Fonts when an internet connection is available.

Third-party font license notices are stored in the `THIRD_PARTY_LICENSES` directory.

## Tech Stack

- React
- Vite
- Electron
- JavaScript
- CSS

## Unified Repository Layout

```text
FRAME/
├── apps/
│   ├── studio/         # Electron, installer, and Windows packaging
│   └── mobile/         # Capacitor / Android
├── packages/
│   └── editor/         # Shared editing UI and rendering
└── package.json       # Workspace commands
```

Run the following commands from the **FRAME repository root**. Build outputs,
installer executables and update packages remain excluded from Git.

## Installation

Windows users can download the latest installer from the repository's **Releases** page.

Run:

```text
FRAME-Studio-v1.0.0-Setup.exe
```

The installer contains the packaged application. Node.js, npm, Electron, Vite, and Inno Setup are not required to use FRAME Studio.

Because early public builds may not be code-signed, Windows SmartScreen may display an **Unknown publisher** warning.

## Development

### Requirements

- Node.js
- npm

Install project dependencies:

```bash
npm install --include=dev
```

Run FRAME Studio in development mode:

```bash
npm run desktop
```

Build the frontend:

```bash
npm run build:studio
```

## Building the Windows Release

FRAME Studio uses Inno Setup 6 to create the Windows installer.

### Build requirements

1. Install Node.js.
2. Install [Inno Setup 6](https://jrsoftware.org/isinfo.php).
3. Install project dependencies:

```bash
npm install --include=dev
```

### Build all Windows artifacts

```bash
npm run package:win
```

This builds the frontend, portable Electron application, local `.frameupdate` package, and Windows installer if Inno Setup 6 is installed. Missing Inno Setup is reported but does not invalidate the portable build.

Generated release artifacts are placed in:

```text
apps/studio/release/
├── FRAME-Studio-portable/
├── FRAME-Studio-v1.0.0.frameupdate
└── FRAME-Studio-v1.0.0-Setup.exe
```

To build the **Windows setup installer from a clean checkout** (this command also builds the frontend and portable application):

```bash
npm run package:installer
```

`package:installer` requires Inno Setup 6 and fails with a nonzero exit code if
setup compilation fails or the installer `.exe` is missing. Installer output is
at `apps/studio/release/FRAME-Studio-v<version>-Setup.exe`. Older release
artifacts are not deleted when packaging a new version.

Generated release artifacts are intentionally excluded from source control and
should be distributed through GitHub Releases.

## Project Files

FRAME Studio projects use the `.frame` file extension.

Saved projects include project settings such as:

- orientation
- slide count
- canvas background
- image layers
- text layers
- shapes
- typography
- layer positions and dimensions

FRAME Studio also maintains local autosave data separately from application files so application updates do not overwrite user projects.

## Updating FRAME Studio

Installed versions of FRAME Studio support local update packages.

To update:

1. Open FRAME Studio.
2. Go to `Help`.
3. Select `Install Update Package...`.
4. Choose the new `.frameupdate` file.
5. FRAME Studio will apply the update and restart.

This allows normal users to update the application without reinstalling npm dependencies or rebuilding the project.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + N` | New project |
| `Ctrl + O` | Open project |
| `Ctrl + S` | Save project |
| `Ctrl + Shift + S` | Save project as |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` | Redo |
| `Ctrl + Shift + Z` | Redo |
| `Ctrl + C` | Copy selected layer |
| `Ctrl + V` | Paste copied layer |
| `Ctrl + A` | Select all layers |
| `Delete` / `Backspace` | Delete selected layer(s) |
| `Esc` | Clear the current layer selection |
| `Arrow keys` | Move selected layer(s) by 10 px |
| `Shift + Arrow keys` | Move selected layer(s) by 1 px |
| `Ctrl + +` / `Ctrl + =` | Zoom window in |
| `Ctrl + -` | Zoom window out |
| `Ctrl + 0` | Reset window zoom |

Standard text-editing shortcuts such as cut, copy, paste, and select all continue to work while editing text fields.

## Repository

This repository contains the source code and build configuration for FRAME Studio.

Generated builds, local user projects, dependency folders, installers, and update packages are excluded from version control. Release binaries are published separately through GitHub Releases.

## Licensing

FRAME Studio source code is licensed under the MIT License. See the root `LICENSE` file for the full terms.

Third-party assets and fonts remain subject to their respective licenses. See the `THIRD_PARTY_LICENSES` directory for bundled font license notices.

## Status

FRAME Studio is under active development.

Current development priorities include:

- improved text controls
- additional bundled fonts
- more canvas and image controls
- reusable templates
- improved export options
- stronger project recovery
- continued Windows packaging and update improvements
