import { describe, it, expect } from "vitest";
import { diagnose } from "../../src/viz/ub/diagnose";
import type { Trace } from "../../src/types/trace";
import uninitCond from "../fixtures/ub/uninit-cond.json";
import uninitArrayElem from "../fixtures/ub/uninit-array-elem.json";
import invalidRead from "../fixtures/ub/invalid-read.json";
import invalidWrite from "../fixtures/ub/invalid-write.json";
import invalidFree from "../fixtures/ub/invalid-free.json";
import mismatchedDelete from "../fixtures/ub/mismatched-delete.json";

/** The exception_msg the tracer actually produced for this fixture. */
const msgOf = (fixture: unknown): string => {
  const bad = (fixture as Trace).trace.find((p) => p.event !== "step_line");
  if (!bad?.exception_msg) throw new Error("fixture has no exception point");
  return bad.exception_msg;
};

describe("diagnose — real tracer messages", () => {
  it("classifies a read of an uninitialised local", () => {
    const d = diagnose(msgOf(uninitCond))!;
    expect(d.category).toBe("uninitialised");
    expect(d.title).toBe("Uninitialised value");
  });

  it("classifies a read of an uninitialised array element the same way", () => {
    expect(diagnose(msgOf(uninitArrayElem))!.category).toBe("uninitialised");
  });

  it("classifies an out-of-bounds write and parses the access size", () => {
    const d = diagnose(msgOf(invalidWrite))!;
    expect(d.category).toBe("invalid-write");
    expect(d.title).toBe("Invalid write");
    expect(d.accessSize).toBe(4);
  });

  it("classifies a read through a deleted pointer", () => {
    const d = diagnose(msgOf(invalidRead))!;
    expect(d.category).toBe("invalid-read");
    expect(d.accessSize).toBe(4);
  });

  it("classifies a double delete", () => {
    expect(diagnose(msgOf(invalidFree))!.category).toBe("invalid-free");
  });

  it("classifies a new[]/delete mismatch", () => {
    const d = diagnose(msgOf(mismatchedDelete))!;
    expect(d.category).toBe("mismatched-free");
    expect(d.title).toBe("Mismatched delete");
  });

  it("gives every category a meaning and a why, in plain language", () => {
    for (const f of [uninitCond, invalidRead, invalidWrite, invalidFree, mismatchedDelete]) {
      const d = diagnose(msgOf(f))!;
      expect(d.meaning.length).toBeGreaterThan(20);
      expect(d.why.length).toBeGreaterThan(20);
      // The explanation is for a learner: no raw memcheck jargon leaking in.
      expect(d.meaning).not.toContain("ERROR:");
    }
  });
});

describe("diagnose — message handling", () => {
  it("keeps the raw memcheck line as detail, minus the ERROR: prefix", () => {
    const d = diagnose("ERROR: Invalid write of size 4\n(Stopped running after the first error. Please fix your code.)")!;
    expect(d.detail).toBe("Invalid write of size 4");
  });

  it("strips the tracer's stop-running advice, which the panel rephrases", () => {
    const d = diagnose(msgOf(invalidWrite))!;
    expect(d.detail).not.toContain("Stopped running");
    expect(d.meaning).not.toContain("Stopped running");
  });

  it("returns null for no message at all", () => {
    expect(diagnose(undefined)).toBeNull();
    expect(diagnose("")).toBeNull();
    expect(diagnose("   ")).toBeNull();
  });

  it("classifies a memcheck wording no fixture reproduces", () => {
    // mc_errors.c can emit these; none of the sample programs trigger them.
    expect(diagnose("ERROR: Use of uninitialised value of size 8")!.category).toBe("uninitialised");
    expect(diagnose("ERROR: Source and destination overlap in memcpy(0x1, 0x2, 4)")!.category).toBe("overlap");
  });

  it("still renders an unrecognised message rather than blanking", () => {
    // A memcheck version bump must never produce an empty panel.
    const d = diagnose("ERROR: Some entirely new memcheck wording")!;
    expect(d.category).toBe("unknown");
    expect(d.detail).toBe("Some entirely new memcheck wording");
    expect(d.meaning.length).toBeGreaterThan(0);
  });

  it("survives a message with no ERROR: prefix", () => {
    expect(diagnose("Invalid read of size 2")!.category).toBe("invalid-read");
  });

  it("reports no accessSize when the wording carries none", () => {
    expect(diagnose(msgOf(invalidFree))!.accessSize).toBeUndefined();
  });
});
