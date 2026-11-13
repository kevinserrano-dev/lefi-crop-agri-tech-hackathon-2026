# shellcheck shell=bash
# Optional roles: MH3 robot simulator (official starter) and ESP32 firmware toolchain.

# role_robot_install — the simulated MH3 (ADR-091) as an on-demand service of this PC (ADR-090).
# Never on the AI node's PC: the robot's 3D simulation and the model would share one GPU.
# Answers: ROBOT_BACKEND (genesis = 3D with the MH3 model · lite = 2D map only), ROBOT_DOWNLOAD,
# ROBOT_CPU (Genesis physics on the CPU). Nothing starts at login: Lefi Brain turns it on and off.
role_robot_install() {
  local backend cpu="" uv_bin
  header "Simulated robot · MH3 (optional)"
  step_begin robot.install
  if robot_ai_here || roles_has ai; then
    DIE_CODE=ROBOT_ON_AI_NODE
    DIE_HINT="Install the simulated robot on another PC of the installation (one without the AI node)."
    die "This PC runs the AI node: the simulated robot is not installed here, so both keep their performance."
  fi
  ask "Robot simulation: genesis (3D, MH3 model) or lite (2D map only, no GPU)?" genesis ROBOT_BACKEND
  backend="$REPLY"
  case "$backend" in genesis|lite) ;; *) DIE_CODE=ANSWERS_INVALID; die "ROBOT_BACKEND must be genesis or lite, not '$backend'." ;; esac
  install_uv || die "uv required."
  uv_bin="$(command -v uv)"
  # Reinstalling: the running simulator is stopped first (it is started again from Lefi Desktop).
  if [ "$DRY_RUN" != 1 ] && robot_installed && robot_running; then robot_stop >/dev/null; fi
  if [ "$backend" = genesis ]; then
    if is_macos; then
      [ "$ARCH" = arm64 ] || { DIE_CODE=ROBOT_UNSUPPORTED; die "The MH3 starter supports Apple Silicon Macs only (choose lite here)."; }
      [ "$(macos_major)" -ge 14 ] 2>/dev/null || { DIE_CODE=ROBOT_UNSUPPORTED; die "The MH3 starter needs macOS 14 or later (choose lite here)."; }
    fi
    info "Licence: the starter's code is MIT; MH3.usd may be used only for the GDG Windsor hackathon submissions."
    confirm "Download the MH3 starter and its packages (several GB, once)?" y ROBOT_DOWNLOAD \
      || { DIE_CODE=CANCELLED_BY_USER; die "The simulated robot needs the starter download."; }
    pkg_install git git || die "git required."
    if [ "$DRY_RUN" = 1 ]; then run git clone "$ROBOT_STARTER_URL" "$ROBOT_STARTER"
    else
      if [ ! -d "$ROBOT_STARTER/.git" ]; then
        step "Downloading the MH3 starter"
        mkdir -p "$(dirname "$ROBOT_STARTER")"
        run git clone --quiet "$ROBOT_STARTER_URL" "$ROBOT_STARTER" || { DIE_CODE=NETWORK; die "Could not download the MH3 starter."; }
      fi
      run git -C "$ROBOT_STARTER" fetch --quiet origin "$ROBOT_STARTER_COMMIT" || run git -C "$ROBOT_STARTER" fetch --quiet origin
      run git -C "$ROBOT_STARTER" checkout --quiet "$ROBOT_STARTER_COMMIT" \
        || { DIE_CODE=NETWORK; die "Could not check out the pinned MH3 starter commit."; }
    fi
    confirm "Run Genesis physics on the CPU (slower; only if this PC has no usable GPU)?" n ROBOT_CPU && cpu="--cpu"
    step "Setting up the starter (PyTorch, Genesis — this takes a while)"
    # shellcheck disable=SC2086
    (cd "$ROBOT_STARTER" && run_visible ./setup.sh $cpu) || { DIE_CODE=ROBOT_SETUP; die "The starter's setup failed (see the log)."; }
    [ "$DRY_RUN" = 1 ] || robot_write_conf genesis "$ROBOT_HOME/run.sh" ${cpu:+"$cpu"} --port "$ROBOT_PORT_DEFAULT" --token-file "$ROBOT_TOKEN"
  else
    step "Preparing Python for the 2D robot"
    run "$uv_bin" python install 3.12 || die "Could not install Python 3.12 with uv."
    [ "$DRY_RUN" = 1 ] || robot_write_conf lite "$uv_bin" run --no-project --python 3.12 python -m lefi_robot_sim \
      --backend lite --port "$ROBOT_PORT_DEFAULT" --token-file "$ROBOT_TOKEN"
  fi
  [ "$DRY_RUN" = 1 ] || _j j_file "$ROBOT_CONF"
  if is_macos && [ "$DRY_RUN" != 1 ]; then robot_write_plist; _j j_file "$(robot_plist)"; fi
  ok "Simulated robot installed ($backend) — off until Lefi Brain turns it on (simulation only, no physical robot)"
}

role_firmware_install() {
  header "Firmware toolchain · PlatformIO for ESP32 (optional)"
  step_begin firmware.install
  install_uv || die "uv required."
  if have pio; then ok "PlatformIO $(pio --version 2>/dev/null)"; return 0; fi
  step "Installing PlatformIO CLI (uv tool)"
  run uv tool install platformio || die "PlatformIO installation failed."
  ok "PlatformIO installed (the ESP32 platform downloads on first build)"
  if is_macos; then info "USB-serial drivers depend on the ESP32 board's chip — verify once the board model is known."; fi
}
