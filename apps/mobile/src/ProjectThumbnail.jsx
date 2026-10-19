import React from 'react';

// A tiny, non-interactive first-slide representation. No Canvas exports, blobs,
// timers, or additional project storage. All coordinates use FRAME's logical size.
export function ProjectThumbnail({project}) {
  const landscape = project?.orientation === 'landscape';
  const width = landscape ? 400 : 320;
  const height = landscape ? 320 : 400;
  const displayWidth = landscape ? 116 : 93;
  const scale = displayWidth / width;
  const design = project?.canvasDesign;
  const bg = project?.bg || '#f7f4ef';
  const background = design?.mode === 'gradient'
    ? `linear-gradient(${Number(design.angle) || 90}deg, ${bg}, ${design.secondary || bg})`
    : bg;
  // Studio stores a small JPEG rendered through its real Canvas exporter.
  // Older files and Android projects retain the regular layer preview below.
  const savedPreview = project?.previewImage || project?.studioThumbnail;
  if(typeof savedPreview === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(savedPreview)) {
    return <span className="frame-home-thumbnail" aria-hidden="true"
      style={{width:displayWidth,height:height*scale}}>
      <img className="frame-home-saved-preview" src={savedPreview} alt="" draggable="false" />
    </span>;
  }
  const layers = (project?.layers || [])
    .filter(layer => layer && Number(layer.x) < width && Number(layer.x) + Number(layer.w || 0) > 0)
    .slice().sort((a,b)=>(Number(a.z)||0)-(Number(b.z)||0));

  return <span className="frame-home-thumbnail" aria-hidden="true"
    style={{width:displayWidth,height:height*scale}}>
    <span className="frame-home-thumbnail-canvas" style={{width,height,background,transform:`scale(${scale})`}}>
      {layers.map((layer,index)=>{
        const style={position:'absolute',left:Number(layer.x)||0,top:Number(layer.y)||0,
          width:Math.max(0,Number(layer.w)||0),height:Math.max(0,Number(layer.h)||0),
          overflow:'hidden',boxSizing:'border-box',opacity:layer.opacity ?? 1,
          transform:layer.rotation ? `rotate(${layer.rotation}deg)` : undefined};
        if(layer.type==='image')return layer.src
          ? <img key={layer.id||index} src={layer.src} loading="lazy" decoding="async" alt=""
              style={{...style,objectFit:'cover',borderRadius:layer.radius||0}}/>
          : null;
        if(layer.type==='shape')return <span key={layer.id||index} style={{...style,
          background:layer.color||'#cbd5e1',borderRadius:layer.shape==='ellipse'?'50%':layer.radius||0}}/>;
        if(layer.type==='text')return <span key={layer.id||index} style={{...style,
          color:layer.color||'#111',fontSize:Number(layer.fontSize)||18,
          fontWeight:layer.weight||400,fontFamily:layer.fontFamily||'sans-serif',
          textAlign:layer.align||'left',whiteSpace:'pre-wrap',lineHeight:1.15}}>{layer.text}</span>;
        return null;
      })}
    </span>
  </span>;
}
