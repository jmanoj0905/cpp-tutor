import * as vscode from "vscode";
import type { TracerService, ServiceState } from "./service";
import { makeNonce } from "./nonce";

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "cppTutor.sidebar";

  private view?: vscode.WebviewView;
  /**
   * Last Docker verdict ("" = healthy). Kept here because activation probes
   * Docker before the user has ever opened the view: without a cached value
   * the warning would be posted into the void and the freshly-resolved
   * webview would show nothing.
   */
  private dockerProblem = "";

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

  /** `problem` is "" when Docker is usable; anything else is shown as a warning. */
  postDocker(problem: string): void {
    this.dockerProblem = problem;
    this.view?.webview.postMessage({ type: "docker", problem });
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
<div id="docker" class="warn" hidden>
  <div id="docker-msg"></div>
  <button id="recheck" class="secondary small">Recheck Docker</button>
</div>
<button id="primary" data-action="start">Start service</button>
<div class="row">
  <button id="open" class="secondary" title="Open the visualizer in VSCode's Simple Browser">In VSCode</button>
  <button id="open-external" class="secondary" title="Open the visualizer in your default browser">In browser</button>
</div>
<button id="visualize" class="secondary">Visualize current file</button>
<div id="detail" class="detail"></div>
<script nonce="${nonce}" src="${asset("sidebar.js")}"></script>
</body>
</html>`;
  }
}
