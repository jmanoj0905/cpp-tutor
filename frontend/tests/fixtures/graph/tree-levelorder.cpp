#include <iostream>
#include <vector>
#include <queue>

using namespace std;

struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};

vector<vector<int>> levelOrder(TreeNode* root) {
    if (root == nullptr) {
        return {};
    }
    queue<TreeNode *> q;
    TreeNode *curr = root;
    vector<vector<int>> res;

    q.push(curr);

    while (!q.empty()) {
        vector<int> levels;
        int size = q.size();
        for (int i = 0; i < size; i++) {
            TreeNode *temp = q.front();
            q.pop();
            levels.push_back(temp -> val);
            if(temp -> left != nullptr) q.push(temp -> left);
            if(temp -> right != nullptr) q.push(temp -> right);
        }
        res.push_back(levels);
    }
    return res;
}

TreeNode* buildTree(const vector<int>& nodes) {
    if (nodes.empty() || nodes[0] == -1) return nullptr;

    TreeNode* root = new TreeNode(nodes[0]);
    queue<TreeNode*> q;
    q.push(root);

    int i = 1;
    while (!q.empty() && i < nodes.size()) {
        TreeNode* curr = q.front();
        q.pop();

        if (nodes[i] != -1) {
            curr->left = new TreeNode(nodes[i]);
            q.push(curr->left);
        }
        i++;

        if (i < nodes.size() && nodes[i] != -1) {
            curr->right = new TreeNode(nodes[i]);
            q.push(curr->right);
        }
        i++;
    }
    return root;
}

int main() {
    // Build the tree here. Input: root = [1,2,3,4,5,6,7]
    vector<int> input = {1, 2, 3, 4, 5, 6, 7};
    TreeNode* root = buildTree(input);

    vector<vector<int>> result = levelOrder(root);

    cout << "[" << endl;
    for (size_t i = 0; i < result.size(); i++) {
        cout << "  [";
        for (size_t j = 0; j < result[i].size(); j++) {
            cout << result[i][j];
            if (j < result[i].size() - 1) cout << ", ";
        }
        cout << "]";
        if (i < result.size() - 1) cout << ",";
        cout << endl;
    }
    cout << "]" << endl;

    return 0;
}
