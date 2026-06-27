import { useEffect, useRef } from "react";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView, lineNumbers, gutter, GutterMarker, Decoration } from "@codemirror/view";
import { cpp } from "@codemirror/lang-cpp";

interface ExecState { currentLine: number; prevLine: number | null; nextLine: number | null }
interface PanelState { exec: ExecState | null; breakpoints: Set<number> }

const setPanel = StateEffect.define<PanelState>();

const panelField = StateField.define<PanelState>({
  create: () => ({ exec: null, breakpoints: new Set() }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPanel)) return e.value;
    return value;
  },
});

class ArrowMarker extends GutterMarker {
  constructor(private glyph: string, private cls: string) { super(); }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.glyph;
    span.className = this.cls;
    return span;
  }
}
const prevMarker = new ArrowMarker("▸", "exec-arrow prev");
const currMarker = new ArrowMarker("▶", "exec-arrow current");
const nextMarker = new ArrowMarker("▷", "exec-arrow next");

function execGutter(onToggle: (line: number) => void) {
  return gutter({
    class: "cm-exec-gutter",
    lineMarker(view, line) {
      const { exec } = view.state.field(panelField);
      if (!exec) return null;
      const ln = view.state.doc.lineAt(line.from).number;
      if (ln === exec.currentLine) return currMarker;
      if (ln === exec.prevLine) return prevMarker;
      if (ln === exec.nextLine) return nextMarker;
      return null;
    },
    domEventHandlers: {
      mousedown(view, line) {
        const ln = view.state.doc.lineAt(line.from).number;
        onToggle(ln);
        return true;
      },
    },
  });
}

export function CodePanel({
  value, onChange, exec, breakpoints, onToggleBreakpoint,
}: {
  value: string;
  onChange: (v: string) => void;
  exec: ExecState | null;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onToggleRef = useRef(onToggleBreakpoint);
  onChangeRef.current = onChange;
  onToggleRef.current = onToggleBreakpoint;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        panelField,
        lineNumbers(),
        execGutter((ln) => onToggleRef.current(ln)),
        cpp(),
        EditorView.decorations.compute([panelField, "doc"], (st) => {
          const { exec: ex, breakpoints: bps } = st.field(panelField);
          const doc = st.doc;
          const list: { from: number; deco: Decoration }[] = [];
          const add = (line: number, cls: string) => {
            if (line < 1 || line > doc.lines) return;
            list.push({ from: doc.line(line).from, deco: Decoration.line({ class: cls }) });
          };
          for (const bp of bps) add(bp, "cm-bp");
          if (ex) add(ex.currentLine, "cm-current");
          list.sort((a, b) => a.from - b.from);
          return Decoration.set(list.map((r) => r.deco.range(r.from)));
        }),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChangeRef.current(u.state.doc.toString()); }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // push exec/breakpoints into the editor on change
  useEffect(() => {
    view.current?.dispatch({ effects: setPanel.of({ exec, breakpoints }) });
  }, [exec, breakpoints]);

  return <div className="editor codepanel" ref={host} />;
}
