# shellcheck shell=bash
# Model recommendation v2 and the AI requirement (INSTALLER.md §7.2, ADR-028).
#
# Lefi Crop requires the local AI (owner, 2026-11-05). A machine may run the `ai` role only if
# a supported model can run fully on its GPU:
#   fit = gpu      measured footprint + headroom <= accelerator memory
#   fit = no       CPU only, or the footprint does not fit
#   fit = unknown  footprint not measured (?) or accelerator memory unknown: allowed, then the
#                  real benchmark after install decides (ai_verify_gpu)
# A core node without the ai role needs a viable AI node elsewhere (ai_remote_gate).

FIT_FILE="$LEFI_ROOT/config/model-fit.conf"

fit_conf() {  # fit_conf KEY -> value from config/model-fit.conf
  [ -f "$FIT_FILE" ] || return 0
  grep -E "^$1=" "$FIT_FILE" | tail -n1 | cut -d= -f2- | tr -d ' '
}

# model_field TAG COLUMN(1-8) -> one column of config/supported-models.tsv
model_field() { models_rows | awk -F'\t' -v t="$1" -v c="$2" '$1==t{print $c; exit}'; }

# recommend_models — needs hw_scan. Sets REC_TAG (empty = none), REC_VERDICT (ok|unknown|not_viable),
# REC_REASON, REC_N and per row REC_<i>_TAG / _ROLE / _FIT / _WHY.
recommend_models() {
  local head i=0 tag role mem ctx meas a_gb need first_gpu="" first_unknown=""
  head="$(fit_conf GPU_HEADROOM_GB)"; head="${head:-1.5}"
  a_gb="$(mb_to_gb "$HW_ACCEL_MB")"
  REC_TAG=""; REC_VERDICT=not_viable; REC_REASON=""
  while IFS="$(printf '\t')" read -r tag _ _ role mem ctx meas _; do
    [ -n "$tag" ] || continue
    i=$((i + 1)); eval "REC_${i}_TAG=\$tag; REC_${i}_ROLE=\$role"
    local fit why
    if [ "$HW_ACCEL_KIND" = none ]; then
      fit=no; why="CPU only ($HW_ACCEL_REASON); Lefi Crop requires the model on a GPU"
    elif [ -z "$HW_ACCEL_MB" ]; then
      fit=unknown; why="GPU memory unknown ($HW_ACCEL_REASON); decided by the benchmark after install"
    elif [ "$mem" = "?" ] || [ -z "$mem" ]; then
      fit=unknown; why="memory footprint not measured yet; decided by the benchmark after install"
    else
      need="$(awk -v m="$mem" -v h="$head" 'BEGIN{printf "%.1f", m+h}')"
      if awk -v n="$need" -v a="$a_gb" 'BEGIN{exit !(n <= a)}'; then
        fit=gpu; why="needs ≈ $mem GB (measured on $meas, ctx $ctx) + $head GB headroom = $need GB ≤ $a_gb GB GPU memory"
      else
        fit=no; why="needs ≈ $mem GB (measured on $meas, ctx $ctx) + $head GB headroom = $need GB > $a_gb GB GPU memory"
      fi
    fi
    eval "REC_${i}_FIT=\$fit; REC_${i}_WHY=\$why"
    [ "$fit" = gpu ] && [ -z "$first_gpu" ] && first_gpu="$i"
    [ "$fit" = unknown ] && [ -z "$first_unknown" ] && first_unknown="$i"
  done <<EOF
$(models_rows)
EOF
  REC_N="$i"
  if [ -n "$first_gpu" ]; then
    eval "REC_TAG=\$REC_${first_gpu}_TAG; REC_REASON=\$REC_${first_gpu}_WHY"; REC_VERDICT=ok
  elif [ -n "$first_unknown" ]; then
    eval "REC_TAG=\$REC_${first_unknown}_TAG; REC_REASON=\$REC_${first_unknown}_WHY"; REC_VERDICT=unknown
  else
    REC_REASON="no supported model can run on this machine's GPU; put the AI role on a PC with a supported GPU"
  fi
}

model_fit() {  # model_fit TAG -> gpu|no|unknown (after recommend_models)
  local i=1 t
  while [ "$i" -le "${REC_N:-0}" ]; do
    eval "t=\$REC_${i}_TAG"; [ "$t" = "$1" ] && { eval "echo \$REC_${i}_FIT"; return 0; }
    i=$((i + 1))
  done
  echo no
}

recommend_json() {
  local i=1 out="" t r f w
  while [ "$i" -le "${REC_N:-0}" ]; do
    eval "t=\$REC_${i}_TAG; r=\$REC_${i}_ROLE; f=\$REC_${i}_FIT; w=\$REC_${i}_WHY"
    out="$out${out:+,}{\"tag\":$(json_q "$t"),\"role\":$(json_q "$r"),\"fit\":$(json_q "$f"),\"why\":$(json_q "$w")}"
    i=$((i + 1))
  done
  printf '{"verdict":%s,"model":%s,"reason":%s,"headroom_gb":%s,"min_gpu_share_pct":%s,"models":[%s]}' \
    "$(json_q "$REC_VERDICT")" "$(json_qn "$REC_TAG")" "$(json_q "$REC_REASON")" \
    "$(fit_conf GPU_HEADROOM_GB | sed 's/^$/null/')" "$(fit_conf MIN_GPU_SHARE_PCT | sed 's/^$/null/')" "$out"
}

recommend_print() {
  local i=1 t f w mark
  header "Model recommendation (config/supported-models.tsv + config/model-fit.conf)"
  while [ "$i" -le "${REC_N:-0}" ]; do
    eval "t=\$REC_${i}_TAG; f=\$REC_${i}_FIT; w=\$REC_${i}_WHY"
    mark=""; [ "$t" = "$REC_TAG" ] && mark=" ← recommended"
    info "$(printf '%-12s %-8s %s%s' "$t" "$f" "$w" "$mark")"
    i=$((i + 1))
  done
  case "$REC_VERDICT" in
    ok) ok "This machine can run the AI role ($REC_TAG on the GPU)" ;;
    unknown) warn "Fit of $REC_TAG cannot be predicted; it is allowed and verified after install (100% on GPU required)" ;;
    *) err "This machine cannot run the AI role: $REC_REASON" ;;
  esac
}

# ---------------------------------------------------------------- after install: real measurement
# ai_measure URL MODEL -> runs a tiny real generation, then reads /api/ps. Sets AI_GPU_PCT,
# AI_SIZE_GB, AI_CTX (empty when not reported). Returns 1 if the generation failed (GEN_ERROR).
ai_measure() {
  local m size vram
  AI_GPU_PCT=""; AI_SIZE_GB=""; AI_CTX=""
  ollama_generate "$1" "$2" "Reply with the single word OK." 16 || return 1
  m="$(ps_model_line "$1" "$2" | head -n1)"
  [ -n "$m" ] || { GEN_ERROR="the model answered but is not listed by /api/ps"; return 1; }
  size="$(printf '%s' "$m" | json_field size)"; vram="$(printf '%s' "$m" | json_field size_vram)"
  AI_CTX="$(printf '%s' "$m" | json_field context_length)"
  AI_GPU_PCT="$(awk -v s="${size:-0}" -v v="${vram:-0}" 'BEGIN{ if (s>0) printf "%d", int(v*100/s) }')"
  AI_SIZE_GB="$(awk -v s="${size:-0}" 'BEGIN{ if (s>0) printf "%.1f", s/1073741824 }')"
  return 0
}

ai_share_ok() {  # ai_share_ok PCT
  local min; min="$(fit_conf MIN_GPU_SHARE_PCT)"; min="${min:-100}"
  [ -n "$1" ] && [ "$1" -ge "$min" ]
}

# ai_dev_override — development/CI only (ADR-028): continue without a viable AI, loudly.
ai_dev_override() {
  [ "${DEV_ALLOW_NO_AI:-0}" = 1 ] || return 1
  warn "DEVELOPMENT OVERRIDE (--dev-allow-no-ai): continuing without a viable AI node."
  warn "This is NOT a supported Lefi Crop installation; Lefi Brain will report AI as unavailable."
  env_set LEFI_AI_GATE "override $(date -u +%Y-%m-%dT%H:%M:%SZ): $1"
  return 0
}

# ai_gate_fail MESSAGE HINT — refuse (or apply the development override).
ai_gate_fail() {
  ai_dev_override "$1" && return 0
  DIE_CODE=AI_NOT_VIABLE; DIE_HINT="$2"
  die "$1"
}
