import type { TraceResult } from "../types/trace";

const BASE = import.meta.env.VITE_API ?? "http://localhost:8000";

// Matches JSON string literals (left untouched, so digits inside program
// stdout are never rewritten) OR bare integer tokens of 16+ digits.
const STRING_OR_BIG_INT = /("(?:[^"\\]|\\.)*")|(-?\d{16,})(?=\s*[,\]}])/g;

/**
 * JSON.parse coerces every number to a double, silently corrupting integers
 * beyond 2^53 — e.g. the 64-bit _Bit_type words backing vector<bool> and
 * unsigned long long values. Quote unsafe integers in the raw text first so
 * they survive as exact digit strings.
 */
export function parseTraceJson(text: string): unknown {
  const quoted = text.replace(STRING_OR_BIG_INT, (_m, str: string, int: string) => {
    if (str) return str;
    return Number.isSafeInteger(Number(int)) ? int : `"${int}"`;
  });
  return JSON.parse(quoted);
}

export async function fetchTrace(code: string, lang: "c" | "cpp"): Promise<TraceResult> {
  const r = await fetch(`${BASE}/api/trace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, lang }),
  });
  if (r.status === 503) throw new Error("Program ran too long — try a smaller example.");
  if (!r.ok) throw new Error(`trace failed: ${r.status}`);
  return parseTraceJson(await r.text()) as TraceResult;
}
