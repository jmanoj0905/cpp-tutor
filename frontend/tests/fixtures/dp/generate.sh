#!/usr/bin/env bash
# Regenerates the dp fixtures from the real backend. Never hand-edit the
# .json files — rerun this after tracer changes instead.
# Requires the backend on :8000 with the tracer Docker image built.
set -euo pipefail
cd "$(dirname "$0")"
for name in climb-bottomup climb-topdown grid-paths input-fill; do
  echo "tracing $name..."
  python3 - "$name" <<'EOF'
import json, sys, urllib.request
name = sys.argv[1]
code = open(f"{name}.cpp").read()
req = urllib.request.Request(
    "http://localhost:8000/api/trace",
    data=json.dumps({"code": code, "lang": "cpp"}).encode(),
    headers={"Content-Type": "application/json"},
)
body = urllib.request.urlopen(req, timeout=120).read().decode()
parsed = json.loads(body)
assert "trace" in parsed, f"{name}: unexpected response {list(parsed)[:5]}"
open(f"{name}.json", "w").write(body)
print(f"  {name}.json: {len(parsed['trace'])} steps")
EOF
done
