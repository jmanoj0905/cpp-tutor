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
    // Element strings stay strings and get NO independent toggle of their own.
    for (const child of w.children ?? []) {
      expect(child.containerKind).toBe("string");
      expect(child.charViewToggle).toBeUndefined();
    }
  });

  it("flips every element string to vector<char> when the vector id is on", () => {
    const words = wordsCell();
    const out = applyCharView(memWith(words), new Set([words.id]));
    const w = find(out, "words")!;
    expect(w.charViewToggle).toBe("on");
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

  it("preserves cell ids so diff/links resolve identically in either view", () => {
    const words = wordsCell();
    const off = find(applyCharView(memWith(words), new Set()), "words")!;
    const on = find(applyCharView(memWith(words), new Set([words.id])), "words")!;
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
