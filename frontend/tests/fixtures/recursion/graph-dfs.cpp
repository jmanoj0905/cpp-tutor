int adj[5][5] = {
  {0, 1, 1, 0, 0},
  {1, 0, 0, 1, 0},
  {1, 0, 0, 1, 0},
  {0, 1, 1, 0, 1},
  {0, 0, 0, 1, 0},
};
bool seen[5];
int order = 0;
void dfs(int u) {
  seen[u] = true;
  order++;
  for (int v = 0; v < 5; v++) {
    if (adj[u][v] && !seen[v]) dfs(v);
  }
}
int main() {
  dfs(0);
  return order;
}
