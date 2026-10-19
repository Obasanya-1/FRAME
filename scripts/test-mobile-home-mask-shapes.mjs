import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {getMaskCropGeometry} from '../packages/editor/src/maskCrop.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const component=readFileSync(resolve(root,'apps/mobile/src/MobileMaskedThumbnail.jsx'),'utf8');

// The Home renderer MUST clip the photo by its saved shape, not by the
// image's original rectangular bounds or its border-radius.
for(const token of [
  'function MaskedThumbnailPhoto(',
  "clipPathUnits=\"userSpaceOnUse\"",
  '<polygon points={points}/>',
  '<ellipse cx={width/2}',
  '<rect width={width} height={height}',
  'clipPath={`url(#${clipId})`}',
  'const crop=getMaskCropGeometry(image,mask);',
  'if(mask)return <MaskedThumbnailPhoto'
]) assert.ok(component.includes(token),`Expected shape-aware SVG markup: ${token}`);
assert.ok(!component.includes('left:crop.x-mask.x,top:crop.y-mask.y'),
  'Old nested HTML image path should no longer control masked photos');
for(const shape of ['triangle','diamond','star'])assert.ok(component.includes(shape+':'),`Missing ${shape} shape`);

const mask={id:'s1',type:'shape',shape:'triangle',x:30,y:50,w:120,h:160};
const photo={id:'i1',type:'image',maskShapeId:'s1',x:-1000,y:1500,w:500,h:250,
  naturalWidth:2400,naturalHeight:1200,maskZoom:1.75,maskPanX:0.45,maskPanY:-0.6};
const crop=getMaskCropGeometry(photo,mask);
assert.ok(crop.w>=mask.w && crop.h>=mask.h,'Image must fill the shape');
assert.ok(crop.x<=mask.x && crop.y<=mask.y,'Crop cannot leave empty margins');
assert.ok(crop.x+crop.w>=mask.x+mask.w && crop.y+crop.h>=mask.y+mask.h,
  'Crop must cover every edge of the mask');
assert.notEqual(crop.x,photo.x,'Thumbnail must use mask geometry, not old photo position');
console.log('Mobile Home shape thumbnail checks passed.');
