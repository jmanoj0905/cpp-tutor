export const IMAGE = "ghcr.io/jmanoj0905/cpp-tutor:latest";
export const CONTAINER = "cpp-tutor-vscode";
export const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;
const WATCH_POLL_MS = 3_000;

export type ServiceState =
  | { name: "stopped" }
  | { name: "pulling"; progress: string }
  | { name: "starting" }
  | { name: "ready"; port: number }
  | { name: "error"; message: string };

export interface RunResult { code: number; stdout: string; stderr: string }

export interface DockerRunner {
  run(args: string[]): Promise<RunResult>;
  spawn(args: string[], onLine: (line: string) => void): { done: Promise<number>; kill(): void };
}

export interface ServiceDeps {
  docker: DockerRunner;
  findFreePort(): Promise<number>;
  probeHealth(port: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * Owns the lifecycle of the cpp-tutor backend container. Deliberately free of
 * `vscode` imports so the whole state machine is unit-testable against a fake
 * DockerRunner; everything VSCode-facing subscribes via onDidChangeState.
 */
export class TracerService {
  private current: ServiceState = { name: "stopped" };
  private listeners = new Set<(s: ServiceState) => void>();
  private cancelled = false;
  private inflight?: { kill(): void };

  /**
   * True only while the container running right now is one THIS window's
   * start() booted. Adopting a container found already running, or never
   * having started one, leaves this false. deactivate() consults it so
   * closing one VSCode window never tears down a container another window
   * is actively using — only the window that created it cleans it up on
   * exit. An explicit user Stop bypasses this entirely (stop() always
   * removes, regardless of ownership) because that is a deliberate action.
   */
  private _owned = false;

  /**
   * Bumped on every start() entry. A start() run captures its generation
   * locally and re-checks it after every await; once a concurrent event (a
   * deliberate stop() that unblocks a fresh start(), or another start() call
   * squeezing past the reentrancy guard before either has set "pulling" or
   * "starting") bumps the counter, a stale run's continuation is no longer
   * the owner of the container and must stop touching Docker or state.
   */
  private generation = 0;

  constructor(private readonly deps: ServiceDeps) {}

  get state(): ServiceState {
    return this.current;
  }

  /** Whether the container currently running was started by this window. */
  get owned(): boolean {
    return this._owned;
  }

  onDidChangeState(cb: (s: ServiceState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(state: ServiceState): void {
    this.current = state;
    for (const l of this.listeners) l(state);
  }

  private stale(gen: number): boolean {
    return gen !== this.generation;
  }

  async start(): Promise<void> {
    // A Start that lands while a previous Start is still pulling or booting
    // is a no-op: let the in-flight attempt finish (or be cancelled) rather
    // than racing it. This alone doesn't cover every race (see the
    // generation checks below, needed for the window before either state is
    // set, and for a Start that follows a Stop that just unblocked us).
    if (this.current.name === "pulling" || this.current.name === "starting") return;

    const gen = ++this.generation;
    this.cancelled = false;

    // Every dep call below is real I/O (spawns, sockets) and can reject —
    // findFreePort in particular (EADDRNOTAVAIL, EACCES binding the probe
    // socket) — after the state has already moved to "starting". Without
    // this catch a rejection here would leave the state wedged at
    // "starting" forever: the re-entry guard at the top of start() turns
    // every later start() into a silent no-op, and Cancel only sets a flag
    // no live loop is around to observe. Fail into "error" instead so
    // Retry actually retries.
    try {
      const preflight = await this.checkDocker();
      if (this.stale(gen)) return;
      if (preflight) return this.set({ name: "error", message: preflight });

      const present = await this.imagePresent();
      if (this.stale(gen)) return;
      if (!present) {
        if (!(await this.pull(gen))) return;
        if (this.stale(gen)) return;
      }
      if (this.cancelled) return this.removeAndStop();

      this.set({ name: "starting" });
      const port = await this.deps.findFreePort();
      if (this.stale(gen)) return;

      // A container from a crashed window would take the name and the old port.
      await this.deps.docker.run(["rm", "-f", CONTAINER]);
      if (this.stale(gen)) return;

      const run = await this.deps.docker.run([
        "run", "-d", "--name", CONTAINER,
        "-p", `127.0.0.1:${port}:8000`,
        "-e", "CPP_TUTOR_CORS_ORIGIN_REGEX=^vscode-webview://.*",
        "--pull", "never",
        IMAGE,
      ]);
      if (this.stale(gen)) return;
      if (run.code !== 0) {
        const portClash = /port is already allocated|address already in use/i.test(run.stderr);
        return this.set({
          name: "error",
          message: portClash
            ? `Port ${port} is already in use.`
            : `Could not start the container: ${lastLine(run.stderr)}`,
        });
      }
      this._owned = true;

      await this.waitForHealth(port, gen);
    } catch (err) {
      // A stale attempt's rejection must not clobber whatever a newer
      // start()/stop() already put in place.
      if (this.stale(gen)) return;
      this.set({ name: "error", message: `Could not start the container: ${errorMessage(err)}` });
    }
  }

  async stop(): Promise<void> {
    this.cancelled = true;
    this.inflight?.kill();
    this.inflight = undefined;
    await this.deps.docker.run(["rm", "-f", CONTAINER]);
    this._owned = false;
    this.set({ name: "stopped" });
  }

  /** Abandons an in-progress start; the container, if any, is removed. */
  cancel(): void {
    this.cancelled = true;
    this.inflight?.kill();
  }

  /**
   * Polls health while the service is ready, so a container that dies after a
   * successful boot (OOM kill, daemon restart) surfaces instead of leaving the
   * sidebar claiming everything is fine. Returns once the state leaves `ready`.
   *
   * The guard is re-checked both before AND after the probe: stopping the
   * service is exactly what makes the probe fail, so a check only before the
   * probe would let a deliberate stop that races the probe get overwritten
   * with an "unexpected" error.
   *
   * The generation is captured once, at the top, and re-checked at both of
   * those points too: a second start() (or a stop()-then-start()) bumps the
   * counter, so a loop launched for an earlier "ready" (a different port,
   * the same container name) recognizes it no longer owns the container and
   * must not touch it or overwrite the newer state.
   */
  async watchHealth(): Promise<void> {
    const gen = this.generation;
    while (this.current.name === "ready") {
      const { port } = this.current;
      await this.deps.sleep(WATCH_POLL_MS);
      if (this.current.name !== "ready" || this.cancelled || this.stale(gen)) return;

      const healthy = await this.deps.probeHealth(port);
      if (this.current.name !== "ready" || this.cancelled || this.stale(gen)) return;
      if (healthy) continue;

      const logs = await this.deps.docker.run(["logs", "--tail", "20", CONTAINER]);
      await this.deps.docker.run(["rm", "-f", CONTAINER]);
      this.set({
        name: "error",
        message: `Backend stopped unexpectedly.\n${logs.stdout}${logs.stderr}`.trim(),
      });
      return;
    }
  }

  /**
   * Reclaims a container left behind by a previous window or a crash.
   * extension.ts fires this at activation, after commands are already
   * registered, so its single await (the `docker inspect`) can race a
   * concurrent start(): capture the generation up front and bail out with
   * `stale(gen)` before every set()/removeAndStop() below, exactly like
   * start() and watchHealth() already do — otherwise a late-resolving
   * adopt() can overwrite a newer, healthier state (or worse, kick off a
   * watchHealth() loop that probes a dead port and rm -f's the container a
   * concurrent start() just booted).
   */
  async adopt(): Promise<void> {
    const gen = this.generation;
    // An adopted container belongs to whoever started it, not to this
    // window, regardless of how the race below resolves.
    this._owned = false;

    const out = await this.deps.docker.run([
      "inspect", "-f",
      '{{.State.Running}} {{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',
      CONTAINER,
    ]);
    if (this.stale(gen)) return;
    if (out.code !== 0) return this.set({ name: "stopped" });

    const [running, portStr] = out.stdout.trim().split(/\s+/);
    const port = Number(portStr);
    if (running !== "true" || !portStr || !Number.isInteger(port)) {
      return this.removeAndStop();
    }
    this.set({ name: "ready", port });
  }

  /** Returns an error message, or "" when Docker is usable. */
  private async checkDocker(): Promise<string> {
    const v = await this.deps.docker.run(["version"]);
    if (v.code === 0) return "";
    if (/ENOENT|not found/i.test(v.stderr)) return "Docker not found. Install Docker Desktop.";
    return "Docker is installed but not running. Start it and retry.";
  }

  private async imagePresent(): Promise<boolean> {
    const r = await this.deps.docker.run(["image", "inspect", IMAGE]);
    return r.code === 0;
  }

  /** Returns false (and sets an error/stopped state) if the pull did not finish. */
  private async pull(gen: number): Promise<boolean> {
    this.set({ name: "pulling", progress: "" });
    let last = "";
    const proc = this.deps.docker.spawn(["pull", IMAGE], (line) => {
      if (this.stale(gen)) return;
      last = line;
      this.set({ name: "pulling", progress: line });
    });
    this.inflight = proc;
    const code = await proc.done;
    this.inflight = undefined;
    if (this.stale(gen)) return false;

    if (this.cancelled) {
      await this.removeAndStop();
      return false;
    }
    if (code !== 0) {
      this.set({ name: "error", message: `Image pull failed: ${last}` });
      return false;
    }
    return true;
  }

  private async waitForHealth(port: number, gen: number): Promise<void> {
    const deadline = this.deps.now() + HEALTH_TIMEOUT_MS;
    while (this.deps.now() < deadline) {
      if (this.stale(gen)) return;
      if (this.cancelled) return this.removeAndStop();

      const healthy = await this.deps.probeHealth(port);
      if (this.stale(gen)) return;
      // Re-check after the probe too: a stop() that raced the in-flight
      // probe can resolve it `true` against a container that's already
      // gone, so a cancelled run must not overwrite that with "ready".
      if (this.cancelled) return this.removeAndStop();
      if (healthy) return this.set({ name: "ready", port });

      await this.deps.sleep(HEALTH_POLL_MS);
    }
    if (this.stale(gen)) return;

    const logs = await this.deps.docker.run(["logs", "--tail", "20", CONTAINER]);
    if (this.stale(gen)) return;
    await this.deps.docker.run(["rm", "-f", CONTAINER]);
    if (this.stale(gen)) return;
    this.set({
      name: "error",
      message: `Backend did not start within ${HEALTH_TIMEOUT_MS / 1000}s.\n${logs.stdout}${logs.stderr}`.trim(),
    });
  }

  /**
   * Removes the container and returns to stopped. Used on every cancel exit
   * from start() (the post-image checkpoint, the pull, and the health wait),
   * so cancel never leaves a container running even though `rm -f` on a
   * container that may not exist yet (the post-image checkpoint fires before
   * any `docker run`) is a harmless no-op.
   */
  private async removeAndStop(): Promise<void> {
    await this.deps.docker.run(["rm", "-f", CONTAINER]);
    this.set({ name: "stopped" });
  }
}

function lastLine(s: string): string {
  const lines = s.trim().split("\n");
  return lines[lines.length - 1] ?? "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
