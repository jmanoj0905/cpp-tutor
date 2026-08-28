# The container image

One artifact, `ghcr.io/jmanoj0905/cpp-tutor`, multi-arch (amd64 + arm64). It
bundles the patched-Valgrind tracer, the FastAPI backend, and the built
frontend, served by a single uvicorn process on `:8000`.

```bash
docker run --rm -p 8000:8000 ghcr.io/jmanoj0905/cpp-tutor
# then open http://localhost:8000
```

Both the [hosted](hosted.md) site and the [VSCode extension](extension.md)
consume this image; neither builds anything of its own.

## Building it

Two steps, because `tracer/Dockerfile` stays the single source of truth for the
tracer:

```bash
docker build -t cpp-tutor-tracer:dev tracer/
docker build -t cpp-tutor .              # TRACER_IMAGE defaults to cpp-tutor-tracer:dev
```

CI overrides `TRACER_IMAGE` with a per-arch registry ref, because buildx's
container driver cannot see daemon-local tags.

Inside the image the frontend is built with `VITE_API=""`, so the bundle calls
`/api/trace` relative — same-origin, and CORS is irrelevant.

## Smoke test

```bash
scripts/smoke-container.sh cpp-tutor
```

The same script gates every CI build before the image is pushed.

## Sandboxing caveat

Traced code runs inside this container with process-level limits only — there
is no network isolation between the app and traced code, unlike the dev setup's
per-request sandbox. Fine for local single-user use; harden it yourself if you
expose it:

```bash
docker run --rm -p 8000:8000 --memory 512m --pids-limit 256 --cap-drop all \
  ghcr.io/jmanoj0905/cpp-tutor
```
