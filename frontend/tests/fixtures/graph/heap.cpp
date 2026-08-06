#include <queue>
#include <vector>
using namespace std;

int main() {
    priority_queue<int> pq;
    int a[] = {5, 3, 8, 1, 9, 2, 7};
    for (int x : a) pq.push(x);      // heap grows to 7 elements, reordering
    vector<int> out;
    while (!pq.empty()) {            // drains largest-first
        out.push_back(pq.top());
        pq.pop();
    }
    return 0;
}
