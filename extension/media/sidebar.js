const vscode = acquireVsCodeApi();

const el = (id) => document.getElementById(id);

/**
 * The two channels (service state, image cache) arrive independently, so each
 * is remembered: whichever moves, the first-run warning re-renders from both.
 * `imageCached` is null until probed.
 */
let imageCached = null;
let currentState = { name: "stopped" };

function pullLabel(layers) {
  // A non-TTY `docker pull` reports no bytes, so layers are the only progress
  // there is; before docker has named any, say nothing rather than "0 of 0".
  if (!layers || !layers.total) return "Downloading image…";
  return `Downloading image… (${layers.done} of ${layers.total} layers)`;
}

function render(state) {
  currentState = state;
  const dot = { stopped: "", pulling: "busy", starting: "busy", ready: "ready", error: "error" }[state.name];
  el("dot").className = "dot " + dot;
  el("label").textContent = {
    stopped: "Service stopped",
    pulling: pullLabel(state.layers),
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
  renderFirstRun(state);
}

/**
 * The download warning is worth screen space exactly while the download is
 * still ahead of the user, or happening: known-absent image, or an in-flight
 * pull. Once the image is cached it is noise.
 */
function renderFirstRun(state) {
  el("firstrun").hidden = !(state.name === "pulling" || imageCached === false);
}

function renderDocker(problem) {
  // problem: null = still probing, "" = fine, anything else = broken.
  const probing = problem === null;
  const ok = problem === "";
  el("docker").hidden = probing || ok;
  el("docker-msg").textContent = probing || ok ? "" : problem;
  el("docker-dot").className = "dot " + (probing ? "" : ok ? "ready" : "error");
  el("docker-state").textContent = probing
    ? "Checking Docker…"
    : ok
      ? "Docker ready"
      : "Docker unavailable";
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
  if (e.data.type === "image") {
    imageCached = e.data.present;
    renderFirstRun(currentState);
  }
});

vscode.postMessage({ type: "ready" });
