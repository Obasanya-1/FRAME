const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'win32') {
  console.error('package:win must be run on Windows because it packages the installed Windows Electron runtime.');
  process.exit(1);
}

const requireInstaller = process.argv.includes('--require-installer');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
let electronPkg;
try {
  electronPkg = require.resolve('electron/package.json', {paths:[root]});
} catch {
  console.error('Electron is not installed. From the FRAME repository root, run: npm install --include=dev');
  process.exit(1);
}
const electronDir = path.dirname(electronPkg);
const electronDist = path.join(electronDir, 'dist');
const electronExeInDist = path.join(electronDist, 'electron.exe');
const releaseRoot = path.join(root, 'release');
const setupExe = path.join(releaseRoot, `FRAME-Studio-v${version}-Setup.exe`);
const portable = path.join(releaseRoot, 'FRAME-Studio-portable');
const resources = path.join(portable, 'resources');
const appDir = path.join(resources, 'app');

if (!fs.existsSync(electronExeInDist)) {
  const installer = path.join(electronDir, 'install.js');
  if (!fs.existsSync(installer)) {
    console.error('Electron is installed, but its runtime is missing and install.js could not be found.');
    process.exit(1);
  }
  console.log('Electron package found, but electron.exe is missing.');
  console.log('Downloading the Electron Windows runtime now...');
  try {
    execFileSync(process.execPath, [installer], { cwd: electronDir, stdio: 'inherit', env: process.env });
  } catch (error) {
    console.error('\nElectron runtime download failed. Try: npm rebuild electron');
    process.exit(error.status || 1);
  }
}

if (!fs.existsSync(electronExeInDist)) {
  console.error(`Electron runtime is missing: ${electronExeInDist}`);
  process.exit(1);
}

// Only clear staging for this build. Never delete older releases or setup EXEs.
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('Studio frontend build is missing. Run: npm run build:studio');
  process.exit(1);
}
fs.mkdirSync(releaseRoot, { recursive: true });
// An installer for the same version must be regenerated, not mistaken for a fresh build.
fs.rmSync(setupExe, { force: true });
fs.rmSync(portable, { recursive: true, force: true });
fs.mkdirSync(portable, { recursive: true });
fs.cpSync(electronDist, portable, { recursive: true });
fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
fs.mkdirSync(appDir, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true });
fs.copyFileSync(path.join(root, 'electron.cjs'), path.join(appDir, 'electron.cjs'));
fs.copyFileSync(path.join(root, 'preload.cjs'), path.join(appDir, 'preload.cjs'));
if (fs.existsSync(path.join(root, 'THIRD_PARTY_LICENSES'))) {
  fs.cpSync(path.join(root, 'THIRD_PARTY_LICENSES'), path.join(appDir, 'THIRD_PARTY_LICENSES'), { recursive: true });
}
if (fs.existsSync(path.join(root, 'assets'))) {
  fs.cpSync(path.join(root, 'assets'), path.join(appDir, 'assets'), { recursive: true });
}
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: 'frame-studio',
  productName: 'FRAME Studio',
  version,
  main: 'electron.cjs'
}, null, 2));

const electronExe = path.join(portable, 'electron.exe');
const frameExe = path.join(portable, 'FRAME Studio.exe');
if (fs.existsSync(electronExe)) fs.renameSync(electronExe, frameExe);

const manifest = { appId: 'frame-studio', productName: 'FRAME Studio', version, schema: 1 };
fs.writeFileSync(path.join(portable, 'frame-update.json'), JSON.stringify(manifest, null, 2));

// Real Windows installer is built with Inno Setup after portable/update packaging.

// Local update package: a zip renamed to .frameupdate. FRAME itself knows how
// to unpack and apply it after the installed app exits.
const tempZip = path.join(releaseRoot, `FRAME-Studio-v${version}.zip`);
const updateFile = path.join(releaseRoot, `FRAME-Studio-v${version}.frameupdate`);
const escapedPortable = portable.replaceAll("'", "''");
const escapedZip = tempZip.replaceAll("'", "''");

// ZIP timestamps are limited to 1980-2107. Some Electron runtime files can
// carry timestamps outside that range, which makes PowerShell Compress-Archive
// throw "The DateTimeOffset specified cannot be converted into a Zip file timestamp."
// Normalize the staged portable copy before creating the update archive.
const zipEpoch = '2020-01-01T00:00:00';
try {
  execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `$ErrorActionPreference='Stop'; ` +
    `Get-ChildItem -LiteralPath '${escapedPortable}' -Recurse -Force | ForEach-Object { $_.LastWriteTime = [datetime]'${zipEpoch}' }; ` +
    `(Get-Item -LiteralPath '${escapedPortable}').LastWriteTime = [datetime]'${zipEpoch}'; ` +
    `Compress-Archive -Path '${escapedPortable}\\*' -DestinationPath '${escapedZip}' -Force`
  ], { stdio: 'inherit' });
} catch (error) {
  console.error('\nCould not create the .frameupdate archive.');
  console.error('PowerShell Compress-Archive failed; no update package was produced.');
  process.exit(error.status || 1);
}

if (!fs.existsSync(tempZip)) {
  console.error(`Update archive was not created: ${tempZip}`);
  process.exit(1);
}
if (fs.existsSync(updateFile)) fs.rmSync(updateFile, { force: true });
fs.renameSync(tempZip, updateFile);

console.log(`\nFRAME Studio ${version} packaging complete.`);
console.log(`Portable app: ${portable}`);
console.log(`Future update package: ${updateFile}`);
console.log('\nPortable/update packaging finished.');

// Portable packaging is always available. The installer is mandatory only when
// --require-installer is specified; that mode must report genuine failure.
const installerBuilder = path.join(root, 'scripts', 'build-installer.cjs');
try {
  execFileSync(process.execPath, [installerBuilder], { cwd: root, stdio: 'inherit' });
  if (!fs.existsSync(setupExe)) throw new Error(`Setup EXE is missing: ${setupExe}`);
  console.log(`Windows installer: ${setupExe}`);
} catch (error) {
  if (requireInstaller) {
    console.error('\nWindows installer build failed. Portable and update packages were built.');
    console.error('Install Inno Setup 6, then rerun: npm run package:installer');
    process.exit(error.status || 1);
  }
  console.warn('\nWindows installer was not built. Portable and update packages are ready.');
  console.warn('Install Inno Setup 6, then run: npm run package:installer');
}
