import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.resolve(import.meta.dirname, '..');
const studio = path.join(repo, 'apps', 'studio');
const rootScripts = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts;
const studioScripts = JSON.parse(fs.readFileSync(path.join(studio, 'package.json'), 'utf8')).scripts;
assert.match(rootScripts['package:win'], /@frame\/studio/);
assert.match(rootScripts['package:installer'], /@frame\/studio/);
assert.match(studioScripts['package:installer'], /--require-installer/);

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-installer-check-'));
  const app = path.join(base, 'apps', 'studio');
  const dist = path.join(base, 'mock-electron', 'dist');
  const mkdir = dir => fs.mkdirSync(dir, {recursive:true});
  const put = (rel,content='test') => {const p=path.join(base,rel);mkdir(path.dirname(p));fs.writeFileSync(p,content);};
  put('apps/studio/package.json', JSON.stringify({version:'1.0.0'}));
  put('apps/studio/electron.cjs');put('apps/studio/preload.cjs');
  put('apps/studio/dist/index.html');
  put('apps/studio/dist/assets/app.js');
  put('apps/studio/assets/frame.ico');
  put('apps/studio/installer/FRAME-Studio.iss');
  put('apps/studio/release/previous-release.txt', 'preserve this release');
  put('mock-electron/package.json', JSON.stringify({name:'electron'}));
  put('mock-electron/dist/electron.exe', 'electron');
  put('mock-electron/dist/d3dcompiler_47.dll', 'dll');
  put('mock-electron/dist/resources/default_app.asar');
  put('inno/ISCC.exe', 'compiler');
  return {base,app,dist};
}

class ExitCode extends Error {constructor(code){super(`exit(${code})`);this.code=code;}}
function simulate(script,fixture,{installer=false,makeSetup=true,missingElectron=false}={}) {
  const lines=[];
  const fakeProcess = {
    platform:'win32', execPath:process.execPath,
    argv:[process.execPath,script,...(installer?['--require-installer']:[])],
    env:{...process.env,ISCC_PATH:path.join(fixture.base,'inno','ISCC.exe')},
    exit:code=>{throw new ExitCode(code);}
  };
  const fakeRequire=id=>{
    if(id==='fs') return fs;
    if(id==='path') return path;
    if(id==='child_process') return {execFileSync:(cmd,args)=>{
      if(cmd==='powershell.exe') {
        const zip=path.join(fixture.app,'release','FRAME-Studio-v1.0.0.zip');
        fs.writeFileSync(zip,'fake archive for packaging flow test');
      } else if(cmd===process.execPath) {
        if(!makeSetup) throw Object.assign(new Error('Inno Setup missing'),{status:1});
        fs.writeFileSync(path.join(fixture.app,'release','FRAME-Studio-v1.0.0-Setup.exe'),'mock setup');
      } else if(cmd.endsWith('ISCC.exe')) {
        assert.equal(args[0],'/DMyAppVersion=1.0.0');
        assert.ok(args[1].endsWith('FRAME-Studio.iss'));
        if(makeSetup)fs.writeFileSync(path.join(fixture.app,'release','FRAME-Studio-v1.0.0-Setup.exe'),'mock setup');
        else throw Object.assign(new Error('ISCC failed'),{status:1});
      } else throw new Error('Unexpected command '+cmd);
    }};
    throw new Error('Unexpected dependency '+id);
  };
  fakeRequire.resolve=(id)=>{
    assert.equal(id,'electron/package.json');
    if(missingElectron) throw new Error('MODULE_NOT_FOUND');
    return path.join(fixture.base,'mock-electron','package.json');
  };
  let error=null;
  try {
    vm.runInNewContext(fs.readFileSync(script,'utf8'),{
      require:fakeRequire,__dirname:path.join(fixture.app,'scripts'),process:fakeProcess,
      console:{log:(...x)=>lines.push(x.join(' ')),warn:(...x)=>lines.push(x.join(' ')),error:(...x)=>lines.push(x.join(' '))},
      Buffer,
    },{filename:script,timeout:5000});
  } catch(e) {error=e;}
  return {lines:lines.join('\n'),error};
}

const packageScript=path.join(studio,'scripts','package-windows.cjs');
const installerScript=path.join(studio,'scripts','build-installer.cjs');
for(const mode of ['success','optional-no-inno','required-no-inno']){
  const f=fixture();
  try {
    const required=mode==='required-no-inno';
    const ok=mode==='success';
    const result=simulate(packageScript,f,{installer:required,makeSetup:ok});
    assert.equal(result.error instanceof ExitCode,required,`${mode}: ${result.error?.stack}`);
    if(required) assert.equal(result.error.code,1);
    assert.equal(fs.readFileSync(path.join(f.app,'release','previous-release.txt'),'utf8'),'preserve this release');
    assert.ok(fs.existsSync(path.join(f.app,'release','FRAME-Studio-portable','FRAME Studio.exe')));
    assert.ok(fs.existsSync(path.join(f.app,'release','FRAME-Studio-portable','resources','app','dist','index.html')));
    assert.ok(fs.existsSync(path.join(f.app,'release','FRAME-Studio-v1.0.0.frameupdate')));
    assert.equal(fs.existsSync(path.join(f.app,'release','FRAME-Studio-v1.0.0-Setup.exe')),ok);
    assert.equal(fs.existsSync(path.join(f.app,'release','FRAME-Studio-portable','resources','default_app.asar')),false);
    if(!ok)assert.match(result.lines,required?/build failed/:/was not built/);
  } finally {fs.rmSync(f.base,{recursive:true,force:true});}
}
{
 const f=fixture();
 try {
  // Verify the standalone Inno script receives the version define and generates setup.
  fs.mkdirSync(path.join(f.app,'release','FRAME-Studio-portable'),{recursive:true});
  fs.writeFileSync(path.join(f.app,'release','FRAME-Studio-portable','FRAME Studio.exe'),'portable app');
  const result=simulate(installerScript,f,{makeSetup:true});
  assert.equal(result.error,null);
  assert.ok(fs.existsSync(path.join(f.app,'release','FRAME-Studio-v1.0.0-Setup.exe')));
 } finally {fs.rmSync(f.base,{recursive:true,force:true});}
}
{
 const f=fixture();
 try {
  const result=simulate(packageScript,f,{missingElectron:true,installer:true});
  assert.equal(result.error?.code,1);
  assert.match(result.lines,/Electron is not installed/);
 } finally {fs.rmSync(f.base,{recursive:true,force:true});}
}
console.log('FRAME installer: workspace commands, portable package, update archive, strict installer errors, Inno invocation, and old release preservation passed.');
