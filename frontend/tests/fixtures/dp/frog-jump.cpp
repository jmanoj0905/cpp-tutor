#include <iostream>
#include <vector>
using namespace std;

int frogJump(vector<int> &heights){
    //dp[i] = min(
    //  dp[i-1] + abs(heights[i] - heights[i-1]),
    //  dp[i-2] + abs(heights[i] - heights[i-2])
    //)

    vector<int> dp(heights.size(), -1);
    dp[0] = 0;
    dp[1] = dp[0] + abs(heights[0] - heights[1]);
    for (int i = 2; i < heights.size(); i++) {
        dp[i] = min(
            dp[i-1] + abs(heights[i] - heights[i-1]),
            dp[i-2] + abs(heights[i] - heights[i-2])
        );
    }
    return dp[heights.size()-1];
}

int main(){
    vector<int> heights = {2,1,3,5,4};
    cout << frogJump(heights);
    return 0;
}
