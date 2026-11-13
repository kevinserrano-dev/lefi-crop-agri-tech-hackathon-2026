# shellcheck shell=bash
# Packages and services.
#   macOS  (LEFI_SERVICE_MODE=launchd): Homebrew + user LaunchAgents (start at login).
#   Linux  (LEFI_SERVICE_MODE=systemd): apt (Ubuntu/Debian) or dnf (RHEL/Rocky/Alma) + system
#          units lefi-*.service running as the `lefi` user, enabled at boot (ADR-029).
#   Linux  (LEFI_SERVICE_MODE=user): development only — nothing installed, nohup processes.

SYSTEMCTL="$(command -v systemctl 2>/dev/null || echo /usr/bin/systemctl)"

ensure_brew() {
  is_macos || return 0
  if ! have brew; then
    for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      [ -x "$p" ] && eval "$("$p" shellenv)" && break
    done
  fi
  lefi_brew_path
  if have brew; then ok "Homebrew $(brew --version | head -n1 | awk '{print $2}')"; return 0; fi
  warn "Homebrew is not installed (needed once, with internet, to install the tools)."
  confirm "Install Homebrew now from https://brew.sh ?" y INSTALL_HOMEBREW || die "Homebrew is required on macOS."
  if [ "$DRY_RUN" = "1" ]; then run /bin/bash -c "install Homebrew"; return 0; fi
  local hb_in=/dev/tty
  if [ -n "$ANSWERS_FILE" ]; then   # unattended: no terminal (TODO(verify) on a Mac without Homebrew)
    export NONINTERACTIVE=1; hb_in=/dev/null
    # Homebrew needs sudo once; with this it asks through a macOS password dialog.
    [ -x "$LEFI_ROOT/scripts/lib/askpass-macos.sh" ] && export SUDO_ASKPASS="$LEFI_ROOT/scripts/lib/askpass-macos.sh"
  fi
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" <"$hb_in" \
    || die_known "Homebrew installation failed."
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$p" ] && eval "$("$p" shellenv)" && break; done
  lefi_brew_path
  have brew || die "brew not found after installation."
  _j j_add manual "Homebrew was installed by this run and is kept (other software may use it). Remove it with Homebrew's official uninstall script if you do not need it."
}

# ---------------------------------------------------------------- Linux packages
# linux_pkg_family -> apt | dnf | "" (from /etc/os-release ID and ID_LIKE).
linux_pkg_family() {
  [ -r /etc/os-release ] || return 0
  local ids; ids="$(. /etc/os-release && echo " $ID $ID_LIKE ")"
  case "$ids" in
    *" debian "*|*" ubuntu "*) have apt-get && echo apt ;;
    *" rhel "*|*" centos "*|*" fedora "*|*" rocky "*|*" almalinux "*) have dnf && echo dnf ;;
  esac
  return 0
}

# Tier list (INSTALLER.md §8.5). Only versions run for real are called verified (docs/STATUS.md).
linux_tier() {
  local id v; id="$(. /etc/os-release 2>/dev/null && echo "$ID")"; v="$(. /etc/os-release 2>/dev/null && echo "$VERSION_ID")"
  case "$id" in
    ubuntu) case "$v" in *.04) echo "1 (Ubuntu LTS)" ;; *) echo "unsupported (Ubuntu non-LTS)" ;; esac ;;
    rhel|rocky|almalinux) echo "1 (RHEL family)" ;;
    debian) echo "2 (Debian)" ;;
    *) echo "unsupported" ;;
  esac
}

APT_UPDATED=0
linux_pkg_install() {  # linux_pkg_install PKG... — apt-get / dnf, non-interactive, versions recorded
  local fam p; fam="$(linux_pkg_family)"
  case "$fam" in
    apt)
      if [ "$APT_UPDATED" = 0 ]; then run env DEBIAN_FRONTEND=noninteractive apt-get update -q || return 1; APT_UPDATED=1; fi
      _j j_pkg_begin
      run env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "$@"; local rc=$?
      _j j_pkg_end apt; [ "$rc" = 0 ] || return 1 ;;
    dnf) _j j_pkg_begin; run dnf install -y -q "$@"; local rc=$?; _j j_pkg_end dnf; [ "$rc" = 0 ] || return 1 ;;
    *) err "No supported package manager (apt or dnf) on this Linux"; return 1 ;;
  esac
  [ "$DRY_RUN" = 1 ] && return 0
  for p in "$@"; do record_component "$p" "$(pkg_version "$p")" "$fam $(pkg_origin "$p")"; done
}

pkg_version() {
  case "$(linux_pkg_family)" in
    apt) dpkg-query -W -f='${Version}' "$1" 2>/dev/null ;;
    dnf) case "$1" in
           *'('*) rpm -q --whatprovides --qf '%{NAME} %{VERSION}-%{RELEASE}\n' "$1" 2>/dev/null | head -n1 ;;
           *) rpm -q --qf '%{VERSION}-%{RELEASE}\n' "$1" 2>/dev/null | head -n1 ;;
         esac ;;
  esac
}

# pkg_origin PKG — repository the installed package came from (apt: source URL, dnf: repo id).
pkg_origin() {
  case "$(linux_pkg_family)" in
    apt) apt-cache policy "$1" 2>/dev/null | awk '/\*\*\*/{f=1; next} f && /(https?|file):/{print $2; exit}' ;;
    dnf) dnf -q list --installed "$1" 2>/dev/null | awk 'NF>=3 && $1 ~ /^'"$1"'\./{sub(/^@/,"",$3); print $3; exit}' ;;
  esac
}

pkg_installed() {  # pkg_installed PKG
  case "$(linux_pkg_family)" in
    apt) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed' ;;
    dnf) rpm -q "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# record_component NAME VERSION SOURCE — what this installer installed (INSTALLER.md §8.2).
record_component() {
  [ "$DRY_RUN" = 1 ] && return 0
  local f="$LEFI_STATE_DIR/install/components.tsv"
  _j j_file "$f"
  mkdir -p "$(dirname "$f")"
  [ -f "$f" ] || printf '# component\tversion\tsource\tinstalled_at\n' >"$f"
  printf '%s\t%s\t%s\t%s\n' "$1" "${2:-?}" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$f"
  _log "COMPONENT $1 ${2:-?} ($3)"
}

# EPEL carries Mosquitto for the RHEL family.
ensure_epel() {
  [ "$(linux_pkg_family)" = dnf ] || return 0
  pkg_installed epel-release && return 0
  local id major; id="$(. /etc/os-release && echo "$ID")"; major="$(. /etc/os-release && echo "${VERSION_ID%%.*}")"
  step "Enabling EPEL (Mosquitto for the RHEL family)"
  case "$id" in
    rhel) linux_pkg_install "https://dl.fedoraproject.org/pub/epel/epel-release-latest-$major.noarch.rpm" ;;
    fedora) return 0 ;;
    *) linux_pkg_install epel-release ;;
  esac || die "Could not enable EPEL."
}

# brew_find_program CMD FORMULA — true when CMD can run now: also looks in Homebrew's sbin and in
# the formula's own folder (a formula may not be linked into the prefix).
brew_find_program() {
  have "$1" && return 0
  lefi_brew_path
  have "$1" && return 0
  local keg d
  keg="$(brew --prefix "$2" 2>/dev/null)"
  for d in "$keg/bin" "$keg/sbin"; do
    if [ -x "$d/$1" ]; then PATH="$d:$PATH"; export PATH; return 0; fi
  done
  return 1
}

# pkg_install CMD FORMULA [APT_PKGS] [DNF_PKGS] — installs a CLI tool if missing.
pkg_install() {
  local cmd="$1" formula="$2" apt_pkgs="${3:-$2}" dnf_pkgs="${4:-${3:-$2}}"
  if have "$cmd"; then ok "$cmd present"; return 0; fi
  if is_macos; then
    step "Installing $formula (Homebrew)"
    _j j_pkg_begin
    run_visible brew install "$formula"; local rc=$?
    if [ "$rc" != 0 ] && transient_failure; then
      warn "brew install $formula failed; trying once more in 20 seconds."
      sleep 20
      run_visible brew install "$formula"; rc=$?
    fi
    _j j_pkg_end brew
    [ "$rc" = 0 ] || die_known "brew install $formula failed."
    [ "$DRY_RUN" = "1" ] || brew_find_program "$cmd" "$formula" || {
      DIE_CODE=PROGRAM_NOT_FOUND
      DIE_HINT="Homebrew reports $formula as installed. In Terminal run: brew reinstall $formula and press Retry."
      die "$cmd still missing after installing $formula."
    }
    [ "$DRY_RUN" = "1" ] || record_component "$formula" "$(brew list --versions "$formula" 2>/dev/null | awk '{print $2}')" brew
    ok "$cmd installed"
  elif [ "$LEFI_SERVICE_MODE" = systemd ]; then
    local pk; case "$(linux_pkg_family)" in dnf) pk="$dnf_pkgs" ;; *) pk="$apt_pkgs" ;; esac
    step "Installing $pk ($(linux_pkg_family))"
    # shellcheck disable=SC2086
    linux_pkg_install $pk || die "Could not install $pk."
    [ "$DRY_RUN" = "1" ] || have "$cmd" || [ -x "/usr/sbin/$cmd" ] || die "$cmd still missing after installing $pk."
    ok "$cmd installed"
  else
    err "$cmd is missing. Install it (package: $apt_pkgs), or use the system install (--service-mode systemd)."
    return 1
  fi
}

# uv is not packaged by Ubuntu/RHEL: official standalone installer into /usr/local/bin.
install_uv() {
  if have uv; then ok "uv present ($(uv --version 2>/dev/null | awk '{print $2}'))"; return 0; fi
  if is_macos; then pkg_install uv uv; return; fi
  if [ "$LEFI_SERVICE_MODE" != systemd ]; then
    err "uv is missing. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"; return 1
  fi
  step "Installing uv (official installer from astral.sh into /usr/local/bin)"
  if [ "$DRY_RUN" = 1 ]; then run sh -c "curl -LsSf https://astral.sh/uv/install.sh | UV_INSTALL_DIR=/usr/local/bin sh"; return 0; fi
  _j j_file /usr/local/bin/uv; _j j_file /usr/local/bin/uvx
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh >>"$LOG_FILE" 2>&1 \
    || die "uv installation failed (see $LOG_FILE)."
  have uv || die "uv not found after installation."
  record_component uv "$(uv --version | awk '{print $2}')" "astral.sh installer"
  ok "uv $(uv --version | awk '{print $2}') installed"
}

# Caddy from its official repository (Cloudsmith for apt, COPR @caddy/caddy for dnf).
install_caddy() {
  if have caddy; then ok "caddy present"; return 0; fi
  if is_macos; then pkg_install caddy caddy; return; fi
  [ "$LEFI_SERVICE_MODE" = systemd ] || { err "Caddy is missing: https://caddyserver.com/docs/install"; return 1; }
  case "$(linux_pkg_family)" in
    apt)
      step "Adding the official Caddy apt repository (Cloudsmith)"
      linux_pkg_install ca-certificates curl gnupg || die "Could not install curl/gnupg."
      if [ "$DRY_RUN" != 1 ]; then
        _j j_file /usr/share/keyrings/caddy-stable-archive-keyring.gpg; _j j_file /etc/apt/sources.list.d/caddy-stable.list
        curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
          | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>>"$LOG_FILE" \
          || die "Could not fetch the Caddy signing key."
        curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list \
          || die "Could not fetch the Caddy repository definition."
        chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
      fi
      APT_UPDATED=0 ;;
    dnf)
      step "Adding the official Caddy repository (COPR @caddy/caddy)"
      linux_pkg_install 'dnf-command(copr)' || die "Could not install the dnf COPR plugin."
      local copr_had=0; dnf copr list 2>/dev/null | grep -q 'caddy/caddy' && copr_had=1
      run dnf copr enable -y @caddy/caddy || die "Could not enable COPR @caddy/caddy."
      [ "$copr_had" = 1 ] || _j j_add copr_enabled @caddy/caddy ;;
  esac
  # EPEL and Ubuntu universe carry older Caddy builds: never fall back to them silently.
  if [ "$(linux_pkg_family)" = dnf ]; then
    _j j_pkg_begin; run dnf install -y -q --disablerepo=epel caddy; local rc=$?; _j j_pkg_end dnf
    [ "$rc" = 0 ] || { DIE_CODE=PKG_SOURCE; die "Could not install caddy from COPR @caddy/caddy (repository unreachable?)."; }
    [ "$DRY_RUN" = 1 ] || record_component caddy "$(pkg_version caddy)" "dnf $(pkg_origin caddy)"
  else
    linux_pkg_install caddy || die "Could not install caddy."
  fi
  if [ "$DRY_RUN" != 1 ]; then
    local origin; origin="$(pkg_origin caddy)"
    case "$origin" in
      *cloudsmith*|*copr*caddy*) ok "Caddy $(pkg_version caddy) from the official repository ($origin)" ;;
      *) DIE_CODE=PKG_SOURCE; DIE_HINT="Check access to dl.cloudsmith.io (apt) or copr.fedorainfracloud.org (dnf)"
         die "caddy was installed from '${origin:-unknown}', not from the official Caddy repository." ;;
    esac
  fi
  CADDY_INSTALLED_NOW=1
  ok "caddy installed"
}

# ---------------------------------------------------------------- service user & layout (systemd)
nologin_shell() { for s in /usr/sbin/nologin /sbin/nologin; do [ -x "$s" ] && { echo "$s"; return; }; done; echo /bin/false; }

ensure_service_user() {
  [ "$LEFI_SERVICE_MODE" = systemd ] || return 0
  if id "$SERVICE_USER" >/dev/null 2>&1; then ok "Service user '$SERVICE_USER' exists"
  else
    step "Creating the service user '$SERVICE_USER' (system account, no login)"
    run useradd --system --user-group --home-dir "$LEFI_STATE_DIR" --no-create-home \
      --shell "$(nologin_shell)" --comment "Lefi Crop AI services" "$SERVICE_USER" || die "useradd failed."
    _j j_add user_created "$SERVICE_USER"
    ok "Service user '$SERVICE_USER' created"
  fi
  local g
  for g in render video; do   # GPU device access for Ollama (AMD ROCm / some NVIDIA setups)
    getent group "$g" >/dev/null 2>&1 && run usermod -a -G "$g" "$SERVICE_USER"
  done
  _j j_mkdir "$LEFI_RUNTIME_DIR"; _j j_mkdir "$LEFI_STATE_DIR"; _j j_mkdir "$(dirname "$ENV_FILE")"
  run install -d -o root -g root -m 755 "$LEFI_RUNTIME_DIR"
  run install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$LEFI_STATE_DIR"
  # install.conf (no secrets) must be readable by technicians; lefi.env itself is 600.
  run install -d -o root -g root -m 755 "$(dirname "$ENV_FILE")"
  if [ "$DRY_RUN" != 1 ]; then
    local k
    _j j_file "$LEFI_INSTALL_CONF"
    {
      echo "# Lefi Crop AI system install (written by scripts/install.sh; no secrets here)"
      for k in LEFI_SERVICE_MODE LEFI_STATE_DIR ENV_FILE LEFI_RUNTIME_DIR SERVICE_USER; do eval "echo \"$k=\$$k\""; done
      echo "LEFI_SOURCE=$LEFI_ROOT"
    } >"$LEFI_INSTALL_CONF"
    chmod 644 "$LEFI_INSTALL_CONF"
  fi
}

state_fix_owner() {  # files written by the root installer belong to the service user
  [ "$LEFI_SERVICE_MODE" = systemd ] && [ "$(id -u)" = 0 ] && [ "$DRY_RUN" != 1 ] || return 0
  id "$SERVICE_USER" >/dev/null 2>&1 || return 0
  [ -d "$LEFI_STATE_DIR" ] && chown -R "$SERVICE_USER:$SERVICE_USER" "$LEFI_STATE_DIR" \
    && chmod -R go-w,o-rwx "$LEFI_STATE_DIR" && chmod 750 "$LEFI_STATE_DIR"
  [ -f "$ENV_FILE" ] && { chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"; }
  return 0
}

# The runtimes in /opt are executed by the services: root-owned, never group/world-writable.
runtime_fix_perms() {
  [ "$LEFI_SERVICE_MODE" = systemd ] && [ "$(id -u)" = 0 ] && [ "$DRY_RUN" != 1 ] && [ -d "$LEFI_RUNTIME_DIR" ] || return 0
  chown -R root:root "$LEFI_RUNTIME_DIR" && chmod -R go-w,a+rX "$LEFI_RUNTIME_DIR"
}

# as_service_user CMD... — run as the service user when the installer/CLI is root (systemd mode).
as_service_user() {
  if [ "$LEFI_SERVICE_MODE" = systemd ] && [ "$(id -u)" = 0 ] && id "$SERVICE_USER" >/dev/null 2>&1; then
    state_fix_owner
    (cd "$LEFI_STATE_DIR" && runuser -u "$SERVICE_USER" -- "$@")
  else "$@"; fi
}

# systemctl for the CLI: root directly; the service user through the sudoers rule below.
lefi_systemctl() {  # lefi_systemctl VERB UNIT
  if [ "$(id -u)" = 0 ]; then "$SYSTEMCTL" "$1" "$2"
  else sudo -n "$SYSTEMCTL" "$1" "$2"; fi
}

# Only these exact commands, for the service user (lefi start/stop/ai off without a password).
write_sudoers() {
  [ "$LEFI_SERVICE_MODE" = systemd ] || return 0
  local f=/etc/sudoers.d/lefi-crop tmp u v list=""
  have sudo || pkg_install sudo sudo || die "sudo is required."
  for u in ollama mosquitto brain caddy; do
    for v in start stop restart enable disable; do list="$list${list:+, }$SYSTEMCTL $v lefi-$u.service"; done
  done
  if [ "$DRY_RUN" = 1 ]; then run write "$f"; return 0; fi
  tmp="$(mktemp)"
  { echo "# Lefi Crop AI — written by scripts/install.sh. The service user may control only its own units."
    echo "Cmnd_Alias LEFI_UNITS = $list"
    echo "$SERVICE_USER ALL=(root) NOPASSWD: LEFI_UNITS"; } >"$tmp"
  _j j_file "$f"
  if visudo -cf "$tmp" >>"$LOG_FILE" 2>&1; then install -o root -g root -m 440 "$tmp" "$f"; ok "sudoers rule $f (service control only)"
  else rm -f "$tmp"; die "Generated sudoers rule is invalid (see $LOG_FILE)."; fi
  rm -f "$tmp"
}

# A distribution package may start its own copy of a service (mosquitto.service on Debian,
# caddy.service, the Ollama script's ollama.service) on the port Lefi Crop needs.
vendor_service_off() {  # vendor_service_off UNIT INSTALLED_NOW(0|1)
  [ "$LEFI_SERVICE_MODE" = systemd ] && [ "$DRY_RUN" != 1 ] || return 0
  "$SYSTEMCTL" list-unit-files "$1" 2>/dev/null | grep -q "^$1" || return 0
  local active enabled
  active="$("$SYSTEMCTL" is-active "$1" 2>/dev/null)"; enabled="$("$SYSTEMCTL" is-enabled "$1" 2>/dev/null)"
  [ "$active" = active ] || [ "$enabled" = enabled ] || return 0
  if [ "$2" = 1 ]; then warn "The package started its own $1; Lefi Crop runs lefi-${1%.service}.service instead — disabling $1"
  else
    warn "$1 (not managed by Lefi Crop) is $active/$enabled and would compete for the same port."
    confirm "Stop and disable $1?" y STOP_VENDOR_SERVICES || die "Stop $1 or free its port, then re-run."
  fi
  "$SYSTEMCTL" disable --now "$1" >>"$LOG_FILE" 2>&1 || die "Could not disable $1."
  [ "$2" = 1 ] || _j j_add vendor_disabled "$1"   # one we installed just now goes with its package
  ok "$1 stopped and disabled"
}

# ---------------------------------------------------------------- services
# write_launch_agent LABEL LOGFILE "ENV1=v1 ENV2=v2" PROGRAM [ARGS...]
# macOS: user LaunchAgent (starts at login, restarts on crash).
write_launch_agent() {
  local label="$1" logfile="$2" envs="$3"; shift 3
  local plist="$HOME/Library/LaunchAgents/$label.plist"
  local args_xml="" env_xml="" a kv
  for a in "$@"; do args_xml="$args_xml    <string>$a</string>
"; done
  for kv in $envs; do
    env_xml="$env_xml    <key>${kv%%=*}</key><string>${kv#*=}</string>
"
  done
  if [ "$DRY_RUN" = "1" ]; then run launchctl bootstrap "gui/$(id -u)" "$plist" "# $*"; return 0; fi
  # Before touching anything: a service that runs now must not be stopped if it cannot come back.
  if ! lefi_launchd_ready; then
    DIE_CODE=NO_USER_SESSION
    DIE_HINT="Log in on this Mac (the service runs in the user's session) and try again. Nothing was stopped."
    err "Cannot start services on this Mac: nobody is logged in, or the Lefi Crop session helper is not running."
    return 1
  fi
  _j j_add svc_reload launchd "$label" "$plist"
  _j j_file "$plist"
  mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$logfile")"
  cat >"$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
$args_xml  </array>
  <key>EnvironmentVariables</key>
  <dict>
$env_xml  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$logfile</string>
  <key>StandardErrorPath</key><string>$logfile</string>
</dict>
</plist>
PLIST
  lefi_launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  _j j_add svc_stop launchd "$label"
  # launchd may still be finishing the bootout: one more try before giving up.
  if ! lefi_launchctl bootstrap "gui/$(id -u)" "$plist" >>"$LOG_FILE" 2>&1; then
    sleep 2
    lefi_launchctl bootstrap "gui/$(id -u)" "$plist" >>"$LOG_FILE" 2>&1 \
      || { err "launchctl could not load $plist"; return 1; }
  fi
  ok "Service $label loaded (starts at login)"
}

systemd_unit_name() { echo "lefi-$1.service"; }

# write_systemd_unit NAME LOGFILE "ENV..." PROGRAM ARGS... — system unit, enabled at boot.
write_systemd_unit() {
  local name="$1" logfile="$2" envs="$3"; shift 3
  local unit; unit="$(systemd_unit_name "$name")"
  local f="/etc/systemd/system/$unit" kv envlines="" extra_unit="" desc
  for kv in HOME="$LEFI_STATE_DIR" $envs; do envlines="${envlines}Environment=\"$kv\"
"; done
  case "$name" in
    ollama) desc="Ollama (local AI)"
      # Kill switch (`lefi ai off`): even an enabled unit does not start while the flag exists.
      extra_unit="ConditionPathExists=!$LEFI_STATE_DIR/flags/ai.disabled" ;;
    mosquitto) desc="Mosquitto (MQTT broker)" ;;
    brain) desc="Lefi Brain (backend API)"; extra_unit="After=lefi-mosquitto.service lefi-ollama.service" ;;
    caddy) desc="Lefi Gateway (Caddy)"; extra_unit="After=lefi-brain.service" ;;
    *) desc="$name" ;;
  esac
  if [ "$DRY_RUN" = 1 ]; then run write "$f" "(User=$SERVICE_USER, WantedBy=multi-user.target) $*"; return 0; fi
  _j j_add svc_reload systemd "$unit" "$f"
  _j j_file "$f"
  cat >"$f" <<UNIT
# Lefi Crop AI — generated by scripts/install.sh (do not edit; re-run the installer).
[Unit]
Description=Lefi Crop AI · $desc
Wants=network-online.target
After=network-online.target
$extra_unit

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$LEFI_STATE_DIR
${envlines}ExecStart=$*
Restart=on-failure
RestartSec=5
StandardOutput=append:$logfile
StandardError=append:$logfile
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$LEFI_STATE_DIR

[Install]
WantedBy=multi-user.target
UNIT
  chmod 644 "$f"
  "$SYSTEMCTL" daemon-reload >>"$LOG_FILE" 2>&1 || { err "systemctl daemon-reload failed"; return 1; }
  if "$SYSTEMCTL" cat "$unit" >/dev/null 2>&1 && have systemd-analyze; then
    systemd-analyze verify "$f" >>"$LOG_FILE" 2>&1 || warn "systemd-analyze reported issues for $unit (see $LOG_FILE)"
  fi
  _j j_add svc_stop systemd "$unit"
  "$SYSTEMCTL" enable "$unit" >>"$LOG_FILE" 2>&1 || { err "systemctl enable $unit failed"; return 1; }
  "$SYSTEMCTL" restart "$unit" >>"$LOG_FILE" 2>&1 || { err "systemctl restart $unit failed: $("$SYSTEMCTL" status "$unit" 2>&1 | tail -n 3)"; return 1; }
  ok "Service $unit enabled at boot and started (user $SERVICE_USER)"
}

# start_service NAME LOGFILE "ENV..." PROGRAM ARGS... — launchd · systemd · background process.
start_service() {
  local name="$1" logfile="$2" envs="$3"; shift 3
  case "$LEFI_SERVICE_MODE" in
    launchd)
      record_service "$name" "$logfile" "$envs" "$@"
      write_launch_agent "com.lefi-crop.$name" "$logfile" "$envs" "$@" ;;
    systemd)
      [ "$DRY_RUN" = 1 ] || { mkdir -p "$(dirname "$logfile")"; touch "$logfile"; }
      record_service "$name" "$logfile" "$envs" "$@"
      state_fix_owner
      write_systemd_unit "$name" "$logfile" "$envs" "$@" ;;
    *)
      record_service "$name" "$logfile" "$envs" "$@"
      local pidfile="$LEFI_STATE_DIR/run/$name.pid"
      if [ "$DRY_RUN" = "1" ]; then run "$@"; return 0; fi
      mkdir -p "$(dirname "$pidfile")" "$(dirname "$logfile")"
      if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
        kill "$(cat "$pidfile")" 2>/dev/null; sleep 1
      fi
      _j j_file "$pidfile"
      # shellcheck disable=SC2086
      env $envs nohup "$@" </dev/null >>"$logfile" 2>&1 &
      echo $! >"$pidfile"
      _j j_add svc_stop pid "$pidfile"
      disown 2>/dev/null || true
      ok "Service $name started in background (pid $(cat "$pidfile")) — Linux dev mode, not persistent" ;;
  esac
}

# record_service NAME LOGFILE ENVS PROGRAM ARGS... — remembers how a service is launched so the
# `lefi` CLI can start/stop/inspect it later (state dir, never committed).
record_service() {
  [ "$DRY_RUN" = "1" ] && return 0
  local name="$1" logfile="$2" envs="$3" a f="$LEFI_STATE_DIR/services/$1.svc"; shift 3
  _j j_file "$f"
  mkdir -p "$LEFI_STATE_DIR/services"
  { printf 'LOG=%s\n' "$logfile"; printf 'ENVS=%s\n' "$envs"
    for a in "$@"; do printf 'ARG=%s\n' "$a"; done; } >"$f"
}

wait_for_port() {  # wait_for_port PORT SECONDS
  [ "$DRY_RUN" = "1" ] && return 0
  local i=0
  while [ "$i" -lt "${2:-20}" ]; do port_listening "$1" && return 0; sleep 1; i=$((i + 1)); done
  return 1
}

# install_system_cli — systemd mode: a root-owned copy of the CLI in /opt/lefi-crop/app (the
# service user cannot read a checkout in a home directory) linked as /usr/local/bin/lefi.
# `lefi setup` from that copy runs the installer of the checkout recorded in install.conf.
install_system_cli() {
  local app="$LEFI_RUNTIME_DIR/app" d
  [ "$DRY_RUN" = 1 ] && { run install "$app" /usr/local/bin/lefi; return 0; }
  _j j_tree "$app"; _j j_file /usr/local/bin/lefi
  rm -rf "$app.new"; mkdir -p "$app.new"
  for d in bin scripts config deploy VERSION; do
    [ -e "$LEFI_ROOT/$d" ] && cp -R "$LEFI_ROOT/$d" "$app.new/"
  done
  chown -R root:root "$app.new"; chmod -R go-w "$app.new"; chmod -R a+rX "$app.new"
  rm -rf "$app"; mv "$app.new" "$app"
  ln -sfn "$app/bin/lefi" /usr/local/bin/lefi
  ok "lefi command installed: /usr/local/bin/lefi → $app/bin/lefi (re-run the installer after git pull)"
}
