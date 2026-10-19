import React, {useId} from 'react';
import {ProjectThumbnail} from './ProjectThumbnail.jsx';
import {getMaskCropGeometry} from '../../../packages/editor/src/maskCrop.mjs';
import {needsShapeAwareHomeThumbnail} from './thumbnailShapeRouting.mjs';

// A small first-slide preview built from the saved document layers. Masked
// images use their SHAPE for placement and the same crop geometry as the editor.
// Rendering is cheap: no full-slide Canvas decode or PNG generation.
const SHAPE_POINTS={
  triangle:'50,0 100,100 0,100',
  diamond:'50,0 100,50 50,100 0,50',
  star:Array.from({length:10},(_,i)=>{
    const angle=-Math.PI/2+i*Math.PI/5,r=i%2===0?49:22;
    return `${50+Math.cos(angle)*r},${50+Math.sin(angle)*r}`;
  }).join(' ')
};
const shapeKind=layer=>layer.shape||'rounded';
// Draw the colored shape using the same SVG silhouette as its image mask.
// The legacy thumbnail only understands border-radius, so a triangle would
// otherwise fall back to a rounded box even when the saved shape is correct.
function ThumbnailShape({layer}) {
  const width=Math.max(1,Number(layer.w)||1);
  const height=Math.max(1,Number(layer.h)||1);
  const kind=shapeKind(layer);
  const fill=layer.color||'#cbd5e1';
  const coordinates=SHAPE_POINTS[kind];
  const radius=kind==='rounded'?Math.max(0,Math.min(Number(layer.radius)||0,width/2,height/2)):0;
  return <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${height}`}
    preserveAspectRatio="none" style={{position:'absolute',left:Number(layer.x)||0,
      top:Number(layer.y)||0,width,height,display:'block',overflow:'visible',
      pointerEvents:'none',opacity:layer.opacity??1}}>
    {kind==='ellipse'?<ellipse cx={width/2} cy={height/2} rx={width/2} ry={height/2} fill={fill}/>:
      coordinates?<polygon points={coordinates.split(' ').map(pair=>{
        const [x,y]=pair.split(',').map(Number);
        return `${x*width/100},${y*height/100}`;
      }).join(' ')} fill={fill}/>:
      <rect width={width} height={height} rx={radius} ry={radius} fill={fill}/>}
  </svg>;
}

// Render masked photos with the shape as the actual SVG clipping path.
// A nested HTML img can be affected by thumbnail styles from either platform;
// this clip stays local to the photo and matches the saved mask geometry.
function MaskedThumbnailPhoto({image,mask}) {
  const clipId=useId().replace(/[^A-Za-z0-9_-]/g,'');
  const width=Math.max(1,Number(mask.w)||1);
  const height=Math.max(1,Number(mask.h)||1);
  const crop=getMaskCropGeometry(image,mask);
  const kind=shapeKind(mask);
  const coordinates=SHAPE_POINTS[kind];
  let outline;
  if(kind==='ellipse'){
    outline=<ellipse cx={width/2} cy={height/2} rx={width/2} ry={height/2}/>;
  }else if(coordinates){
    const points=coordinates.split(' ').map(pair=>{
      const [x,y]=pair.split(',').map(Number);
      return `${x*width/100},${y*height/100}`;
    }).join(' ');
    outline=<polygon points={points}/>;
  }else{
    const radius=kind==='rounded'?Math.max(0,Math.min(Number(mask.radius)||0,width/2,height/2)):0;
    outline=<rect width={width} height={height} rx={radius} ry={radius}/>;
  }
  return <svg className="frame-home-masked-photo" aria-hidden="true" focusable="false"
    viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    style={{position:'absolute',left:Number(mask.x)||0,top:Number(mask.y)||0,
      width,height,display:'block',overflow:'hidden',pointerEvents:'none',opacity:image.opacity??1}}>
    <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse">{outline}</clipPath></defs>
    <image href={image.src} x={crop.x-(Number(mask.x)||0)} y={crop.y-(Number(mask.y)||0)}
      width={crop.w} height={crop.h} preserveAspectRatio="none"
      clipPath={`url(#${clipId})`}/>
  </svg>;
}

export function MobileMaskedThumbnail({project}) {
  // Route ALL non-rectangular shapes through the shape-aware renderer, even
  // before a photo is attached. The legacy renderer silently drew any shape
  // other than an ellipse as a rounded rectangle on the Home screen.
  // Projects containing only ordinary photos/text/rectangles keep Studio's
  // existing lightweight thumbnail implementation.
  if(!needsShapeAwareHomeThumbnail(project))return <ProjectThumbnail project={project}/>;
  const landscape=project?.orientation==='landscape';
  const width=landscape?400:320;
  const height=landscape?320:400;
  const displayWidth=landscape?116:93;
  const scale=displayWidth/width;
  const design=project?.canvasDesign;
  const bg=project?.bg||'#f7f4ef';
  const background=design?.mode==='gradient'
    ? `linear-gradient(${Number(design.angle)||90}deg, ${bg}, ${design.secondary||bg})` : bg;
  const allLayers=Array.isArray(project?.layers)?project.layers:[];
  const shapesById=new Map(allLayers.filter(layer=>layer?.type==='shape').map(layer=>[layer.id,layer]));
  const layers=allLayers.filter(layer=>{
    if(!layer)return false;
    // The original image's old coordinates must never hide its attached mask.
    const frame=layer.type==='image' && layer.maskShapeId?shapesById.get(layer.maskShapeId)||layer:layer;
    return Number(frame.x)<width && Number(frame.x)+Number(frame.w||0)>0 &&
      Number(frame.y)<height && Number(frame.y)+Number(frame.h||0)>0;
  }).slice().sort((a,b)=>(Number(a.z)||0)-(Number(b.z)||0));

  return <span className="frame-home-thumbnail" aria-hidden="true"
    style={{width:displayWidth,height:height*scale}}>
    <span className="frame-home-thumbnail-canvas" style={{width,height,background,transform:`scale(${scale})`}}>
      {layers.map((layer,index)=>{
        const style={position:'absolute',left:Number(layer.x)||0,top:Number(layer.y)||0,
          width:Math.max(0,Number(layer.w)||0),height:Math.max(0,Number(layer.h)||0),
          overflow:'hidden',boxSizing:'border-box',opacity:layer.opacity??1,
          transform:layer.rotation?`rotate(${layer.rotation}deg)`:undefined};
        if(layer.type==='image'){
          if(!layer.src)return null;
          const mask=layer.maskShapeId?shapesById.get(layer.maskShapeId):null;
          if(mask)return <MaskedThumbnailPhoto key={layer.id||index} image={layer} mask={mask}/>;
          return <img key={layer.id||index} src={layer.src} loading="lazy" decoding="async" alt=""
            style={{...style,objectFit:'cover',borderRadius:layer.radius||0}}/>;
        }
        if(layer.type==='shape')return <ThumbnailShape key={layer.id||index} layer={layer}/>;
        if(layer.type==='text')return <span key={layer.id||index} style={{...style,
          color:layer.color||'#111',fontSize:Number(layer.fontSize)||18,
          fontWeight:layer.weight||400,fontFamily:layer.fontFamily||'sans-serif',
          textAlign:layer.align||'left',whiteSpace:'pre-wrap',lineHeight:1.15}}>{layer.text}</span>;
        return null;
      })}
    </span>
  </span>;
}
