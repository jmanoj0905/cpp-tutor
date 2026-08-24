// Turns a raw memcheck error string into a classified, explainable diagnosis.
// Pure — no React, no DOM — same rule as memoryModel.ts and connectorGeometry.ts.
//
// The tracer runs a patched Valgrind, so memcheck already catches the classic
// C++ undefined-behaviour bugs and vg_to_opt_trace.py forwards the first one as
// `event: "exception"` with the raw string in `exception_msg`. Until this
// module existed that string was dumped into the UI verbatim, which told a
// learner nothing: "Invalid write of size 4" does not say that `a[7]` ran off
// the end of a 3-element array, nor why execution stopped.
//
// Wordings are taken from valgrind-3.11.0/memcheck/mc_errors.c and confirmed
// against real traces in tests/fixtures/ub/.

export type UbCategory =
  | "uninitialised"
  | "invalid-read"
  | "invalid-write"
  | "invalid-free"
  | "mismatched-free"
  | "overlap"
  | "unknown";

export interface UbDiagnosis {
  category: UbCategory;
  /** Short human title, e.g. "Invalid write". */
  title: string;
  /** The memcheck line itself, verbatim minus the `ERROR: ` prefix. Kept so
   *  nothing is hidden from a user who wants the real text. */
  detail: string;
  /** What the program actually did, in a learner's language. */
  meaning: string;
  /** Why that is undefined behaviour rather than merely a wrong answer. */
  why: string;
  /** Bytes touched, from "of size N". Absent when the wording carries none. */
  accessSize?: number;
  /** Faulting address. Always absent today: memcheck has it
   *  (`VG_(get_error_address)`) but only prints it to stderr, never onto the
   *  trace line. Phase 2 of the UB lens adds a tracer patch that emits it, and
   *  this field is here from the start so that change stays additive — and so
   *  that `diagnose` keeps working against the published image, which will lag
   *  a local rebuild. */
  address?: string;
}

/** The tracer appends this to every memcheck message. It is advice, not
 *  diagnosis, and the panel rephrases it — so it never belongs in `detail`. */
const STOP_ADVICE = /\n?\(Stopped running after the first error\.[^)]*\)\s*$/;

interface Rule {
  match: RegExp;
  category: UbCategory;
  title: string;
  meaning: string;
  why: string;
}

// Order matters only in that every pattern here is mutually exclusive; they are
// matched in sequence and the first hit wins.
const RULES: Rule[] = [
  {
    match: /uninitiali[sz]ed value/i,
    category: "uninitialised",
    title: "Uninitialised value",
    meaning:
      "The program read a variable before anything was stored in it, then used that value to decide something.",
    why:
      "A declared-but-unassigned variable holds whatever bytes were already at that address, so the result changes between runs, machines and compiler settings. The language does not define what you get.",
  },
  {
    match: /Invalid write of size (\d+)/i,
    category: "invalid-write",
    title: "Invalid write",
    meaning:
      "The program wrote to memory it does not own — past the end of an allocation, or through a pointer whose memory was already freed.",
    why:
      "The write has already landed on whatever happened to be at that address. Nothing detects it at runtime, so the corruption usually surfaces much later, somewhere unrelated.",
  },
  {
    match: /Invalid read of size (\d+)/i,
    category: "invalid-read",
    title: "Invalid read",
    meaning:
      "The program read memory it does not own — past the end of an allocation, or through a pointer whose memory was already freed.",
    why:
      "Freed or out-of-bounds memory often still holds its old contents, so this frequently returns a plausible-looking value and the bug hides until the allocator reuses the block.",
  },
  {
    match: /Mismatched free\(\) \/ delete \/ delete \[\]/i,
    category: "mismatched-free",
    title: "Mismatched delete",
    meaning:
      "Memory was released with the wrong operator — `new[]` paired with `delete`, `new` paired with `delete[]`, or a `new` freed with `free()`.",
    why:
      "`new[]` records the element count so it can run every destructor; plain `delete` never reads it. The pairing has to match the allocation exactly.",
  },
  {
    match: /Invalid free\(\) \/ delete \/ delete\[\] \/ realloc\(\)/i,
    category: "invalid-free",
    title: "Invalid delete",
    meaning:
      "The program released a block that was not a live allocation — most often deleting the same pointer twice, or deleting something that never came from `new`.",
    why:
      "The allocator's bookkeeping for that block is already gone, so a second release corrupts its free list. The crash, if one comes, lands in a later unrelated allocation.",
  },
  {
    match: /Source and destination overlap/i,
    category: "overlap",
    title: "Overlapping copy",
    meaning:
      "A copy was asked to read and write the same bytes — the source and destination ranges overlap.",
    why:
      "`memcpy` and friends are specified only for non-overlapping ranges, so a copy may read bytes it has already overwritten. `memmove` is the defined way to do this.",
  },
];

const UNKNOWN: Omit<Rule, "match"> = {
  category: "unknown",
  title: "Memory error",
  meaning: "Valgrind reported a memory error while running this line.",
  why:
    "Execution stopped here because continuing past undefined behaviour cannot be trusted to mean anything.",
};

export function diagnose(msg: string | undefined): UbDiagnosis | null {
  if (!msg || !msg.trim()) return null;

  const detail = msg
    .replace(STOP_ADVICE, "")
    .replace(/^ERROR:\s*/, "")
    .trim();
  if (!detail) return null;

  const rule = RULES.find((r) => r.match.test(detail));
  const { category, title, meaning, why } = rule ?? UNKNOWN;

  const size = /of size (\d+)/i.exec(detail);
  // Phase 2 wording: "Invalid write of size 4 @ 0x4B92040".
  const addr = /@\s*(0x[0-9a-fA-F]+)/.exec(detail);

  return {
    category,
    title,
    detail,
    meaning,
    why,
    ...(size ? { accessSize: Number(size[1]) } : {}),
    ...(addr ? { address: addr[1] } : {}),
  };
}
