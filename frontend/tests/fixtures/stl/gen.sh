#!/usr/bin/env bash
# Generate a real backend trace fixture.
# Prereqs: tracer image built (docker build -t cpp-tutor-tracer:dev tracer/)
#          backend running:  cd backend && .venv/bin/uvicorn app.api:app --port 8000
# Usage:   ./gen.sh <name> <path-to-.cpp>
set -euo pipefail
name="$1"; src="$2"
dir="$(cd "$(dirname "$0")" && pwd)"
code="$(cat "$src")"
python3 - "$code" <<'PY' > "$dir/req.json"
import json, sys
print(json.dumps({"code": sys.argv[1], "lang": "cpp"}))
PY
curl -s -X POST localhost:8000/api/trace \
  -H 'Content-Type: application/json' --data @"$dir/req.json" \
  | python3 -m json.tool > "$dir/${name}.json"
rm -f "$dir/req.json"
echo "wrote $dir/${name}.json"
