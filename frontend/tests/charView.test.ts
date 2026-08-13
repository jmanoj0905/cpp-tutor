import { describe, it, expect } from "vitest";
import { applyCharView } from "../src/viz/charView";
import { normalizeMemory, type NormalizedCell, type NormalizedMemory } from "../src/viz/memoryModel";
import type { ExecPoint } from "../src/types/trace";
import wordsFixture from "./fixtures/stl/vector-of-strings.json";

// Real backend trace of: vector<string> words = {"alpha","beta","gamma"};
const steps = (wordsFixture as { trace: ExecPoint[] }).trace;

/** The `words` vector<string> cell at the step where it holds the most elements. */
function wordsCell(): NormalizedCell {
  let best: NormalizedCell | undefined;
  for (const s of steps) {
    const c = normalizeMemory(s).frames[0]?.cells.find((x) => x.name === "words");
    if (c && (!best || (c.length ?? -1) > (best.length ?? -1))) best = c;
  }
  return best!;
}

/** Find a cell by name across globals + all frames of a transformed memory. */
function find(mem: NormalizedMemory, name: string): NormalizedCell | undefined {
  const roots = [...mem.globals, ...mem.frames.flatMap((f) => f.cells)];
  return roots.find((c) => c.name === name);
}

function memWith(cell: NormalizedCell): NormalizedMemory {
  return { globals: [], frames: [{ id: "f", name: "main", cells: [cell] }], heap: [], links: [] };
}

describe("applyCharView — vector<string> ⇄ vector<vector<char>>", () => {
  it("annotates a vector<string> as togglable-but-off when charView is empty", () => {
    const words = wordsCell();
    const out = applyCharView(memWith(words), new Set());
    const w = find(out, "words")!;
    expect(w.charViewToggle).toBe("off");
    // The container's toggle is a bulk action over its elements, which each
    // stay strings and carry their own (off) toggle.
    expect(w.charViewGroup).toEqual((words.children ?? []).map((c) => c.id));
    for (const child of w.children ?? []) {
      expect(child.containerKind).toBe("string");
      expect(child.charViewToggle).toBe("off");
    }
  });

  it("flips every element string to vector<char> when the whole group is on", () => {
    const words = wordsCell();
    const group = (words.children ?? []).map((c) => c.id);
    const out = applyCharView(memWith(words), new Set(group));
    const w = find(out, "words")!;
    expect(w.charViewToggle).toBe("on");
    expect(w.displayValue).toMatch(/^vector<vector<char>> · \d+$/);
    const children = w.children ?? [];
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.kind).toBe("container");
      expect(child.containerKind).toBe("vector");
      expect(child.elementType).toBe("char");
      expect(child.displayValue).toMatch(/^vector<char> · \d+$/);
    }
    // "alpha" → 5 char glyph grandchildren, unchanged, in order.
    expect((children[0].children ?? []).map((c) => c.displayValue)).toEqual(["a", "l", "p", "h", "a"]);
  });

  it("flips one element on its own without flipping its siblings", () => {
    const words = wordsCell();
    const first = (words.children ?? [])[0];
    const w = find(applyCharView(memWith(words), new Set([first.id])), "words")!;
    // Not every element is flipped, so the container reads off.
    expect(w.charViewToggle).toBe("off");
    expect(w.displayValue).toBe(words.displayValue);
    expect(w.children![0].containerKind).toBe("vector");
    expect(w.children![0].charViewToggle).toBe("on");
    for (const child of w.children!.slice(1)) {
      expect(child.containerKind).toBe("string");
      expect(child.charViewToggle).toBe("off");
    }
  });

  it("preserves cell ids so diff/links resolve identically in either view", () => {
    const words = wordsCell();
    const group = (words.children ?? []).map((c) => c.id);
    const off = find(applyCharView(memWith(words), new Set()), "words")!;
    const on = find(applyCharView(memWith(words), new Set(group)), "words")!;
    expect(on.id).toBe(off.id);
    expect((on.children ?? []).map((c) => c.id)).toEqual((off.children ?? []).map((c) => c.id));
  });
});

describe("applyCharView — standalone string cell", () => {
  const str: NormalizedCell = {
    id: "s", name: "s", source: "stack", kind: "container", address: null,
    type: "string", displayValue: '"hi"', rawValue: null, containerKind: "string",
    elementType: "char", length: 2,
    children: [
      { id: "s.0", name: "[0]", source: "stack", kind: "scalar", address: null, type: "char", displayValue: "h", rawValue: null },
      { id: "s.1", name: "[1]", source: "stack", kind: "scalar", address: null, type: "char", displayValue: "i", rawValue: null },
    ],
  };

  it("gets its own toggle and flips itself when on", () => {
    const off = find(applyCharView(memWith(str), new Set()), "s")!;
    expect(off.charViewToggle).toBe("off");
    expect(off.containerKind).toBe("string");
    expect(off.displayValue).toBe('"hi"');

    const on = find(applyCharView(memWith(str), new Set(["s"])), "s")!;
    expect(on.charViewToggle).toBe("on");
    expect(on.containerKind).toBe("vector");
    expect(on.elementType).toBe("char");
    expect(on.displayValue).toBe("vector<char> · 2");
    expect((on.children ?? []).map((c) => c.displayValue)).toEqual(["h", "i"]);
  });
});

describe("applyCharView — non-string cells untouched", () => {
  const vec: NormalizedCell = {
    id: "v", name: "v", source: "stack", kind: "container", address: null,
    type: "vector<int>", displayValue: "vector<int> · 2", rawValue: null,
    containerKind: "vector", elementType: "int", length: 2,
    children: [
      { id: "v.0", name: "[0]", source: "stack", kind: "scalar", address: null, type: "int", displayValue: "1", rawValue: null },
      { id: "v.1", name: "[1]", source: "stack", kind: "scalar", address: null, type: "int", displayValue: "2", rawValue: null },
    ],
  };

  it("leaves a vector<int> with no toggle affordance and no changes", () => {
    const out = find(applyCharView(memWith(vec), new Set(["v"])), "v")!;
    expect(out.charViewToggle).toBeUndefined();
    expect(out.containerKind).toBe("vector");
    expect(out.displayValue).toBe("vector<int> · 2");
  });
});

// ---- helpers for the "everywhere" coverage cases ----
function str(id: string, text: string): NormalizedCell {
  return {
    id, name: id, source: "stack", kind: "container", address: null, type: "string",
    displayValue: JSON.stringify(text), rawValue: null, containerKind: "string",
    elementType: "char", length: text.length,
    children: [...text].map((ch, i) => ({
      id: `${id}.${i}`, name: `[${i}]`, source: "stack" as const, kind: "scalar" as const,
      address: null, type: "char", displayValue: ch, rawValue: null,
    })),
  };
}
const container = (id: string, kind: string, children: NormalizedCell[]): NormalizedCell => ({
  id, name: id, source: "stack", kind: "container", address: null, type: kind,
  displayValue: `${kind} · ${children.length}`, rawValue: null, containerKind: kind,
  length: children.length, children,
});

describe("applyCharView — every homogeneous string sequence gets a container flip", () => {
  for (const kind of ["set", "deque", "list", "forward_list", "multiset", "unordered_set", "array"]) {
    it(`gives ${kind}<string> one container-level toggle that flips all elements`, () => {
      const c = container("c", kind, [str("c.a", "ab"), str("c.b", "cd")]);
      const off = find(applyCharView(memWith(c), new Set()), "c")!;
      expect(off.charViewToggle).toBe("off");
      expect(off.charViewGroup).toEqual(["c.a", "c.b"]);
      for (const child of off.children ?? []) expect(child.charViewToggle).toBe("off");

      const on = find(applyCharView(memWith(c), new Set(["c.a", "c.b"])), "c")!;
      expect(on.charViewToggle).toBe("on");
      for (const child of on.children ?? []) {
        expect(child.containerKind).toBe("vector");
        expect(child.elementType).toBe("char");
        expect(child.displayValue).toMatch(/^vector<char> · \d+$/);
      }
    });
  }
});

describe("applyCharView — strings nested in map/set values, pairs, structs", () => {
  it("gives a map<int,string> value its own per-value toggle and flips it", () => {
    // entry = pair with relabeled key/value members
    const entry: NormalizedCell = {
      id: "m.0", name: "[0]", source: "stack", kind: "container", address: null, type: "pair",
      displayValue: "pair", rawValue: null, containerKind: "pair", children: [
        { id: "m.0.k", name: "key", source: "stack", kind: "scalar", address: null, type: "int", displayValue: "7", rawValue: null },
        str("m.0.v", "hi"),
      ],
    };
    const map = container("m", "map", [entry]);
    const value = (mem: NormalizedMemory) =>
      find(mem, "m")!.children![0].children!.find((c) => c.id === "m.0.v")!;

    const off = value(applyCharView(memWith(map), new Set()));
    expect(off.charViewToggle).toBe("off");
    expect(off.containerKind).toBe("string");

    const on = value(applyCharView(memWith(map), new Set(["m.0.v"])));
    expect(on.charViewToggle).toBe("on");
    expect(on.containerKind).toBe("vector");
    expect((on.children ?? []).map((c) => c.displayValue)).toEqual(["h", "i"]);
  });

  it("gives a pair<int,string> string member its own toggle (pair is not a homogeneous string sequence)", () => {
    const pair: NormalizedCell = {
      id: "p", name: "p", source: "stack", kind: "container", address: null, type: "pair",
      displayValue: "pair", rawValue: null, containerKind: "pair", children: [
        { id: "p.f", name: "first", source: "stack", kind: "scalar", address: null, type: "int", displayValue: "1", rawValue: null },
        str("p.s", "yo"),
      ],
    };
    const out = find(applyCharView(memWith(pair), new Set(["p.s"])), "p")!;
    expect(out.charViewToggle).toBeUndefined(); // the pair itself is not togglable
    const s = out.children!.find((c) => c.id === "p.s")!;
    expect(s.charViewToggle).toBe("on");
    expect(s.containerKind).toBe("vector");
  });

  it("gives a string struct member its own toggle", () => {
    const strct: NormalizedCell = {
      id: "obj", name: "obj", source: "stack", kind: "struct", address: null, type: "Person",
      displayValue: "Person", rawValue: null, children: [
        { id: "obj.age", name: "age", source: "stack", kind: "scalar", address: null, type: "int", displayValue: "30", rawValue: null },
        str("obj.name", "sam"),
      ],
    };
    const off = find(applyCharView(memWith(strct), new Set()), "obj")!
      .children!.find((c) => c.id === "obj.name")!;
    expect(off.charViewToggle).toBe("off");
  });

  it("nested vector<vector<string>>: each inner vector gets its own container flip", () => {
    const inner1 = container("g.0", "vector", [str("g.0.a", "ab")]);
    const inner2 = container("g.1", "vector", [str("g.1.a", "cd")]);
    const outer = container("g", "vector", [inner1, inner2]);
    const out = find(applyCharView(memWith(outer), new Set(["g.0.a"])), "g")!;
    // outer is a vector of vectors, not of strings → no container toggle on it.
    expect(out.charViewToggle).toBeUndefined();
    const i0 = out.children!.find((c) => c.id === "g.0")!;
    const i1 = out.children!.find((c) => c.id === "g.1")!;
    expect(i0.charViewToggle).toBe("on");
    expect(i1.charViewToggle).toBe("off");
    expect(i0.children![0].containerKind).toBe("vector"); // flipped string
    expect(i1.children![0].containerKind).toBe("string");  // untouched
  });
});
