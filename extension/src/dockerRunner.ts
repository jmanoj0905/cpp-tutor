import { execFile, spawn } from "node:child_process";
import * as net from "node:net";
import type { DockerRunner, RunResult, ServiceDeps } from "./service";

const nodeDocker: DockerRunner = {
  run(args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
      execFile("docker", args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        // A missing binary yields no exit code; the service reads stderr for
        // ENOENT to tell "Docker absent" from "Docker unhappy".
        // execFile's err.code is usually a number, but on a maxBuffer overrun
        // Node sets it to the string "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" —
        // coerce anything non-numeric to 1 so RunResult.code stays a number.
        const rawCode = (err as { code?: unknown } | null)?.code;
        const code = err
          ? (err as NodeJS.ErrnoException).code === "ENOENT"
            ? -1
            : typeof rawCode === "number"
              ? rawCode
              : 1
          : 0;
        const errText = err && (err as NodeJS.ErrnoException).code === "ENOENT" ? "ENOENT" : stderr;
        resolve({ code, stdout, stderr: errText });
      });
    });
  },

  spawn(args: string[], onLine: (line: string) => void) {
    const child = spawn("docker", args);
    let buf = "";
    const feed = (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) onLine(l.trim());
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    return {
      done: new Promise<number>((resolve) => {
        child.on("close", (code) => {
          if (buf.trim()) onLine(buf.trim());
          resolve(code ?? 1);
        });
        child.on("error", () => resolve(-1));
      }),
      kill: () => child.kill(),
    };
  },
};

/** Asks the OS for an unused loopback port by binding and immediately closing. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function probeHealth(port: number): Promise<boolean> {
  try {
    const ctl = AbortSignal.timeout(1000);
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctl });
    // This runs in a poll loop (every 500ms for up to 30s, then every 3s for
    // the service's whole "ready" lifetime), so an unread body would leave
    // undici unable to return the connection to the pool until GC eventually
    // reclaims it — an unbounded leak that shows up much later as spurious
    // probe failures once the per-origin pool is exhausted. Drain it every
    // time, and never let a drain failure escape past the outer catch below;
    // it should still just read as "not healthy".
    try {
      await r.body?.cancel();
    } catch {
      return false;
    }
    return r.ok;
  } catch {
    return false;
  }
}

export function realDeps(): ServiceDeps {
  return {
    docker: nodeDocker,
    findFreePort,
    probeHealth,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  };
}
