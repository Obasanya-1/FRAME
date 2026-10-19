// Install FRAME's local Android Save As bridge into the generated Capacitor project.
// Safe to rerun: copies the implementation and registers it once.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const android = path.join(root, 'android');
const source = path.join(root, 'native', 'FrameDocumentPlugin.java');
const javaRoot = path.join(android, 'app', 'src', 'main', 'java');
if (!fs.existsSync(javaRoot)) {
  console.error('Android project missing. Run `cd apps/mobile && npx cap add android` first.');
  process.exit(1);
}
function findMain(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { const result = findMain(file); if (result) return result; }
    else if (entry.name === 'MainActivity.java') return file;
  }
  return null;
}
const main = findMain(javaRoot);
if (!main) {
  console.error('MainActivity.java not found. Kotlin projects require manual registration.');
  process.exit(1);
}
let content = fs.readFileSync(main, 'utf8');
const pkg = content.match(/^package\s+([\w.]+)\s*;/m)?.[1];
if (!pkg) throw new Error('Could not read package declaration in MainActivity.java');
const pluginFile = path.join(path.dirname(main), 'FrameDocumentPlugin.java');
fs.writeFileSync(pluginFile, fs.readFileSync(source, 'utf8').replace(/^package app\.frame\.mobile;/m, `package ${pkg};`));
if (!content.includes('registerPlugin(FrameDocumentPlugin.class)')) {
  if (/void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)/.test(content)) {
    if (!content.includes('import android.os.Bundle;')) content=content.replace(/(package\s+[\w.]+\s*;)/, '$1\nimport android.os.Bundle;');
    content=content.replace(/(void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)\s*\{)/, '$1\n        registerPlugin(FrameDocumentPlugin.class);');
  } else {
    if (!content.includes('import android.os.Bundle;')) content=content.replace(/(package\s+[\w.]+\s*;)/, '$1\nimport android.os.Bundle;');
    content=content.replace(/(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/, '$1\n    @Override public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(FrameDocumentPlugin.class);\n        super.onCreate(savedInstanceState);\n    }');
    if (!content.includes('registerPlugin(FrameDocumentPlugin.class)')) throw new Error('Cannot identify MainActivity class for registration');
  }
  fs.writeFileSync(main, content);
}
console.log('FRAME Android Save As bridge installed in:', main);
