export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Point { x: number; y: number }

export function sourcePoint(r: Rect): Point {
  return { x: r.right, y: (r.top + r.bottom) / 2 };
}

export function targetPoint(r: Rect): Point {
  return { x: r.left, y: (r.top + r.bottom) / 2 };
}

export function bezierPath(from: Point, to: Point): string {
  const dx = Math.max(40, Math.abs(to.x - from.x) / 2);
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}
