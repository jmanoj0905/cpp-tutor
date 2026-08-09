#include <iostream>
#include <unordered_map>
using namespace std;
unordered_map<int,int> memo;
int fib(int n){
    if (n <= 1) return n;
    if (memo.count(n)) return memo[n];
    memo[n] = fib(n-1) + fib(n-2);
    return memo[n];
}
int main(){ cout << fib(4); }
