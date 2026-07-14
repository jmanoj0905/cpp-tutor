int col[4];
int solutions = 0;
bool ok(int r, int c) {
  for (int i = 0; i < r; i++) {
    if (col[i] == c) return false;
    if (r - i == c - col[i] || r - i == col[i] - c) return false;
  }
  return true;
}
void place(int r) {
  if (r == 4) { solutions++; return; }
  for (int c = 0; c < 4; c++) {
    if (ok(r, c)) { col[r] = c; place(r + 1); }
  }
}
int main() {
  place(0);
  return solutions;
}
