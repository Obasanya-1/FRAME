// Dependency-free regression check: do not report a save until IndexedDB commits.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const pathToStore=path.resolve('apps/mobile/src/projectStore.js');
let complete, abort, requestDone;
const records=new Map();
globalThis.indexedDB={open(){
  const db={
    objectStoreNames:{contains(){return true;}},
    close(){},
    transaction(){
      const tx={error:null,oncomplete:null,onabort:null,onerror:null,objectStore(){return {
        put(record){return request(()=>{records.set(record.id,record);return record.id;});},
        get(id){return request(()=>records.get(id));},
        getAll(){return request(()=>[...records.values()]);},
        delete(id){return request(()=>{records.delete(id);return undefined;});}
      };}};
      complete=()=>tx.oncomplete?.();
      abort=()=>{tx.error=new Error('simulated abort');tx.onabort?.();};
      return tx;
    }
  };
  const openRequest={result:db};
  queueMicrotask(()=>openRequest.onsuccess?.());
  return openRequest;
}};
function request(work){
  const req={result:undefined};
  requestDone=()=>{req.result=work();req.onsuccess?.();};
  return req;
}
const {saveProjectRecord,getProject}=await import(pathToFileURL(pathToStore).href);
let settled=false;
const save=saveProjectRecord({id:'test',updatedAt:1,layers:[]}).then(()=>{settled=true;});
await new Promise(resolve=>setImmediate(resolve));
requestDone();
await Promise.resolve();
assert.equal(settled,false,'Save resolved before transaction committed');
complete();
await save;
assert.equal(settled,true);
let rejected=false;
const failure=saveProjectRecord({id:'test2',updatedAt:2,layers:[]}).catch(()=>{rejected=true;});
await new Promise(resolve=>setImmediate(resolve));
requestDone();
abort();
await failure;
assert.equal(rejected,true,'Transaction abort must reject the save');
const load=getProject('test');
await new Promise(resolve=>setImmediate(resolve));
requestDone();
complete();
assert.equal((await load).id,'test');
console.log('PASS IndexedDB commit, abort, and project retrieval tests');
