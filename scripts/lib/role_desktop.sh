# shellcheck shell=bash
# Role: Lefi Desktop — the dashboard app for operators and supervisors (ADR-022, ADR-034).
# macOS: copies the app shipped inside the installer payload (`desktop/Lefi Crop.app`, staged by
# Lefi Crop Helper's bundle step) into /Applications (or ~/Applications without write access there).
# Journaled (ADR-032): Cancel/undo removes it, or restores the version that was there before.
# Linux and Windows packages are tech debt.

DESKTOP_APP_NAME="Lefi Crop.app"

# desktop_source — the app to install: payload copy first, then a local development build.
desktop_source() {
  local c
  for c in "${LEFI_DESKTOP_SRC:-}" "$LEFI_ROOT/desktop/$DESKTOP_APP_NAME" \
           "$LEFI_ROOT/apps/desktop/src-tauri/target/release/bundle/macos/$DESKTOP_APP_NAME"; do
    [ -n "$c" ] && [ -d "$c/Contents/MacOS" ] && { echo "$c"; return 0; }
  done
  return 1
}

desktop_dest() {
  local dir="${LEFI_DESKTOP_DIR:-}"
  if [ -z "$dir" ]; then
    if [ -w /Applications ]; then dir=/Applications; else dir="$HOME/Applications"; fi
  fi
  echo "$dir/$DESKTOP_APP_NAME"
}

role_desktop_install() {
  header "Lefi Desktop · dashboard"
  step_begin desktop.app
  if ! is_macos; then
    DIE_CODE=DESKTOP_UNSUPPORTED; DIE_HINT="Lefi Desktop is packaged for macOS only for now."
    die "Lefi Desktop cannot be installed on this operating system yet."
  fi
  local src dest ver
  dest="$(desktop_dest)"
  if ! src="$(desktop_source)"; then
    if [ "$DRY_RUN" = 1 ]; then
      warn "This installer does not contain the Lefi Desktop app (build it: pnpm --filter @lefi/helper bundle)."
      return 0
    fi
    DIE_CODE=DESKTOP_MISSING; DIE_HINT="Build it with: pnpm --filter @lefi/helper bundle (or pnpm --filter @lefi/desktop tauri build --bundles app)"
    die "This installer does not contain the Lefi Desktop app."
  fi
  if [ "$DRY_RUN" = 1 ]; then run ditto "$src" "$dest"; return 0; fi
  _j j_tree "$dest"
  [ -e "$dest" ] && rm -rf "$dest"   # the previous version is kept in the install journal
  mkdir -p "$(dirname "$dest")"
  ditto "$src" "$dest" || die "Could not copy Lefi Desktop to $dest."
  # Part of the installer the customer already approved: do not make them approve it a second time.
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
  ver="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$dest/Contents/Info.plist" 2>/dev/null)"
  record_component lefi-desktop "${ver:-?}" "Lefi Crop Helper payload"
  env_set LEFI_DESKTOP_APP "$dest"
  ok "Lefi Desktop ${ver:-} installed: $dest"
  info "It shows Lefi Brain's data once this PC is paired with Lefi Brain (pairing is not built yet)."
}
