import * as vscode from "vscode";
import { TracerService, type ServiceState } from "./service";
import { realDeps } from "./dockerRunner";
import { SidebarProvider } from "./sidebar";
import { sourceFrom, visualizerUrl, type Handoff } from "./handoff";

let service: TracerService | undefined;

/** Where "open the visualizer" sends the user. Remembered per window. */
export type OpenTarget = "integrated" | "external";
const TARGET_KEY = "cpp-tutor.openTarget";

export function activate(context: vscode.ExtensionContext): void {
  service = new TracerService(realDeps());
  const svc = service;
  const sidebar = new SidebarProvider(context.extensionUri, svc);

  const lastTarget = (): OpenTarget =>
    context.globalState.get<OpenTarget>(TARGET_KEY) ?? "integrated";

  /**
   * The container serves the frontend itself (same-origin /api), so both
   * targets are just a URL. The Simple Browser is a built-in extension, but
   * it can be disabled in a given install — fall back to the real browser
   * rather than failing the click.
   */
  async function openVisualizer(
    target: OpenTarget,
    port: number,
    handoff?: Handoff,
  ): Promise<void> {
    await context.globalState.update(TARGET_KEY, target);
    const url = visualizerUrl(port, handoff);
    if (target === "external") {
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    try {
      await vscode.commands.executeCommand("simpleBrowser.show", url);
    } catch {
      vscode.window.showWarningMessage(
        "cpp-tutor: VSCode's Simple Browser is unavailable; opening your default browser instead.",
      );
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  /**
   * Returns the ready port, starting the service first if it isn't up. Every
   * user-facing entry point goes through this so "Open" and "Visualize
   * current file" work from a cold sidebar instead of scolding the user for
   * not pressing Start first.
   */
  const readState = (): ServiceState => svc.state;

  async function ensureReady(): Promise<number | undefined> {
    if (svc.state.name === "ready") return svc.state.port;

    const problem = await svc.dockerProblem();
    if (problem) {
      sidebar.postDocker(problem);
      vscode.window.showErrorMessage(`cpp-tutor: ${problem}`);
      return undefined;
    }
    sidebar.postDocker("");

    await svc.start();
    // Read through a call, not `svc.state` directly: the `ready` check at the
    // top of this function narrows the getter for the rest of the body and TS
    // does not re-widen it across the await, even though start() is exactly
    // what changes the state.
    const st = readState();
    if (st.name !== "ready") {
      if (st.name === "error") vscode.window.showErrorMessage(`cpp-tutor: ${st.message}`);
      return undefined;
    }
    void svc.watchHealth();
    return st.port;
  }

  async function openWithSource(target: OpenTarget, run: boolean): Promise<void> {
    const src = sourceFrom(vscode.window.activeTextEditor?.document);
    if (!src.ok) {
      vscode.window.showWarningMessage(`cpp-tutor: ${src.message}`);
      return;
    }
    const port = await ensureReady();
    if (port === undefined) return;
    try {
      await openVisualizer(target, port, { code: src.code, run });
    } catch (err) {
      // visualizerUrl throws on an oversized file; the message is already
      // written for a human.
      vscode.window.showWarningMessage(err instanceof Error ? err.message : String(err));
    }
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar),

    vscode.commands.registerCommand("cpp-tutor.start", async () => {
      // Starting is only ever a means to seeing the visualizer, so open it as
      // soon as the backend answers. An already-ready service just re-opens,
      // rather than tearing down a healthy container and racing a fresh boot
      // against the watch loop still watching the old one.
      const port = await ensureReady();
      if (port !== undefined) await openVisualizer(lastTarget(), port);
    }),

    vscode.commands.registerCommand("cpp-tutor.stop", async () => {
      await svc.stop();
    }),

    vscode.commands.registerCommand("cpp-tutor.open", async () => {
      const port = await ensureReady();
      if (port !== undefined) await openVisualizer("integrated", port);
    }),

    vscode.commands.registerCommand("cpp-tutor.openExternal", async () => {
      const port = await ensureReady();
      if (port !== undefined) await openVisualizer("external", port);
    }),

    vscode.commands.registerCommand("cpp-tutor.visualizeCurrentFile", () =>
      openWithSource(lastTarget(), true),
    ),

    vscode.commands.registerCommand("cpp-tutor.loadCurrentFile", () =>
      openWithSource(lastTarget(), false),
    ),

    vscode.commands.registerCommand("cpp-tutor.checkDocker", async () => {
      const problem = await svc.dockerProblem();
      sidebar.postDocker(problem);
      if (problem) vscode.window.showWarningMessage(`cpp-tutor: ${problem}`);
    }),
  );

  // A container left by a crashed window would otherwise take the name and
  // leave the sidebar claiming "stopped" while the backend is up.
  void svc.adopt().then(() => svc.watchHealth());
  // Docker being down is the single most common reason nothing works, so say
  // so in the sidebar at activation instead of waiting for a failed Start.
  void svc.dockerProblem().then((p) => sidebar.postDocker(p));
}

export function deactivate(): Thenable<void> | undefined {
  // The backend container is shared by every VSCode window (one container
  // name, `docker rm -f` on stop). Every window activates on
  // onStartupFinished and adopts it, so unconditionally stopping here would
  // let closing any one window destroy the backend the others are actively
  // using. Only tear it down if this window's own start() is the one that
  // created it; an adopted container is left for its owner.
  if (!service?.owned) return undefined;
  return service.stop();
}
