import { useEffect, useRef } from "react";
import { EditorState, StateEffect, StateField, Compartment } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, gutter, GutterMarker, Decoration,
  highlightActiveLine, highlightActiveLineGutter,
} from "@codemirror/view";
import { cpp, cppLanguage } from "@codemirror/lang-cpp";
import {
  syntaxHighlighting, HighlightStyle, foldGutter, foldKeymap,
  bracketMatching, indentOnInput, indentUnit,
} from "@codemirror/language";
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
  completeFromList, completeAnyWord, type CompletionSource,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { tags as t } from "@lezer/highlight";

const cppHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.moduleKeyword], color: "#8250df", fontWeight: "bold" },
  { tag: [t.typeName, t.className, t.namespace], color: "#0e7490" },
  { tag: [t.number, t.bool, t.null], color: "#b35900" },
  { tag: [t.string, t.special(t.string), t.character], color: "#0a7d3c" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--ink-soft)", fontStyle: "italic" },
  { tag: t.meta, color: "var(--ink-soft)" },
]);

// lang-cpp ships no completions of its own: offer keywords/common std names
// alongside identifiers already present in the document.
const CPP_WORDS =
  ("alignas alignof auto bool break case catch char class const constexpr continue default delete " +
   "do double else enum explicit extern false float for friend goto if inline int long mutable " +
   "namespace new noexcept nullptr operator private protected public return short signed sizeof " +
   "static struct switch template this throw true try typedef typename union unsigned using " +
   "virtual void volatile while " +
   "std size_t int64_t uint64_t int32_t uint32_t " +
   "cout cin cerr endl printf scanf " +
   "vector string array pair map set unordered_map unordered_set deque queue stack tuple " +
   "push_back emplace_back pop_back begin end size empty front back insert erase find count " +
   "make_pair sort reverse swap min max abs").split(" ");

const cppCompletions: CompletionSource = completeFromList(
  CPP_WORDS.map((label) => ({ label, type: "keyword" })),
);

const CPP_WORD_SET = new Set(CPP_WORDS);
// completeAnyWord would re-offer words the keyword list already has
const docWordCompletions: CompletionSource = (ctx) => {
  const result = completeAnyWord(ctx);
  if (!result || result instanceof Promise) return result;
  return { ...result, options: result.options.filter((o) => !CPP_WORD_SET.has(o.label)) };
};

interface ExecState { justExecuted: number | null; next: number | null }
interface PanelState {
  exec: ExecState | null;
  breakpoints: Set<number>;
  deadLines: Set<number>; // breakpoint lines the trace never reaches
  errorLine: number | null;
}

const setPanel = StateEffect.define<PanelState>();

const panelField = StateField.define<PanelState>({
  create: () => ({ exec: null, breakpoints: new Set(), deadLines: new Set(), errorLine: null }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPanel)) return e.value;
    return value;
  },
});

class ArrowMarker extends GutterMarker {
  glyph: string;
  cls: string;
  constructor(glyph: string, cls: string) {
    super();
    this.glyph = glyph;
    this.cls = cls;
  }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.glyph;
    span.className = this.cls;
    return span;
  }
}
const greenMarker = new ArrowMarker("▶", "exec-arrow green");  // just executed
const redMarker = new ArrowMarker("▶", "exec-arrow red");      // next to execute
const errorMarker = new ArrowMarker("✖", "error-marker");      // compile error line

function execGutter(onToggle: (line: number) => boolean) {
  return gutter({
    class: "cm-exec-gutter",
    lineMarker(view, line) {
      const { exec, errorLine } = view.state.field(panelField);
      const ln = view.state.doc.lineAt(line.from).number;
      if (ln === errorLine) return errorMarker;
      if (!exec) return null;
      if (ln === exec.next) return redMarker;
      if (ln === exec.justExecuted) return greenMarker;
      return null;
    },
    lineMarkerChange: (u) => u.startState.field(panelField) !== u.state.field(panelField),
    domEventHandlers: {
      mousedown(view, line) {
        const ln = view.state.doc.lineAt(line.from).number;
        return onToggle(ln);
      },
    },
  });
}

const NO_DEAD_LINES = new Set<number>();

export function CodePanel({
  value, onChange, exec, breakpoints, onToggleBreakpoint, readOnly,
  deadLines = NO_DEAD_LINES, errorLine = null,
}: {
  value: string;
  onChange: (v: string) => void;
  exec: ExecState | null;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  readOnly: boolean;
  deadLines?: Set<number>;
  errorLine?: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onToggleRef = useRef(onToggleBreakpoint);
  const readOnlyComp = useRef(new Compartment());
  const readOnlyRef = useRef(readOnly);
  onChangeRef.current = onChange;
  onToggleRef.current = onToggleBreakpoint;
  readOnlyRef.current = readOnly;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        panelField,
        readOnlyComp.current.of([
          EditorView.editable.of(!readOnly),
          EditorState.readOnly.of(readOnly),
        ]),
        // breakpoints only exist in trace mode; edit-mode gutter clicks fall through
        execGutter((ln) => {
          if (!readOnlyRef.current) return false;
          onToggleRef.current(ln);
          return true;
        }),
        EditorView.domEventHandlers({
          mousedown(event, view) {
            if (!readOnlyRef.current) return false; // edit mode: normal cursor
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            onToggleRef.current(view.state.doc.lineAt(pos).number);
            return true; // swallow cursor placement in trace mode
          },
        }),
        lineNumbers(),
        foldGutter(),
        cpp(),
        cppLanguage.data.of({ autocomplete: cppCompletions }),
        cppLanguage.data.of({ autocomplete: docWordCompletions }),
        syntaxHighlighting(cppHighlight),
        history(),
        autocompletion(),
        closeBrackets(),
        bracketMatching(),
        indentOnInput(),
        indentUnit.of("  "),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        keymap.of([
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...foldKeymap,
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
        EditorView.decorations.compute([panelField, "doc"], (st) => {
          const { exec: ex, breakpoints: bps, deadLines: dead, errorLine: errLn } = st.field(panelField);
          const doc = st.doc;
          const list: { from: number; deco: Decoration }[] = [];
          const add = (line: number, cls: string) => {
            if (line < 1 || line > doc.lines) return;
            list.push({ from: doc.line(line).from, deco: Decoration.line({ class: cls }) });
          };
          for (const bp of bps) add(bp, dead.has(bp) ? "cm-bp-dead" : "cm-bp");
          if (ex?.next != null) add(ex.next, "cm-next");
          if (errLn != null) add(errLn, "cm-error-line");
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

  // push exec/breakpoints/error into the editor on change
  useEffect(() => {
    view.current?.dispatch({ effects: setPanel.of({ exec, breakpoints, deadLines, errorLine }) });
  }, [exec, breakpoints, deadLines, errorLine]);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlyComp.current.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
      ]),
    });
  }, [readOnly]);

  return <div className="editor codepanel" ref={host} />;
}
