import * as vscode from "vscode";

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "cppTutor.sidebar";

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string }) => {
      if (msg.type === "ready") {
        this.post({ name: "stopped" });
        return;
      }
      vscode.window.showInformationMessage(`cpp-tutor: ${msg.type} (not wired yet)`);
    });
  }

  post(state: unknown): void {
    this.view?.webview.postMessage({ type: "state", state });
  }

  private html(webview: vscode.Webview): string {
    const asset = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", name));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset("sidebar.css")}">
</head>
<body>
<div class="status"><span id="dot" class="dot"></span><span id="label">Service stopped</span></div>
<button id="primary" data-action="start">Start service</button>
<button id="open" class="secondary" hidden>Open visualizer</button>
<div id="detail" class="detail"></div>
<script nonce="${nonce}" src="${asset("sidebar.js")}"></script>
</body>
</html>`;
  }
}
