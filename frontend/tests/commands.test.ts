import { describe, it, expect } from "vitest";
import { fuzzyScore, filterByContext, rank, emptyOrder, buildCommands,
  type Command, type CommandCtx } from "../src/palette/commands";
import { DEFAULTS } from "../src/settings/settings";

describe("fuzzyScore", () => {
  it("returns null when not a subsequence", () => {
    expect(fuzzyScore("zzz", "Next step")).toBeNull();
  });

  it("matches subsequence out of order-adjacency", () => {
    expect(fuzzyScore("nxt", "Next step")).not.toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("NEXT", "next step")).not.toBeNull();
  });

  it("scores a contiguous match higher than a scattered one", () => {
    const contiguous = fuzzyScore("next", "Next step")!;
    const scattered = fuzzyScore("net", "Next step")!;
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it("scores an earlier match higher than a later one for equal contiguity", () => {
    const early = fuzzyScore("ab", "ab zz")!;
    const late = fuzzyScore("ab", "zz ab")!;
    expect(early).toBeGreaterThan(late);
  });

  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

const cmd = (over: Partial<Command>): Command => ({
  id: "x", title: "X", group: "Actions", run: () => {}, ...over,
});

describe("filterByContext", () => {
  it("drops commands whose when() is false for the mode", () => {
    const list = [
      cmd({ id: "e", when: (c) => c.mode === "edit" }),
      cmd({ id: "t", when: (c) => c.mode === "trace" }),
      cmd({ id: "any" }),
    ];
    const ids = filterByContext(list, { mode: "trace" }).map((c) => c.id);
    expect(ids).toEqual(["t", "any"]);
  });
});

describe("rank", () => {
  it("keeps only matches, best first", () => {
    const list = [cmd({ id: "a", title: "Stop trace" }), cmd({ id: "b", title: "Next step" })];
    const out = rank(list, "next");
    expect(out.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("emptyOrder", () => {
  it("puts existing recent ids first in recent order, rest in declared order", () => {
    const list = [cmd({ id: "a" }), cmd({ id: "b" }), cmd({ id: "c" })];
    expect(emptyOrder(list, ["c", "gone", "a"]).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});

describe("buildCommands", () => {
  it("marks the active font-size value with a check hint", () => {
    const cmds = buildCommands({ mode: "edit" }, {}, { ...DEFAULTS, fontSize: "L" }, "");
    const large = cmds.find((c) => c.id === "font-L")!;
    const medium = cmds.find((c) => c.id === "font-M")!;
    expect(large.hint).toBe("✓");
    expect(medium.hint).toBeUndefined();
  });

  it("adds a jump-to-step command in trace mode for a numeric query", () => {
    let jumped: number | null = null;
    const cmds = buildCommands({ mode: "trace" }, { goto: (n) => { jumped = n; } }, DEFAULTS, "12");
    const jump = cmds.find((c) => c.id === "jump-step")!;
    expect(jump.title).toBe("Jump to step 12");
    jump.run();
    expect(jumped).toBe(12);
  });

  it("does not add jump-to-step in edit mode", () => {
    const cmds = buildCommands({ mode: "edit" }, {}, DEFAULTS, "12");
    expect(cmds.find((c) => c.id === "jump-step")).toBeUndefined();
  });

  it("offers Visualize in edit mode and Next in trace mode only", () => {
    const edit = buildCommands({ mode: "edit" }, {}, DEFAULTS, "").map((c) => c.id);
    const trace = buildCommands({ mode: "trace" }, {}, DEFAULTS, "").map((c) => c.id);
    expect(edit).toContain("visualize");
    expect(edit).not.toContain("next");
    expect(trace).toContain("next");
    expect(trace).not.toContain("visualize");
  });
});
