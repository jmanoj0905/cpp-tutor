import type { TraceResult } from "../types/trace";

const BASE = import.meta.env.VITE_API ?? "http://localhost:8000";

export async function fetchTrace(code: string, lang: "c" | "cpp"): Promise<TraceResult> {
  const r = await fetch(`${BASE}/api/trace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, lang }),
  });
  if (r.status === 503) throw new Error("Program ran too long — try a smaller example.");
  if (!r.ok) throw new Error(`trace failed: ${r.status}`);
  return (await r.json()) as TraceResult;
}
