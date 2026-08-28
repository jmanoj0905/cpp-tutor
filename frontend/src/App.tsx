import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShortcuts, type ShortcutHandlers } from "./shortcuts/useShortcuts";
import { HelpOverlay } from "./shortcuts/HelpOverlay";
import { CodePanel } from "./CodePanel";
import { Divider } from "./Divider.tsx";
import { MemoryView } from "./viz/MemoryView";
import { buildCallTree } from "./viz/callTree";
import { CallTreePanel } from "./viz/CallTreePanel";
import { CallLogPanel } from "./viz/CallLogPanel";
import { GraphPanel } from "./viz/graph/GraphPanel";
import { memoryAt } from "./viz/memoryModel";
import { hasGraphContent } from "./viz/graph/graphModel";
import { hasGraphCode } from "./viz/graph/detect";
import { diagnose } from "./viz/ub/diagnose";
import { UbPanel } from "./viz/ub/UbPanel";
import { shapeInfoFor } from "./viz/shapes";
import { Vcr } from "./controls/Vcr";
import { usePlayer } from "./player/usePlayer";
import { useElapsed } from "./player/useElapsed";
import { deadBreakpointLines } from "./player/breakpoints";
import { toggleInSet } from "./util";
import { fetchTrace } from "./api/client";
import { readHandoff } from "./handoff";
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
  registerStepHandlers, activeHeapCell, onHeapOpen, onHeapClose,
}: {
  trace: Trace;
  code: string;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  onClearBreakpoints: () => void;
  onResize: (pct: number) => void;
  registerStepHandlers: (h: ShortcutHandlers | null) => void;
  activeHeapCell: string | null;
  onHeapOpen: (id: string) => void;
  onHeapClose: () => void;
}) {
  const player = usePlayer(trace);
  const callTree = useMemo(() => buildCallTree(trace.trace), [trace]);
  const [tab, setTab] = useState<"memory" | "tree" | "graph">("memory");
  const [treeSeen, setTreeSeen] = useState(false);
  const [treeMode, setTreeMode] = useState<"tree" | "log">("tree");
  const openTab = (t: "memory" | "tree" | "graph") => {
    setTab(t);
    if (t === "tree") setTreeSeen(true);
  };
  // Show the Graph tab only for graph/grid-shaped programs. Scan once per
  // trace with the cheap structural detector (not buildGraphScene, which is
  // O(prefix) per call → O(n^2) over a trace); break on the first hit.
  // A pointer program (tree/list/trie) has no such container — its Graph
  // content comes from a confirmed shape, which is already a cached whole-trace
  // pass. Those stay outside the `hasGraphCode` vocabulary gate: a confirmed
  // self-referential struct — a chain, a pair of children, or an array of
  // pointers to its own type — is unambiguous in a way an int matrix is not.
  // Matrix/edge-list shapes ARE ambiguous (a 2-D DP table is an int matrix), so
  // they additionally need the source to read like a graph problem.
  const graphAvailable = useMemo(() => {
    for (const kind of shapeInfoFor(trace.trace).confirmed.values()) {
      if (kind === "tree" || kind === "list" || kind === "trie") return true;
    }
    const matrices = hasGraphCode(trace.code);
    for (let s = 0; s < trace.trace.length; s++) {
      if (hasGraphContent(memoryAt(trace.trace[s]), matrices)) return true;
    }
    return false;
  }, [trace]);
  // null = auto: the stdout pane grows with its content (CSS min/max-height
  // defaults); a number pins it to that exact percentage after a drag.
  const [stdoutSplit, setStdoutSplit] = useState<number | null>(null);
  // OPT C trace: point.line is the line about to execute (next); the previously
  // displayed line is the one that just executed.
  const exec = { justExecuted: player.prevLine, next: player.point.line };
  // Valgrind's memcheck verdict for the step being shown, if this is the step
  // that broke. Classified rather than dumped — see viz/ub/diagnose.ts.
  const ubDiagnosis = useMemo(
    () => diagnose(player.point.exception_msg),
    [player.point.exception_msg],
  );
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
        {/* A UB fault marks its own line red rather than the usual yellow
            "current" tint: that line did not merely execute, it broke. */}
        <CodePanel value={code} onChange={() => {}} exec={exec} readOnly
          breakpoints={breakpoints} onToggleBreakpoint={onToggleBreakpoint}
          deadLines={deadLineSet}
          errorLine={ubDiagnosis ? player.point.line : null} />
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
        {ubDiagnosis && <UbPanel diagnosis={ubDiagnosis} step={player.index} />}
        <div className="mem-region">
          <div className="tabs panel-tabs" role="tablist">
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
            {graphAvailable && (
              <button
                role="tab"
                aria-selected={tab === "graph"}
                onClick={() => openTab("graph")}
              >
                Graph
              </button>
            )}
          </div>
          {tab === "graph" ? (
            <div className="graph-region">
              <GraphPanel point={player.point} prevPoint={player.prevPoint}
                trace={trace.trace} step={player.index} />
            </div>
          ) : tab === "memory" ? (
            <MemoryView point={player.point} prevPoint={player.prevPoint} trace={trace.trace} code={trace.code} activeHeapCell={activeHeapCell} onHeapOpen={onHeapOpen} onHeapClose={onHeapClose} />
          ) : (
            <div className="calltree-region">
              <div className="tabs calltree-mode" role="tablist">
                <button role="tab" aria-selected={treeMode === "tree"} onClick={() => setTreeMode("tree")}>tree</button>
                <button role="tab" aria-selected={treeMode === "log"} onClick={() => setTreeMode("log")}>log</button>
              </div>
              {treeMode === "tree"
                ? <CallTreePanel tree={callTree} step={player.index} trace={trace.trace} />
                : <CallLogPanel tree={callTree} step={player.index} trace={trace.trace} />}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export default function App() {
  // The VSCode extension opens this app with the active editor's source in the
  // URL hash; a plain web visit has no hash and starts from the sample.
  const handoff = useMemo(() => readHandoff(window.location.hash), []);
  const [code, setCode] = useState(handoff?.code ?? SAMPLE);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [errLine, setErrLine] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [split, setSplit] = useState(50);
  const elapsed = useElapsed(loading);

  const [helpOpen, setHelpOpen] = useState(false);
  const [activeHeapCell, setActiveHeapCell] = useState<string | null>(null);
  const stepHandlers = useRef<ShortcutHandlers | null>(null);
  const registerStepHandlers = useCallback((h: ShortcutHandlers | null) => {
    stepHandlers.current = h;
  }, []);
  const closeHeap = useCallback(() => setActiveHeapCell(null), []);

  function toggleBreakpoint(line: number) {
    setBreakpoints((prev) => toggleInSet(prev, line));
  }

  // Takes the source explicitly so a hand-off arriving in the same page load
  // (see the hashchange effect) traces the code it just delivered rather than
  // whatever `code` held when this closure was created.
  async function visualize(src: string = code) {
    setErr(null);
    setErrLine(null);
    setActiveHeapCell(null);
    setLoading(true);
    try {
      const res = await fetchTrace(src, "cpp");
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
    setActiveHeapCell(null);
  }

  const viewing = trace !== null;

  // `#...&run=1` means the extension's "Visualize current file" button, not a
  // plain open: trace without waiting for a click. Runs once per hand-off.
  const pendingRun = useRef(handoff?.run ?? false);
  useEffect(() => {
    if (!pendingRun.current) return;
    pendingRun.current = false;
    void visualize(handoff?.code ?? code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-opening the visualizer for a different file only changes the hash, so
  // an already-loaded page gets a hashchange rather than a reload.
  useEffect(() => {
    function onHash() {
      const next = readHandoff(window.location.hash);
      if (!next) return;
      setCode(next.code);
      stop();
      if (next.run) void visualize(next.code);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useShortcuts(
    { mode: viewing ? "trace" : "edit", helpOpen, heapOpen: activeHeapCell !== null, paletteOpen: false, loading },
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
      closeHeap,
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
            : <button className="run" onClick={() => visualize()} disabled={loading}>
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
              activeHeapCell={activeHeapCell}
              onHeapOpen={setActiveHeapCell}
              onHeapClose={closeHeap}
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
              <section className="right-col empty-state">
                <p>Click Visualize Execution to trace your code.</p>
              </section>
            </>)}
      </main>
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
