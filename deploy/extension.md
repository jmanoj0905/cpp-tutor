# VSCode extension

`extension/` is a self-contained npm package that ships as a `.vsix`. It does
not bundle the frontend or the tracer: it starts the published container and
opens the visualizer the container itself serves.

See [`extension/README.md`](../extension/README.md) for what the extension does
and how to sideload it. This file covers the release path.

## How it relates to the other modes

- Consumes `ghcr.io/jmanoj0905/cpp-tutor:latest`, the same image as
  [hosted](hosted.md) — pinned in `extension/src/service.ts` (`IMAGE`), not
  configurable.
- Runs it as container `cpp-tutor-vscode` on a free loopback port, one
  container shared by every VSCode window.
- Opens `http://127.0.0.1:<port>/` in VSCode's Simple Browser or the default
  browser. Same-origin, so no CORS involved.
- Hands the active editor's source over in the URL fragment
  (`#code=<base64url>&run=1`), decoded by `frontend/src/handoff.ts`.

The consequence worth remembering: **the visualizer the extension shows is the
one inside the image, not this checkout.** A frontend change reaches extension
users only after CI republishes `:latest` and the user re-pulls. Extension code
changes ship in the `.vsix`; frontend changes do not.

## Release

```bash
cd extension
npm test && npm run typecheck
npm run package        # emits cpp-tutor-vscode-<version>.vsix
npx vsce publish       # or: npx vsce publish minor
```

Not in CI — publishing needs a Marketplace PAT, which is a personal credential.

Prerequisites, one time: an Azure DevOps organization, a PAT scoped to
**Marketplace → Manage** across **all accessible organizations**, and a
publisher created at <https://marketplace.visualstudio.com/manage> whose ID
matches `publisher` in `extension/package.json`.

Each release: bump `version` in `extension/package.json` and add a
`extension/CHANGELOG.md` entry. The Marketplace rejects republishing a version
that already exists, and `vsce unpublish` burns the name permanently.
