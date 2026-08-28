import { describe, it, expect } from "vitest";
import { PullTracker } from "../src/pullProgress";

/** The exact shape `docker pull` prints with no TTY attached: layer events, no byte counts. */
const REAL_SESSION = [
  "latest: Pulling from jmanoj0905/cpp-tutor",
  "5de55e5ef9c0: Already exists",
  "b05773cc67e1: Pulling fs layer",
  "2b8c8ae4a685: Pulling fs layer",
  "2b8c8ae4a685: Verifying Checksum",
  "2b8c8ae4a685: Download complete",
  "b05773cc67e1: Download complete",
  "b05773cc67e1: Extracting",
  "b05773cc67e1: Pull complete",
  "2b8c8ae4a685: Pull complete",
  "Digest: sha256:c610fcdf",
  "Status: Downloaded newer image for ghcr.io/jmanoj0905/cpp-tutor:latest",
];

describe("PullTracker", () => {
  it("counts announced layers and completions across a real pull", () => {
    const t = new PullTracker();
    let p = t.feed(REAL_SESSION[0]);
    expect(p).toEqual({ done: 0, total: 0 });

    p = t.feed(REAL_SESSION[1]);
    expect(p).toMatchObject({ done: 1, total: 1 });

    for (const l of REAL_SESSION.slice(2, 6)) p = t.feed(l);
    expect(p).toMatchObject({ done: 1, total: 3 });

    for (const l of REAL_SESSION.slice(6)) p = t.feed(l);
    expect(p).toMatchObject({ done: 3, total: 3 });
  });

  it("counts a layer first seen mid-download, never double-counting", () => {
    const t = new PullTracker();
    t.feed("b05773cc67e1: Downloading [====>   ]  41.2MB/206MB");
    t.feed("b05773cc67e1: Downloading [========>]  90.0MB/206MB");
    expect(t.feed("b05773cc67e1: Pull complete")).toMatchObject({ done: 1, total: 1 });
  });

  it("ignores non-layer chatter", () => {
    const t = new PullTracker();
    t.feed("Digest: sha256:deadbeef");
    t.feed("Status: Image is up to date for ghcr.io/x/y:latest");
    expect(t.feed("Trying to pull...")).toMatchObject({ done: 0, total: 0 });
  });

  it("never reports more done than total", () => {
    const t = new PullTracker();
    t.feed("aaaaaa: Pull complete");
    t.feed("aaaaaa: Pull complete");
    expect(t.feed("bbbbbb: Pulling fs layer")).toMatchObject({ done: 1, total: 2 });
  });
});
