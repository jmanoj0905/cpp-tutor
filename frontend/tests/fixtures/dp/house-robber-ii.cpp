#include <iostream>
#include <vector>
using namespace std;

int robLinear(vector<int> &nums, int start, int end){
    int prev2 = 0;
    int prev1 = 0;

    for (int i = start; i <= end; i++) {
        int current = max(nums[i] + prev2, prev1);

        prev2 = prev1;
        prev1 = current;
    }
    return prev1;
}

int rob(vector<int> &nums){
    int n = nums.size();

    if (n == 1) {
        return nums[0];
    }

    int moneyWithFirstHouse = robLinear(nums, 0, n-2);
    int moneyWithoutFirstHouse = robLinear(nums, 1, n-1);
    return max(moneyWithFirstHouse, moneyWithoutFirstHouse);
}

int main(){
    vector<int> nums = {1, 2, 3};
    cout << rob(nums);
    return 0;
}

