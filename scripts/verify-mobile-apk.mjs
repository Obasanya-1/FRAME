// Inspect the actual APK Android will install. No third-party ZIP packages needed.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {checkMobileJs, stagedDir, entryJs, verifyStagedAssets} from './verify-mobile-android-assets.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apk = resolve(process.argv[2] || join(root,'apps','mobile','android','app','build','outputs','apk','debug','app-debug.apk'));
const hash = data => createHash('sha256').update(data).digest('hex');

export function extractApkEntry(bytes, wanted) {
  // Locate ZIP end-of-central-directory (may have a trailing comment).
  let eocd=-1;
  for(let pos=bytes.length-22;pos>=Math.max(0,bytes.length-65557);pos--){
    if(bytes.readUInt32LE(pos)===0x06054b50){eocd=pos;break;}
  }
  if(eocd<0)throw new Error('Not a readable APK/ZIP file');
  let offset=bytes.readUInt32LE(eocd+16);
  const entries=bytes.readUInt16LE(eocd+10);
  for(let i=0;i<entries;i++){
    if(bytes.readUInt32LE(offset)!==0x02014b50)throw new Error('Invalid APK central directory');
    const method=bytes.readUInt16LE(offset+10);
    const compressed=bytes.readUInt32LE(offset+20);
    const len=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32);
    const name=bytes.subarray(offset+46,offset+46+len).toString('utf8');
    if(name===wanted){
      const local=bytes.readUInt32LE(offset+42);
      if(bytes.readUInt32LE(local)!==0x04034b50)throw new Error('Invalid APK file header');
      const dataStart=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
      const compressedBytes=bytes.subarray(dataStart,dataStart+compressed);
      if(method===0)return compressedBytes;
      if(method===8)return inflateRawSync(compressedBytes);
      throw new Error(`Unsupported APK compression method ${method}`);
    }
    offset+=46+len+extra+comment;
  }
  throw new Error(`Missing ${wanted} in APK. Rebuild Android with current Mobile assets.`);
}

export function verifyMobileApk(apkPath=apk) {
  verifyStagedAssets();
  if(!existsSync(apkPath))throw new Error(`APK not found: ${apkPath}. Build the Android debug APK first.`);
  const bytes=readFileSync(apkPath);
  const stagedIndex=readFileSync(join(stagedDir,'index.html'));
  const apkIndex=extractApkEntry(bytes,'assets/public/index.html');
  if(hash(stagedIndex)!==hash(apkIndex))throw new Error('APK index.html is STALE compared to the Android staged assets. Rebuild the APK.');
  const stagedJsPath=entryJs(stagedDir);
  const name=stagedJsPath.split(/[\\/]/).pop();
  const apkJs=extractApkEntry(bytes,`assets/public/assets/${name}`);
  checkMobileJs(apkJs.toString('utf8'),'Final APK');
  if(hash(apkJs)!==hash(readFileSync(stagedJsPath)))throw new Error('APK JavaScript differs from Android staged assets. Rebuild the APK.');
  console.log(`FRAME Mobile APK verified: ${apkPath}`);
  console.log(`Mobile UI confirmed inside APK; SHA-256 ${hash(bytes).slice(0,16)}…`);
  return apkPath;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{verifyMobileApk();}catch(error){console.error(`FRAME Mobile APK verification FAILED: ${error.message}`);process.exitCode=1;}
}
