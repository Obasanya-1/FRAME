// Focused, dependency-free Studio parity 05 regression checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {layersAfterRemovingFinalSlide} from '../packages/editor/src/slideOperations.js';

const originalLayers = [
  {id:'cover',type:'text',x:20,w:100,y:10,h:40},
  {id:'previous',type:'image',x:480,w:230,y:0,h:400}, // visible on slides 2 AND 3
  {id:'last-only',type:'image',x:660,w:200,y:0,h:400},
  {id:'last-crop',type:'image',cropPage:2,x:500,w:400,y:0,h:400},
  {id:'earlier-crop',type:'image',cropPage:1,x:640,w:400,y:0,h:400},
  {id:'mask',type:'shape',x:550,w:80,y:0,h:100},
  {id:'masked',type:'image',x:700,w:90,y:0,h:90,maskShapeId:'mask'},
  {id:'last-mask',type:'shape',x:680,w:90,y:0,h:90},
  {id:'last-masked',type:'image',x:540,w:200,y:0,h:90,maskShapeId:'last-mask'}
];
const kept = layersAfterRemovingFinalSlide(originalLayers,3,320,1);
const ids=new Set(kept.map(l=>l.id));
for(const name of ['cover','previous','earlier-crop','mask','masked'])assert.ok(ids.has(name),`Keep previous-page content: ${name}`);
for(const name of ['last-only','last-crop','last-mask','last-masked'])assert.ok(!ids.has(name),`Remove last-page-only content: ${name}`);
assert.deepEqual(originalLayers[1],{id:'previous',type:'image',x:480,w:230,y:0,h:400},'Do not mutate originals');
assert.equal(kept.find(l=>l.id==='masked').maskShapeId,'mask','Keep existing mask references');
assert.equal(layersAfterRemovingFinalSlide(originalLayers,1,320,1).length,originalLayers.length,'Do not delete the only slide');

// Electron thumbnail generation must pick an image-bearing slide and downsample,
// rather than returning a text-only tile when images begin on slide 2.
const electron=fs.readFileSync(new URL('../apps/studio/electron.cjs',import.meta.url),'utf8');
const source=electron.match(/function projectThumbnailData\(project\) \{[\s\S]*?\n\}\s*(?=function getStudioLibrary\()/)?.[0];
assert.ok(source,'Home thumbnail generator not found');
const sandbox={Buffer,console,nativeImage:{
  createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:1800}),resize:({width})=>{
    assert.equal(width,256,'Large image must be downsampled');
    return {isEmpty:()=>false,toJPEG:()=>Buffer.from('tiny-preview')};
  }})}
};
vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.makePreview = projectThumbnailData;`,sandbox);
const originalSource='data:image/jpeg;base64,'+Buffer.from('large original image data').toString('base64');
const preview=sandbox.makePreview({pages:3,orientation:'portrait',bg:'#ffffff',layers:[
  {id:'cover',type:'text',x:10,y:10,w:100,h:40,text:'Cover'},
  {id:'image',type:'image',x:340,y:20,w:250,h:250,src:originalSource,z:3},
  {id:'caption',type:'text',x:350,y:280,w:120,h:30,text:'Photo caption',z:4}
]});
assert.equal(preview.previewPage,1,'Use first slide that contains photos');
const photo=preview.layers.find(layer=>layer.id==='image');
assert.equal(photo.type,'image','Retain successful image previews');
assert.equal(photo.src,'data:image/jpeg;base64,'+Buffer.from('tiny-preview').toString('base64'));
assert.equal(photo.x,19,'Place preview layers in slide-local coordinates');
assert.ok(preview.layers.some(layer=>layer.id==='caption'),'Keep captions on the image-bearing slide');
assert.ok(!JSON.stringify(preview).includes(originalSource),'Do not expose full-resolution images via thumbnail IPC');

const editor=fs.readFileSync(new URL('../packages/editor/src/main.jsx',import.meta.url),'utf8');
const styles=fs.readFileSync(new URL('../packages/editor/src/styles.css',import.meta.url),'utf8');
assert.match(editor,/layersAfterRemovingFinalSlide\(layers, pages, PAGE_W, GAP, PAGE_H\)/,'Last-slide deletion must call the tested helper with current layers');
assert.ok(editor.includes('onSelectStart={e=>e.preventDefault()}'),'Canvas selection must be suppressed');
assert.ok(styles.includes('.app textarea,.app [contenteditable]'),'Editable text must remain selectable');
assert.ok(editor.includes('const openPreview = async ()'),'Studio Instagram Preview must be untouched');
console.log('Parity 05: slide preservation, photo thumbnails, selection guards, and Preview checks passed.');
