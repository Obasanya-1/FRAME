# FRAME

**Design seamless carousels, your way.**

FRAME is a carousel design application for Windows and Android. Create multi-slide designs with images, text, shapes, and customizable styles, then export them for sharing.

FRAME Studio and FRAME Mobile are built on the same editing engine, with interfaces tailored to desktop and touchscreens.

## Apps

| | FRAME Studio | FRAME Mobile |
| --- | --- | --- |
| **Platform** | Windows | Android |
| **Experience** | Desktop editing with keyboard and mouse controls | Touch-friendly editing on the go |
| **Download** | [GitHub Releases](https://github.com/Obasanya-1/FRAME-Studio/releases) | [GitHub Releases](https://github.com/Obasanya-1/FRAME-Studio/releases) |

The [Releases page](https://github.com/Obasanya-1/FRAME-Studio/releases) lists available versions and downloads for each platform.

## Features

- **Carousel editor:** Create and arrange multiple slides in a single project.
- **Flexible layouts:** Combine photos, text, shapes, and preset designs.
- **Image editing:** Crop, position, and fit images within slides or shapes.
- **Layers and groups:** Organize objects, adjust stacking order, and edit grouped elements.
- **Personalization:** Customize colors, typography, themes, and backgrounds.
- **Project files:** Save editable designs in FRAME's `.frame` format.
- **Exports:** Export completed slides for sharing, with platform-specific export options.

### FRAME Studio

The Windows desktop app includes keyboard and mouse editing, project management, native file dialogs, carousel preview, and multi-slide export.

### FRAME Mobile

The Android app brings the editor to a touch interface, with local projects, gesture-based editing, and device export and sharing.

## Get FRAME

Download the latest available builds from **[GitHub Releases](https://github.com/Obasanya-1/FRAME-Studio/releases)**.

- **Windows:** Download and run the FRAME Studio setup installer.
- **Android:** Download the FRAME Mobile APK if one has been published.

## Build from source

FRAME uses a shared React editor, Electron for Windows, and Capacitor for Android. Building from source requires Node.js 22+ and npm. Native Android builds also require Android Studio and the Android SDK.

```bash
npm install
```

| Command | Purpose |
| --- | --- |
| `npm run dev:studio` | Run the Studio development server |
| `npm run desktop` | Launch the Electron desktop app |
| `npm run build:studio` | Build Studio's web assets |
| `npm run dev:mobile` | Run the Mobile development server |
| `npm run build:mobile` | Build Mobile's web assets |
| `npm run android` | Build, sync, and open the Android project |

### Repository structure

```text
apps/
  studio/        Windows desktop application
  mobile/        Android application
packages/
  editor/        Shared carousel editor
scripts/         Build and test utilities
docs/            Project documentation
```

## Feedback

Report bugs or suggest improvements through [GitHub Issues](https://github.com/Obasanya-1/FRAME-Studio/issues).

## License

FRAME is open source under the [MIT License](LICENSE).
