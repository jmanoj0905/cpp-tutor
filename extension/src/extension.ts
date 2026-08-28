import * as vscode from "vscode";
import { SidebarProvider } from "./sidebar";

export function activate(context: vscode.ExtensionContext): void {
  const sidebar = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar),
  );
}

export function deactivate(): void {}
