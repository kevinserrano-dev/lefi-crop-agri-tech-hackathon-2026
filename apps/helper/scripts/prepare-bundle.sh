#!/bin/sh
# Stages what Lefi Crop Helper.app carries inside (ADR-034), then `tauri build` packs it:
#   src-tauri/binaries/lefi-helperd-<target>   the Lefi Crop Helper service (Tauri sidecar)
#   src-tauri/payload/                         the installer: bin scripts config deploy
#                                              services/brain (sources, no venv) and
#                                              desktop/Lefi Crop.app (always built here; required)
# Both folders are build outputs (git-ignored). macOS first; Linux/Windows are tech debt.
#   sh scripts/prepare-bundle.sh            (from apps/helper; `pnpm bundle` runs it)
set -eu
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TAURI="$HERE/src-tauri"
CARGO="${CARGO:-cargo}"
command -v "$CARGO" >/dev/null 2>&1 || CARGO="$HOME/.cargo/bin/cargo"

TRIPLE="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')"
[ -n "$TRIPLE" ] || TRIPLE="$("$HOME/.cargo/bin/rustc" -vV | sed -n 's/^host: //p')"

# LEFI_HACKATHON=1 (`pnpm bundle:hackathon`): the judges' package, activation without a code.
FEATURES=""; [ "${LEFI_HACKATHON:-0}" = 1 ] && FEATURES="--features hackathon"
echo "· Building the Lefi Crop Helper service (release, $TRIPLE${FEATURES:+, hackathon})"
# shellcheck disable=SC2086  # FEATURES is empty or two words on purpose
"$CARGO" build --release $FEATURES --manifest-path "$HERE/helperd/Cargo.toml"
mkdir -p "$TAURI/binaries"
cp "$HERE/helperd/target/release/lefi-helperd" "$TAURI/binaries/lefi-helperd-$TRIPLE"

echo "· Staging the installer payload"
P="$TAURI/payload"
rm -rf "$P"; mkdir -p "$P"
for d in bin scripts config deploy .env.example VERSION; do
  [ -e "$ROOT/$d" ] && cp -R "$ROOT/$d" "$P/"
done
rm -rf "$P/scripts/tests"
# The Brain is installed from its sources and lock file by uv (no virtual environment shipped).
mkdir -p "$P/services"
( cd "$ROOT/services" && tar -cf - --exclude .venv --exclude __pycache__ --exclude .pytest_cache \
    --exclude .mypy_cache --exclude .ruff_cache --exclude tests brain ) | ( cd "$P/services" && tar -xf - )

# The simulated robot's bridge (role `robot`, ADR-090): scripts/lib/robot_sim.sh runs it from
# payload/simulators/robot-mh3. Never the starter (vendor/, fetched on the PC at install) and never
# MH3.usd: its licence does not allow redistributing it (ADR-091). 0.15.0's first build lacked it.
mkdir -p "$P/simulators"
( cd "$ROOT/simulators" && tar -cf - --exclude vendor --exclude .venv --exclude __pycache__ \
    --exclude .pytest_cache --exclude .mypy_cache --exclude .ruff_cache --exclude tests robot-mh3 ) \
  | ( cd "$P/simulators" && tar -xf - )
for f in run.sh fetch-starter.sh pyproject.toml uv.lock src scene; do
  [ -e "$P/simulators/robot-mh3/$f" ] || {
    echo "✗ The robot bridge is incomplete in the payload: simulators/robot-mh3/$f is missing." >&2; exit 1; }
done
if [ -n "$(find "$P" \( -name vendor -o -iname '*.usd' -o -iname '*.usda' -o -iname '*.usdc' \) -print -quit)" ]; then
  echo "✗ The payload carries the MH3 starter or a USD model; it must never be redistributed." >&2; exit 1
fi

# Lefi Desktop is part of every Lefi Crop Helper package: the installer's `desktop` step and the
# updates offered to every PC (ADR-034, ADR-051) copy it from here. It is always built from this
# checkout, so a package never carries a stale copy or none (0.5.2 and 0.5.3 shipped without it
# because a missing build was only a warning). Never a warning: no Lefi Desktop, no package.
DESK_VER="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$ROOT/apps/desktop/src-tauri/tauri.conf.json" | head -1)"
APP="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Lefi Crop.app"
echo "· Building Lefi Desktop $DESK_VER (release)"
rm -rf "$APP"
( cd "$ROOT" && pnpm --filter @lefi/desktop tauri build --bundles app )
[ -n "$(ls "$APP/Contents/MacOS" 2>/dev/null)" ] || {
  echo "✗ Lefi Desktop was not built: $APP is missing. No package without it." >&2; exit 1; }
GOT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[ "$GOT" = "$DESK_VER" ] || {
  echo "✗ Lefi Desktop built as $GOT, expected $DESK_VER (apps/desktop/src-tauri/tauri.conf.json)." >&2; exit 1; }
mkdir -p "$P/desktop"; ditto "$APP" "$P/desktop/Lefi Crop.app"
echo "· Lefi Desktop $GOT included"
find "$P" -name .DS_Store -delete
# Documentation stays on the owner's machines: the installer needs none of it.
find "$P" -name '*.md' -not -path '*/Lefi Crop.app/*' -delete
if [ -n "$(find "$P" \( -iname 'CLAUDE.md' -o -name '.claude' -o -name docs \) -not -path '*/Lefi Crop.app/*' -print -quit)" ]; then
  echo "✗ The payload carries internal documentation or local tool settings." >&2; exit 1
fi
echo "· Payload: $(du -sh "$P" | awk '{print $1}') in $P"
