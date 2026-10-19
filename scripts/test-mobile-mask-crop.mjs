import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getMaskCropGeometry,clampMaskZoom,clampMaskPan} from '../packages/editor/src/maskCrop.mjs';

const eq=(actual,expected)=>assert.ok(Math.abs(actual-expected)<0.00001,`${actual} expected ${expected}`);
const square={x:10,y:20,w:100,h:100};
const landscape={type:'image',naturalWidth:400,naturalHeight:200,maskZoom:1,maskPanX:0,maskPanY:0};
let crop=getMaskCropGeometry(landscape,square);
eq(crop.w,200);eq(crop.h,100);eq(crop.x,-40);eq(crop.y,20);
assert.ok(crop.x<=square.x && crop.x+crop.w>=square.x+square.w);
assert.ok(crop.y<=square.y && crop.y+crop.h>=square.y+square.h);

for(const shape of [square,{x:320,y:0,w:180,h:130},{x:0,y:0,w:80,h:170}]){
  for(const ratio of [[400,200],[200,400],[120,120]]){
    for(const zoom of [1,1.3,2,4]){
      for(const panX of [-2,-1,0,.6,1,2]){
        for(const panY of [-2,-1,0,.4,1,2]){
          const photo={type:'image',naturalWidth:ratio[0],naturalHeight:ratio[1],maskZoom:zoom,maskPanX:panX,maskPanY:panY};
          const geo=getMaskCropGeometry(photo,shape);
          assert.ok(geo.x <= shape.x+1e-8,'image must cover left edge');
          assert.ok(geo.y <= shape.y+1e-8,'image must cover top edge');
          assert.ok(geo.x+geo.w >= shape.x+shape.w-1e-8,'image must cover right edge');
          assert.ok(geo.y+geo.h >= shape.y+shape.h-1e-8,'image must cover bottom edge');
        }
      }
    }
  }
}
const zoomed=getMaskCropGeometry({...landscape,maskZoom:2},square);
eq(zoomed.w,400);eq(zoomed.h,200);eq(zoomed.x,-140);eq(zoomed.y,-30);
const shifted=getMaskCropGeometry({...landscape,maskPanX:1},square);
eq(shifted.x,10);eq(shifted.x+shifted.w,210);
const shiftedOpposite=getMaskCropGeometry({...landscape,maskPanX:-1},square);
eq(shiftedOpposite.x,-90);eq(shiftedOpposite.x+shiftedOpposite.w,110);
assert.equal(clampMaskZoom('5'),4);assert.equal(clampMaskZoom('0.2'),1);assert.equal(clampMaskZoom(undefined),1);
assert.equal(clampMaskPan(-1.9),-1);assert.equal(clampMaskPan('0.7'),.7);
// Confirm each renderer and edit controls imports the same crop layout helper.
const source=readFileSync(new URL('../packages/editor/src/main.jsx',import.meta.url),'utf8');
assert.ok(source.includes('getMaskCropGeometry(l,mask,img.width,img.height)'), 'PNG rendering must use shared crop geometry');
assert.ok(source.includes('getMaskCropGeometry(layer,displayMask'), 'DOM rendering must use shared crop geometry');
assert.ok(source.includes('maskCropImage && maskCropShape && <div className="mobile-mask-crop-target"'), 'crop target must be visible');
assert.ok(source.includes('onAdjustMask={beginMaskCrop}'), 'inspector must expose crop mode');
console.log('08K: shape crop pan/zoom bounds, editor/export parity references and controls passed.');
