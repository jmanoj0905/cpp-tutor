import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SidebarProvider } from "../src/sidebar";
import { TracerService, IMAGE_DOWNLOAD_MB } from "../src/service";
import type { RunResult } from "../src/service";

const noDocker = {
  async run(): Promise<RunResult> { return { code: 0, stdout: "", stderr: "" }; },
  spawn() { return { done: Promise.resolve(0), kill() {} }; },
};

function make() {
  const svc = new TracerService({
    docker: noDocker,
    findFreePort: async () => 1234,
    probeHealth: async () => true,
    sleep: async () => {},
    now: () => 0,
  });
  const posted: Array<Record<string, unknown>> = [];
  const handlers: Array<(m: { type: string }) => void> = [];
  const view = {
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-resource:",
      asWebviewUri: (u: unknown) => u,
      postMessage: (m: Record<string, unknown>) => { posted.push(m); return Promise.resolve(true); },
      onDidReceiveMessage: (cb: (m: { type: string }) => void) => { handlers.push(cb); },
    },
  };
  const sidebar = new SidebarProvider({} as never, svc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sidebar.resolveWebviewView(view as any);
  return { sidebar, view, posted, send: (type: string) => handlers.forEach((h) => h({ type })) };
}

describe("SidebarProvider", () => {
  it("quotes the download size in the first-run note", () => {
    const { view } = make();
    expect(view.webview.html).toContain(`${IMAGE_DOWNLOAD_MB} MB`);
    expect(view.webview.html).toContain('id="firstrun"');
  });

  it("keeps the Docker status and its recheck button outside the failure-only banner", () => {
    const { view } = make();
    const html = view.webview.html;
    // The banner is what hides when Docker is fine; the recheck button and the
    // status line must not be inside it, or a healthy Docker leaves the user
    // with no verdict and no way to re-probe.
    const banner = /<div id="docker" class="warn" hidden>([\s\S]*?)<\/div>\s*<div/.exec(html)?.[1] ?? "";
    expect(banner).not.toContain('id="recheck"');
    expect(html).toContain('id="docker-state"');
    expect(html).toContain('id="recheck"');
  });

  it("reports an unprobed Docker as null, distinct from a healthy empty string", () => {
    const { sidebar, posted } = make();
    sidebar.postDocker(undefined);
    sidebar.postDocker("");
    expect(posted.map((m) => m.problem)).toEqual([null, ""]);
  });

  it("replays state, Docker and image verdicts when the webview reports ready", () => {
    const { sidebar, posted, send } = make();
    // Both verdicts land before the view exists in practice (activation probes
    // Docker immediately), so the replay is the only thing that puts them on
    // screen.
    sidebar.postDocker("");
    sidebar.postImage(false);
    posted.length = 0;

    send("ready");
    expect(posted.map((m) => m.type)).toEqual(["state", "docker", "image"]);
    expect(posted[2]).toEqual({ type: "image", present: false });
  });

  it("only queries element ids the HTML actually defines", () => {
    const { view } = make();
    const ids = new Set([...view.webview.html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
    // cwd-relative: vitest runs from the extension package root, and the
    // tsconfig emits CommonJS, where import.meta is off limits.
    const js = readFileSync("media/sidebar.js", "utf8");
    const queried = [...js.matchAll(/el\("([\w-]+)"\)/g)].map((m) => m[1]);
    expect(queried.length).toBeGreaterThan(0);
    for (const id of queried) expect({ id, known: ids.has(id) }).toEqual({ id, known: true });
  });
});
