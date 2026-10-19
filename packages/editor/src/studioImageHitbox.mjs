// Desktop-only pointer geometry. Fill Page crops the display to a slide,
// but its off-image region must never become an invisible clickable layer.
export function studioFillVisibleBounds(image, frame) {
  if (!image || !frame || !(image.w > 0) || !(image.h > 0) || !(frame.w > 0) || !(frame.h > 0)) return null;
  const left = Math.max(image.x, frame.x);
  const top = Math.max(image.y, frame.y);
  const right = Math.min(image.x + image.w, frame.x + frame.w);
  const bottom = Math.min(image.y + image.h, frame.y + frame.h);
  if (right <= left || bottom <= top) return null;
  return {x:left,y:top,w:right-left,h:bottom-top};
}
