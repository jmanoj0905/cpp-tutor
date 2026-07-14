// Pure camera math for the call-tree canvas — no React, no DOM.
// world→screen: sx = (wx - cam.x) * cam.scale.

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 3;

export function pan(c: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...c, x: c.x - dxScreen / c.scale, y: c.y - dyScreen / c.scale };
}

export function zoomAt(c: Camera, factor: number, sx: number, sy: number): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, c.scale * factor));
  if (scale === c.scale) return c;
  // keep the world point currently under (sx, sy) fixed on screen
  const wx = c.x + sx / c.scale;
  const wy = c.y + sy / c.scale;
  return { x: wx - sx / scale, y: wy - sy / scale, scale };
}

export function followIfOffscreen(
  c: Camera,
  rect: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
  margin = 24,
): Camera {
  const left = (rect.x - c.x) * c.scale;
  const top = (rect.y - c.y) * c.scale;
  const right = left + rect.w * c.scale;
  const bottom = top + rect.h * c.scale;

  let dx = 0;
  let dy = 0;
  if (left < margin) dx = left - margin;
  else if (right > viewport.w - margin) dx = right - (viewport.w - margin);
  if (top < margin) dy = top - margin;
  else if (bottom > viewport.h - margin) dy = bottom - (viewport.h - margin);

  if (dx === 0 && dy === 0) return c;
  return { ...c, x: c.x + dx / c.scale, y: c.y + dy / c.scale };
}
