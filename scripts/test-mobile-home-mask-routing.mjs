import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {needsShapeAwareHomeThumbnail} from '../apps/mobile/src/thumbnailShapeRouting.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=readFileSync(resolve(root,'apps/mobile/src/MobileMaskedThumbnail.jsx'),'utf8');
const project=layers=>({pages:2,layers});
const shape={id:'s',type:'shape',shape:'triangle',x:10,y:20,w:120,h:120,color:'#cafe00'};
const photo={id:'p',type:'image',maskShapeId:'s',x:2000,y:2200,w:220,h:180,src:'data:image/png;base64,abcd'};

// Regression: the old branch returned ProjectThumbnail for an unfilled
// triangle. That component renders ALL non-elliptical shapes as rounded boxes.
assert.equal(needsShapeAwareHomeThumbnail(project([shape])),true,
  'Unfilled triangle must never use ProjectThumbnail rounded-rectangle fallback');
for (const kind of ['triangle','diamond','star','ellipse']){
  assert.equal(needsShapeAwareHomeThumbnail(project([{...shape,shape:kind}])),true,
    `${kind} must route through accurate SVG outline`);
}
assert.equal(needsShapeAwareHomeThumbnail(project([{...shape,shape:'rounded'}])),false);
assert.equal(needsShapeAwareHomeThumbnail(project([{...shape,shape:'rectangle'}])),false);
assert.equal(needsShapeAwareHomeThumbnail(project([{...shape,shape:'rounded'},photo])),true,
  'Filled rectangle still needs image masking');
assert.equal(needsShapeAwareHomeThumbnail(project([photo])),false,
  'Dangling mask reference must not pretend the photo has a valid mask');
assert.equal(needsShapeAwareHomeThumbnail(project([{...shape,shape:'triangle'},photo])),true);
assert.equal(needsShapeAwareHomeThumbnail(project([{...shape,shape:'rounded'}])),false,
  'Shape changing to rounded should update renderer selection');
assert.equal(needsShapeAwareHomeThumbnail(project([{...shape,shape:'triangle'}])),true,
  'Shape changing back to triangle must update renderer selection');

// Confirm the routed renderer draws BOTH colored shape layers and photo masks
// with SVG silhouettes rather than border-radius / CSS clip-path fallbacks.
assert.match(file,/if\(!needsShapeAwareHomeThumbnail\(project\)\)return <ProjectThumbnail/);
assert.match(file,/layer\.type==='shape'\)return <ThumbnailShape/);
assert.match(file,/function ThumbnailShape\(/);
assert.match(file,/<polygon points=\{coordinates\.split/);
assert.match(file,/if\(mask\)return <MaskedThumbnailPhoto/);
assert.match(file,/<clipPath id=\{clipId\}/);
console.log('Mobile Home shape routing: 12 behavior and rendering checks passed.');
