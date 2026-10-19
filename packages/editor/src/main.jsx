import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import { createRoot } from 'react-dom/client';
import {
  ImagePlus, Type, Download, Plus, Minus, Trash2, Copy, Layers3,
  Undo2, Redo2, Move, Palette, Sparkles, Check, Save, FolderOpen,
  RectangleHorizontal, RectangleVertical, Shapes, Sun, Moon, Grid3X3, SlidersHorizontal, GripVertical, Settings
} from 'lucide-react';
import './styles.css';
import './mobile-crop-fix.css';
import { createZip } from './zip.js';
import { layersAfterRemovingFinalSlide, thumbnailPageForProject } from './slideOperations.js';
import { moveLayerInStack } from './layerOrdering.mjs';
import { findImageShapeDropTarget } from './shapeDropTarget.js';
import { studioFillVisibleBounds } from './studioImageHitbox.mjs';
import { getMaskCropGeometry, clampMaskZoom, clampMaskPan } from './maskCrop.mjs';
import { resolveMaskedImageId, isMaskedImageTap } from './maskTap.mjs';
import {Capacitor, registerPlugin} from '@capacitor/core';
const FrameDocument = registerPlugin('FrameDocument');
import {App as CapacitorApp} from '@capacitor/app';
import {listProjects, getProject, saveProjectRecord, deleteProjectRecord} from '../../../apps/mobile/src/projectStore.js';
import {ProjectThumbnail} from '../../../apps/mobile/src/ProjectThumbnail.jsx';
import {MobileMaskedThumbnail} from '../../../apps/mobile/src/MobileMaskedThumbnail.jsx';
const IS_MOBILE = import.meta.env.VITE_FRAME_TARGET === 'mobile';

// A bounded, preview-only decode. Export retains the original full-size photo.
// Android WebView can downsample while decoding with createImageBitmap, avoiding
// gigantic full-resolution Image objects for a small preview.
async function loadPreviewImage(src, width, height) {
  const maxSide=960;
  const ratio=Math.min(1,maxSide/Math.max(width||maxSide,height||maxSide));
  const targetWidth=Math.max(1,Math.round((width||maxSide)*ratio));
  const targetHeight=Math.max(1,Math.round((height||maxSide)*ratio));
  if(typeof createImageBitmap==='function'){
    try {
      const response=await fetch(src);
      if(!response.ok)throw new Error('Could not read preview photo');
      return await createImageBitmap(await response.blob(),{
        resizeWidth:targetWidth,resizeHeight:targetHeight,resizeQuality:'medium'
      });
    } catch(error) {
      // Some Android WebViews reject bitmap resize options; keep a fallback.
      console.warn('Preview image downsampling unavailable:',error);
    }
  }
  return loadImage(src);
}


// Browser Canvas and DOM use different text baselines. Measure the baseline
// from the same CSS line box as the editor to align the rendered first line.
const textBaselineCache=new Map();
function measureTextBaseline(size,family,weight){
  const key=`${size}|${family}|${weight}`;
  if(textBaselineCache.has(key))return textBaselineCache.get(key);
  const line=document.createElement('div');
  line.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;margin:0;padding:0;border:0;white-space:pre;';
  line.style.fontFamily=`"${family}", Arial, sans-serif`;
  line.style.fontSize=`${size}px`;
  line.style.fontWeight=String(weight);
  line.style.lineHeight='1.02';
  const marker=document.createElement('span');
  marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
  line.append(document.createTextNode('Ag'),marker);
  document.body.appendChild(line);
  const baseline=marker.getBoundingClientRect().top-line.getBoundingClientRect().top;
  line.remove();
  textBaselineCache.set(key,baseline);
  return baseline;
}

// 08H: Use one text layout calculation for BOTH mobile DOM layers and PNG export.
// The previous path clipped a fixed-size font into a smaller rectangle and
// positioned Canvas glyphs independently from the live HTML line box.
const mobileTextMetricsCache = new Map();
let mobileTextMeasurementCanvas = null;
function getSharedTextLayout(layer){
  const text=String(layer.text||'');
  const lines=text.split('\n');
  const width=Math.max(1,Number(layer.w)||1);
  const height=Math.max(1,Number(layer.h)||1);
  const requestedSize=Math.max(1,Number(layer.fontSize)||16);
  const fontFamily=layer.fontFamily||'Inter';
  const fontWeight=layer.weight||600;
  const verticalAlign=['top','middle','bottom'].includes(layer.verticalAlign) ? layer.verticalAlign : 'middle';
  const key=JSON.stringify([text,width,height,requestedSize,fontFamily,fontWeight,verticalAlign]);
  const cached=mobileTextMetricsCache.get(key);
  if(cached)return cached;
  if(!mobileTextMeasurementCanvas)mobileTextMeasurementCanvas=document.createElement('canvas');
  const ctx=mobileTextMeasurementCanvas.getContext('2d');
  let longest=1;
  if(ctx){
    ctx.font=`${fontWeight} ${requestedSize}px "${fontFamily}", Arial, sans-serif`;
    // The live DOM uses -.045em letter spacing; use the same width estimate.
    for(const line of lines){
      const widthOfLine=ctx.measureText(line).width - Math.max(0,line.length-1)*.045*requestedSize;
      longest=Math.max(longest,widthOfLine);
    }
  }else longest=Math.max(1,...lines.map(line=>line.length*requestedSize*.6));
  const edge=4;
  const totalHeight=Math.max(1,lines.length*requestedSize*1.02);
  const fit=Math.min(1,Math.max(0.01,(width-edge*2)/longest),Math.max(.01,(height-edge*2)/totalHeight));
  const fontSize=Math.max(1,requestedSize*fit);
  const lineHeight=fontSize*1.02;
  const blockHeight=lines.length*lineHeight;
  const top=verticalAlign==='top'?edge:verticalAlign==='bottom'?Math.max(edge,height-blockHeight-edge):Math.max(edge,(height-blockHeight)/2);
  const layout={lines,fontSize,lineHeight,top,edge,verticalAlign};
  if(mobileTextMetricsCache.size>240)mobileTextMetricsCache.clear();
  mobileTextMetricsCache.set(key,layout);
  return layout;
}

const PORTRAIT = { w: 320, h: 400, exportW: 1080, exportH: 1350, label: 'Portrait' };
const LANDSCAPE = { w: 400, h: 320, exportW: 1350, exportH: 1080, label: 'Landscape' };
const GAP = IS_MOBILE ? 0 : 1;
const FONT_OPTIONS = ['Inter','Lato','Noto Serif','Comfortaa','Caveat','Pacifico'];
const SHAPES = [
  {id:'rectangle',label:'Rectangle'}, {id:'rounded',label:'Rounded rectangle'},
  {id:'ellipse',label:'Ellipse'}, {id:'triangle',label:'Triangle'},
  {id:'diamond',label:'Diamond'}, {id:'star',label:'Star'}
];
const SHAPE_POINTS = {
  triangle: '50,0 100,100 0,100',
  diamond: '50,0 100,50 50,100 0,50',
  star: Array.from({length:10},(_,i)=>{
    const angle=-Math.PI/2+i*Math.PI/5, r=i%2===0?49:22;
    return `${50+Math.cos(angle)*r},${50+Math.sin(angle)*r}`;
  }).join(' ')
};
const shapeKind = layer => layer.shape || 'rounded';
const defaultCanvasDesign = () => ({mode:'solid',secondary:'#bfddfa',angle:90,showGuides:true});
const normalizeCanvasDesign = data => ({
  mode: data?.mode === 'gradient' ? 'gradient' : 'solid',
  secondary: /^#[0-9a-f]{6}$/i.test(data?.secondary || '') ? data.secondary : '#bfddfa',
  angle: Number.isFinite(Number(data?.angle)) ? ((Number(data.angle)%360)+360)%360 : 90,
  showGuides: data?.showGuides !== false
});
const canvasBackground = (bg,design) => design.mode === 'gradient'
  ? `linear-gradient(${design.angle}deg, ${bg}, ${design.secondary})` : bg;
const getAppPreference = (name, fallback) => {try{return localStorage.getItem(name)||fallback;}catch{return fallback;}};
const DEFAULT_CANVAS_SWATCHES = ['#f7f4ef','#ffffff','#111111','#eaf7ff','#f7e8ff','#fff0dc','#edf8e8','#ffd6e7'];
const DEFAULT_ACCENT_SWATCHES = ['#728bff','#24c6ad','#ee8bca','#ffad66','#8d7af6'];
const isHex = value => /^#[0-9a-f]{6}$/i.test(value);
const getSwatches = (key, defaults) => {
  try {const value=JSON.parse(localStorage.getItem(key));return Array.isArray(value) && value.length===defaults.length && value.every(isHex) ? value:defaults;}
  catch{return defaults;}
};


const uid = () => Math.random().toString(36).slice(2, 10);
const makeStarter = () => [
  {id: uid(), type:'text', x:40, y:44, w:260, h:84, text:'A WEEKEND\nIN MOTION', fontSize:34, color:'#111111', weight:800, align:'left', fontFamily:'Inter', z:2},
  {id: uid(), type:'shape', x:18, y:286, w:144, h:90, color:'#f0d9ff', radius:22, z:0},
  {id: uid(), type:'text', x:42, y:311, w:110, h:48, text:'03\nOCT', fontSize:17, color:'#111111', weight:700, align:'left', fontFamily:'Lato', z:3},
  {id: uid(), type:'shape', x:360, y:26, w:244, h:338, color:'#d6f2ff', radius:28, z:0},
  {id: uid(), type:'text', x:390, y:310, w:190, h:45, text:'Swipe to continue →', fontSize:16, color:'#111111', weight:600, align:'left', fontFamily:'Inter', z:4},
  {id: uid(), type:'shape', x:682, y:42, w:220, h:316, color:'#ffe2be', radius:28, z:0},
  {id: uid(), type:'text', x:710, y:74, w:166, h:160, text:'MAKE\nTHE\nMOMENT\nFLOW.', fontSize:28, color:'#111111', weight:800, align:'left', fontFamily:'Noto Serif', z:3},
];

function normalizeProject(data){
  const orientation = data?.orientation === 'landscape' ? 'landscape' : 'portrait';
  return {
    pages: Math.max(1, Math.min(20, Number(data?.pages) || 3)),
    // Repair duplicate/missing IDs in projects created by the original preset loader.
    // React keys and drag selection must identify one actual layer each.
    layers: (() => {
      const seen = new Set();
      return Array.isArray(data?.layers) ? data.layers.map(layer => {
        const id = typeof layer?.id === 'string' && layer.id && !seen.has(layer.id) ? layer.id : uid();
        seen.add(id);
        return layer?.type === 'text' ? {...layer, id, fontFamily: layer.fontFamily || 'Inter'} : {...layer, id};
      }) : [];
    })(),
    bg: typeof data?.bg === 'string' ? data.bg : '#f7f4ef',
    canvasDesign: normalizeCanvasDesign(data?.canvasDesign),
    orientation
  };
}

// Carousel presets store editable layouts, not duplicated full-resolution photo data.
const CAROUSEL_PRESET_KEY = 'frame-carousel-presets-v1';
const sanitizeCarouselPreset = raw => {
  const source=normalizeProject(raw);
  return {...source,layers:source.layers.map(layer=>{
    const {src,maskShapeId,cropPage,...rest}=layer;
    if(layer.type==='image') return {...rest,type:'shape',shape:'rounded',color:'#cbd5e1',radius:12,presetPhotoSlot:true};
    return rest;
  })};
};
const builtInCarouselPresets = [
  {id:'built-minimal',name:'Minimal Editorial',description:'Typography-led, warm neutrals',project:{pages:3,bg:'#f7f4ef',orientation:'portrait',canvasDesign:defaultCanvasDesign(),layers:[
    {type:'text',x:24,y:45,w:270,h:120,text:'LESS IS\nMORE.',fontSize:42,color:'#26211e',weight:800,fontFamily:'Inter',align:'left',z:2},
    {type:'shape',shape:'rectangle',x:24,y:262,w:272,h:3,color:'#26211e',z:1},
    {type:'text',x:24,y:280,w:270,h:40,text:'01 / YOUR STORY',fontSize:15,color:'#26211e',weight:600,fontFamily:'Lato',z:2},
    {type:'shape',shape:'rounded',x:345,y:24,w:272,h:248,color:'#ded4c8',radius:15,z:1,presetPhotoSlot:true},
    {type:'text',x:348,y:302,w:245,h:55,text:'YOUR MOMENT',fontSize:24,color:'#26211e',weight:700,fontFamily:'Noto Serif',z:2},
    {type:'text',x:668,y:64,w:262,h:115,text:'MAKE IT\nMEMORABLE.',fontSize:35,color:'#26211e',weight:700,fontFamily:'Inter',z:2},
    {type:'shape',shape:'rectangle',x:667,y:265,w:262,h:3,color:'#26211e',z:1},
    {type:'text',x:667,y:285,w:255,h:60,text:'SWIPE  /  SAVE  /  SHARE',fontSize:14,color:'#26211e',weight:600,fontFamily:'Lato',z:2},
  ]}},
  {id:'built-bold',name:'Bold Blocks',description:'High-contrast headlines and panels',project:{pages:3,bg:'#171923',orientation:'portrait',canvasDesign:defaultCanvasDesign(),layers:[
    {type:'shape',shape:'rectangle',x:18,y:18,w:284,h:360,color:'#f3cd53',z:1},
    {type:'text',x:40,y:75,w:237,h:170,text:'BIG\nIDEAS.',fontSize:55,color:'#171923',weight:800,fontFamily:'Inter',z:2},
    {type:'text',x:40,y:316,w:220,h:32,text:'START HERE →',fontSize:17,color:'#171923',weight:700,fontFamily:'Inter',z:2},
    {type:'shape',shape:'rounded',x:342,y:28,w:280,h:212,color:'#f3cd53',radius:16,z:1,presetPhotoSlot:true},
    {type:'text',x:342,y:268,w:270,h:95,text:'SHOW YOUR\nWORK.',fontSize:36,color:'#ffffff',weight:800,fontFamily:'Inter',z:2},
    {type:'shape',shape:'rectangle',x:659,y:24,w:283,h:352,color:'#f3cd53',z:1},
    {type:'text',x:678,y:118,w:250,h:160,text:'KEEP\nGOING →',fontSize:41,color:'#171923',weight:800,fontFamily:'Inter',z:2},
  ]}},
  {id:'built-gallery',name:'Photo Gallery',description:'Image slots with captions',project:{pages:3,bg:'#e9f3f2',orientation:'portrait',canvasDesign:defaultCanvasDesign(),layers:[
    {type:'shape',shape:'rounded',x:15,y:15,w:290,h:300,color:'#bfd5d0',radius:12,z:1,presetPhotoSlot:true},
    {type:'text',x:20,y:330,w:280,h:45,text:'A PLACE TO REMEMBER',fontSize:18,color:'#174b44',weight:700,fontFamily:'Lato',z:2},
    {type:'shape',shape:'rounded',x:336,y:16,w:290,h:300,color:'#bfd5d0',radius:12,z:1,presetPhotoSlot:true},
    {type:'text',x:344,y:331,w:270,h:48,text:'THE LITTLE DETAILS',fontSize:19,color:'#174b44',weight:700,fontFamily:'Lato',z:2},
    {type:'shape',shape:'rounded',x:657,y:16,w:290,h:300,color:'#bfd5d0',radius:12,z:1,presetPhotoSlot:true},
    {type:'text',x:665,y:331,w:270,h:48,text:'UNTIL NEXT TIME',fontSize:19,color:'#174b44',weight:700,fontFamily:'Lato',z:2},
  ]}},
  // Shared presets below are editable FRAME layers, not flattened artwork.
  {"id": "built-travel-diary", "name": "Travel Diary", "description": "Destination journal · photo-forward","project":{"pages":3,"bg":"#f5efe4","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"shape","shape":"rounded","x":0,"y":0,"w":320,"h":244,"color":"#b7c9bc","z":1,"radius":18,"presetPhotoSlot":true},
    {"type":"text","x":22,"y":266,"w":276,"h":34,"text":"THE GETAWAY","fontSize":27,"color":"#263c35","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":23,"y":320,"w":267,"h":36,"text":"A collection of little escapes","fontSize":14,"color":"#496258","weight":500,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":338,"y":18,"w":284,"h":348,"color":"#becabd","z":1,"radius":14,"presetPhotoSlot":true},
    {"type":"shape","shape":"rounded","x":353,"y":34,"w":74,"h":28,"color":"#f7f3e8","z":1,"radius":12},
    {"type":"text","x":359,"y":40,"w":62,"h":16,"text":"DAY 01","fontSize":11,"color":"#314a3e","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"text","x":654,"y":39,"w":274,"h":60,"text":"SLOW\nMORNINGS","fontSize":35,"color":"#2e453b","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":654,"y":154,"w":271,"h":190,"color":"#c1cdbf","z":1,"radius":16,"presetPhotoSlot":true},
    {"type":"text","x":655,"y":358,"w":258,"h":20,"text":"TAKE THE SCENIC ROUTE","fontSize":13,"color":"#496258","weight":700,"fontFamily":"Lato","align":"left","z":3}
  ]}},
  {"id": "built-product-launch", "name": "Product Spotlight", "description": "Launch carousel · benefit-led","project":{"pages":3,"bg":"#101825","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"shape","shape":"rounded","x":19,"y":27,"w":281,"h":346,"color":"#e3ecff","z":1,"radius":20},
    {"type":"text","x":40,"y":52,"w":232,"h":28,"text":"NEW ARRIVAL","fontSize":15,"color":"#4663a2","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"text","x":39,"y":105,"w":237,"h":112,"text":"MEET YOUR\nNEW FAVORITE","fontSize":35,"color":"#15213a","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"text","x":40,"y":303,"w":239,"h":31,"text":"SWIPE TO EXPLORE →","fontSize":13,"color":"#4663a2","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":341,"y":34,"w":278,"h":255,"color":"#91b8e3","z":1,"radius":18,"presetPhotoSlot":true},
    {"type":"text","x":341,"y":316,"w":266,"h":62,"text":"DESIGNED TO\nSTAND OUT","fontSize":25,"color":"#f8faff","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"text","x":667,"y":48,"w":264,"h":68,"text":"THE DETAILS","fontSize":34,"color":"#f5f7ff","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":662,"y":136,"w":277,"h":114,"color":"#273950","z":1,"radius":16},
    {"type":"text","x":681,"y":165,"w":245,"h":67,"text":"01  EASY TO USE\n02  BUILT TO LAST","fontSize":18,"color":"#f5f7ff","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":662,"y":287,"w":277,"h":65,"color":"#b8d4ff","z":1,"radius":14},
    {"type":"text","x":679,"y":304,"w":242,"h":29,"text":"MAKE IT YOURS","fontSize":19,"color":"#15213a","weight":700,"fontFamily":"Inter","align":"left","z":3}
  ]}},
  {"id": "built-portfolio", "name": "Creative Portfolio", "description": "Case study · showcase your work","project":{"pages":3,"bg":"#ebebe7","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"shape","shape":"rounded","x":14,"y":20,"w":292,"h":272,"color":"#c2c9c8","z":1,"radius":8,"presetPhotoSlot":true},
    {"type":"text","x":21,"y":309,"w":270,"h":44,"text":"SELECTED WORK","fontSize":32,"color":"#292d2d","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":22,"y":365,"w":264,"h":20,"text":"01 / INTRODUCTION","fontSize":12,"color":"#747e7c","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"text","x":344,"y":22,"w":258,"h":60,"text":"THE IDEA","fontSize":36,"color":"#292d2d","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":346,"y":90,"w":259,"h":63,"text":"Start with a clear concept.","fontSize":20,"color":"#57615f","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":338,"y":185,"w":279,"h":194,"color":"#b9c9c3","z":1,"radius":10,"presetPhotoSlot":true},
    {"type":"shape","shape":"rounded","x":657,"y":19,"w":289,"h":244,"color":"#aab6ac","z":1,"radius":12,"presetPhotoSlot":true},
    {"type":"text","x":663,"y":284,"w":266,"h":43,"text":"THE RESULT","fontSize":33,"color":"#292d2d","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":665,"y":343,"w":265,"h":28,"text":"YOUR NAME · 2026","fontSize":14,"color":"#6c7774","weight":700,"fontFamily":"Lato","align":"left","z":3}
  ]}},
  {"id": "built-food-journal", "name": "Food Journal", "description": "Recipe cards · cozy and inviting","project":{"pages":3,"bg":"#fff6e9","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"shape","shape":"rounded","x":15,"y":17,"w":289,"h":262,"color":"#efb88b","z":1,"radius":18,"presetPhotoSlot":true},
    {"type":"text","x":27,"y":296,"w":260,"h":41,"text":"GOOD FOOD.","fontSize":34,"color":"#563b2e","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":28,"y":353,"w":263,"h":24,"text":"MADE WITH LOVE","fontSize":14,"color":"#8a6049","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"text","x":344,"y":35,"w":262,"h":36,"text":"THE RECIPE","fontSize":29,"color":"#563b2e","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":341,"y":100,"w":271,"h":232,"color":"#f1d7b9","z":1,"radius":16},
    {"type":"text","x":358,"y":125,"w":240,"h":188,"text":"01   Fresh ingredients\n\n02   A little patience\n\n03   Share and enjoy","fontSize":17,"color":"#604433","weight":600,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":653,"y":20,"w":292,"h":259,"color":"#d7a77e","z":1,"radius":20,"presetPhotoSlot":true},
    {"type":"text","x":668,"y":304,"w":254,"h":39,"text":"SERVE & ENJOY","fontSize":30,"color":"#563b2e","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":666,"y":354,"w":254,"h":19,"text":"SAVE THIS FOR LATER","fontSize":13,"color":"#946851","weight":700,"fontFamily":"Lato","align":"left","z":3}
  ]}},
  {"id": "built-event-promo", "name": "Event Announcement", "description": "Bold date cards · tickets and details","project":{"pages":3,"bg":"#1c1730","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"shape","shape":"rounded","x":19,"y":22,"w":281,"h":356,"color":"#f5b7d3","z":1,"radius":16},
    {"type":"text","x":39,"y":45,"w":240,"h":40,"text":"SAVE THE DATE","fontSize":24,"color":"#342039","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"text","x":37,"y":115,"w":244,"h":137,"text":"THE\nBIG EVENT","fontSize":43,"color":"#342039","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"text","x":39,"y":320,"w":243,"h":24,"text":"OCT 24 · 7 PM","fontSize":17,"color":"#60465e","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"text","x":341,"y":31,"w":273,"h":55,"text":"WHAT TO\nEXPECT","fontSize":33,"color":"#ffffff","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":340,"y":140,"w":269,"h":211,"color":"#74578a","z":1,"radius":18,"presetPhotoSlot":true},
    {"type":"shape","shape":"rounded","x":657,"y":30,"w":283,"h":352,"color":"#e6a1c0","z":1,"radius":18},
    {"type":"text","x":681,"y":75,"w":230,"h":62,"text":"JOIN US","fontSize":42,"color":"#2d1c3c","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"text","x":679,"y":185,"w":228,"h":81,"text":"YOUR LOCATION\nYOUR DETAILS","fontSize":22,"color":"#543b52","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"text","x":680,"y":325,"w":226,"h":22,"text":"SEE YOU THERE →","fontSize":14,"color":"#543b52","weight":700,"fontFamily":"Inter","align":"left","z":3}
  ]}},
  {"id": "built-quote-series", "name": "Quote Collection", "description": "Typography-first · shareable thoughts","project":{"pages":3,"bg":"#f2f1ff","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"shape","shape":"rounded","x":18,"y":20,"w":284,"h":362,"color":"#dad5fd","z":1,"radius":20},
    {"type":"text","x":39,"y":74,"w":242,"h":195,"text":"\"MAKE SPACE\nFOR WHAT\nMATTERS.\"","fontSize":29,"color":"#342e68","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":40,"y":329,"w":238,"h":21,"text":"01 / REMEMBER THIS","fontSize":13,"color":"#625b9d","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":339,"y":20,"w":282,"h":360,"color":"#59528a","z":1,"radius":18},
    {"type":"text","x":364,"y":87,"w":230,"h":177,"text":"\"LESS NOISE.\nMORE\nMEANING.\"","fontSize":31,"color":"#ffffff","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":365,"y":329,"w":226,"h":23,"text":"02 / FIND YOUR FOCUS","fontSize":13,"color":"#ddd7ff","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":659,"y":20,"w":282,"h":361,"color":"#e2dcef","z":1,"radius":18},
    {"type":"text","x":685,"y":87,"w":234,"h":180,"text":"\"BEGIN\nAGAIN,\nANYTIME.\"","fontSize":32,"color":"#3d355d","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":687,"y":329,"w":235,"h":22,"text":"03 / KEEP GROWING","fontSize":13,"color":"#70668f","weight":700,"fontFamily":"Lato","align":"left","z":3}
  ]}},
  {"id": "built-fitness-guide", "name": "Fitness Routine", "description": "Workout guide · step by step","project":{"pages":3,"bg":"#ecf3ef","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"shape","shape":"rounded","x":16,"y":16,"w":289,"h":367,"color":"#d1e8d8","z":1,"radius":15},
    {"type":"text","x":36,"y":42,"w":251,"h":77,"text":"MOVE\nWITH PURPOSE","fontSize":33,"color":"#214c3b","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":37,"y":168,"w":249,"h":150,"color":"#96beab","z":1,"radius":16,"presetPhotoSlot":true},
    {"type":"text","x":38,"y":340,"w":245,"h":23,"text":"YOUR WEEKLY RESET","fontSize":14,"color":"#30664e","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"text","x":349,"y":30,"w":250,"h":48,"text":"THE ROUTINE","fontSize":30,"color":"#214c3b","weight":700,"fontFamily":"Inter","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":340,"y":104,"w":278,"h":244,"color":"#f7fbf8","z":1,"radius":14},
    {"type":"text","x":359,"y":131,"w":240,"h":195,"text":"01    WARM UP\n\n02    BUILD STRENGTH\n\n03    RECOVER WELL","fontSize":18,"color":"#315b48","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":655,"y":21,"w":290,"h":244,"color":"#a5cdb4","z":1,"radius":18,"presetPhotoSlot":true},
    {"type":"text","x":675,"y":285,"w":254,"h":69,"text":"PROGRESS\nOVER PERFECT","fontSize":26,"color":"#214c3b","weight":700,"fontFamily":"Inter","align":"left","z":3}
  ]}},
  {"id": "built-property-tour", "name": "Property Tour", "description": "Listing highlights · room gallery","project":{"pages":3,"bg":"#f6f5f1","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"shape","shape":"rounded","x":12,"y":15,"w":296,"h":277,"color":"#cbd2cf","z":1,"radius":10,"presetPhotoSlot":true},
    {"type":"text","x":23,"y":315,"w":260,"h":38,"text":"A PLACE TO CALL HOME","fontSize":23,"color":"#364542","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":23,"y":357,"w":264,"h":20,"text":"LOCATION · NEW LISTING","fontSize":13,"color":"#687671","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"text","x":346,"y":32,"w":260,"h":39,"text":"STEP INSIDE","fontSize":30,"color":"#364542","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":340,"y":95,"w":274,"h":246,"color":"#b5c4c0","z":1,"radius":12,"presetPhotoSlot":true},
    {"type":"text","x":343,"y":354,"w":257,"h":25,"text":"SPACE TO BREATHE","fontSize":17,"color":"#687671","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":654,"y":19,"w":293,"h":264,"color":"#cbd7d3","z":1,"radius":12,"presetPhotoSlot":true},
    {"type":"text","x":670,"y":310,"w":257,"h":41,"text":"THE DETAILS","fontSize":30,"color":"#364542","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":671,"y":360,"w":245,"h":19,"text":"SCHEDULE A VISIT →","fontSize":13,"color":"#687671","weight":700,"fontFamily":"Lato","align":"left","z":3}
  ]}},
  {"id": "built-moodboard", "name": "Moodboard", "description": "Color story · editorial inspiration","project":{"pages":3,"bg":"#f5edf0","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"text","x":20,"y":18,"w":280,"h":36,"text":"THE MOOD","fontSize":31,"color":"#594354","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":17,"y":75,"w":132,"h":266,"color":"#dc9fb5","z":1,"radius":10,"presetPhotoSlot":true},
    {"type":"shape","shape":"rounded","x":163,"y":75,"w":137,"h":123,"color":"#a9859f","z":1,"radius":10,"presetPhotoSlot":true},
    {"type":"shape","shape":"rounded","x":163,"y":212,"w":137,"h":129,"color":"#e8c7d3","z":1,"radius":10,"presetPhotoSlot":true},
    {"type":"text","x":19,"y":353,"w":271,"h":22,"text":"COLOR / TEXTURE / FEELING","fontSize":12,"color":"#8f657e","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":341,"y":17,"w":278,"h":263,"color":"#b28c9e","z":1,"radius":11,"presetPhotoSlot":true},
    {"type":"text","x":345,"y":305,"w":260,"h":48,"text":"SOFT & BOLD","fontSize":32,"color":"#594354","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"text","x":668,"y":27,"w":258,"h":47,"text":"THE PALETTE","fontSize":29,"color":"#594354","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":664,"y":111,"w":83,"h":208,"color":"#ba819b","z":1,"radius":13},
    {"type":"shape","shape":"rounded","x":752,"y":111,"w":83,"h":208,"color":"#e4bfd1","z":1,"radius":13},
    {"type":"shape","shape":"rounded","x":840,"y":111,"w":83,"h":208,"color":"#785b78","z":1,"radius":13},
    {"type":"text","x":667,"y":338,"w":256,"h":22,"text":"MAKE IT YOUR OWN","fontSize":13,"color":"#8f657e","weight":700,"fontFamily":"Lato","align":"left","z":3}
  ]}},
  {"id": "built-before-after", "name": "Before & After", "description": "Transformation story · side by side","project":{"pages":3,"bg":"#f0f1ef","orientation":"portrait","canvasDesign":defaultCanvasDesign(),"layers":[
    {"type":"text","x":17,"y":23,"w":275,"h":45,"text":"THE START","fontSize":32,"color":"#303c35","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":15,"y":86,"w":290,"h":262,"color":"#bfc7bf","z":1,"radius":14,"presetPhotoSlot":true},
    {"type":"text","x":18,"y":357,"w":277,"h":20,"text":"01 / BEFORE","fontSize":13,"color":"#627168","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"text","x":338,"y":23,"w":274,"h":45,"text":"THE CHANGE","fontSize":32,"color":"#303c35","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":336,"y":86,"w":290,"h":262,"color":"#9eae9e","z":1,"radius":14,"presetPhotoSlot":true},
    {"type":"text","x":339,"y":357,"w":276,"h":20,"text":"02 / IN PROGRESS","fontSize":13,"color":"#627168","weight":700,"fontFamily":"Lato","align":"left","z":3},
    {"type":"text","x":658,"y":23,"w":274,"h":45,"text":"THE RESULT","fontSize":32,"color":"#303c35","weight":700,"fontFamily":"Noto Serif","align":"left","z":3},
    {"type":"shape","shape":"rounded","x":655,"y":86,"w":290,"h":262,"color":"#8aab98","z":1,"radius":14,"presetPhotoSlot":true},
    {"type":"text","x":660,"y":357,"w":273,"h":20,"text":"03 / AFTER","fontSize":13,"color":"#627168","weight":700,"fontFamily":"Lato","align":"left","z":3}
  ]}},
];
const freshPresetProject = raw => {
  const project=normalizeProject(raw);
  // Each layer gets a fresh ID even if a built-in template omitted IDs.
  // Do not key generation by layer.id: undefined IDs used to collapse every
  // built-in template object into one selectable/draggable object.
  const newIds=project.layers.map(()=>uid());
  const oldToNew=new Map();
  project.layers.forEach((layer,index)=>{if(layer.id && !oldToNew.has(layer.id))oldToNew.set(layer.id,newIds[index]);});
  const groups=new Map();
  return {...project,layers:project.layers.map((layer,index)=>{
    const group=layer.groupId;
    if(group && !groups.has(group))groups.set(group,uid());
    return {...layer,id:newIds[index],groupId:group?groups.get(group):null,maskShapeId:layer.maskShapeId?oldToNew.get(layer.maskShapeId)||null:null};
  })};
};

function App(){
  // Web fonts can finish loading after the first mobile render. Re-measure
  // both DOM text and PNG baselines when that happens.
  const [,refreshMobileFonts] = useState(0);
  useEffect(()=>{
    if(!document.fonts?.addEventListener)return;
    const onFontsLoaded=()=>{
      mobileTextMetricsCache.clear();
      textBaselineCache.clear();
      refreshMobileFonts(n=>n+1);
    };
    document.fonts.addEventListener('loadingdone',onFontsLoaded);
    return ()=>document.fonts.removeEventListener('loadingdone',onFontsLoaded);
  },[]);
  const [pages,setPages] = useState(3);
  const [layers,setLayers] = useState(makeStarter);
  const [projectGeneration,setProjectGeneration] = useState(0);
  const activeCanvasGestureRef = useRef(null);
  const [editorReady,setEditorReady] = useState(false);
  const [contextMenu,setContextMenu] = useState(null);
  const mobileContextMenuRef=useRef(null);
  // Measure the REAL long-press menu (its actions vary by layer) and keep it
  // inside the phone viewport instead of guessing that every menu is 196px high.
  useLayoutEffect(()=>{
    if(!IS_MOBILE || !contextMenu || !mobileContextMenuRef.current)return;
    const node=mobileContextMenuRef.current;
    const viewport=window.visualViewport;
    const width=viewport?.width||window.innerWidth;
    const height=viewport?.height||window.innerHeight;
    const bounds=node.getBoundingClientRect();
    const left=Math.max(8,Math.min(contextMenu.x,width-bounds.width-8));
    const top=Math.max(8,Math.min(contextMenu.y,height-bounds.height-84));
    node.style.left=`${left}px`;
    node.style.top=`${top}px`;
  },[contextMenu]);
  const [dropShapeId,setDropShapeId] = useState(null);
  const [maskCropImageId,setMaskCropImageId] = useState(null);
  const maskCropPinchRef=useRef(null);
  const [dropShapeArmed,setDropShapeArmed] = useState(false);
  const [selected,setSelected] = useState(null);
  const [multiSelected,setMultiSelected] = useState([]);
  const [mobileMultiMode,setMobileMultiMode] = useState(false);
  const mobileTouchPoints = useRef(new Map());
  const mobilePendingScroll = useRef(null);
  const mobilePinch = useRef(null);
  const mobileCanvasPan = useRef(null);
  const mobileBlockDrag = useRef(false);
  const [bg,setBg] = useState('#f7f4ef');
  const [canvasDesign,setCanvasDesign] = useState(defaultCanvasDesign);
  const [appTheme,setAppTheme] = useState(()=>getAppPreference('frame-theme','dark'));
  const [accent,setAccent] = useState(()=>getAppPreference('frame-accent','#728bff'));
  const [accentSwatches,setAccentSwatches] = useState(()=>getSwatches('frame-accent-swatches', DEFAULT_ACCENT_SWATCHES));
  const [canvasSwatches,setCanvasSwatches] = useState(()=>getSwatches('frame-canvas-swatches', DEFAULT_CANVAS_SWATCHES));
  const [textSwatches,setTextSwatches] = useState(()=>getSwatches('frame-text-swatches', DEFAULT_CANVAS_SWATCHES));
  const [gradientButtons,setGradientButtons] = useState(()=>getAppPreference('frame-gradient-buttons','false')==='true');
  const [brandPrimary,setBrandPrimary] = useState(()=>getAppPreference('frame-brand-primary','#8b77f5'));
  const [toolbarColor,setToolbarColor] = useState(()=>getAppPreference('frame-toolbar-color','#a7a6b8'));
  const [logoGradientEnd,setLogoGradientEnd] = useState(()=>getAppPreference('frame-logo-gradient-end','#d18bff'));
  const [exportGradientEnd,setExportGradientEnd] = useState(()=>getAppPreference('frame-export-gradient-end','#aa76ec'));
  const [logoGradientAngle,setLogoGradientAngle] = useState(()=>Number(getAppPreference('frame-logo-gradient-angle','135')));
  const [exportGradientAngle,setExportGradientAngle] = useState(()=>Number(getAppPreference('frame-export-gradient-angle','120')));
  const [orientation,setOrientation] = useState('portrait');
  const [zoom,setZoom] = useState(.88);
  const zoomIn = () => setZoom(z => Math.min(1.35, Math.round((z + .1) * 100) / 100));
  const [panel,setPanel] = useState('edit');
  const [gradientSwatches,setGradientSwatches] = useState(()=>{try{return JSON.parse(localStorage.getItem('frame-gradient-swatches')||'[]')}catch{return []}});
  const [themeNotice,setThemeNotice] = useState('');
  const [themeNames,setThemeNames] = useState({canvas:'',app:''});
  const [themeLibrary,setThemeLibrary] = useState(()=>{try{return JSON.parse(localStorage.getItem('frame-saved-themes')||'{"canvas":[],"app":[]}')}catch{return {canvas:[],app:[]}};});
  const [shapePickerOpen,setShapePickerOpen] = useState(false);
  const [textPickerOpen,setTextPickerOpen] = useState(false);
  const [photoPickerOpen,setPhotoPickerOpen] = useState(false);
  const photoPickerInputRef = useRef(null);
  const [history,setHistory] = useState([]);
  const [future,setFuture] = useState([]);
  const [projectName,setProjectName] = useState('Untitled.frame');
  const [mobileProjectId,setMobileProjectId] = useState(null);
  const [mobileHome,setMobileHome] = useState(IS_MOBILE);
  const [studioHome,setStudioHome] = useState(!IS_MOBILE);
  const [studioWorks,setStudioWorks] = useState([]);
  const [studioTab,setStudioTab] = useState('work');
  const [studioNewDialog,setStudioNewDialog] = useState(false);
  const [studioNewName,setStudioNewName] = useState('');
  const [studioNewTemplate,setStudioNewTemplate] = useState(null);
  const [studioHomeNotice,setStudioHomeNotice] = useState('');
  const [studioLibraryBusy,setStudioLibraryBusy] = useState(false);
  const [mobileWorks,setMobileWorks] = useState([]);
  const [mobileHomeTab,setMobileHomeTab] = useState('work');
  const [mobileSettingsOpen,setMobileSettingsOpen] = useState(false);
  const [mobileNewDialog,setMobileNewDialog] = useState(false);
  const [mobileNewName,setMobileNewName] = useState('');
  const [mobileHomeNotice,setMobileHomeNotice] = useState('');
  const [mobileExitHint,setMobileExitHint] = useState(false);
  const mobileLastBackRef = useRef(0);
  const mobileExitHintTimerRef = useRef(null);
  const [mobileEditOpen,setMobileEditOpen] = useState(false);
  const [mobileEditPosition,setMobileEditPosition] = useState(null);
  const [renaming,setRenaming] = useState(false);
  const [nameDraft,setNameDraft] = useState('');
  const [presetsOpen,setPresetsOpen] = useState(false);
  const [presetName,setPresetName] = useState('');
  const [presetNotice,setPresetNotice] = useState('');
  const [presetPending,setPresetPending] = useState(null);
  const [customCarouselPresets,setCustomCarouselPresets] = useState(()=>{
    try{
      const found=JSON.parse(localStorage.getItem(CAROUSEL_PRESET_KEY)||'[]');
      return Array.isArray(found)?found.filter(item=>item && typeof item.name==='string' && item.project && Array.isArray(item.project.layers)):[];
    }catch{return []}
  });
  const [projectsOpen,setProjectsOpen] = useState(false);
  const [recentProjects,setRecentProjects] = useState([]);
  const [projectError,setProjectError] = useState('');
  const [confirmRemoveSlide,setConfirmRemoveSlide] = useState(false);
  const [skipSlideWarning,setSkipSlideWarning] = useState(false);
  const [skipSlideWarningDraft,setSkipSlideWarningDraft] = useState(false);
  const [railWidth,setRailWidth] = useState(78);
  const [inspectorWidth,setInspectorWidth] = useState(280);
  const [zoomEditing,setZoomEditing] = useState(false);
  const [zoomDraft,setZoomDraft] = useState('100');
  const [saveState,setSaveState] = useState('Saved');
  const [mobileSaveFeedback,setMobileSaveFeedback] = useState(null);
  const [mobileSaving,setMobileSaving] = useState(false);
  const mobileSaveFeedbackTimer = useRef(null);
  const mobileSavingRef = useRef(false);
  useEffect(()=>()=>clearTimeout(mobileSaveFeedbackTimer.current),[]);
  const showMobileSaveFeedback = (kind,message) => {
    clearTimeout(mobileSaveFeedbackTimer.current);
    setMobileSaveFeedback({kind,message});
    mobileSaveFeedbackTimer.current=setTimeout(()=>setMobileSaveFeedback(null),kind==='error'?5500:2500);
  };
  const [autosaveEnabled,setAutosaveEnabled] = useState(()=>getAppPreference('frame-autosave-enabled','true')==='true');
  const [exporting,setExporting] = useState(false);
  const [desktopExportProgress,setDesktopExportProgress] = useState(null);
  const desktopExportCancelRef=useRef(false);
  const [mobileExportProgress,setMobileExportProgress] = useState(null);
  const mobileExportCancelRef = useRef(false);
  // Review the actual export PNGs, not a separately rendered low-quality preview.
  const [exportReview,setExportReview] = useState([]);
  const [instantReviewOpen,setInstantReviewOpen] = useState(false);
  const [exportReviewIndex,setExportReviewIndex] = useState(0);
  const liveReviewViewportRef = useRef(null);
  const [liveReviewViewportWidth,setLiveReviewViewportWidth] = useState(0);
  // Measure the available review area, not the entire window. The slide and
  // all its DOM layers must use the exact SAME scale or the artwork shrinks
  // inside a white frame and text appears to be clipped at false boundaries.
  useLayoutEffect(()=>{
    if(!IS_MOBILE || !instantReviewOpen)return;
    const node=liveReviewViewportRef.current;
    if(!node)return;
    const update=()=>setLiveReviewViewportWidth(Math.max(0,node.clientWidth));
    update();
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(update):null;
    observer?.observe(node);
    window.addEventListener('resize',update);
    return ()=>{observer?.disconnect();window.removeEventListener('resize',update);};
  },[instantReviewOpen]);
  const [exportReviewAction,setExportReviewAction] = useState(null);
  const exportReviewBlobsRef = useRef([]);
  const exportReviewBusyRef = useRef(false);
  const exportReviewGenerationRef = useRef(0);
  const disposeExportReview = () => {
    exportReviewGenerationRef.current++;
    setExportReview([]);
    setInstantReviewOpen(false);
    setExportReviewIndex(0);
    exportReviewBlobsRef.current.forEach(item=>URL.revokeObjectURL(item.url));
    exportReviewBlobsRef.current=[];
  };
  useEffect(()=>()=>{exportReviewBlobsRef.current.forEach(item=>URL.revokeObjectURL(item.url));},[]);
  const [previewOpen,setPreviewOpen] = useState(false);
  const [previewIndex,setPreviewIndex] = useState(0);
  const [previewSlides,setPreviewSlides] = useState([]);
  const [previewBusy,setPreviewBusy] = useState(false);
  const [previewError,setPreviewError] = useState('');
  const previewUrlsRef = useRef([]);
  // Reuse decoded photos when revisiting a preview instead of decoding again.
  // Bound the cache so mobile RAM does not grow with a large photo library.
  const mobilePreviewImagesRef = useRef(new Map());
  mobilePreviewImagesRef.current.preview=true;
  const [mobilePreviewRefresh,setMobilePreviewRefresh] = useState(0);
  const previewGenerationRef = useRef(0);
  const hydrated = useRef(false);
  const autosaveTimer = useRef(null);
  const stageRef = useRef(null);
  const stageScrollerRef = useRef(null);
  const shapePickerRef = useRef(null);
  const shapeButtonRef = useRef(null);
  const textPickerRef = useRef(null);
  const photoPickerRef = useRef(null);
  // Internal object clipboard: keeps image data and geometry intact without changing the OS text clipboard.
  const layerClipboardRef = useRef(null);
  const cursorOnCanvasRef = useRef(null);

  const dims = orientation === 'landscape' ? LANDSCAPE : PORTRAIT;
  const PAGE_W = dims.w;
  const PAGE_H = dims.h;
  const canvasW = pages * PAGE_W + (pages-1)*GAP;
  // Fit the slide to its review viewport while keeping the native PAGE_W/H
  // geometry. Both the outer frame and the inner artwork use this scale.
  const liveReviewScale = Math.max(0.01,Math.min(
    (liveReviewViewportWidth || Math.max(1,window.innerWidth-116)) / PAGE_W,
    Math.max(1,window.innerHeight*0.59) / PAGE_H
  ));
  const chosen = layers.find(l=>l.id===selected);
  // Long-press on either a filled shape or its photo reaches the same crop actions.
  // Resolve this from the current document, not a stale context-menu selection.
  const contextLayer=contextMenu?layers.find(item=>item.id===contextMenu.id):null;
  const contextMaskedImage=contextLayer?.type==='image' && contextLayer.maskShapeId
    ? (layers.some(item=>item.type==='shape' && item.id===contextLayer.maskShapeId)?contextLayer:null)
    : contextLayer?.type==='shape'
      ? layers.find(item=>item.type==='image' && item.maskShapeId===contextLayer.id)
      : null;
  const maskCropImage=IS_MOBILE?layers.find(item=>item.id===maskCropImageId && item.type==='image' && item.maskShapeId):null;
  const maskCropShape=maskCropImage?layers.find(item=>item.id===maskCropImage.maskShapeId && item.type==='shape'):null;
  // A deleted or detached photo must not leave the canvas trapped in crop mode.
  useEffect(()=>{
    if(maskCropImageId && (!maskCropImage || !maskCropShape))setMaskCropImageId(null);
  },[maskCropImageId,maskCropImage,maskCropShape]);
  const selectedIds = multiSelected.length ? multiSelected : (selected ? [selected] : []);
  // Desktop grips sit above all layers; Mobile owns its independent touch selection frame.
  const studioResizeLayers = IS_MOBILE ? [] : [...new Map(selectedIds.map(id=>{
    const layer=layers.find(item=>item.id===id);
    return layer?.type==='image' && layer.maskShapeId
      ? (layers.find(item=>item.type==='shape' && item.id===layer.maskShapeId)||layer)
      : layer;
  }).filter(Boolean).map(layer=>[layer.id,layer])).values()];
  const clearSelection = () => { setSelected(null); setMultiSelected([]); };
  // Keep the contextual Edit action close to the selected object, but inside
  // the visible canvas viewport. Never intercept gestures on the object itself.
  useEffect(()=>{
    if(!IS_MOBILE || !selectedIds.length || mobileEditOpen || panel!=='edit'){
      setMobileEditPosition(null);
      return;
    }
    const scroller=stageScrollerRef.current;
    if(!scroller)return;
    const reposition=()=>{
      const element=stageRef.current?.querySelector('.layer.selected, .mobile-mask-selection-frame');
      if(!element){setMobileEditPosition(null);return;}
      const object=element.getBoundingClientRect();
      const viewport=scroller.getBoundingClientRect();
      if(object.right < viewport.left || object.left > viewport.right || object.bottom < viewport.top || object.top > viewport.bottom){
        setMobileEditPosition(null);return;
      }
      const width=76, height=36, margin=8;
      const left=Math.min(Math.max(object.right+margin,viewport.left+margin),viewport.right-width-margin);
      const top=Math.min(Math.max(object.top-height-margin,viewport.top+margin),viewport.bottom-height-margin);
      setMobileEditPosition({left,top});
    };
    reposition();
    scroller.addEventListener('scroll',reposition,{passive:true});
    window.addEventListener('resize',reposition);
    return ()=>{scroller.removeEventListener('scroll',reposition);window.removeEventListener('resize',reposition);};
  },[selected,multiSelected,layers,zoom,panel,mobileEditOpen,projectGeneration]);

  useEffect(()=>{
    if(!shapePickerOpen) return;
    const dismiss = (event) => {
      if(shapePickerRef.current?.contains(event.target) || shapeButtonRef.current?.contains(event.target)) return;
      setShapePickerOpen(false);
    };
    document.addEventListener('pointerdown',dismiss,true);
    return ()=>document.removeEventListener('pointerdown',dismiss,true);
  },[shapePickerOpen]);
  useEffect(()=>{
    if(!textPickerOpen && !photoPickerOpen)return;
    const dismiss=e=>{if(e.target.closest('.rail-picker, .rail'))return;setTextPickerOpen(false);setPhotoPickerOpen(false)};
    document.addEventListener('pointerdown',dismiss,true);
    return ()=>document.removeEventListener('pointerdown',dismiss,true);
  },[textPickerOpen,photoPickerOpen]);
  const selectAllLayers = () => {
    setSelected(layers.length === 1 ? layers[0].id : null);
    setMultiSelected(layers.length > 1 ? layers.map(layer=>layer.id) : []);
    window.getSelection()?.removeAllRanges();
    setPanel('edit');
  };

  useEffect(()=>{
    const onKeyDown = (event) => {
      const target = event.target;
      if(event.key === 'Escape'){
        if(target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
        clearSelection();
        return;
      }
      if(target instanceof Element && target.closest('input, textarea, select, button, [contenteditable]:not([contenteditable="false"])')) return;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey && selectedIds.length){
        event.preventDefault();
        const delta=event.shiftKey?1:10;
        const dx=event.key==='ArrowLeft'?-delta:event.key==='ArrowRight'?delta:0;
        const dy=event.key==='ArrowUp'?-delta:event.key==='ArrowDown'?delta:0;
        const groupIds=new Set(selectedIds);
        layers.filter(item=>groupIds.has(item.id)).forEach(item=>{
          if(item.groupId)layers.filter(peer=>peer.groupId===item.groupId).forEach(peer=>groupIds.add(peer.id));
          if(item.maskShapeId)groupIds.add(item.maskShapeId);
          if(item.type==='shape')layers.filter(peer=>peer.maskShapeId===item.id).forEach(peer=>groupIds.add(peer.id));
        });
        checkpoint();
        setLayers(items=>items.map(item=>groupIds.has(item.id)?{...item,x:item.x+dx,y:item.y+dy}:item));
        return;
      }
      if((event.key==='Delete' || event.key==='Backspace') && !event.ctrlKey && !event.metaKey && !event.altKey){
        if(selectedIds.length){event.preventDefault();remove();}
        return;
      }
      if(!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if(target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      const key = event.key.toLowerCase();
      if(key === 'c' && !event.shiftKey && selectedIds.length===1){
        event.preventDefault();
        copyLayer(selectedIds[0]);
      } else if(key === 'v' && !event.shiftKey && layerClipboardRef.current){
        event.preventDefault();
        pasteLayer();
      } else if(key === 'a' && !event.shiftKey){
        event.preventDefault();
        selectAllLayers();
      } else if(key === 'z' && event.shiftKey){
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown',onKeyDown);
    return ()=>window.removeEventListener('keydown',onKeyDown);
  });
  const refreshRecentProjects = async () => {
    if (IS_MOBILE) {
      try { setRecentProjects(await listProjects());setProjectError(''); }
      catch(error) { setProjectError(`Unable to list projects: ${error.message}`); }
      return;
    }
    if (!window.frameDesktop?.getRecentProjects) return;
    try { setRecentProjects(await window.frameDesktop.getRecentProjects()); }
    catch (error) { setProjectError(error.message); }
  };
  const beginRename = () => {
    setNameDraft(projectName.replace(/\.(frame|json)$/i, ''));
    setProjectError('');
    setRenaming(true);
  };
  const finishRename = async () => {
    if (!renaming) return;
    if (IS_MOBILE) {
      const name=(nameDraft.trim().replace(/[\\/:*?"<>|]/g,'') || 'Untitled')+'.frame';
      setProjectName(name);setRenaming(false);setSaveState('Unsaved');
      return;
    }
    if (!window.frameDesktop?.renameProject) { setRenaming(false); return; }
    try {
      const result = await window.frameDesktop.renameProject(nameDraft);
      if (!result.ok) { setProjectError(result.error || 'Could not rename project.'); return; }
      setProjectName(result.name);
      setRenaming(false);
      setProjectError('');
      refreshRecentProjects();
    } catch (error) { setProjectError(error.message); }
  };
  const openRecentProject = async (filePath) => {
    try {
      if (IS_MOBILE) {
        const record=await getProject(filePath);
        if (!record?.project) throw new Error('Saved project not found');
        applyProject(record.project,record.name);setMobileProjectId(record.id);
        setProjectsOpen(false);setProjectError('');return;
      }
      const result = await window.frameDesktop.openRecentProject(filePath);
      if (result?.project) {
        applyProject(result.project, result.name);
        setProjectsOpen(false);
        setProjectError('');
        if(!IS_MOBILE)setStudioHome(false);
        refreshRecentProjects();
      }
    } catch (error) { setProjectError(error.message); refreshRecentProjects(); }
  };
  const commitCanvasZoom = () => {
    const percent = Number(zoomDraft.replace('%', '').trim());
    if (Number.isFinite(percent) && percent >= 45 && percent <= 135) setZoom(Math.round(percent) / 100);
    setZoomEditing(false);
  };
  const saveTheme = (kind,submittedName) => {
    const name=(submittedName||'').trim();
    if(!name) return;
    const values=kind==='canvas' ? {bg,canvasDesign:{...canvasDesign},canvasSwatches:[...canvasSwatches]}
      : {appTheme,accent,accentSwatches:[...accentSwatches],gradientButtons,brandPrimary,toolbarColor,logoGradientEnd,exportGradientEnd,logoGradientAngle,exportGradientAngle};
    setThemeLibrary(previous=>{
      const next={...previous,[kind]:[...(previous[kind]||[]).filter(item=>item.name!==name),{name,values}]};
      try{localStorage.setItem('frame-saved-themes',JSON.stringify(next));}catch{}
      return next;
    });
    setThemeNotice(`Saved ${kind} theme: ${name}`);
    setThemeNames(prev=>({...prev,[kind]:''}));
  };
  const applyTheme = (kind,name) => {
    const values=themeLibrary[kind]?.find(item=>item.name===name)?.values;
    if(!values)return;
    if(kind==='canvas'){
      checkpoint();setBg(values.bg);setCanvasDesign(normalizeCanvasDesign(values.canvasDesign));
      if(Array.isArray(values.canvasSwatches))setCanvasSwatches(values.canvasSwatches);
    }else{
      setAppTheme(values.appTheme);setAccent(values.accent);setAccentSwatches(values.accentSwatches);
      setGradientButtons(values.gradientButtons);setBrandPrimary(values.brandPrimary);setToolbarColor(values.toolbarColor);
      setLogoGradientEnd(values.logoGradientEnd);setExportGradientEnd(values.exportGradientEnd);
      setLogoGradientAngle(values.logoGradientAngle);setExportGradientAngle(values.exportGradientAngle);
    }
  };
  const deleteTheme = (kind,name)=>setThemeLibrary(previous=>{
    const next={...previous,[kind]:(previous[kind]||[]).filter(item=>item.name!==name)};
    try{localStorage.setItem('frame-saved-themes',JSON.stringify(next));}catch{}
    return next;
  });
  const saveGradientSwatch = () => {
    const next=[...gradientSwatches,{id:uid(),primary:bg,secondary:canvasDesign.secondary,angle:canvasDesign.angle}];
    try{localStorage.setItem('frame-gradient-swatches',JSON.stringify(next));setGradientSwatches(next);setThemeNotice('Saved gradient swatch');}catch{setThemeNotice('Could not save gradient swatch');}
  };
  const removeGradientSwatch = id => {const next=gradientSwatches.filter(item=>item.id!==id);setGradientSwatches(next);try{localStorage.setItem('frame-gradient-swatches',JSON.stringify(next))}catch{}};
  const project = useMemo(()=>({pages,layers,bg,canvasDesign,orientation}),[pages,layers,bg,canvasDesign,orientation]);
  useEffect(()=>{
    exportReviewBlobsRef.current.forEach(item=>URL.revokeObjectURL(item.url));
    exportReviewBlobsRef.current=[];
    setExportReview([]);
  },[project,projectGeneration]);
  useEffect(()=>{try{
    localStorage.setItem('frame-theme',appTheme);
    localStorage.setItem('frame-accent',accent);
    localStorage.setItem('frame-accent-swatches',JSON.stringify(accentSwatches));
    localStorage.setItem('frame-canvas-swatches',JSON.stringify(canvasSwatches));
    localStorage.setItem('frame-text-swatches',JSON.stringify(textSwatches));
    localStorage.setItem('frame-gradient-buttons',String(gradientButtons));
    localStorage.setItem('frame-brand-primary',brandPrimary);
    localStorage.setItem('frame-toolbar-color',toolbarColor);
    localStorage.setItem('frame-logo-gradient-end',logoGradientEnd);
    localStorage.setItem('frame-export-gradient-end',exportGradientEnd);
    localStorage.setItem('frame-logo-gradient-angle',String(logoGradientAngle));
    localStorage.setItem('frame-export-gradient-angle',String(exportGradientAngle));
  }catch{}},[appTheme,accent,accentSwatches,canvasSwatches,textSwatches,gradientButtons,brandPrimary,toolbarColor,logoGradientEnd,exportGradientEnd,logoGradientAngle,exportGradientAngle]);
  const changeCanvasDesign = patch => {checkpoint();setCanvasDesign(d=>({...d,...patch}));};

  const resetCanvasForProject = () => {
    // A drag/resize can outlive the original project because it listens on window.
    // Cancel it before replacing layers, so old preset gestures cannot mutate new projects.
    activeCanvasGestureRef.current?.();
    activeCanvasGestureRef.current = null;
    clearTimeout(autosaveTimer.current);
    setDropShapeId(null);
    setDropShapeArmed(false);
    setMaskCropImageId(null);
    maskCropPinchRef.current=null;
    setContextMenu(null);
    setPreviewOpen(false);
    setPreviewSlides([]);
    setProjectGeneration(generation=>generation+1);
    cursorOnCanvasRef.current = null;
  };

  const applyProject = (raw, name='Untitled.frame') => {
    const p = normalizeProject(raw);
    resetCanvasForProject();
    if(IS_MOBILE)setMobileProjectId(null);
    setPages(p.pages); setLayers(p.layers); setBg(p.bg); setCanvasDesign(p.canvasDesign); setOrientation(p.orientation);
    clearSelection(); setHistory([]); setFuture([]); setProjectName(name); setSaveState('Saved');
  };

  useEffect(()=>{
    let alive = true;
    (async()=>{
      if(window.frameDesktop){
        const autosave = await window.frameDesktop.loadAutosave();
        if(alive && autosave?.found){applyProject(autosave.project, autosave.name || 'Recovered session');setSaveState('Recovered');}
        const info = await window.frameDesktop.getProjectInfo();
        if(alive && info?.name && info.path) setProjectName(info.name);
        if(alive) refreshRecentProjects();
      }
      if(alive){ hydrated.current = true; setEditorReady(true); }
    })().catch(error=>{console.error('Project initialization failed:',error);if(alive){hydrated.current=true;setEditorReady(true);}});
    return ()=>{ alive=false; };
  },[]);

  useEffect(()=>{
    if(!IS_MOBILE || !hydrated.current || !autosaveEnabled || !mobileProjectId)return;
    setSaveState('Unsaved');
    const timer=setTimeout(async()=>{
      try {
        await saveProjectRecord({id:mobileProjectId,name:projectName,updatedAt:Date.now(),project:{format:'frame-studio-project',version:3,...project}});
        setSaveState('Autosaved');
      } catch(error){setProjectError(`Autosave failed: ${error.message}`);setSaveState('Save failed');}
    },1500);
    return ()=>clearTimeout(timer);
  },[mobileProjectId,project,projectName,autosaveEnabled]);

  useEffect(()=>{
    try {localStorage.setItem('frame-autosave-enabled', String(autosaveEnabled));} catch {}
  },[autosaveEnabled]);

  useEffect(()=>{
    if(!hydrated.current || !window.frameDesktop) return;
    clearTimeout(autosaveTimer.current);
    setSaveState('Unsaved');
    if(!autosaveEnabled) return;
    autosaveTimer.current = setTimeout(async()=>{
      const result = await window.frameDesktop.autosave(project);
      if(result?.ok) setSaveState('Autosaved');
    }, 500);
    return ()=>clearTimeout(autosaveTimer.current);
  },[project,autosaveEnabled]);

  useEffect(()=>{
    if(!window.frameDesktop?.onMenuAction) return;
    return window.frameDesktop.onMenuAction(async action=>{
      if(action==='save') await saveProject(false);
      if(action==='saveAs') await saveProject(true);
      if(action==='open') await openProject();
      if(action==='new'){if(IS_MOBILE)await newProject();else {setStudioHome(true);startStudioProject();}}
      if(action==='selectAll') selectAllLayers();
      if(action==='undo') undo();
      if(action==='redo') redo();
      if(action==='zoomIn') zoomIn();
      if(action==='zoomReset') setZoom(1);
    });
  });

  const checkpoint = () => {
    setHistory(h=>[...h.slice(-29), JSON.stringify(project)]);
    setFuture([]);
  };

  const undo = () => {
    if(!history.length) return;
    const prev = JSON.parse(history[history.length-1]);
    setFuture(f=>[JSON.stringify(project),...f]);
    setHistory(h=>h.slice(0,-1));
    const p=normalizeProject(prev);
    setLayers(p.layers); setPages(p.pages); setBg(p.bg); setCanvasDesign(p.canvasDesign); setOrientation(p.orientation); clearSelection();
  };
  const redo = () => {
    if(!future.length) return;
    const next = JSON.parse(future[0]);
    setHistory(h=>[...h, JSON.stringify(project)]);
    setFuture(f=>f.slice(1));
    const p=normalizeProject(next);
    setLayers(p.layers); setPages(p.pages); setBg(p.bg); setCanvasDesign(p.canvasDesign); setOrientation(p.orientation); clearSelection();
  };

  // Home lists live in IndexedDB; the editor and desktop logic remain shared.
  const loadMobileWorks=async()=>{
    if(!IS_MOBILE)return;
    try{setMobileWorks(await listProjects());setProjectError('');}
    catch(error){setProjectError(`Could not load saved projects: ${error.message}`);}
  };
  useEffect(()=>{if(IS_MOBILE && editorReady && mobileHome)loadMobileWorks();},[editorReady,mobileHome]);
  const loadStudioWorks=async()=>{
    if(IS_MOBILE || !window.frameDesktop?.getProjectLibrary)return;
    setStudioLibraryBusy(true);
    try{setStudioWorks(await window.frameDesktop.getProjectLibrary());}
    catch(error){setStudioHomeNotice(`Could not load Your Work: ${error.message}`);}
    finally{setStudioLibraryBusy(false);}
  };
  useEffect(()=>{if(!IS_MOBILE && editorReady && studioHome)loadStudioWorks();},[editorReady,studioHome]);
  const openStudioHome=()=>{
    setContextMenu(null);setShapePickerOpen(false);setStudioTab('work');
    setStudioHomeNotice('');setStudioHome(true);
  };
  const startStudioProject=(template=null)=>{
    setStudioNewTemplate(template);setStudioNewName(template ? template.name+' carousel' : '');
    setStudioHomeNotice('');setStudioNewDialog(true);
  };
  const confirmStudioProject=async()=>{
    const base=studioNewName.trim().replace(/\.(frame|json)$/i,'');
    if(!base || base.length>100 || /[<>:"/\\|?*\x00-\x1f]/.test(base) || /[. ]$/.test(base)){
      setStudioHomeNotice('Choose a valid Windows project name (up to 100 characters).');return;
    }
    if((saveState==='Unsaved' || saveState==='Recovered') && !window.confirm('Start a new carousel? Unsaved changes in the current session may be lost.'))return;
    try {
      if(studioNewTemplate){
        await useCarouselPreset(studioNewTemplate);
      }else await newProject();
      setProjectName(base+'.frame');setSaveState('Unsaved');
      setStudioNewDialog(false);setStudioNewTemplate(null);setStudioHome(false);
      setStudioHomeNotice('');
    }catch(error){setStudioHomeNotice(`Could not create carousel: ${error.message}`);}
  };
  const openStudioWork=async filePath=>{
    await openRecentProject(filePath);
    // openRecentProject closes Studio Home only after a successful load.
  };
  const backupStudioWork=async filePath=>{
    try{const result=await window.frameDesktop.backupRecentProject(filePath);if(result?.ok)setStudioHomeNotice(`Backup saved: ${result.name}`);}
    catch(error){setStudioHomeNotice(`Backup failed: ${error.message}`);}
  };
  const deleteStudioWork=async filePath=>{
    try{const result=await window.frameDesktop.deleteRecentProject(filePath);if(result?.ok){setStudioHomeNotice('Project moved to the Recycle Bin.');await loadStudioWorks();}}
    catch(error){setStudioHomeNotice(`Could not delete project: ${error.message}`);}
  };
  const openMobileHome=async()=>{
    setMaskCropImageId(null);
    setMobileEditOpen(false);setPanel('edit');setMobileHomeTab('work');
    setMobileSettingsOpen(false);setMobileExitHint(false);mobileLastBackRef.current=0;
    setMobileHome(true);
  };
  // Register Android Back exactly once. A listener recreated during navigation can
  // briefly leave the native WebView without a handler, causing the app to exit.
  const mobileNavigationRef=useRef({mobileHome,mobileSettingsOpen,mobileNewDialog});
  mobileNavigationRef.current={mobileHome,mobileSettingsOpen,mobileNewDialog};
  useEffect(()=>{
    if(!IS_MOBILE || !Capacitor.isNativePlatform() || Capacitor.getPlatform()!=='android')return;
    let cancelled=false;
    let subscription;
    const handleBack=async()=>{
      const state=mobileNavigationRef.current;
      if(state.mobileNewDialog){setMobileNewDialog(false);return;}
      if(state.mobileSettingsOpen){setMobileSettingsOpen(false);return;}
      if(!state.mobileHome){
        setMobileEditOpen(false);setPanel('edit');setMobileHomeTab('work');
        setMobileHome(true);setMobileExitHint(false);mobileLastBackRef.current=0;
        return;
      }
      const now=Date.now();
      if(now-mobileLastBackRef.current<=2000){
        mobileLastBackRef.current=0;setMobileExitHint(false);
        await CapacitorApp.exitApp();return;
      }
      mobileLastBackRef.current=now;setMobileExitHint(true);
      if(mobileExitHintTimerRef.current)clearTimeout(mobileExitHintTimerRef.current);
      mobileExitHintTimerRef.current=setTimeout(()=>{setMobileExitHint(false);mobileLastBackRef.current=0;},2000);
    };
    CapacitorApp.addListener('backButton',handleBack).then(handle=>{
      if(cancelled)handle.remove();else subscription=handle;
    }).catch(error=>console.error('Android Back listener failed:',error));
    return ()=>{cancelled=true;subscription?.remove();clearTimeout(mobileExitHintTimerRef.current);};
  },[]);
  const openMobileWork=async id=>{
    try{
      const record=await getProject(id);
      if(!record)throw new Error('Project not found');
      applyProject(record.project,record.name);setMobileProjectId(id);
      setSaveState('Saved locally');setMobileEditOpen(false);setMobileHome(false);
    }catch(error){setProjectError(`Could not open project: ${error.message}`);}
  };
  const deleteMobileWork=async id=>{
    if(!window.confirm('Permanently delete this project from this device?'))return;
    try{await deleteProjectRecord(id);if(mobileProjectId===id)setMobileProjectId(null);await loadMobileWorks();}
    catch(error){setProjectError(`Could not delete project: ${error.message}`);}
  };
  const createMobileProject=()=>{setMobileNewName('');setMobileHomeNotice('');setMobileNewDialog(true);};
  const confirmMobileProject=async()=>{
    const value=mobileNewName.trim().replace(/\.(frame|json)$/i,'');
    if(!value){setMobileHomeNotice('Enter a project name.');return;}
    if(value.length>100){setMobileHomeNotice('Use a shorter name (100 characters maximum).');return;}
    await newProject();
    setMobileProjectId(null);setProjectName(`${value}.frame`);
    setMobileHome(false);setMobileNewDialog(false);setMobileEditOpen(false);
    setSaveState('Unsaved');setMobileHomeNotice('');
  };
  const exportMobileBackup=async item=>{
    try{
      const filename=(item.name||'FRAME Project').replace(/\.(frame|json)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.frame';
      const json=JSON.stringify({format:'frame-studio-project',version:3,...item.project});
      if(Capacitor.isNativePlatform()){
        const {Filesystem,Directory,Encoding}=await import('@capacitor/filesystem');
        await Filesystem.writeFile({path:filename,data:json,encoding:Encoding.UTF8,directory:Directory.Cache});
        const result=await FrameDocument.saveBackup({filename});
        if(result.cancelled)return;
      }else{
        const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
      }
      setMobileHomeNotice('Backup saved successfully.');
    }catch(error){setMobileHomeNotice(`Could not export backup: ${error.message}`);}
  };
  const saveProject = async (saveAs=false) => {
    if(IS_MOBILE){
      if(mobileSavingRef.current)return;
      mobileSavingRef.current=true;
      setMobileSaving(true);
      clearTimeout(mobileSaveFeedbackTimer.current);
      setMobileSaveFeedback({kind:'saving',message:'Saving…'});
      try {
        const id=saveAs || !mobileProjectId ? uid() : mobileProjectId;
        await saveProjectRecord({id,name:projectName,updatedAt:Date.now(),project:{format:'frame-studio-project',version:3,...project}});
        setMobileProjectId(id);setSaveState('Saved locally');setProjectError('');
        showMobileSaveFeedback('success','Saved to Your Work');
        refreshRecentProjects();
      } catch(error){
        setProjectError(`Save failed: ${error.message}`);setSaveState('Save failed');
        showMobileSaveFeedback('error',`Save failed: ${error.message}`);
      } finally {
        mobileSavingRef.current=false;
        setMobileSaving(false);
      }
      return;
    }
    if(!window.frameDesktop){
      const blob = new Blob([JSON.stringify({format:'frame-studio-project',version:3,...project},null,2)],{type:'application/json'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Untitled.frame'; a.click(); URL.revokeObjectURL(a.href); return;
    }
    try {
      // Save a tiny, self-contained preview alongside the native .frame file.
      // Rendering in Chromium uses the same photo decoder as Studio's editor;
      // Electron's nativeImage cannot reliably decode every embedded photo.
      let studioThumbnail;
      try {
        await document.fonts.ready;
        const previewPage = thumbnailPageForProject(layers, pages, PAGE_W, GAP);
        const thumbnailImages = new Map();thumbnailImages.preview = true;
        const thumb = await renderSlideCanvas(previewPage, 224 / PAGE_W, {draft:true, imageCache:thumbnailImages});
        if(thumb) {
          studioThumbnail = thumb.toDataURL('image/jpeg', 0.72);
          thumb.width=0;thumb.height=0;
        }
      } catch (thumbnailError) {
        console.warn('Studio project saved without a Home thumbnail:',thumbnailError);
      }
      const result = await window.frameDesktop.saveProject({...project, ...(studioThumbnail ? {studioThumbnail} : {})}, saveAs, projectName);
      if(result?.canceled)return;
      if(result?.ok === false)throw new Error(result.error || 'The project could not be saved.');
      setProjectName(result.name || 'Untitled.frame');
      setSaveState('Saved');
      setProjectError('');
      showMobileSaveFeedback('success','Project saved');
      refreshRecentProjects();
    } catch(error) {
      const message=`Save failed: ${error.message || error}`;
      setProjectError(message);
      setSaveState('Save failed');
      showMobileSaveFeedback('error',message);
    }
  };

  const openProject = async () => {
    if(!window.frameDesktop){
      const picker=document.createElement('input');picker.type='file';picker.accept='.frame,.json,application/json';
      picker.addEventListener('change',async()=>{const file=picker.files?.[0];if(!file)return;
        try{const data=JSON.parse(await file.text());
          if(!data||typeof data!=='object'||(data.format&&data.format!=='frame-studio-project')||!Array.isArray(data.layers))throw new Error('Invalid FRAME project');
          applyProject(data,file.name);if(IS_MOBILE){setMobileProjectId(null);setMobileEditOpen(false);setMobileHome(false);}setSaveState('Opened');
        }catch(error){alert(`Could not open project: ${error.message}`)}
      },{once:true});picker.click();return;
    }
    const result = await window.frameDesktop.openProject();
    if(!result?.canceled && result?.project) { applyProject(result.project,result.name); setStudioHome(false); refreshRecentProjects(); }
  };

  const saveCarouselPreset = () => {
    const name=presetName.trim();
    if(!name){setPresetNotice('Enter a name before saving.');return;}
    if(customCarouselPresets.some(item=>item.name.toLowerCase()===name.toLowerCase())){
      setPresetNotice('A preset with this name already exists. Choose another name.');return;
    }
    const item={id:uid(),name,description:`${pages} slides · Your saved layout`,project:sanitizeCarouselPreset(project)};
    const next=[...customCarouselPresets,item];
    try{
      localStorage.setItem(CAROUSEL_PRESET_KEY,JSON.stringify(next));
      setCustomCarouselPresets(next);
      setPresetName('');
      setPresetNotice(`Saved "${name}" to this device. Photos become editable placeholders.`);
    }catch(error){setPresetNotice('Could not save preset. Local storage may be full.');}
  };
  const removeCarouselPreset = id => {
    const next=customCarouselPresets.filter(item=>item.id!==id);
    try{localStorage.setItem(CAROUSEL_PRESET_KEY,JSON.stringify(next));setCustomCarouselPresets(next);setPresetNotice('Preset deleted.');}
    catch{setPresetNotice('Could not remove preset.');}
  };
  const useCarouselPreset = async item => {
    // A template is always a NEW untitled project, never an overwrite of the open file.
    try{
      if(window.frameDesktop?.newProject) await window.frameDesktop.newProject();
      applyProject(freshPresetProject(item.project),'Untitled.frame');
      setSaveState('Unsaved');
      if(IS_MOBILE){setMobileProjectId(null);setMobileHome(false);setMobileEditOpen(false);}
      setPresetsOpen(false);setPresetPending(null);
      setPanel('edit');setContextMenu(null);
      const scroller=stageScrollerRef.current;
      if(scroller){scroller.scrollLeft=0;scroller.scrollTop=0;}
    }catch(error){setPresetNotice(`Could not open preset: ${error.message}`);setPresetPending(null);}
  };
  const newProject = async () => {
    if(window.frameDesktop) await window.frameDesktop.newProject();
    resetCanvasForProject();
    setPages(3); setLayers([]); clearSelection(); setBg('#f7f4ef'); setCanvasDesign(defaultCanvasDesign()); setOrientation('portrait');
    setHistory([]); setFuture([]); setProjectName('Untitled.frame'); setSaveState('Unsaved');
  };

  const startPanelResize = (event,side) => {
    if(event.button !== 0) return;
    event.preventDefault();
    const startX=event.clientX;
    const initial=side==='left'?railWidth:inspectorWidth;
    const move=e=>{
      const delta=e.clientX-startX;
      const proposed=initial+(side==='left'?delta:-delta);
      const other=side==='left'?inspectorWidth:railWidth;
      const available=Math.max(side==='left'?78:230,window.innerWidth-other-280-12);
      const size=Math.max(side==='left'?78:230,Math.min(available,proposed));
      if(side==='left')setRailWidth(size);else setInspectorWidth(size);
    };
    const stop=()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',stop);
      window.removeEventListener('pointercancel',stop);
      document.body.classList.remove('resizing-panels');
    };
    document.body.classList.add('resizing-panels');
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',stop);
    window.addEventListener('pointercancel',stop);
  };

  const removeLastSlide = () => {
    if (pages <= 1) return;
    checkpoint();
    // Evaluate the exact displayed bounds before removing the page. Retain
    // images and masks that overlap ANY remaining slide, without changing
    // their coordinates or accidentally deleting linked artwork.
    const remaining = layersAfterRemovingFinalSlide(layers, pages, PAGE_W, GAP, PAGE_H);
    const removedCount = layers.length - remaining.length;
    setLayers(remaining);
    setPages(pages - 1);
    clearSelection();
    setConfirmRemoveSlide(false);
    if(!IS_MOBILE)showMobileSaveFeedback('success',`Slide ${pages} removed · ${removedCount} last-slide object${removedCount===1?'':'s'} deleted`);
  };

  const changeOrientation = (next) => {
    if(next===orientation) return;
    checkpoint();
    // Change page dimensions only. Existing layers retain their sizes and positions.
    setOrientation(next);
  };

  const visiblePageIndex = () => {
    const scroller = stageScrollerRef.current, stage = stageRef.current;
    if (!scroller || !stage) return 0;
    const viewport = scroller.getBoundingClientRect();
    const canvas = stage.getBoundingClientRect();
    const canvasX = (viewport.left + viewport.width/2 - canvas.left) / zoom;
    return Math.max(0,Math.min(pages-1,Math.floor(canvasX/(PAGE_W+GAP))));
  };

  const addText = (fontFamily='Inter') => {
    checkpoint();
    const textWidth=Math.min(220,PAGE_W-20);
    const x=visiblePageIndex()*(PAGE_W+GAP)+(PAGE_W-textWidth)/2;
    const layer={id:uid(),type:'text',x,y:Math.min(170,PAGE_H-100),w:textWidth,h:90,text:'Double tap to edit',fontSize:28,color:'#111111',weight:700,align:'left',fontFamily};
    setLayers(v=>[...v,{...layer,z:v.reduce((max,item)=>Math.max(max,Number(item.z)||0),0)+1}]);
    setSelected(layer.id);setMultiSelected([]);setPanel('edit');setShapePickerOpen(false);setTextPickerOpen(false);setPhotoPickerOpen(false);
  };

  const addShape = (shape='rounded') => {
    const activePage = visiblePageIndex();
    const targetX = activePage * (PAGE_W + GAP) + (PAGE_W - 180) / 2;
    checkpoint();
    const layer={id:uid(),type:'shape',shape,x:targetX,y:Math.min(110,PAGE_H-190),w:180,h:shape==='rectangle'||shape==='rounded'?130:180,color:'#d8ffb5',radius:28};
    setLayers(v=>{
      const top = v.reduce((max,item)=>Math.max(max,Number(item.z)||0),0);
      return [...v,{...layer,z:top+1}];
    });
    setSelected(layer.id); setMultiSelected([]); setPanel('edit'); setShapePickerOpen(false);
  };

  const projectPhotos = [...new Map(layers.filter(l=>l.type==='image' && l.src).map(l=>[l.src,l])).values()].reverse().slice(0,24);
  const insertProjectPhoto = source => {
    checkpoint();
    const id=uid();
    const width=Math.min(220,source.w),height=source.h*width/source.w;
    const page=visiblePageIndex();
    setLayers(items=>[...items,{id,type:'image',src:source.src,naturalWidth:source.naturalWidth,naturalHeight:source.naturalHeight,x:page*(PAGE_W+GAP)+(PAGE_W-width)/2,y:(PAGE_H-height)/2,w:width,h:height,radius:0,z:Math.max(0,...items.map(l=>Number(l.z)||0))+1}]);
    setSelected(id);setMultiSelected([]);setPanel('edit');setPhotoPickerOpen(false);
  };
  const onImages = (files) => {
    const fileArr=[...files].slice(0,8);
    if(!fileArr.length) return;
    checkpoint();
    fileArr.forEach((file,i)=>{
      const reader=new FileReader();
      reader.onload=e=>{
        const src=e.target.result;
        const img=new Image();
        img.onload=()=>{
          // Fit the original image without cropping, stretching, or rounding corners.
          // Keep the full-resolution source for exporting and later resizing.
          const scale=Math.min(220/img.naturalWidth,230/img.naturalHeight,1);
          const w=img.naturalWidth*scale, h=img.naturalHeight*scale;
          const layer={id:uid(),type:'image',src,x:28+i*34,y:Math.min(105+i*18,PAGE_H-h-10),w,h,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,radius:0};
          setLayers(v=>{
            const top=v.reduce((max,item)=>Math.max(max,Number(item.z)||0),0);
            return [...v,{...layer,z:top+1}];
          });
          setSelected(layer.id); setMultiSelected([]);
        };
        img.onerror=()=>console.error('Could not load image:',file.name);
        img.src=src;
      };
      reader.readAsDataURL(file);
    });
  };

  const patch = (patch) => setLayers(v=>v.map(l=>l.id===selected?{...l,...patch}:l));
  const remove = () => {
    if(!selectedIds.length)return;
    checkpoint();
    const deleted=new Set(selectedIds);
    setLayers(v=>v.filter(l=>!deleted.has(l.id)).map(l=>l.maskShapeId && deleted.has(l.maskShapeId)?{...l,maskShapeId:null}:l));
    if(maskCropImageId && (deleted.has(maskCropImageId) || deleted.has(maskCropImage?.maskShapeId)))setMaskCropImageId(null);
    clearSelection();
  };
  const duplicate = () => { if(!chosen)return; checkpoint(); const n={...chosen,id:uid(),x:chosen.x+22,y:chosen.y+22,z:chosen.z+1}; setLayers(v=>[...v,n]);setSelected(n.id);setMultiSelected([]); };
  const bringFront = () => { if(!chosen)return; checkpoint(); const max=Math.max(...layers.map(l=>l.z||0),0); patch({z:max+1}); };
  const reorderLayer = (dragId,targetId,placeAfter=false) => {
    // Layer ordering is document data, not just an inspector visual change.
    const next=moveLayerInStack(layers,dragId,targetId,placeAfter);
    if(next===layers)return;
    checkpoint();
    setLayers(next);
  };

  // Wheel zoom changes the Electron window scale, matching Ctrl+= / Ctrl+-.
  useEffect(() => {
    let lastWheelZoom = 0;
    const onWheel = (event) => {
      if(!(event.ctrlKey || event.metaKey) || event.altKey || !event.deltaY) return;
      if(!window.frameDesktop?.zoomWindowByStep) return;
      event.preventDefault();
      const now = performance.now();
      if(now - lastWheelZoom < 85) return;
      lastWheelZoom = now;
      window.frameDesktop.zoomWindowByStep(event.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener('wheel', onWheel, { passive:false, capture:true });
    return () => window.removeEventListener('wheel', onWheel, { capture:true });
  }, []);

  // Keep the initial canvas aligned with the visible workspace instead of scrolling down.
  useEffect(() => {
    if(!editorReady) return;
    const scroller=stageScrollerRef.current;
    if(scroller){
      const verticalSpace=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
      scroller.scrollTop=verticalSpace/2;
      scroller.scrollLeft=0;
    }
  },[editorReady]);

  // Center a newly opened project after the editor viewport has its actual dimensions.
  // Avoid recentering on edits/zoom so users do not lose their place while working.
  useLayoutEffect(() => {
    if(!IS_MOBILE || !editorReady || mobileHome)return;
    let frame2=0;
    const frame1=requestAnimationFrame(()=>{
      frame2=requestAnimationFrame(()=>{
        const scroller=stageScrollerRef.current;
        const wrap=scroller?.querySelector('.stage-wrap');
        if(!scroller || !wrap)return;
        // Use coordinates in the scrolling viewport, not offsetParent-dependent offsets.
        const view=scroller.getBoundingClientRect();
        const art=wrap.getBoundingClientRect();
        const x=scroller.scrollLeft+(art.left-view.left)+(PAGE_W*zoom)/2-view.width/2;
        const y=scroller.scrollTop+(art.top-view.top)+(PAGE_H*zoom)/2-view.height/2;
        scroller.scrollLeft=Math.max(0,Math.min(scroller.scrollWidth-scroller.clientWidth,x));
        scroller.scrollTop=Math.max(0,Math.min(scroller.scrollHeight-scroller.clientHeight,y));
      });
    });
    return ()=>{cancelAnimationFrame(frame1);cancelAnimationFrame(frame2);};
  },[editorReady,mobileHome,projectGeneration]);

  const lastMiddleClick = useRef(null);

  const startWorkspacePan = (e) => {
    if(e.button !== 1) return;
    const scroller = stageScrollerRef.current;
    if(!scroller) return;
    e.preventDefault();
    e.stopPropagation();
    // Two middle-button presses in quick succession reset the whole window zoom.
    const now = performance.now();
    const previous = lastMiddleClick.current;
    if(previous && now - previous.time < 350 &&
       Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 10){
      lastMiddleClick.current = null;
      window.frameDesktop?.resetWindowZoom?.();
      return;
    }
    lastMiddleClick.current = {time:now,x:e.clientX,y:e.clientY};
    const startX = e.clientX, startY = e.clientY;
    const scrollX = scroller.scrollLeft, scrollY = scroller.scrollTop;
    scroller.classList.add('is-panning');
    const move = (ev) => {
      if(Math.hypot(ev.clientX - startX, ev.clientY - startY) >= 10){
        lastMiddleClick.current = null;
      }
      scroller.scrollLeft = scrollX - (ev.clientX - startX);
      scroller.scrollTop = scrollY - (ev.clientY - startY);
    };
    const stop = () => {
      scroller.classList.remove('is-panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  };

  const rememberCanvasCursor = event => {
    const stage = stageRef.current;
    if(!stage) return;
    const rect=stage.getBoundingClientRect();
    const x=(event.clientX-rect.left)/zoom;
    const y=(event.clientY-rect.top)/zoom;
    cursorOnCanvasRef.current=(x>=0&&x<=canvasW&&y>=0&&y<=PAGE_H)?{x,y}:null;
  };
  const copyLayer = (id=selected) => {
    const layer=layers.find(item=>item.id===id);
    if(!layer) return false;
    layerClipboardRef.current={...layer};
    return true;
  };
  const pasteLayer = (at=null) => {
    const source=layerClipboardRef.current;
    if(!source) return;
    const scroller=stageScrollerRef.current, stage=stageRef.current;
    let activePage=0;
    if(scroller&&stage){
      const viewport=scroller.getBoundingClientRect(), canvas=stage.getBoundingClientRect();
      const centerX=(viewport.left+viewport.width/2-canvas.left)/zoom;
      activePage=Math.max(0,Math.min(pages-1,Math.floor(centerX/(PAGE_W+GAP))));
    }
    const point=at||cursorOnCanvasRef.current;
    const page=point?Math.max(0,Math.min(pages-1,Math.floor(point.x/(PAGE_W+GAP)))):activePage;
    const pageLeft=page*(PAGE_W+GAP);
    const x=point?Math.max(pageLeft,Math.min(pageLeft+PAGE_W-source.w,point.x-source.w/2))
      :pageLeft+(PAGE_W-source.w)/2;
    const y=point?Math.max(0,Math.min(PAGE_H-source.h,point.y-source.h/2)):(PAGE_H-source.h)/2;
    const newId=uid();
    checkpoint();
    setLayers(items=>[...items,{...source,id:newId,x,y,z:items.reduce((m,item)=>Math.max(m,Number(item.z)||0),0)+1}]);
    setSelected(newId);
    setMultiSelected([]);
    setContextMenu(null);
    setPanel('edit');
  };
  const openLayerMenu = (event,layer) => {
    event.preventDefault();
    event.stopPropagation();
    setShapePickerOpen(false);
    rememberCanvasCursor(event);
    setPanel('edit');
    // Right-clicking within an existing multi-selection never collapses it.
    const inSelection=selectedIds.includes(layer.id);
    const menuSelection=selectedIds.length>1 && inSelection ? [...selectedIds] : [layer.id];
    if(!inSelection){setSelected(layer.id);setMultiSelected([]);}
    const workspace=event.currentTarget.closest('.workspace');
    const bounds=workspace.getBoundingClientRect();
    const x=IS_MOBILE?event.clientX:Math.min(Math.max(8,event.clientX-bounds.left),Math.max(8,bounds.width-208));
    const y=IS_MOBILE?event.clientY:Math.min(Math.max(8,event.clientY-bounds.top),Math.max(8,bounds.height-196));
    setContextMenu({x,y,id:layer.id,point:cursorOnCanvasRef.current,selectionIds:menuSelection});
  };
  const layerAtFront = id => {
    const item=layers.find(l=>l.id===id);
    return !item || !layers.some(l=>l.id!==id && (Number(l.z)||0)>(Number(item.z)||0));
  };
  const layerAtBack = id => {
    const item=layers.find(l=>l.id===id);
    return !item || !layers.some(l=>l.id!==id && (Number(l.z)||0)<(Number(item.z)||0));
  };
  const fitImageToPage = (id, cursorPoint=null, fill=false) => {
    const image=layers.find(item=>item.id===id && item.type==='image');
    if(!image)return;
    // Prefer the slide under the context-menu cursor; otherwise use the slide
    // containing the largest portion of the image. These are independent pages.
    const pageFromCursor=cursorPoint && Number.isFinite(cursorPoint.x)
      ? Math.max(0,Math.min(pages-1,Math.floor(cursorPoint.x/(PAGE_W+GAP)))) : null;
    let targetPage=pageFromCursor;
    if(targetPage===null){
      let mostOverlap=-1;
      for(let page=0;page<pages;page++){
        const left=page*(PAGE_W+GAP),right=left+PAGE_W;
        const overlap=Math.max(0,Math.min(image.x+image.w,right)-Math.max(image.x,left));
        if(overlap>mostOverlap){mostOverlap=overlap;targetPage=page;}
      }
      if(mostOverlap===0)targetPage=visiblePageIndex();
    }
    // Retain original image aspect ratio and clear any previous page crop when fitting.
    // This geometry remains the real image rectangle even when Fill adds a page clip.
    const aspect=(image.naturalWidth&&image.naturalHeight)
      ? image.naturalWidth/image.naturalHeight : image.w/image.h;
    const originalW=aspect>=1?aspect:1, originalH=aspect>=1?1:1/aspect;
    const scale=fill?Math.max(PAGE_W/originalW,PAGE_H/originalH):Math.min(PAGE_W/originalW,PAGE_H/originalH);
    const w=originalW*scale,h=originalH*scale;
    const x=targetPage*(PAGE_W+GAP)+(PAGE_W-w)/2,y=(PAGE_H-h)/2;
    checkpoint();
    setLayers(items=>items.map(item=>item.id===id?{...item,x,y,w,h,maskShapeId:null,cropPage:fill?targetPage:null}:item));
    setSelected(id);setMultiSelected([]);setPanel('edit');
  };
  const contextAction = (action) => {
    if(!contextMenu) return;
    const id=contextMenu.id;
    const layer=layers.find(item=>item.id===id);
    setContextMenu(null);
    if(action==='copy'){copyLayer(id);return;}
    if(action==='paste'){pasteLayer(contextMenu.point || null);return;}
    if(!layer) return;
    if(action==='fitPage'){fitImageToPage(id,contextMenu.point);return;}
    if(action==='fillPage'){fitImageToPage(id,contextMenu.point,true);return;}
    if(action==='selectMask' && layer.maskShapeId){setSelected(layer.maskShapeId);setMultiSelected([]);setPanel('edit');return;}
    if(action==='group'){
      const ids=contextMenu.selectionIds?.length>1?contextMenu.selectionIds:[id];
      if(ids.length<2)return;
      const groupId=uid();checkpoint();
      setLayers(items=>items.map(item=>ids.includes(item.id)?{...item,groupId}:item));
      setMultiSelected(ids);setSelected(null);return;
    }
    if(action==='ungroup'){
      const gid=layer.groupId;
      if(!gid)return;
      checkpoint();setLayers(items=>items.map(item=>item.groupId===gid?{...item,groupId:null}:item));return;
    }
    if(action==='duplicate'){
      checkpoint();
      const newId=uid();
      setLayers(items=>[...items,{...layer,id:newId,x:layer.x+20,y:layer.y+20,z:items.reduce((m,item)=>Math.max(m,Number(item.z)||0),0)+1}]);
      setSelected(newId);setMultiSelected([]);return;
    }
    if((action==='front' && layerAtFront(id))||(action==='back' && layerAtBack(id)))return;
    checkpoint();
    if(action==='delete'){
      setLayers(items=>items.filter(item=>item.id!==id).map(item=>item.maskShapeId===id?{...item,maskShapeId:null}:item));
      clearSelection();
    }else{
      setLayers(items=>{
        const zs=items.map(item=>Number(item.z)||0);
        const z=action==='front'?Math.max(0,...zs)+1:Math.min(0,...zs)-1;
        return items.map(item=>item.id===id?{...item,z}:item);
      });
    }
  };
  const attachImageToShape = (imageId,shapeId) => {
    const shape=layers.find(item=>item.id===shapeId);
    if(!shape) return;
    setLayers(items=>items.map(item=>item.id===imageId?{...item,maskShapeId:shapeId,cropPage:null,
      maskZoom:1,maskPanX:0,maskPanY:0,z:Math.max(...items.map(x=>Number(x.z)||0),0)+1}:item));
  };
  const detachImageFromShape = id => {
    const image=layers.find(item=>item.id===id);if(!image?.maskShapeId)return;
    checkpoint();
    setLayers(items=>{
      const top=Math.max(0,...items.map(item=>Number(item.z)||0))+1;
      return items.map(item=>item.id===id?{...item,maskShapeId:null,maskZoom:1,maskPanX:0,maskPanY:0}:item.id===image.maskShapeId?{...item,z:top}:item);
    });
    if(maskCropImageId===id)setMaskCropImageId(null);
  };
  // Editing the photo crop is separate from dragging the linked image+shape.
  // The mask never moves while these normalized pan/zoom properties change.
  const beginMaskCrop = imageId => {
    if(!IS_MOBILE || maskCropImageId===imageId)return;
    const image=layers.find(item=>item.id===imageId && item.type==='image' && item.maskShapeId);
    if(!image || !layers.some(item=>item.id===image.maskShapeId && item.type==='shape'))return;
    checkpoint(); // One Undo returns to the framing before crop mode was opened.
    setSelected(imageId);setMultiSelected([]);setMobileMultiMode(false);
    setMobileEditOpen(false);setPanel('edit');setContextMenu(null);
    setLayers(items=>items.map(item=>item.id===imageId?{...item,
      maskZoom:clampMaskZoom(item.maskZoom),maskPanX:clampMaskPan(item.maskPanX),maskPanY:clampMaskPan(item.maskPanY)}:item));
    setMaskCropImageId(imageId);
  };
  // Returning from crop mode must not surprise-open the Edit sheet.
  // Leave the image selected with a visible shape outline and the floating Edit action.
  const finishMaskCrop = () => {
    setMaskCropImageId(null);
    maskCropPinchRef.current=null;
    setContextMenu(null);
    setMobileEditOpen(false);
    setPanel('edit');
  };
  const changeMaskCropZoom = value => {
    if(!maskCropImageId)return;
    setLayers(items=>items.map(item=>item.id===maskCropImageId?{...item,maskZoom:clampMaskZoom(value)}:item));
  };
  const resetMaskCrop = () => {
    if(!maskCropImageId)return;
    setLayers(items=>items.map(item=>item.id===maskCropImageId?{...item,maskZoom:1,maskPanX:0,maskPanY:0}:item));
  };
  const startMaskCropDrag = (e) => {
    if(!maskCropImage || !maskCropShape || e.button!==0 || mobileBlockDrag.current)return;
    e.preventDefault();e.stopPropagation();
    activeCanvasGestureRef.current?.();
    const image=maskCropImage,mask=maskCropShape,pointerId=e.pointerId;
    const startX=e.clientX,startY=e.clientY;
    const originX=clampMaskPan(image.maskPanX),originY=clampMaskPan(image.maskPanY);
    const geometry=getMaskCropGeometry(image,mask);
    const maxX=geometry.overflowX/2,maxY=geometry.overflowY/2;
    const move=ev=>{
      if(ev.pointerId!==pointerId || mobileBlockDrag.current)return;
      const dx=(ev.clientX-startX)/zoom,dy=(ev.clientY-startY)/zoom;
      const maskPanX=maxX>0?clampMaskPan(originX+dx/maxX):0;
      const maskPanY=maxY>0?clampMaskPan(originY+dy/maxY):0;
      setLayers(items=>items.map(item=>item.id===image.id?{...item,maskPanX,maskPanY}:item));
    };
    const cleanup=()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',up);
      window.removeEventListener('pointercancel',up);
      if(activeCanvasGestureRef.current===cleanup)activeCanvasGestureRef.current=null;
    };
    const up=ev=>{if(ev.pointerId===pointerId)cleanup();};
    activeCanvasGestureRef.current=cleanup;
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',up);
  };
  const shapeClipPath = shape => {
    if(!shape)return 'none';
    const kind=shapeKind(shape);
    if(kind==='ellipse')return 'ellipse(50% 50% at 50% 50%)';
    if(SHAPE_POINTS[kind])return `polygon(${SHAPE_POINTS[kind].split(' ').map(p=>p.split(',').map(v=>v+'%').join(' ')).join(',')})`;
    if(kind==='rounded')return `inset(0 round ${shape.radius||0}px)`;
    return 'inset(0)';
  };
  // Handle gestures at workspace level, including the empty area surrounding the slides.
  // Never start a canvas gesture from an editing control or dialog.
  const mobileGestureTarget = target => !target.closest('button,input,textarea,select,.workspace-title,.shape-picker,.rail-picker,.layer-context-menu,.mobile-multi-actions,.zoom,.slide-remove-overlay');
  const mobileTouchDown = e => {
    if(!IS_MOBILE || e.pointerType!=='touch' || !mobileGestureTarget(e.target))return;
    mobileTouchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const scroller=stageScrollerRef.current;
    if(mobileTouchPoints.current.size===1 && !e.target.closest('.layer,.mobile-mask-crop-target,.mobile-mask-selection-frame') && scroller){
      mobileCanvasPan.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:scroller.scrollLeft,top:scroller.scrollTop};
    }
    if(mobileTouchPoints.current.size===2 && scroller){
      mobileCanvasPan.current=null;
      mobileBlockDrag.current=true;
      activeCanvasGestureRef.current?.();
      const [first,second]=[...mobileTouchPoints.current.values()];
      // Two fingers inside the crop target zoom the PHOTO, never the canvas.
      if(maskCropImage && maskCropShape && e.target.closest('.mobile-mask-crop-target')){
        maskCropPinchRef.current={distance:Math.max(1,Math.hypot(first.x-second.x,first.y-second.y)),
          zoom:clampMaskZoom(maskCropImage.maskZoom),imageId:maskCropImage.id};
        mobilePinch.current=null;
        return;
      }
      const midpoint={x:(first.x+second.x)/2,y:(first.y+second.y)/2};
      const rect=scroller.getBoundingClientRect();
      // Clamp off-canvas gestures to the viewport, not to an image or layer.
      const focus={x:Math.max(rect.left,Math.min(rect.right,midpoint.x)),y:Math.max(rect.top,Math.min(rect.bottom,midpoint.y))};
      mobilePinch.current={distance:Math.max(1,Math.hypot(first.x-second.x,first.y-second.y)),initialZoom:zoom,
        startMidpoint:midpoint,focus,initialLeft:scroller.scrollLeft,initialTop:scroller.scrollTop,
        initialWrap:scroller.querySelector('.stage-wrap')?.getBoundingClientRect()};
      setDropShapeId(null);
      setDropShapeArmed(false);
    }
  };
  const mobileTouchMove = e => {
    if(!IS_MOBILE || !mobileTouchPoints.current.has(e.pointerId))return;
    mobileTouchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const scroller=stageScrollerRef.current;
    if(!scroller)return;
    if(mobileCanvasPan.current?.id===e.pointerId && mobileTouchPoints.current.size===1){
      const pan=mobileCanvasPan.current;
      scroller.scrollLeft=pan.left+pan.x-e.clientX;
      scroller.scrollTop=pan.top+pan.y-e.clientY;
    }
    if(maskCropPinchRef.current && mobileTouchPoints.current.size>=2){
      const pinch=maskCropPinchRef.current;
      const [first,second]=[...mobileTouchPoints.current.values()];
      const distance=Math.max(1,Math.hypot(first.x-second.x,first.y-second.y));
      const maskZoom=clampMaskZoom(Math.round(pinch.zoom*distance/pinch.distance*100)/100);
      setLayers(items=>items.map(item=>item.id===pinch.imageId?{...item,maskZoom}:item));
      return;
    }
    if(mobilePinch.current && mobileTouchPoints.current.size>=2){
      const pinch=mobilePinch.current;
      const [first,second]=[...mobileTouchPoints.current.values()];
      const distance=Math.max(1,Math.hypot(first.x-second.x,first.y-second.y));
      const next=Math.max(.35,Math.min(2.5,Math.round(pinch.initialZoom*distance/pinch.distance*100)/100));
      const midpoint={x:(first.x+second.x)/2,y:(first.y+second.y)/2};
      // Keep the content beneath the original focal point stationary as scale changes,
      // while allowing the gesture centroid to pan across both axes.
      const frame=pinch.initialWrap;
      const rect=scroller.getBoundingClientRect();
      if(frame){
        const offsetX=pinch.focus.x-frame.left;
        const offsetY=pinch.focus.y-frame.top;
        const ratio=next/pinch.initialZoom;
        const viewportX=pinch.focus.x-rect.left;
        const viewportY=pinch.focus.y-rect.top;
        const left=pinch.initialLeft+offsetX*(ratio-1)-(midpoint.x-pinch.startMidpoint.x);
        const top=pinch.initialTop+offsetY*(ratio-1)-(midpoint.y-pinch.startMidpoint.y);
        mobilePendingScroll.current={left,top};
        if(next===zoom){scroller.scrollLeft=left;scroller.scrollTop=top;}
      }
      setZoom(prev=>prev===next?prev:next);
    }
  };
  const mobileTouchUp = e => {
    if(!IS_MOBILE)return;
    mobileTouchPoints.current.delete(e.pointerId);
    if(mobileCanvasPan.current?.id===e.pointerId)mobileCanvasPan.current=null;
    if(mobileTouchPoints.current.size<2){mobilePinch.current=null;maskCropPinchRef.current=null;}
    if(mobileTouchPoints.current.size===0)mobileBlockDrag.current=false;
  };
  useLayoutEffect(()=>{
    const target=mobilePendingScroll.current;
    if(!target || !IS_MOBILE)return;
    mobilePendingScroll.current=null;
    const scroller=stageScrollerRef.current;
    if(scroller){scroller.scrollLeft=target.left;scroller.scrollTop=target.top;}
  },[zoom]);
  // Ungroup the selected FRAME group, without deleting or moving its layers.
  const ungroupMobileSelection = () => {
    const groupIds = new Set(selectedIds.map(id=>layers.find(layer=>layer.id===id)?.groupId).filter(Boolean));
    if(groupIds.size!==1)return;
    const groupId=[...groupIds][0];
    checkpoint();
    setLayers(items=>items.map(item=>item.groupId===groupId?{...item,groupId:null}:item));
    setMobileMultiMode(false);
    setMobileEditOpen(false);
    setContextMenu(null);
  };
  const groupMobileSelection = () => {
    if(selectedIds.length<2)return;
    const ids=[...selectedIds],groupId=uid();
    checkpoint();
    setLayers(items=>items.map(item=>ids.includes(item.id)?{...item,groupId}:item));
    setMobileMultiMode(false);
    setMobileEditOpen(false);
    setSelected(null);
    setMultiSelected(ids);
    setContextMenu(null);
  };
  const mobileToggleLayerSelection = id => {
    const next=selectedIds.includes(id)?selectedIds.filter(x=>x!==id):[...selectedIds,id];
    setSelected(next.length===1?next[0]:null);
    setMultiSelected(next.length>1?next:[]);
    setPanel('edit');setMobileEditOpen(false);
  };
  const startDrag = (e, layer) => {
    if(e.button !== 0)return;
    if(IS_MOBILE && maskCropImageId)return;
    if(IS_MOBILE && e.pointerType==='touch' && mobileBlockDrag.current)return;
    e.stopPropagation();
    // Desktop canvas text is artwork, not a document selection target.
    // Prevent the browser from selecting unrelated text during a layer drag.
    if(!IS_MOBILE && e.pointerType==='mouse') {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
    if(IS_MOBILE && mobileMultiMode){
      // Selection mode: tapping toggles membership; dragging any selected item
      // moves the whole selection without opening the Edit inspector.
      const wasSelected=selectedIds.includes(layer.id);
      const initialX=e.clientX,initialY=e.clientY;
      const pointerId=e.pointerId;
      const moveIds=new Set(selectedIds);
      const origins=new Map(layers.filter(item=>moveIds.has(item.id)).map(item=>[item.id,{x:item.x,y:item.y}]));
      let moving=false;
      const cleanup=()=>{
        window.removeEventListener('pointermove',onMove);
        window.removeEventListener('pointerup',onUp);
        window.removeEventListener('pointercancel',onCancel);
        if(activeCanvasGestureRef.current===cleanup)activeCanvasGestureRef.current=null;
      };
      const onMove=ev=>{
        if(ev.pointerId!==pointerId || mobileBlockDrag.current)return;
        const distance=Math.hypot(ev.clientX-initialX,ev.clientY-initialY);
        if(!moving){
          if(distance<8)return;
          // A nonselected item must be tapped to join the selection first.
          if(!wasSelected)return;
          moving=true;
          checkpoint();
        }
        const dx=(ev.clientX-initialX)/zoom,dy=(ev.clientY-initialY)/zoom;
        setLayers(items=>items.map(item=>{
          const origin=origins.get(item.id);
          return origin?{...item,
            x:Math.max(-item.w+28,Math.min(canvasW-28,origin.x+dx)),
            y:Math.max(-item.h+28,Math.min(PAGE_H-28,origin.y+dy))}:item;
        }));
      };
      const onUp=ev=>{
        if(ev.pointerId!==pointerId)return;
        cleanup();
        if(!moving && !mobileBlockDrag.current && Math.hypot(ev.clientX-initialX,ev.clientY-initialY)<8){
          mobileToggleLayerSelection(layer.id);
        }
      };
      const onCancel=ev=>{if(ev.pointerId===pointerId)cleanup();};
      activeCanvasGestureRef.current?.();
      activeCanvasGestureRef.current=cleanup;
      window.addEventListener('pointermove',onMove);
      window.addEventListener('pointerup',onUp);
      window.addEventListener('pointercancel',onCancel);
      return;
    }
    setContextMenu(null);setShapePickerOpen(false);setPanel('edit');
    if(e.shiftKey){
      const next=selectedIds.includes(layer.id)?selectedIds.filter(id=>id!==layer.id):[...selectedIds,layer.id];
      setSelected(next.length===1?next[0]:null);setMultiSelected(next.length>1?next:[]);
      return;
    }
    // A masked photo and its containing shape are one selectable artwork item.
    // A tap selects the pair and shows the ordinary frame: no inspector or crop popup.
    const maskedTapImageId=IS_MOBILE?resolveMaskedImageId(layers,layer):null;
    const ids=new Set(multiSelected.includes(layer.id)?multiSelected:[layer.id]);
    if(layer.groupId)layers.filter(item=>item.groupId===layer.groupId).forEach(item=>ids.add(item.id));
    // Masked image and mask shape always move together. Neither original size is destroyed.
    for(const item of layers){
      if(ids.has(item.id) && item.maskShapeId) ids.add(item.maskShapeId);
      if(item.maskShapeId && ids.has(item.maskShapeId)) ids.add(item.id);
    }
    setSelected(maskedTapImageId||layer.id);
    if(maskedTapImageId && IS_MOBILE){
      // A masked selection is artwork, not an empty workspace pan target.
      mobileCanvasPan.current=null;
      setMobileEditOpen(false);
    }
    // A masked image + its shape move together, but should open ONE layer's
    // inspector, not a multi-selection inspector that hides Detach.
    const isSingleMaskPair=IS_MOBILE && ids.size===2 && (layer.maskShapeId && ids.has(layer.maskShapeId) ||
      (layer.type==='shape' && layers.some(item=>item.maskShapeId===layer.id && ids.has(item.id))));
    setMultiSelected(ids.size>1 && !isSingleMaskPair?[...ids]:[]);
    // A tap doesn't change document data and must not create an undo entry.
    // Record an undo snapshot only once this masked pair actually starts moving.
    if(!maskedTapImageId)checkpoint();
    activeCanvasGestureRef.current?.();
    const startX=e.clientX,startY=e.clientY;
    let holdTriggered=false;
    let holdTimer=null;
    const cancelHold=()=>{if(holdTimer!==null){clearTimeout(holdTimer);holdTimer=null;}};
    if(IS_MOBILE && e.pointerType==='touch'){
      const menuX=e.clientX;
      const menuY=e.clientY;
      holdTimer=setTimeout(()=>{
        holdTimer=null;holdTriggered=true;
        setContextMenu({x:menuX,y:menuY,id:layer.id,selectionIds:[layer.id]});
        setMobileEditOpen(false);
      },550);
    }
    const origins=new Map(layers.filter(item=>ids.has(item.id)).map(item=>[item.id,{x:item.x,y:item.y}]));
    let targetId=null;
    let moved=false;
    // Filling is intentional on Android: the finger must rest INSIDE the
    // shape for 450ms after a drag. Passing across a shape never auto-fills.
    const DROP_DWELL_MS=450;
    const DROP_STILL_PX=12;
    let hoveredShapeId=null;
    let armedShapeId=null;
    let dwellOrigin=null;
    let dwellTimer=null;
    const cancelDwell=()=>{
      if(dwellTimer!==null){clearTimeout(dwellTimer);dwellTimer=null;}
      armedShapeId=null;
      setDropShapeArmed(false);
    };
    const findCurrentDropTarget=ev=>{
      if(layer.type!=='image' || layer.maskShapeId)return null;
      const stage=stageRef.current;
      if(!stage)return null;
      const rect=stage.getBoundingClientRect();
      const dx=(ev.clientX-startX)/zoom,dy=(ev.clientY-startY)/zoom;
      const draggedImage={...layer,x:layer.x+dx,y:layer.y+dy};
      const pointer={x:(ev.clientX-rect.left)/zoom,y:(ev.clientY-rect.top)/zoom};
      return findImageShapeDropTarget(layers,draggedImage,pointer,ids);
    };
    const updateDwell=(target,ev)=>{
      const id=target?.id||null;
      if(id!==hoveredShapeId){
        cancelDwell();hoveredShapeId=id;dwellOrigin=null;
        setDropShapeId(id);
      }
      if(!id)return;
      if(armedShapeId===id)return;
      if(dwellOrigin && Math.hypot(ev.clientX-dwellOrigin.x,ev.clientY-dwellOrigin.y)>DROP_STILL_PX){
        cancelDwell();dwellOrigin=null;
      }
      if(dwellTimer===null){
        dwellOrigin={x:ev.clientX,y:ev.clientY};
        const waitingFor=id;
        dwellTimer=setTimeout(()=>{
          dwellTimer=null;
          if(hoveredShapeId===waitingFor && !mobileBlockDrag.current){
            armedShapeId=waitingFor;
            setDropShapeArmed(true);
          }
        },DROP_DWELL_MS);
      }
    };
    const move=ev=>{
      if(ev.pointerId!==e.pointerId)return;
      if(Math.hypot(ev.clientX-startX,ev.clientY-startY)>8){
        cancelHold();
        if(maskedTapImageId && !moved)checkpoint();
        moved=true;
      }
      if(mobileBlockDrag.current || holdTriggered){
        if(IS_MOBILE){cancelDwell();hoveredShapeId=null;setDropShapeId(null);}
        return;
      }
      // Finger jitter must not shift a selected masked photo.
      if(maskedTapImageId && !moved)return;
      const dx=(ev.clientX-startX)/zoom,dy=(ev.clientY-startY)/zoom;
      if((!IS_MOBILE || moved) && layer.type==='image' && !layer.maskShapeId){
        if(IS_MOBILE){
          // Android retains its deliberate pause-to-fill requirement.
          updateDwell(findCurrentDropTarget(ev),ev);
        }else{
          // Mouse drop targets follow the cursor, not the center of a large photo.
          targetId=findCurrentDropTarget(ev)?.id||null;
          setDropShapeId(previous=>previous===targetId?previous:targetId);
        }
      }
      setLayers(items=>items.map(item=>{
        const orig=origins.get(item.id);
        return orig?{...item,x:Math.max(-item.w+28,Math.min(canvasW-28,orig.x+dx)),y:Math.max(-item.h+28,Math.min(PAGE_H-28,orig.y+dy))}:item;
      }));
    };
    const cleanup=()=>{
      cancelHold();cancelDwell();
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',stop);
      window.removeEventListener('pointercancel',onCancel);
      if(activeCanvasGestureRef.current===cleanup)activeCanvasGestureRef.current=null;
      setDropShapeId(null);
    };
    const stop=ev=>{
      if(ev.pointerId!==e.pointerId)return;
      const canDrop=moved && !holdTriggered && !mobileBlockDrag.current && layer.type==='image' && !layer.maskShapeId;
      // Android still needs an armed dwell target; desktop uses the release cursor.
      // Rechecking on pointerup also prevents a stale target from attaching a photo.
      const target=canDrop ? findCurrentDropTarget(ev) : null;
      const droppedId=IS_MOBILE ? (target?.id===armedShapeId ? armedShapeId : null) : target?.id||null;
      const tappedMask=maskedTapImageId && isMaskedImageTap({
        distance:Math.hypot(ev.clientX-startX,ev.clientY-startY),
        moved,holdTriggered,gestureBlocked:mobileBlockDrag.current
      });
      cleanup();
      if(tappedMask){
        // Selection already happened on pointerdown. No UI change, no crop, no pan.
        return;
      }
      if(canDrop && droppedId)attachImageToShape(layer.id,droppedId);
    };
    const onCancel=ev=>{if(ev.pointerId===e.pointerId)cleanup();};
    activeCanvasGestureRef.current=cleanup;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',onCancel);
  };

  const startResize = (e, layer, handle) => {
    // The mask owns the visible crop bounds. Resizing a hidden masked photo
    // gives misleading handles; reframe it with Adjust photo in shape instead.
    if(IS_MOBILE && layer.type==='image' && layer.maskShapeId)return;
    if(e.button !== 0 || (IS_MOBILE && mobileBlockDrag.current)) return;
    e.stopPropagation();
    e.preventDefault();
    // A filled shape's handles resize its real mask, not the invisible photo
    // rectangle. Keep the image inspector selected throughout the resize.
    const maskedImageId=IS_MOBILE && layer.type==='shape'?resolveMaskedImageId(layers,layer):null;
    setSelected(maskedImageId||layer.id); setMultiSelected([]);
    checkpoint();
    activeCanvasGestureRef.current?.();
    const origin = {x:layer.x,y:layer.y,w:layer.w,h:layer.h};
    const startX=e.clientX, startY=e.clientY;
    const min=18;
    const move=ev=>{
      if(ev.pointerId!==e.pointerId || (IS_MOBILE && mobileBlockDrag.current))return;
      const dx=(ev.clientX-startX)/zoom,dy=(ev.clientY-startY)/zoom;
      let {x,y,w,h}=origin;
      if(handle.includes('e')) w=Math.max(min,origin.w+dx);
      if(handle.includes('s')) h=Math.max(min,origin.h+dy);
      if(handle.includes('w')) {w=Math.max(min,origin.w-dx);x=origin.x+origin.w-w;}
      if(handle.includes('n')) {h=Math.max(min,origin.h-dy);y=origin.y+origin.h-h;}
      setLayers(items=>items.map(item=>{
        if(item.id!==layer.id)return item;
        if(IS_MOBILE && layer.type==='text'){
          const ratio=Math.min(w/Math.max(1,origin.w),h/Math.max(1,origin.h));
          return {...item,x,y,w,h,fontSize:Math.max(8,Math.min(256,Math.round((layer.fontSize||16)*ratio*10)/10))};
        }
        return {...item,x,y,w,h};
      }));
    };
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);if(activeCanvasGestureRef.current===up)activeCanvasGestureRef.current=null;};
    activeCanvasGestureRef.current=up;
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',up);
  };

  const renderLayer = async(ctx,l,offsetX,imageCache=null) => {
      ctx.save();
      if(l.type==='shape'){
        const kind=shapeKind(l),x=l.x-offsetX,y=l.y;
        ctx.fillStyle=l.color;
        if(kind==='ellipse'){
          ctx.beginPath();ctx.ellipse(x+l.w/2,y+l.h/2,l.w/2,l.h/2,0,0,Math.PI*2);ctx.fill();
        }else if(SHAPE_POINTS[kind]){
          const pts=SHAPE_POINTS[kind].split(' ').map(pair=>pair.split(',').map(Number));
          ctx.beginPath();pts.forEach(([px,py],i)=>i===0?ctx.moveTo(x+px*l.w/100,y+py*l.h/100):ctx.lineTo(x+px*l.w/100,y+py*l.h/100));
          ctx.closePath();ctx.fill();
        }else{
          roundRect(ctx,x,y,l.w,l.h,kind==='rectangle'?0:(l.radius||0));ctx.fill();
        }
      } else if(l.type==='text'){
        // The mobile editor and exporter use identical fitting, horizontal
        // alignment and vertical placement. Oversized text shrinks to the
        // selected box instead of being silently cut away on export.
        const boxWidth=Math.max(0,Number(l.w)||0);
        const boxHeight=Math.max(0,Number(l.h)||0);
        if(boxWidth>0 && boxHeight>0){
          const layout=getSharedTextLayout(l);
          const fontFamily=l.fontFamily||'Inter';
          const fontWeight=l.weight||600;
          ctx.font=`${fontWeight} ${layout.fontSize}px "${fontFamily}", Arial, sans-serif`;
          ctx.fillStyle=l.color;
          ctx.textAlign=l.align||'left';
          ctx.textBaseline='alphabetic';
          if('letterSpacing' in ctx)ctx.letterSpacing=`${-0.045*layout.fontSize}px`;
          const x=l.x-offsetX;
          ctx.beginPath();ctx.rect(x,l.y,boxWidth,boxHeight);ctx.clip();
          const baseline=measureTextBaseline(layout.fontSize,fontFamily,fontWeight);
          const inset=layout.edge;
          const textX=l.align==='center'?x+boxWidth/2:l.align==='right'?x+boxWidth-inset:x+inset;
          layout.lines.forEach((line,i)=>{
            ctx.fillText(line,textX,l.y+layout.top+baseline+i*layout.lineHeight);
          });
        }
      } else if(l.type==='image'){
        const mask=layers.find(shape=>shape.id===l.maskShapeId && shape.type==='shape');
        if(mask){
          const x=mask.x-offsetX,y=mask.y;
          ctx.beginPath();
          const kind=shapeKind(mask);
          if(kind==='ellipse')ctx.ellipse(x+mask.w/2,y+mask.h/2,mask.w/2,mask.h/2,0,0,Math.PI*2);
          else if(SHAPE_POINTS[kind])SHAPE_POINTS[kind].split(' ').forEach((p,i)=>{const [px,py]=p.split(',').map(Number);if(i===0)ctx.moveTo(x+px*mask.w/100,y+py*mask.h/100);else ctx.lineTo(x+px*mask.w/100,y+py*mask.h/100);});
          else roundRect(ctx,x,y,mask.w,mask.h,kind==='rounded'?(mask.radius||0):0);
          ctx.closePath();ctx.clip();
        }
        // Reuse decoded images across slides during one export.
        let img=imageCache?.get(l.src);
        if(!img){
          img=imageCache?.preview
            ? await loadPreviewImage(l.src,l.naturalWidth,l.naturalHeight)
            : await loadImage(l.src);
          imageCache?.set(l.src,img);
        }
        if(!mask){
          if(Number.isInteger(l.cropPage) && !IS_MOBILE){ctx.beginPath();ctx.rect(l.cropPage*(PAGE_W+GAP)-offsetX,0,PAGE_W,PAGE_H);ctx.clip();}
          else {roundRect(ctx,l.x-offsetX,l.y,l.w,l.h,l.radius||0);ctx.clip();}
        }
        // Cropping constrains visibility, NOT the image's own transform.
        // Use the live layer rectangle so repositioning in the editor also affects exports.
        if(mask){
          // Same geometry as the live React layer, including mask-relative pan/zoom.
          const crop=getMaskCropGeometry(l,mask,img.width,img.height);
          ctx.drawImage(img,crop.x-offsetX,crop.y,crop.w,crop.h);
        }else{
          const frame=l;
          const ir=img.width/img.height,rr=frame.w/frame.h;let dw,dh,dx,dy;
          if(ir>rr){dh=frame.h;dw=dh*ir;dx=(frame.w-dw)/2;dy=0}else{dw=frame.w;dh=dw/ir;dx=0;dy=(frame.h-dh)/2}
          ctx.drawImage(img,frame.x-offsetX+dx,frame.y+dy,dw,dh);
        }
      }
      ctx.restore();
    };
  const renderSlideCanvas = async(page, outputScale=1, options={}) => {
    const c=document.createElement('canvas');
    c.width=Math.round(PAGE_W*outputScale);
    c.height=Math.round(PAGE_H*outputScale);
    const ctx=c.getContext('2d');
    if(!ctx)throw new Error('Canvas rendering is unavailable.');
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality=options.draft?'low':'high';
    ctx.scale(c.width/PAGE_W,c.height/PAGE_H);
    if(canvasDesign.mode==='gradient'){
      const radians=(canvasDesign.angle-90)*Math.PI/180;
      const dx=Math.cos(radians)*PAGE_W/2,dy=Math.sin(radians)*PAGE_H/2;
      const gradient=ctx.createLinearGradient(PAGE_W/2-dx,PAGE_H/2-dy,PAGE_W/2+dx,PAGE_H/2+dy);
      gradient.addColorStop(0,bg);gradient.addColorStop(1,canvasDesign.secondary);
      ctx.fillStyle=gradient;
    }else ctx.fillStyle=bg;
    ctx.fillRect(0,0,PAGE_W,PAGE_H);
    const orderedLayers=[...layers].sort((a,b)=>(a.z||0)-(b.z||0));
    const offsetX=page*(PAGE_W+GAP);
    let drawn=0;
    for(const layer of orderedLayers){
      // Never decode or draw layers that cannot contribute to this slide.
      const clip=layer.maskShapeId?orderedLayers.find(item=>item.id===layer.maskShapeId):null;
      const bounds=clip||layer;
      if(layer.cropPage!==page && (bounds.x+bounds.w<=offsetX || bounds.x>=offsetX+PAGE_W || bounds.y+bounds.h<=0 || bounds.y>=PAGE_H))continue;
      if(options.cancel?.()) {c.width=0;c.height=0;return null;}
      // Avoid one 16ms frame wait PER layer. Yield periodically so Cancel can paint.
      if(options.cooperative && drawn>0 && drawn%5===0){
        await new Promise(resolve=>setTimeout(resolve,0));
        if(options.cancel?.()){c.width=0;c.height=0;return null;}
      }
      await renderLayer(ctx,layer,offsetX,options.imageCache);
      drawn++;
      if(options.cancel?.()){c.width=0;c.height=0;return null;}
    }
    return c;
  };
  const releasePreviewUrls = () => {
    previewUrlsRef.current.forEach(url=>{if(url)URL.revokeObjectURL(url);});
    previewUrlsRef.current=[];
  };
  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewBusy(false);
    // Mobile preview images stay cached after closing the dialog.
    if(!IS_MOBILE){setPreviewSlides([]);releasePreviewUrls();}
  };
  const openPreview = async () => {
    if(previewBusy)return;
    setPreviewOpen(true);setPreviewError('');setPreviewIndex(0);
    if(IS_MOBILE){
      // Reuse the first slide if it was warmed while the editor was idle.
      setPreviewSlides(Array.from({length:pages},(_,i)=>previewUrlsRef.current[i]||null));
      setPreviewBusy(false);
      return;
    }
    setPreviewBusy(true);
    const urls=[];
    try{
      await document.fonts.ready;
      for(let page=0;page<pages;page++){
        const canvas=await renderSlideCanvas(page,2);
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not render slide.')),'image/png'));
        urls.push(URL.createObjectURL(blob));canvas.width=0;canvas.height=0;
      }
      releasePreviewUrls();
      previewUrlsRef.current=urls;
      setPreviewSlides(urls);
    }catch(error){urls.forEach(url=>URL.revokeObjectURL(url));setPreviewError(error.message);}
    finally{setPreviewBusy(false);}
  };
  // Any edit invalidates cached previews. Debounced idle work below only starts
  // after the editor has stopped receiving changes, and never holds full-size PNGs.
  useEffect(()=>{
    if(!IS_MOBILE)return;
    // Separate mobile preview generation is retired. The export review uses
    // the exact PNGs users can save/share.
    previewGenerationRef.current++;
    const activeSources=new Set(layers.filter(l=>l.type==='image').map(l=>l.src));
    for(const src of mobilePreviewImagesRef.current.keys()){
      if(!activeSources.has(src)){
        const obsolete=mobilePreviewImagesRef.current.get(src);
        obsolete?.close?.();
        mobilePreviewImagesRef.current.delete(src);
      }
    }
    releasePreviewUrls();
    setPreviewSlides(Array(pages).fill(null));
    setPreviewBusy(false);
  },[project,projectGeneration]);
  useEffect(()=>{
    if(IS_MOBILE)return; // No preview warming on mobile while editing.
    let cancelled=false;
    let delayId=null;
    let idleId=null;
    let isIdleRequest=false;
    const generation=previewGenerationRef.current;
    const targetPage=previewOpen?previewIndex:0;
    if(previewUrlsRef.current[targetPage]){
      if(previewOpen)setPreviewSlides(old=>old[targetPage]===previewUrlsRef.current[targetPage]?old:Array.from({length:pages},(_,i)=>previewUrlsRef.current[i]||null));
      return;
    }
    const renderPreview = async()=>{
      if(cancelled || generation!==previewGenerationRef.current)return;
      if(exporting || activeCanvasGestureRef.current || mobileTouchPoints.current.size>0){
        delayId=setTimeout(scheduleWork,500);
        return;
      }
      let canvas;
      if(previewOpen)setPreviewBusy(true);
      try{
        await document.fonts.ready;
        if(cancelled || generation!==previewGenerationRef.current)return;
        // Screen-sized draft only: full resolution remains exclusive to Export.
        // Ultra-light 194px draft for 1080-wide projects; exported PNGs stay full size.
        // Screen-readable preview, not a postage stamp enlarged six times.
        canvas=await renderSlideCanvas(targetPage,0.70,{draft:true,imageCache:mobilePreviewImagesRef.current});
        // Keep at most four decoded source images to limit memory on phones.
        while(mobilePreviewImagesRef.current.size>4){
          const oldest=mobilePreviewImagesRef.current.keys().next().value;
          mobilePreviewImagesRef.current.get(oldest)?.close?.();
          mobilePreviewImagesRef.current.delete(oldest);
        }
        if(cancelled || generation!==previewGenerationRef.current)return;
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not render preview.')),'image/jpeg',0.80));
        if(cancelled || generation!==previewGenerationRef.current)return;
        const url=URL.createObjectURL(blob);
        previewUrlsRef.current[targetPage]=url;
        if(previewOpen)setPreviewSlides(old=>old.map((value,i)=>i===targetPage?url:value));
      }catch(error){
        if(!cancelled && generation===previewGenerationRef.current && previewOpen)setPreviewError(error.message);
      }finally{
        if(canvas){canvas.width=0;canvas.height=0;}
        if(!cancelled && previewOpen && generation===previewGenerationRef.current)setPreviewBusy(false);
      }
    };
    const scheduleWork=()=>{
      if(cancelled)return;
      if(!previewOpen && typeof window.requestIdleCallback==='function'){
        isIdleRequest=true;
        idleId=window.requestIdleCallback(renderPreview); // No forced timeout: editing wins.
      }else{
        delayId=setTimeout(renderPreview,previewOpen?30:900);
      }
    };
    // While editing, silently prepare the first slide after a quiet period.
    // When Preview is open, render the requested slide sooner.
    delayId=setTimeout(scheduleWork,previewOpen?0:800);
    return ()=>{
      cancelled=true;
      if(delayId!==null)clearTimeout(delayId);
      if(isIdleRequest && idleId!==null)window.cancelIdleCallback?.(idleId);
    };
  },[project,projectGeneration,previewOpen,previewIndex,mobilePreviewRefresh,exporting]);
  useEffect(()=>()=>{previewGenerationRef.current++;releasePreviewUrls();
    mobilePreviewImagesRef.current.forEach(img=>img?.close?.());
    mobilePreviewImagesRef.current.clear();},[]);

  const exportBaseName = () => projectName.replace(/\.(frame|json)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim() || 'Untitled';
  const createExportReview = async () => {
    if(exportReviewBusyRef.current || exportReviewBlobsRef.current.length)return;
    exportReviewBusyRef.current=true;
    mobileExportCancelRef.current=false;
    setExporting(true);
    setMobileExportProgress({done:0,total:pages,phase:'Preparing export review'});
    const generated=[];
    const imageCache=new Map();
    try {
      // Paint the dialog and allow the cancellation control to respond.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await document.fonts.ready;
      const title=exportBaseName();
      for(let page=0;page<pages;page++){
        if(mobileExportCancelRef.current)break;
        setMobileExportProgress({done:generated.length,total:pages,phase:`Rendering slide ${page+1} of ${pages}`});
        const canvas=await renderSlideCanvas(page,dims.exportW/PAGE_W,{
          cancel:()=>mobileExportCancelRef.current,cooperative:true,imageCache
        });
        if(!canvas || mobileExportCancelRef.current){
          if(canvas){canvas.width=0;canvas.height=0;}
          break;
        }
        // Encoding is asynchronous, but an encoding already underway may
        // still take time to finish before cancellation completes.
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PNG encoding failed')),'image/png'));
        canvas.width=0;canvas.height=0;
        if(mobileExportCancelRef.current)break;
        generated.push({
          filename:`${title}-slide-${String(page+1).padStart(String(pages).length,2)}.png`,
          blob,url:URL.createObjectURL(blob)
        });
        setMobileExportProgress({done:generated.length,total:pages,phase:`Rendered ${generated.length} of ${pages}`});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(mobileExportCancelRef.current){
        generated.forEach(item=>URL.revokeObjectURL(item.url));
        showMobileSaveFeedback('info','Export review cancelled. No images saved.');
      }else{
        exportReviewBlobsRef.current=generated;
        setExportReview(generated.map(({filename,url})=>({filename,url})));
        setExportReviewIndex(0);
      }
    }catch(error){
      generated.forEach(item=>URL.revokeObjectURL(item.url));
      showMobileSaveFeedback('error',`Could not prepare export review: ${error.message}`);
    }finally{
      imageCache.clear();
      exportReviewBusyRef.current=false;
      setExporting(false);
      setMobileExportProgress(null);
      mobileExportCancelRef.current=false;
    }
  };
  const writeReviewToCache = async item => {
    const {Filesystem,Directory}=await import('@capacitor/filesystem');
    const data=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(new Error('Could not read generated PNG'));
      reader.readAsDataURL(item.blob);
    });
    await Filesystem.writeFile({path:item.filename,directory:Directory.Cache,data});
    return {Filesystem,Directory};
  };
  const saveReviewedImages = async () => {
    if(exportReviewAction)return;
    setExportReviewAction('save');
    if(!exportReviewBlobsRef.current.length)await createExportReview();
    const items=exportReviewBlobsRef.current;
    if(!items.length){setExportReviewAction(null);return;}
    let saved=0;
    setMobileExportProgress({done:0,total:items.length,phase:'Saving images'});
    try{
      for(const item of items){
        setMobileExportProgress({done:saved,total:items.length,phase:`Saving slide ${saved+1} of ${items.length}`});
        if(Capacitor.isNativePlatform()){
          const {Filesystem,Directory}=await writeReviewToCache(item);
          try{await FrameDocument.saveImage({filename:item.filename});}
          finally{await Filesystem.deleteFile({path:item.filename,directory:Directory.Cache}).catch(()=>{});}
        }else{
          const link=document.createElement('a');link.href=item.url;link.download=item.filename;
          document.body.appendChild(link);link.click();link.remove();
        }
        saved++;
        setMobileExportProgress({done:saved,total:items.length,phase:`Saved ${saved} of ${items.length}`});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      showMobileSaveFeedback('success',Capacitor.isNativePlatform()?`${saved} images saved to Pictures/FRAME`:`${saved} PNG downloads started`);
    }catch(error){showMobileSaveFeedback('error',`Save failed (${saved} of ${items.length} saved): ${error.message}`);}
    finally{setMobileExportProgress(null);setExportReviewAction(null);}
  };
  const shareReviewedImages = async () => {
    if(exportReviewAction)return;
    setExportReviewAction('share');
    if(!exportReviewBlobsRef.current.length)await createExportReview();
    const items=exportReviewBlobsRef.current;
    if(!items.length){setExportReviewAction(null);return;}
    const temporary=[];
    try{
      if(Capacitor.isNativePlatform()){
        const {Filesystem,Directory}=await import('@capacitor/filesystem');
        for(const item of items){
          await writeReviewToCache(item);
          temporary.push(item.filename);
        }
        const files=[];
        for(const filename of temporary){
          const {uri}=await Filesystem.getUri({directory:Directory.Cache,path:filename});
          files.push(uri);
        }
        const {Share}=await import('@capacitor/share');
        await Share.share({title:exportBaseName(),files,dialogTitle:'Share FRAME carousel'});
      }else if(navigator.canShare && navigator.share){
        const files=items.map(item=>new File([item.blob],item.filename,{type:'image/png'}));
        if(!navigator.canShare({files}))throw new Error('This browser cannot share multiple image files. Use Save to device instead.');
        await navigator.share({files,title:exportBaseName()});
      }else{
        throw new Error('Sharing is unavailable here. Use Save to device instead.');
      }
    }catch(error){
      if(error?.name!=='AbortError' && !/cancel/i.test(error?.message||''))showMobileSaveFeedback('error',`Could not share: ${error.message}`);
    }finally{
      if(Capacitor.isNativePlatform()){
        const {Filesystem,Directory}=await import('@capacitor/filesystem');
        for(const filename of temporary)await Filesystem.deleteFile({path:filename,directory:Directory.Cache}).catch(()=>{});
      }
      setExportReviewAction(null);
    }
  };
  const exportSlides = async () => {
    if(IS_MOBILE){setExportReviewIndex(0);setInstantReviewOpen(true);return;}
    if(exporting)return;
    mobileExportCancelRef.current=false;
    desktopExportCancelRef.current=false;
    setExporting(true);
    if(!IS_MOBILE){
      setDesktopExportProgress({done:0,total:pages,phase:'Preparing ZIP'});
      // Let the progress/cancel UI appear before the first expensive PNG render.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }
    if(IS_MOBILE){
      setMobileExportProgress({done:0,total:pages,phase:"Preparing images"});
      // Let the progress UI paint before high-resolution rendering begins.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }
    let saved=0;
    try {
      await document.fonts.ready;
      const title=projectName.replace(/\.(frame|json)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim() || 'Untitled';
      const scale=IS_MOBILE ? 1 : 2; // Android: native 1080px width; desktop retains 2x exports.
      const items=[];
      const exportImages=new Map();
      for(let p=0;p<pages;p++){
        if((IS_MOBILE && mobileExportCancelRef.current) || (!IS_MOBILE && desktopExportCancelRef.current))break;
        if(IS_MOBILE)setMobileExportProgress({done:saved,total:pages,phase:`Rendering slide ${p+1} of ${pages}`});
        else setDesktopExportProgress({done:p,total:pages,phase:`Rendering slide ${p+1} of ${pages}`});
        const c=await renderSlideCanvas(p,dims.exportW*scale/PAGE_W,{
          cancel:()=>IS_MOBILE?mobileExportCancelRef.current:desktopExportCancelRef.current,
          cooperative:true,
          imageCache:exportImages
        });
        if(!c || (IS_MOBILE && mobileExportCancelRef.current) || (!IS_MOBILE && desktopExportCancelRef.current)){if(c){c.width=0;c.height=0;}break;}
        if(IS_MOBILE){
          // Let a pending Cancel tap run before non-interruptible PNG encoding.
          await new Promise(resolve=>setTimeout(resolve,0));
          if(mobileExportCancelRef.current){c.width=0;c.height=0;break;}
        }
        const blob=await new Promise((resolve,reject)=>c.toBlob(value=>value?resolve(value):reject(new Error('PNG encoding failed.')),'image/png'));
        c.width=0;c.height=0;
        if((IS_MOBILE && mobileExportCancelRef.current) || (!IS_MOBILE && desktopExportCancelRef.current))break;
        const filename=`${title}-slide-${String(p+1).padStart(String(pages).length,2)}.png`;
        if(IS_MOBILE && Capacitor.isNativePlatform()){
          setMobileExportProgress(old=>({done:saved,total:pages,stopping:old?.stopping||false,phase:`Saving slide ${p+1} of ${pages}`}));
          // Write one image at a time; avoid retaining a carousel of full-size PNGs.
          const {Filesystem,Directory}=await import('@capacitor/filesystem');
          const base64=await new Promise((resolve,reject)=>{
            const reader=new FileReader();
            reader.onload=()=>resolve(String(reader.result).split(',')[1]);
            reader.onerror=()=>reject(new Error('Could not read PNG data.'));
            reader.readAsDataURL(blob);
          });
          await Filesystem.writeFile({path:filename,directory:Directory.Cache,data:base64});
          try{
            await FrameDocument.saveImage({filename});
            saved++;
          }finally{
            await Filesystem.deleteFile({path:filename,directory:Directory.Cache}).catch(()=>{});
          }
        }else if(IS_MOBILE){
          setMobileExportProgress({done:saved,total:pages,phase:`Downloading slide ${p+1} of ${pages}`});
          const url=URL.createObjectURL(blob);
          const a=document.createElement('a');a.href=url;a.download=filename;
          document.body.appendChild(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(url),60000);
          saved++;
        }else{
          items.push({name:`slide-${String(p+1).padStart(String(pages).length,2)}.png`,bytes:new Uint8Array(await blob.arrayBuffer())});
          setDesktopExportProgress({done:p+1,total:pages,phase:p+1===pages?'Packaging ZIP':`Rendered ${p+1} of ${pages} slides`});
        }
        if(IS_MOBILE)setMobileExportProgress(old=>({done:saved,total:pages,stopping:old?.stopping||false,phase:saved===pages?'Finishing export':`Saved ${saved} of ${pages} slides`}));
        if(IS_MOBILE && mobileExportCancelRef.current)break;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(IS_MOBILE && mobileExportCancelRef.current){
        showMobileSaveFeedback('info',`Export cancelled. ${saved} of ${pages} images saved.`);
      }else if(IS_MOBILE){
        showMobileSaveFeedback('success',Capacitor.isNativePlatform()?`${saved} PNG ${saved===1?'image':'images'} saved to Pictures/FRAME`:`${saved} PNG ${saved===1?'download':'downloads'} started`);
      }else if(desktopExportCancelRef.current){
        showMobileSaveFeedback('info','ZIP export cancelled. No partial file was saved.');
      }else{
        const archive=createZip(items);
        const url=URL.createObjectURL(archive);
        const a=document.createElement('a');a.download=`${title}.zip`;a.href=url;
        document.body.appendChild(a);a.click();a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),60000);
      }
    }catch(error){
      console.error('Export failed:',error);
      const message=`Could not export slides${saved?` (${saved} already saved)`:''}: ${error.message}`;
      if(IS_MOBILE)showMobileSaveFeedback('error',message);
      else alert(message);
    }finally{setExporting(false);setMobileExportProgress(null);setDesktopExportProgress(null);mobileExportCancelRef.current=false;desktopExportCancelRef.current=false;}
  };

  if(!editorReady) return <div className={`app theme-${appTheme}`}><div className="frame-loading" role="status">Opening FRAME project…</div></div>;
  return <div className={`app theme-${appTheme} ${IS_MOBILE ? "frame-mobile" : ""} ${IS_MOBILE && (panel === "style" || panel === "layers" || (panel === "edit" && mobileEditOpen && selectedIds.length)) ? "mobile-inspector-open" : ""} ${gradientButtons?'decor-gradient':''}`} style={{"--accent":accent,"--accent-soft":`${accent}24`,"--brand-primary":brandPrimary,"--toolbar-color":toolbarColor,"--logo-gradient-end":logoGradientEnd,"--export-gradient-end":exportGradientEnd,"--logo-gradient-angle":`${logoGradientAngle}deg`,"--export-gradient-angle":`${exportGradientAngle}deg`}}>
    {!IS_MOBILE && studioHome ? <div className="studio-home" aria-label="FRAME Studio Home">
      <div className="studio-home-header">
        <div className="studio-home-logo"><span className="mark">F</span><div><small>YOUR CREATIVE WORKSPACE</small><strong>FRAME Studio</strong></div></div>
        <div className="studio-home-header-actions"><button type="button" onClick={()=>setAppTheme(t=>t==='dark'?'light':'dark')}>{appTheme==='dark'?<Sun size={17}/>:<Moon size={17}/>} {appTheme==='dark'?'Light mode':'Dark mode'}</button><button type="button" onClick={loadStudioWorks} disabled={studioLibraryBusy}><FolderOpen size={17}/> Refresh projects</button></div>
      </div>
      <div className="studio-home-scroll"><div className="studio-home-inner">
        <div className="studio-home-intro"><small>DESIGN CAROUSELS YOUR WAY</small><h1>Pick up a project, or start something new.</h1><p>Your saved projects stay as native .frame files on Windows. Backups are separate, portable copies.</p>
          <div className="studio-home-actions"><button type="button" className="studio-home-primary" onClick={()=>startStudioProject()}><Plus size={18}/> New carousel</button><button type="button" onClick={openProject}><FolderOpen size={18}/> Open .frame</button><button type="button" onClick={()=>{setStudioHome(false);setStudioHomeNotice('')}}><Move size={18}/> Continue editing {saveState==='Recovered'?'(recovered session)':''}</button></div>
        </div>
        {studioNewDialog && <div className="studio-home-overlay" onPointerDown={e=>{if(e.target===e.currentTarget)setStudioNewDialog(false)}}>
          <form className="studio-home-new-dialog" role="dialog" aria-modal="true" aria-label="Name new carousel" onSubmit={e=>{e.preventDefault();confirmStudioProject()}}>
            <div className="studio-home-dialog-head"><strong>{studioNewTemplate?`New from ${studioNewTemplate.name}`:'New carousel'}</strong><button type="button" title="Close" onClick={()=>setStudioNewDialog(false)}>×</button></div>
            <label htmlFor="studio-new-name">Project name</label><input id="studio-new-name" autoFocus maxLength={110} value={studioNewName} placeholder="My carousel" onChange={e=>setStudioNewName(e.target.value)}/>
            <p>You'll choose where to save the .frame file when you first save.</p>
            {studioHomeNotice&&<p role="alert" className="studio-home-notice">{studioHomeNotice}</p>}
            <div className="studio-home-dialog-buttons"><button type="button" onClick={()=>setStudioNewDialog(false)}>Cancel</button><button type="submit" className="studio-home-primary">Create project</button></div>
          </form>
        </div>}
        {studioHomeNotice && !studioNewDialog && <p role="status" className="studio-home-notice">{studioHomeNotice}</p>}
        {projectError && <p role="alert" className="studio-home-notice">{projectError}</p>}
        <section className="studio-home-featured" aria-label="Featured carousel layouts"><div className="studio-home-section-heading"><div><small>START WITH A LAYOUT</small><h2>Featured presets</h2></div><button type="button" onClick={()=>setStudioTab('presets')}>Browse all presets →</button></div>
          <div className="studio-home-featured-row">{builtInCarouselPresets.slice(0,4).map(item=><button type="button" key={item.id} className="studio-home-featured-card" onClick={()=>startStudioProject(item)}><div className="studio-home-featured-art"><ProjectThumbnail project={item.project}/></div><strong>{item.name}</strong></button>)}</div>
        </section>
        <div className="studio-home-tabs" role="tablist" aria-label="Studio Home sections"><button type="button" role="tab" aria-selected={studioTab==='work'} className={studioTab==='work'?'active':''} onClick={()=>setStudioTab('work')}>Your Work <span>{studioWorks.length}</span></button><button type="button" role="tab" aria-selected={studioTab==='presets'} className={studioTab==='presets'?'active':''} onClick={()=>setStudioTab('presets')}>All Presets</button></div>
        {studioTab==='work'?<section className="studio-home-library" aria-label="Your Work"><div className="studio-home-section-heading"><div><h2>Your Work</h2><p>Recent .frame files on this computer</p></div></div>
          <div className="studio-home-grid">{studioWorks.length ? studioWorks.map(item=><article className="studio-home-project" key={item.path}>
            <button type="button" className="studio-home-project-main" disabled={!!item.error} onClick={()=>openStudioWork(item.path)}><div className="studio-home-project-art">{item.preview?<ProjectThumbnail project={item.preview}/>:<Layers3 size={35}/>}</div><div className="studio-home-project-meta"><strong>{item.name}</strong><span>{item.error || `${item.pages||1} slides · ${new Date(item.updatedAt).toLocaleDateString()}`}</span><small title={item.path}>{item.path}</small></div></button>
            <div className="studio-home-project-commands"><button type="button" title="Save a separate .frame backup" onClick={()=>backupStudioWork(item.path)}><Download size={15}/> Backup</button><button type="button" title="Move project to Recycle Bin" onClick={()=>deleteStudioWork(item.path)}><Trash2 size={15}/> Delete</button></div>
          </article>) : <div className="studio-home-empty"><Layers3 size={28}/><strong>{studioLibraryBusy?'Loading projects…':'No projects saved here yet'}</strong><p>Save a carousel to a .frame file and it will appear in Your Work.</p></div>}</div>
        </section>:<section className="studio-home-library" aria-label="All carousel presets"><div className="studio-home-section-heading"><div><h2>All Presets</h2><p>Use a template, then customize every layer</p></div></div><div className="studio-home-grid">{[...builtInCarouselPresets,...customCarouselPresets].map(item=><button type="button" className="studio-home-preset-card" key={item.id} onClick={()=>startStudioProject(item)}><div className="studio-home-project-art"><ProjectThumbnail project={item.project}/></div><strong>{item.name}</strong><span>{item.description || 'Editable layout'}</span></button>)}</div></section>}
      </div></div>
    </div> : IS_MOBILE && mobileHome ? <div className="frame-home">
      <div className="frame-home-hero">
        <div className="frame-home-brand"><div className="mark">F</div><div><span className="frame-home-eyebrow">YOUR CREATIVE WORKSPACE</span><h1>FRAME</h1></div></div>
        <button type="button" className="frame-home-settings-button" aria-label="Home settings" title="Settings" onClick={()=>setMobileSettingsOpen(true)}><Settings size={20}/></button>
        <p>Make every slide part of the story.</p>
        <div className="frame-home-quick-actions">
          <button className="frame-home-create" type="button" onClick={createMobileProject}><Plus size={19}/> New carousel</button>
          <button className="frame-home-import" type="button" onClick={openProject} title="Import a .frame backup from device files"><FolderOpen size={18}/> Import .frame</button>
        </div>
      </div>
      {mobileNewDialog && <div className="frame-home-settings-backdrop" onClick={()=>setMobileNewDialog(false)}>
        <form className="frame-home-settings-dialog" role="dialog" aria-modal="true" aria-label="Name new carousel" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();confirmMobileProject();}}>
          <div className="frame-home-settings-heading"><strong>New carousel</strong><button type="button" aria-label="Cancel" onClick={()=>setMobileNewDialog(false)}>×</button></div>
          <label className="frame-home-project-label" htmlFor="frame-new-name">Project name</label>
          <input id="frame-new-name" className="frame-home-project-input" autoFocus maxLength={110} value={mobileNewName} onChange={e=>setMobileNewName(e.target.value)} placeholder="My carousel"/>
          {mobileHomeNotice && <p className="frame-home-error" role="alert">{mobileHomeNotice}</p>}
          <div className="frame-home-dialog-actions"><button type="button" onClick={()=>setMobileNewDialog(false)}>Cancel</button><button type="submit" className="primary">Create</button></div>
        </form>
      </div>}
      {mobileSettingsOpen && <div className="frame-home-settings-backdrop" onClick={()=>setMobileSettingsOpen(false)}>
        <section className="frame-home-settings-dialog" role="dialog" aria-modal="true" aria-label="FRAME settings" onClick={event=>event.stopPropagation()}>
          <div className="frame-home-settings-heading"><strong>Settings</strong><button type="button" aria-label="Close settings" onClick={()=>setMobileSettingsOpen(false)}>×</button></div>
          <p>Appearance</p>
          <div className="frame-home-theme-options" role="group" aria-label="Appearance theme">
            <button type="button" className={appTheme==='dark'?'selected':''} aria-pressed={appTheme==='dark'} onClick={()=>setAppTheme('dark')}><Moon size={17}/> Dark</button>
            <button type="button" className={appTheme==='light'?'selected':''} aria-pressed={appTheme==='light'} onClick={()=>setAppTheme('light')}><Sun size={17}/> Light</button>
          </div>
        </section>
      </div>}
      {mobileExitHint && <div className="frame-home-exit-hint" role="status">Press Back again to exit FRAME</div>}
      {projectError && <p className="frame-home-error" role="alert">{projectError}</p>}
      {mobileHomeNotice && !mobileNewDialog && <p className="frame-home-notice" role="status">{mobileHomeNotice}</p>}
      <p className="frame-home-storage-note">Your Work is saved privately inside FRAME. Use <strong>Backup</strong> on a project to export a .frame file, then use <strong>Import .frame</strong> to restore it.</p>
      <section className="frame-home-featured" aria-label="Featured presets">
        <div className="frame-home-section-heading"><div><span className="frame-home-section-kicker">START WITH A LAYOUT</span><h2>Featured presets</h2></div><button type="button" onClick={()=>setMobileHomeTab('presets')}>See all <span aria-hidden="true">›</span></button></div>
        <div className="frame-home-featured-strip">
          {builtInCarouselPresets.slice(0,4).map(item=><button className="frame-home-featured-card" type="button" key={item.id} onClick={()=>useCarouselPreset(item)}><span className="frame-home-featured-art"><MobileMaskedThumbnail project={item.project}/></span><span className="frame-home-featured-name">{item.name}</span></button>)}
        </div>
      </section>
      <div className="frame-home-tabs" role="tablist" aria-label="Home sections">
        <button type="button" role="tab" aria-selected={mobileHomeTab==='work'} className={mobileHomeTab==='work'?'active':''} onClick={()=>setMobileHomeTab('work')}>Your Work <span>{mobileWorks.length}</span></button>
        <button type="button" role="tab" aria-selected={mobileHomeTab==='presets'} className={mobileHomeTab==='presets'?'active':''} onClick={()=>setMobileHomeTab('presets')}>All Presets</button>
      </div>
      {mobileHomeTab==='work' ? <section className="frame-home-library" aria-label="Your Work">
        <div className="frame-home-section-heading"><div><h2>Your Work</h2><p>Pick up where you left off</p></div></div>
        <div className="frame-home-grid">{mobileWorks.length ? mobileWorks.map((item,index)=><div className={`frame-home-tile ${index===0?'frame-home-recent':''}`} key={item.id}>
          <button type="button" className="frame-home-project-open" onClick={()=>openMobileWork(item.id)}><span className="frame-home-art"><MobileMaskedThumbnail project={item.project}/></span><span className="frame-home-tile-details"><strong>{item.name}</strong><span>{item.project?.pages||1} slides · {new Date(item.updatedAt).toLocaleDateString()}</span></span></button>
          <button type="button" className="frame-home-project-backup" aria-label={`Back up ${item.name}`} onClick={()=>exportMobileBackup(item)}><Download size={15}/> Backup</button>
          <button type="button" className="frame-home-project-delete" aria-label={`Delete ${item.name}`} onClick={()=>deleteMobileWork(item.id)}><Trash2 size={17}/></button>
        </div>) : <div className="frame-home-empty"><Layers3 size={26}/><strong>Your canvas is waiting</strong><p>Create a carousel, then save it to see it here.</p></div>}</div>
      </section> : <section className="frame-home-library" aria-label="All presets"><div className="frame-home-section-heading"><div><h2>All Presets</h2><p>Choose a starting point</p></div></div><div className="frame-home-grid">{[...builtInCarouselPresets,...customCarouselPresets].map(item=><button className="frame-home-preset" type="button" key={item.id} onClick={()=>useCarouselPreset(item)}><span className="frame-home-art"><MobileMaskedThumbnail project={item.project}/></span><span className="frame-home-tile-details"><strong>{item.name}</strong><span>{item.description}</span></span></button>)}</div></section>}
    </div> : <><header>
      <div className="brand"><div className="mark" {...(IS_MOBILE ? {role:'button',tabIndex:0,'aria-label':'Go to home',onClick:openMobileHome,onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openMobileHome();}}} : {role:'button',tabIndex:0,'aria-label':'Go to Studio home',onClick:openStudioHome,onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openStudioHome();}}})}>F</div><div><strong>{IS_MOBILE ? 'FRAME MOBILE' : 'FRAME'}</strong>
        <div className="project-title-row">
          {renaming ? <input autoFocus className="project-rename" aria-label="Project name" value={nameDraft}
            onChange={e=>setNameDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') finishRename(); if(e.key==='Escape'){setRenaming(false);setProjectError('');}}}
            onBlur={finishRename}/> : <button className="project-title-button" title="Rename project" onClick={beginRename}>{projectName}</button>}
          <span> · {saveState}</span>
          <button className="projects-toggle" onClick={()=>{if(IS_MOBILE){openMobileHome();return;}setProjectsOpen(v=>!v);refreshRecentProjects();setProjectError('')}} title={IS_MOBILE?'Go to home':'Recent projects'}><FolderOpen size={13}/> {IS_MOBILE?'Home':'Projects'}</button>
        </div>
      </div></div>
      <div className="top-actions">
        <button type="button" className={`autosave-toggle ${autosaveEnabled?'enabled':''}`}
          aria-pressed={autosaveEnabled} title={autosaveEnabled?'Automatic recovery snapshots on':'Automatic recovery snapshots off'}
          onClick={()=>setAutosaveEnabled(v=>!v)}>
          <span className="autosave-dot"/> Autosave {autosaveEnabled?'On':'Off'}
        </button>
        <button className="icon appearance-switch" title={appTheme==='dark'?'Switch to light mode':'Switch to dark mode'} onClick={()=>setAppTheme(t=>t==='dark'?'light':'dark')}>
          {appTheme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button>
        {!IS_MOBILE && <button type="button" className="studio-home-nav" title="Home / Your Work" onClick={openStudioHome}>Home</button>}
        <button className="carousel-presets-trigger" title="Browse carousel layouts and save your own" onClick={()=>{setPresetsOpen(true);setPresetNotice('');setPresetPending(null)}}>Presets</button>
        <button className="icon" title="Open project (Ctrl+O)" onClick={openProject}><FolderOpen size={18}/></button>
        <button className={`icon ${IS_MOBILE && mobileSaveFeedback?.kind==='success' ? 'mobile-save-confirmed' : ''}`} type="button" title={IS_MOBILE?'Save project to Your Work':'Save project (Ctrl+S)'} aria-label={IS_MOBILE?(mobileSaving?'Saving project':'Save project to Your Work'):'Save project'} disabled={IS_MOBILE && mobileSaving} onClick={()=>saveProject(false)}>{IS_MOBILE && mobileSaveFeedback?.kind==='success'?<Check size={18}/>:<Save size={18}/>}</button>
        <button className="icon" onClick={undo} disabled={!history.length}><Undo2 size={18}/></button>
        <button className="icon" onClick={redo} disabled={!future.length}><Redo2 size={18}/></button>
        {!IS_MOBILE && <button className="preview-action" type="button" onClick={openPreview} disabled={previewBusy} title="Preview individual slides without editor guides">Preview</button>}
        <button className="export" onClick={exportSlides} disabled={exporting}><Download size={17}/> {exporting ? "Preparing…" : IS_MOBILE ? (exportReview.length ? "Export review" : "Export") : "Export ZIP"}</button>
      </div>
    </header>
    {!IS_MOBILE && desktopExportProgress && <div className="studio-export-progress" role="status" aria-label="Studio ZIP export progress">
      <div><strong>{desktopExportProgress.phase}</strong><span>{desktopExportProgress.done} / {desktopExportProgress.total}</span></div>
      <div className="studio-export-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={desktopExportProgress.total} aria-valuenow={desktopExportProgress.done}><div style={{width:`${desktopExportProgress.total?100*desktopExportProgress.done/desktopExportProgress.total:0}%`}}/></div>
      <button type="button" disabled={desktopExportCancelRef.current} onClick={()=>{desktopExportCancelRef.current=true;setDesktopExportProgress(p=>p?{...p,phase:'Cancelling…'}:p)}}>Cancel export</button>
    </div>}
    {IS_MOBILE && mobileExportProgress && !instantReviewOpen && <div className="mobile-export-progress" role="status" aria-live="polite" aria-label="Image export progress">
      <div className="mobile-export-progress-row"><strong>{mobileExportProgress.phase}</strong><span>{mobileExportProgress.done} / {mobileExportProgress.total} ready</span></div>
      <div className="mobile-export-progress-track" role="progressbar" aria-label="Images saved" aria-valuemin={0} aria-valuemax={mobileExportProgress.total} aria-valuenow={mobileExportProgress.done}>
        <div className="mobile-export-progress-fill" style={{width:`${mobileExportProgress.total?100*mobileExportProgress.done/mobileExportProgress.total:0}%`}} />
      </div>
      {exporting && <button className="mobile-export-cancel" type="button" aria-label="Cancel export" onPointerDownCapture={e=>{
        // Set the flag on the first finger contact, before the synthetic click.
        if(e.pointerType==='touch')mobileExportCancelRef.current=true;
      }} onClick={()=>{mobileExportCancelRef.current=true;}}>Cancel export</button>}
    </div>}
    {IS_MOBILE && instantReviewOpen && <div className="frame-export-review-overlay">
      <section className="frame-export-review" role="dialog" aria-modal="true" aria-label="Review generated carousel images">
        <div className="frame-export-review-heading">
          <div><strong>Carousel review</strong><small>Live layout. PNGs are generated when you Save or Share.</small></div>
          <button type="button" aria-label="Close export review" disabled={!!exportReviewAction} onClick={disposeExportReview}>×</button>
        </div>
        <div className="frame-export-review-stage">
          <button type="button" aria-label="Previous slide" disabled={exportReviewIndex===0 || !!exportReviewAction} onClick={()=>setExportReviewIndex(i=>Math.max(0,i-1))}>‹</button>
          <div className="frame-export-review-viewport" ref={liveReviewViewportRef}>
            <div className="frame-live-review-page" style={{width:PAGE_W*liveReviewScale,height:PAGE_H*liveReviewScale}} aria-label={`Slide ${exportReviewIndex+1} of ${pages}`}>
              <div className="frame-live-review-content" style={{width:PAGE_W,height:PAGE_H,background:canvasBackground(bg,canvasDesign),transform:`scale(${liveReviewScale})`}}>
                <div style={{position:'absolute',left:-exportReviewIndex*(PAGE_W+GAP),top:0,width:canvasW,height:PAGE_H}}>
                  {[...layers].filter(layer=>{
                    // A masked image belongs to the slide containing its SHAPE, not its original free-image rectangle.
                    const frame=layer.maskShapeId?layers.find(shape=>shape.id===layer.maskShapeId && shape.type==='shape')||layer:layer;
                    return frame.x < (exportReviewIndex+1)*(PAGE_W+GAP) && frame.x+frame.w > exportReviewIndex*(PAGE_W+GAP);
                  }).sort((a,b)=>(a.z||0)-(b.z||0)).map(layer=><Layer key={layer.id} layer={{...layer,pageWidth:PAGE_W,pageHeight:PAGE_H}} displayMask={layer.type==='image'&&layer.maskShapeId?layers.find(x=>x.id===layer.maskShapeId):null} selected={false} clipPath={layer.type==='image'&&layer.maskShapeId?shapeClipPath(layers.find(x=>x.id===layer.maskShapeId)):null}/>) }
                </div>
              </div>
            </div>
          </div>
          <button type="button" aria-label="Next slide" disabled={exportReviewIndex===pages-1 || !!exportReviewAction} onClick={()=>setExportReviewIndex(i=>Math.min(pages-1,i+1))}>›</button>
        </div>
        <div className="frame-export-review-counter">Slide {exportReviewIndex+1} of {pages} · Live layout</div>
        {mobileExportProgress && <div className="frame-review-progress" role="status" aria-live="polite">
          <div className="mobile-export-progress-row"><strong>{mobileExportProgress.phase}</strong><span>{mobileExportProgress.done} / {mobileExportProgress.total}</span></div>
          <div className="mobile-export-progress-track" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={mobileExportProgress.total} aria-valuenow={mobileExportProgress.done}>
            <div className="mobile-export-progress-fill" style={{width:`${mobileExportProgress.total?100*mobileExportProgress.done/mobileExportProgress.total:0}%`}} />
          </div>
          {exporting && <button className="mobile-export-cancel" type="button" onPointerDownCapture={e=>{if(e.pointerType==='touch')mobileExportCancelRef.current=true;}} onClick={()=>{mobileExportCancelRef.current=true;}}>Cancel export</button>}
        </div>}
        <div className="frame-export-review-actions">
          <button type="button" disabled={!!exportReviewAction} onClick={saveReviewedImages}><Download size={16}/> {exportReviewAction==='save'?'Saving…':'Save to device'}</button>
          <button type="button" disabled={!!exportReviewAction} onClick={shareReviewedImages}><ImagePlus size={16}/> {exportReviewAction==='share'?'Sharing…':'Share'}</button>
        </div>
        {exportReviewAction && <p className="frame-export-review-status">{exportReviewAction==='save'?'Saving images…':'Opening Android sharing…'}</p>}
      </section>
    </div>}
    {mobileSaveFeedback && <div className={`${IS_MOBILE?'mobile-save-feedback':'studio-save-feedback'} mobile-save-${mobileSaveFeedback.kind}`} role="status" aria-live="polite"><span>{mobileSaveFeedback.kind==='success'?<Check size={17}/>:<Save size={17}/>}</span>{mobileSaveFeedback.message}</div>}
    {previewOpen && <div className="instagram-preview-overlay" onPointerDown={e=>{if(e.target===e.currentTarget)closePreview()}}>
      <section className="instagram-preview-dialog" role="dialog" aria-modal="true" aria-label="Instagram carousel preview">
        <div className="instagram-preview-header"><div><b>Instagram carousel preview</b><span>Each slide as exported, without editing guides</span></div><button type="button" onClick={closePreview} aria-label="Close preview">×</button></div>
        {previewError?<p className="preview-error">{previewError}</p>:previewSlides.length>0?<>
          <div className="instagram-preview-stage">
            <button className="preview-nav" type="button" onClick={()=>setPreviewIndex(i=>Math.max(0,i-1))} disabled={previewIndex===0} aria-label="Previous slide">‹</button>
            {previewSlides[previewIndex]?<img className="instagram-preview-image" src={previewSlides[previewIndex]} alt={`Slide ${previewIndex+1} of ${previewSlides.length}`} />:<p className="preview-loading">Rendering slide…</p>}
            <button className="preview-nav" type="button" onClick={()=>setPreviewIndex(i=>Math.min(previewSlides.length-1,i+1))} disabled={previewIndex===previewSlides.length-1} aria-label="Next slide">›</button>
          </div>
          <div className="instagram-preview-footer"><span>Slide {previewIndex+1} / {previewSlides.length}</span><div className="preview-dots">{previewSlides.map((_,i)=><button key={i} className={i===previewIndex?'active':''} onClick={()=>setPreviewIndex(i)} aria-label={`Show slide ${i+1}`} />)}</div><button type="button" onClick={IS_MOBILE?()=>{previewGenerationRef.current++;releasePreviewUrls();setPreviewSlides(Array(pages).fill(null));setMobilePreviewRefresh(n=>n+1);}:openPreview}>Refresh</button></div>
        </>:null}
      </section>
    </div>}
    {presetsOpen && <div className="carousel-presets-overlay" onPointerDown={e=>{if(e.target===e.currentTarget)setPresetsOpen(false)}}>
      <section className="carousel-presets-dialog" role="dialog" aria-modal="true" aria-label="Carousel presets">
        <div className="carousel-presets-title"><div><b>Carousel presets</b><span>Start from a layout or save your own</span></div><button type="button" onClick={()=>setPresetsOpen(false)} aria-label="Close presets">×</button></div>
        <div className="carousel-presets-save"><div><strong>Save current carousel as preset</strong><small>Saves slide layouts and styling; photos become editable placeholders to keep storage small.</small></div><div className="carousel-presets-save-input"><input aria-label="Preset name" placeholder="My carousel layout" value={presetName} onChange={e=>setPresetName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveCarouselPreset()}}/><button type="button" onClick={saveCarouselPreset}>Save as Preset</button></div></div>
        {presetNotice && <p className="carousel-presets-feedback" role="status">{presetNotice}</p>}
        <div className="carousel-presets-scroll">
          {[{label:'Built-in layouts',items:builtInCarouselPresets},{label:'My presets',items:customCarouselPresets}].map(section=><div className="carousel-presets-section" key={section.label}>
            <h3>{section.label}</h3>
            <div className="carousel-presets-grid">{section.items.map(item=><article key={item.id} className="carousel-preset-card">
              <div className="carousel-preset-preview">{Array.from({length:Math.min(item.project.pages||3,4)},(_,i)=><CarouselPresetThumbnail key={i} project={item.project} page={i}/>)}</div>
              <div className="carousel-preset-meta"><strong>{item.name}</strong><small>{item.description||`${item.project.pages} slides`}</small></div>
              <div className="carousel-preset-actions"><button type="button" onClick={()=>setPresetPending(item)}>Use preset</button>{section.label==='My presets'&&<button type="button" className="carousel-preset-delete" onClick={()=>removeCarouselPreset(item.id)}>Delete</button>}</div>
            </article>)}</div>
            {!section.items.length&&<p className="carousel-preset-empty">No custom presets saved yet.</p>}
          </div>)}
        </div>
        {presetPending && <div className="carousel-preset-confirm" role="alertdialog" aria-label="Create project from preset"><b>Create a new project using “{presetPending.name}”?</b><p>Your current project will be closed. Save it first if you have unsaved changes. The original saved file won't be overwritten.</p><div><button type="button" onClick={()=>setPresetPending(null)}>Cancel</button><button type="button" onClick={()=>useCarouselPreset(presetPending)}>Create new project</button></div></div>}
      </section>
    </div>}
    {projectsOpen && <div className="projects-overlay" onPointerDown={e=>{if(e.target===e.currentTarget)setProjectsOpen(false)}}>
      <section className="projects-dialog" role="dialog" aria-label={IS_MOBILE?'Saved projects':'Recent projects'}>
        <div className="projects-dialog-heading"><b>{IS_MOBILE?'Saved on this device':'Recent projects'}</b><button onClick={()=>setProjectsOpen(false)}>Close</button></div>
        <button className="projects-open-file" onClick={async()=>{await openProject();setProjectsOpen(false)}}><FolderOpen size={16}/> Browse for project...</button>
        {recentProjects.length ? recentProjects.map(item=><button key={item.id || item.path} className="recent-project" onClick={()=>openRecentProject(IS_MOBILE?item.id:item.path)}>
          <strong>{item.name}</strong><small>{IS_MOBILE?`Saved locally · ${new Date(item.updatedAt).toLocaleString()}`:item.path}</small>
        </button>) : <p>{IS_MOBILE?'No local projects yet. Tap Save, then reopen Your Work.':'No recent projects yet. Save or open a .frame project to see it here.'}</p>}
        {projectError && <p className="project-error">{projectError}</p>}
      </section>
    </div>}
    {!projectsOpen && projectError && <div className="project-error-banner" onClick={()=>setProjectError('')}>{projectError} ×</div>}

    <main className="resizable-editor" style={{"--rail-width":`${railWidth}px`,"--inspector-width":`${inspectorWidth}px`}}>
      <aside className="rail">
        <button className={panel==='edit'?'active':''} onClick={()=>{if(IS_MOBILE){setMobileEditOpen(open=>!(panel==='edit'&&open));}setPanel('edit');setShapePickerOpen(false)}}><Move/><span>Edit</span></button>
        <button className={photoPickerOpen?'active':''} onClick={()=>{setPhotoPickerOpen(v=>!v);setTextPickerOpen(false);setShapePickerOpen(false)}}><ImagePlus/><span>Photos</span></button>
        <button className={textPickerOpen?'active':''} onClick={()=>{setTextPickerOpen(v=>!v);setPhotoPickerOpen(false);setShapePickerOpen(false)}}><Type/><span>Text</span></button>
        <button ref={shapeButtonRef} className={shapePickerOpen?'active':''} onClick={()=>{setShapePickerOpen(open=>!open);setPhotoPickerOpen(false);setTextPickerOpen(false)}}><Shapes/><span>Shape</span></button>
        <button className={panel==='layers'?'active':''} onClick={()=>{setPanel(p=>IS_MOBILE&&p==='layers'?'edit':'layers');setShapePickerOpen(false)}}><Layers3/><span>Layers</span></button>
        <button className={panel==='style'?'active':''} onClick={()=>{setPanel(p=>IS_MOBILE&&p==='style'?'edit':'style');setShapePickerOpen(false)}}><Palette/><span>Style</span></button>
      </aside>
      <div className="panel-splitter" role="separator" aria-orientation="vertical" aria-label="Resize left toolbar" onPointerDown={e=>startPanelResize(e,'left')} />

      <section className="workspace" onPointerDownCapture={mobileTouchDown} onPointerMoveCapture={mobileTouchMove}
        onPointerUpCapture={mobileTouchUp} onPointerCancelCapture={mobileTouchUp} onPointerDown={e=>{if(e.button===2 || e.target.closest('.layer,.mobile-mask-selection-frame'))return;clearSelection();setShapePickerOpen(false);setContextMenu(null)}} onContextMenu={e=>{
        e.preventDefault();
        // Android's synthetic contextmenu can arrive after the long-press timer.
        // Never replace a valid layer menu with an empty-workspace menu.
        if(IS_MOBILE || e.target.closest('.layer')) return;
        rememberCanvasCursor(e);
        const rect=e.currentTarget.getBoundingClientRect();
        setContextMenu({id:null,point:cursorOnCanvasRef.current,x:Math.max(8,Math.min(e.clientX-rect.left,rect.width-208)),y:Math.max(8,Math.min(e.clientY-rect.top,rect.height-235))});
      }}>
        {textPickerOpen && <div ref={textPickerRef} className="rail-picker text-add-picker" onPointerDown={e=>e.stopPropagation()}>
          <div className="shape-picker-title">Add text <button title="Close" onClick={()=>setTextPickerOpen(false)}>×</button></div>
          <p className="rail-picker-hint">Choose a font to place editable text on the visible slide.</p>
          <div className="text-add-options">{FONT_OPTIONS.map(font=><button key={font} onClick={()=>addText(font)}><span>{font}</span><strong style={{fontFamily:`"${font}", sans-serif`}}>Your story begins here</strong></button>)}</div>
        </div>}
        {photoPickerOpen && <div ref={photoPickerRef} className="rail-picker photo-add-picker" onPointerDown={e=>e.stopPropagation()}>
          <div className="shape-picker-title">Add a photo <button title="Close" onClick={()=>setPhotoPickerOpen(false)}>×</button></div>
          <button className="photo-import" onClick={()=>photoPickerInputRef.current?.click()}><ImagePlus size={17}/> Import photos...</button>
          <input ref={photoPickerInputRef} type="file" accept="image/*" multiple hidden onChange={e=>{onImages(e.target.files);e.target.value='';setPhotoPickerOpen(false)}} />
          <p className="rail-picker-hint">Photos from this project. Thumbnails reuse the original image data.</p>
          {projectPhotos.length?<div className="photo-picker-grid">{projectPhotos.map((photo,i)=><button key={i} title="Add another copy" onClick={()=>insertProjectPhoto(photo)}><img src={photo.src} draggable="false" alt={`Project photo ${i+1}`}/></button>)}</div>:<p className="rail-picker-empty">No photos in this project yet. Import some to start.</p>}
        </div>}
        {shapePickerOpen && <div ref={shapePickerRef} className="shape-picker" onPointerDown={e=>e.stopPropagation()}>
          <div className="shape-picker-title">Add a shape <button title="Close" onClick={()=>setShapePickerOpen(false)}>×</button></div>
          <div className="shape-picker-grid">{SHAPES.map(item=><button key={item.id} onClick={()=>addShape(item.id)} title={item.label}>
            <ShapePreview shape={item.id}/><span>{item.label}</span>
          </button>)}</div>
        </div>}

        <div className="workspace-title">
          <div><b>Canvas</b><span>{pages} slides · {dims.label} · {dims.exportW}×{dims.exportH}</span></div>
          <div className="workspace-controls">
            <div className="orientation-toggle" onPointerDown={e=>e.stopPropagation()}>
              <button className={orientation==='portrait'?'selected':''} title="Portrait 4:5" onClick={()=>changeOrientation('portrait')}><RectangleVertical size={15}/> Portrait</button>
              <button className={orientation==='landscape'?'selected':''} title="Landscape 5:4" onClick={()=>changeOrientation('landscape')}><RectangleHorizontal size={15}/> Landscape</button>
            </div>
            <div className="page-stepper" onPointerDown={e=>e.stopPropagation()}>
              <button title="Remove final slide" onClick={()=>{if(pages>1){if(skipSlideWarning)removeLastSlide();else {setSkipSlideWarningDraft(false);setConfirmRemoveSlide(true);}}}}><Minus/></button>
              <strong>{pages}</strong>
              <button onClick={()=>{if(pages<20){checkpoint();setPages(p=>p+1)}}}><Plus/></button>
            </div>
          </div>
        </div>
        {confirmRemoveSlide && <div className="slide-remove-overlay" onPointerDown={e=>e.stopPropagation()}>
          <div className="slide-remove-dialog" role="alertdialog" aria-modal="true" aria-label="Remove final slide">
            <b>Remove slide {pages}?</b>
            <p>Objects on this slide will be deleted.</p>
            <label className="slide-warning-skip"><input type="checkbox" checked={skipSlideWarningDraft} onChange={e=>setSkipSlideWarningDraft(e.target.checked)}/> Don't show again this session</label>
            <div className="slide-remove-actions"><button onClick={()=>setConfirmRemoveSlide(false)}>Cancel</button><button className="danger" onClick={()=>{if(skipSlideWarningDraft)setSkipSlideWarning(true);removeLastSlide()}}>Remove</button></div>
          </div>
        </div>}
        <div className="stage-scroller" ref={stageScrollerRef}
          onPointerDown={startWorkspacePan} onAuxClick={e=>{if(e.button===1)e.preventDefault()}}>
          <div className="stage-wrap" style={{width:canvasW*zoom,height:PAGE_H*zoom}}>
            <div className="stage" key={projectGeneration} onDragStart={e=>e.preventDefault()} onSelectStart={e=>e.preventDefault()} ref={stageRef} onPointerMove={rememberCanvasCursor} onPointerLeave={()=>{cursorOnCanvasRef.current=null;}} style={{width:canvasW,height:PAGE_H,background:canvasBackground(bg,canvasDesign),transform:`scale(${zoom})`}}>
              {!IS_MOBILE && canvasDesign.showGuides && Array.from({length:pages-1},(_,i)=><div className={`seam ${layers.some(layer=>layer.type==='image' && layer.cropPage===i)?'seam-over-fill':''}`} key={i} style={{left:(i+1)*PAGE_W+i*GAP}}><span>{i+1}</span><span>{i+2}</span></div>)}
              {[...layers].sort((a,b)=>(a.z||0)-(b.z||0)).map(l=><Layer key={l.id} layer={{...l,pageWidth:PAGE_W,pageHeight:PAGE_H}} displayMask={l.type==='image'&&l.maskShapeId?layers.find(x=>x.id===l.maskShapeId):null} selected={selectedIds.includes(l.id) && maskCropImageId!==l.id && !(IS_MOBILE && (l.type==='image' && !!l.maskShapeId || l.type==='shape' && layers.some(item=>item.type==='image' && item.maskShapeId===l.id)))} dropTarget={dropShapeId===l.id} clipPath={l.type==='image'&&l.maskShapeId?shapeClipPath(layers.find(x=>x.id===l.maskShapeId)):null} onPointerDown={e=>startDrag(e,l)} onResize={(e,handle)=>startResize(e,l,handle)} onContextMenu={e=>openLayerMenu(e,l)} onDoubleClick={()=>{
                if(IS_MOBILE){
                  const maskedImageId=resolveMaskedImageId(layers,l);
                  if(maskedImageId){setSelected(maskedImageId);setMultiSelected([]);setPanel('edit');setMobileEditOpen(true);return;}
                  setSelected(l.id);
                  setPanel('edit');
                  setMobileEditOpen(true);
                  return;
                }
                if(l.type==='text'){const t=prompt('Edit text',l.text); if(t!==null){checkpoint();setSelected(l.id);setLayers(v=>v.map(x=>x.id===l.id?{...x,text:t}:x));}}
              }}/>) }
              {!IS_MOBILE && dropShapeId && (()=>{
                const shape=layers.find(item=>item.id===dropShapeId && item.type==='shape');
                if(!shape)return null;
                return <div className="studio-shape-drop-overlay" aria-hidden="true"
                  style={{left:shape.x,top:shape.y,width:shape.w,height:shape.h,
                    borderRadius:shapeKind(shape)==='ellipse'?'50%':shapeKind(shape)==='rounded'?(shape.radius||0):0}}>
                  <div className="studio-shape-drop-fill" style={{clipPath:shapeClipPath(shape)}}/>
                </div>;
              })()}
              {!IS_MOBILE && studioResizeLayers.length>0 && <div className="studio-resize-overlay">
                {studioResizeLayers.flatMap(layer=>['nw','n','ne','e','se','s','sw','w'].map(handle=><i
                  key={`${layer.id}-${handle}`} className={`studio-resize-grip handle-${handle}`}
                  role="button" aria-label={`Resize ${layer.type} ${handle}`}
                  style={{left:layer.x+layer.w*({'nw':0,'n':.5,'ne':1,'e':1,'se':1,'s':.5,'sw':0,'w':0}[handle]),
                    top:layer.y+layer.h*({'nw':0,'n':0,'ne':0,'e':.5,'se':1,'s':1,'sw':1,'w':.5}[handle])}}
                  onPointerDown={event=>startResize(event,layer,handle)}/>))}
              </div>}
              {IS_MOBILE && !maskCropImageId && selectedIds.length===1 && (()=>{
                // The normal image handles are hidden for masked photos. Show a
                // dedicated outline around the VISIBLE mask so selection is clear.
                // Render it above the layers: the photo's clip-path would hide
                // an outline applied directly to its image element.
                const active=layers.find(item=>item.id===selectedIds[0]);
                const mask=active?.type==='shape' ? active : active?.maskShapeId
                  ? layers.find(item=>item.type==='shape' && item.id===active.maskShapeId) : null;
                if(!mask || !layers.some(item=>item.type==='image' && item.maskShapeId===mask.id))return null;
                const w=Math.max(1,mask.w),h=Math.max(1,mask.h),kind=shapeKind(mask);
                const stroke=Math.max(2.2,Math.min(3.2,Math.min(w,h)*.022));
                return <div className="mobile-mask-selection-frame" aria-label="Selected photo frame" style={{left:mask.x,top:mask.y,width:w,height:h}} onPointerDown={e=>startDrag(e,active)} onContextMenu={e=>openLayerMenu(e,active)}>
                  <svg className="mobile-mask-selection-outline" aria-hidden="true"
                    style={{left:-4,top:-4,width:w+8,height:h+8}}
                    viewBox={`-4 -4 ${w+8} ${h+8}`} preserveAspectRatio="none">
                    {kind==='ellipse' ? <ellipse cx={w/2} cy={h/2} rx={w/2} ry={h/2} strokeWidth={stroke}/> :
                      SHAPE_POINTS[kind] ? <polygon points={SHAPE_POINTS[kind].split(' ').map(pair=>{
                        const [x,y]=pair.split(',').map(Number);return `${w*x/100},${h*y/100}`;
                      }).join(' ')} strokeWidth={stroke}/> :
                      <rect x={0} y={0} width={w} height={h} rx={kind==='rounded'?Math.max(0,mask.radius||0):0} strokeWidth={stroke}/>}
                  </svg>
                  {['nw','n','ne','e','se','s','sw','w'].map(handle=><i key={handle}
                    className={`resize-handle handle-${handle} mobile-mask-resize-handle`}
                    aria-label={`Resize photo frame ${handle}`}
                    style={{left:`${100*({'nw':0,'n':.5,'ne':1,'e':1,'se':1,'s':.5,'sw':0,'w':0}[handle])}%`,
                      top:`${100*({'nw':0,'n':0,'ne':0,'e':.5,'se':1,'s':1,'sw':1,'w':.5}[handle])}%`}}
                    onPointerDown={e=>startResize(e,mask,handle)}/>)}
                </div>;
              })()}
              {IS_MOBILE && maskCropImage && maskCropShape && <div className="mobile-mask-crop-target" role="application" aria-label="Drag to reposition photo within shape"
                style={{left:maskCropShape.x,top:maskCropShape.y,width:maskCropShape.w,height:maskCropShape.h,clipPath:shapeClipPath(maskCropShape)}}
                onPointerDown={startMaskCropDrag} onContextMenu={e=>e.preventDefault()}/>}
              {IS_MOBILE && dropShapeId && (()=>{
                const target=layers.find(item=>item.id===dropShapeId && item.type==='shape');
                if(!target)return null;
                return <div className={`mobile-shape-drop-overlay ${dropShapeArmed?'is-armed':'is-pending'}`} aria-hidden="true" style={{left:target.x,top:target.y,width:target.w,height:target.h,borderRadius:shapeKind(target)==='ellipse'?'50%':shapeKind(target)==='rounded'?target.radius||0:0}}>
                  <span>{dropShapeArmed?'Release to fill shape':'Hold to fill shape'}</span>
                </div>;
              })()}
              {IS_MOBILE && Array.from({length:Math.max(0,pages-1)},(_,i)=><div key={`mobile-boundary-${i}`} className="mobile-slide-boundary" aria-hidden="true" style={{left:(i+1)*PAGE_W+i*GAP}} />)}
            </div>
          </div>
        </div>
        {IS_MOBILE && maskCropImage && maskCropShape && <div className="mobile-mask-crop-controls" role="group" aria-label="Photo crop controls" onPointerDown={e=>e.stopPropagation()}>
          <div className="mobile-mask-crop-title"><strong>Adjust photo in shape</strong><span>Drag or pinch the photo. Shape stays fixed.</span></div>
          <div className="mobile-mask-crop-zoom"><label htmlFor="mobile-mask-zoom">Zoom</label><input id="mobile-mask-zoom" type="range" min="1" max="4" step="0.05" value={clampMaskZoom(maskCropImage.maskZoom)} onChange={e=>changeMaskCropZoom(e.target.value)}/><span>{Math.round(clampMaskZoom(maskCropImage.maskZoom)*100)}%</span></div>
          <div className="mobile-mask-crop-buttons"><button type="button" onClick={resetMaskCrop}>Reset</button><button className="primary" type="button" onClick={finishMaskCrop}>Done</button></div>
        </div>}
        {IS_MOBILE && mobileMultiMode && <div className="mobile-multi-actions" onPointerDown={e=>e.stopPropagation()}>
          <span>{selectedIds.length} selected</span>
          <button type="button" className="primary" disabled={selectedIds.length<2} onClick={groupMobileSelection}><Layers3 size={16}/> Group</button>
          <button type="button" onClick={()=>{setMobileMultiMode(false);setMultiSelected([]);setSelected(null);}}>Cancel</button>
        </div>}
        {IS_MOBILE && selectedIds.length>0 && !maskCropImageId && !mobileMultiMode && panel==='edit' && !mobileEditOpen && mobileEditPosition && !contextMenu &&
          <button type="button" className="mobile-context-edit" style={mobileEditPosition}
            onPointerDown={e=>e.stopPropagation()}
            onClick={e=>{e.stopPropagation();setPanel('edit');setMobileEditOpen(true);}}
            aria-label="Edit selected object" title="Edit selected object"><SlidersHorizontal size={15}/> Edit</button>}
        {contextMenu && <div ref={mobileContextMenuRef} className="layer-context-menu" role="menu" style={{left:contextMenu.x,top:contextMenu.y}} onPointerDown={e=>e.stopPropagation()}>
          {IS_MOBILE && <button role="menuitem" onClick={()=>{setMobileMultiMode(true);setSelected(contextMenu.id);setMultiSelected([]);setContextMenu(null);setMobileEditOpen(false)}}>Select multiple</button>}
          {IS_MOBILE && contextMaskedImage && <button role="menuitem" onClick={()=>beginMaskCrop(contextMaskedImage.id)}><SlidersHorizontal size={15}/> Adjust photo in shape</button>}
          {IS_MOBILE && contextMaskedImage && <button role="menuitem" onClick={()=>{detachImageFromShape(contextMaskedImage.id);setContextMenu(null)}}>Detach image from shape</button>}
          <button role="menuitem" disabled={!contextMenu.id || layerAtFront(contextMenu.id)} onClick={()=>contextAction('front')}><Layers3 size={15}/> Bring to front</button>
          <button role="menuitem" disabled={!contextMenu.id || layerAtBack(contextMenu.id)} onClick={()=>contextAction('back')}><Layers3 size={15}/> Send to back</button>
          <button role="menuitem" onClick={()=>contextAction('copy')} disabled={!contextMenu.id}><Copy size={15}/> Copy</button>
          <button role="menuitem" onClick={()=>contextAction('paste')} disabled={!layerClipboardRef.current}><Copy size={15}/> Paste</button>
          <button role="menuitem" onClick={()=>contextAction('duplicate')} disabled={!contextMenu.id}><Copy size={15}/> Duplicate</button>
          {contextMenu.selectionIds?.length>1 && <button role="menuitem" onClick={()=>contextAction('group')}><Layers3 size={15}/> Group {contextMenu.selectionIds.length} selected layers</button>}
          {layers.find(x=>x.id===contextMenu.id)?.groupId && <button role="menuitem" onClick={()=>contextAction('ungroup')}>Ungroup</button>}
          {layers.find(x=>x.id===contextMenu.id)?.type==='image' && <button role="menuitem" onClick={()=>contextAction('fitPage')}>Fit image to page</button>}
          {layers.find(x=>x.id===contextMenu.id)?.type==='image' && <button role="menuitem" onClick={()=>contextAction('fillPage')}>Fill page (crop edges)</button>}
          {contextLayer?.maskShapeId && <button role="menuitem" onClick={()=>contextAction('selectMask')}>Edit underlying shape</button>}
          {!IS_MOBILE && contextLayer?.maskShapeId && <button role="menuitem" onClick={()=>{detachImageFromShape(contextMenu.id);setContextMenu(null)}}>Detach image from shape</button>}
          <button role="menuitem" className="danger" disabled={!contextMenu.id} onClick={()=>contextAction('delete')}><Trash2 size={15}/> Delete</button>
        </div>}
        <div className="zoom"><button onClick={()=>setZoom(z=>Math.max(.45,z-.1))}><Minus/></button>
          {zoomEditing ? <input autoFocus className="zoom-value-input" aria-label="Canvas zoom percentage" type="text" value={zoomDraft}
            onChange={e=>setZoomDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') commitCanvasZoom(); if(e.key==='Escape')setZoomEditing(false)}} onBlur={commitCanvasZoom}/> :
            <button className="zoom-value-button" title="Enter canvas zoom (45-135%)" onClick={()=>{setZoomDraft(String(Math.round(zoom*100)));setZoomEditing(true)}}>{Math.round(zoom*100)}%</button>}
          <button onClick={()=>setZoom(z=>Math.min(1.35,z+.1))}><Plus/></button></div>
      </section>

      <div className="panel-splitter" role="separator" aria-orientation="vertical" aria-label="Resize right inspector" onPointerDown={e=>startPanelResize(e,'right')} />

      <aside className="inspector" aria-label="Editor properties">
        {IS_MOBILE && <button type="button" className={`mobile-multiselect ${mobileMultiMode?'active':''}`} onClick={()=>{setMobileMultiMode(v=>!v);setMobileEditOpen(false)}}>{mobileMultiMode?'Selection active':'Select multiple'} ({selectedIds.length})</button>}
        {IS_MOBILE && <div className="mobile-inspector-header"><strong>{panel === 'layers' ? 'Layers' : panel === 'style' ? 'Style' : 'Edit'}</strong><button type="button" aria-label="Close panel" onClick={()=>{setMobileEditOpen(false);setPanel('edit')}}>×</button></div>}
        {panel==='layers' ? <LayersPanel layers={layers} selectedIds={selectedIds} setSelected={id=>{setMultiSelected([]);setSelected(id)}} onReorder={reorderLayer} /> :
         panel==='style' ? <StylePanel bg={bg} setBg={v=>{checkpoint();setBg(v)}} canvasDesign={canvasDesign} changeCanvasDesign={changeCanvasDesign} appTheme={appTheme} setAppTheme={setAppTheme} accent={accent} setAccent={setAccent} accentSwatches={accentSwatches} setAccentSwatches={setAccentSwatches} canvasSwatches={canvasSwatches} setCanvasSwatches={setCanvasSwatches} gradientButtons={gradientButtons} setGradientButtons={setGradientButtons} brandPrimary={brandPrimary} setBrandPrimary={setBrandPrimary} toolbarColor={toolbarColor} setToolbarColor={setToolbarColor} logoGradientEnd={logoGradientEnd} setLogoGradientEnd={setLogoGradientEnd} exportGradientEnd={exportGradientEnd} setExportGradientEnd={setExportGradientEnd} logoGradientAngle={logoGradientAngle} setLogoGradientAngle={setLogoGradientAngle} exportGradientAngle={exportGradientAngle} setExportGradientAngle={setExportGradientAngle} themeLibrary={themeLibrary} themeNames={themeNames} setThemeNames={setThemeNames} themeNotice={themeNotice} gradientSwatches={gradientSwatches} saveGradientSwatch={saveGradientSwatch} removeGradientSwatch={removeGradientSwatch} saveTheme={saveTheme} applyTheme={applyTheme} deleteTheme={deleteTheme} orientation={orientation} changeOrientation={changeOrientation} /> :
         multiSelected.length>1 ? <div className="panel"><div className="panel-head"><b>{multiSelected.length} layers selected</b><span>Drag any selected layer to move the group</span></div>
           {multiSelected.every(id=>layers.find(layer=>layer.id===id)?.groupId && layers.find(layer=>layer.id===id)?.groupId===layers.find(layer=>layer.id===multiSelected[0])?.groupId) && <button type="button" className="mobile-ungroup-action frame-inspector-ungroup" onClick={ungroupMobileSelection}><Layers3 size={16}/> {IS_MOBILE?'Ungroup':'Ungroup selected layers'}</button>}
           <button className="group-selection-button" onClick={()=>{const ids=[...multiSelected];const groupId=uid();checkpoint();setLayers(items=>items.map(item=>ids.includes(item.id)?{...item,groupId}:item));}}>Group selected layers</button><button className="danger" onClick={remove}><Trash2/> Delete selected layers</button></div> :
         chosen ? <>{chosen.groupId && <div className="panel mobile-group-actions"><button type="button" className="mobile-ungroup-action frame-inspector-ungroup" onClick={ungroupMobileSelection}><Layers3 size={16}/> Ungroup</button></div>}<EditPanel chosen={chosen} patch={patch} remove={remove} duplicate={duplicate} bringFront={bringFront} checkpoint={checkpoint} detachImageFromShape={detachImageFromShape} onAdjustMask={beginMaskCrop} shapeImage={chosen.type==='shape'?layers.find(item=>item.type==='image' && item.maskShapeId===chosen.id):null} textSwatches={textSwatches} setTextSwatches={setTextSwatches}/></> :
         (layers.length ? <div className="panel empty selection-placeholder"><div className="orb"><Move/></div><b>Select an object</b><p>Click an image, shape, or text layer on the canvas to edit it, or open Layers to reorder objects.</p></div> : <EmptyPanel onImages={onImages} addText={addText}/>)}
      </aside>
    </main></>}
  </div>
}

function CarouselPresetThumbnail({project,page}){
  const dims=project.orientation==='landscape'?LANDSCAPE:PORTRAIT;
  const start=page*(dims.w+GAP);
  const bgStyle=canvasBackground(project.bg||'#f7f4ef',normalizeCanvasDesign(project.canvasDesign));
  const visible=(project.layers||[]).filter(layer=>layer.x+layer.w>start&&layer.x<start+dims.w);
  return <div className="carousel-preset-thumb" style={{aspectRatio:`${dims.w} / ${dims.h}`,background:bgStyle}} title={`Slide ${page+1}`}>
    {visible.sort((a,b)=>(a.z||0)-(b.z||0)).map((layer,i)=>{
      const box={position:'absolute',left:`${(layer.x-start)/dims.w*100}%`,top:`${layer.y/dims.h*100}%`,width:`${layer.w/dims.w*100}%`,height:`${layer.h/dims.h*100}%`,overflow:'hidden'};
      if(layer.type==='shape')return <div key={i} className="carousel-preset-thumb-shape" style={{...box,background:layer.color||'#cbd5e1',borderRadius:layer.shape==='rounded'?`${(layer.radius||0)/dims.w*100}%`:0,clipPath:SHAPE_POINTS[shapeKind(layer)]?`polygon(${SHAPE_POINTS[shapeKind(layer)].split(' ').map(p=>p.split(',').map(v=>v+'%').join(' ')).join(',')})`:undefined}}>{layer.presetPhotoSlot&&<span>＋</span>}</div>;
      if(layer.type==='text')return <div key={i} style={{...box,fontFamily:layer.fontFamily||'Inter',fontWeight:layer.weight||600,color:layer.color||'#111',fontSize:`${Math.max(3,(layer.fontSize||20)/dims.h*100)}cqw`,whiteSpace:'pre-line',lineHeight:1.05}}>{layer.text}</div>;
      return null;
    })}
  </div>;
}

function ShapePreview({shape,color='currentColor',radius=18}){
  if(shape==='rounded'||shape==='rectangle') return <div className="shape-preview-rect" style={{background:color,borderRadius:shape==='rounded'?radius:0}}/>;
  return <svg className="shape-preview-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    {shape==='ellipse'?<ellipse cx="50" cy="50" rx="50" ry="50" fill={color}/>:<polygon points={SHAPE_POINTS[shape] || SHAPE_POINTS.triangle} fill={color}/>}
  </svg>;
}

function Layer({layer,selected,dropTarget,clipPath,displayMask,onPointerDown,onDoubleClick,onResize,onContextMenu}){
  // Old projects can lack natural dimensions; derive them from the decoded photo.
  const [loadedSource,setLoadedSource]=useState(null);
  const sourceMatches=loadedSource?.src===layer.src?loadedSource:null;
  const crop=displayMask?getMaskCropGeometry(layer,displayMask,
    layer.naturalWidth||sourceMatches?.width,layer.naturalHeight||sourceMatches?.height):null;
  const fillFrame=layer.type==='image' && !IS_MOBILE && Number.isInteger(layer.cropPage) && !displayMask && Number.isFinite(layer.pageWidth) ? {x:layer.cropPage*(layer.pageWidth+GAP),y:0,w:layer.pageWidth+GAP,h:layer.pageHeight}:null;
  const frame=displayMask||fillFrame||layer;
  const fillHitbox=fillFrame?studioFillVisibleBounds(layer,fillFrame):null;
  const common={left:frame.x,top:frame.y,width:frame.w,height:frame.h,zIndex:layer.z||1,borderRadius:layer.type==='shape'?0:(layer.radius||0)};
  // A filled image's page-sized crop is visual-only; only the visible photo rectangle receives clicks.
  return <div className={`layer ${selected?'selected':''} ${dropTarget?'shape-drop-target':''} ${fillFrame?'layer-image-fill':''}`} style={{...common,clipPath:clipPath||undefined}}
    onPointerDown={fillFrame?undefined:onPointerDown} onContextMenu={fillFrame?undefined:onContextMenu} onDoubleClick={fillFrame?undefined:onDoubleClick}>
    {layer.type==='shape' && <ShapePreview shape={shapeKind(layer)} color={layer.color} radius={layer.radius||0}/>}
    {layer.type==='image' && (fillFrame ? (fillHitbox && <div className="studio-fill-image-hitbox"
      style={{left:fillHitbox.x-fillFrame.x,top:fillHitbox.y-fillFrame.y,width:fillHitbox.w,height:fillHitbox.h}}
      onPointerDown={onPointerDown} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick}>
      <img src={layer.src} draggable="false" style={{
        position:'absolute',left:layer.x-fillHitbox.x,top:layer.y-fillHitbox.y,
        width:layer.w,height:layer.h,maxWidth:'none',maxHeight:'none',
        borderRadius:0,objectFit:'cover',pointerEvents:'none'
      }}/>
    </div>) : <img src={layer.src} draggable="false" style={displayMask ? {
        position:'absolute',left:crop.x-displayMask.x,top:crop.y-displayMask.y,
        width:crop.w,height:crop.h,maxWidth:'none',maxHeight:'none',
        borderRadius:0,objectFit:'fill',pointerEvents:'none'
      } : {borderRadius:layer.radius||0,objectFit:'cover'}}
      onLoad={event=>{
        if(displayMask && !(layer.naturalWidth>0 && layer.naturalHeight>0)){
          const img=event.currentTarget;
          if(img.naturalWidth>0 && img.naturalHeight>0)setLoadedSource({src:layer.src,width:img.naturalWidth,height:img.naturalHeight});
        }
      }}/>) }
    {layer.type==='text' && (()=>{
      const layout=getSharedTextLayout(layer);
      return <div className="text-layer frame-mobile-text" style={{color:layer.color,fontWeight:layer.weight,fontFamily:`"${layer.fontFamily||'Inter'}", Arial, sans-serif`,justifyContent:layout.verticalAlign==='top'?'flex-start':layout.verticalAlign==='bottom'?'flex-end':'center'}}>
        <span style={{display:'block',flex:'0 0 auto',width:'100%',padding:`0 ${layout.edge}px`,fontSize:layout.fontSize,lineHeight:1.02,textAlign:layer.align||'left',whiteSpace:'pre'}}>{layer.text}</span>
      </div>;
    })()}
    {selected && fillFrame && <div className="fill-image-selection" style={{left:layer.x-fillFrame.x,top:layer.y-fillFrame.y,width:layer.w,height:layer.h}} aria-hidden="true"/>}
    {selected && IS_MOBILE && <>{['nw','n','ne','e','se','s','sw','w'].map(handle=><i key={handle} className={`resize-handle handle-${handle}`} onPointerDown={e=>onResize(e,handle)}/>)}</>}
  </div>
}

function EditPanel({chosen,patch,remove,duplicate,bringFront,checkpoint,detachImageFromShape,onAdjustMask,shapeImage,textSwatches,setTextSwatches}){
  const [fontOpen,setFontOpen]=useState(false);
  const attachedImageId=IS_MOBILE ? (chosen.type==='image'?chosen.maskShapeId && chosen.id:shapeImage?.id) : null;
  return <div className="panel"><div className="panel-head"><b>{chosen.type[0].toUpperCase()+chosen.type.slice(1)}</b><span>Selected layer</span></div>
    {attachedImageId && <div className="mask-helper mobile-mask-actions"><span>{chosen.type==='shape'?'This shape contains an image.':'This image is attached to a shape.'}</span><button type="button" className="adjust-shape-image-button" onClick={()=>onAdjustMask(attachedImageId)}>Adjust photo in shape</button><button type="button" className="detach-shape-button" onClick={()=>detachImageFromShape(attachedImageId)}>Detach image from shape</button></div>}
    {chosen.type==='text' && <>
      <label>Text<textarea className="font-aware-textarea" style={{fontFamily:`"${chosen.fontFamily||'Inter'}", sans-serif`,fontWeight:chosen.weight||400}} value={chosen.text} onFocus={checkpoint} onChange={e=>patch({text:e.target.value})}/></label>
      <div className="font-picker"><label>Font</label><button type="button" className="font-picker-trigger" aria-expanded={fontOpen} onClick={()=>setFontOpen(v=>!v)}><span style={{fontFamily:`"${chosen.fontFamily||'Inter'}", sans-serif`}}>{chosen.fontFamily||'Inter'}</span><span>{fontOpen?'▴':'▾'}</span></button>
      {fontOpen && <div className="font-picker-list" role="listbox" aria-label="Font choices">{FONT_OPTIONS.map(font=><button type="button" role="option" aria-selected={(chosen.fontFamily||'Inter')===font} className={(chosen.fontFamily||'Inter')===font?'current':''} key={font} onClick={()=>{checkpoint();patch({fontFamily:font});setFontOpen(false)}}><span className="font-picker-name">{font}</span><span className="font-picker-example" style={{fontFamily:`"${font}", sans-serif`}}>The quick brown fox</span></button>)}</div>}</div>
      <label>Size<input type="range" min="10" max="96" value={chosen.fontSize} onPointerDown={checkpoint} onChange={e=>patch({fontSize:+e.target.value})}/></label>
      <div className="text-editor-color-row"><div className="editor-color-control"><ToggleColor label="Text color" value={chosen.color} onChange={value=>patch({color:value})} swatches={textSwatches} onEditSwatches={setTextSwatches}/></div><label>Weight<select value={chosen.weight} onFocus={checkpoint} onChange={e=>patch({weight:+e.target.value})}><option value="400">Regular</option><option value="600">Semi</option><option value="700">Bold</option><option value="800">Black</option></select></label></div>
      <label>Horizontal alignment<select value={chosen.align||'left'} onFocus={checkpoint} onChange={e=>patch({align:e.target.value})}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      {<label>Vertical alignment<select value={chosen.verticalAlign||'middle'} onFocus={checkpoint} onChange={e=>patch({verticalAlign:e.target.value})}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>}
      {<p className="mobile-text-fit-hint">Text scales to fit inside its box instead of being clipped. Resize the box to adjust the fit.</p>}
    </>}
    {chosen.type==='shape' && <>
      <label>Shape<select value={shapeKind(chosen)} onFocus={checkpoint} onChange={e=>patch({shape:e.target.value})}>{SHAPES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <div className="editor-color-control"><ToggleColor label="Shape fill" value={chosen.color} onChange={value=>patch({color:value})}/><label className="shape-color-hex">Fill HEX<input type="text" maxLength={7} spellCheck={false} value={chosen.color||''} onFocus={checkpoint} onChange={e=>{const hex=e.target.value;if(isHex(hex))patch({color:hex})}}/></label></div>
      {shapeKind(chosen)==='rounded' && <label>Corner radius<input type="range" min="0" max="60" value={chosen.radius||0} onPointerDown={checkpoint} onChange={e=>patch({radius:+e.target.value})}/></label>}
      <div className="shape-size"><label>Width<input type="number" min="18" value={Math.round(chosen.w)} onFocus={checkpoint} onChange={e=>patch({w:Math.max(18,Number(e.target.value)||18)})}/></label><label>Height<input type="number" min="18" value={Math.round(chosen.h)} onFocus={checkpoint} onChange={e=>patch({h:Math.max(18,Number(e.target.value)||18)})}/></label></div>
    </>}
    {!IS_MOBILE && chosen.type==='image' && chosen.maskShapeId && <div className="mask-helper">Image fitted to a shape. The image and shape remain editable separately.<button type="button" className="detach-shape-button" onClick={()=>detachImageFromShape(chosen.id)}>Detach image from shape</button></div>}
    {chosen.type==='image' && !(IS_MOBILE && chosen.maskShapeId) && <label>Corner radius<input type="range" min="0" max="60" value={chosen.radius} onPointerDown={checkpoint} onChange={e=>patch({radius:+e.target.value})}/></label>}
    <div className="row actions"><button onClick={duplicate}><Copy/> Duplicate</button><button onClick={bringFront}><Layers3/> Front</button></div>
    <button className="danger" onClick={remove}><Trash2/> Delete layer</button>
  </div>
}

function LayersPanel({layers,selectedIds,setSelected,onReorder}){
  const [draggedId,setDraggedId]=useState(null);
  const [target,setTarget]=useState(null);
  const suppressClick=useRef(false);
  const activeDrag=useRef(null);
  const ordered=[...layers].sort((a,b)=>(Number(b.z)||0)-(Number(a.z)||0));
  const selectedIndex=selectedIds.length===1?ordered.findIndex(l=>l.id===selectedIds[0]):-1;
  const resetDrag=()=>{setDraggedId(null);setTarget(null);};

  useEffect(()=>()=>{
    // Avoid leaving window-level pointer listeners behind when changing projects.
    activeDrag.current?.();
  },[]);

  const beginPointerReorder=(event,id)=>{
    if(IS_MOBILE || event.button!==0 || activeDrag.current)return;
    const list=event.currentTarget.closest('.layer-list');
    if(!list)return;
    const pointerId=event.pointerId;
    const startX=event.clientX,startY=event.clientY;
    let moving=false,lastTarget=null;
    const locate=(x,y)=>{
      const listBox=list.getBoundingClientRect();
      if(x<listBox.left || x>listBox.right || y<listBox.top-18 || y>listBox.bottom+18)return null;
      const rows=[...list.querySelectorAll('[data-frame-layer-id]')];
      if(!rows.length)return null;
      const nearest=rows.reduce((best,row)=>{
        const box=row.getBoundingClientRect();
        const distance=y<box.top?box.top-y:y>box.bottom?y-box.bottom:0;
        return !best || distance<best.distance?{row,box,distance}:best;
      },null);
      if(!nearest)return null;
      const next={id:nearest.row.dataset.frameLayerId,
        side:y<nearest.box.top+nearest.box.height/2?'above':'below'};
      return next.id===id?null:next;
    };
    const move=ev=>{
      if(ev.pointerId!==pointerId)return;
      if(!moving && Math.hypot(ev.clientX-startX,ev.clientY-startY)<5)return;
      if(!moving){moving=true;setDraggedId(id);}
      ev.preventDefault();
      lastTarget=locate(ev.clientX,ev.clientY);
      setTarget(previous=>previous?.id===lastTarget?.id && previous?.side===lastTarget?.side?previous:lastTarget);
    };
    const cleanup=()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',finish);
      window.removeEventListener('pointercancel',cancel);
      window.removeEventListener('blur',cancel);
      activeDrag.current=null;
      resetDrag();
    };
    const finish=ev=>{
      if(ev.pointerId!==pointerId)return;
      if(moving){
        // Suppress the click generated after the drag, but allow future clicks.
        suppressClick.current=true;
        setTimeout(()=>{suppressClick.current=false;},0);
        if(lastTarget)onReorder(id,lastTarget.id,lastTarget.side==='below');
      }
      cleanup();
    };
    const cancel=()=>cleanup();
    activeDrag.current=cleanup;
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',finish);
    window.addEventListener('pointercancel',cancel);
    window.addEventListener('blur',cancel);
  };
  const selectRow=id=>{
    if(suppressClick.current)return;
    setSelected(id);
  };
  const moveSelected=direction=>{
    if(selectedIndex<0)return;
    const destination=ordered[selectedIndex+direction];
    if(!destination)return;
    onReorder(ordered[selectedIndex].id,destination.id,direction>0);
  };

  return <div className="panel"><div className="panel-head"><b>Layers</b><span>{layers.length} objects · Drag to rearrange</span></div>
    {!IS_MOBILE && <div className="layer-reorder-actions" aria-label="Layer order controls">
      <button type="button" disabled={selectedIndex<=0} onClick={()=>moveSelected(-1)} title="Move selected layer up (toward front)">↑ Move up</button>
      <button type="button" disabled={selectedIndex<0 || selectedIndex>=ordered.length-1} onClick={()=>moveSelected(1)} title="Move selected layer down (toward back)">↓ Move down</button>
    </div>}
    <div className="layer-list">{ordered.map(l=><button key={l.id} type="button" draggable={IS_MOBILE}
      data-frame-layer-id={l.id}
      className={`${selectedIds.includes(l.id)?'sel':''} ${draggedId===l.id?'layer-dragging':''} ${target?.id===l.id?'layer-drop-'+target.side:''}`}
      onClick={()=>selectRow(l.id)}
      onPointerDown={e=>beginPointerReorder(e,l.id)}
      onDragStart={e=>{if(!IS_MOBILE){e.preventDefault();return;}e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',l.id);setDraggedId(l.id);}}
      onDragOver={e=>{if(!IS_MOBILE && !draggedId)return;if(!draggedId || draggedId===l.id)return;e.preventDefault();e.dataTransfer.dropEffect='move';const rect=e.currentTarget.getBoundingClientRect();setTarget({id:l.id,side:e.clientY<rect.top+rect.height/2?'above':'below'});}}
      onDrop={e=>{if(!IS_MOBILE)return;e.preventDefault();e.stopPropagation();const source=draggedId||e.dataTransfer.getData('text/plain');if(source!==l.id){const rect=e.currentTarget.getBoundingClientRect();onReorder(source,l.id,e.clientY>=rect.top+rect.height/2);}resetDrag();}}
      onDragEnd={resetDrag}>
      <GripVertical className="layer-grip" size={15}/><span className="thumb">{l.type==='image'?<img src={l.src} draggable="false"/>:l.type==='text'?<Type/>:<Shapes/>}</span>
      <span><b>{l.type==='text' ? l.text.split('\n')[0].slice(0,18) : l.type}</b><small>z {l.z}</small></span>
    </button>)}</div>
  </div>;
}

// Controlled color picker. Chromium's native color popup is not reliably dismissible
// with a second click, so only this React panel owns its open/closed state.
const hexToRgb = hex => {const n=Number.parseInt(hex.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255];};
const rgbToHex = (r,g,b) => '#'+[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(Number(v)||0))).toString(16).padStart(2,'0')).join('');
const rgbToHsl = (r,g,b) => {
  r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  let h=0,s=0;const l=(max+min)/2;
  if(delta){s=delta/(1-Math.abs(2*l-1));switch(max){case r:h=((g-b)/delta)%6;break;case g:h=(b-r)/delta+2;break;default:h=(r-g)/delta+4;}h=(h*60+360)%360;}
  return [Math.round(h),Math.round(s*100),Math.round(l*100)];
};
const hslToHex = (h,s,l) => {
  s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
  const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return rgbToHex((r+m)*255,(g+m)*255,(b+m)*255);
};
function ColorChannelSlider({label,value,max,onChange,background,unit=''}){
  const [draft,setDraft]=useState(value);
  const dragging=useRef(false);
  useEffect(()=>{if(!dragging.current)setDraft(value);},[value]);
  return <label className="color-channel-slider">{label} <b>{draft}{unit}</b>
    <input type="range" min="0" max={max} value={draft} style={{'--channel-gradient':background}}
      onPointerDown={e=>{dragging.current=true;e.currentTarget.setPointerCapture?.(e.pointerId);}}
      onChange={e=>{const next=Number(e.target.value);setDraft(next);onChange(next);}}
      onPointerUp={()=>{dragging.current=false;}}
      onPointerCancel={()=>{dragging.current=false;}}/>
  </label>;
}
function ColorEditor({value,onChange,onClose,swatches=[],onEditSwatches}){
  const [editingSwatch,setEditingSwatch]=useState(null);
  const [mode,setMode]=useState('HSL');
  const [hexDraft,setHexDraft]=useState(value);
  const [hslDraft,setHslDraft]=useState(()=>rgbToHsl(...hexToRgb(value)));
  const changingHsl=useRef(false);
  useEffect(()=>{setHexDraft(value);if(!changingHsl.current)setHslDraft(rgbToHsl(...hexToRgb(value)));},[value]);
  const [r,g,b]=hexToRgb(value);
  const [h,s,l]=rgbToHsl(r,g,b);
  const editRgb=(index,next)=>{changingHsl.current=false;const v=[r,g,b];v[index]=Number(next);onChange(rgbToHex(...v));};
  const editHsl=(index,next)=>{const v=[...hslDraft];v[index]=Number(next);changingHsl.current=true;setHslDraft(v);onChange(hslToHex(...v));};
  return <div className="controlled-color-panel" onPointerDown={e=>e.stopPropagation()}>
    <div className="color-editor-top"><div className="color-editor-preview" style={{background:value}}/><button type="button" onClick={onClose} aria-label="Close color editor">×</button></div>
    {swatches.length>0 && <>
      <div className="text-swatch-hint">Text presets · Click to apply, pencil to customize</div>
      <div className="text-color-swatches" aria-label="Text color swatches">
        {swatches.map((color,index)=><div className="text-swatch-entry" key={index}>
          <button type="button" title={`Apply ${color}`} aria-label={`Apply text swatch ${index+1}`}
            className={`text-swatch-choice ${color.toLowerCase()===value?.toLowerCase()?'active':''}`}
            style={{background:color}} onClick={()=>{changingHsl.current=false;onChange(color);}}/>
          {onEditSwatches && <button type="button" className="text-swatch-pencil" aria-label={`Customize text swatch ${index+1}`}
            aria-expanded={editingSwatch===index} onClick={()=>setEditingSwatch(old=>old===index?null:index)}>✎</button>}
        </div>)}
      </div>
      {onEditSwatches && editingSwatch!==null && <div className="text-swatch-customize">
        <div className="text-swatch-customize-head"><span>Customize text swatch {editingSwatch+1}</span><button type="button" onClick={()=>setEditingSwatch(null)}>Done</button></div>
        <ColorEditor value={swatches[editingSwatch]} onChange={next=>onEditSwatches(swatches.map((color,index)=>index===editingSwatch?next:color))} onClose={()=>setEditingSwatch(null)}/>
      </div>}
    </>}
    <div className="color-mode-tabs">{['HSL','RGB','HEX'].map(m=><button type="button" key={m} className={mode===m?'active':''} onClick={()=>{changingHsl.current=false;setHslDraft(rgbToHsl(...hexToRgb(value)));setMode(m)}}>{m}</button>)}</div>
    {mode==='HSL' && <div className="color-channels">{[['Hue',hslDraft[0],359],['Saturation',hslDraft[1],100],['Lightness',hslDraft[2],100]].map(([label,n,max],i)=><ColorChannelSlider key={label} label={label} value={n} max={max} unit={i?'%':'°'} onChange={v=>editHsl(i,v)} background={i===0?'linear-gradient(to right,red,yellow,lime,cyan,blue,magenta,red)':i===1?`linear-gradient(to right,${hslToHex(hslDraft[0],0,hslDraft[2])},${hslToHex(hslDraft[0],100,hslDraft[2])})`:`linear-gradient(to right,#000,${hslToHex(hslDraft[0],hslDraft[1],50)},#fff)`}/>)}</div>}
    {mode==='RGB' && <div className="color-channels">{[['Red',r],['Green',g],['Blue',b]].map(([label,n],i)=><ColorChannelSlider key={label} label={label} value={n} max={255} onChange={v=>editRgb(i,v)} background={`linear-gradient(to right,${rgbToHex(...[r,g,b].map((c,j)=>j===i?0:c))},${rgbToHex(...[r,g,b].map((c,j)=>j===i?255:c))})`}/>)}</div>}
    {mode==='HEX' && <label className="color-hex-label">HEX<input aria-label="HEX color" value={hexDraft} maxLength={7} onChange={e=>{setHexDraft(e.target.value);if(isHex(e.target.value)){changingHsl.current=false;onChange(e.target.value)};}}/></label>}
  </div>;
}
function EditableSwatches({colors,onChange,onChoose,selected,label}){
  const [editing,setEditing]=useState(null);
  return <div className="custom-swatches">
    <div className="swatch-instructions">Click to apply · Pencil to edit preset</div>
    <div className="swatch-grid">{colors.map((color,i)=><div className="swatch-entry" key={i}>
      <button type="button" className={`swatch-choice ${selected===i?'selected':''}`} style={{background:color}} title={`Apply ${label} ${i+1}: ${color}`} onClick={()=>onChoose(color,i)} aria-pressed={selected===i}/>
      <button type="button" className="swatch-edit swatch-edit-button" aria-label={`Edit ${label} swatch ${i+1}`} aria-expanded={editing===i} onClick={()=>setEditing(old=>old===i?null:i)}>✎</button>
    </div>)}</div>
    {editing!==null && <div className="swatch-editor-inline"><ColorEditor value={colors[editing]} onChange={v=>onChange(colors.map((c,j)=>j===editing?v:c))} onClose={()=>setEditing(null)}/></div>}
  </div>;
}
function ToggleColor({label,value,onChange,swatches,onEditSwatches}){
  const [open,setOpen]=useState(false);
  return <div className="toggle-color-field">
    <button type="button" className="palette-direct-label color-trigger" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
      <span>{label}</span><span className="color-preview-box" style={{background:value}}/><span className="color-chevron">{open?'▴':'▾'}</span>
    </button>
    {open && <ColorEditor value={value} onChange={onChange} onClose={()=>setOpen(false)} swatches={swatches} onEditSwatches={onEditSwatches}/>}
  </div>;
}

function StylePanel({bg,setBg,canvasDesign,changeCanvasDesign,appTheme,setAppTheme,accent,setAccent,accentSwatches,setAccentSwatches,canvasSwatches,setCanvasSwatches,gradientButtons,setGradientButtons,brandPrimary,setBrandPrimary,toolbarColor,setToolbarColor,logoGradientEnd,setLogoGradientEnd,exportGradientEnd,setExportGradientEnd,logoGradientAngle,setLogoGradientAngle,exportGradientAngle,setExportGradientAngle,themeLibrary,themeNames,setThemeNames,themeNotice,gradientSwatches,saveGradientSwatch,removeGradientSwatch,saveTheme,applyTheme,deleteTheme,orientation,changeOrientation}){
  const [activeAccent,setActiveAccent]=useState(null);
  const [activeCanvas,setActiveCanvas]=useState(null);
  const [openColor,setOpenColor]=useState(null);
  const toggleColor=key=>setOpenColor(old=>old===key?null:key);
  const updateCanvasColor=(key,value)=>key==='secondary'?changeCanvasDesign({secondary:value}):setBg(value);
  return <div className="panel design-panel">
    <div className="panel-head"><b><SlidersHorizontal size={16}/> Style</b><span>Canvas and interface appearance</span></div>
    {['app'].map(kind=><details className="style-accordion theme-library" key={kind}>
      <summary>{kind==='canvas'?'Canvas color themes':'App appearance themes'} <span>Saved presets, previews and custom styles</span></summary>
      <div className="style-accordion-body">
        <p className="theme-library-help">{kind==='canvas'?'Save background and gradient colors, or choose a previously saved look.':'Save your UI mode, accent palette, logo and toolbar styling.'} Presets are stored on this computer.</p>
        <div className="theme-save-row"><input aria-label={`Name ${kind} theme`} placeholder="Theme name" value={themeNames[kind]} onChange={e=>setThemeNames(v=>({...v,[kind]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter')saveTheme(kind,themeNames[kind])}}/><button className="theme-save" disabled={!themeNames[kind].trim()} onClick={()=>saveTheme(kind,themeNames[kind])}>Save theme</button></div>
        {themeNotice && <div className="theme-save-feedback" role="status">{themeNotice}</div>}
        <div className="theme-preview-list">
          {(themeLibrary[kind]||[]).map(theme=><div className="theme-preview-card" key={theme.name}>
            <div className="theme-preview-art" style={kind==='canvas'
              ? {background:canvasBackground(theme.values.bg||'#fff',normalizeCanvasDesign(theme.values.canvasDesign))}
              : {background:theme.values.appTheme==='light'?'#eff1f7':'#1e2028'}}>
              {kind==='app' && <><span className="theme-preview-mark" style={{background:theme.values.brandPrimary||'#888'}}/> <span className="theme-preview-line" style={{background:theme.values.accent||'#888'}}/></>}
            </div>
            <span className="theme-preview-name" title={theme.name}>{theme.name}</span>
            <button className="theme-apply" onClick={()=>applyTheme(kind,theme.name)}>Apply</button>
            <button className="theme-delete" title={`Delete ${theme.name}`} aria-label={`Delete ${theme.name}`} onClick={()=>deleteTheme(kind,theme.name)}>×</button>
          </div>)}
          {!(themeLibrary[kind]||[]).length && <p className="theme-library-help">No saved themes yet.</p>}
        </div>
      </div>
    </details>)}
    <details className="style-accordion">
      <summary>Canvas layout <span>Orientation &amp; guides</span></summary>
      <div className="style-accordion-body">
        <div className="orientation-toggle inspector-orientation">
          <button className={orientation==='portrait'?'selected':''} onClick={()=>changeOrientation('portrait')}><RectangleVertical size={15}/> Portrait</button>
          <button className={orientation==='landscape'?'selected':''} onClick={()=>changeOrientation('landscape')}><RectangleHorizontal size={15}/> Landscape</button>
        </div>
        <label className="design-checkbox"><input type="checkbox" checked={canvasDesign.showGuides} onChange={e=>changeCanvasDesign({showGuides:e.target.checked})}/><Grid3X3 size={15}/> Show slide dividers</label>
      </div>
    </details>
    <details className="style-accordion">
      <summary>Canvas colors <span>Background &amp; gradients</span></summary>
      <div className="style-accordion-body">
        <label>Background type</label>
        <div className="design-segment"><button className={canvasDesign.mode==='solid'?'selected':''} onClick={()=>{changeCanvasDesign({mode:'solid'});setOpenColor(null)}}>Solid</button><button className={canvasDesign.mode==='gradient'?'selected':''} onClick={()=>{changeCanvasDesign({mode:'gradient'});setOpenColor(null)}}>Gradient</button></div>
        <ToggleColor label="Primary color" value={bg} onChange={value=>updateCanvasColor('primary',value)} open={openColor==='primary'} onToggle={()=>toggleColor('primary')}/>
        {canvasDesign.mode==='gradient' && <ToggleColor label="Secondary color" value={canvasDesign.secondary} onChange={value=>updateCanvasColor('secondary',value)} open={openColor==='secondary'} onToggle={()=>toggleColor('secondary')}/>}
        {canvasDesign.mode==='gradient' && <label>Gradient angle: {canvasDesign.angle}°<input type="range" min="0" max="360" step="5" value={canvasDesign.angle} onChange={e=>changeCanvasDesign({angle:Number(e.target.value)})}/></label>}
        <div className="canvas-preset-heading">Canvas swatches</div>
        <EditableSwatches label="canvas" colors={canvasSwatches} onChange={setCanvasSwatches} selected={activeCanvas} onChoose={(color,i)=>{setActiveCanvas(i);updateCanvasColor('primary',color);}}/>
        <div className="canvas-preset-heading">Saved gradient swatches</div>
        <button className="theme-save" type="button" onClick={saveGradientSwatch}>+ Save current gradient as swatch</button>
        <div className="gradient-swatch-list">{gradientSwatches.map(item=><div className="gradient-swatch-item" key={item.id}><button title="Apply gradient" style={{background:canvasBackground(item.primary,{mode:'gradient',secondary:item.secondary,angle:item.angle})}} onClick={()=>{setBg(item.primary);changeCanvasDesign({mode:'gradient',secondary:item.secondary,angle:item.angle})}}/><button title="Delete swatch" onClick={()=>removeGradientSwatch(item.id)}>×</button></div>)}</div>
      </div>
    </details>
    <details className="style-accordion">
      <summary>App appearance <span>Dark &amp; light mode</span></summary>
      <div className="style-accordion-body">
        <div className="design-segment"><button className={appTheme==='dark'?'selected':''} onClick={()=>setAppTheme('dark')}><Moon size={14}/> Dark</button><button className={appTheme==='light'?'selected':''} onClick={()=>setAppTheme('light')}><Sun size={14}/> Light</button></div>
      </div>
    </details>
    <details className="style-accordion">
      <summary>Accent palette <span>Theme color &amp; presets</span></summary>
      <div className="style-accordion-body">
        <ToggleColor label="Accent color" value={accent} onChange={v=>{setAccent(v);setActiveAccent(null)}} open={openColor==='accent'} onToggle={()=>toggleColor('accent')}/>
        <EditableSwatches label="accent" colors={accentSwatches} onChange={setAccentSwatches} selected={activeAccent} onChoose={(color,i)=>{if(activeAccent===i){setActiveAccent(null);return;}setActiveAccent(i);setAccent(color);}}/>
      </div>
    </details>
    <details className="style-accordion">
      <summary>Brand styling <span>Logo &amp; Export button</span></summary>
      <div className="style-accordion-body">
        <label>Brand fill</label>
        <div className="design-segment"><button className={!gradientButtons?'selected':''} onClick={()=>setGradientButtons(false)}>Solid</button><button className={gradientButtons?'selected':''} onClick={()=>setGradientButtons(true)}>Gradient</button></div>
        <ToggleColor label="Logo and Export primary color" value={brandPrimary} onChange={setBrandPrimary} open={openColor==='brandPrimary'} onToggle={()=>toggleColor('brandPrimary')}/>
        <ToggleColor label="Toolbar icon color" value={toolbarColor} onChange={setToolbarColor} open={openColor==='toolbar'} onToggle={()=>toggleColor('toolbar')}/>
        {gradientButtons && <div className="gradient-brand-controls">
          <ToggleColor label="Logo gradient second color" value={logoGradientEnd} onChange={setLogoGradientEnd} open={openColor==='logo'} onToggle={()=>toggleColor('logo')}/>
          <div className="gradient-angle-control"><label htmlFor="logo-angle-number">Logo angle</label><input id="logo-angle-number" aria-label="Logo gradient angle in degrees" type="number" min="0" max="360" step="1" value={logoGradientAngle} onChange={e=>setLogoGradientAngle(Math.min(360,Math.max(0,Number(e.target.value)||0)))}/><span>°</span><input aria-label="Logo gradient angle slider" type="range" min="0" max="360" value={logoGradientAngle} onChange={e=>setLogoGradientAngle(Number(e.target.value))}/></div>
          <ToggleColor label="Export gradient second color" value={exportGradientEnd} onChange={setExportGradientEnd} open={openColor==='export'} onToggle={()=>toggleColor('export')}/>
          <div className="gradient-angle-control"><label htmlFor="export-angle-number">Export angle</label><input id="export-angle-number" aria-label="Export gradient angle in degrees" type="number" min="0" max="360" step="1" value={exportGradientAngle} onChange={e=>setExportGradientAngle(Math.min(360,Math.max(0,Number(e.target.value)||0)))}/><span>°</span><input aria-label="Export gradient angle slider" type="range" min="0" max="360" value={exportGradientAngle} onChange={e=>setExportGradientAngle(Number(e.target.value))}/></div>
        </div>}
      </div>
    </details>
    <div className="design-footnote">Canvas colors are saved in your project. UI themes and palettes are stored on this device.</div>
  </div>;
}

function EmptyPanel({onImages,addText}){
  return <div className="panel empty"><div className="orb"><Sparkles/></div><b>Start arranging</b><p>Add photos, text, and shapes, then drag them across the slide seams.</p><label className="primary"><ImagePlus/> Add photos<input type="file" accept="image/*" multiple onChange={e=>onImages(e.target.files)}/></label><button onClick={()=>addText()}><Type/> Add text</button></div>
}

function roundRect(ctx,x,y,w,h,r){r=Math.max(0,Math.min(r,Math.min(w,h)/2));ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function loadImage(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src})}

createRoot(document.getElementById('root')).render(<App/>);
