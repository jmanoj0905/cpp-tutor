#include <iostream>
#include <vector>
using namespace std;

void dfs(const vector<int> &nums, int i, vector<int> &subset, vector<vector<int>> &res){
    if(i >= nums.size()){
        res.push_back(subset);
        return;
    }

    subset.push_back(nums[i]);
    dfs(nums, i+1, subset, res);

    subset.pop_back();
    dfs(nums, i+1, subset, res);
}

vector<vector<int>> subsets(vector<int> &nums, int index = 0){
    vector<vector<int>> res;
    vector<int> subset;
    dfs(nums, 0, subset, res);
    return res;
}

int main(){
    vector<int> nums = {1,2,3};
    vector<vector<int>> res = subsets(nums);
    for (int i = 0; i < res.size(); i++) {
        for (int j = 0; j < res[i].size(); j++) {
            cout << res[i][j] << "\t";
        }
        cout << "\n";
    }
    return 0;
}
