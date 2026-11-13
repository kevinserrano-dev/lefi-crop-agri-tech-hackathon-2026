#!/usr/bin/env bash
# Fetch the official MH3 starter (Humanoid Application Lab x Mirsee Robotics) into vendor/ at a
# pinned commit and set it up (ADR-014, ADR-091). vendor/ is git-ignored: the starter's MIT notice
# and the separate MH3.usd terms (hackathon submissions only) stay with it, never in this repo.
#   ./fetch-starter.sh          fetch + run the starter's own setup (GPU if it finds one)
#   ./fetch-starter.sh --cpu    same, physics on the CPU
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
url="https://github.com/HumanoidAppLab/GDG-Hackathon.git"
commit="ec55144be4dc41a40d45317638e13c7ccfa5b791" # 2026-11-10, inspected for ADR-091
dest="$here/vendor/GDG-Hackathon"

if [ ! -d "$dest/.git" ]; then
  mkdir -p "$here/vendor"
  git clone --quiet "$url" "$dest"
fi
git -C "$dest" fetch --quiet origin "$commit" 2>/dev/null || git -C "$dest" fetch --quiet origin
git -C "$dest" checkout --quiet "$commit"
echo "MH3 starter at $commit in $dest"
echo "Its LICENSE.md applies; MH3.usd may be used only for the GDG Windsor hackathon submissions."
cd "$dest"
./setup.sh "$@"
