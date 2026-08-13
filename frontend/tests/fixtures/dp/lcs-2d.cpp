#include <bits/stdc++.h>
using namespace std;

string longestSubstr(string s1, string s2){
    int n = s1.size();
    int m = s2.size();

    vector<vector<int>> dp(n+1, vector<int>(m+1, 0));

    for (int i = 1; i <= n; i++) {
        for (int j = 1; j <= m; j++) {
            if (s1[i-1] == s2[j-1]) {
                dp[i][j] = 1+dp[i-1][j-1];
            }
            else {
                dp[i][j] = max(dp[i-1][j], dp[i][j-1]);
            }
        }
    }

    int i = n, j = m;
    string lcs = "";
    while (i > 0 && j > 0) {
        if (s1[i-1] == s2[j-1]) {
            lcs += s1[i-1];
            i--;
            j--;
        }
        else if (dp[i-1][j] > dp[i][j-1]) {
            i--;
        }
        else {
            j--;
        }
    }
    reverse(lcs.begin(), lcs.end());
    return lcs;
}

int main() {
    string str1 = "abcd";
    string str2 = "bdef";
    cout << longestSubstr(str1, str2);
    return 0;
}
