// Shared, non-destructive slide removal. Objects spanning a page boundary
// belong to every slide on which some of their visible bounds appear.
export function layersAfterRemovingFinalSlide(layers, pages, pageWidth, gap = 0, pageHeight = Infinity) {
  if (pages <= 1) return layers;
  const lastPage = pages - 1;
  const keptRightEdge = lastPage * (pageWidth + gap) - gap;
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const visibleOnEarlierSlide = layer => {
    // Fill Page renders only inside its assigned slide, regardless of the
    // underlying image coordinates used to position/crop its contents.
    if (layer.type === 'image' && Number.isInteger(layer.cropPage)) {
      return layer.cropPage >= 0 && layer.cropPage < lastPage;
    }
    const mask = layer.type === 'image' ? byId.get(layer.maskShapeId) : null;
    const bounds = mask?.type === 'shape' ? mask : layer;
    const x = Number(bounds.x);
    const width = Number(bounds.w);
    const y = Number(bounds.y);
    const height = Number(bounds.h);
    return Number.isFinite(x) && Number.isFinite(width) && width > 0 &&
      x < keptRightEdge && x + width > 0 &&
      (Number.isFinite(y) && Number.isFinite(height) && height > 0 && y < pageHeight && y + height > 0);
  };
  const retained = layers.filter(visibleOnEarlierSlide);
  const retainedIds = new Set(retained.map(layer => layer.id));
  return retained.map(layer => layer.maskShapeId && !retainedIds.has(layer.maskShapeId)
    ? {...layer, maskShapeId: null} : layer);
}

// Select a representative thumbnail slide, preferring the first slide
// containing any visible image. The renderer and Electron use this rule.
export function thumbnailPageForProject(layers, pages, pageWidth, gap = 0) {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  for(let page = 0; page < pages; page++) {
    const left = page * (pageWidth + gap);
    for(const image of layers) {
      if(image.type !== 'image')continue;
      if(Number.isInteger(image.cropPage)) {
        if(image.cropPage === page)return page;
        continue;
      }
      const shape = byId.get(image.maskShapeId);
      const bounds = shape?.type === 'shape' ? shape : image;
      const x = Number(bounds.x), w = Number(bounds.w);
      if(Number.isFinite(x) && Number.isFinite(w) && w > 0 && x < left + pageWidth && x + w > left)return page;
    }
  }
  return 0;
}
