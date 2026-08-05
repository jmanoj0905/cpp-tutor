#include <iostream>
#include <vector>
#include <stack>
#include <climits>
#include <utility>
using namespace std;

void dfs(int node, vector<vector<pair<int, int>>> &adj, vector<bool> &visited, stack<int> &st){
    if (visited[node]) {
        return;
    }
    visited[node] = true;
    for (auto edge : adj[node]) {
        int neighbour = edge.first;
        if (!visited[neighbour]) {
            dfs(neighbour, adj, visited, st);
        }
    }
    st.push(node);
}

vector<int> shortestPath(int N, vector<vector<int>> &edges){
    vector<vector<pair<int, int>>> adj(N);
    for (auto edge : edges) {
        int u = edge[0];
        int v = edge[1];
        int weight = edge[2];
        adj[u].push_back({v, weight});
    }

    vector<bool> visited(N, false);
    stack<int> st;

    //NOTE: Step 1 : Topo sort
    for (int i = 0; i < N; i++) {
        if (!visited[i]) {
            dfs(0, adj, visited, st);
        }
    }

    //NOTE: Step 2 : Dist array
    vector<int> dist(N, INT_MAX);
    dist[0] = 0;

    //NOTE: Step 3 : process topological order
    while (!st.empty()) {
        int curr = st.top();
        st.pop();

        //if curr cannot be reached from source, dont process it
        if (dist[curr] == INT_MAX) {
            continue;
        }

        for (auto edge : adj[curr]) {
            int neighbour = edge.first;
            int weight = edge.second;

            if (dist[curr] + weight < dist[neighbour]) {
                dist[neighbour] = dist[curr] + weight;
            }
        }
    }

    //NOTE: Step 4 : Unreachable nodes become -1
    for (int i = 0; i < N; i++) {
        if (dist[i] == INT_MAX) {
            dist[i] = -1;
        }
    }
    return dist;
}

int main() {
    int N = 6;
    vector<vector<int>> edges = {
        {0, 1, 2},
        {0, 4, 1},
        {4, 5, 4},
        {4, 2, 2},
        {1, 2, 3},
        {2, 3, 6},
        {5, 3, 1}
    };
    vector<int> dist = shortestPath(N, edges);
    cout << "Shortest distances from 0:\n";

    for (int i = 0; i < N; i++) {
        cout << "0 -> " << i
             << " = " << dist[i] << "\n";
    }

    return 0;
}
