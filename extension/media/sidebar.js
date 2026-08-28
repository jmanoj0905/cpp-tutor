const vscode = acquireVsCodeApi();

function render(state) {
  const el = (id) => document.getElementById(id);
  const dot = { stopped: "", pulling: "busy", starting: "busy", ready: "ready", error: "error" }[state.name];
  el("dot").className = "dot " + dot;
  el("label").textContent = {
    stopped: "Service stopped",
    pulling: "Downloading image…",
    starting: "Starting…",
    ready: "Running on port " + state.port,
    error: "Failed",
  }[state.name];

  const primary = el("primary");
  primary.textContent = {
    stopped: "Start service", pulling: "Cancel", starting: "Cancel",
    ready: "Stop service", error: "Retry",
  }[state.name];
  primary.dataset.action = {
    stopped: "start", pulling: "cancel", starting: "cancel",
    ready: "stop", error: "start",
  }[state.name];

  el("open").hidden = state.name !== "ready";
  el("detail").textContent = state.progress || state.message || "";
}

document.getElementById("primary").addEventListener("click", (e) => {
  vscode.postMessage({ type: e.currentTarget.dataset.action });
});
document.getElementById("open").addEventListener("click", () => {
  vscode.postMessage({ type: "open" });
});
window.addEventListener("message", (e) => {
  if (e.data.type === "state") render(e.data.state);
});
vscode.postMessage({ type: "ready" });
