import * as vscode from "vscode";
import { TracerService } from "./service";
import { realDeps } from "./dockerRunner";
import { SidebarProvider } from "./sidebar";
import { VisualizerPanel } from "./panel";

let service: TracerService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  service = new TracerService(realDeps());
  const svc = service;
  const sidebar = new SidebarProvider(context.extensionUri, svc);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar),

    vscode.commands.registerCommand("cpp-tutor.start", async () => {
      await svc.start();
      // Starting is only ever a means to seeing the visualizer, so open it
      // as soon as the backend is actually answering.
      const st = svc.state;
      if (st.name === "ready") {
        VisualizerPanel.show(context.extensionUri, st.port);
        void svc.watchHealth();
      }
    }),

    vscode.commands.registerCommand("cpp-tutor.stop", async () => {
      VisualizerPanel.disposeCurrent();
      await svc.stop();
    }),

    vscode.commands.registerCommand("cpp-tutor.open", () => {
      const st = svc.state;
      if (st.name !== "ready") {
        vscode.window.showWarningMessage("cpp-tutor: start the service first.");
        return;
      }
      VisualizerPanel.show(context.extensionUri, st.port);
    }),
  );

  // A container left by a crashed window would otherwise take the name and
  // leave the sidebar claiming "stopped" while the backend is up.
  void svc.adopt().then(() => svc.watchHealth());
}

export function deactivate(): Thenable<void> | undefined {
  return service?.stop();
}
