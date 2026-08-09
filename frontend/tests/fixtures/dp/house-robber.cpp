#include <iostream>
#include <vector>
using namespace std;

int rob(vector<int> &nums){
    if (nums.empty()) {
        return 0;
    }

    vector<int> dp(nums.size(), 0); //dp[i] tells max money you can have after going thru 0-i houses
    dp[0] = nums[0];
    dp[1] = max(nums[0], nums[1]);
    for (int i = 2; i < nums.size(); i++) {
        dp[i] = max(nums[i] + dp[i-2], dp[i-1]);
    }
    return dp[nums.size()-1];
}

int robAltApproach(vector<int> &nums){
    int prevTwo = 0;
    int prevOne = 0;

    for (int money : nums) {
        int current = max(prevOne, money + prevTwo);

        prevTwo = prevOne;
        prevOne = current;
    }

    return prevOne;
}

int main(){
    vector<int> nums = {1,2,3,1};
    cout << rob(nums);
    return 0;
}
