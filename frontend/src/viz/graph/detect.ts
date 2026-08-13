/** Does this program's SOURCE read like a graph problem?
 *
 *  Structure alone can't answer that. An adjacency matrix and a 2-D DP table
 *  are the same `vector<vector<int>>`, so `hasGraphContent` — which only looks
 *  at the decoded memory — says yes to `dp[i][j]` in a longest-common-
 *  subsequence solution just as readily as to `adj[u][v]`, and the Graph tab
 *  turns up on problems with no graph in them.
 *
 *  Vocabulary separates the two, and separates them cleanly: graph solutions
 *  name their data `adj`/`graph`/`edges`, mark a `visited` set, push onto a
 *  `queue`, or step a `grid` through a direction vector. DP solutions name
 *  their table `dp` and index it with a recurrence. So gate the structural
 *  detector on evidence read out of the code.
 *
 *  Deliberately NOT gated by this: pointer-tree shapes and `priority_queue`
 *  heaps. Those are unambiguous on their own — a heap IS a tree — and reach
 *  the Graph tab by their own paths in App.tsx.
 *
 *  Tuned against a 145-file practice corpus (Placement_prep), by folder:
 *  graphs 35/37, dynamic-programming 2/22, heap-priority-queue 0/5,
 *  arrays-hashing 1/13, trees 1/14, and 0 across two-pointers, sliding-window,
 *  stack, binary-search, linked-list, tries, greedy (bar one BFS-shaped
 *  jump-game), recursion. The two graph misses name their data for the domain
 *  (`flights`) or never traverse at all (a perimeter scan); the DP hits are
 *  grid problems solved with a memoized `dfs` over the grid, which is a
 *  traversal by any reading.
 */

/** Words that are graph data on their own. `edge`/`edges` are here because
 *  nothing else in the usual repertoire calls a container that. `node` is not:
 *  linked lists and trees use it just as much. */
const GRAPH_WORDS = new Set([
  "adj", "adjacency", "adjlist", "graph", "graphs", "digraph",
  "edge", "edges", "edgelist", "indegree", "outdegree", "degree",
  "topo", "topological", "topsort",
  "neighbor", "neighbors", "neighbour", "neighbours", "nbr", "nbrs",
  "vertex", "vertices",
]);

/** A grid is only a graph once something walks it: `minimumPathSum` fills a DP
 *  table over a `grid` and is not a graph problem, `noOfIslands` floods the
 *  same shape and is. `matrix` is deliberately absent — spiral-order and
 *  matrix-rotation array problems use it. */
const GRID_WORDS = new Set(["grid", "board", "maze", "island", "islands", "rooms", "image"]);

/** Traversal machinery, grouped: a frontier, a mark of what's been reached, a
 *  direction vector, a named search. One group alone is weak (a heap problem
 *  has a frontier; a spiral-order scan has a visited mask) — two groups
 *  together is a traversal. */
const TRAVERSAL_GROUPS: Record<string, Set<string>> = {
  frontier: new Set(["queue", "deque", "pq", "frontier"]),
  marked: new Set(["visited", "visit", "vis", "seen", "explored"]),
  directions: new Set(["dirs", "dir", "direction", "directions", "dx", "dy", "dr", "dc", "delta", "deltas", "moves"]),
  search: new Set(["bfs", "dfs", "flood", "floodfill", "traversal", "traverse", "relax"]),
};

/** Comments and string literals describe the problem in prose ("// graph
 *  problem", `cout << "visited"`), which is exactly the vocabulary being
 *  matched — strip both so only identifiers count. */
function stripNonCode(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/** Every identifier in the program, split on `_` and camelCase humps and
 *  lowercased, so `adjMatrix`, `adj_list` and `visitedPacific` all yield the
 *  root word the sets are keyed on. */
function codeWords(code: string): Set<string> {
  const out = new Set<string>();
  for (const ident of stripNonCode(code).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    for (const part of ident.split(/_+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      if (part) out.add(part.toLowerCase());
    }
  }
  return out;
}

export function hasGraphCode(code: string): boolean {
  const words = codeWords(code);
  for (const w of words) if (GRAPH_WORDS.has(w)) return true;

  const groups = Object.values(TRAVERSAL_GROUPS)
    .filter((group) => [...group].some((w) => words.has(w))).length;
  if (groups >= 2) return true;

  return groups >= 1 && [...GRID_WORDS].some((w) => words.has(w));
}
