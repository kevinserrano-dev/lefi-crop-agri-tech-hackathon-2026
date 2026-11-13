#!/usr/bin/env bash
# Removes everything the DEVELOPMENT Lefi Desktop (`pnpm dev:desktop`, identifier
# ai.leficrop.desktop.dev) left on this Mac, and ends its pairing with Lefi Brain (ADR-078).
# The installed Lefi Desktop (ai.leficrop.desktop) and Lefi Brain's data are never touched.
#
#   scripts/dev/desktop-dev-clean.sh            # show what would be removed
#   scripts/dev/desktop-dev-clean.sh --yes      # remove it (and revoke the dev pairing via `lefi`)
#
# macOS bash 3.2 compatible.
set -euo pipefail

DEV_ID="ai.leficrop.desktop.dev"
PROD_ID="ai.leficrop.desktop"
APPLY=0
case "${1:-}" in
  --yes) APPLY=1 ;;
  "") ;;
  *) echo "usage: $0 [--yes]" >&2; exit 2 ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This cleanup is for macOS." >&2
  exit 1
fi

DATA="$HOME/Library/Application Support/$DEV_ID"
# Unbundled (dev) runs keep WebView data under the executable's name, not the identifier.
PATHS=(
  "$DATA"
  "$HOME/Library/WebKit/lefi-desktop"
  "$HOME/Library/Caches/lefi-desktop"
  "$HOME/Library/WebKit/$DEV_ID"
  "$HOME/Library/Caches/$DEV_ID"
)

# Never remove anything of the installed app, whatever the variables above become.
for p in "${PATHS[@]}"; do
  case "$p" in
    *"/$PROD_ID" | *"/$PROD_ID/"*)
      echo "refusing: $p belongs to the installed Lefi Desktop" >&2
      exit 1
      ;;
  esac
done

# The development app must be closed first (matched by its executable path, never by text).
running=$(ps -axo pid=,comm= | awk '$2 ~ /\/target\/debug\/lefi-desktop$/ {print $1}')
if [ -n "$running" ]; then
  echo "The development Lefi Desktop is still running (pid $running). Close it first." >&2
  exit 1
fi

say() { if [ "$APPLY" = 1 ]; then echo "· $*"; else echo "· would $*"; fi; }

# 1. Its pairing with Lefi Brain: revoke it so the test device stops being trusted.
device_id=""
if [ -f "$DATA/pairing.json" ]; then
  device_id=$(sed -n 's/.*"device_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DATA/pairing.json" | head -n 1)
fi
if [ -n "$device_id" ]; then
  if [ "$APPLY" = 1 ] && command -v lefi >/dev/null 2>&1; then
    say "revoke the dev pairing $device_id on Lefi Brain"
    lefi pair revoke "$device_id" --reason "development Lefi Desktop removed" \
      || echo "  could not revoke it: do it in Administration → Paired PCs ($device_id)" >&2
  else
    say "revoke the dev pairing $device_id (lefi pair revoke $device_id, or Administration → Paired PCs)"
  fi
else
  echo "· no dev pairing found"
fi

# 2. Its keychain items (service = the dev identifier only).
n=0
while security find-generic-password -s "$DEV_ID" >/dev/null 2>&1; do
  n=$((n + 1))
  if [ "$APPLY" != 1 ]; then break; fi
  security delete-generic-password -s "$DEV_ID" >/dev/null 2>&1 || break
  [ "$n" -lt 100 ] || break
done
if [ "$n" -gt 0 ]; then say "delete keychain items of service $DEV_ID"; else echo "· no keychain items"; fi

# 3. Its folders.
for p in "${PATHS[@]}"; do
  if [ -e "$p" ]; then
    say "remove $p"
    if [ "$APPLY" = 1 ]; then rm -rf -- "$p"; fi
  fi
done

if [ "$APPLY" != 1 ]; then
  echo "Nothing removed. Run again with --yes."
else
  echo "Development Lefi Desktop removed. The installed Lefi Desktop and Lefi Brain were not touched."
fi
