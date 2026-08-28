const vscode = acquireVsCodeApi();

const el = (id) => document.getElementById(id);

function render(state) {
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

  // The open/visualize buttons start the service themselves, so they stay
  // usable from a cold sidebar; only a boot in flight can't take them.
  const busy = state.name === "pulling" || state.name === "starting";
  for (const id of ["open", "open-external", "visualize"]) el(id).disabled = busy;

  el("detail").textContent = state.progress || state.message || "";
}

function renderDocker(problem) {
  el("docker").hidden = !problem;
  el("docker-msg").textContent = problem;
}

el("primary").addEventListener("click", (e) => {
  vscode.postMessage({ type: e.currentTarget.dataset.action });
});
el("open").addEventListener("click", () => vscode.postMessage({ type: "open" }));
el("open-external").addEventListener("click", () => vscode.postMessage({ type: "openExternal" }));
el("visualize").addEventListener("click", () => vscode.postMessage({ type: "visualizeFile" }));
el("recheck").addEventListener("click", () => vscode.postMessage({ type: "checkDocker" }));

window.addEventListener("message", (e) => {
  if (e.data.type === "state") render(e.data.state);
  if (e.data.type === "docker") renderDocker(e.data.problem);
});
vscode.postMessage({ type: "ready" });
