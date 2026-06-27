import { useState } from "react";
import { CodePanel } from "./CodePanel";
import { MemoryView } from "./viz/MemoryView";
import { Vcr } from "./controls/Vcr";
import { usePlayer } from "./player/usePlayer";
import { fetchTrace } from "./api/client";
import { isCompileError, type Trace } from "./types/trace";

const SAMPLE = `#include <iostream>
using namespace std;
int main() {
  int x = 41;
  int y = x + 1;
  cout << y << endl;
  return 0;
}`;

function Workspace({
  trace, code, onChange, breakpoints, onToggleBreakpoint, stale,
}: {
  trace: Trace;
  code: string;
  onChange: (v: string) => void;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  stale: boolean;
}) {
  const player = usePlayer(trace);
  const exec = stale
    ? null
    : { currentLine: player.point.line, prevLine: player.prevLine, nextLine: player.nextLine };

  return (
    <>
      <main className="workspace">
        <section className="code-col">
          <CodePanel
            value={code}
            onChange={onChange}
            exec={exec}
            breakpoints={breakpoints}
            onToggleBreakpoint={onToggleBreakpoint}
          />
        </section>
        <section className="memory-col">
          <MemoryView point={player.point} />
          <pre className="stdout">{player.point.stdout}</pre>
        </section>
      </main>
      <footer className="controls">
        {stale
          ? <span className="stale-note">Code edited — re-run Visualize to step.</span>
          : <Vcr player={player} breakpoints={breakpoints} />}
      </footer>
    </>
  );
}

export default function App() {
  const [code, setCode] = useState(SAMPLE);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [stale, setStale] = useState(false);

  function toggleBreakpoint(line: number) {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line); else next.add(line);
      return next;
    });
  }

  function onChange(v: string) {
    setCode(v);
    if (trace) setStale(true);
  }

  async function visualize() {
    setErr(null);
    try {
      const res = await fetchTrace(code, "cpp");
      if (isCompileError(res)) { setErr(res.message); setTrace(null); return; }
      setTrace(res);
      setStale(false);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>cpp-tutor</h1>
        <button className="run" onClick={visualize}>Visualize Execution</button>
      </header>
      {err && <pre className="error">{err}</pre>}
      {trace
        ? <Workspace
            key={trace.code}
            trace={trace}
            code={code}
            onChange={onChange}
            breakpoints={breakpoints}
            onToggleBreakpoint={toggleBreakpoint}
            stale={stale}
          />
        : (
          <main className="workspace">
            <section className="code-col">
              <CodePanel value={code} onChange={onChange} exec={null} breakpoints={breakpoints} onToggleBreakpoint={toggleBreakpoint} />
            </section>
            <section className="memory-col empty-hint"><p>Click Visualize Execution to trace your code.</p></section>
          </main>
        )}
    </div>
  );
}
