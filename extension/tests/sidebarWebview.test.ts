import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/**
 * media/sidebar.js is the one piece of this extension the user actually looks
 * at, and it runs in a webview no unit test can reach. Rather than pull in a
 * DOM library, execute it against a shim that models exactly what the script
 * uses — getElementById, textContent/className/hidden/disabled, and the
 * message event — so a typo'd id or a crash in a render path fails here.
 */
function harness() {
  const html = readFileSync("media/sidebar.js", "utf8");
  const ids = [
    "dot", "label", "primary", "open", "open-external", "visualize",
    "detail", "firstrun", "docker", "docker-msg", "docker-dot", "docker-state", "recheck",
  ];
  const els: Record<string, Record<string, unknown>> = {};
  for (const id of ids) els[id] = { textContent: "", className: "", hidden: false, disabled: false, dataset: {}, addEventListener() {} };

  let onMessage: ((e: { data: unknown }) => void) | undefined;
  const posted: Array<{ type: string }> = [];
  const ctx = {
    acquireVsCodeApi: () => ({ postMessage: (m: { type: string }) => posted.push(m) }),
    document: {
      getElementById: (id: string) => els[id] ?? null,
    },
    window: {
      addEventListener: (_: string, cb: (e: { data: unknown }) => void) => { onMessage = cb; },
    },
  };
  runInNewContext(html, ctx);
  return {
    els,
    posted,
    send: (data: unknown) => onMessage!({ data }),
  };
}

describe("sidebar webview script", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  it("announces itself ready so the provider replays cached verdicts", () => {
    expect(h.posted).toEqual([{ type: "ready" }]);
  });

  it("shows the pull as a layer count once docker has named layers", () => {
    h.send({ type: "state", state: { name: "pulling", progress: "abc: Extracting", layers: { done: 7, total: 28 } } });
    expect(h.els.label.textContent).toBe("Downloading image… (7 of 28 layers)");
    expect(h.els.detail.textContent).toBe("abc: Extracting");
  });

  it("does not say '0 of 0 layers' before docker has named any", () => {
    h.send({ type: "state", state: { name: "pulling", progress: "", layers: { done: 0, total: 0 } } });
    expect(h.els.label.textContent).toBe("Downloading image…");
  });

  it("shows the first-run note while pulling, and whenever the image is known absent", () => {
    h.send({ type: "state", state: { name: "stopped" } });
    expect(h.els.firstrun.hidden).toBe(true); // image not probed yet: say nothing

    h.send({ type: "image", present: false });
    expect(h.els.firstrun.hidden).toBe(false);

    h.send({ type: "image", present: true });
    expect(h.els.firstrun.hidden).toBe(true);

    h.send({ type: "state", state: { name: "pulling", progress: "", layers: { done: 0, total: 3 } } });
    expect(h.els.firstrun.hidden).toBe(false); // a pull in flight explains itself
  });

  it("reports Docker as unprobed, healthy and broken as three distinct states", () => {
    h.send({ type: "docker", problem: null });
    expect(h.els["docker-state"].textContent).toBe("Checking Docker…");
    expect(h.els["docker-dot"].className).toBe("dot ");
    expect(h.els.docker.hidden).toBe(true);

    h.send({ type: "docker", problem: "" });
    expect(h.els["docker-state"].textContent).toBe("Docker ready");
    expect(h.els["docker-dot"].className).toBe("dot ready");
    expect(h.els.docker.hidden).toBe(true); // healthy: status only, no banner

    h.send({ type: "docker", problem: "Docker is installed but not running. Start it and retry." });
    expect(h.els["docker-state"].textContent).toBe("Docker unavailable");
    expect(h.els["docker-dot"].className).toBe("dot error");
    expect(h.els.docker.hidden).toBe(false);
    expect(h.els["docker-msg"].textContent).toContain("not running");
  });

  it("keeps the open/visualize buttons live except during a boot", () => {
    h.send({ type: "state", state: { name: "stopped" } });
    expect(h.els.visualize.disabled).toBe(false);
    h.send({ type: "state", state: { name: "starting" } });
    expect(h.els.visualize.disabled).toBe(true);
    h.send({ type: "state", state: { name: "ready", port: 5555 } });
    expect(h.els.visualize.disabled).toBe(false);
    expect(h.els.label.textContent).toBe("Running on port 5555");
  });
});
