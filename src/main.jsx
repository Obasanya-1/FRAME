import React, {useEffect, useMemo, useRef, useState} from 'react';
import { createRoot } from 'react-dom/client';
import {
  ImagePlus, Type, Download, Plus, Minus, Trash2, Copy, Layers3,
  Undo2, Redo2, Move, Palette, Sparkles, Check, Save, FolderOpen,
  RectangleHorizontal, RectangleVertical, Shapes, Sun, Moon, Grid3X3, SlidersHorizontal, GripVertical
} from 'lucide-react';
import './styles.css';
import { createZip } from './zip.js';

const PORTRAIT = { w: 320, h: 400, exportW: 1080, exportH: 1350, label: 'Portrait' };
const LANDSCAPE = { w: 400, h: 320, exportW: 1350, exportH: 1080, label: 'Landscape' };
const GAP = 1;
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
];
const freshPresetProject = raw => {
  const project=normalizeProject(raw);
  // Each layer gets a fresh ID even if a built-in template omitted IDs.
  // Do not key generation by layer.id: undefined IDs used to collapse every
  // built-in template object into one selectable/draggable object.
  const ids=new Map(project.layers.map(layer=>[layer.id,uid()]));
  const groups=new Map();
  return {...project,layers:project.layers.map(layer=>{
    const group=layer.groupId;
    if(group && !groups.has(group))groups.set(group,uid());
    return {...layer,id:ids.get(layer.id),groupId:group?groups.get(group):null,maskShapeId:layer.maskShapeId?ids.get(layer.maskShapeId)||null:null};
  })};
};

function App(){
  const [pages,setPages] = useState(3);
  const [layers,setLayers] = useState(makeStarter);
  const [projectGeneration,setProjectGeneration] = useState(0);
  const activeCanvasGestureRef = useRef(null);
  const [editorReady,setEditorReady] = useState(false);
  const [contextMenu,setContextMenu] = useState(null);
  const [dropShapeId,setDropShapeId] = useState(null);
  const [selected,setSelected] = useState(null);
  const [multiSelected,setMultiSelected] = useState([]);
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
  const [autosaveEnabled,setAutosaveEnabled] = useState(()=>getAppPreference('frame-autosave-enabled','true')==='true');
  const [exporting,setExporting] = useState(false);
  const [previewOpen,setPreviewOpen] = useState(false);
  const [previewIndex,setPreviewIndex] = useState(0);
  const [previewSlides,setPreviewSlides] = useState([]);
  const [previewBusy,setPreviewBusy] = useState(false);
  const [previewError,setPreviewError] = useState('');
  const previewUrlsRef = useRef([]);
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
  const chosen = layers.find(l=>l.id===selected);
  const selectedIds = multiSelected.length ? multiSelected : (selected ? [selected] : []);
  const clearSelection = () => { setSelected(null); setMultiSelected([]); };
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
      const result = await window.frameDesktop.openRecentProject(filePath);
      if (result?.project) {
        applyProject(result.project, result.name);
        setProjectsOpen(false);
        setProjectError('');
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
    setContextMenu(null);
    setPreviewOpen(false);
    setPreviewSlides([]);
    setProjectGeneration(generation=>generation+1);
    cursorOnCanvasRef.current = null;
  };

  const applyProject = (raw, name='Untitled.frame') => {
    const p = normalizeProject(raw);
    resetCanvasForProject();
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
      if(action==='new') await newProject();
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

  const saveProject = async (saveAs=false) => {
    if(!window.frameDesktop){
      const blob = new Blob([JSON.stringify({format:'frame-studio-project',version:2,...project},null,2)],{type:'application/json'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Untitled.frame'; a.click(); URL.revokeObjectURL(a.href); return;
    }
    const result = await window.frameDesktop.saveProject(project, saveAs);
    if(!result?.canceled){ setProjectName(result.name || 'Untitled.frame'); setSaveState('Saved'); refreshRecentProjects(); }
  };

  const openProject = async () => {
    if(!window.frameDesktop) return;
    const result = await window.frameDesktop.openProject();
    if(!result?.canceled && result?.project) { applyProject(result.project,result.name); refreshRecentProjects(); }
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
    const removedStart = (pages - 1) * (PAGE_W + GAP);
    checkpoint();
    // Layers occupying the removed slide are actually discarded, not merely hidden.
    setLayers(items => items.filter(item => item.x + item.w <= removedStart));
    setPages(count => count - 1);
    clearSelection();
    setConfirmRemoveSlide(false);
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
    setLayers(items=>[...items,{id,type:'image',src:source.src,x:page*(PAGE_W+GAP)+(PAGE_W-width)/2,y:(PAGE_H-height)/2,w:width,h:height,radius:0,z:Math.max(0,...items.map(l=>Number(l.z)||0))+1}]);
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
    clearSelection();
  };
  const duplicate = () => { if(!chosen)return; checkpoint(); const n={...chosen,id:uid(),x:chosen.x+22,y:chosen.y+22,z:chosen.z+1}; setLayers(v=>[...v,n]);setSelected(n.id);setMultiSelected([]); };
  const bringFront = () => { if(!chosen)return; checkpoint(); const max=Math.max(...layers.map(l=>l.z||0),0); patch({z:max+1}); };
  const reorderLayer = (dragId,targetId,placeAfter=false) => {
    if(!dragId || !targetId || dragId===targetId) return;
    const ordered=[...layers].sort((a,b)=>(b.z||0)-(a.z||0));
    const originalIds=ordered.map(layer=>layer.id);
    const from=ordered.findIndex(layer=>layer.id===dragId);
    if(from<0 || !ordered.some(layer=>layer.id===targetId)) return;
    const [moved]=ordered.splice(from,1);
    const to=ordered.findIndex(layer=>layer.id===targetId);
    ordered.splice(to+(placeAfter?1:0),0,moved);
    if(ordered.every((layer,index)=>layer.id===originalIds[index])) return;
    checkpoint();
    setLayers(previous=>{
      const rank=new Map(ordered.map((layer,index)=>[layer.id,ordered.length-index]));
      return previous.map(layer=>({...layer,z:rank.get(layer.id)??layer.z}));
    });
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
    const x=Math.min(Math.max(8,event.clientX-bounds.left),Math.max(8,bounds.width-208));
    const y=Math.min(Math.max(8,event.clientY-bounds.top),Math.max(8,bounds.height-196));
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
  const shapeDropTarget = (image, dx, dy) => {
    const cx=image.x+dx+image.w/2,cy=image.y+dy+image.h/2;
    return [...layers].reverse().find(item=>item.type==='shape' && cx>=item.x && cx<=item.x+item.w && cy>=item.y && cy<=item.y+item.h);
  };
  const attachImageToShape = (imageId,shapeId) => {
    const shape=layers.find(item=>item.id===shapeId);
    if(!shape) return;
    setLayers(items=>items.map(item=>item.id===imageId?{...item,maskShapeId:shapeId,cropPage:null,z:Math.max(...items.map(x=>Number(x.z)||0),0)+1}:item));
  };
  const detachImageFromShape = id => {
    const image=layers.find(item=>item.id===id);if(!image?.maskShapeId)return;
    checkpoint();
    setLayers(items=>{
      const top=Math.max(0,...items.map(item=>Number(item.z)||0))+1;
      return items.map(item=>item.id===id?{...item,maskShapeId:null}:item.id===image.maskShapeId?{...item,z:top}:item);
    });
  };
  const shapeClipPath = shape => {
    if(!shape)return 'none';
    const kind=shapeKind(shape);
    if(kind==='ellipse')return 'ellipse(50% 50% at 50% 50%)';
    if(SHAPE_POINTS[kind])return `polygon(${SHAPE_POINTS[kind].split(' ').map(p=>p.split(',').map(v=>v+'%').join(' ')).join(',')})`;
    if(kind==='rounded')return `inset(0 round ${shape.radius||0}px)`;
    return 'inset(0)';
  };
  const startDrag = (e, layer) => {
    if(e.button !== 0)return;
    e.stopPropagation();
    setContextMenu(null);setShapePickerOpen(false);setPanel('edit');
    if(e.shiftKey){
      const next=selectedIds.includes(layer.id)?selectedIds.filter(id=>id!==layer.id):[...selectedIds,layer.id];
      setSelected(next.length===1?next[0]:null);setMultiSelected(next.length>1?next:[]);
      return;
    }
    const ids=new Set(multiSelected.includes(layer.id)?multiSelected:[layer.id]);
    if(layer.groupId)layers.filter(item=>item.groupId===layer.groupId).forEach(item=>ids.add(item.id));
    // Masked image and mask shape always move together. Neither original size is destroyed.
    for(const item of layers){
      if(ids.has(item.id) && item.maskShapeId) ids.add(item.maskShapeId);
      if(item.maskShapeId && ids.has(item.maskShapeId)) ids.add(item.id);
    }
    setSelected(layer.id);
    setMultiSelected(ids.size>1?[...ids]:[]);
    checkpoint();
    activeCanvasGestureRef.current?.();
    const startX=e.clientX,startY=e.clientY;
    const origins=new Map(layers.filter(item=>ids.has(item.id)).map(item=>[item.id,{x:item.x,y:item.y}]));
    let targetId=null;
    const move=ev=>{
      const dx=(ev.clientX-startX)/zoom,dy=(ev.clientY-startY)/zoom;
      if(layer.type==='image' && !layer.maskShapeId && !Number.isInteger(layer.cropPage)){
        const image={...layer,x:layer.x+dx,y:layer.y+dy};
        const cx=image.x+image.w/2,cy=image.y+image.h/2;
        const target=[...layers].reverse().find(item=>item.type==='shape' && !ids.has(item.id) && cx>=item.x && cx<=item.x+item.w && cy>=item.y && cy<=item.y+item.h);
        targetId=target?.id||null;setDropShapeId(targetId);
      }
      setLayers(items=>items.map(item=>{
        const orig=origins.get(item.id);
        return orig?{...item,x:Math.max(-item.w+28,Math.min(canvasW-28,orig.x+dx)),y:Math.max(-item.h+28,Math.min(PAGE_H-28,orig.y+dy))}:item;
      }));
    };
    const cleanup=()=>{
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',stop);
      window.removeEventListener('pointercancel',cleanup);
      if(activeCanvasGestureRef.current===cleanup)activeCanvasGestureRef.current=null;
      setDropShapeId(null);
    };
    const stop=()=>{
      cleanup();
      if(targetId && layer.type==='image')attachImageToShape(layer.id,targetId);
    };
    activeCanvasGestureRef.current=cleanup;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',cleanup);
  };

  const startResize = (e, layer, handle) => {
    if(e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(layer.id); setMultiSelected([]);
    checkpoint();
    activeCanvasGestureRef.current?.();
    const origin = {x:layer.x,y:layer.y,w:layer.w,h:layer.h};
    const startX=e.clientX, startY=e.clientY;
    const min=18;
    const move=ev=>{
      const dx=(ev.clientX-startX)/zoom,dy=(ev.clientY-startY)/zoom;
      let {x,y,w,h}=origin;
      if(handle.includes('e')) w=Math.max(min,origin.w+dx);
      if(handle.includes('s')) h=Math.max(min,origin.h+dy);
      if(handle.includes('w')) {w=Math.max(min,origin.w-dx);x=origin.x+origin.w-w;}
      if(handle.includes('n')) {h=Math.max(min,origin.h-dy);y=origin.y+origin.h-h;}
      setLayers(items=>items.map(item=>item.id===layer.id?{...item,x,y,w,h}:item));
    };
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);if(activeCanvasGestureRef.current===up)activeCanvasGestureRef.current=null;};
    activeCanvasGestureRef.current=up;
    window.addEventListener('pointermove',move);
    window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',up);
  };

  const renderLayer = async(ctx,l,offsetX) => {
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
        ctx.fillStyle=l.color; ctx.font=`${l.weight||600} ${l.fontSize}px \"${l.fontFamily||'Inter'}\", Arial, sans-serif`;
        ctx.textAlign=l.align||'left'; ctx.textBaseline='top';
        const textX = l.align==='center' ? l.x-offsetX+l.w/2 : l.align==='right' ? l.x-offsetX+l.w : l.x-offsetX;
        const lines=l.text.split('\n'); lines.forEach((line,i)=>ctx.fillText(line,textX,l.y+i*l.fontSize*1.08));
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
        const img=await loadImage(l.src);
        if(!mask){
          if(Number.isInteger(l.cropPage)){ctx.beginPath();ctx.rect(l.cropPage*(PAGE_W+GAP)-offsetX,0,PAGE_W,PAGE_H);ctx.clip();}
          else {roundRect(ctx,l.x-offsetX,l.y,l.w,l.h,l.radius||0);ctx.clip();}
        }
        // Cropping constrains visibility, NOT the image's own transform.
        // Use the live layer rectangle so repositioning in the editor also affects exports.
        const frame=mask||l;
        const ir=img.width/img.height,rr=frame.w/frame.h;let dw,dh,dx,dy;
        if(ir>rr){dh=frame.h;dw=dh*ir;dx=(frame.w-dw)/2;dy=0}else{dw=frame.w;dh=dw/ir;dx=0;dy=(frame.h-dh)/2}
        ctx.drawImage(img,frame.x-offsetX+dx,frame.y+dy,dw,dh);
      }
      ctx.restore();
    };
  const renderSlideCanvas = async(page, outputScale=1) => {
    const c=document.createElement('canvas');
    c.width=Math.round(PAGE_W*outputScale);
    c.height=Math.round(PAGE_H*outputScale);
    const ctx=c.getContext('2d');
    if(!ctx)throw new Error('Canvas rendering is unavailable.');
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
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
    for(const layer of orderedLayers)await renderLayer(ctx,layer,page*(PAGE_W+GAP));
    return c;
  };
  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewSlides([]);
    previewUrlsRef.current.forEach(url=>URL.revokeObjectURL(url));
    previewUrlsRef.current=[];
  };
  const openPreview = async () => {
    if(previewBusy)return;
    setPreviewOpen(true);setPreviewBusy(true);setPreviewError('');setPreviewIndex(0);
    const urls=[];
    try{
      await document.fonts.ready;
      for(let page=0;page<pages;page++){
        const canvas=await renderSlideCanvas(page,2);
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not render slide.')),'image/png'));
        urls.push(URL.createObjectURL(blob));canvas.width=0;canvas.height=0;
      }
      previewUrlsRef.current.forEach(url=>URL.revokeObjectURL(url));
      previewUrlsRef.current=urls;
      setPreviewSlides(urls);
    }catch(error){urls.forEach(url=>URL.revokeObjectURL(url));setPreviewError(error.message);}
    finally{setPreviewBusy(false);}
  };
  useEffect(()=>()=>{previewUrlsRef.current.forEach(url=>URL.revokeObjectURL(url));},[]);

  const exportSlides = async () => {
    if(exporting) return;
    setExporting(true);
    try {
      await document.fonts.ready;
      // Export at 2x the native slide dimensions with lossless PNG encoding.
      // PNG files are already compressed; ZIP stores them without recompression.
      const scale = 2;
      const items = [];
      for(let p=0;p<pages;p++){
        const c=await renderSlideCanvas(p,dims.exportW*scale/PAGE_W);
        const blob=await new Promise((resolve,reject)=>c.toBlob(value=>value?resolve(value):reject(new Error('PNG encoding failed.')),'image/png'));
        items.push({name:`slide-${String(p+1).padStart(String(pages).length,2)}.png`,bytes:new Uint8Array(await blob.arrayBuffer())});
        c.width=0;c.height=0;
        // Allow the UI to update during long exports.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const archive=createZip(items);
      const title=projectName.replace(/\.(frame|json)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim() || 'Untitled';
      const url=URL.createObjectURL(archive);
      const a=document.createElement('a');
      a.download=`${title}.zip`;
      a.href=url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    } catch(error) {
      console.error('Export failed:',error);
      alert(`Could not export slides: ${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  if(!editorReady) return <div className={`app theme-${appTheme}`}><div className="frame-loading" role="status">Opening FRAME project…</div></div>;
  return <div className={`app theme-${appTheme} ${gradientButtons?'decor-gradient':''}`} style={{"--accent":accent,"--accent-soft":`${accent}24`,"--brand-primary":brandPrimary,"--toolbar-color":toolbarColor,"--logo-gradient-end":logoGradientEnd,"--export-gradient-end":exportGradientEnd,"--logo-gradient-angle":`${logoGradientAngle}deg`,"--export-gradient-angle":`${exportGradientAngle}deg`}}>
    <header>
      <div className="brand"><div className="mark">F</div><div><strong>FRAME</strong>
        <div className="project-title-row">
          {renaming ? <input autoFocus className="project-rename" aria-label="Project name" value={nameDraft}
            onChange={e=>setNameDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') finishRename(); if(e.key==='Escape'){setRenaming(false);setProjectError('');}}}
            onBlur={finishRename}/> : <button className="project-title-button" title="Rename project" onClick={beginRename}>{projectName}</button>}
          <span> · {saveState}</span>
          <button className="projects-toggle" onClick={()=>{setProjectsOpen(v=>!v);refreshRecentProjects();setProjectError('')}} title="Recent projects"><FolderOpen size={13}/> Projects</button>
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
        <button className="carousel-presets-trigger" title="Browse carousel layouts and save your own" onClick={()=>{setPresetsOpen(true);setPresetNotice('');setPresetPending(null)}}>Presets</button>
        <button className="icon" title="Open project (Ctrl+O)" onClick={openProject}><FolderOpen size={18}/></button>
        <button className="icon" title="Save project (Ctrl+S)" onClick={()=>saveProject(false)}><Save size={18}/></button>
        <button className="icon" onClick={undo} disabled={!history.length}><Undo2 size={18}/></button>
        <button className="icon" onClick={redo} disabled={!future.length}><Redo2 size={18}/></button>
        <button className="preview-action" type="button" onClick={openPreview} disabled={previewBusy} title="Preview individual slides without editor guides">Preview</button>
        <button className="export" onClick={exportSlides} disabled={exporting}><Download size={17}/> {exporting ? "Exporting…" : "Export ZIP"}</button>
      </div>
    </header>
    {previewOpen && <div className="instagram-preview-overlay" onPointerDown={e=>{if(e.target===e.currentTarget)closePreview()}}>
      <section className="instagram-preview-dialog" role="dialog" aria-modal="true" aria-label="Instagram carousel preview">
        <div className="instagram-preview-header"><div><b>Instagram carousel preview</b><span>Each slide as exported, without editing guides</span></div><button type="button" onClick={closePreview} aria-label="Close preview">×</button></div>
        {previewBusy?<p className="preview-loading">Rendering slides…</p>:previewError?<p className="preview-error">{previewError}</p>:previewSlides.length>0?<>
          <div className="instagram-preview-stage">
            <button className="preview-nav" type="button" onClick={()=>setPreviewIndex(i=>Math.max(0,i-1))} disabled={previewIndex===0} aria-label="Previous slide">‹</button>
            <img className="instagram-preview-image" src={previewSlides[previewIndex]} alt={`Slide ${previewIndex+1} of ${previewSlides.length}`} />
            <button className="preview-nav" type="button" onClick={()=>setPreviewIndex(i=>Math.min(previewSlides.length-1,i+1))} disabled={previewIndex===previewSlides.length-1} aria-label="Next slide">›</button>
          </div>
          <div className="instagram-preview-footer"><span>Slide {previewIndex+1} / {previewSlides.length}</span><div className="preview-dots">{previewSlides.map((_,i)=><button key={i} className={i===previewIndex?'active':''} onClick={()=>setPreviewIndex(i)} aria-label={`Show slide ${i+1}`} />)}</div><button type="button" onClick={openPreview}>Refresh</button></div>
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
      <section className="projects-dialog" role="dialog" aria-label="Recent projects">
        <div className="projects-dialog-heading"><b>Recent projects</b><button onClick={()=>setProjectsOpen(false)}>Close</button></div>
        <button className="projects-open-file" onClick={async()=>{await openProject();setProjectsOpen(false)}}><FolderOpen size={16}/> Browse for project...</button>
        {recentProjects.length ? recentProjects.map(item=><button key={item.path} className="recent-project" onClick={()=>openRecentProject(item.path)}>
          <strong>{item.name}</strong><small title={item.path}>{item.path}</small>
        </button>) : <p>No recent projects yet. Save or open a .frame project to see it here.</p>}
        {projectError && <p className="project-error">{projectError}</p>}
      </section>
    </div>}
    {!projectsOpen && projectError && <div className="project-error-banner" onClick={()=>setProjectError('')}>{projectError} ×</div>}

    <main className="resizable-editor" style={{"--rail-width":`${railWidth}px`,"--inspector-width":`${inspectorWidth}px`}}>
      <aside className="rail">
        <button className={panel==='edit'?'active':''} onClick={()=>{setPanel('edit');setShapePickerOpen(false)}}><Move/><span>Edit</span></button>
        <button className={photoPickerOpen?'active':''} onClick={()=>{setPhotoPickerOpen(v=>!v);setTextPickerOpen(false);setShapePickerOpen(false)}}><ImagePlus/><span>Photos</span></button>
        <button className={textPickerOpen?'active':''} onClick={()=>{setTextPickerOpen(v=>!v);setPhotoPickerOpen(false);setShapePickerOpen(false)}}><Type/><span>Text</span></button>
        <button ref={shapeButtonRef} className={shapePickerOpen?'active':''} onClick={()=>{setShapePickerOpen(open=>!open);setPhotoPickerOpen(false);setTextPickerOpen(false)}}><Shapes/><span>Shape</span></button>
        <button className={panel==='layers'?'active':''} onClick={()=>{setPanel('layers');setShapePickerOpen(false)}}><Layers3/><span>Layers</span></button>
        <button className={panel==='style'?'active':''} onClick={()=>{setPanel('style');setShapePickerOpen(false)}}><Palette/><span>Style</span></button>
      </aside>
      <div className="panel-splitter" role="separator" aria-orientation="vertical" aria-label="Resize left toolbar" onPointerDown={e=>startPanelResize(e,'left')} />

      <section className="workspace" onPointerDown={e=>{if(e.button===2 || e.target.closest('.layer'))return;clearSelection();setShapePickerOpen(false);setContextMenu(null)}} onContextMenu={e=>{
        e.preventDefault();
        if(e.target.closest('.layer')) return;
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
        <div className="stage-scroller" ref={stageScrollerRef} onPointerDown={startWorkspacePan} onAuxClick={e=>{if(e.button===1)e.preventDefault()}}>
          <div className="stage-wrap" style={{width:canvasW*zoom,height:PAGE_H*zoom}}>
            <div className="stage" key={projectGeneration} ref={stageRef} onPointerMove={rememberCanvasCursor} onPointerLeave={()=>{cursorOnCanvasRef.current=null;}} style={{width:canvasW,height:PAGE_H,background:canvasBackground(bg,canvasDesign),transform:`scale(${zoom})`}}>
              {canvasDesign.showGuides && Array.from({length:pages-1},(_,i)=><div className={`seam ${layers.some(layer=>layer.type==='image' && layer.cropPage===i)?'seam-over-fill':''}`} key={i} style={{left:(i+1)*PAGE_W+i*GAP}}><span>{i+1}</span><span>{i+2}</span></div>)}
              {[...layers].sort((a,b)=>(a.z||0)-(b.z||0)).map(l=><Layer key={l.id} layer={{...l,pageWidth:PAGE_W,pageHeight:PAGE_H}} displayMask={l.type==='image'&&l.maskShapeId?layers.find(x=>x.id===l.maskShapeId):null} selected={selectedIds.includes(l.id)} dropTarget={dropShapeId===l.id} clipPath={l.type==='image'&&l.maskShapeId?shapeClipPath(layers.find(x=>x.id===l.maskShapeId)):null} onPointerDown={e=>startDrag(e,l)} onResize={(e,handle)=>startResize(e,l,handle)} onContextMenu={e=>openLayerMenu(e,l)} onDoubleClick={()=>{
                if(l.type==='text'){const t=prompt('Edit text',l.text); if(t!==null){checkpoint();setSelected(l.id);setLayers(v=>v.map(x=>x.id===l.id?{...x,text:t}:x));}}
              }}/>) }
            </div>
          </div>
        </div>
        {contextMenu && <div className="layer-context-menu" role="menu" style={{left:contextMenu.x,top:contextMenu.y}} onPointerDown={e=>e.stopPropagation()}>
          <button role="menuitem" disabled={!contextMenu.id || layerAtFront(contextMenu.id)} onClick={()=>contextAction('front')}><Layers3 size={15}/> Bring to front</button>
          <button role="menuitem" disabled={!contextMenu.id || layerAtBack(contextMenu.id)} onClick={()=>contextAction('back')}><Layers3 size={15}/> Send to back</button>
          <button role="menuitem" onClick={()=>contextAction('copy')} disabled={!contextMenu.id}><Copy size={15}/> Copy</button>
          <button role="menuitem" onClick={()=>contextAction('paste')} disabled={!layerClipboardRef.current}><Copy size={15}/> Paste</button>
          <button role="menuitem" onClick={()=>contextAction('duplicate')} disabled={!contextMenu.id}><Copy size={15}/> Duplicate</button>
          {contextMenu.selectionIds?.length>1 && <button role="menuitem" onClick={()=>contextAction('group')}><Layers3 size={15}/> Group {contextMenu.selectionIds.length} selected layers</button>}
          {layers.find(x=>x.id===contextMenu.id)?.groupId && <button role="menuitem" onClick={()=>contextAction('ungroup')}>Ungroup</button>}
          {layers.find(x=>x.id===contextMenu.id)?.type==='image' && <button role="menuitem" onClick={()=>contextAction('fitPage')}>Fit image to page</button>}
          {layers.find(x=>x.id===contextMenu.id)?.type==='image' && <button role="menuitem" onClick={()=>contextAction('fillPage')}>Fill page (crop edges)</button>}
          {layers.find(x=>x.id===contextMenu.id)?.maskShapeId && <button role="menuitem" onClick={()=>contextAction('selectMask')}>Edit underlying shape</button>}
          {layers.find(x=>x.id===contextMenu.id)?.maskShapeId && <button role="menuitem" onClick={()=>{detachImageFromShape(contextMenu.id);setContextMenu(null)}}>Detach image from shape</button>}
          <button role="menuitem" className="danger" disabled={!contextMenu.id} onClick={()=>contextAction('delete')}><Trash2 size={15}/> Delete</button>
        </div>}
        <div className="zoom"><button onClick={()=>setZoom(z=>Math.max(.45,z-.1))}><Minus/></button>
          {zoomEditing ? <input autoFocus className="zoom-value-input" aria-label="Canvas zoom percentage" type="text" value={zoomDraft}
            onChange={e=>setZoomDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') commitCanvasZoom(); if(e.key==='Escape')setZoomEditing(false)}} onBlur={commitCanvasZoom}/> :
            <button className="zoom-value-button" title="Enter canvas zoom (45-135%)" onClick={()=>{setZoomDraft(String(Math.round(zoom*100)));setZoomEditing(true)}}>{Math.round(zoom*100)}%</button>}
          <button onClick={()=>setZoom(z=>Math.min(1.35,z+.1))}><Plus/></button></div>
      </section>

      <div className="panel-splitter" role="separator" aria-orientation="vertical" aria-label="Resize right inspector" onPointerDown={e=>startPanelResize(e,'right')} />
      <aside className="inspector">
        {panel==='layers' ? <LayersPanel layers={layers} selectedIds={selectedIds} setSelected={id=>{setMultiSelected([]);setSelected(id)}} onReorder={reorderLayer} /> :
         panel==='style' ? <StylePanel bg={bg} setBg={v=>{checkpoint();setBg(v)}} canvasDesign={canvasDesign} changeCanvasDesign={changeCanvasDesign} appTheme={appTheme} setAppTheme={setAppTheme} accent={accent} setAccent={setAccent} accentSwatches={accentSwatches} setAccentSwatches={setAccentSwatches} canvasSwatches={canvasSwatches} setCanvasSwatches={setCanvasSwatches} gradientButtons={gradientButtons} setGradientButtons={setGradientButtons} brandPrimary={brandPrimary} setBrandPrimary={setBrandPrimary} toolbarColor={toolbarColor} setToolbarColor={setToolbarColor} logoGradientEnd={logoGradientEnd} setLogoGradientEnd={setLogoGradientEnd} exportGradientEnd={exportGradientEnd} setExportGradientEnd={setExportGradientEnd} logoGradientAngle={logoGradientAngle} setLogoGradientAngle={setLogoGradientAngle} exportGradientAngle={exportGradientAngle} setExportGradientAngle={setExportGradientAngle} themeLibrary={themeLibrary} themeNames={themeNames} setThemeNames={setThemeNames} themeNotice={themeNotice} gradientSwatches={gradientSwatches} saveGradientSwatch={saveGradientSwatch} removeGradientSwatch={removeGradientSwatch} saveTheme={saveTheme} applyTheme={applyTheme} deleteTheme={deleteTheme} orientation={orientation} changeOrientation={changeOrientation} /> :
         multiSelected.length>1 ? <div className="panel"><div className="panel-head"><b>{multiSelected.length} layers selected</b><span>Drag any selected layer to move the group</span></div><button className="group-selection-button" onClick={()=>{const ids=[...multiSelected];const groupId=uid();checkpoint();setLayers(items=>items.map(item=>ids.includes(item.id)?{...item,groupId}:item));}}>Group selected layers</button><button className="danger" onClick={remove}><Trash2/> Delete selected layers</button></div> :
         chosen ? <EditPanel chosen={chosen} patch={patch} remove={remove} duplicate={duplicate} bringFront={bringFront} checkpoint={checkpoint} detachImageFromShape={detachImageFromShape} textSwatches={textSwatches} setTextSwatches={setTextSwatches}/> :
         (layers.length ? <div className="panel empty selection-placeholder"><div className="orb"><Move/></div><b>Select an object</b><p>Click an image, shape, or text layer on the canvas to edit it, or open Layers to reorder objects.</p></div> : <EmptyPanel onImages={onImages} addText={addText}/>)}
      </aside>
    </main>
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
  const fillFrame=layer.type==='image' && Number.isInteger(layer.cropPage) && !displayMask && Number.isFinite(layer.pageWidth) ? {x:layer.cropPage*(layer.pageWidth+1),y:0,w:layer.pageWidth+1,h:layer.pageHeight}:null;
  const frame=displayMask||fillFrame||layer;
  const common={left:frame.x,top:frame.y,width:frame.w,height:frame.h,zIndex:layer.z||1,borderRadius:layer.type==='shape'?0:(layer.radius||0)};
  return <div className={`layer ${selected?'selected':''} ${dropTarget?'shape-drop-target':''} ${fillFrame?'layer-image-fill':''}`} style={{...common,clipPath:clipPath||undefined}} onPointerDown={onPointerDown} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick}>
    {layer.type==='shape' && <ShapePreview shape={shapeKind(layer)} color={layer.color} radius={layer.radius||0}/>}
    {layer.type==='image' && <img src={layer.src} draggable="false" style={fillFrame ? {
      position:'absolute',left:layer.x-fillFrame.x,top:layer.y-fillFrame.y,
      width:layer.w,height:layer.h,maxWidth:'none',maxHeight:'none',
      borderRadius:0,objectFit:'cover',pointerEvents:'none'
    } : {borderRadius:displayMask?0:(layer.radius||0),objectFit:'cover'}}/>}
    {layer.type==='text' && <div className="text-layer" style={{fontSize:layer.fontSize,color:layer.color,fontWeight:layer.weight,textAlign:layer.align,fontFamily:layer.fontFamily||'Inter',whiteSpace:'pre-line'}}>{layer.text}</div>}
    {selected && <>{['nw','n','ne','e','se','s','sw','w'].map(handle=><i key={handle} className={`resize-handle handle-${handle}`} onPointerDown={e=>onResize(e,handle)}/>)}</>}
  </div>
}

function EditPanel({chosen,patch,remove,duplicate,bringFront,checkpoint,detachImageFromShape,textSwatches,setTextSwatches}){
  const [fontOpen,setFontOpen]=useState(false);
  return <div className="panel"><div className="panel-head"><b>{chosen.type[0].toUpperCase()+chosen.type.slice(1)}</b><span>Selected layer</span></div>
    {chosen.type==='text' && <>
      <label>Text<textarea className="font-aware-textarea" style={{fontFamily:`"${chosen.fontFamily||'Inter'}", sans-serif`,fontWeight:chosen.weight||400}} value={chosen.text} onFocus={checkpoint} onChange={e=>patch({text:e.target.value})}/></label>
      <div className="font-picker"><label>Font</label><button type="button" className="font-picker-trigger" aria-expanded={fontOpen} onClick={()=>setFontOpen(v=>!v)}><span style={{fontFamily:`"${chosen.fontFamily||'Inter'}", sans-serif`}}>{chosen.fontFamily||'Inter'}</span><span>{fontOpen?'▴':'▾'}</span></button>
      {fontOpen && <div className="font-picker-list" role="listbox" aria-label="Font choices">{FONT_OPTIONS.map(font=><button type="button" role="option" aria-selected={(chosen.fontFamily||'Inter')===font} className={(chosen.fontFamily||'Inter')===font?'current':''} key={font} onClick={()=>{checkpoint();patch({fontFamily:font});setFontOpen(false)}}><span className="font-picker-name">{font}</span><span className="font-picker-example" style={{fontFamily:`"${font}", sans-serif`}}>The quick brown fox</span></button>)}</div>}</div>
      <label>Size<input type="range" min="10" max="96" value={chosen.fontSize} onPointerDown={checkpoint} onChange={e=>patch({fontSize:+e.target.value})}/></label>
      <div className="text-editor-color-row"><div className="editor-color-control"><ToggleColor label="Text color" value={chosen.color} onChange={value=>patch({color:value})} swatches={textSwatches} onEditSwatches={setTextSwatches}/></div><label>Weight<select value={chosen.weight} onFocus={checkpoint} onChange={e=>patch({weight:+e.target.value})}><option value="400">Regular</option><option value="600">Semi</option><option value="700">Bold</option><option value="800">Black</option></select></label></div>
      <label>Alignment<select value={chosen.align||'left'} onFocus={checkpoint} onChange={e=>patch({align:e.target.value})}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    </>}
    {chosen.type==='shape' && <>
      <label>Shape<select value={shapeKind(chosen)} onFocus={checkpoint} onChange={e=>patch({shape:e.target.value})}>{SHAPES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <div className="editor-color-control"><ToggleColor label="Shape fill" value={chosen.color} onChange={value=>patch({color:value})}/><label className="shape-color-hex">Fill HEX<input type="text" maxLength={7} spellCheck={false} value={chosen.color||''} onFocus={checkpoint} onChange={e=>{const hex=e.target.value;if(isHex(hex))patch({color:hex})}}/></label></div>
      {shapeKind(chosen)==='rounded' && <label>Corner radius<input type="range" min="0" max="60" value={chosen.radius||0} onPointerDown={checkpoint} onChange={e=>patch({radius:+e.target.value})}/></label>}
      <div className="shape-size"><label>Width<input type="number" min="18" value={Math.round(chosen.w)} onFocus={checkpoint} onChange={e=>patch({w:Math.max(18,Number(e.target.value)||18)})}/></label><label>Height<input type="number" min="18" value={Math.round(chosen.h)} onFocus={checkpoint} onChange={e=>patch({h:Math.max(18,Number(e.target.value)||18)})}/></label></div>
    </>}
    {chosen.type==='image' && chosen.maskShapeId && <div className="mask-helper">Image fitted to a shape. The image and shape remain editable separately.<button type="button" className="detach-shape-button" onClick={()=>detachImageFromShape(chosen.id)}>Detach image from shape</button></div>}
    {chosen.type==='image' && <label>Corner radius<input type="range" min="0" max="60" value={chosen.radius} onPointerDown={checkpoint} onChange={e=>patch({radius:+e.target.value})}/></label>}
    <div className="row actions"><button onClick={duplicate}><Copy/> Duplicate</button><button onClick={bringFront}><Layers3/> Front</button></div>
    <button className="danger" onClick={remove}><Trash2/> Delete layer</button>
  </div>
}

function LayersPanel({layers,selectedIds,setSelected,onReorder}){
  const [draggedId,setDraggedId]=useState(null);
  const [target,setTarget]=useState(null);
  const ordered=[...layers].sort((a,b)=>(b.z||0)-(a.z||0));
  const resetDrag=()=>{setDraggedId(null);setTarget(null);};
  return <div className="panel"><div className="panel-head"><b>Layers</b><span>{layers.length} objects · Drag to rearrange</span></div>
    <div className="layer-list">{ordered.map(l=><button key={l.id} type="button" draggable="true"
      className={`${selectedIds.includes(l.id)?'sel':''} ${draggedId===l.id?'layer-dragging':''} ${target?.id===l.id?'layer-drop-'+target.side:''}`}
      onClick={()=>setSelected(l.id)}
      onDragStart={e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',l.id);setDraggedId(l.id);}}
      onDragOver={e=>{if(!draggedId || draggedId===l.id)return;e.preventDefault();e.dataTransfer.dropEffect='move';const rect=e.currentTarget.getBoundingClientRect();setTarget({id:l.id,side:e.clientY<rect.top+rect.height/2?'above':'below'});}}
      onDrop={e=>{e.preventDefault();e.stopPropagation();const source=draggedId||e.dataTransfer.getData('text/plain');if(source!==l.id){const rect=e.currentTarget.getBoundingClientRect();onReorder(source,l.id,e.clientY>=rect.top+rect.height/2);}resetDrag();}}
      onDragEnd={resetDrag}>
      <GripVertical className="layer-grip" size={15}/><span className="thumb">{l.type==='image'?<img src={l.src}/>:l.type==='text'?<Type/>:<Shapes/>}</span>
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
