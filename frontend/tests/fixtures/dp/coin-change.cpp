#include <vector>
#include <iostream>
using namespace std;
int main() {
  int coins[3] = {1, 3, 4};
  int T = 8;
  vector<int> dp(9, 999);
  dp[0] = 0;
  for (int a = 1; a <= T; a++) {
    for (int k = 0; k < 3; k++) {
      if (coins[k] <= a && dp[a - coins[k]] + 1 < dp[a])
        dp[a] = dp[a - coins[k]] + 1;
    }
  }
  cout << dp[T] << endl;
}
