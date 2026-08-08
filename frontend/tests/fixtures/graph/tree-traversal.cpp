#include <iostream>
#include <vector>
#include <stack>
#include <queue>
using namespace std;

// Definition for a binary tree node
struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
};

vector<int> preorderTraversal(TreeNode *root) {
    if (!root) {
        return {};
    }
    vector<int> res;
    stack<TreeNode *> st;
    st.push(root);
    while (!st.empty()) {
        TreeNode* curr = st.top();
        st.pop();
        res.push_back(curr -> val);
        if (curr -> right) {
            st.push(curr -> right);
        }
        if (curr -> left) {
            st.push(curr -> left);
        }
    }
    return res;
}

vector<int> inorderTraversal(TreeNode *root){
    vector<int> res;
    stack<TreeNode *> st;
    TreeNode *curr = root;
    while (curr || !st.empty()) {
        while (curr) {
            st.push(curr);
            curr = curr -> left;
        }
        curr = st.top();
        st.pop();
        res.push_back(curr -> val);
        curr = curr -> right;
    }
    return res;
}

vector<int> levelOrder(TreeNode *root){
    if (!root) {
        return {};
    }
    vector<int> res;
    queue<TreeNode*> qu;
    qu.push(root);
    while (!qu.empty()) {
        TreeNode *curr = qu.front();
        qu.pop();
        res.push_back(curr -> val);
        if (curr -> left) {
            qu.push(curr -> left);
        }
        if (curr -> right) {
            qu.push(curr -> right);
        }
    }
    return res;
}

int main() {
    /*
     * Sample Tree Structure:
     *        1
     *       / \
     *      2   3
     *     / \
     *    4   5
     * 
     * Expected Output once completed: 1 2 4 5 3
     */

    TreeNode *root = new TreeNode(1);
    root->left = new TreeNode(2);
    root->right = new TreeNode(3);
    root->left->left = new TreeNode(4);
    root->left->right = new TreeNode(5);

    // Run traversal
    vector<int> result = levelOrder(root);

    // Print output
    cout << "Preorder Traversal: ";
    for (int val : result) {
        cout << val << " ";
    }
    cout << endl;

    // Clean up memory
    delete root->left->left;
    delete root->left->right;
    delete root->left;
    delete root->right;
    delete root;

    return 0;
}
