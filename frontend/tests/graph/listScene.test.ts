import { describe, it, expect } from "vitest";
import {
  addressIndex, bindTreeCurrent, listSceneFrom, shapeToScene,
} from "../../src/viz/graph/treeScene";
import { applyShapes } from "../../src/viz/shapes";
import type { NormalizedMemory } from "../../src/viz/memoryModel";
import { listNode } from "../shapeHelpers";
import type { ExecPoint } from "../../src/types/trace";

const CONFIRMED = new Map([["ListNode", "list" as const]]);

const mem = (heap: NormalizedMemory["heap"], links: NormalizedMemory["links"] = []): NormalizedMemory =>
  ({ globals: [], frames: [], heap, links });

/** 1 -> 2 -> 3 -> 4, no cycle. */
const chain = () => mem([
  listNode("0x10", 1, "0x20"),
  listNode("0x20", 2, "0x30"),
  listNode("0x30", 3, "0x40"),
  listNode("0x40", 4, null),
]);

/** 1 -> 2 -> 3 -> 4 -> 2 : the tail loops back into the chain. */
const looped = () => mem([
  listNode("0x10", 1, "0x20"),
  listNode("0x20", 2, "0x30"),
  listNode("0x30", 3, "0x40"),
  listNode("0x40", 4, "0x20"),
]);

const shapesOf = (m: NormalizedMemory) => applyShapes(m, CONFIRMED, new Set()).shapes;
const addrById = (m: NormalizedMemory) => addressIndex(shapesOf(m), "list");
const idOf = (scene: { nodes: { id: string; label: string }[] }, label: string) =>
  scene.nodes.find((n) => n.label === label)!.id;

/** A stack local named `name` pointing at heap address `addr`. */
const finger = (frame: string, name: string, addr: string) =>
  ({ fromId: `stack-${frame}-${name}`, fromName: name, toId: `heap-heap-${addr}`, targetAddress: addr });

describe("shapeToScene(list)", () => {
  it("maps list shape nodes and edges into a list GraphScene", () => {
    const scene = shapeToScene(shapesOf(chain()), "list")!;
    expect(scene.kind).toBe("list");
    expect(scene.nodes.map((n) => n.label).sort()).toEqual(["1", "2", "3", "4"]);
    expect(scene.edges).toHaveLength(3);
    expect(scene.edges.every((e) => e.directed)).toBe(true);
  });

  it("never emits a slot on a list edge", () => {
    // There is only one self-pointer member, so slot-aware binary placement is
    // meaningless — and treeLayout would read slot 0 as "go left".
    const scene = shapeToScene(shapesOf(chain()), "list")!;
    expect(scene.edges.every((e) => e.slot === undefined)).toBe(true);
  });

  it("carries cycleBack onto the edge that closes the loop", () => {
    const scene = shapeToScene(shapesOf(looped()), "list")!;
    const back = scene.edges.filter((e) => e.cycleBack);
    expect(back).toHaveLength(1);
    expect(back[0].from).toBe(idOf(scene, "4"));
    expect(back[0].to).toBe(idOf(scene, "2"));
  });

  it("returns null when there is no list shape", () => {
    expect(shapeToScene([], "list")).toBeNull();
    expect(shapeToScene(shapesOf(mem([])), "list")).toBeNull();
  });

  it("still defaults to tree shapes, leaving B1's callers unchanged", () => {
    expect(shapeToScene(shapesOf(chain()))).toBeNull();
  });
});

describe("named fingers", () => {
  it("labels a node with the source variable pointing at it", () => {
    const m = chain();
    m.frames = [{ id: "f0", name: "hasCycle", cells: [] }];
    m.links = [finger("f0", "slow", "0x20")];
    const scene = shapeToScene(shapesOf(m), "list")!;
    bindTreeCurrent(m, scene, addrById(m));
    expect(scene.overlays.fingers.get(idOf(scene, "2"))).toEqual(["slow"]);
  });

  it("collects every pointer standing on the same node", () => {
    // Floyd's: the step where slow and fast meet is the whole point of the
    // algorithm, and an anonymous `current` set cannot show it.
    const m = looped();
    m.frames = [{ id: "f0", name: "hasCycle", cells: [] }];
    m.links = [finger("f0", "slow", "0x30"), finger("f0", "fast", "0x30")];
    const scene = shapeToScene(shapesOf(m), "list")!;
    bindTreeCurrent(m, scene, addrById(m));
    expect(scene.overlays.fingers.get(idOf(scene, "3"))).toEqual(["slow", "fast"]);
  });

  it("orders fingers innermost frame first, matching overlays.current", () => {
    const m = chain();
    m.frames = [
      { id: "f0", name: "main", cells: [] },
      { id: "f1", name: "reverse", cells: [] },
    ];
    m.links = [finger("f0", "head", "0x10"), finger("f1", "curr", "0x30")];
    const scene = shapeToScene(shapesOf(m), "list")!;
    bindTreeCurrent(m, scene, addrById(m));
    expect(scene.overlays.current).toEqual([idOf(scene, "3"), idOf(scene, "1")]);
    expect([...scene.overlays.fingers.keys()]).toEqual([idOf(scene, "3"), idOf(scene, "1")]);
  });

  it("does not name a node a heap-to-heap link points at", () => {
    const m = chain();
    m.links = [{
      fromId: "heap-heap-0x10-next", fromName: "next",
      toId: "heap-heap-0x20", targetAddress: "0x20",
    }];
    const scene = shapeToScene(shapesOf(m), "list")!;
    bindTreeCurrent(m, scene, addrById(m));
    expect(scene.overlays.fingers.size).toBe(0);
  });
});

describe("listSceneFrom", () => {
  const point = {
    line: 1, event: "step_line", stack_to_render: [], heap: {},
    globals: {}, ordered_globals: [], stdout: "",
  } as unknown as ExecPoint;

  it("returns a bound scene with fingers and current applied", () => {
    const m = chain();
    m.frames = [{ id: "f0", name: "reverse", cells: [] }];
    m.links = [finger("f0", "prev", "0x10"), finger("f0", "curr", "0x20")];
    const scene = listSceneFrom(shapesOf(m), m, [point], 0)!;
    expect(scene.kind).toBe("list");
    expect(scene.overlays.current).toHaveLength(2);
    expect(scene.overlays.fingers.get(idOf(scene, "2"))).toEqual(["curr"]);
  });

  it("marks the prev -> curr edge as onPath", () => {
    const m = chain();
    m.frames = [{ id: "f0", name: "reverse", cells: [] }];
    m.links = [finger("f0", "prev", "0x10"), finger("f0", "curr", "0x20")];
    const scene = listSceneFrom(shapesOf(m), m, [point], 0)!;
    const onPath = scene.edges.filter((e) => e.onPath);
    expect(onPath).toHaveLength(1);
    expect(onPath[0].from).toBe(idOf(scene, "1"));
    expect(onPath[0].to).toBe(idOf(scene, "2"));
  });

  it("ghosts a chain no live pointer can reach", () => {
    // A node orphaned by a reversal or a removal is still in the heap; it is
    // just no longer part of the list anyone holds.
    const m = mem([
      listNode("0x10", 1, "0x20"),
      listNode("0x20", 2, null),
      listNode("0xA0", 9, null),
    ]);
    m.frames = [{ id: "f0", name: "main", cells: [] }];
    m.links = [finger("f0", "head", "0x10")];
    const scene = listSceneFrom(shapesOf(m), m, [point], 0)!;
    expect(scene.overlays.detached).toEqual(new Set([idOf(scene, "9")]));
  });

  it("returns null with no list shapes", () => {
    expect(listSceneFrom(shapesOf(mem([])), mem([]), [point], 0)).toBeNull();
  });
});
