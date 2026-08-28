#!/usr/bin/env bash
# install.sh — idempotent setup for cpp-tutor.
# Detects the OS, installs missing prerequisites, builds the tracer Docker
# image, and installs backend + frontend dependencies. Safe to re-run: every
# step is skipped if it is already done.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

TRACER_IMAGE="cpp-tutor-tracer:dev"

# ── pretty logging ───────────────────────────────────────────────
c_blue=$'\033[34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_off=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue"  "$c_off" "$*"; }
ok()   { printf '%s ok%s %s\n' "$c_green" "$c_off" "$*"; }
warn() { printf '%s!!%s  %s\n' "$c_yellow" "$c_off" "$*"; }
die()  { printf '%sxx%s  %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# ── detect OS + package manager ──────────────────────────────────
OS="$(uname -s)"
PKG=""
case "$OS" in
  Darwin) have brew && PKG="brew" ;;
  Linux)
    if   have apt-get; then PKG="apt"
    elif have dnf;     then PKG="dnf"
    elif have pacman;  then PKG="pacman"
    fi ;;
esac
log "OS: $OS   package manager: ${PKG:-none}"

# pkg_install <brew-name> <apt-name> <dnf-name> <pacman-name>
pkg_install() {
  local brew="$1" apt="$2" dnf="$3" pac="$4"
  case "$PKG" in
    brew)   brew install "$brew" ;;
    apt)    sudo apt-get update -qq && sudo apt-get install -y "$apt" ;;
    dnf)    sudo dnf install -y "$dnf" ;;
    pacman) sudo pacman -S --noconfirm "$pac" ;;
    *) return 1 ;;
  esac
}

# ── git submodule (tracer source) ────────────────────────────────
if [ -f tracer/opt-cpp-backend/run_cpp_backend.py ]; then
  ok "tracer submodule present"
else
  log "fetching tracer submodule"
  git submodule update --init --recursive
fi

# ── Python 3.11+ ─────────────────────────────────────────────────
PYTHON=""
for cand in python3.13 python3.12 python3.11 python3; do
  if have "$cand" && "$cand" -c 'import sys; sys.exit(0 if sys.version_info>=(3,11) else 1)' 2>/dev/null; then
    PYTHON="$cand"; break
  fi
done
if [ -z "$PYTHON" ]; then
  log "installing Python 3.11+"
  pkg_install python@3.12 python3 python3 python || die "install Python 3.11+ manually"
  PYTHON="python3"
fi
ok "Python: $($PYTHON --version)"

# ── Node + npm ───────────────────────────────────────────────────
if ! have npm; then
  log "installing Node.js"
  pkg_install node nodejs nodejs nodejs || die "install Node.js manually (https://nodejs.org)"
fi
ok "Node: $(node --version)   npm: $(npm --version)"

# ── Docker (required by tracer; daemon must be running) ──────────
if ! have docker; then
  warn "Docker not found — the tracer needs it."
  case "$OS" in
    Darwin) warn "install Docker Desktop: https://www.docker.com/products/docker-desktop/" ;;
    Linux)  warn "install Docker Engine: https://docs.docker.com/engine/install/" ;;
  esac
  die "Docker required. Install it, start the daemon, then re-run."
fi
if ! docker info >/dev/null 2>&1; then
  die "Docker is installed but the daemon is not running. Start Docker and re-run."
fi
ok "Docker: $(docker --version)"

# ── build tracer image (skip if already built) ───────────────────
if docker image inspect "$TRACER_IMAGE" >/dev/null 2>&1; then
  ok "tracer image '$TRACER_IMAGE' already built"
else
  log "building tracer image '$TRACER_IMAGE' (first run is slow — compiles Valgrind)"
  docker build -t "$TRACER_IMAGE" tracer/
fi

# ── backend venv + deps ──────────────────────────────────────────
if [ ! -d backend/.venv ]; then
  log "creating backend virtualenv"
  "$PYTHON" -m venv backend/.venv
fi
log "installing backend dependencies"
backend/.venv/bin/python -m pip install --quiet --upgrade pip
# Runtime deps (mirrors backend/pyproject.toml). The backend is run from the
# backend/ dir with `app` imported via cwd, so no editable install is needed.
backend/.venv/bin/python -m pip install --quiet \
  "fastapi>=0.110" "uvicorn>=0.29" "pydantic>=2.6"
ok "backend ready"

# ── frontend deps (skip if up to date) ───────────────────────────
if [ frontend/node_modules -nt frontend/package-lock.json ] 2>/dev/null; then
  ok "frontend dependencies up to date"
else
  log "installing frontend dependencies"
  ( cd frontend && npm install --no-fund --no-audit )
fi
ok "frontend ready"

echo "  (optional) VSCode extension: cd extension && npm install && npm run package"

ok "install complete"
