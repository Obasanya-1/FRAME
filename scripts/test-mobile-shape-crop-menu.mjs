import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../packages/editor/src/main.jsx',import.meta.url),'utf8');
const expect=(snippet,description)=>assert.ok(source.includes(snippet),description);

// Image and shape must both lead to a masked image, not only the image's own context.
expect("contextLayer?.type==='shape'",'shape must resolve its attached photo');
expect("layers.find(item=>item.type==='image' && item.maskShapeId===contextLayer.id)",'shape must find the attached image');
expect("contextLayer?.type==='image' && contextLayer.maskShapeId",'masked image must resolve directly');
expect("IS_MOBILE && contextMaskedImage && <button role=\"menuitem\" onClick={()=>beginMaskCrop(contextMaskedImage.id)}>",'long press must expose Adjust photo');
expect("IS_MOBILE && contextMaskedImage && <button role=\"menuitem\" onClick={()=>{detachImageFromShape(contextMaskedImage.id);setContextMenu(null)}}>",'long press must expose Detach for shape and image');

// On mobile, a masked photo cannot use ordinary image resize chrome. Its crop mode
// supplies the functioning boundary, drag/pinch target and controls instead.
expect("l.type==='image' && !!l.maskShapeId",'masked image must suppress ordinary image resize handles');
expect('mobile-mask-selection-frame','masked photo must use visible shape-based resize frame');
expect('onPointerDown={e=>startResize(e,mask,handle)}','resize handles must adjust actual mask bounds');
expect("if(IS_MOBILE && layer.type==='image' && layer.maskShapeId)return;",'a masked image must not be resized accidentally');
expect("maskCropImage && maskCropShape && <div className=\"mobile-mask-crop-target\"",'crop mode must still show its functional target');
expect("!(IS_MOBILE && chosen.maskShapeId)",'ineffective corner radius control must be hidden on masked photo');

// Studio still retains its normal selection and native context behavior.
expect("!IS_MOBILE && contextLayer?.maskShapeId && <button role=\"menuitem\"",'desktop detach action must be preserved');
console.log('08L: shape/photo long-press actions, mobile selection handles, and desktop compatibility checks passed.');
