import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveMaskedImageId,isMaskedImageTap} from '../packages/editor/src/maskTap.mjs';

const shape={id:'s',type:'shape',shape:'triangle',x:12,y:20,w:175,h:145};
const photo={id:'p',type:'image',maskShapeId:'s',x:500,y:0,w:85,h:50};
assert.equal(resolveMaskedImageId([shape,photo],shape),'p','tapping the filled shape selects the masked photo');
assert.equal(resolveMaskedImageId([shape,photo],photo),'p','tapping the photo selects the masked photo');
assert.equal(isMaskedImageTap({distance:2,moved:false,holdTriggered:false,gestureBlocked:false}),true);
assert.equal(isMaskedImageTap({distance:14,moved:true}),false,'drag moves pair instead');
assert.equal(isMaskedImageTap({distance:0,holdTriggered:true}),false,'long press opens context menu instead');
assert.equal(isMaskedImageTap({distance:0,gestureBlocked:true}),false,'pinch does not open inspector');

const editor=readFileSync(new URL('../packages/editor/src/main.jsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../apps/mobile/src/mobile.css',import.meta.url),'utf8');
const has=(value,why)=>assert.ok(editor.includes(value),why);
has('setSelected(maskedTapImageId||layer.id);','tap or drag must select the attached image, not a disconnected shape');
has('if(tappedMask){','single tap keeps the selection outline');
has('setMobileEditOpen(false);','masked tap must keep the inspector closed');
has('isMaskedImageTap({','distinguish tap from drag and long-press');
has('mobile-mask-selection-frame','masked photo has a visible selection frame');
has('mobile-mask-resize-handle','masked frame has resize handles');
has('onPointerDown={e=>startResize(e,mask,handle)}','all displayed resize handles must resize the actual mask shape');
has('const maskedImageId=IS_MOBILE && layer.type===\'shape\'?resolveMaskedImageId(layers,layer):null;','mask resizing must leave the image selected');
has('onPointerDown={startMaskCropDrag} onContextMenu={e=>e.preventDefault()}/>','photo crop mode keeps drag controls without an in-image text overlay');
assert.ok(!editor.includes('<span>Drag photo to reframe</span>'),'do not cover photo with instructional text');
assert.ok(css.includes('.mobile-mask-selection-frame .mobile-mask-resize-handle'),'visible handles must have touch-sized styling');
assert.ok(css.includes('pointer-events:auto;touch-action:none;'),'handles must receive touch and resize, not be decorative');
console.log('08P: tap selects masked image only, interactive shape frame, no in-photo text, unchanged gesture modes passed.');
