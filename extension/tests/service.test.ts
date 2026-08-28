import { describe, it, expect } from "vitest";
import { TracerService, CONTAINER, IMAGE } from "../src/service";
import type { DockerRunner, RunResult, ServiceState } from "../src/service";

/**
 * Flushes pending microtasks without depending on any global timer (the
 * project's tsconfig has no "dom"/"node" lib, so `setTimeout` isn't typed).
 * Enough ticks to drain the handful of chained awaits (docker.run calls,
 * etc.) a start() takes before reaching its next observable checkpoint.
 */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Records every docker invocation and replies from a scripted table. */
class FakeDocker implements DockerRunner {
  calls: string[][] = [];
  replies: Array<(args: string[]) => RunResult | undefined> = [];
  pullLines: string[] = ["Pulling fs layer", "Download complete"];
  pullExit = 0;
  killed = false;

  async run(args: string[]): Promise<RunResult> {
    this.calls.push(args);
    for (const r of this.replies) {
      const hit = r(args);
      if (hit) return hit;
    }
    return { code: 0, stdout: "", stderr: "" };
  }

  spawn(args: string[], onLine: (line: string) => void) {
    this.calls.push(args);
    for (const l of this.pullLines) onLine(l);
    return { done: Promise.resolve(this.pullExit), kill: () => { this.killed = true; } };
  }

  /** true if some call started with these argv tokens. */
  called(...prefix: string[]): boolean {
    return this.calls.some((c) => prefix.every((p, i) => c[i] === p));
  }
}

function make(overrides: Partial<{ docker: FakeDocker; healthy: boolean; port: number }> = {}) {
  const docker = overrides.docker ?? new FakeDocker();
  const states: ServiceState[] = [];
  let clock = 0;
  const svc = new TracerService({
    docker,
    findFreePort: async () => overrides.port ?? 51234,
    probeHealth: async () => overrides.healthy ?? true,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });
  svc.onDidChangeState((s) => states.push(s));
  return { svc, docker, states };
}

/** Makes `docker image inspect` report the image as absent. */
const imageMissing = (args: string[]) =>
  args[0] === "image" && args[1] === "inspect"
    ? { code: 1, stdout: "", stderr: "No such image" }
    : undefined;

/** Makes `docker inspect <container>` report nothing running. */
const noContainer = (args: string[]) =>
  args[0] === "inspect"
    ? { code: 1, stdout: "", stderr: "No such object" }
    : undefined;

describe("TracerService.start", () => {
  it("goes stopped -> starting -> ready when the image is already present", async () => {
    const { svc, states } = make();
    await svc.start();
    expect(states.map((s) => s.name)).toEqual(["starting", "ready"]);
    expect(svc.state).toEqual({ name: "ready", port: 51234 });
  });

  it("pulls first when the image is absent, reporting progress", async () => {
    const docker = new FakeDocker();
    docker.replies.push(imageMissing);
    const { svc, states } = make({ docker });
    await svc.start();
    expect(states.map((s) => s.name)).toEqual(["pulling", "pulling", "pulling", "starting", "ready"]);
    expect((states[2] as { progress: string }).progress).toBe("Download complete");
    expect(docker.called("pull", IMAGE)).toBe(true);
  });

  it("runs the container detached, on loopback, with the webview CORS regex", async () => {
    const { svc, docker } = make();
    await svc.start();
    const run = docker.calls.find((c) => c[0] === "run")!;
    expect(run).toEqual([
      "run", "-d", "--name", CONTAINER,
      "-p", "127.0.0.1:51234:8000",
      "-e", "CPP_TUTOR_CORS_ORIGIN_REGEX=^vscode-webview://.*",
      "--pull", "never",
      IMAGE,
    ]);
  });

  it("removes any stale container before running a new one", async () => {
    const { svc, docker } = make();
    await svc.start();
    const rmIdx = docker.calls.findIndex((c) => c[0] === "rm");
    const runIdx = docker.calls.findIndex((c) => c[0] === "run");
    expect(rmIdx).toBeGreaterThanOrEqual(0);
    expect(rmIdx).toBeLessThan(runIdx);
  });
});

describe("TracerService.start failures", () => {
  it("errors when docker is not installed", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "version" ? { code: -1, stdout: "", stderr: "ENOENT" } : undefined);
    const { svc } = make({ docker });
    await svc.start();
    expect(svc.state).toEqual({ name: "error", message: "Docker not found. Install Docker Desktop." });
  });

  it("errors when the daemon is not running", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "version"
        ? { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" }
        : undefined);
    const { svc } = make({ docker });
    await svc.start();
    expect(svc.state).toEqual({
      name: "error",
      message: "Docker is installed but not running. Start it and retry.",
    });
  });

  it("surfaces the last stderr line when the pull fails", async () => {
    const docker = new FakeDocker();
    docker.replies.push(imageMissing);
    docker.pullLines = ["Pulling fs layer", "unauthorized: authentication required"];
    docker.pullExit = 1;
    const { svc } = make({ docker });
    await svc.start();
    expect(svc.state).toEqual({
      name: "error",
      message: "Image pull failed: unauthorized: authentication required",
    });
  });

  it("errors with the port when the bind fails", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "run"
        ? { code: 125, stdout: "", stderr: "Bind for 127.0.0.1:51234 failed: port is already allocated" }
        : undefined);
    const { svc } = make({ docker });
    await svc.start();
    expect(svc.state).toEqual({ name: "error", message: "Port 51234 is already in use." });
  });

  it("errors with container logs when health never comes up", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "logs" ? { code: 0, stdout: "", stderr: "Traceback: boom" } : undefined);
    const { svc } = make({ docker, healthy: false });
    await svc.start();
    expect(svc.state.name).toBe("error");
    expect((svc.state as { message: string }).message).toContain("Backend did not start");
    expect((svc.state as { message: string }).message).toContain("Traceback: boom");
  });
});

describe("TracerService.stop and cancel", () => {
  it("force-removes the container and returns to stopped", async () => {
    const { svc, docker } = make();
    await svc.start();
    await svc.stop();
    expect(docker.calls).toContainEqual(["rm", "-f", CONTAINER]);
    expect(svc.state).toEqual({ name: "stopped" });
  });

  it("stop is a no-op that still reaches stopped when never started", async () => {
    const { svc } = make();
    await svc.stop();
    expect(svc.state).toEqual({ name: "stopped" });
  });

  it("cancel during a health wait removes the container and returns to stopped", async () => {
    const { svc, docker } = make({ healthy: false });
    const started = svc.start();
    svc.cancel();
    await started;
    expect(svc.state).toEqual({ name: "stopped" });
    expect(docker.calls).toContainEqual(["rm", "-f", CONTAINER]);
  });
});

describe("TracerService.watchHealth", () => {
  it("moves ready -> error with logs when the container dies underneath us", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "logs" ? { code: 0, stdout: "MemoryError\n", stderr: "" } : undefined);
    let healthy = true;
    const states: ServiceState[] = [];
    const svc = new TracerService({
      docker,
      findFreePort: async () => 51234,
      probeHealth: async () => healthy,
      sleep: async () => { healthy = false; },
      now: () => 0,
    });
    await svc.start();
    svc.onDidChangeState((st) => states.push(st));
    await svc.watchHealth();
    expect(svc.state.name).toBe("error");
    expect((svc.state as { message: string }).message).toContain("Backend stopped");
    expect((svc.state as { message: string }).message).toContain("MemoryError");
  });

  it("returns immediately when the service is not ready", async () => {
    const { svc } = make();
    await svc.watchHealth();
    expect(svc.state).toEqual({ name: "stopped" });
  });
});

describe("TracerService.adopt", () => {
  it("adopts a container left running by a previous window", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "inspect" ? { code: 0, stdout: "true 51999\n", stderr: "" } : undefined);
    const { svc } = make({ docker });
    await svc.adopt();
    expect(svc.state).toEqual({ name: "ready", port: 51999 });
  });

  it("stays stopped when no container exists", async () => {
    const docker = new FakeDocker();
    docker.replies.push(noContainer);
    const { svc } = make({ docker });
    await svc.adopt();
    expect(svc.state).toEqual({ name: "stopped" });
  });

  it("removes an existing-but-exited container and stays stopped", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "inspect" ? { code: 0, stdout: "false 51999\n", stderr: "" } : undefined);
    const { svc } = make({ docker });
    await svc.adopt();
    expect(svc.state).toEqual({ name: "stopped" });
    expect(docker.calls).toContainEqual(["rm", "-f", CONTAINER]);
  });

  it("removes the container and stays stopped when the reported port is malformed", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "inspect" ? { code: 0, stdout: "true <no value>\n", stderr: "" } : undefined);
    const { svc } = make({ docker });
    await svc.adopt();
    expect(svc.state).toEqual({ name: "stopped" });
    expect(docker.calls).toContainEqual(["rm", "-f", CONTAINER]);
  });
});

describe("TracerService.start additional failure and cancellation paths", () => {
  it("errors with the docker message when run fails for a reason other than a port clash", async () => {
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "run"
        ? { code: 125, stdout: "", stderr: "Error response from daemon: OCI runtime create failed: boom" }
        : undefined);
    const { svc } = make({ docker });
    await svc.start();
    expect(svc.state).toEqual({
      name: "error",
      message: "Could not start the container: Error response from daemon: OCI runtime create failed: boom",
    });
  });

  it("cancel during the pull kills the spawned process and returns to stopped", async () => {
    const docker = new FakeDocker();
    docker.replies.push(imageMissing);
    // Override spawn so the pull hangs until cancel() kills it, instead of
    // resolving synchronously like the base fake — this lets the test land
    // cancel() while the pull is genuinely in flight.
    let resolveDone!: (code: number) => void;
    docker.spawn = (args: string[], onLine: (line: string) => void) => {
      docker.calls.push(args);
      onLine(docker.pullLines[0]);
      const done = new Promise<number>((res) => { resolveDone = res; });
      return {
        done,
        kill: () => { docker.killed = true; resolveDone(1); },
      };
    };
    const { svc } = make({ docker });
    const started = svc.start();
    await flushMicrotasks(); // let start() reach the hanging spawn
    svc.cancel();
    await started;
    expect(docker.killed).toBe(true);
    expect(svc.state).toEqual({ name: "stopped" });
    expect(docker.calls).toContainEqual(["rm", "-f", CONTAINER]);
  });
});

describe("TracerService races (I1/I2/I3 fixes)", () => {
  it("does not report ready when cancelled while the health probe was already in flight (I1)", async () => {
    const docker = new FakeDocker();
    let svc!: TracerService;
    const probeHealth = async () => {
      // Simulate the user hitting Stop while this probe call is in flight;
      // the probe still resolves true, racing the removal.
      await svc.stop();
      return true;
    };
    svc = new TracerService({
      docker,
      findFreePort: async () => 51234,
      probeHealth,
      sleep: async () => {},
      now: () => 0,
    });
    await svc.start();
    expect(svc.state).toEqual({ name: "stopped" });
  });

  it("does not overwrite a deliberate stop with an 'unexpected' error when watchHealth's probe races it (I2)", async () => {
    const docker = new FakeDocker();
    let svc!: TracerService;
    const probeHealth = async () => {
      // Simulate the user hitting Stop while watchHealth's probe is in
      // flight; the probe naturally fails because the container is gone.
      await svc.stop();
      return false;
    };
    svc = new TracerService({
      docker,
      findFreePort: async () => 51234,
      probeHealth,
      sleep: async () => {},
      now: () => 0,
    });
    await svc.start();
    await svc.watchHealth();
    expect(svc.state).toEqual({ name: "stopped" });
  });

  it("a Start that follows a completed Stop wins over a slow predecessor's stale continuation (I3)", async () => {
    const docker = new FakeDocker();
    let svc!: TracerService;
    let triggered = false;
    let calls = 0;
    const probeHealth = async (): Promise<boolean> => {
      if (!triggered) {
        triggered = true;
        // Simulate a Stop-then-Start double-click landing while the first
        // Start's health probe is still in flight.
        await svc.stop();
        await svc.start();
        return true; // the first Start is now stale; this must be ignored
      }
      return true;
    };
    svc = new TracerService({
      docker,
      findFreePort: async () => (calls++ === 0 ? 51234 : 60000),
      probeHealth,
      sleep: async () => {},
      now: () => 0,
    });
    await svc.start();
    expect(svc.state).toEqual({ name: "ready", port: 60000 });
  });

  it("a superseded watchHealth loop must not touch a newer start()'s container (two-loop race)", async () => {
    // Mirrors the real defect: adopt() picks up a container on port A and
    // extension.ts starts watching it (L1). L1 falls asleep inside its
    // WATCH_POLL_MS sleep, having captured port A. While it sleeps, the
    // user re-invokes Start; start()'s only reentrancy guard covers
    // "pulling"/"starting", not "ready", so it proceeds, rm -f's the old
    // container, and boots a new one on port B, reaching ready. When L1
    // wakes, its old `this.current.name === "ready"` guard still passes
    // (the state is ready, just for a different port) so without a
    // generation check it probes the now-dead port A, decides the backend
    // "stopped unexpectedly", and rm -f's the container name out from
    // under the healthy new container — then overwrites the ready state
    // with an error. The generation check in watchHealth must catch this.
    const docker = new FakeDocker();
    docker.replies.push((a) =>
      a[0] === "inspect" ? { code: 0, stdout: "true 51111\n", stderr: "" } : undefined);

    let resolveSleep!: () => void;
    let sleepCalls = 0;
    const svc = new TracerService({
      docker,
      findFreePort: async () => 52222,
      // The old port (A) reads as dead; the new port (B) reads as healthy —
      // exactly what a superseded loop would observe if it ignored staleness.
      probeHealth: async (p) => p !== 51111,
      sleep: async () => {
        sleepCalls++;
        if (sleepCalls === 1) {
          // Pause L1's first WATCH_POLL_MS sleep so a second start() can
          // land while it's asleep.
          await new Promise<void>((res) => { resolveSleep = res; });
        }
      },
      now: () => 0,
    });

    await svc.adopt();
    expect(svc.state).toEqual({ name: "ready", port: 51111 });

    const watch1 = svc.watchHealth(); // L1, watching port A
    await flushMicrotasks();

    await svc.start(); // second Start: rm -f's A, boots and reaches ready on B
    expect(svc.state).toEqual({ name: "ready", port: 52222 });
    const rmCallsBeforeWake = docker.calls.filter((c) => c[0] === "rm" && c[1] === "-f").length;

    resolveSleep(); // wake L1
    await watch1;

    // L1 must recognize it no longer owns the container: no extra rm -f,
    // and the healthy "ready" state for port B must survive untouched.
    const rmCallsAfterWake = docker.calls.filter((c) => c[0] === "rm" && c[1] === "-f").length;
    expect(rmCallsAfterWake).toBe(rmCallsBeforeWake);
    expect(svc.state).toEqual({ name: "ready", port: 52222 });
  });

  it("a second Start is a no-op while the first is still pulling or starting", async () => {
    const fakeDocker = new FakeDocker();
    fakeDocker.replies.push(imageMissing);
    // Hang the pull so the first start() is provably still "pulling" (not
    // already finished) when the second start() call lands.
    let resolveDone!: (code: number) => void;
    fakeDocker.spawn = (args: string[], onLine: (line: string) => void) => {
      fakeDocker.calls.push(args);
      onLine(fakeDocker.pullLines[0]);
      const done = new Promise<number>((res) => { resolveDone = res; });
      return { done, kill: () => { fakeDocker.killed = true; } };
    };
    const { svc, docker } = make({ docker: fakeDocker });
    const first = svc.start();
    await flushMicrotasks(); // let the first call reach 'pulling'
    expect(svc.state.name).toBe("pulling");

    const second = svc.start();
    await second; // the reentrancy guard makes this resolve immediately
    expect(docker.calls.filter((c) => c[0] === "pull").length).toBe(1);

    resolveDone(0); // let the first start() finish
    await first;
    expect(svc.state).toEqual({ name: "ready", port: 51234 });
  });
});
