// FRAME mobile readiness checks. Read-only, offline, and safe to run on Windows.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'apps', 'mobile');
const native = process.argv.includes('--native');
let failures = 0;
function check(label, ok, explanation) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && explanation ? `: ${explanation}` : ''}`);
  if (!ok) failures++;
}
function exists(...parts) { return fs.existsSync(path.join(...parts)); }
function read(...parts) { return fs.readFileSync(path.join(...parts), 'utf8'); }
console.log('FRAME Mobile verification (offline; no network services started)');
check('Shared editor source', exists(root, 'packages', 'editor', 'src', 'main.jsx'));
check('Mobile entry point', exists(app, 'src', 'main.jsx'));
check('Project storage source', exists(app, 'src', 'projectStore.js'));
check('Native document bridge source', exists(app, 'native', 'FrameDocumentPlugin.java'));
check('Native document bridge installer', exists(app, 'scripts', 'install-document-bridge.cjs'));
const vite = read(app, 'vite.config.js');
check('Vite host restricted to loopback', /host\s*:\s*['"]127\.0\.0\.1['"]/.test(vite) && !/host\s*:\s*['"]0\.0\.0\.0['"]/.test(vite));
const editor = read(root, 'packages', 'editor', 'src', 'main.jsx');
check('Android backup plugin invocation', /FrameDocument\.saveBackup\(/.test(editor));
check('Android image export plugin invocation', /FrameDocument\.saveImage\(/.test(editor));
const store = read(app, 'src', 'projectStore.js');
check('Storage waits for transaction commit', /tx\.oncomplete\s*=\s*\(\)\s*=>\s*resolve/.test(store));
const android = path.join(app, 'android');
if (native) {
  check('Android platform directory', exists(android, 'app', 'src', 'main'));
  const registry=path.join(android, 'app', 'src', 'main', 'assets', 'capacitor.plugins.json');
  check('Generated Android plugin registry', fs.existsSync(registry));
  if (fs.existsSync(registry)) {
    try {
      const plugins=JSON.parse(fs.readFileSync(registry, 'utf8'));
      for (const pkg of ['@capacitor/app','@capacitor/filesystem','@capacitor/share'])
        check(`${pkg} registered`, Array.isArray(plugins) && plugins.some(p=>p.pkg===pkg));
    } catch(error) { check('Valid Android plugin registry JSON', false, error.message); }
  }
  // The custom bridge is manually registered and isn't in capacitor.plugins.json.
  const javaDir=path.join(android,'app','src','main','java');
  function findActivity(dir){
    if(!fs.existsSync(dir))return null;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const location=path.join(dir,entry.name);
      if(entry.isDirectory()){const found=findActivity(location);if(found)return found;}
      else if(entry.name==='MainActivity.java')return location;
    }
    return null;
  }
  const main=findActivity(javaDir);
  check('Android MainActivity', Boolean(main));
  if(main){
    check('Custom document bridge registered', /registerPlugin\(FrameDocumentPlugin\.class\)/.test(fs.readFileSync(main,'utf8')));
    check('Custom document bridge installed', fs.existsSync(path.join(path.dirname(main),'FrameDocumentPlugin.java')));
  }
} else {
  console.log('INFO Native checks skipped. Run with --native after Android sync.');
}
console.log(failures ? `FAILED: ${failures} check(s)` : 'All requested checks passed. Device testing is still required.');
process.exitCode=failures ? 1 : 0;
