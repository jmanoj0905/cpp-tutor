#!/usr/bin/env bash
# smoke-container.sh [IMAGE] — end-to-end check of the all-in-one image.
# Without IMAGE: builds tracer + app images locally first (cpp-tutor:local).
# With IMAGE: tests the given prebuilt image (used by CI after its own build).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  IMAGE="cpp-tutor:local"
  docker build -t cpp-tutor-tracer:dev tracer/
  docker build -t "$IMAGE" .
fi

PORT="${SMOKE_PORT:-18000}"
WORK="$(mktemp -d)"
CID="$(docker run -d --rm -p "$PORT:8000" "$IMAGE")"
cleanup() { docker stop "$CID" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> waiting for server"
for _ in $(seq 1 30); do
  curl -fs "http://localhost:$PORT/" >/dev/null 2>&1 && break
  sleep 1
done

echo "==> GET / serves the frontend"
curl -fs "http://localhost:$PORT/" | grep -q 'id="root"'

echo "==> POST /api/trace traces tracer/sample.cpp"
jq -Rs '{code: ., lang: "cpp"}' < tracer/sample.cpp > "$WORK/req.json"
curl -fs --max-time 90 -X POST "http://localhost:$PORT/api/trace" \
  -H 'Content-Type: application/json' --data "@$WORK/req.json" > "$WORK/resp.json"
jq -e '.trace | length > 0' "$WORK/resp.json" >/dev/null

echo "==> compile error comes back structured"
jq -n '{code: "int main(){ return", lang: "cpp"}' > "$WORK/bad.json"
curl -fs -X POST "http://localhost:$PORT/api/trace" \
  -H 'Content-Type: application/json' --data "@$WORK/bad.json" > "$WORK/bad-resp.json"
jq -e '.status == "compile_error"' "$WORK/bad-resp.json" >/dev/null

echo "==> built frontend has no hardcoded API base"
if docker run --rm --entrypoint grep "$IMAGE" -rq "localhost:8000" /opt/cpp-tutor/static; then
  echo "FAIL: dist contains localhost:8000 (VITE_API not applied)" >&2
  exit 1
fi

echo "smoke OK: $IMAGE"
