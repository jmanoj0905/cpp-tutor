#include <iostream>
#include <vector>
using namespace std;

int solve(int index, vector<int> &heights, int k, vector<int> &dp){
    if (index == 0) return 0;

    if (dp[index] != -1) return dp[index];

    int minimumEnergy = INT_MAX;

    for (int jump = 1; jump <= k; jump++) {
        if (index - jump >= 0) {
            int energy = solve(index - jump, heights, k, dp) + 
                            abs(heights[index] - heights[index-jump]);
            minimumEnergy = min(minimumEnergy, energy);
        }
    }
    return dp[index] = minimumEnergy;
}

int frogJump(vector<int> &heights, int k){
    int n = heights.size();
    vector<int> dp(n-1);
    return solve(n-1, heights, k, dp);
}

int main(){
    vector<int> heights = {2,1,3,5,4};
    int k = 2;
    cout << frogJump(heights, k);
    return 0;
}

