// Mobile Home routing: the legacy ProjectThumbnail only renders rectangular
// shapes and elliptical border-radius. It does not draw polygons or attached
// photo masks. Use MobileMaskedThumbnail for those documents even if there
// isn't an attached image yet.
const NON_RECTANGULAR_SHAPES=new Set(['triangle','diamond','star','ellipse']);

export function needsShapeAwareHomeThumbnail(project){
  const layers=Array.isArray(project?.layers)?project.layers:[];
  const shapeIds=new Set(layers.filter(layer=>layer?.type==='shape').map(layer=>layer.id));
  return layers.some(layer=>
    (layer?.type==='shape' && NON_RECTANGULAR_SHAPES.has(layer.shape)) ||
    (layer?.type==='image' && !!layer.maskShapeId && shapeIds.has(layer.maskShapeId)));
}
