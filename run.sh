#!/usr/bin/env bash
# run.sh — set up (via install.sh) then launch the cpp-tutor dev stack:
# FastAPI backend on :8000 and the Vite frontend on :5173. Ctrl-C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BACKEND_PORT=8000
FRONTEND_PORT=5173
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"

c_blue=$'\033[34m'; c_green=$'\033[32m'; c_off=$'\033[0m'
log() { printf '%s==>%s %s\n' "$c_blue" "$c_off" "$*"; }

# ── ensure everything is installed ───────────────────────────────
bash "$ROOT/install.sh"

# ── start servers, clean up on exit ──────────────────────────────
pids=()
cleanup() {
  log "stopping servers"
  for pid in "${pids[@]:-}"; do
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

log "starting backend  → http://localhost:${BACKEND_PORT}"
( cd backend && exec .venv/bin/uvicorn app.api:app --reload --port "$BACKEND_PORT" ) &
pids+=($!)

log "starting frontend → ${FRONTEND_URL}"
( cd frontend && exec npm run dev -- --port "$FRONTEND_PORT" ) &
pids+=($!)

# ── open the browser once the frontend is up ─────────────────────
opener=""
case "$(uname -s)" in
  Darwin) opener="open" ;;
  Linux)  command -v xdg-open >/dev/null 2>&1 && opener="xdg-open" ;;
esac
if [ -n "$opener" ]; then
  ( for _ in $(seq 1 30); do
      if curl -s -o /dev/null "$FRONTEND_URL" 2>/dev/null; then "$opener" "$FRONTEND_URL"; break; fi
      sleep 1
    done ) &
fi

log "stack running — press Ctrl-C to stop"
wait
