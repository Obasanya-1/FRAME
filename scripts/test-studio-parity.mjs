// Dependency-free focused regressions for FRAME Mobile -> Studio parity 04.
// Visual editor/PNG comparisons still require desktop and Android testing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const main = fs.readFileSync(new URL('../packages/editor/src/main.jsx',import.meta.url),'utf8');
const file = name => {const content=fs.readFileSync(new URL(name,import.meta.url),'utf8');assert.ok(content.length>0);return content;};
const moduleFor = (pattern,setup={}) => {
  const match=main.match(pattern);
  assert.ok(match,'Expected shared editor implementation was not found');
  const sandbox={...setup};
  vm.createContext(sandbox);
  vm.runInContext(match[0],sandbox);
  return sandbox;
};

const context={
  mobileTextMetricsCache:new Map(),
  mobileTextMeasurementCanvas:null,
  document:{createElement(name){assert.equal(name,'canvas');return {getContext(){return {font:'16px Arial',measureText(value){const size=Number(this.font.match(/([\d.]+)px/)?.[1]||16);return {width:value.length*size*.53};}};}};}}
};
vm.createContext(context);
const textFunction=main.match(/function getSharedTextLayout\(layer\)\{[\s\S]*?\n\}/);
assert.ok(textFunction,'Shared text layout function is missing');
vm.runInContext(textFunction[0],context);
const makeText=extra=>({text:'A rather long headline',x:0,y:0,w:130,h:80,fontSize:38,fontFamily:'Inter',weight:700,...extra});
const fit=context.getSharedTextLayout(makeText({verticalAlign:'middle'}));
assert.ok(fit.fontSize>0 && fit.fontSize<38,'Long text should shrink to fit its box');
assert.ok(fit.top>=0 && fit.top+fit.lines.length*fit.lineHeight<=80,'Text should fit vertically');
const top=context.getSharedTextLayout(makeText({verticalAlign:'top'}));
const middle=context.getSharedTextLayout(makeText({verticalAlign:'middle'}));
const bottom=context.getSharedTextLayout(makeText({verticalAlign:'bottom'}));
assert.ok(top.top<=middle.top && middle.top<=bottom.top,'Vertical text alignment must be ordered');
assert.ok(main.includes('getSharedTextLayout(l)') && main.includes('getSharedTextLayout(layer)'), 'Export and DOM must share the text layout');

const project={layers:[
  {type:'shape',x:1,y:1,groupId:'same'},
  {type:'text',text:'T',x:0,y:0,groupId:'same'},
  {id:'mask',type:'shape',x:0,y:0},
  {type:'image',maskShapeId:'mask'}
]};
const presets={normalizeProject:raw=>structuredClone(raw),uid:(()=>{let id=0;return ()=>`new-${++id}`;})()};
vm.createContext(presets);
const presetFunc=main.match(/const freshPresetProject = raw => \{[\s\S]*?\n\};/);
assert.ok(presetFunc,'Preset importer not found');
vm.runInContext(presetFunc[0]+'\nthis.makeFresh=freshPresetProject;',presets);
const fresh=presets.makeFresh(project);
assert.equal(new Set(fresh.layers.map(layer=>layer.id)).size,4,'Every preset layer needs a unique ID');
assert.equal(fresh.layers[0].groupId,fresh.layers[1].groupId,'Group membership must survive cloning');
assert.equal(fresh.layers[3].maskShapeId,fresh.layers[2].id,'Image mask must resolve to new shape ID');

const electron=file('../apps/studio/electron.cjs');
const preload=file('../apps/studio/preload.cjs');
assert.ok(electron.includes("ipcMain.handle('project:library'") && preload.includes('getProjectLibrary:'),'Native .frame library API missing');
assert.ok(electron.includes('shell.trashItem(filePath)'),'Project deletion must use the Recycle Bin');
assert.ok(electron.includes('fs.copyFileSync(filePath,result.filePath)'),'Backups must remain separate from saves');
assert.ok(main.includes('const openPreview = async () =>'),'Studio Preview must be retained');
assert.ok(main.includes('setDesktopExportProgress'),'Desktop ZIP progress must remain available');
console.log('FRAME parity 04 regression checks passed (layout, presets, desktop IPC, Preview guard).');
