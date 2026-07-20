#include <cstdio>
int main() {
  int a[6];
  for (int i = 0; i < 6; i++) {
    a[i] = i * 2;
  }
  printf("%d\n", a[5]);
  return 0;
}
