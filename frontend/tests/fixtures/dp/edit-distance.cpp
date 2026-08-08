#include <vector>
#include <string>
#include <iostream>
using namespace std;
int main() {
  string a = "cat", b = "cut";
  vector<vector<int>> dp(4, vector<int>(4, 0));
  for (int i = 0; i <= 3; i++) dp[i][0] = i;
  for (int j = 0; j <= 3; j++) dp[0][j] = j;
  for (int i = 1; i <= 3; i++)
    for (int j = 1; j <= 3; j++) {
      if (a[i-1] == b[j-1]) dp[i][j] = dp[i-1][j-1];
      else dp[i][j] = 1 + min(dp[i-1][j-1], min(dp[i-1][j], dp[i][j-1]));
    }
  cout << dp[3][3] << endl;
}
