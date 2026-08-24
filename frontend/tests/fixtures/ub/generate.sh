#!/usr/bin/env bash
# Regenerates the undefined-behaviour fixtures straight from the tracer image.
# Never hand-edit the .json files — rerun this after tracer changes instead.
# Unlike the graph fixtures this talks to the container directly, so it needs
# no backend running; the tracer's --jsondump output IS the backend's response.
set -euo pipefail
cd "$(dirname "$0")"
IMAGE="${CPP_TUTOR_IMAGE:-cpp-tutor-tracer:dev}"
for f in *.cpp; do
  name="${f%.cpp}"
  echo "tracing $name..."
  docker run --rm -i "$IMAGE" python /opt/tracer/run_cpp_backend.py \
    "$(cat "$f")" cpp --jsondump 2>/dev/null > "$name.json"
  python3 - "$name" <<'EOF'
import json, sys
name = sys.argv[1]
d = json.load(open(f"{name}.json"))
tr = d["trace"]
bad = [p for p in tr if p.get("event") != "step_line"]
print(f"  {name}.json: {len(tr)} steps, events={[p['event'] for p in bad] or 'none'}")
EOF
done
