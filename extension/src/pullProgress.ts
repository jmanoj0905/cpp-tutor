/**
 * Turns `docker pull` output into a layer count.
 *
 * With no TTY attached — which is how the extension always spawns it — docker
 * prints no byte counts at all, just one line per layer event ("Pulling fs
 * layer", "Download complete", "Pull complete"). So the only progress signal
 * available is how many layers have finished out of how many were announced.
 *
 * Pure: no vscode, no docker, no I/O.
 */

export interface PullProgress {
  /** Layers announced so far. Grows as docker names them; not known up front. */
  total: number;
  /** Layers that have finished (pulled, or already in the local cache). */
  done: number;
}

/** `b05773cc67e1: Pull complete` — the id is a short hex digest. */
const LAYER_LINE = /^([0-9a-f]{6,}):\s*(.+)$/;

export class PullTracker {
  private layers = new Map<string, boolean>();

  feed(line: string): PullProgress {
    const m = LAYER_LINE.exec(line);
    if (m) {
      const [, id, event] = m;
      // A layer can be first seen at any event (a resumed pull starts at
      // "Downloading"), so every layer line registers it; only a terminal
      // event flips it to done. Map semantics keep a repeated event from
      // counting twice.
      const finished = /^(Pull complete|Already exists)/.test(event);
      this.layers.set(id, (this.layers.get(id) ?? false) || finished);
    }
    return this.snapshot();
  }

  snapshot(): PullProgress {
    let done = 0;
    for (const finished of this.layers.values()) if (finished) done++;
    return { total: this.layers.size, done };
  }
}
