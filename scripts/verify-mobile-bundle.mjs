// Reject an Android web bundle that was accidentally built as FRAME Studio.
// Run after the Mobile Vite build and before Capacitor sync / APK installation.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const assetsDir = join(root, 'apps', 'mobile', 'dist', 'assets');

if (!existsSync(assetsDir)) {
  console.error('FRAME Mobile verification FAILED: apps/mobile/dist/assets does not exist. Build Mobile first.');
  process.exit(1);
}
const files = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
if (files.length === 0) {
  console.error('FRAME Mobile verification FAILED: no compiled JavaScript assets exist.');
  process.exit(1);
}
const contents = files.map((name) => readFileSync(join(assetsDir, name), 'utf8')).join('\n');
const mobileMarkers = ['Make every slide part of the story.', 'Press Back again to exit FRAME'];
const studioMarker = 'Pick up a project, or start something new.';
const missingMarkers = mobileMarkers.filter((marker) => !contents.includes(marker));
if (missingMarkers.length || contents.includes(studioMarker)) {
  console.error('FRAME Mobile verification FAILED: Android bundle contains wrong interface.');
  if (missingMarkers.length) console.error('Missing Mobile markers:', missingMarkers.join(', '));
  if (contents.includes(studioMarker)) console.error('Studio Home marker found in the Mobile build.');
  process.exit(1);
}
console.log('FRAME Mobile build target verified: Mobile Home present; Studio Home excluded.');
