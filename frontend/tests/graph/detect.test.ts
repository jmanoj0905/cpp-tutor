import { describe, it, expect } from "vitest";
import { hasGraphCode } from "../../src/viz/graph/detect";

/** The problem this guards: an adjacency matrix and a 2-D DP table are the
 *  same `vector<vector<int>>`, so the structural detector can't tell them
 *  apart and the Graph tab used to appear on DP solutions. */
const lcs = `
  #include <bits/stdc++.h>
  using namespace std;
  string longestSubstr(string s1, string s2){
      int n = s1.size(), m = s2.size();
      vector<vector<int>> dp(n+1, vector<int>(m+1, 0));
      for (int i = 1; i <= n; i++)
          for (int j = 1; j <= m; j++)
              dp[i][j] = s1[i-1] == s2[j-1] ? 1 + dp[i-1][j-1]
                                            : max(dp[i-1][j], dp[i][j-1]);
      return "";
  }
`;

describe("hasGraphCode", () => {
  it("is false for a 2-D DP table solution", () => {
    expect(hasGraphCode(lcs)).toBe(false);
  });

  it("is true for named graph data", () => {
    expect(hasGraphCode("vector<vector<int>> adj(n);")).toBe(true);
    expect(hasGraphCode("vector<vector<int>> graph(n);")).toBe(true);
    expect(hasGraphCode("vector<vector<int>> edges;")).toBe(true);
    expect(hasGraphCode("vector<int> indegree(n, 0);")).toBe(true);
  });

  it("splits camelCase and snake_case to find the root word", () => {
    expect(hasGraphCode("vector<vector<int>> adjMatrix(v);")).toBe(true);
    expect(hasGraphCode("vector<vector<int>> adj_list(v);")).toBe(true);
    expect(hasGraphCode("for (int nextNeighbour : g[u]) {}")).toBe(true);
  });

  it("is true when two kinds of traversal machinery appear together", () => {
    expect(hasGraphCode("queue<pair<int,int>> q; vector<vector<bool>> visited;")).toBe(true);
    expect(hasGraphCode("void dfs(int r, int c, vector<vector<bool>> &visited) {}")).toBe(true);
  });

  it("is false for one kind of traversal machinery alone", () => {
    // A k-th largest heap has a frontier and nothing else; a DP memo has a
    // recursive helper and nothing else.
    expect(hasGraphCode("priority_queue<int, vector<int>, greater<int>> pq;")).toBe(false);
    expect(hasGraphCode("int dfs(int i, vector<int> &memo) { return memo[i]; }")).toBe(false);
  });

  it("needs a traversal before a grid counts", () => {
    // minimumPathSum-shaped: a DP table filled over a grid is not a graph.
    expect(hasGraphCode("vector<vector<int>> grid; vector<vector<int>> dp;")).toBe(false);
    expect(hasGraphCode("vector<vector<char>> grid; queue<pair<int,int>> q;")).toBe(true);
  });

  it("ignores vocabulary that only appears in comments or output", () => {
    expect(hasGraphCode('// build the graph\ncout << "visited node";')).toBe(false);
  });
});
