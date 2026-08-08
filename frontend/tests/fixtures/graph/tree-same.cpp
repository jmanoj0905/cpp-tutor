#include <iostream>
#include <vector>
#include <queue>
#include <stack>
#include <climits>

using namespace std;

// Definition for a binary tree node.
struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};

class Solution {
public:
    bool isSameTree(TreeNode *p, TreeNode *q){
        if (!p && !q) {
            return true;
        }
        if (p && q && p -> val == q -> val) {
            return (isSameTree(p -> left, q -> left) && isSameTree(p -> right, q -> right));
        }
        return false;
    }
    bool isSameTreeIterative(TreeNode* p, TreeNode* q) {
        TreeNode *pc = p, *qc = q;
        stack<TreeNode*> pStack, qStack;
        while (true) {
            if (pc != nullptr && qc != nullptr) {
                pStack.push(pc);
                qStack.push(qc);

                pc = pc -> left;
                qc = qc -> left;
            }
            else {
                if (pc == nullptr && qc != nullptr) return false;
                if (pc != nullptr && qc == nullptr) return false;

                if (qStack.empty() || pStack.empty()) {
                    break;
                }
                pc = pStack.top();
                qc = qStack.top();

                pStack.pop();
                qStack.pop();

                if(pc -> val != qc -> val){
                    return false;
                }

                pc = pc -> right;
                qc = qc -> right;
            }
        }
        return true;
    }
};

TreeNode* buildTree(const vector<int>& nodes) {
    if (nodes.empty() || nodes[0] == INT_MIN) return nullptr;

    TreeNode* root = new TreeNode(nodes[0]);
    queue<TreeNode*> q;
    q.push(root);

    int i = 1;
    while (!q.empty() && i < nodes.size()) {
        TreeNode* curr = q.front();
        q.pop();

        // Process left child
        if (nodes[i] != INT_MIN) {
            curr->left = new TreeNode(nodes[i]);
            q.push(curr->left);
        }
        i++;

        // Process right child
        if (i < nodes.size() && nodes[i] != INT_MIN) {
            curr->right = new TreeNode(nodes[i]);
            q.push(curr->right);
        }
        i++;
    }
    return root;
}

int main() {
    // Testcase: p = [4,7], q = [4,null,7]
    // INT_MIN represents 'null'
    vector<int> p_nodes = {4, 5,3,7,4, INT_MIN};
    vector<int> q_nodes = {4, 5,3,7,4, INT_MIN};

    TreeNode* p = buildTree(p_nodes);
    TreeNode* q = buildTree(q_nodes);

    Solution solution;
    bool result = solution.isSameTreeIterative(p, q);

    cout << "Are the trees the same? " << (result ? "True" : "False") << endl;

    return 0;
}
