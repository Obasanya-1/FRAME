# FRAME Mobile → Studio parity audit and sync backlog

**Audit baseline:** unified FRAME repository supplied 2026-10-18, with Studio parity patch 01 and patch-file Git ignore patch 02 applied. **Mobile source covered:** handoff for Mobile 01–08H; implementation evidence is from the supplied unified repository. The user has since confirmed Mobile 08H's text fix works on their device, but pixel-identical Studio/Android PNG output has not been verified. No mobile patch-by-patch source snapshots were provided, so associations below follow the handoff and observed code; they do not independently verify each patch's historical delta.

**Preserve FRAME Studio Preview.** Studio's **Instagram carousel preview** (`previewOpen`, `renderSlideCanvas`, preview navigation/refresh) remains supported and **must not be replaced or removed** by Mobile's Export Review. Review/export consistency improvements can be evaluated separately.

## Architecture and compatibility rules

- `apps/studio` provides Electron, Windows filesystem/project dialogs, and packaging. `apps/mobile` provides Capacitor, IndexedDB, Android files/gallery/share and touch UI.
- Both entry points import `packages/editor/src/main.jsx`. A **shared source file is not proof of identical behavior**: `IS_MOBILE` branches, platform styles, and native modules can produce different behavior.
- Both store `format: frame-studio-project` version `3`; document geometry, `groupId`, `maskShapeId`, `cropPage`, layers, and orientations must remain readable across platforms. Test round-trip open, save, reopen, render, and export before changing schema or serialization.
- Mobile 08H was confirmed working by the user. Parity 04 reuses the same fitted text layout, vertical alignment, and baseline math in Studio's DOM and PNG export. Visual comparison of Studio editor, existing Studio Preview, ZIP slides, and Android PNGs remains required.
- Every parity item needs a Desktop build check and direct Electron interaction test. Shared-core changes also require a Mobile build and Android behavior test. Keep scripts `npm run build:studio`, `npm run build:mobile`, and existing `npm run desktop`.

## Mobile 01–08H → Studio audit

Classification: **Shared** = already present in common editor or file schema; **Desktop adaptation** = PC-specific UI/behavior warranted; **Mobile-only** = do not port. **Shared, guarded** means common file but platform branches produce different results. Status is source inspection, not an end-user runtime guarantee.

| Source patches | Capability / observed implementation | Classification | Studio treatment | Status / test needed |
| --- | --- | --- | --- | --- |
| 04–05F | Mobile IndexedDB project saves; transaction waits for `tx.oncomplete` | Mobile-only storage, shared project schema | Preserve Electron native `.frame` files and autosave; don't add a second local database | Source confirmed; run storage regression tests on Mobile |
| 04–05F | Save/saving/error states | Desktop adaptation | Studio save confirmation/error feedback | **Parity 01 implemented**, Electron test pending; Electron reports completion after file write |
| 04–05F | Your Work / Home / recent thumbnails / open & delete | Desktop adaptation | Desktop welcome/Home and visual recent projects with native file-backed metadata | **Parity 04 implemented:** native Windows Home, Your Work thumbnails, project naming, recycle-bin deletion, separate backups; runtime pending |
| 04–05F | Name before new project, visual preset gallery, home presets | Shared presets + desktop adaptation | Reuse shared preset layout thumbnails in optional Windows Home | Backlog, medium; existing Studio preset dialog remains |
| 04–05F | Persist dark/light UI theme | Shared | Keep existing Studio local theme settings | Implemented in common editor; verify both |
| 04–05F | Portable `.frame` import/export backups | Shared schema + platform adapters | Keep native Open/Save As; consider **Export Backup** with a Windows save dialog | Import and native saves present; optional backup UI backlog |
| 04A–04D, 06–06B, 07K | Contextual Edit control / double-tap inspector | Mobile-only UI; desktop adaptation for behavior | Keep click-to-select + right-side inspector; replace legacy desktop text `prompt()` on double-click only after design review | Backlog, medium; no floating touch button |
| 04A–04D, 06–06B, 07K | Shift multi-select and direct group dragging using `groupId` | Shared | Keep Shift-click, drag group, context-menu Group, keyboard shortcuts | Source confirmed; run Electron mouse/keyboard regression |
| 06–06B, 07K | Ungroup from Edit inspector | Desktop adaptation | Expose existing shared `ungroupMobileSelection()` action in desktop inspector | **Parity 03 implemented**, Windows UI test pending |
| 04A–04D, 06–06B, 07K | Long-press and interrupted touch gestures | Mobile-only | Keep desktop right-click and Escape; don't add touch timers to PC | No desktop port |
| 06–07J | Pinch zoom / mobile canvas margins | Mobile-only | Retain Studio window/canvas zoom, middle-pan, wheel and scroll workflows | No desktop port |
| 06–07J | Layer geometry, cross-slide images, clipping and masks | Shared, guarded | Test seamless multi-slide imagery, `cropPage`, page offsets and rendering, Studio preview and exported ZIP | **High-priority verification**, no untested renderer port |
| 06–07J | Thin mobile slide boundaries without labels | Mobile-only UI | Keep desktop guide toggle and accurate ZIP/preview boundaries | No desktop port; verify guides not exported |
| 08A–08H | Text wrapping, auto-fitting, metrics, top/middle/bottom vertical alignment | Shared document fields and Parity 04 text layout | Port user-confirmed 08H fitting to Studio DOM and PNG renderer | **Parity 04 implemented (user-confirmed Mobile behavior);** Studio visual parity/PNG comparison pending |
| 08A–08H | Live font/color/size and inspector visibility | Shared controls + mobile layout | Keep desktop live inspector visible alongside canvas | Source present; test desktop editing and undo |
| 07–08H | PNG export progress/cancel/partial save | Desktop adaptation | **Parity 04 implemented:** desktop ZIP progress and cancellation without partial ZIP, preserving existing Studio Preview; runtime pending | Electron export/cancel and large-project testing pending |
| 07–08H | Export Review, fast React review, image caching | Mobile-only UI experiment + shared rendering concerns | **KEEP existing Studio Instagram Preview**; validate its rendering against exported PNG; evaluate optional desktop export status separately | Explicitly deferred; Mobile review vs PNG mismatch unresolved |
| 07–08H | Android save gallery (`Pictures/FRAME`), share sheet, SAF | Mobile-only | Native Windows save/export dialogs remain | No port |
| 08 | Offline project-store regression and Android registration checks | Shared testing discipline, platform-specific test scripts | Run Mobile storage script on mobile changes; add shared `.frame` fixture tests when possible | Backlog; do not copy Android checks into desktop |

## Ordered Mobile → Studio sync backlog

| ID | Priority | Action | State | Impacts | Verification / acceptance |
| --- | --- | --- | --- | --- | --- |
| MS-01 | High | Reliable Save / Save As success and failure message | Parity 01, runtime pending | Studio-facing code in shared editor; no `.frame` change | Save, Save As, dialog cancellation, disk-write failure; verify toast |
| MS-02 | High | Desktop Edit inspector Ungroup for an existing single/multi-selected group | **Parity 03, runtime pending** | Common JSX + CSS, same `groupId` format; Mobile UI unchanged | Group 2+ objects, select one, Ungroup; undo and redo; light/dark contrast |
| MS-03 | High | Your Work-inspired desktop Home / recent projects with thumbnails and new-project naming | **Parity 04 implemented; runtime pending** | Windows native file list/preview; no duplicate DB | Thumbnail load, missing files, create/open/delete (confirmation), recent list |
| MS-04 | Critical safety | Cross-platform text fitting and clipping visual regression suite | **Mobile verified by user; Studio shared path in Parity 04; visual checks pending** | Shared layer geometry and PNG/export text, schema defaults | Compare editing vs Studio preview vs ZIP PNG vs Mobile PNG in 2 orientations, multiple fonts |
| MS-05 | High | Seamless cross-slide image and mask rendering parity | Audit/testing queued | Shared editor/export; `GAP` and crop branch differ by platform | One image across boundary, cropping, masks, ZIP vs Studio preview vs Mobile PNG |
| MS-06 | Medium | Desktop export progress/cancel, preserving Studio Preview and ZIP | **Parity 04 implemented; runtime pending** | Desktop export state, no `.frame` change | Cancel mid-render, no partial/corrupt ZIP, preview remains usable |
| MS-07 | Medium | Native backup action (distinct from Save As) | **Parity 04 implemented; runtime pending** | Electron filesystem only | Choose target, verify backup portable to Mobile |
| MS-08 | Medium | Desktop double-click text edits via inspector, no legacy prompt | Planned | Studio interaction only | Double-click text, font/color change, normal keyboard entry, undo |

## Studio → Mobile cross-check from this patch

- **Parity 03:** Exposes desktop Ungroup buttons using existing common handler. No new project fields, export format, preset, or renderer behavior. Mobile already had Ungroup and remains functionally equivalent. The shared CSS class uses theme variables for both light/dark modes.
- **Preview safeguard:** No code touched within Studio preview, preview cache, or export paths. Future Mobile changes must not silently replace the desktop Instagram preview.

## Patch validation log

| Patch | Baseline | Static checks | Build and runtime status |
| --- | --- | --- | --- |
| 01 | Uploaded unified FRAME repo | `git apply --check` verified | Electron behavior unverified |
| 02 | Parity 01 | `git apply --check` verified | `.gitignore`-only |
| 03 | Parity 02 | Git apply / reverse apply, `git diff --check`, JSX parse passed; offline Mobile verification and IndexedDB store regression passed | Studio `npm run build:studio` attempted but blocked (`vite: not found`, dependencies unavailable); Electron grouping and ungrouping pending user verification |


## Parity 04: Desktop Home, Your Work, 08H text layout, and ZIP export feedback

**Source Mobile patches:** 04–05F (Home, Your Work, project thumbnails, naming, portable backup), 07–08H (text fitting and PNG progress/cancel), 08H specifically (confirmed working by the user). **Classification:** Desktop adaptation for Home/Windows files/progress UI; shared-core logic for fitted text; Android-only storage, gallery, share sheet, system Back, and pinch behavior remain Mobile-only.

- **Desktop Home:** Opens when FRAME Studio starts and from the Home button or F logo. The current editor session (including an unsaved recovered session) remains available through Continue editing. Project naming happens before a new blank or preset-based carousel; Save uses that name as the suggested Windows filename. Project library is backed by the last 20 native `.frame`/`.json` files in Electron's existing recent-files index, **not** a separate IndexedDB store or an exhaustive file-system scan.
- **Windows Your Work:** Read-only first-slide thumbnail data and lightweight JPEG previews are assembled in Electron for saved recent projects; original full-resolution photos remain only in the project file. Open uses the existing native project loader; Backup uses a separate Save dialog and file copy without changing the project association; Delete uses the Windows Recycle Bin and requires native confirmation. Original `.frame` contents and save format are unchanged.
- **Preset safety:** Home reuses existing built-in and user-saved layout presets. Each element gets a fresh unique layer ID even when the original preset omitted IDs; source mask and group relationships are remapped. A new project from a preset does not overwrite the original `.frame` file.
- **Text 08H:** Shared DOM/PNG layout uses the same text fitting math and vertical alignment (`top`, `middle`, `bottom`) on Studio and Mobile. Project `.frame` version remains 3; `verticalAlign` is an optional existing layer field. Fonts are remeasured after font loading. **Risk:** different installed/browser fonts and browser Canvas metrics can still cause visual differences. Test before relying on export parity.
- **Desktop ZIP export:** Progress reports per-slide rendering. Cancel stops at the next safe point and discards the in-progress archive; ZIP is only downloaded if the entire export completes. The existing Studio Instagram carousel Preview and its independent rendering/navigation are retained without changes.
- **Validation:** `node scripts/test-studio-parity.mjs` covers fitted-text logic, vertical alignment, unique preset IDs, mask/group reference remapping, native project APIs, and Preview preservation. JS/JSX syntax, patch application and Git whitespace were checked. Vite dependencies were unavailable in this session, so complete builds and Electron/Android runtime are still required.

### Manual acceptance checklist (Windows)

1. Start Studio. Home shows without the starter project flashing; use Continue editing to open the recovered session if present. Confirm app dark/light settings persist.
2. Click New carousel, name it, create, then Ctrl+S. Verify the native Save dialog proposes that name, the file is saved, and its tile appears in Your Work after returning Home.
3. Open a saved project tile, save and return; verify thumbnails and native file paths remain correct. Export Backup and reopen the copy on Mobile. Delete a **throwaway** project, confirm it goes to Recycle Bin and disappears from Home.
4. Open a built-in preset from Home, drag individual elements (they must not move together unintentionally), then undo. Test masked images and grouping.
5. Resize long multi-line text in both orientations, change its font, size, and vertical alignment, and compare **Studio editor, Studio Preview, PNGs inside ZIP**, and equivalent Mobile PNGs. Examine clipping at small dimensions and unusual fonts.
6. Export a large carousel to ZIP; verify progress, successful ZIP, and safe cancellation with no partial archive. Confirm Studio Preview remains functional before and after cancelling.
7. Run `node scripts/test-studio-parity.mjs`, `npm run build:studio`, `npm run build:mobile`, then `npm run desktop` on the developer's machine.

### Running sync backlog after Parity 04

| Item | Classification | Parity 04 status | Next verification / port |
| --- | --- | --- | --- |
| Home / Your Work / visual presets / project naming (04–05F) | Desktop adaptation | Implemented | Windows interactions, file errors, large photo-heavy library |
| Native `.frame` backups and deletion (04–05F) | Desktop adaptation | Implemented | Windows dialogs, Recycle Bin, Mobile round-trip |
| Shared text fitting and alignment (08A–08H) | Shared logic / desktop UI | Implemented; user confirmed Mobile | Desktop PNG, Studio Preview and Android PNG pixel comparisons |
| ZIP export status and cancellation (07–08H) | Desktop adaptation | Implemented | Large projects, cancellation timings and memory |
| Multi-select / Group / Ungroup (04–07K) | Shared editor + desktop adaptation | Parity 03 | Desktop mouse, Shift-click, context menu, undo |
| Seamless images across slides (06–07J) | Shared rendering, platform differences | Not modified | Compare seam, mask and crop behavior across both exports |
| Studio Preview (original) | Desktop-only | **Preserved** | Test preview export fidelity; do not replace with Mobile Export Review |
| Double-click text via inspector (04–07K) | Desktop adaptation | Not yet ported | Remove legacy prompt only after separate UI test |
| IndexedDB/Capacitor gallery and share (04–08H) | Mobile-only | No desktop change | Continue separate Mobile tests |

## Parity 05: Safe last-slide deletion, image-bearing Home thumbnails, and drag text selection

**Source/trigger:** Studio regression reports after Mobile → Studio Parity 04. Relevant shared carousel editing comes from Mobile 06–07J and shared project data; Home thumbnails came from Mobile 04–05F with a Windows adaptation.

| Change | Parity classification | Files and compatibility impact | Status |
| --- | --- | --- | --- |
| Retain image/shape/text overlapping remaining slides when removing the last slide | **Shared-core** (should affect Studio and Mobile) | `packages/editor/src/slideOperations.js`, `main.jsx`; no new `.frame` fields; undo and masks remain | Focused tests passed; both native UIs require runtime verification |
| Correct `cropPage` and `maskShapeId` visibility while removing last page | **Shared-core** | Same files; old `.frame` documents remain readable, and a surviving image keeps its valid mask reference | Focused tests passed; manual PNG/Preview comparison pending |
| Show a representative image-containing slide and reduced-size photo preview on Windows Home | **Desktop adaptation** | `apps/studio/electron.cjs`; IPC returns small JPEG photo previews rather than original embedded data; project files remain unmodified | Thumbnail generator tested with mocked native images; real Electron decoding pending |
| Prevent browser text highlighting during artwork drag | **Shared editor input guard, primarily desktop benefit** | `main.jsx`, `styles.css`; DOM event/CSS only, no project/preset/export change; actual text inputs remain selectable | Source checks passed; mouse/Android touch regression pending |

**Studio Preview:** Retained untouched. The existing Instagram carousel preview and ZIP renderer are not replaced by Mobile Export Review.

**Regression checks:** `node scripts/test-studio-parity-05.mjs` and the existing `node scripts/test-studio-parity.mjs`. On Windows, manually verify (1) an image crossing slides 2 and 3 survives deletion of slide 3 and remains visible on slide 2, including Preview and PNG ZIP, (2) a last-slide-only image is removed, (3) a Home tile displays a photo from a photo-bearing slide, and (4) dragging images across text creates no browser highlight while textarea selection still works. Then build both targets. Vite was absent in the tool environment and Electron runtime remains untested.

**Running parity backlog update:** Safe cross-page deletion is addressed by Parity 05; seamless image previews/exports and physical desktop/mobile behavior are still pending verification. Home thumbnails are improved but need real Windows Electron tests with large JPEG/PNG projects and masked or filled images.

## Parity 06: Verified Studio Home previews and observable slide changes (supersedes unsuccessful Parity 05 behavior)

**Reason:** User reported that all three Parity 05 problems remained after applying its patch. Parity 05 only changed native image decoding and lacked real Electron tests. Do not describe the original patch as confirmed working.

| Item | Classification | File / format effects | Status and next step |
| --- | --- | --- | --- |
| Save-time Home image thumbnails | **Desktop adaptation** | Studio `main.jsx` generates an optional small JPEG `studioThumbnail` via the existing shared slide renderer, stored at the root of saved `.frame` files. Electron Home uses this image first. **Mobile ignores the optional field**, preserving old project interoperability. `ProjectThumbnail.jsx` renders the JPEG if supplied; Android's layer previews are otherwise unchanged. | Source/unit tests pass; verify actual Windows saving, Home preview, photo masks/fills, and first image-bearing slide. For older project files without a cached thumbnail, Electron still tries native photo decoding and a bounded raw-image fallback. Resave an older project once to generate the reliable cached preview. |
| Preserve neighboring slide artwork on delete | **Shared-core** | Uses current layers/pages and explicit page/height bounds in `slideOperations.js`; keeps original image geometry, mask references and Undo snapshot; no `.frame` schema change. | Unit-tested cross-slide and cropped-image cases; user must confirm in Studio Preview and ZIP on Windows. Toast reports last-slide object deletion count. |
| Prevent browser selection while dragging | **Desktop adaptation** | Adds desktop-only drag/select interception and CSS; Mobile touch remains unchanged; actual text inputs remain selectable. | JSX and CSS checks passed; mouse runtime validation pending. |
| Identify stale desktop builds | **Desktop-only** | Home no longer shows an internal parity/version badge. No document-format impact. | Verify source changes through `npm run desktop` or `npm run build:studio` rather than displaying a development marker in the UI. |

**Preview safeguard:** The existing Studio Instagram carousel Preview remains, with no replacement by Mobile Export Review. **Validation:** `node scripts/test-studio-parity-05.mjs`, `node scripts/test-studio-parity-06.mjs`, `node scripts/test-studio-parity.mjs`, `node scripts/verify-mobile.cjs`, and `node scripts/test-project-store.mjs` (offline). Full Vite builds and Electron interactions still require Windows testing.

## Studio Parity 08: Layers inspector reordering (2026-10-18)

- **Existing behavior:** Desktop and Mobile share `z` indices, layer storage, editor rendering and export ordering. The shared `LayersPanel` originally used native HTML5 `draggable` buttons. A newer desktop style applied `-webkit-user-drag:none` to inspector buttons, preventing the intended desktop gesture.
- **Classification:** **Desktop adaptation required.** Studio uses pointer-based dragging on layer rows, with visible drop positions and Move Up / Move Down actions for a selected layer. The Mobile native drag fallback is retained, pending touch-device review.
- **Files:** `packages/editor/src/main.jsx`, `packages/editor/src/styles.css`, `packages/editor/src/layerOrdering.mjs`; regression script `scripts/test-studio-layer-order-08.mjs`.
- **Project/preset/export compatibility:** unchanged `.frame` schema; changes `z` values only when an order change is made. Preset layers, masks, images and `groupId` are retained. Both the canvas and ZIP renderer follow `z` order; Undo uses the existing project checkpoint.
- **Validation:** node ordering and persistence regression test, Git patch application/reversal and whitespace verification. **Still required:** mouse drag/drop and Up/Down test in Windows Electron; check undo/redo and reopen. Re-test Mobile's Layers inspector on Android to ensure no regression.
- **Mobile → Studio tracking:** no new mobile feature port. Fix is desktop-specific UI behavior over shared layer order data. Do not replace Studio's existing Preview.

## Studio Parity 10: Rebased image mouse interactions (2026-10-18)

**Baseline:** `v.zip` supplied after Mobile's masked-image selection changes through 08P, plus Studio Parity 09. Supersedes the earlier Parity 10 patch that did not apply. File paths are unchanged in the unified repository.

- **Classification: Studio-only pointer UI over shared document fields.** Page-filled photos now intercept mouse events only inside the intersection of the image rectangle and its visible slide crop; the rest of the crop cannot block underlying text/shapes. The original `x/y/w/h`, `cropPage`, `.frame` data and PNG renderer are unchanged.
- **Studio-only resizing:** Selection grips are rendered outside the artwork layers on a high-z-index stage overlay with 32-pixel pointer targets and 12-pixel visual marks. For masked images they use their actual shape's geometry. Mobile's selection frame and touch resize behavior remain separate.
- **Shape drop:** Studio reuses the shared, shape-aware `findImageShapeDropTarget` with the actual mouse cursor position, recalculates at release, and shows a visible overlay above the photo. Mobile 08P's deliberate hold-to-fill and tap-to-select behavior remains intact; no automatic Mobile filling added.
- **Compatibility:** No `.frame` project schema changes, no changes to ZIP export, text metrics or Studio Instagram Preview. Undo state and independent mask attachment are preserved.
- **Automated checks:** `node scripts/test-studio-image-interactions-10.mjs`, `node scripts/test-studio-layer-order-08.mjs`, `node scripts/test-studio-parity-06.mjs`, `node scripts/test-mobile-mask-selection-only.mjs`, and `node scripts/test-mobile-shape-drop.mjs` passed against supplied files. JSX transpilation passed. Vite dependencies were absent in this environment; Windows Electron interaction and final desktop build remain to be tested.
