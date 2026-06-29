export function splitFromPointer(clientX: number, rect: DOMRect): number {
  const pct = ((clientX - rect.left) / rect.width) * 100;
  if (!isFinite(pct)) return 50;
  return Math.max(20, Math.min(80, pct));
}
