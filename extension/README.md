# cpp-tutor for VSCode

Runs the cpp-tutor backend in Docker and shows the memory visualizer in an
editor tab. Requires Docker Desktop (or any Docker daemon) on the same machine.

## Sideloading a build

```bash
cd extension
npm install
npm run package        # builds the frontend, bundles the extension, emits a .vsix
code --install-extension cpp-tutor-vscode-0.1.0.vsix
```

Then click the cpp-tutor icon in the activity bar and press **Start service**.
The first start pulls `ghcr.io/jmanoj0905/cpp-tutor:latest`, which takes a few
minutes; later starts are immediate.

> **Warning: the published image is currently stale.** As of this writing,
> `ghcr.io/jmanoj0905/cpp-tutor:latest` predates the backend changes this
> extension needs — it has neither the `/api/health` route nor the
> `allow_origin_regex` CORS setting the webview relies on. Against that image
> the extension fails twice over: Start times out with "Backend did not start
> within 30s" (the health probe never succeeds), and even if you make it past
> that, the webview's origin is rejected by CORS. The extension's image name
> is not configurable — it always runs `ghcr.io/jmanoj0905/cpp-tutor:latest`
> and skips the registry pull if an image with that exact tag already exists
> locally. So, until the real image is republished, a sideloader has to build
> it themselves from this repo's root `Dockerfile` (it takes a
> `TRACER_IMAGE` build-arg — see `.github/workflows/publish.yml` for the
> exact invocation) and tag the result `ghcr.io/jmanoj0905/cpp-tutor:latest`
> so the extension picks it up in place of the stale one. Rebuilding or
> publishing the registry image itself is out of scope here — that's a call
> for whoever owns the registry.

## Development

```bash
npm run build:ext -- --watch   # rebuild on change
```

Press F5 in VSCode with `extension/` open to launch an Extension Development
Host. `npm test` runs the unit tests (service state machine, HTML builder);
the VSCode-facing wiring is verified by sideloading.
