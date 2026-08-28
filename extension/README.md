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

## Development

```bash
npm run build:ext -- --watch   # rebuild on change
```

Press F5 in VSCode with `extension/` open to launch an Extension Development
Host. `npm test` runs the unit tests (service state machine, HTML builder);
the VSCode-facing wiring is verified by sideloading.
