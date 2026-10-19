import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveMaskedImageId,isMaskedImageTap} from '../packages/editor/src/maskTap.mjs';

const layers=[
  {id:'shape-1',type:'shape'},
  {id:'img-1',type:'image',maskShapeId:'shape-1'},
  {id:'shape-2',type:'shape'},
  {id:'img-2',type:'image'},
  {id:'img-orphan',type:'image',maskShapeId:'missing'}
];
assert.equal(resolveMaskedImageId(layers,layers[0]),'img-1','tapping the shape should select its attached photo');
assert.equal(resolveMaskedImageId(layers,layers[1]),'img-1','tapping the photo should select itself');
assert.equal(resolveMaskedImageId(layers,layers[2]),null,'ordinary shape should still select normally');
assert.equal(resolveMaskedImageId(layers,layers[3]),null,'unmasked photo should still select normally');
assert.equal(resolveMaskedImageId(layers,layers[4]),null,'missing mask should not switch editors');
assert.equal(isMaskedImageTap({distance:0}),true);
assert.equal(isMaskedImageTap({distance:7.9,moved:false,holdTriggered:false,gestureBlocked:false}),true);
assert.equal(isMaskedImageTap({distance:8}),false,'drag threshold is not a tap');
assert.equal(isMaskedImageTap({distance:2,moved:true}),false,'movement blocks opening Edit');
assert.equal(isMaskedImageTap({distance:0,holdTriggered:true}),false,'long press opens menu');
assert.equal(isMaskedImageTap({distance:0,gestureBlocked:true}),false,'pinch must not open Edit');

const src=readFileSync(new URL('../packages/editor/src/main.jsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../apps/mobile/src/mobile.css',import.meta.url),'utf8');
const expect=(part,msg)=>assert.ok(src.includes(part),msg);
expect('const maskedTapImageId=IS_MOBILE?resolveMaskedImageId(layers,layer):null;', 'masked layers must be recognized during drag start');
expect('if(maskedTapImageId && !moved)return;', 'tap jitter should not reposition the pair');
expect('if(tappedMask){', 'tap release must leave the selection outline without opening controls');
expect('if(!IS_MOBILE || maskCropImageId===imageId)return;', 'duplicate crop entry should be ignored');
expect("if(maskedImageId){setSelected(maskedImageId);setMultiSelected([]);setPanel('edit');setMobileEditOpen(true);return;}", 'double tap should open image Edit');
expect('if(maskedTapImageId && !moved)checkpoint();', 'moving masked layers must remain undoable');
assert.match(css,/\.frame-mobile \.mobile-mask-crop-controls\s*\{\s*position:fixed;/,'crop toolbar must stay visible without scrolling');
assert.match(css,/bottom:calc\(78px \+ env\(safe-area-inset-bottom,0px\)\)/,'crop toolbar must clear bottom navigation');
console.log('08P: tap to select, safe drag/long-press gestures, fixed crop toolbar checks passed.');
