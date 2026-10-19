const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'win32') {
  console.error('package:installer must be run on Windows.');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const iss = path.join(root, 'installer', 'FRAME-Studio.iss');
const portableExe = path.join(root, 'release', 'FRAME-Studio-portable', 'FRAME Studio.exe');
const icon = path.join(root, 'assets', 'frame.ico');

if (!fs.existsSync(portableExe)) {
  console.error('Portable app is missing. From the FRAME repository root, run: npm run package:installer');
  process.exit(1);
}
if (!fs.existsSync(iss) || !fs.existsSync(icon)) {
  console.error('Installer resources are missing: FRAME-Studio.iss or assets/frame.ico');
  process.exit(1);
}

const candidates = [
  process.env.ISCC_PATH,
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe')
].filter(Boolean);

const iscc = candidates.find(p => fs.existsSync(p));
if (!iscc) {
  console.error('\nInno Setup 6 was not found.');
  console.error('Install Inno Setup 6, then run from the FRAME repository root: npm run package:installer');
  console.error('If installed somewhere unusual, set ISCC_PATH to ISCC.exe.');
  process.exit(1);
}

const setupExe = path.join(root, 'release', `FRAME-Studio-v${pkg.version}-Setup.exe`);
// Prevent a stale installer for this version from masquerading as a successful build.
fs.rmSync(setupExe, { force: true });
console.log(`Using Inno Setup: ${iscc}`);
execFileSync(iscc, [`/DMyAppVersion=${pkg.version}`, iss], {
  cwd: root,
  stdio: 'inherit'
});

if (!fs.existsSync(setupExe)) {
  console.error(`Installer was not produced: ${setupExe}`);
  process.exit(1);
}

console.log(`\nInstaller created: ${setupExe}`);
