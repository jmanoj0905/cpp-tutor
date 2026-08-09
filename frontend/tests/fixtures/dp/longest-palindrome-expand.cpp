#include <iostream>
#include <string>
#include <vector>
using namespace std;

vector<int> checkThisSubstring(string s, int left, int right){
    while (left >= 0 && right <= s.length()-1 && s[left] == s[right]) {
        left--;
        right++;
    }
    return {left+1, right-1};
}

string longestPalindrome(string s){
    if (s.length() == 0) {
        return "";
    }

    int pallindromeLen = 0;
    int bestL = 0, bestR = 0;
    for (int i = 0; i < s.length(); i++) {
        vector<int> positionsOdd = checkThisSubstring(s, i, i);
        int oddPosLen = positionsOdd[1] - positionsOdd[0] + 1;

        if (oddPosLen > pallindromeLen){
            pallindromeLen = oddPosLen;
            bestL = positionsOdd[0];
            bestR = positionsOdd[1];
        }

        if (i+1 < s.length()) {
            vector<int> positionsEven = checkThisSubstring(s, i, i+1);
            int evePosLen = positionsEven[1] - positionsEven[0] + 1;
            cout << "Odd Position len : " << oddPosLen << "\n" << "Eve Position len : " << evePosLen << "\n----------\n";

            if (evePosLen > pallindromeLen) {
                pallindromeLen = evePosLen;
                bestL = positionsEven[0];
                bestR = positionsEven[1];
            }
        }
    }
    return s.substr(bestL, bestR-bestL+1);
}

int main(){
    string s = "aba";
    cout << longestPalindrome(s);
    return 0;
}
