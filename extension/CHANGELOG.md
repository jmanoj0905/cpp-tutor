# Changelog

## Unreleased

- The first-run image download is announced before you commit to it: the
  sidebar states the size (~400 MB over the network, ~1.5 GB on disk) and that
  it happens once, and pull progress now reads as a layer count instead of a
  raw docker line.
- Docker's status is always on screen in the sidebar footer, including when it
  is healthy, and **Recheck** no longer lives inside the failure-only banner.

## 0.1.0

First release.

- Sidebar that starts and stops the cpp-tutor backend container
  (`ghcr.io/jmanoj0905/cpp-tutor:latest`) on a free loopback port, with pull
  progress, cancel, and a health watch that reports a container dying after a
  successful boot.
- Two ways to open the visualizer: **In VSCode** (Simple Browser tab) and
  **In browser** (your default browser). The last one used is remembered.
- **Visualize current file** hands the active C/C++ editor's source to the
  visualizer through the URL fragment and traces it on load.
- Warns in the sidebar when the Docker daemon is not running, with a recheck
  button, instead of only failing at start.
- One container is shared across VSCode windows: a window adopts a container
  another window started, and only the window that created it removes it on
  exit.
