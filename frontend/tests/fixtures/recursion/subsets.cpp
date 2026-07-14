#include <vector>
using namespace std;
vector<int> nums = {1, 2, 3};
vector<int> cur;
int total = 0;
void solve(int i) {
  if (i == 3) { total++; return; }
  solve(i + 1);
  cur.push_back(nums[i]);
  solve(i + 1);
  cur.pop_back();
}
int main() {
  solve(0);
  return total;
}
