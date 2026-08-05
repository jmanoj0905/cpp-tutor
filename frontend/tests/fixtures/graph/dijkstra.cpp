#include <iostream>
#include <vector>
#include <queue>
#include <climits>
#include <utility>
#include <functional>
using namespace std;

vector<int> dijkstra(int V, vector<vector<int>> &adj, int src) {

    //dist[i] = shortest distance currently known
    //from source src to node i
    vector<int> dist(V, INT_MAX);

    //source to itself costs 0
    dist[src] = 0;

    //min heap : {distance, node}
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<pair<int, int>>> minHeap;

    //start from source
    minHeap.push({0, src});

    while (!minHeap.empty()) {
        int currDist = minHeap.top().first;
        int curr = minHeap.top().second;
        minHeap.pop();

        //Ignore an old/outdated entry
        if (currDist > dist[curr]) {
            continue;
        }

        //adjacency matrix : scan the entire row of curr
        for (int neighbour = 0; neighbour < V; neighbour++) {
            if (adj[curr][neighbour] == 0) {
                continue;
            }

            int weight = adj[curr][neighbour];

            //RELAXATION
            if (dist[curr] + weight < dist[neighbour]) {
                dist[neighbour] = dist[curr] + weight;
                minHeap.push({dist[neighbour], neighbour});
            }
        }
    }
    return dist;
}

int main() {
    int V = 3;
    int S = 2;

    // Weighted adjacency matrix
    vector<vector<int>> adj = {
        // 0  1  2
        {  0, 1, 6 },  // 0
        {  1, 0, 3 },  // 1
        {  6, 3, 0 }   // 2
    };

    vector<int> res = dijkstra(V, adj, S);

    for (int i = 0; i < V; i++) {
        cout << res[i] << " ";
    }

    cout << endl;

    return 0;
}
