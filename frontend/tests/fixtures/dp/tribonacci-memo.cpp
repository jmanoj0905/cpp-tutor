#include <iostream>
#include <vector>
using namespace std;

int helper(int n, vector<int> &dp){
    if (dp[n] != -1) {
        return dp[n];
    }
    dp[n] = helper(n-1, dp) + helper(n-2, dp) + helper(n-3, dp);
    return dp[n];
}

int tribonacci(int n){
    if (n < 2) {
        return n;
    }
    vector<int> dp(n+1, -1);
    dp[0] = 0;
    dp[1] = 1;
    dp[2] = 1;
    return helper(n, dp);
}

int main(){
    int n = 3;
    cout << tribonacci(n);
    return 0;
}
