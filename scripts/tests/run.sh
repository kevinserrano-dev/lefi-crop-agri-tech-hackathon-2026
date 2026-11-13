#!/usr/bin/env bash
# Shell tests for the installer libraries (hardware scan, recommender, answers, events).
#   ./scripts/tests/run.sh          (also: make test-shell)
# Hardware that this CI machine does not have (NVIDIA, AMD, Apple Silicon) is exercised with
# FAKE command outputs written below — clearly test fixtures, never real measurements. A pass
# here proves the parsing and the decision rules, not that a real GPU reports the same text.
# bash 3.2 compatible, like the code under test.

set -o pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASSES=0; FAILS=0; SKIPS=0

t_ok()   { PASSES=$((PASSES + 1)); printf '  ok    %s\n' "$1"; }
t_skip() { SKIPS=$((SKIPS + 1)); printf '  skip  %s (%s)\n' "$1" "$2"; }
t_fail() { FAILS=$((FAILS + 1)); printf '  FAIL  %s\n        %s\n' "$1" "$2"; }
expect_eq() {  # expect_eq NAME GOT WANT
  if [ "$2" = "$3" ]; then t_ok "$1"; else t_fail "$1" "got '$2', want '$3'"; fi
}
json_get() {  # json_get FILE PYTHON_EXPR  (d = parsed JSON)
  python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2" 2>&1
}

# fakebin NAME SCRIPT_BODY — a fake command in $TMP/<case>/bin
fakebin() { mkdir -p "$CASE/bin"; printf '#!/bin/sh\n%s\n' "$2" >"$CASE/bin/$1"; chmod +x "$CASE/bin/$1"; }
# Cases simulate Linux unless they call mac_fakes, also when the tests run on a Mac.
new_case() {
  CASE="$TMP/$1"; mkdir -p "$CASE/bin" "$CASE/sys/class/drm" "$CASE/sys/class/power_supply" "$CASE/state"
  fakebin uname 'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; -r) echo 6.8.0-fake ;; *) echo Linux ;; esac'
}
# A fake `uname` saying Linux, for running the installer itself as on a Linux CI machine.
LINUX_BIN="$TMP/linux-bin"; mkdir -p "$LINUX_BIN"
printf '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; -r) echo 6.8.0-fake ;; *) echo Linux ;; esac\n' >"$LINUX_BIN/uname"; chmod +x "$LINUX_BIN/uname"

# scan_case NAME -> runs hw_scan + recommender with the case's fake PATH/sysfs, JSON in $CASE/hw.json
scan_case() {
  ( PATH="$CASE/bin:$PATH" HW_SYS="$CASE/sys" LEFI_STATE_DIR="$CASE/state" LEFI_SERVICE_MODE=user \
    LEFI_ROOT="$ROOT" bash -c '
      for lib in common detect hwscan recommend system role_ai; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
      hw_scan; recommend_models; hw_json "$(recommend_json)"' ) >"$CASE/hw.json" 2>"$CASE/err.txt"
}

echo "== hardware scan + recommendation (fake tool outputs)"

new_case nvidia24
fakebin nvidia-smi 'echo "NVIDIA GeForce RTX 4090, 24564"'
scan_case
expect_eq "nvidia 24 GB: valid JSON / accelerator" "$(json_get "$CASE/hw.json" 'd["accelerator"]["kind"], d["accelerator"]["memory_gb"]')" "('nvidia', 24.0)"
expect_eq "nvidia 24 GB: gemma4:12b fits on GPU" "$(json_get "$CASE/hw.json" 'd["recommendation"]["verdict"], d["recommendation"]["model"]')" "('ok', 'gemma4:12b')"

new_case nvidia8
fakebin nvidia-smi 'echo "NVIDIA GeForce RTX 4060, 8188"'
scan_case
expect_eq "nvidia 8 GB: 12b does not fit (7.4 + 1.5 > 8.0)" "$(json_get "$CASE/hw.json" '[m["fit"] for m in d["recommendation"]["models"]]')" "['no', 'unknown']"
expect_eq "nvidia 8 GB: e4b unmeasured -> verdict unknown" "$(json_get "$CASE/hw.json" 'd["recommendation"]["verdict"], d["recommendation"]["model"]')" "('unknown', 'gemma4:e4b')"

new_case nogpu
scan_case
expect_eq "no GPU: CPU only is refused" "$(json_get "$CASE/hw.json" 'd["accelerator"]["kind"], d["recommendation"]["verdict"], d["recommendation"]["model"]')" "('none', 'not_viable', None)"

new_case nvidia_nodriver
mkdir -p "$CASE/sys/class/drm/card0/device"; echo 0x10de >"$CASE/sys/class/drm/card0/device/vendor"; echo 0x2684 >"$CASE/sys/class/drm/card0/device/device"
scan_case
expect_eq "NVIDIA without nvidia-smi: VRAM null with a reason" "$(json_get "$CASE/hw.json" 'd["gpus"][0]["vram_gb"], any(u["field"]=="gpus[0].vram_gb" for u in d["unknown"])')" "(None, True)"
expect_eq "NVIDIA without nvidia-smi: fit unknown, default model" "$(json_get "$CASE/hw.json" 'd["recommendation"]["verdict"], d["recommendation"]["model"]')" "('unknown', 'gemma4:12b')"

new_case amd16
mkdir -p "$CASE/sys/class/drm/card1/device"; echo 0x1002 >"$CASE/sys/class/drm/card1/device/vendor"; echo 0x744c >"$CASE/sys/class/drm/card1/device/device"
echo 17163091968 >"$CASE/sys/class/drm/card1/device/mem_info_vram_total"
mkdir -p "$CASE/sys/class/drm/card1-DP-1"   # a connector entry must be ignored
scan_case
expect_eq "AMD 16 GB (amdgpu sysfs): accelerator" "$(json_get "$CASE/hw.json" 'd["accelerator"]["kind"], d["accelerator"]["memory_gb"], len(d["gpus"])')" "('amd', 16.0, 1)"
expect_eq "AMD 16 GB: 12b fits" "$(json_get "$CASE/hw.json" 'd["recommendation"]["verdict"]')" "ok"

new_case intel_igpu
mkdir -p "$CASE/sys/class/drm/card0/device"; echo 0x8086 >"$CASE/sys/class/drm/card0/device/vendor"; echo 0x46a6 >"$CASE/sys/class/drm/card0/device/device"
scan_case
expect_eq "Intel iGPU only: not an AI accelerator" "$(json_get "$CASE/hw.json" 'd["accelerator"]["kind"], d["recommendation"]["verdict"]')" "('none', 'not_viable')"

new_case laptop_battery
mkdir -p "$CASE/sys/class/power_supply/AC" "$CASE/sys/class/power_supply/BAT0"
echo Mains >"$CASE/sys/class/power_supply/AC/type"; echo 0 >"$CASE/sys/class/power_supply/AC/online"
echo Battery >"$CASE/sys/class/power_supply/BAT0/type"; echo 64 >"$CASE/sys/class/power_supply/BAT0/capacity"; echo Discharging >"$CASE/sys/class/power_supply/BAT0/status"
scan_case
expect_eq "Linux laptop on battery" "$(json_get "$CASE/hw.json" 'd["power"]["source"], d["power"]["battery_present"], d["power"]["battery_percent"]')" "('battery', True, 64)"

mac_fakes() {  # mac_fakes ARCH WIRED_MB(or 'none')
  fakebin uname "case \"\$1\" in -s) echo Darwin ;; -m) echo $1 ;; -r) echo 25.1.0 ;; *) echo Darwin ;; esac"
  fakebin sw_vers 'echo 26.1'
  local w="echo $2"; [ "$2" = none ] && w='exit 1'
  fakebin sysctl "case \"\$2\" in hw.model) echo MacBookPro18,1 ;; machdep.cpu.brand_string) echo 'Apple M1 Pro' ;; hw.ncpu) echo 10 ;; hw.memsize) echo 17179869184 ;; iogpu.wired_limit_mb) $w ;; *) exit 1 ;; esac"
  fakebin pmset "printf '%s\n' \"Now drawing from 'AC Power'\" ' -InternalBattery-0 (id=1)	97%; charged; 0:00 remaining present: true'"
}

new_case mac_default
mac_fakes arm64 0
scan_case
expect_eq "Apple Silicon, default GPU limit (0): memory unknown" "$(json_get "$CASE/hw.json" 'd["accelerator"]["kind"], d["accelerator"]["memory_gb"], d["apple_gpu"]["wired_limit_mb"]')" "('apple', None, 0)"
expect_eq "Apple Silicon default: verified after install" "$(json_get "$CASE/hw.json" 'd["recommendation"]["verdict"], d["recommendation"]["model"]')" "('unknown', 'gemma4:12b')"
expect_eq "macOS power from pmset" "$(json_get "$CASE/hw.json" 'd["power"]["source"], d["power"]["battery_present"], d["power"]["battery_percent"], d["memory"]["total_gb"]')" "('ac', True, 97, 16.0)"

new_case mac_limit
mac_fakes arm64 12288
scan_case
expect_eq "Apple Silicon with iogpu.wired_limit_mb=12288: 12b fits" "$(json_get "$CASE/hw.json" 'd["accelerator"]["memory_gb"], d["recommendation"]["verdict"]')" "(12.0, 'ok')"

new_case mac_nosysctl
mac_fakes arm64 none
scan_case
expect_eq "Apple Silicon without iogpu sysctl: null + reason" "$(json_get "$CASE/hw.json" 'd["apple_gpu"]["wired_limit_mb"], any(u["field"]=="apple_gpu.wired_limit_mb" for u in d["unknown"])')" "(None, True)"

new_case mac_intel
mac_fakes x86_64 0
scan_case
expect_eq "Intel Mac: CPU only, refused" "$(json_get "$CASE/hw.json" 'd["accelerator"]["kind"], d["recommendation"]["verdict"]')" "('none', 'not_viable')"

echo "== answers file"
run_answers() {  # run_answers CONTENT [MODE] -> exit code; stdout NDJSON in $TMP/ans.ndjson
  printf '%s\n' "$1" >"$TMP/answers.txt"
  PATH="$LINUX_BIN:$PATH" LEFI_STATE_DIR="$TMP/ans-state" ENV_FILE="$TMP/ans.env" HW_SYS="$TMP/nogpu/sys" "$ROOT/scripts/install.sh" --dry-run --service-mode "${2:-user}" \
    --answers "$TMP/answers.txt" --events ndjson >"$TMP/ans.ndjson" 2>"$TMP/ans.err"
}
run_answers "ROLES=ai
BOGUS=1"; rc=$?
expect_eq "unknown key refused" "$rc $(grep -c 'unknown key' "$TMP/ans.err")" "1 1"
run_answers 'ROLES=ai
AI_URL=$(touch /tmp/x)'; rc=$?
expect_eq "shell expression in a value refused" "$rc $(grep -c 'shell expression' "$TMP/ans.err")" "1 1"
run_answers "ROLES=ai
MODEL=recommended"; rc=$?
expect_eq "ai role on a PC without GPU: AI_NOT_VIABLE event" \
  "$rc $(grep '"step.failed"' "$TMP/ans.ndjson" | grep -c '"code":"AI_NOT_VIABLE"') $(grep -c '"result":"failed"' "$TMP/ans.ndjson")" "1 1 1"
if [ -r /etc/os-release ]; then
run_answers "ROLES=core
AI_URL=http://127.0.0.1:9
DEV_ALLOW_NO_AI=no" systemd; rc=$?
expect_eq "dry-run core, systemd plan: completes (no AI check in dry-run)" "$rc $(grep -c '"result":"ok"' "$TMP/ans.ndjson")" "0 1"
expect_eq "every event line is JSON" "$(python3 -I -c 'import json,sys; [json.loads(l) for l in open(sys.argv[1])]; print("ok")' "$TMP/ans.ndjson" 2>&1)" "ok"
expect_eq "progress reaches steps_total" "$(json_get /dev/null 'None' >/dev/null; python3 -I -c '
import json,sys
ev=[json.loads(l) for l in open(sys.argv[1])]
p=[e for e in ev if e["event"]=="plan.started"][0]; d=[e for e in ev if e["event"]=="plan.done"][0]
print(p["steps_total"]==d["steps_done"]==d["steps_total"], len([e for e in ev if e["event"]=="step.ok"])==p["steps_total"])' "$TMP/ans.ndjson")" "True True"
else
  t_skip "dry-run core, systemd plan + event checks" "needs a Linux /etc/os-release"
fi
expect_eq "no prompt without a terminal (answers mode never reads /dev/tty)" "$(grep -c 'Question without a terminal' "$TMP/ans.err")" "0"

# Lefi Crop Helper closes mid-run: its pipes break, the installer must still reach its end.
printf 'ROLES=core\nAI_URL=http://192.0.2.1:11434\n' >"$TMP/pipe.txt"
rm -rf "$TMP/pipe-state"; mkdir -p "$TMP/pipe-home"
PIPE_MODE=""; [ "$(uname -s)" = Linux ] && PIPE_MODE="--service-mode user"
# shellcheck disable=SC2086
HOME="$TMP/pipe-home" LEFI_STATE_DIR="$TMP/pipe-state" ENV_FILE="$TMP/pipe.env" HW_SYS="$TMP/nogpu/sys" "$ROOT/scripts/install.sh" --dry-run $PIPE_MODE \
  --answers "$TMP/pipe.txt" --events ndjson 2> >(head -n 1 >/dev/null) | head -n 1 >/dev/null
expect_eq "app gone mid-run: the installer still records how it ended" \
  "$(cat "$TMP"/pipe-state/logs/*.events.ndjson 2>/dev/null | grep -c '"event":"plan.done"')" "1"
echo "== model pull progress (recorded Ollama /api/pull stream shape, fake digests)"
cat >"$TMP/pull.ndjson" <<'EOF'
{"status":"pulling manifest"}
{"status":"pulling aaaa","digest":"sha256:aaaa","total":1000,"completed":0}
{"status":"pulling aaaa","digest":"sha256:aaaa","total":1000,"completed":600}
{"status":"pulling bbbb","digest":"sha256:bbbb","total":200,"completed":200}
{"status":"pulling aaaa","digest":"sha256:aaaa","total":1000,"completed":1000}
{"status":"verifying sha256 digest"}
{"status":"success"}
EOF
out="$( LEFI_ROOT="$ROOT" LEFI_STATE_DIR="$TMP/pp" LEFI_SERVICE_MODE=user bash -c '
  for lib in common hwscan recommend system role_ai; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
  EVENTS=1; EVENTS_FILE=""; EV_STEP=ai.model; EV_TOTAL=1; PULL_STATE="$(mktemp)"
  exec 3>&1; pull_progress <"$1" | tail -n1 >&2; rm -f "$PULL_STATE"' _ "$TMP/pull.ndjson" 2>"$TMP/pp.res")"
expect_eq "pull: final progress = total bytes of all layers" "$(printf '%s\n' "$out" | tail -n1 | python3 -I -c 'import json,sys; e=json.loads(sys.stdin.read()); print(e["done"], e["total"], e["unit"])')" "1200 1200 bytes"
expect_eq "pull: success reported" "$(cat "$TMP/pp.res")" "success"
printf '%s\n' '{"status":"pulling manifest"}' '{"error":"pull model manifest: file does not exist"}' >"$TMP/pull-err.ndjson"
res="$( LEFI_ROOT="$ROOT" LEFI_STATE_DIR="$TMP/pp" LEFI_SERVICE_MODE=user bash -c '
  for lib in common hwscan recommend system role_ai; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
  PULL_STATE="$(mktemp)"; pull_progress <"$1" | tail -n1; rm -f "$PULL_STATE"' _ "$TMP/pull-err.ndjson")"
expect_eq "pull: error message kept" "$res" "error: pull model manifest: file does not exist"

# shellcheck source=scripts/tests/journal.inc.sh
. "$ROOT/scripts/tests/journal.inc.sh"
# shellcheck source=scripts/tests/ai_use.inc.sh
. "$ROOT/scripts/tests/ai_use.inc.sh"
# shellcheck source=scripts/tests/robot.inc.sh
. "$ROOT/scripts/tests/robot.inc.sh"
# shellcheck source=scripts/tests/backup.inc.sh
. "$ROOT/scripts/tests/backup.inc.sh"

echo
printf 'Shell tests: %d passed, %d failed, %d skipped\n' "$PASSES" "$FAILS" "$SKIPS"
[ "$FAILS" = 0 ]
