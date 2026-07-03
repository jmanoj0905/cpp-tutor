#!/usr/bin/env bash
# deploy/deploy.sh — run ON the VM (as azureuser) from the repo root.
# Idempotent: builds the tracer image (only when tracer/ changed), the backend
# venv, and the frontend bundle, then (re)installs the systemd + Caddy config.
#
# Assumes the repo is already checked out at the desired commit (the CI job or
# the operator does the git fetch/reset before calling this).
set -euo pipefail

APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP"

IMAGE="cpp-tutor-tracer:dev"
HASH_FILE="$HOME/.cpp-tutor-tracer-hash"

echo "==> submodule"
git submodule update --init --recursive

# ── tracer image: rebuild only when the tracer/ tree changed or image absent ──
tracer_hash="$(git rev-parse HEAD:tracer)"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1 \
   || [ "$(cat "$HASH_FILE" 2>/dev/null || true)" != "$tracer_hash" ]; then
	echo "==> building tracer image (this is slow the first time)"
	docker build -t "$IMAGE" tracer/
	echo "$tracer_hash" > "$HASH_FILE"
else
	echo "==> tracer image up to date, skipping build"
fi

# ── backend venv + deps ──────────────────────────────────────────────────────
echo "==> backend"
cd "$APP/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q fastapi uvicorn pydantic

# ── frontend build ───────────────────────────────────────────────────────────
echo "==> frontend build"
cd "$APP/frontend"
npm ci
npm run build
sudo mkdir -p /var/www/cpp-tutor
sudo rm -rf /var/www/cpp-tutor/*
sudo cp -r dist/* /var/www/cpp-tutor/

# ── systemd + caddy (idempotent) ─────────────────────────────────────────────
echo "==> services"
sudo cp "$APP/deploy/cpp-tutor-backend.service" /etc/systemd/system/
sudo cp "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable cpp-tutor-backend
sudo systemctl restart cpp-tutor-backend
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

echo "==> done"
