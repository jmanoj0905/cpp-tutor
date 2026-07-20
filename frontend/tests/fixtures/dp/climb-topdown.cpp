#include <cstdio>
#include <vector>
int solve(int n, std::vector<int>& memo) {
  if (n <= 1) return 1;
  if (memo[n] != -1) return memo[n];
  memo[n] = solve(n - 1, memo) + solve(n - 2, memo);
  return memo[n];
}
int main() {
  int n = 6;
  std::vector<int> memo(n + 1, -1);
  printf("%d\n", solve(n, memo));
  return 0;
}
