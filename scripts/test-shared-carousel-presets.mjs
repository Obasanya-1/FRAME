import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../packages/editor/src/main.jsx',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const beginning=source.indexOf('const builtInCarouselPresets = [');
const end=source.indexOf('];\nconst freshPresetProject',beginning);
assert(beginning!==-1 && end!==-1,'Shared built-in preset definition exists');
const definition=source.slice(beginning,end+2);
const presets=vm.runInNewContext(`(()=>{const defaultCanvasDesign=()=>({mode:'solid',secondary:'#bfddfa',angle:90,showGuides:true});${definition};return builtInCarouselPresets;})()`);
assert.equal(presets.length,13,'3 original plus 10 new presets');
assert.equal(new Set(presets.map(p=>p.id)).size,presets.length,'unique IDs');
for(const entry of presets){
  const {project}=entry;
  assert(entry.name?.length>2 && entry.description?.length>5,`metadata for ${entry.id}`);
  assert.equal(project.pages,3,`three slides for ${entry.name}`);
  assert.equal(project.orientation,'portrait');
  assert(/^#[\da-f]{6}$/i.test(project.bg));
  assert(project.layers.length>=6,`usable layout: ${entry.name}`);
  for(const layer of project.layers){
    assert(['shape','text'].includes(layer.type),`editable source layer in ${entry.name}`);
    for(const prop of ['x','y','w','h']) assert(Number.isFinite(layer[prop]),`${entry.name}: numeric ${prop}`);
    assert(layer.w>0 && layer.h>0,`${entry.name}: positive layer dimensions`);
    assert(layer.x>=0 && layer.y>=0 && layer.x+layer.w<=960 && layer.y+layer.h<=400,`${entry.name}: within 3-slide project`);
    if(layer.type==='text')assert(layer.text && layer.fontFamily && layer.fontSize>0,`${entry.name}: editable text`);
    if(layer.presetPhotoSlot)assert.equal(layer.type,'shape');
  }
}
for(const entry of presets.slice(3)){
  assert(entry.project.layers.some(l=>l.type==='text'),`${entry.name} needs typography`);
  assert(entry.project.layers.some(l=>l.type==='shape'),`${entry.name} needs design shapes`);
}
console.log(`PASS ${presets.length} shared desktop/mobile templates, ${presets.slice(3).length} new; editable layers and bounds verified`);
