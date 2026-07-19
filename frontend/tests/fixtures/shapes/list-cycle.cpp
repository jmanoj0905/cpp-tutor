// 1->2->3->4 with tail looping back to node 2; Floyd slow/fast until they meet.
struct ListNode {
    int val;
    ListNode* next;
    ListNode(int v) : val(v), next(nullptr) {}
};

int main() {
    ListNode* head = new ListNode(1);
    head->next = new ListNode(2);
    head->next->next = new ListNode(3);
    head->next->next->next = new ListNode(4);
    head->next->next->next->next = head->next;  // cycle back to 2

    ListNode* slow = head;
    ListNode* fast = head;
    do {
        slow = slow->next;
        fast = fast->next->next;
    } while (slow != fast);
    return 0;
}
