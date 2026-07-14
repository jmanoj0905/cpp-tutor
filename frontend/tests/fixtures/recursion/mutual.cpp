bool isOdd(int n);
bool isEven(int n) {
  if (n == 0) return true;
  return isOdd(n - 1);
}
bool isOdd(int n) {
  if (n == 0) return false;
  return isEven(n - 1);
}
int main() {
  return isEven(3) ? 1 : 0;
}
