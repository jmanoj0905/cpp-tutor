#include <iostream>
#include <unordered_map>
using namespace std;

int main(){
    int v[8] = {1,2,1,3,1,2,3,2};
    unordered_map<int,int> freq;
    for (int i = 0; i < 8; i++) {
        freq[v[i]]++;
    }
    cout << freq[1] << freq[2] << freq[3];
    return 0;
}
