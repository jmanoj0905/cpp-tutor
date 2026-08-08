// Right-skewed then left-skewed chains: every node has exactly one child, so
// the rendered layout must lean right and then left (slot-aware placement).
struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode(int v) : val(v), left(nullptr), right(nullptr) {}
};

int depth(TreeNode* root) {
    if (!root) return 0;
    int l = depth(root->left);
    int r = depth(root->right);
    return 1 + (l > r ? l : r);
}

int main() {
    TreeNode* right = new TreeNode(1);
    right->right = new TreeNode(2);
    right->right->right = new TreeNode(3);

    TreeNode* left = new TreeNode(9);
    left->left = new TreeNode(8);
    left->left->left = new TreeNode(7);

    int a = depth(right);
    int b = depth(left);
    return a + b;
}
