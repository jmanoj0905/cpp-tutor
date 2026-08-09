#include <iostream>
#include <string>
#include <vector>
using namespace std;

int countSubstrings(string s){
    int n = s.length();
    if(n == 0) return 0;

    //dp[i][j] says if s[i -> j] is a palindrome or not
    vector<vector<bool>> dp(n, vector<bool>(n, false));
    int count = 0;

    for (int length = 1; length <= n; length++) {
        for (int i = 0; i <= n-length; i++) {
            int j = i+length-1;

            if (length == 1) {
                dp[i][j] = true;
                count ++;
            }

            else if (length == 2) {
                if (s[i] == s[j]) {
                    dp[i][j] = true;
                    count ++;
                }
            }

            else {
                if (s[i] == s[j] && dp[i+1][j-1]) {
                    dp[i][j] = true;
                    count ++;
                }
            }
        }
    }
    return count;
}

int main(){
    string s = "aaaaa";
    cout << countSubstrings(s); //expected 15
    return 0;
}
