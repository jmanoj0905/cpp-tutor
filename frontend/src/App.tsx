import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShortcuts, type ShortcutHandlers } from "./shortcuts/useShortcuts";
import { HelpOverlay } from "./shortcuts/HelpOverlay";
import { CodePanel } from "./CodePanel";
import { Divider } from "./Divider.tsx";
import { MemoryView } from "./viz/MemoryView";
import { buildCallTree } from "./viz/callTree";
import { CallTreePanel } from "./viz/CallTreePanel";
import { Vcr } from "./controls/Vcr";
import { usePlayer } from "./player/usePlayer";
import { useElapsed } from "./player/useElapsed";
import { toggleBreakpoint as toggleInSet, deadBreakpointLines } from "./player/breakpoints";
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
  trace, code, breakpoints, onToggleBreakpoint, onClearBreakpoints, onResize,
  registerStepHandlers,
}: {
  trace: Trace;
  code: string;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  onClearBreakpoints: () => void;
  onResize: (pct: number) => void;
  registerStepHandlers: (h: ShortcutHandlers | null) => void;
}) {
  const player = usePlayer(trace);
  const callTree = useMemo(() => buildCallTree(trace.trace), [trace]);
  const [tab, setTab] = useState<"memory" | "tree">("memory");
  const [treeSeen, setTreeSeen] = useState(false);
  const openTab = (t: "memory" | "tree") => {
    setTab(t);
    if (t === "tree") setTreeSeen(true);
  };
  // null = auto: the stdout pane grows with its content (CSS min/max-height
  // defaults); a number pins it to that exact percentage after a drag.
  const [stdoutSplit, setStdoutSplit] = useState<number | null>(null);
  // OPT C trace: point.line is the line about to execute (next); the previously
  // displayed line is the one that just executed.
  const exec = { justExecuted: player.prevLine, next: player.point.line };
  const deadLines = useMemo(() => deadBreakpointLines(breakpoints, trace), [breakpoints, trace]);
  const deadLineSet = useMemo(() => new Set(deadLines), [deadLines]);

  // No dependency array: handlers close over the current player/breakpoints,
  // so re-register every render; cleanup deregisters on unmount.
  useEffect(() => {
    registerStepHandlers({
      prev: player.prev,
      // same breakpoint-aware behavior as the Vcr Next button
      next: () => (breakpoints.size ? player.nextHit(breakpoints) : player.next()),
      first: player.first,
      last: player.last,
      toggleTree: () => openTab(tab === "memory" ? "tree" : "memory"),
    });
    return () => registerStepHandlers(null);
  });

  return (
    <>
      <section className="left-col">
        <CodePanel value={code} onChange={() => {}} exec={exec} readOnly
          breakpoints={breakpoints} onToggleBreakpoint={onToggleBreakpoint}
          deadLines={deadLineSet} />
        <Vcr player={player} breakpoints={breakpoints} deadLines={deadLines}
          onClearBreakpoints={onClearBreakpoints} />
      </section>
      <Divider onResize={onResize} />
      <section
        className="right-col"
        style={
          stdoutSplit === null
            ? undefined
            : ({ "--stdout-min": `${stdoutSplit}%`, "--stdout-max": `${stdoutSplit}%` } as CSSProperties)
        }
      >
        <div className="stdout-region">
          <h3 className="stdout-title">Stdout</h3>
          <pre className="stdout-bar">{player.point.stdout}</pre>
        </div>
        <Divider
          container=".right-col"
          orientation="horizontal"
          min={8}
          max={60}
          onResize={setStdoutSplit}
          onReset={() => setStdoutSplit(null)}
        />
        {player.point.exception_msg && (
          <div className="limit-notice">{player.point.exception_msg}</div>
        )}
        <div className="mem-region">
          <div className="panel-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "memory"}
              onClick={() => openTab("memory")}
            >
              Memory
            </button>
            <button
              role="tab"
              aria-selected={tab === "tree"}
              onClick={() => openTab("tree")}
            >
              Call Tree
              {callTree.hasRecursion && !treeSeen && (
                <span className="tab-dot" data-testid="tree-dot" />
              )}
            </button>
          </div>
          {tab === "memory" ? (
            <MemoryView point={player.point} prevPoint={player.prevPoint} />
          ) : (
            <CallTreePanel tree={callTree} step={player.index} />
          )}
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [code, setCode] = useState(SAMPLE);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errLine, setErrLine] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [split, setSplit] = useState(50);
  const elapsed = useElapsed(loading);

  const [helpOpen, setHelpOpen] = useState(false);
  const stepHandlers = useRef<ShortcutHandlers | null>(null);
  const registerStepHandlers = useCallback((h: ShortcutHandlers | null) => {
    stepHandlers.current = h;
  }, []);

  function toggleBreakpoint(line: number) {
    setBreakpoints((prev) => toggleInSet(prev, line));
  }

  async function visualize() {
    setErr(null);
    setErrLine(null);
    setLoading(true);
    try {
      const res = await fetchTrace(code, "cpp");
      if (isCompileError(res)) { setErr(res.message); setErrLine(res.line); setTrace(null); return; }
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
    setErrLine(null);
  }

  const viewing = trace !== null;

  useShortcuts(
    { mode: viewing ? "trace" : "edit", helpOpen, loading },
    {
      prev: () => stepHandlers.current?.prev?.(),
      next: () => stepHandlers.current?.next?.(),
      first: () => stepHandlers.current?.first?.(),
      last: () => stepHandlers.current?.last?.(),
      toggleTree: () => stepHandlers.current?.toggleTree?.(),
      visualize,
      stop,
      toggleHelp: () => setHelpOpen((v) => !v),
      closeHelp: () => setHelpOpen(false),
    },
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>cpp-tutor</h1>
        <div className="topbar-actions">
          {loading && (
            <span className="trace-hint">Tracing can take up to ~45s for heavy or looping code.</span>
          )}
          {viewing
            ? <button className="run stop" onClick={stop}>Stop</button>
            : <button className="run" onClick={visualize} disabled={loading}>
                {loading ? `Visualizing… ${elapsed}s` : "Visualize Execution"}
              </button>}
        </div>
      </header>
      {err && <pre className="error">{err}</pre>}
      <main className="workspace" style={{ "--split": `${split}%` } as CSSProperties}>
        {viewing
          ? <Workspace
              key={trace.code}
              trace={trace}
              code={code}
              breakpoints={breakpoints}
              onToggleBreakpoint={toggleBreakpoint}
              onClearBreakpoints={() => setBreakpoints(new Set())}
              onResize={setSplit}
              registerStepHandlers={registerStepHandlers}
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
                  errorLine={errLine}
                />
              </section>
              <Divider onResize={setSplit} />
              <section className="right-col empty-hint">
                <p>Click Visualize Execution to trace your code.</p>
              </section>
            </>)}
      </main>
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
