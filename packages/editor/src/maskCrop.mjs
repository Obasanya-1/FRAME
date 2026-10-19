// 08K: Shared mask-crop geometry for the React editor, review, and Canvas PNGs.
// Saved properties stay dimensionless so resizing a shape preserves its crop.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const clampMaskZoom = value => clamp(Number.isFinite(Number(value)) ? Number(value) : 1,1,4);
export const clampMaskPan = value => clamp(Number.isFinite(Number(value)) ? Number(value) : 0,-1,1);
export function getMaskCropGeometry(image,mask,sourceWidth,sourceHeight){
  const w=Math.max(1,Number(mask?.w)||1),h=Math.max(1,Number(mask?.h)||1);
  const sw=Number(sourceWidth)||Number(image?.naturalWidth)||Number(image?.w)||1;
  const sh=Number(sourceHeight)||Number(image?.naturalHeight)||Number(image?.h)||1;
  const ratio=Math.max(.0001,sw/Math.max(.0001,sh));
  const baseWidth=Math.max(w,h*ratio);
  const baseHeight=baseWidth/ratio;
  const zoom=clampMaskZoom(image?.maskZoom);
  const drawWidth=baseWidth*zoom,drawHeight=baseHeight*zoom;
  const overflowX=Math.max(0,drawWidth-w),overflowY=Math.max(0,drawHeight-h);
  const panX=clampMaskPan(image?.maskPanX),panY=clampMaskPan(image?.maskPanY);
  return {x:(Number(mask?.x)||0)+(w-drawWidth)/2+panX*overflowX/2,
    y:(Number(mask?.y)||0)+(h-drawHeight)/2+panY*overflowY/2,
    w:drawWidth,h:drawHeight,overflowX,overflowY};
}
