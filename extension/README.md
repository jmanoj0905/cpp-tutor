# cpp-tutor for VSCode

Paste or open C/C++ code, step through its execution, and watch the stack,
heap, and pointer edges change one line at a time.

> **Requires Docker.** All tracing happens inside a container this extension
> runs locally — nothing is uploaded. Pressing **Start service** the first time
> pulls `ghcr.io/jmanoj0905/cpp-tutor:latest` — roughly 1.5 GB, since it
> carries a patched Valgrind — which can take several minutes on a slow link.
> Later starts are immediate. Docker Desktop, Colima, or any Docker daemon on
> the same machine works; the extension warns in its sidebar when it can't
> reach one.

The container serves the frontend as well as the API (same-origin `/api`), so
the visualizer is just a URL — `http://127.0.0.1:<port>/`. The sidebar offers
two places to open it:

- **In VSCode** — VSCode's built-in Simple Browser, in an editor tab.
- **In browser** — your default browser via `openExternal`.

Whichever you used last is remembered and reused by Start and by **Visualize
current file**, which hands the active C/C++ editor's source to the visualizer
through the URL hash (`#code=<base64url>&run=1`, decoded by
`frontend/src/handoff.ts`) and traces it on load. The hash is a fragment, so
the source never reaches the server; files whose encoded payload exceeds
`MAX_HANDOFF_CHARS` are refused rather than truncated.

If the Docker daemon isn't running, the sidebar says so up front (at
activation, and again from the **Recheck Docker** button) instead of waiting
for a Start to fail.

## Sideloading a build

```bash
cd extension
npm install
npm run package        # bundles the extension, emits a .vsix
code --install-extension cpp-tutor-vscode-0.1.0.vsix
```

Then click the cpp-tutor icon in the activity bar and press **Start service**.
The first start pulls `ghcr.io/jmanoj0905/cpp-tutor:latest`, which takes a few
minutes; later starts are immediate.

> **The hand-off needs a current image.** The visualizer the extension opens
> is the one *inside* the container, so **Visualize current file** only works
> against an image built after `frontend/src/handoff.ts` landed — an older
> bundle cannot read the `#code=` hash and simply shows its sample program.
> The image name is not configurable (always
> `ghcr.io/jmanoj0905/cpp-tutor:latest`) and the registry pull is skipped when
> an image with that exact tag already exists locally, so refresh it with
> `docker pull` after CI republishes, or build it yourself from this repo's
> root `Dockerfile` (it takes a `TRACER_IMAGE` build-arg — see
> `.github/workflows/image.yml` for the exact invocation) and tag the result
> `ghcr.io/jmanoj0905/cpp-tutor:latest`.

Release steps (publisher setup, versioning) live in
[`deploy/extension.md`](../deploy/extension.md); how this mode relates to the
hosted site and the plain container is [`deploy/README.md`](../deploy/README.md).

## Development

```bash
npm run build:ext -- --watch   # rebuild on change
```

Press F5 in VSCode with `extension/` open to launch an Extension Development
Host. `npm test` runs the unit tests (service state machine, url/hand-off builders);
the VSCode-facing wiring is verified by sideloading.
