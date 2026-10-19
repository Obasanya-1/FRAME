// Verify the exact Vite output was copied to the Android project.
// This catches a successful Vite build followed by a stale/wrong Capacitor bundle.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const mobileDir = join(root, 'apps', 'mobile');
export const distDir = join(mobileDir, 'dist');
export const stagedDir = join(mobileDir, 'android', 'app', 'src', 'main', 'assets', 'public');
export const mobileMarkers = ['Make every slide part of the story.', 'Press Back again to exit FRAME'];
export const studioMarker = 'Pick up a project, or start something new.';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const insist = (condition, reason) => { if(!condition) throw new Error(reason); };

export function checkMobileJs(content, source) {
  for (const marker of mobileMarkers) insist(content.includes(marker), `${source}: Mobile marker missing (${marker}). Wrong build target.`);
  insist(!content.includes(studioMarker), `${source}: Studio Home bundled into Android. Wrong build target.`);
}
export function listFiles(dir) {
  if (!existsSync(dir)) throw new Error(`Missing directory ${dir}`);
  const walk = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap(item => {
    const path = join(folder, item.name);
    return item.isDirectory() ? walk(path) : [path];
  });
  return walk(dir);
}
export function entryJs(dir) {
  const assets = join(dir, 'assets');
  const names = readdirSync(assets).filter(name => /^index-.*\.js$/.test(name));
  insist(names.length === 1, `Expected one Android entry JS in ${assets}, found ${names.length}`);
  return join(assets, names[0]);
}
export function verifyStagedAssets() {
  const js = entryJs(distDir);
  checkMobileJs(readFileSync(js, 'utf8'), 'Vite output');
  const stagedJs = entryJs(stagedDir);
  checkMobileJs(readFileSync(stagedJs, 'utf8'), 'Android staged assets');
  const sourceFiles = listFiles(distDir);
  for (const source of sourceFiles) {
    const rel = relative(distDir, source);
    const target = join(stagedDir, rel);
    insist(existsSync(target), `Android assets missing: ${rel}`);
    insist(sha(readFileSync(source)) === sha(readFileSync(target)), `Android assets are STALE: ${rel}. Run npm run android again.`);
  }
  const config = JSON.parse(readFileSync(join(mobileDir,'android','app','src','main','assets','capacitor.config.json'),'utf8'));
  insist(config.appId === 'app.frame.mobile', `Wrong installed application ID: ${config.appId}`);
  console.log(`FRAME Mobile staged Android assets verified (${sourceFiles.length} matching files; Mobile UI present).`);
  return {files: sourceFiles.length, entry: relative(distDir, js)};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifyStagedAssets(); }
  catch(error) { console.error(`FRAME Android asset verification FAILED: ${error.message}`); process.exitCode = 1; }
}
