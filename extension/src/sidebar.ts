import * as vscode from "vscode";
import { IMAGE_DISK_GB, IMAGE_DOWNLOAD_MB, type TracerService, type ServiceState } from "./service";
import { makeNonce } from "./nonce";

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "cppTutor.sidebar";

  private view?: vscode.WebviewView;
  /**
   * Last Docker verdict: "" = healthy, undefined = not probed yet. Kept here
   * because activation probes Docker before the user has ever opened the view:
   * without a cached value the verdict would be posted into the void and the
   * freshly-resolved webview would show nothing. The undefined case matters
   * now that the status is always on screen — "Checking Docker…" is honest
   * where a premature "Docker ready" would not be.
   */
  private dockerProblem: string | undefined;
  /**
   * Whether the tracer image is already in the local cache; undefined until
   * probed. Drives the first-run download warning: the pull is several hundred
   * megabytes and the user deserves to know that before clicking Start, not
   * while staring at a progress line that looks stuck.
   */
  private imageCached: boolean | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: TracerService,
  ) {
    this.service.onDidChangeState((s) => this.post(s));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string }) => {
      switch (msg.type) {
        case "ready":
          this.post(this.service.state);
          this.postDocker(this.dockerProblem);
          this.postImage(this.imageCached);
          break;
        case "start": vscode.commands.executeCommand("cpp-tutor.start"); break;
        case "stop": vscode.commands.executeCommand("cpp-tutor.stop"); break;
        case "open": vscode.commands.executeCommand("cpp-tutor.open"); break;
        case "openExternal": vscode.commands.executeCommand("cpp-tutor.openExternal"); break;
        case "visualizeFile": vscode.commands.executeCommand("cpp-tutor.visualizeCurrentFile"); break;
        case "checkDocker": vscode.commands.executeCommand("cpp-tutor.checkDocker"); break;
        case "cancel": this.service.cancel(); break;
      }
    });
  }

  post(state: ServiceState): void {
    this.view?.webview.postMessage({ type: "state", state });
  }

  /**
   * `problem` is "" when Docker is usable, a message when it is not, and
   * undefined while the probe is still out.
   */
  postDocker(problem: string | undefined): void {
    this.dockerProblem = problem;
    this.view?.webview.postMessage({ type: "docker", problem: problem ?? null });
  }

  /** `present` is undefined until the image cache has been probed. */
  postImage(present: boolean | undefined): void {
    this.imageCached = present;
    this.view?.webview.postMessage({ type: "image", present: present ?? null });
  }

  private html(webview: vscode.Webview): string {
    const asset = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", name));
    const nonce = makeNonce();
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset("sidebar.css")}">
</head>
<body>
<div class="status"><span id="dot" class="dot"></span><span id="label">Service stopped</span></div>
<div id="docker" class="warn" hidden><div id="docker-msg"></div></div>
<div id="firstrun" class="note" hidden>
  <b>First run downloads the tracer image</b> — about ${IMAGE_DOWNLOAD_MB} MB over the
  network, ${IMAGE_DISK_GB} GB on disk, and several minutes on a slow link. It carries a
  patched Valgrind. Downloaded once: later starts take seconds.
</div>
<button id="primary" data-action="start">Start service</button>
<div class="row">
  <button id="open" class="secondary" title="Open the visualizer in VSCode's Simple Browser">In VSCode</button>
  <button id="open-external" class="secondary" title="Open the visualizer in your default browser">In browser</button>
</div>
<button id="visualize" class="secondary">Visualize current file</button>
<div id="detail" class="detail"></div>
<div class="footer">
  <span id="docker-dot" class="dot"></span><span id="docker-state">Checking Docker…</span>
  <button id="recheck" class="link">Recheck</button>
</div>
<script nonce="${nonce}" src="${asset("sidebar.js")}"></script>
</body>
</html>`;
  }
}
