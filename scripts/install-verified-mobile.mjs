// One verified Android debug build + in-place install. Never uninstall project data.
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyMobileApk} from './verify-mobile-apk.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const android=join(root,'apps','mobile','android');
const isWin=process.platform==='win32';
const gradle=isWin?'gradlew.bat':'sh';
const args=isWin?['--no-daemon','assembleDebug']:['gradlew','--no-daemon','assembleDebug'];
function run(command,arguments_,cwd){
  console.log(`\n> ${command} ${arguments_.join(' ')}`);
  const result=spawnSync(command,arguments_,{cwd,stdio:'inherit',shell:isWin});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} failed (${result.status}). Fix the build before attempting installation.`);
}
function adbPath(){
  const roots=[process.env.ANDROID_SDK_ROOT,process.env.ANDROID_HOME,process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Android','Sdk'),process.env.HOME&&join(process.env.HOME,'Android','Sdk')].filter(Boolean);
  const executable=isWin?'adb.exe':'adb';
  return roots.map(sdk=>join(sdk,'platform-tools',executable)).find(existsSync) || executable;
}
try{
  // npm run cap:sync must already have built/verified/copied fresh Mobile assets.
  run(gradle,args,android);
  const apk=verifyMobileApk();
  run(adbPath(),['install','-r',apk],root);
  // Launch the specific installed FRAME Mobile package, not a similarly named older app.
  run(adbPath(),['shell','am','start','-n','app.frame.mobile/.MainActivity'],root);
  console.log('\nFRAME Mobile updated IN PLACE. Your Work app data has not been uninstalled.');
  console.log('Open FRAME on the phone and verify the Mobile Home screen and saved projects.');
}catch(error){console.error(`\nFRAME verified Android installation FAILED: ${error.message}`);process.exitCode=1;}
