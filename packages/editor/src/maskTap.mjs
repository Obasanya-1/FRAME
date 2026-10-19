// Mobile-only gesture decision helpers. Keep masked-image selection geometry
// independent from React state, so taps never turn into accidental drag/crop.
export function resolveMaskedImageId(layers, layer) {
  if (!Array.isArray(layers) || !layer) return null;
  if (layer.type === 'image' && layer.maskShapeId) {
    return layers.some(item => item.type === 'shape' && item.id === layer.maskShapeId)
      ? layer.id : null;
  }
  if (layer.type === 'shape') {
    return layers.find(item => item.type === 'image' && item.maskShapeId === layer.id)?.id || null;
  }
  return null;
}

export function isMaskedImageTap({distance, moved, holdTriggered, gestureBlocked} = {}) {
  // A tap selects only; movement, long-press and pinch remain separate gestures.
  return Number.isFinite(distance) && distance < 8 && !moved && !holdTriggered && !gestureBlocked;
}
