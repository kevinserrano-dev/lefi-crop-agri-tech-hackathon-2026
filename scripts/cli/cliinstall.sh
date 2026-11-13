# shellcheck shell=bash
# Global installation of the `lefi` command.

cli_target_dir() {
  local d
  for d in /opt/homebrew/bin /usr/local/bin; do [ -d "$d" ] && [ -w "$d" ] && { echo "$d"; return; }; done
  echo "$HOME/.local/bin"
}

cmd_cli() {
  case "${1:-}" in
    install) cli_install ;;
    uninstall) cli_uninstall ;;
    *) die "Usage: lefi cli install | lefi cli uninstall" ;;
  esac
}

cli_install() {
  if [ "$LEFI_SERVICE_MODE" = systemd ]; then
    info "System install: /usr/local/bin/lefi is installed by the installer (lefi setup, as an administrator)."
    return 0
  fi
  local dir link rc; dir="$(cli_target_dir)"; link="$dir/lefi"
  mkdir -p "$dir"
  if [ -e "$link" ] && [ ! -L "$link" ]; then die "$link exists and is not a symlink — not overwriting."; fi
  ln -sf "$LEFI_ROOT/bin/lefi" "$link" || die "Could not create $link"
  ok "Installed: $link → $LEFI_ROOT/bin/lefi"
  case ":$PATH:" in
    *":$dir:"*) ok "$dir is on your PATH" ;;
    *)
      rc="$HOME/.zshrc"; [ -n "$BASH_VERSION" ] && [ "$(basename "${SHELL:-}")" = bash ] && rc="$HOME/.bashrc"
      if confirm "Add $dir to PATH in $rc?" y INSTALL_CLI; then
        printf '\n# Lefi Crop AI CLI\nexport PATH="%s:$PATH"\n' "$dir" >>"$rc"; ok "Added to $rc — open a new terminal"
      else warn "Add $dir to your PATH to use 'lefi' from anywhere."; fi ;;
  esac
  info "Try: lefi help"
}

cli_uninstall() {
  local d removed=0
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
    if [ -L "$d/lefi" ] && [ "$(readlink "$d/lefi")" = "$LEFI_ROOT/bin/lefi" ]; then rm -f "$d/lefi"; ok "Removed $d/lefi"; removed=1; fi
  done
  [ "$removed" = 1 ] || info "No global 'lefi' link pointing to this repository was found."
}
