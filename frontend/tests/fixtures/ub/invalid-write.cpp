int main() {
    int* a = new int[3];
    a[0] = 1;
    a[7] = 99;
    delete[] a;
    return 0;
}
