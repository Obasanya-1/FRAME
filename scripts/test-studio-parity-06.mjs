import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {layersAfterRemovingFinalSlide, thumbnailPageForProject} from '../packages/editor/src/slideOperations.js';

// Deleting the final slide must not destroy neighboring slide content.
const layers = [
  {id:'cover-photo',type:'image',x:50,y:10,w:220,h:340,src:'data:image/jpeg;base64,abc'},
  {id:'crossing',type:'image',x:615,y:0,w:100,h:400,src:'data:image/jpeg;base64,abc'},
  {id:'only-final',type:'text',x:660,y:10,w:90,h:30,text:'Remove'},
  {id:'middle-fill',type:'image',x:550,y:0,w:450,h:400,cropPage:1},
  {id:'last-fill',type:'image',x:500,y:0,w:400,h:400,cropPage:2},
  {id:'mask',type:'shape',x:565,y:20,w:90,h:100},
  {id:'masked',type:'image',x:670,y:20,w:150,h:100,maskShapeId:'mask'}
];
const snapshot=JSON.stringify(layers);
const result=layersAfterRemovingFinalSlide(layers,3,320,1,400);
const keep=new Set(result.map(l=>l.id));
for(const id of ['cover-photo','crossing','middle-fill','mask','masked'])assert.ok(keep.has(id),`${id} was wrongly deleted`);
for(const id of ['only-final','last-fill'])assert.ok(!keep.has(id),`${id} should disappear with final slide`);
assert.equal(JSON.stringify(layers),snapshot,'Slide deletion mutated original data');
assert.equal(result.find(l=>l.id==='crossing').x,615,'Cross-slide image must not be repositioned');
assert.equal(thumbnailPageForProject(layers,3,320,1),0,'Cover photo gets a cover thumbnail');
assert.equal(thumbnailPageForProject(layers.filter(l=>l.id!=='cover-photo'),3,320,1),1,'Use image-bearing middle slide');
assert.equal(thumbnailPageForProject([{id:'text',type:'text',x:1,w:20}],3,320,1),0,'Text-only covers stay supported');

const electron=fs.readFileSync(new URL('../apps/studio/electron.cjs',import.meta.url),'utf8');
const fn=electron.match(/function projectThumbnailData\(project\) \{[\s\S]*?\n\}\s*(?=function getStudioLibrary\()/)?.[0];
assert.ok(fn,'Native Home preview function is missing');
const source='data:image/jpeg;base64,'+Buffer.from('photo-content').toString('base64');
const preview='data:image/jpeg;base64,'+Buffer.from('small-rendered-slide').toString('base64');
const sandbox={Buffer,console,nativeImage:{createFromDataURL:()=>{throw Error('decode failed')}}};
vm.createContext(sandbox);vm.runInContext(`${fn}\nthis.makeThumbnail=projectThumbnailData`,sandbox);
const stored=sandbox.makeThumbnail({pages:3,orientation:'portrait',studioThumbnail:preview,layers:[]});
assert.equal(stored.previewImage,preview,'Saved image preview must be used when present');
const old=sandbox.makeThumbnail({pages:2,orientation:'portrait',layers:[{id:'photo',type:'image',x:5,y:5,w:100,h:100,src:source}]});
assert.equal(old.layers[0].src,source,'Older projects must retain supported photo previews if Electron decoder fails');

const component=fs.readFileSync(new URL('../apps/mobile/src/ProjectThumbnail.jsx',import.meta.url),'utf8');
const editor=fs.readFileSync(new URL('../packages/editor/src/main.jsx',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../packages/editor/src/styles.css',import.meta.url),'utf8');
assert.ok(component.includes('frame-home-saved-preview'),'Home component must render the actual slide image');
assert.ok(editor.includes("thumb.toDataURL('image/jpeg'"),'Studio must generate a small slide preview when saving');
assert.ok(editor.includes("showMobileSaveFeedback('success',`Slide"),'Slide removal must visibly confirm the action');
assert.ok(editor.includes('onDragStart={e=>e.preventDefault()}'),'Native browser drag must be disabled on canvas');
assert.ok(styles.includes('.app:not(.frame-mobile) .workspace'),'Desktop selection fixes must not affect Mobile');
assert.ok(editor.includes('const openPreview = async ()'),'Studio Preview must remain');
assert.ok(!editor.includes('studio-build-marker'),'Studio Home should not display an internal build marker');
console.log('Parity 06: cross-slide deletion, photo thumbnails, saved previews, desktop text selection, and Preview retention passed.');
