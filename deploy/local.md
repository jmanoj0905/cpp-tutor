# Local development

The only mode that runs from source. Nothing here touches the published image.

```bash
./install.sh   # idempotent: tracer image, backend venv, frontend deps
./run.sh       # install.sh, then backend :8000 + frontend :5173, opens a browser
```

Requires Docker (daemon running), Python 3.11+, and Node. `install.sh` detects
the OS package manager and installs what is missing; every step is skipped when
already done.

## What it builds

- `cpp-tutor-tracer:dev` from `tracer/` — the patched Valgrind image. **Not**
  the published `ghcr.io/jmanoj0905/cpp-tutor-tracer`; it is a daemon-local tag
  that only this mode and the root `Dockerfile`'s default build-arg use.
- `backend/.venv` — plain venv + pip, deps mirrored from `backend/pyproject.toml`
  (`fastapi`, `uvicorn`, `pydantic`). No uv, no editable install: the backend is
  run from `backend/` with `app` imported via cwd.
- `frontend/node_modules` — refreshed only when `package-lock.json` is newer.

## Wiring

The frontend runs on Vite `:5173` with `VITE_API` unset, so it falls through to
the `http://localhost:8000` dev fallback in `frontend/src/api/client.ts`. That
is cross-origin, which is why the backend's CORS default is exactly
`http://localhost:5173`.

The backend shells out to the tracer image, one container per request, plus a
warm container it reuses.

## After changing the tracer

The backend uses a prebuilt image and will not pick up source changes on its own:

```bash
docker build -t cpp-tutor-tracer:dev tracer/
docker rm -f cpp-tutor-tracer-warm     # required: the warm container still serves the old image
```

Rebuild after editing `tracer/Dockerfile`, any `tracer/*.patch`, or the
`opt-cpp-backend` submodule.

## Tests

```bash
cd frontend && npm test          # vitest
cd frontend && npm run build     # tsc -b && vite build — the typecheck gate
cd backend   && .venv/bin/pytest -m "not docker"
cd extension && npm test && npm run typecheck
```
