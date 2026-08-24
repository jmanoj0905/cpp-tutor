import { describe, it, expect } from "vitest";
import { addressIndex, shapeToScene, trieSceneFrom } from "../../src/viz/graph/treeScene";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import type { GraphScene } from "../../src/viz/graph/graphModel";
import { applyShapes, shapeInfoFor } from "../../src/viz/shapes";
import { memoryAt } from "../../src/viz/memoryModel";
import type { NormalizedMemory } from "../../src/viz/memoryModel";
import { trieNode } from "../shapeHelpers";
import type { ExecPoint, Trace } from "../../src/types/trace";
import trie from "../fixtures/trie.json";

const CONFIRMED = new Map([["TrieNode", "trie" as const]]);
const NO_DISABLED: Set<string> = new Set();

const mem = (heap: NormalizedMemory["heap"], links: NormalizedMemory["links"] = []): NormalizedMemory =>
  ({ globals: [], frames: [], heap, links });

/** root -a-> A -p-> P, with P marked endOfWord. */
const ap = () => mem([
  trieNode("0x10", { 0: "0x20" }),
  trieNode("0x20", { 15: "0x30" }),
  trieNode("0x30", {}, true),
]);

const shapesOf = (m: NormalizedMemory) => applyShapes(m, CONFIRMED, NO_DISABLED).shapes;

describe("shapeToScene(trie)", () => {
  it("maps trie shape nodes and edges into a trie GraphScene", () => {
    const scene = shapeToScene(shapesOf(ap()), "trie")!;
    expect(scene.kind).toBe("trie");
    expect(scene.nodes).toHaveLength(3);
    expect(scene.edges).toHaveLength(2);
  });

  it("labels each edge with the character it consumes", () => {
    const scene = shapeToScene(shapesOf(ap()), "trie")!;
    expect(scene.edges.map((e) => e.label).sort()).toEqual(["a", "p"]);
  });

  it("never emits a slot on a trie edge", () => {
    // ShapeEdge.slot on a trie is the ARRAY INDEX (0..25), but treeLayout reads
    // slot as a binary path — slot 0 means "go left", slot 1 "go right". Slot
    // 25 would fling a node 25 half-bands off its parent, and every `a` edge
    // would read as a left child. This is the one place B3 can draw a wrong
    // picture rather than no picture.
    const scene = shapeToScene(shapesOf(ap()), "trie")!;
    expect(scene.edges.every((e) => e.slot === undefined)).toBe(true);
  });

  it("marks the node that completes a word as terminal", () => {
    const scene = shapeToScene(shapesOf(ap()), "trie")!;
    const terminals = scene.nodes.filter((n) => n.terminal);
    expect(terminals).toHaveLength(1);
    // The terminal is the node the "p" edge points at, not the root.
    const pEdge = scene.edges.find((e) => e.label === "p")!;
    expect(terminals[0].id).toBe(pEdge.to);
  });

  it("returns null when there is no trie shape", () => {
    expect(shapeToScene([], "trie")).toBeNull();
    expect(shapeToScene(shapesOf(mem([])), "trie")).toBeNull();
  });

  it("still defaults to tree shapes, leaving B1's callers unchanged", () => {
    expect(shapeToScene(shapesOf(ap()))).toBeNull();
  });

  it("falls back to the numeric index when the array is not 26 wide", () => {
    const digits = mem([
      trieNode("0x10", { 7: "0x20" }, false, 10),
      trieNode("0x20", {}, true, 10),
    ]);
    const scene = shapeToScene(shapesOf(digits), "trie")!;
    expect(scene.edges[0].label).toBe("7");
  });
});

describe("trieSceneFrom", () => {
  const point = {
    line: 1, event: "step_line", stack_to_render: [], heap: {},
    globals: {}, ordered_globals: [], stdout: "",
  } as unknown as ExecPoint;

  it("binds fingers, current and order with no trie-specific binder code", () => {
    const m = ap();
    m.frames = [{ id: "f0", name: "insert", cells: [] }];
    m.links = [{
      fromId: "stack-f0-cur", fromName: "cur",
      toId: "heap-heap-0x20", targetAddress: "0x20",
    }];
    const scene = trieSceneFrom(shapesOf(m), m, [point], 0)!;
    expect(scene.kind).toBe("trie");
    expect(scene.overlays.fingers.get("heap-heap-0x20")).toEqual(["cur"]);
    expect(scene.overlays.current).toEqual(["heap-heap-0x20"]);
  });

  it("returns null with no trie shapes", () => {
    expect(trieSceneFrom(shapesOf(mem([])), mem([]), [point], 0)).toBeNull();
  });

  it("indexes trie node addresses", () => {
    expect(addressIndex(shapesOf(ap()), "trie").size).toBe(3);
  });
});

describe("trie.json fixture (inserting \"apple\")", () => {
  const trace = (trie as unknown as Trace).trace;

  const sceneAt = (step: number): GraphScene | null => {
    const m = memoryAt(trace[step]);
    const info = shapeInfoFor(trace);
    const { shapes } = applyShapes(m, info.confirmed, NO_DISABLED, info.selfNames);
    return buildGraphScene(m, null, trace, step, "auto", shapes);
  };

  const all = (): GraphScene[] => {
    const out: GraphScene[] = [];
    for (let s = 0; s < trace.length; s++) {
      const sc = sceneAt(s);
      if (sc) out.push(sc);
    }
    return out;
  };

  it("confirms TrieNode as a trie and builds trie scenes", () => {
    expect(shapeInfoFor(trace).confirmed.get("TrieNode")).toBe("trie");
    const scenes = all();
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.every((s) => s.kind === "trie")).toBe(true);
  });

  it("spells apple along the edge labels once the word is inserted", () => {
    const full = all().find((s) => s.nodes.length === 6);
    expect(full).toBeDefined();
    expect(full!.edges.map((e) => e.label).join("")).toBe("apple");
  });

  it("marks exactly one terminal node, at the end of the word", () => {
    const done = all().reverse().find((s) => s.nodes.some((n) => n.terminal));
    expect(done).toBeDefined();
    expect(done!.nodes.filter((n) => n.terminal)).toHaveLength(1);
  });

  it("names cur as a finger walking the insert path", () => {
    const named = all().flatMap((s) => [...s.overlays.fingers.values()].flat());
    expect(named).toContain("cur");
  });

  it("never carries a slot, on any step", () => {
    expect(all().every((s) => s.edges.every((e) => e.slot === undefined))).toBe(true);
  });
});
