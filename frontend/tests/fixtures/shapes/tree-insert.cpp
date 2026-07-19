// BST insert of 5,3,8,2,4 then invert. Recursion keeps steps interesting.
struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode(int v) : val(v), left(nullptr), right(nullptr) {}
};

TreeNode* insert(TreeNode* root, int v) {
    if (!root) return new TreeNode(v);
    if (v < root->val) root->left = insert(root->left, v);
    else root->right = insert(root->right, v);
    return root;
}

TreeNode* invert(TreeNode* root) {
    if (!root) return root;
    TreeNode* tmp = root->left;
    root->left = invert(root->right);
    root->right = invert(tmp);
    return root;
}

int main() {
    TreeNode* root = nullptr;
    int vals[5] = {5, 3, 8, 2, 4};
    for (int i = 0; i < 5; i++) root = insert(root, vals[i]);
    root = invert(root);
    return 0;
}
