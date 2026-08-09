#include <iostream>
#include <string>
#include <vector>
using namespace std;

string longestPalindrome(string s){
    int n = s.length();
    if(n == 0) return "";

    //dp[i][j] = whether s[i -> j] is a palindrome or not
    vector<vector<bool>> dp(
        n,
        vector<bool>(n, false)
    );

    int bestStart = 0;
    int longestLen = 0;

    for (int length = 1; length <= n; length++) { //Search for substrings from len 1 to n
        for (int i = 0; i <= n-length; i++) { //The starting position of the substrings (0 -> n-length)
            int j = i+length-1; //The end of the substring

            if (length == 1) {
                dp[i][j] = true;
            }

            else if (length == 2) {
                dp[i][j] = (s[i] == s[j]);
            }

            else {
                dp[i][j] = (s[i] == s[j]) && dp[i+1][j-1];
            }

            if (dp[i][j] && length > longestLen) {
                longestLen = length;
                bestStart = i;
            }
        }
    }
    return s.substr(bestStart, longestLen);
}

int main(){
    string s = "aba";
    cout << longestPalindrome(s);
    return 0;
}
