# shellcheck shell=bash
# Hardware scan for the installer and `lefi hw` (INSTALLER.md §7.1). bash 3.2, no jq.
#
# Every value is read from the machine. When a value cannot be read, it is left empty here and
# reported as JSON null together with the reason (hw_unknown) — never guessed.
#
# hw_scan sets HW_* variables; hw_json prints them as JSON (schema lefi.hw.v1);
# hw_print prints a human summary.

HW_PORTS="1883 8000 8080 8443 11434"
HW_SYS="${HW_SYS:-/sys}"   # overridable only by the shell tests (scripts/tests)

# ---------------------------------------------------------------- JSON helpers
# json_q STRING -> JSON string literal (control characters become spaces).
json_q() {
  printf '"%s"' "$(printf '%s' "$1" | tr '\t\r\n' '   ' | tr -d '\000-\010\013\014\016-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}
json_qn() { if [ -n "$1" ]; then json_q "$1"; else printf 'null'; fi; }   # string or null
json_nn() { if [ -n "$1" ]; then printf '%s' "$1"; else printf 'null'; fi; } # number/bool or null
mb_to_gb() { [ -n "$1" ] && awk -v m="$1" 'BEGIN{printf "%.1f", m/1024}'; }

hw_unknown() {  # hw_unknown FIELD REASON
  HW_UNKNOWN="${HW_UNKNOWN}${HW_UNKNOWN:+,}{\"field\":$(json_q "$1"),\"reason\":$(json_q "$2")}"
  HW_UNKNOWN_TXT="${HW_UNKNOWN_TXT}$1: $2
"
}

# ---------------------------------------------------------------- GPUs
hw_gpu_add() {  # hw_gpu_add VENDOR NAME VRAM_MB SOURCE
  HW_GPU_N=$((HW_GPU_N + 1))
  eval "HW_GPU_${HW_GPU_N}_VENDOR=\$1; HW_GPU_${HW_GPU_N}_NAME=\$2; HW_GPU_${HW_GPU_N}_VRAM_MB=\$3; HW_GPU_${HW_GPU_N}_SOURCE=\$4"
  [ -n "$3" ] || hw_unknown "gpus[$((HW_GPU_N - 1))].vram_gb" "$5"
}

hw_scan_gpus_linux() {
  local out line name mem had_nv=0 had_amd=0 d ven dev slot nm vram
  if have nvidia-smi; then
    if out="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null)" && [ -n "$out" ]; then
      while IFS= read -r line; do
        name="$(printf '%s' "${line%,*}" | sed 's/^ *//; s/ *$//')"; mem="$(printf '%s' "${line##*,}" | tr -dc '0-9')"
        hw_gpu_add nvidia "$name" "$mem" nvidia-smi "nvidia-smi did not report memory.total"; had_nv=1
      done <<EOF
$out
EOF
    else hw_unknown "gpus" "nvidia-smi is installed but failed (driver not loaded?)"; fi
  fi
  if have rocm-smi; then
    # CSV columns differ between ROCm releases: find them by header name. TODO(verify) on a real AMD GPU.
    out="$(rocm-smi --showproductname --showmeminfo vram --csv 2>/dev/null)"
    if [ -n "$out" ]; then
      while IFS='|' read -r name mem; do
        [ -n "$name$mem" ] || continue
        [ -n "$mem" ] && mem=$((mem / 1048576))
        hw_gpu_add amd "${name:-AMD GPU}" "$mem" rocm-smi "rocm-smi did not report 'VRAM Total Memory (B)'"; had_amd=1
      done <<EOF
$(printf '%s\n' "$out" | awk -F',' 'NR==1{for(i=1;i<=NF;i++){h=$i; if(h ~ /Card [Ss]eries|Card SKU/ && !n) n=i; if(h ~ /VRAM Total Memory \(B\)/) v=i}; next}
  NF>1 {printf "%s|%s\n", (n?$n:""), (v?$v:"")}')
EOF
    else hw_unknown "gpus" "rocm-smi is installed but printed nothing"; fi
  fi
  # Kernel view (no vendor tool needed): /sys/class/drm/cardN/device/vendor.
  for d in "$HW_SYS"/class/drm/card[0-9]*; do
    [ -e "$d/device/vendor" ] || continue
    case "$d" in *-*) continue ;; esac
    ven="$(cat "$d/device/vendor" 2>/dev/null)"; dev="$(cat "$d/device/device" 2>/dev/null)"
    slot="$(basename "$(readlink -f "$d/device" 2>/dev/null)")"
    nm=""; have lspci && nm="$(lspci -s "$slot" 2>/dev/null | sed 's/^[^:]*: //' | head -n1)"
    case "$ven" in
      0x10de) [ "$had_nv" = 1 ] && continue
        hw_gpu_add nvidia "${nm:-NVIDIA GPU (PCI $ven:$dev)}" "" sysfs "NVIDIA GPU found but nvidia-smi is missing or failed (NVIDIA driver not installed?)" ;;
      0x1002) [ "$had_amd" = 1 ] && continue
        vram="$(cat "$d/device/mem_info_vram_total" 2>/dev/null)"; [ -n "$vram" ] && vram=$((vram / 1048576))
        hw_gpu_add amd "${nm:-AMD GPU (PCI $ven:$dev)}" "$vram" sysfs "amdgpu did not expose mem_info_vram_total" ;;
      0x8086) hw_gpu_add intel "${nm:-Intel GPU (PCI $ven:$dev)}" "" sysfs "Intel GPUs share system memory; Lefi Crop does not count them as an AI accelerator" ;;
      *) hw_gpu_add other "${nm:-GPU (PCI $ven:$dev)}" "" sysfs "unknown GPU vendor $ven" ;;
    esac
  done
}

# Choose the accelerator the model would run on: Apple Metal, NVIDIA CUDA or AMD ROCm only.
hw_pick_accelerator() {
  local i v vram best_mb="" best_name="" kind="" unk=""
  HW_ACCEL_KIND=none; HW_ACCEL_MB=""; HW_ACCEL_NAME=""; HW_ACCEL_REASON=""
  if [ "$HW_OS" = Darwin ]; then
    if [ "$HW_ARCH" = arm64 ]; then
      HW_ACCEL_KIND=apple; HW_ACCEL_NAME="${HW_CPU:-Apple Silicon} GPU (unified memory)"
      if [ -n "$HW_APPLE_WIRED_MB" ] && [ "$HW_APPLE_WIRED_MB" -gt 0 ] 2>/dev/null; then
        HW_ACCEL_MB="$HW_APPLE_WIRED_MB"; HW_ACCEL_REASON="GPU limit from sysctl iogpu.wired_limit_mb"
      elif [ "$HW_APPLE_WIRED_MB" = 0 ]; then
        HW_ACCEL_REASON="iogpu.wired_limit_mb = 0: macOS default GPU limit, whose exact size is TODO(verify)"
        hw_unknown "accelerator.memory_gb" "$HW_ACCEL_REASON"
      else
        HW_ACCEL_REASON="sysctl iogpu.wired_limit_mb is not available on this macOS"
        hw_unknown "accelerator.memory_gb" "$HW_ACCEL_REASON"
      fi
    else
      HW_ACCEL_REASON="Intel Mac: Ollama has no GPU acceleration here (CPU only)"
    fi
    return 0
  fi
  i=1
  while [ "$i" -le "$HW_GPU_N" ]; do
    eval "v=\$HW_GPU_${i}_VENDOR; vram=\$HW_GPU_${i}_VRAM_MB"
    case "$v" in
      nvidia|amd)
        if [ -n "$vram" ]; then
          # NVIDIA beats AMD at equal size only by order; the largest VRAM wins.
          if [ -z "$best_mb" ] || [ "$vram" -gt "$best_mb" ]; then best_mb="$vram"; kind="$v"; eval "best_name=\$HW_GPU_${i}_NAME"; fi
        else unk="$v"; [ -z "$best_name" ] && eval "best_name=\$HW_GPU_${i}_NAME"; fi ;;
    esac
    i=$((i + 1))
  done
  if [ -n "$best_mb" ]; then
    HW_ACCEL_KIND="$kind"; HW_ACCEL_MB="$best_mb"; HW_ACCEL_NAME="$best_name"
    HW_ACCEL_REASON="VRAM of the largest $kind GPU"
  elif [ -n "$unk" ]; then
    HW_ACCEL_KIND="$unk"; HW_ACCEL_NAME="$best_name"
    HW_ACCEL_REASON="$unk GPU found but its memory could not be read"
    hw_unknown "accelerator.memory_gb" "$HW_ACCEL_REASON"
  elif [ "$HW_GPU_N" -gt 0 ]; then
    HW_ACCEL_REASON="no NVIDIA, AMD or Apple Silicon GPU (the GPUs found are not counted as AI accelerators)"
  else
    HW_ACCEL_REASON="no GPU found (nvidia-smi, rocm-smi and /sys/class/drm report none)"
  fi
}

# ---------------------------------------------------------------- power, disk, ports
hw_scan_power() {
  HW_POWER_SOURCE=""; HW_BATT_PRESENT=""; HW_BATT_PCT=""
  if [ "$HW_OS" = Darwin ]; then
    local b; b="$(pmset -g batt 2>/dev/null)"
    if [ -z "$b" ]; then hw_unknown "power.source" "pmset -g batt printed nothing"; return 0; fi
    case "$b" in *"'AC Power'"*) HW_POWER_SOURCE=ac ;; *"'Battery Power'"*) HW_POWER_SOURCE=battery ;; esac
    if printf '%s' "$b" | grep -q InternalBattery; then
      HW_BATT_PRESENT=true; HW_BATT_PCT="$(printf '%s' "$b" | sed -n 's/.*[^0-9]\([0-9][0-9]*\)%.*/\1/p' | head -n1)"
    else HW_BATT_PRESENT=false; fi
    [ -n "$HW_POWER_SOURCE" ] || hw_unknown "power.source" "pmset did not name the power source"
    return 0
  fi
  local d t mains="" batt_status="" any=0
  for d in "$HW_SYS"/class/power_supply/*; do
    [ -e "$d/type" ] || continue; any=1; t="$(cat "$d/type" 2>/dev/null)"
    case "$t" in
      Mains|USB) [ "$(cat "$d/online" 2>/dev/null)" = 1 ] && mains=1 || { [ -z "$mains" ] && mains=0; } ;;
      Battery) HW_BATT_PRESENT=true; HW_BATT_PCT="$(cat "$d/capacity" 2>/dev/null)"; batt_status="$(cat "$d/status" 2>/dev/null)" ;;
    esac
  done
  [ -n "$HW_BATT_PRESENT" ] || HW_BATT_PRESENT=false
  if [ "$mains" = 1 ]; then HW_POWER_SOURCE=ac
  elif [ "$batt_status" = Discharging ]; then HW_POWER_SOURCE=battery
  elif [ "$mains" = 0 ] && [ "$HW_BATT_PRESENT" = true ]; then HW_POWER_SOURCE=battery
  elif [ "$HW_BATT_PRESENT" = true ] && [ -n "$batt_status" ]; then HW_POWER_SOURCE=ac
  fi
  if [ -z "$HW_POWER_SOURCE" ]; then
    if [ "$any" = 0 ]; then hw_unknown "power.source" "the kernel reports no power supply (desktop PC or virtual machine)"
    else hw_unknown "power.source" "power supplies found but none reports its state"; fi
  fi
  [ -n "$HW_BATT_PCT" ] || [ "$HW_BATT_PRESENT" = false ] || hw_unknown "power.battery_percent" "battery capacity not reported"
}

hw_scan_disk() {
  local p="${1:-$LEFI_STATE_DIR}" line
  while [ ! -d "$p" ] && [ "$p" != / ]; do p="$(dirname "$p")"; done
  HW_DISK_PATH="$p"; HW_DISK_FREE_MB=""; HW_DISK_TOTAL_MB=""
  line="$(df -Pk "$p" 2>/dev/null | awk 'NR==2{print $2, $4}')"
  if [ -n "$line" ]; then HW_DISK_TOTAL_MB=$(( ${line% *} / 1024 )); HW_DISK_FREE_MB=$(( ${line#* } / 1024 ))
  else hw_unknown "disk.free_gb" "df failed for $p"; fi
}

hw_port_process() {  # hw_port_process PORT -> listener process name (empty when not visible)
  if [ "$HW_OS" = Darwin ]; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -Fc 2>/dev/null | sed -n 's/^c//p' | head -n1
  elif have ss; then
    ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n1
  fi
}

hw_scan_ports() {
  local p rc
  for p in $HW_PORTS; do
    port_listening "$p"; rc=$?
    case "$rc" in
      0) eval "HW_PORT_$p=true; HW_PORT_${p}_PROC=\$(hw_port_process $p)"
         eval "[ -n \"\$HW_PORT_${p}_PROC\" ]" || hw_unknown "ports.$p.process" "listener not visible to $(id -un) (run as root to see it)" ;;
      1) eval "HW_PORT_$p=false; HW_PORT_${p}_PROC=" ;;
      *) eval "HW_PORT_$p=; HW_PORT_${p}_PROC="; hw_unknown "ports.$p.in_use" "neither lsof nor ss is available" ;;
    esac
  done
}

# ---------------------------------------------------------------- main scan
hw_scan() {
  HW_UNKNOWN=""; HW_UNKNOWN_TXT=""; HW_GPU_N=0; HW_APPLE_WIRED_MB=""
  HW_SCANNED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  HW_OS="$(uname -s)"; HW_ARCH="$(uname -m)"; HW_KERNEL="$(uname -r)"
  HW_HOST="$(hostname -s 2>/dev/null || hostname)"
  HW_OS_ID=""; HW_OS_LIKE=""; HW_OS_VERSION=""; HW_OS_NAME=""; HW_MODEL=""; HW_CPU=""; HW_CORES=""; HW_RAM_MB=""
  case "$HW_OS" in
    Darwin)
      HW_OS_ID=macos; HW_OS_VERSION="$(sw_vers -productVersion 2>/dev/null)"; HW_OS_NAME="macOS $HW_OS_VERSION"
      HW_MODEL="$(sysctl -n hw.model 2>/dev/null)"; HW_CPU="$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
      HW_CORES="$(sysctl -n hw.ncpu 2>/dev/null)"
      local mem; mem="$(sysctl -n hw.memsize 2>/dev/null)"; [ -n "$mem" ] && HW_RAM_MB=$((mem / 1048576))
      if [ "$HW_ARCH" = arm64 ]; then
        HW_APPLE_WIRED_MB="$(sysctl -n iogpu.wired_limit_mb 2>/dev/null)"
        [ -n "$HW_APPLE_WIRED_MB" ] || hw_unknown "apple_gpu.wired_limit_mb" "sysctl iogpu.wired_limit_mb is not available on this macOS"
      fi
      ;;
    Linux)
      if [ -r /etc/os-release ]; then
        HW_OS_ID="$(. /etc/os-release && echo "$ID")"; HW_OS_LIKE="$(. /etc/os-release && echo "$ID_LIKE")"
        HW_OS_VERSION="$(. /etc/os-release && echo "$VERSION_ID")"; HW_OS_NAME="$(. /etc/os-release && echo "$PRETTY_NAME")"
      else hw_unknown "os.name" "/etc/os-release is missing"; fi
      HW_MODEL="$(cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null)"
      HW_CPU="$(awk -F: '/model name/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo 2>/dev/null)"
      HW_CORES="$(nproc 2>/dev/null)"
      local kb; kb="$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null)"; [ -n "$kb" ] && HW_RAM_MB=$((kb / 1024))
      hw_scan_gpus_linux
      ;;
    *) hw_unknown "os" "unsupported operating system $HW_OS" ;;
  esac
  [ -n "$HW_MODEL" ] || hw_unknown "host.model" "the firmware does not report a product name"
  [ -n "$HW_CPU" ] || hw_unknown "cpu.model" "CPU model not reported"
  [ -n "$HW_RAM_MB" ] || hw_unknown "memory.total_gb" "total memory not reported"
  hw_pick_accelerator
  hw_scan_disk "$LEFI_STATE_DIR"
  hw_scan_power
  hw_scan_ports
  HW_SYSTEMD=false; [ -d /run/systemd/system ] && HW_SYSTEMD=true
  HW_PKG=""
  if [ "$HW_OS" = Darwin ]; then have brew && HW_PKG=brew
  else HW_PKG="$(linux_pkg_family)"; fi
  HW_OLLAMA_VERSION=""; local ob; ob="$(ollama_bin)"; [ -n "$ob" ] && HW_OLLAMA_VERSION="$(ollama_version "$ob")"
}

# ---------------------------------------------------------------- output
hw_gpus_json() {
  local i v n m s out=""
  i=1
  while [ "$i" -le "$HW_GPU_N" ]; do
    eval "v=\$HW_GPU_${i}_VENDOR; n=\$HW_GPU_${i}_NAME; m=\$HW_GPU_${i}_VRAM_MB; s=\$HW_GPU_${i}_SOURCE"
    out="$out${out:+,}{\"vendor\":$(json_q "$v"),\"name\":$(json_qn "$n"),\"vram_gb\":$(json_nn "$(mb_to_gb "$m")"),\"source\":$(json_q "$s")}"
    i=$((i + 1))
  done
  printf '[%s]' "$out"
}

hw_ports_json() {
  local p u pr out=""
  for p in $HW_PORTS; do
    eval "u=\$HW_PORT_$p; pr=\$HW_PORT_${p}_PROC"
    out="$out${out:+,}{\"port\":$p,\"in_use\":$(json_nn "$u"),\"process\":$(json_qn "$pr")}"
  done
  printf '[%s]' "$out"
}

# hw_json [RECOMMENDATION_JSON] — the scan as one JSON object (schema lefi.hw.v1).
hw_json() {
  printf '{"schema":"lefi.hw.v1","scanned_at":"%s",' "$HW_SCANNED_AT"
  printf '"host":{"name":%s,"model":%s},' "$(json_q "$HW_HOST")" "$(json_qn "$HW_MODEL")"
  printf '"os":{"kernel":%s,"id":%s,"id_like":%s,"version":%s,"name":%s,"arch":%s},' "$(json_q "$HW_OS")" \
    "$(json_qn "$HW_OS_ID")" "$(json_qn "$HW_OS_LIKE")" "$(json_qn "$HW_OS_VERSION")" "$(json_qn "$HW_OS_NAME")" "$(json_q "$HW_ARCH")"
  printf '"cpu":{"model":%s,"cores":%s},' "$(json_qn "$HW_CPU")" "$(json_nn "$HW_CORES")"
  printf '"memory":{"total_gb":%s},' "$(json_nn "$(mb_to_gb "$HW_RAM_MB")")"
  printf '"gpus":%s,' "$(hw_gpus_json)"
  if [ "$HW_OS" = Darwin ] && [ "$HW_ARCH" = arm64 ]; then
    printf '"apple_gpu":{"wired_limit_mb":%s},' "$(json_nn "$HW_APPLE_WIRED_MB")"
  else printf '"apple_gpu":null,'; fi
  printf '"accelerator":{"kind":%s,"name":%s,"memory_gb":%s,"basis":%s},' "$(json_q "$HW_ACCEL_KIND")" \
    "$(json_qn "$HW_ACCEL_NAME")" "$(json_nn "$(mb_to_gb "$HW_ACCEL_MB")")" "$(json_qn "$HW_ACCEL_REASON")"
  printf '"disk":{"path":%s,"free_gb":%s,"total_gb":%s},' "$(json_q "$HW_DISK_PATH")" \
    "$(json_nn "$(mb_to_gb "$HW_DISK_FREE_MB")")" "$(json_nn "$(mb_to_gb "$HW_DISK_TOTAL_MB")")"
  printf '"power":{"source":%s,"battery_present":%s,"battery_percent":%s},' "$(json_qn "$HW_POWER_SOURCE")" \
    "$(json_nn "$HW_BATT_PRESENT")" "$(json_nn "$HW_BATT_PCT")"
  printf '"ports":%s,' "$(hw_ports_json)"
  printf '"platform":{"systemd":%s,"package_manager":%s,"ollama_installed":%s,"ollama_version":%s},' "$HW_SYSTEMD" "$(json_qn "$HW_PKG")" "$( [ -n "$(ollama_bin)" ] && echo true || echo false)" "$(json_qn "$HW_OLLAMA_VERSION")"
  [ -n "$1" ] && printf '"recommendation":%s,' "$1"
  printf '"unknown":[%s]}\n' "$HW_UNKNOWN"
}

hw_val() { if [ -n "$1" ]; then printf '%s' "$1"; else printf 'unknown'; fi; }

hw_print() {
  local i v n m p u pr
  header "Hardware scan"
  info "Host:         $HW_HOST · $(hw_val "$HW_MODEL")"
  info "OS:           $(hw_val "$HW_OS_NAME") ($HW_ARCH)"
  info "CPU:          $(hw_val "$HW_CPU") · $(hw_val "$HW_CORES") cores"
  info "Memory:       $( [ -n "$HW_RAM_MB" ] && echo "$(mb_to_gb "$HW_RAM_MB") GB" || echo unknown)"
  i=1
  while [ "$i" -le "$HW_GPU_N" ]; do
    eval "v=\$HW_GPU_${i}_VENDOR; n=\$HW_GPU_${i}_NAME; m=\$HW_GPU_${i}_VRAM_MB"
    info "GPU $i:        $n ($v) · VRAM $( [ -n "$m" ] && echo "$(mb_to_gb "$m") GB" || echo unknown)"
    i=$((i + 1))
  done
  [ "$HW_GPU_N" = 0 ] && [ "$HW_OS" != Darwin ] && info "GPU:          none found"
  info "AI accelerator: $HW_ACCEL_KIND$( [ -n "$HW_ACCEL_MB" ] && echo " · $(mb_to_gb "$HW_ACCEL_MB") GB") — $HW_ACCEL_REASON"
  info "Disk free:    $( [ -n "$HW_DISK_FREE_MB" ] && echo "$(mb_to_gb "$HW_DISK_FREE_MB") GB" || echo unknown) on $HW_DISK_PATH"
  info "Power:        $(hw_val "$HW_POWER_SOURCE")$( [ "$HW_BATT_PRESENT" = true ] && echo " · battery ${HW_BATT_PCT:-?}%")"
  for p in $HW_PORTS; do
    eval "u=\$HW_PORT_$p; pr=\$HW_PORT_${p}_PROC"
    case "$u" in true) info "Port $p:   in use$( [ -n "$pr" ] && echo " by $pr")" ;; '') info "Port $p:   unknown" ;; esac
  done
  info "Platform:     systemd $HW_SYSTEMD · packages $(hw_val "$HW_PKG") · Ollama ${HW_OLLAMA_VERSION:-not installed}"
  if [ -n "$HW_UNKNOWN_TXT" ]; then
    info "Unknown (shown as null in --json):"
    printf '%s' "$HW_UNKNOWN_TXT" | sed 's/^/    - /' | while IFS= read -r l; do info "$l"; done
  fi
}
