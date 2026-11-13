# shellcheck shell=bash
# Hardware / OS detection. Sets: OS ARCH OS_VERSION HW_MODEL CHIP RAM_GB CPU_CORES LAN_IP DISK_FREE_GB HOST_NAME

detect_system() {
  OS="$(uname -s)"; ARCH="$(uname -m)"; HOST_NAME="$(hostname -s 2>/dev/null || hostname)"
  case "$OS" in
    Darwin)
      OS_VERSION="$(sw_vers -productVersion 2>/dev/null)"
      HW_MODEL="$(sysctl -n hw.model 2>/dev/null)"
      CHIP="$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
      RAM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 ))
      CPU_CORES="$(sysctl -n hw.ncpu 2>/dev/null)"
      LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
      ;;
    Linux)
      OS_VERSION="$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -r)"
      HW_MODEL="$(cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null || echo unknown)"
      CHIP="$(awk -F: '/model name/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null)"
      RAM_GB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1048576 ))
      CPU_CORES="$(nproc 2>/dev/null)"
      LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
      ;;
    *) die "Unsupported OS: $OS (supported: macOS, Linux)";;
  esac
  local _d="$LEFI_STATE_DIR"; while [ ! -d "$_d" ] && [ "$_d" != / ]; do _d="$(dirname "$_d")"; done
  DISK_FREE_GB=$(( $(df -Pk "$_d" | awk 'NR==2{print $4}') / 1048576 ))
  [ -z "$LAN_IP" ] && LAN_IP="unknown"
}

print_system() {
  header "This machine"
  info "Host:        $HOST_NAME ($LAN_IP)"
  info "OS:          $OS $OS_VERSION ($ARCH)"
  info "Model/chip:  ${HW_MODEL:-?} · ${CHIP:-?}"
  info "Memory/CPU:  ${RAM_GB} GB RAM · ${CPU_CORES} cores"
  info "Disk free:   ${DISK_FREE_GB} GB (repo volume)"
  if [ "$OS" = "Darwin" ] && [ "$ARCH" != "arm64" ]; then
    warn "Intel Mac detected: Ollama runs without Apple GPU acceleration and the MH3 starter is unsupported."
  fi
  if [ "$OS" = "Linux" ] && [ "$LEFI_SERVICE_MODE" = user ]; then
    warn "Linux development mode: packages are not installed and services stop at reboot."
  fi
}

is_macos() { [ "${OS:-$(uname -s)}" = "Darwin" ]; }

macos_major() { echo "${OS_VERSION%%.*}"; }
