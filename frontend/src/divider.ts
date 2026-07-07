export function splitFromPointer(
  client: number,
  rect: DOMRect,
  axis: "x" | "y" = "x",
  min = 20,
  max = 80,
): number {
  const start = axis === "x" ? rect.left : rect.top;
  const size = axis === "x" ? rect.width : rect.height;
  const pct = ((client - start) / size) * 100;
  if (!isFinite(pct)) return 50;
  return Math.max(min, Math.min(max, pct));
}
