// Subsequence fuzzy match. Returns null when `query` chars do not all appear
// in order within `text`; otherwise a score where higher is better: longest
// contiguous run dominates, then an earlier first-match, then shorter text.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return 0;

  let ti = 0;
  let firstIndex = -1;
  let contiguous = 0;
  let bestContiguous = 0;
  let prev = -2;

  for (const c of q) {
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === c) { found = j; break; }
    }
    if (found === -1) return null;
    if (firstIndex === -1) firstIndex = found;
    contiguous = found === prev + 1 ? contiguous + 1 : 1;
    if (contiguous > bestContiguous) bestContiguous = contiguous;
    prev = found;
    ti = found + 1;
  }

  return bestContiguous * 1000 - firstIndex * 10 - t.length;
}
