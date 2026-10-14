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

## Project Structure

```text
FRAME-Studio/
├── src/
├── scripts/
├── THIRD_PARTY_LICENSES/
├── electron.cjs
├── preload.cjs
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
├── CHANGELOG.md
├── LICENSE
└── README.md
```

Generated files such as `node_modules`, `dist`, `release`, installers, and `.frameupdate` packages are excluded from version control.

## Development

Install dependencies:

```bash
npm install --include=dev
```

Run FRAME Studio in development mode:

```bash
npm run desktop
```

Build the frontend:

```bash
npm run build
```

## Windows Packaging

Create the portable Windows build, installer files, and update package:

```bash
npm run package:win
```

Generated files are placed in:

```text
release/
```

The packaging process produces the Windows application and a `.frameupdate` package for updating an existing FRAME Studio installation.

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

## Production Repository

This repository contains the production source for FRAME Studio.

Development builds, test artifacts, local user projects, dependency folders, and generated installers should not be committed to this repository.

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
- production-ready Windows update workflow
