// Local, offline FRAME projects. IndexedDB supports large image-bearing project JSON.
const DB_NAME='frame-mobile-projects';
const STORE='projects';
function database(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
// A successful request is not the same as a committed transaction. Wait for
// oncomplete before reporting Saved to Your Work (or confirming deletion).
async function transaction(mode,fn){
  const db=await database();
  try {
    return await new Promise((resolve,reject)=>{
      let tx, result;
      try {
        tx=db.transaction(STORE,mode);
        const req=fn(tx.objectStore(STORE));
        req.onsuccess=()=>{result=req.result;};
        req.onerror=()=>reject(req.error||new Error('Project storage request failed'));
        tx.oncomplete=()=>resolve(result);
        tx.onerror=()=>reject(tx.error||new Error('Project storage transaction failed'));
        tx.onabort=()=>reject(tx.error||new Error('Project storage transaction aborted'));
      } catch(error){reject(error);}
    });
  } finally {db.close();}
}
export async function listProjects(){return (await transaction('readonly',store=>store.getAll())).sort((a,b)=>b.updatedAt-a.updatedAt);}
export async function getProject(id){return transaction('readonly',store=>store.get(id));}
export async function saveProjectRecord(record){return transaction('readwrite',store=>store.put(record));}
export async function deleteProjectRecord(id){return transaction('readwrite',store=>store.delete(id));}
