#include <cstdio>
int main() {
  int dp[3][4];
  for (int j = 0; j < 4; j++) dp[0][j] = 1;
  for (int i = 1; i < 3; i++) dp[i][0] = 1;
  for (int i = 1; i < 3; i++) {
    for (int j = 1; j < 4; j++) {
      dp[i][j] = dp[i - 1][j] + dp[i][j - 1];
    }
  }
  printf("%d\n", dp[2][3]);
  return 0;
}
