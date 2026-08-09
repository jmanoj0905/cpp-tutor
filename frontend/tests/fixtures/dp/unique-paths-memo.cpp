#include <iostream>
#include <vector>
using namespace std;

int dfs(int m, int n, int i, int j, vector<vector<int>> &dp){
    if (i >= m || j >= n) {
        return 0;
    }
    if (i == m-1 && j == n-1) {
        return 1;
    }
    if (dp[i][j] != -1) {
        return dp[i][j];
    }
    dp[i][j] = dfs(m, n, i+1, j, dp) + dfs(m, n, i, j+1, dp);
    return dp[i][j];
}

int uniquePaths(int m, int n){
    vector<vector<int>> dp(m, vector<int>(n, -1));
    dp[m-1][n-1] = 0;
    return dfs(m, n, 0, 0, dp);
}

int main(){
    int m = 2;
    int n = 2;
    cout << uniquePaths(m, n);
    return 0;
}
