# Deployment modes

cpp-tutor ships four ways. They share the same three tiers (`tracer/`,
`backend/`, `frontend/`) but differ in what gets built, where the frontend
talks to, and who starts the tracer.

| Mode | Who it's for | Artifact | Frontend origin | API base | Doc |
|---|---|---|---|---|---|
| **Local dev** | working on the code | none — source | Vite `:5173` | `http://localhost:8000` (dev fallback) | [local.md](local.md) |
| **Container** | a self-hosted single user | `ghcr.io/jmanoj0905/cpp-tutor` | served by the backend | same-origin `/api` | [image.md](image.md) |
| **Hosted** | the public site | same image + a static build | Cloudflare Pages | `https://cpp-tutor-api.onrender.com` | [hosted.md](hosted.md) |
| **VSCode extension** | editor users | `.vsix` + same image | served by the container | same-origin `/api` | [extension.md](extension.md) |

The container is the pivot: **Hosted** and **VSCode extension** both consume
the exact image `.github/workflows/image.yml` publishes. Local dev is the only
mode that does not use it — it builds `cpp-tutor-tracer:dev` and runs the
backend from a virtualenv, so a tracer change is testable without a full image
build.

## The one thing that actually differs: where the API lives

`frontend/src/api/client.ts` resolves its base in this order:

1. `window.__CPP_TUTOR_API`, if some host injected it — no mode sets this today
   (the extension used to, back when it rendered the frontend in a webview).
2. `import.meta.env.VITE_API`, folded in at build time. Empty string ⇒ relative
   ⇒ same-origin. This is what separates the modes.
3. `http://localhost:8000` — the dev fallback, only reachable when `VITE_API`
   is unset, i.e. `npm run dev`.

So: **local** leaves `VITE_API` unset, **container** builds with `VITE_API=""`
(see the root `Dockerfile`), and **hosted** bakes the Render URL into the Pages
bundle (see `.github/workflows/deploy-hosted.yml`).

The mirror image of that choice is CORS, set by env on the backend
(`backend/app/api.py`): `CPP_TUTOR_CORS_ORIGINS` (comma list, defaults to the
Vite dev server) and `CPP_TUTOR_CORS_ORIGIN_REGEX`. Same-origin modes need
neither; only the hosted split does.

## CI

- `.github/workflows/image.yml` — builds the per-arch tracer and app images,
  smoke-tests the app image, pushes by digest, and creates the multi-arch
  `:latest` manifest. Runs on every `main` push and on `v*` tags. This is the
  artifact the container, hosted, and extension modes all consume.
- `.github/workflows/deploy-hosted.yml` — hosted mode only. Waits for a
  successful `image` run on `main`, then pings the Render deploy hook and
  builds + deploys the Pages bundle. A failed deploy here no longer reads as a
  broken image.

Publishing the extension is not in CI — it is a manual `vsce publish`, see
[extension.md](extension.md).
