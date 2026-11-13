#!/usr/bin/env bash
# Run the MH3 bridge with the Genesis backend inside the starter's own environment (ADR-091).
# Extra arguments go to the bridge, e.g.: ./run.sh --cpu --port 8765 --feeds overview,head
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
starter="${LEFI_MH3_STARTER:-$here/vendor/GDG-Hackathon}"
if [ ! -x "$starter/run.sh" ]; then
  echo "MH3 starter not found in $starter: run ./fetch-starter.sh first" >&2
  exit 1
fi
export PYTHONPATH="$here/src${PYTHONPATH:+:$PYTHONPATH}"
exec "$starter/run.sh" python -m lefi_robot_sim --backend genesis --starter "$starter" "$@"
