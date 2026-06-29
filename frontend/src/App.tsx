import { useState } from "react";
import { CodePanel } from "./CodePanel";
import { MemoryView } from "./viz/MemoryView";
import { Vcr } from "./controls/Vcr";
import { usePlayer } from "./player/usePlayer";
import { toggleBreakpoint as toggleInSet } from "./player/breakpoints";
import { fetchTrace } from "./api/client";
import { isCompileError, type Trace } from "./types/trace";

const SAMPLE = `#include <iostream>
#include <vector>
#include <string>
#include <array>
#include <utility>
using namespace std;
int main() {
  vector<int> v = {10, 20, 30};
  string s = "hello";
  array<int, 3> a = {1, 2, 3};
  pair<int, int> pr = {7, 8};
  int x = 42;
  int* p = &x;
  cout << "x=" << x << " *p=" << *p << endl;
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
  // OPT C trace: point.line is the line about to execute (next); the previously
  // displayed line is the one that just executed. Verified manually in Task 3.
  const exec = { justExecuted: player.prevLine, next: player.point.line };

  return (
    <>
      <section className="left-col">
        <CodePanel value={code} onChange={() => {}} exec={exec} readOnly
          breakpoints={breakpoints} onToggleBreakpoint={onToggleBreakpoint} />
        <Vcr player={player} breakpoints={breakpoints} />
      </section>
      <section className="right-col">
        <pre className="stdout-bar">{player.point.stdout}</pre>
        <div className="mem-region">
          <MemoryView point={player.point} />
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [code, setCode] = useState(SAMPLE);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());

  function toggleBreakpoint(line: number) {
    setBreakpoints((prev) => toggleInSet(prev, line));
  }

  async function visualize() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetchTrace(code, "cpp");
      if (isCompileError(res)) { setErr(res.message); setTrace(null); return; }
      setTrace(res);
    } catch (e) {
      setErr((e as Error).message);
      setTrace(null);
    } finally {
      setLoading(false);
    }
  }

  function stop() {
    setTrace(null);
    setErr(null);
  }

  const viewing = trace !== null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>cpp-tutor</h1>
        {viewing
          ? <button className="run stop" onClick={stop}>Stop</button>
          : <button className="run" onClick={visualize} disabled={loading}>
              {loading ? "Visualizing…" : "Visualize Execution"}
            </button>}
      </header>
      {err && <pre className="error">{err}</pre>}
      <main className="workspace">
        {viewing
          ? <Workspace
              key={trace.code}
              trace={trace}
              code={code}
              breakpoints={breakpoints}
              onToggleBreakpoint={toggleBreakpoint}
            />
          : (<>
              <section className="left-col">
                <CodePanel
                  value={code}
                  onChange={setCode}
                  exec={null}
                  readOnly={false}
                  breakpoints={breakpoints}
                  onToggleBreakpoint={toggleBreakpoint}
                />
              </section>
              <section className="right-col empty-hint">
                <p>Click Visualize Execution to trace your code.</p>
              </section>
            </>)}
      </main>
    </div>
  );
}
