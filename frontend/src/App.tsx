import { useState } from "react";
import { Editor } from "./Editor";
import { CodeView } from "./viz/CodeView";
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

function Visualized({ trace }: { trace: Trace }) {
  const player = usePlayer(trace);
  return (
    <div className="viz">
      <div className="left">
        <CodeView code={trace.code} activeLine={player.point.line} />
        <Vcr player={player} />
      </div>
      <div className="right">
        <pre className="stdout">{player.point.stdout}</pre>
        <MemoryView point={player.point} />
      </div>
    </div>
  );
}

export default function App() {
  const [code, setCode] = useState(SAMPLE);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function visualize() {
    setErr(null); setTrace(null);
    try {
      const res = await fetchTrace(code, "cpp");
      if (isCompileError(res)) { setErr(res.message); return; }
      setTrace(res);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="app">
      <h1>cpp-tutor</h1>
      <Editor value={code} onChange={setCode} />
      <button className="run" onClick={visualize}>Visualize Execution</button>
      {err && <pre className="error">{err}</pre>}
      {trace && <Visualized key={trace.code} trace={trace} />}
    </div>
  );
}
