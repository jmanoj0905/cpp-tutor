import { useState } from "react";
import { CodePanel } from "./CodePanel";
import { MemoryView } from "./viz/MemoryView";
import { Vcr } from "./controls/Vcr";
import { usePlayer } from "./player/usePlayer";
import { toggleBreakpoint as toggleInSet } from "./player/breakpoints";
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
  trace, code, breakpoints, onToggleBreakpoint,
}: {
  trace: Trace;
  code: string;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
}) {
  const player = usePlayer(trace);
  const exec = {
    currentLine: player.point.line,
    prevLine: player.prevLine,
    nextLine: player.nextLine,
  };

  return (
    <main className="workspace">
      <section className="code-col">
        <CodePanel
          value={code}
          onChange={() => {}}
          exec={exec}
          readOnly
          breakpoints={breakpoints}
          onToggleBreakpoint={onToggleBreakpoint}
        />
        <pre className="stdout">{player.point.stdout}</pre>
        <footer className="controls">
          <Vcr player={player} breakpoints={breakpoints} />
        </footer>
      </section>
      <section className="memory-col">
        <MemoryView point={player.point} />
      </section>
    </main>
  );
}

export default function App() {
  const [code, setCode] = useState(SAMPLE);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());

  function toggleBreakpoint(line: number) {
    setBreakpoints((prev) => toggleInSet(prev, line));
  }

  async function visualize() {
    setErr(null);
    try {
      const res = await fetchTrace(code, "cpp");
      if (isCompileError(res)) { setErr(res.message); setTrace(null); return; }
      setTrace(res);
    } catch (e) {
      setErr((e as Error).message);
      setTrace(null);
    }
  }

  function editCode() {
    setTrace(null);
    setErr(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>cpp-tutor</h1>
        <button className="run" onClick={trace ? editCode : visualize}>
          {trace ? "Edit Code" : "Visualize Execution"}
        </button>
      </header>
      {err && <pre className="error">{err}</pre>}
      {trace
        ? <Workspace
            key={trace.code}
            trace={trace}
            code={code}
            breakpoints={breakpoints}
            onToggleBreakpoint={toggleBreakpoint}
          />
        : (
          <main className="workspace">
            <section className="code-col">
              <CodePanel
                value={code}
                onChange={setCode}
                exec={null}
                readOnly={false}
                breakpoints={breakpoints}
                onToggleBreakpoint={toggleBreakpoint}
              />
            </section>
            <section className="memory-col empty-hint">
              <p>Click Visualize Execution to trace your code.</p>
            </section>
          </main>
        )}
    </div>
  );
}
