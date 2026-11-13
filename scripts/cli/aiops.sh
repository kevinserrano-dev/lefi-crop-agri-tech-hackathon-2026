# shellcheck shell=bash
# AI node operations: loaded-model info, resources, benchmark, performance history,
# event log and explained error diagnosis.
#
# Files (all under ~/.lefi-crop/logs):
#   ai-events.log  one line per AI event the CLI sees: test/bench results, failures with the raw
#                  Ollama reply, kill switch, cancel, unload  →  "ISO-TIME LEVEL KIND message"
#   ai-perf.log    TSV of every measured inference (lefi ai test / bench), for trends

AI_EVENTS_LOG="$LOG_DIR/ai-events.log"
AI_PERF_LOG="$LOG_DIR/ai-perf.log"
AI_PERF_HEADER="# time	kind	model	load_ms	prompt_tokens	prompt_tps	gen_tokens	gen_tps	ttft_ms	total_ms	gpu_pct	power"

ai_event() {  # ai_event LEVEL KIND MESSAGE...
  local lvl="$1" kind="$2"; shift 2
  mkdir -p "$LOG_DIR" 2>/dev/null || return 0
  printf '%s %-5s %-8s %s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$lvl" "$kind" "$*" | tr -d '\r' >>"$AI_EVENTS_LOG" 2>/dev/null
  return 0
}

# ---------------------------------------------------------------- loaded models (/api/ps)
# One line per loaded model, each holding that model's complete JSON object.
# "8.9 GB · 100% GPU · 12B Q4_K_M · ctx 8192 · unloads 2026-11-03 10:15"
model_line_info() {
  local m="$1" size vram ctx psize quant exp gpu
  size="$(printf '%s' "$m" | json_field size)"; vram="$(printf '%s' "$m" | json_field size_vram)"
  ctx="$(printf '%s' "$m" | json_field context_length)"; psize="$(printf '%s' "$m" | json_field parameter_size)"
  quant="$(printf '%s' "$m" | json_field quantization_level)"; exp="$(printf '%s' "$m" | json_field expires_at | cut -c1-16 | tr 'T' ' ')"
  gpu="$(awk -v s="${size:-0}" -v v="${vram:-0}" 'BEGIN{ if (s>0) printf "%.0f", v*100/s; else print "?" }')"
  printf '%s · %s%% GPU%s · ctx %s · unloads %s' "$(human_bytes "${size:-0}")" "$gpu" \
    "$( [ -n "$psize$quant" ] && printf ' · %s' "$(echo "$psize $quant" | sed 's/^ *//; s/ *$//')")" "${ctx:-?}" "${exp:-?}"
}

# ---------------------------------------------------------------- host metrics (best effort)
gpu_util() {  # Apple GPU utilisation snapshot (no sudo); empty when unavailable
  is_macos || return 0
  ioreg -r -d 1 -w 0 -c IOAccelerator 2>/dev/null | grep -o '"Device Utilization %"=[0-9]*' | head -n1 | cut -d= -f2
}
swap_used_mb() {
  if is_macos; then sysctl -n vm.swapusage 2>/dev/null | sed -n 's/.*used = \([0-9.]*\)M.*/\1/p' | cut -d. -f1
  else free -m 2>/dev/null | awk '/Swap:/{print $3}'; fi
}
mem_free_pct() {
  if is_macos; then memory_pressure -Q 2>/dev/null | sed -n 's/.*free percentage: \([0-9]*\)%.*/\1/p'
  else free 2>/dev/null | awk '/Mem:/{ if ($2>0) printf "%.0f", $7*100/$2 }'; fi
}
power_source() {
  is_macos || { echo "?"; return 0; }
  pmset -g batt 2>/dev/null | sed -n "s/.*drawing from '\([^']*\)'.*/\1/p" | head -n1
}
cpu_speed_limit() {  # 100 = no thermal throttling; empty when unknown
  is_macos && pmset -g therm 2>/dev/null | sed -n 's/.*CPU_Speed_Limit[^0-9]*\([0-9]*\).*/\1/p' | head -n1
  return 0
}
# macOS memory pressure: normal | warn | critical (empty elsewhere). This is what tells whether
# the Mac is short of memory NOW; swap stays allocated long after memory was freed.
mem_pressure() {
  is_macos || return 0
  case "$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null)" in
    1) echo normal ;; 2) echo warn ;; 4) echo critical ;;
  esac
}

# mem_verdict -> MV_LEVEL (OK|WARN) and MV_TEXT; uses pressure when available, swap/free otherwise.
mem_verdict() {
  local mf sw pr; mf="$(mem_free_pct)"; sw="$(swap_used_mb)"; pr="$(mem_pressure)"
  MV_LEVEL=OK; MV_TEXT="${mf:-?}% RAM free, swap ${sw:-?} MB${pr:+, pressure $pr}"
  if [ -n "$pr" ]; then
    [ "$pr" != normal ] && { MV_LEVEL=WARN; MV_TEXT="memory pressure $pr (${mf:-?}% free, swap ${sw:-?} MB) — answers may be slower"; }
    [ "$pr" = normal ] && [ -n "$sw" ] && [ "$sw" -gt 1024 ] 2>/dev/null && MV_TEXT="$MV_TEXT (old swap, harmless while pressure is normal)"
  elif [ -n "$sw" ] && [ "$sw" -gt 1024 ] 2>/dev/null; then MV_LEVEL=WARN; MV_TEXT="swap ${sw} MB in use, ${mf:-?}% RAM free — answers may be slower"
  elif [ -n "$mf" ] && [ "$mf" -lt 10 ] 2>/dev/null; then MV_LEVEL=WARN; MV_TEXT="only ${mf}% RAM free"
  fi
  return 0
}

top_mem_procs() {  # top 5 processes by resident memory: "  name  size"
  ps -axo rss=,comm= 2>/dev/null | sort -rn | head -n 5 | while read -r rss comm; do
    printf '%-28s %s\n' "$(basename "$comm" | cut -c1-28)" "$(human_kb "$rss")"
  done
}

ollama_models_dir() { local d; d="$(env_get OLLAMA_MODELS)"; echo "${d:-$HOME/.ollama/models}"; }

# ---------------------------------------------------------------- lefi ai resources
ai_resources_once() {
  local url model line pid cpu rss et gpu sw mf pw lim log today n last
  url="$(ai_url)"; model="$(env_get OLLAMA_MODEL)"
  header "AI resources · $(date +%H:%M:%S) · configured model ${model:-?}"
  line="$(lefi_procs | awk '$6=="ai"' | head -n1)"
  if [ -n "$line" ]; then
    read -r pid _ cpu rss et _ <<EOF
$line
EOF
    info "$(printf '%-16s PID %-6s CPU %5s%%  RAM %8s  up %s' 'Ollama server' "$pid" "$cpu" "$(human_kb "$rss")" "$et")"
  else warn "Ollama server not running (lefi start ai)"; fi
  lefi_procs | awk '$6=="ai-runner"' | while read -r pid _ cpu rss et _; do
    info "$(printf '%-16s PID %-6s CPU %5s%%  RAM %8s  up %s' 'Model runner' "$pid" "$cpu" "$(human_kb "$rss")" "$et")"
  done
  local models; models="$(ps_models "$url")"
  if [ -n "$models" ]; then
    printf '%s\n' "$models" | while IFS= read -r line; do
      info "$(printf '%-16s %s · %s' 'Loaded model' "$(printf '%s' "$line" | json_field name)" "$(model_line_info "$line")")"
    done
  else info "$(printf '%-16s %s' 'Loaded model' 'none (loads on the next request)')"; fi
  gpu="$(gpu_util)"; [ -n "$gpu" ] && info "$(printf '%-16s %s%% utilisation (snapshot)' 'GPU' "$gpu")"
  mem_verdict
  info "$(printf '%-16s %s' 'System memory' "$MV_TEXT")"
  if [ "$MV_LEVEL" = WARN ]; then
    warn "The Mac is short of memory: close other apps or use the lighter model"
    info "Biggest memory users (the model's GPU memory is not listed here):"; top_mem_procs | sed 's/^/    /'
  fi
  if is_macos; then
    pw="$(power_source)"; lim="$(cpu_speed_limit)"
    info "$(printf '%-16s %s · CPU speed limit %s%%' 'Power/thermal' "${pw:-?}" "${lim:-100}")"
    [ "$pw" = "Battery Power" ] && warn "On battery: macOS may lower performance — plug the Mac in for the demo"
    [ -n "$lim" ] && [ "$lim" -lt 100 ] 2>/dev/null && warn "Thermal throttling active (CPU limited to $lim%)"
  fi
  log="$(svc_log ai)"
  if [ -f "$log" ]; then
    today="$(date +%Y/%m/%d)"
    n="$(grep -c "^\[GIN\] $today" "$log" 2>/dev/null)"; last="$(grep '^\[GIN\]' "$log" | tail -n1 | tr -s ' ')"
    info "$(printf '%-16s %s requests today' 'Activity' "${n:-0}")"
    [ -n "$last" ] && info "$(printf '%-16s %s' 'Last request' "${last#\[GIN\] }")"
  fi
}

ai_resources() {
  detect_system >/dev/null 2>&1
  if has_flag --watch "$@" || has_flag -w "$@"; then
    while :; do clear; ai_resources_once; printf '\n  %sCtrl-C to exit · refresh 2 s%s\n' "$C_DIM" "$C_RESET"; sleep 2; done
  fi
  ai_resources_once
}

# ---------------------------------------------------------------- metrics of one generation
# gen_metrics BODY -> M_LOAD_MS M_PROMPT_N M_PROMPT_TPS M_GEN_N M_GEN_TPS M_TTFT_MS M_TOTAL_MS
gen_metrics() {
  local b="$1" ld pc pd ec ed td
  ld="$(printf '%s' "$b" | json_field load_duration)"; pc="$(printf '%s' "$b" | json_field prompt_eval_count)"
  pd="$(printf '%s' "$b" | json_field prompt_eval_duration)"; ec="$(printf '%s' "$b" | json_field eval_count)"
  ed="$(printf '%s' "$b" | json_field eval_duration)"; td="$(printf '%s' "$b" | json_field total_duration)"
  # shellcheck disable=SC2046
  set -- $(awk -v ld="${ld:-0}" -v pc="${pc:-0}" -v pd="${pd:-0}" -v ec="${ec:-0}" -v ed="${ed:-0}" -v td="${td:-0}" 'BEGIN{
    printf "%.0f %d %.1f %d %.1f %.0f %.0f", ld/1e6, pc, (pd>0? pc/(pd/1e9):0), ec, (ed>0? ec/(ed/1e9):0), (ld+pd)/1e6, td/1e6 }')
  # Ollama reuses a prompt it has just processed (prompt cache): reading it then takes ~0 ms and
  # a tokens/s figure would be absurd, so it is reported as "cached".
  M_LOAD_MS="$1"; M_PROMPT_N="$2"; M_PROMPT_TPS="$3"
  awk -v pd="${pd:-0}" 'BEGIN{exit !(pd < 5e6)}' && M_PROMPT_TPS="cached"
  M_GEN_N="$4"; M_GEN_TPS="$5"; M_TTFT_MS="$6"; M_TOTAL_MS="$7"
}

perf_record() {  # perf_record KIND MODEL GPU_PCT  (uses M_* from gen_metrics)
  mkdir -p "$LOG_DIR" 2>/dev/null || return 0
  [ -s "$AI_PERF_LOG" ] || printf '%s\n' "$AI_PERF_HEADER" >"$AI_PERF_LOG"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$1" "$2" \
    "$M_LOAD_MS" "$M_PROMPT_N" "$M_PROMPT_TPS" "$M_GEN_N" "$M_GEN_TPS" "$M_TTFT_MS" "$M_TOTAL_MS" "${3:-?}" \
    "$(power_source | tr ' ' '_')" >>"$AI_PERF_LOG" 2>/dev/null
  return 0
}

# Rule of thumb for chat-style answers (not a hardware specification).
speed_verdict() {
  awk -v t="$1" 'BEGIN{ if (t>=15) print "fluid (≥ 15 tok/s)"; else if (t>=8) print "usable (8–15 tok/s)"; else print "slow (< 8 tok/s) — check lefi ai resources, or use the lighter model" }'
}

# Report a failed generation: explained on screen, full raw reply in ai-events.log.
gen_failed() {  # gen_failed KIND MODEL URL
  err "Inference failed: $GEN_ERROR"
  explain_text "$GEN_ERROR"
  ai_event ERROR "$1" "model=$2 url=$3 http=${GEN_HTTP:-?} error=\"$GEN_ERROR\" body=$(printf '%s' "$GEN_BODY" | tr -d '\n' | head -c 600)"
  info "Raw reply saved in $AI_EVENTS_LOG · deeper analysis: lefi ai diagnose"
}

# ---------------------------------------------------------------- lefi ai bench
BENCH_PROMPT="You are a greenhouse assistant. A tomato plant shows soil moisture of 18 percent, air temperature of 31 C and relative humidity of 45 percent. In five short bullet points, explain what a technician should check first and why."

ai_bench() {
  local url model runs=3 i gpu sum=0 a
  url="$(ai_url)"; model="$(env_get OLLAMA_MODEL)"
  while [ $# -gt 0 ]; do case "$1" in -r|--runs) shift; runs="${1:-3}" ;; -r*) runs="${1#-r}" ;; esac; shift; done
  case "$runs" in ''|*[!0-9]*|0) die "-r expects a number ≥ 1" ;; esac
  [ -f "$AI_KILL_FLAG" ] && die "AI is disabled by the kill switch (lefi ai on)."
  [ -n "$model" ] || die "OLLAMA_MODEL not configured"
  header "AI benchmark · $model @ $url · $runs run(s)"
  info "Fixed greenhouse prompt · up to 160 tokens · temperature 0 · thinking off"
  printf '\n  %-4s %9s %13s %13s %10s %10s\n' RUN LOAD PROMPT GENERATION 1st-TOKEN TOTAL
  a=""
  i=1; while [ "$i" -le "$runs" ]; do
    if ! ollama_generate "$url" "$model" "$BENCH_PROMPT" 160 '"temperature":0,"seed":42'; then
      echo; gen_failed bench "$model" "$url"; return 1
    fi
    gen_metrics "$GEN_BODY"
    printf '  %-4s %7s ms %7s tok/s %7s tok/s %7s ms %7s ms\n' "$i" "$M_LOAD_MS" "$M_PROMPT_TPS" "$M_GEN_TPS" "$M_TTFT_MS" "$M_TOTAL_MS"
    gpu="$(model_gpu_pct "$url" "$model")"
    perf_record bench "$model" "$gpu"
    a="$a $M_GEN_TPS:$M_TTFT_MS:$M_LOAD_MS"
    i=$((i + 1))
  done
  echo
  # shellcheck disable=SC2046
  set -- $(echo "$a" | tr ' ' '\n' | awk -F: 'NF==3{n++; g+=$1; t+=$2; if(min==""||$1<min)min=$1; if($1>max)max=$1; if($3>1000)cold++}
    END{ if(n) printf "%.1f %.1f %.1f %.0f %d", g/n, min, max, t/n, cold+0 }')
  sum="$1"
  ok "Generation: avg $1 tok/s (min $2 · max $3) → $(speed_verdict "$1")"
  ok "Time to first token: avg $4 ms (model load + reading the prompt)"
  [ "${5:-0}" -gt 0 ] && info "$5 run(s) included loading the model into memory (cold start); later runs show warm speed."
  info "GPU share of the model: ${gpu:-?}% · power: $(power_source)"
  ai_event INFO bench "model=$model runs=$runs avg_gen_tps=$sum avg_ttft_ms=$4 gpu_pct=${gpu:-?}"
  info "Saved to $AI_PERF_LOG · history: lefi ai perf"
}

# ---------------------------------------------------------------- lefi ai perf
pctl() {  # stdin numbers → "p50 p95 max"
  sort -n | awk '{v[NR]=$1} END{ if(!NR){print "- - -"; exit} i50=int((NR+1)*0.5); i95=int(NR*0.95); if(i95<1)i95=1; if(i50<1)i50=1; printf "%.0f %.0f %.0f", v[i50], v[i95], v[NR] }'
}

ai_perf() {
  parse_n 15 "$@"
  header "AI performance history"
  if [ -s "$AI_PERF_LOG" ] && grep -qv '^#' "$AI_PERF_LOG"; then
    info "Last $NLINES measurements (lefi ai test / bench):"
    printf '  %-16s %-5s %-12s %8s %9s %9s %9s %5s %s\n' TIME KIND MODEL LOAD_ms PROMPT/s GEN/s 1stTOK_ms GPU% POWER
    grep -v '^#' "$AI_PERF_LOG" | tail -n "$NLINES" | awk -F'\t' '{printf "  %-16s %-5s %-12s %8s %9s %9s %9s %5s %s\n", substr($1,1,16), $2, $3, $4, $6, $8, $9, $11, $12}'
    echo; info "Per model (generation speed, warm and cold runs together):"
    grep -v '^#' "$AI_PERF_LOG" | awk -F'\t' '
      { m=$3; n[m]++; s[m]+=$8; if(!(m in lo)||$8<lo[m])lo[m]=$8; if($8>hi[m])hi[m]=$8; r[m,n[m]]=$8; last[m]=substr($1,1,16) }
      END{ for (m in n) {
        printf "    %-12s %3d runs · avg %5.1f tok/s · best %5.1f · worst %5.1f · last %s\n", m, n[m], s[m]/n[m], hi[m], lo[m], last[m]
        if (n[m] >= 6) { a=0; b=0; for(i=n[m]-2;i<=n[m];i++) a+=r[m,i]; for(i=1;i<=n[m]-3;i++) b+=r[m,i]; a/=3; b/=(n[m]-3)
          d=(b>0)?(a-b)*100/b:0
          if (d < -15) printf "      ! last 3 runs are %.0f%% slower than before — check lefi ai resources / lefi ai diagnose\n", -d
          else printf "      trend: stable (last 3 vs earlier: %+.0f%%)\n", d } } }'
  else
    info "No measurements yet. Run: lefi ai bench   (or lefi ai test)"
  fi
  local log data ep; log="$(svc_log ai)"
  echo; info "Real traffic latency (Ollama access log, last 5000 lines):"
  if [ -f "$log" ] && data="$(tail -n 5000 "$log" | grep '^\[GIN\]')" && [ -n "$data" ]; then
    printf '    %-24s %6s %9s %9s %9s %6s\n' ENDPOINT CALLS p50 p95 MAX ERRORS
    for ep in /api/generate /api/chat /api/embed /api/embeddings; do
      local rows; rows="$(echo "$data" | grep "\"$ep\"")"; [ -n "$rows" ] || continue
      # shellcheck disable=SC2046
      set -- $(echo "$rows" | awk -F'|' '{ s=$3; gsub(/ /,"",s)
          if (s ~ /ms$/) v=s+0; else if (s ~ /µs$/) v=(s+0)/1000; else if (s ~ /m[0-9.]+s$/){split(s,x,"m"); v=x[1]*60000+x[2]*1000} else v=(s+0)*1000
          print v }' | pctl)
      printf '    %-24s %6s %7s ms %7s ms %7s ms %6s\n' "$ep" "$(echo "$rows" | wc -l | tr -d ' ')" "$1" "$2" "$3" \
        "$(echo "$rows" | awk -F'|' '{st=$2+0; if (st>=400) e++} END{print e+0}')"
    done
    info "Latency includes waiting in the queue (OLLAMA_NUM_PARALLEL=1) and model loading."
  else info "    No requests logged yet."; fi
}

# ---------------------------------------------------------------- explained errors
# Known problems: CODE <tab> lowercase ERE matched against log lines <tab> what it means <tab> what to do.
# Order matters: a line is attributed to the first matching entry.
ai_error_catalog() {
  cat <<'EOF'
APP_ACCOUNT	[|] 401 [|].*"/api/me"	The Ollama desktop app checked for an ollama.com account sign-in and got 'not signed in'. It is not a model error.	Nothing to do. If it keeps appearing, the Ollama desktop app is running: quit it (Lefi Crop AI runs its own service)
PORT_BUSY	address already in use	Another server already holds port 11434 (usually the Ollama desktop app, a Homebrew service or a manual 'ollama serve'); the Lefi Crop AI service cannot start.	Quit the Ollama app (menu bar) and 'brew services stop ollama'; check: lsof -nP -iTCP:11434 -sTCP:LISTEN; then: lefi restart ai
OUT_OF_MEMORY	out of memory|insufficient memory|requires more system memory|failed to allocate|outofmemory|unable to allocate	The model did not fit in free memory (RAM is shared with the GPU on Apple Silicon).	Close heavy apps, check 'lefi ai resources' (free memory, swap), keep one model loaded, or switch OLLAMA_MODEL to the lighter gemma4:e4b
GPU_METAL	ggml_metal.*(fail|error)|metal.*(error|failed)|mtlcommandbuffer	The Apple GPU (Metal) reported an error while running the model.	Usually memory pressure: free memory and retry 'lefi ai test'. If it repeats after a reboot, update Ollama
RUNNER_CRASH	runner process has terminated|runner process no longer running|signal: killed|signal: abort|llama runner.*exit status|exit status [0-9]+	The process that executes the model died during a request (memory pressure, GPU error, or it was killed by 'lefi ai cancel' / 'lefi kill runner').	Check the time against ai-events.log (was it a cancel?); otherwise look at OUT_OF_MEMORY / GPU lines nearby and run 'lefi ai resources'
LOAD_TIMEOUT	timed out waiting for llama runner|timed out waiting for runner|load.*timed out	Loading the model into memory took too long.	Free memory (swap makes loading very slow), make sure the disk is not full, retry; the first load after boot is the slowest
MODEL_MISSING	model .*not found|try pulling it first|pull model manifest: file does not exist|[|] 404 [|]	A client asked for a model that is not installed under that exact tag.	Compare 'lefi ai models' with OLLAMA_MODEL in .env (and the Brain's OLLAMA_MODEL on the core node); install with: lefi setup
MODEL_CORRUPT	error loading model|unable to load model|failed to load model|invalid file magic|digest mismatch|unexpected eof	The model files on disk are damaged or incomplete (interrupted download).	Re-download: ollama rm <model> && ollama pull <model> (needs internet once), then: lefi ai test
UNSUPPORTED	does not support	The request used a feature the model does not have (thinking, tools, images...).	Normal for some models; the CLI retries without it. If the Brain logs it, adapt the Brain's request
DISK_FULL	no space left on device	The disk is full; models and logs cannot be written.	Free space (lefi resources shows disk), rotate logs: lefi logs rotate, remove unsupported models
PERMISSION	permission denied|operation not permitted	Ollama or the CLI could not read/write a file (models folder, logs, socket).	Check ownership of ~/.ollama and ~/.lefi-crop (they must belong to this user, not root)
CLIENT_ABORT	context canceled|client closing the connection|aborting completion request|broken pipe|connection reset by peer	A client disconnected before the answer finished (its timeout, the user closed the page, or 'lefi ai cancel').	Harmless if rare. If frequent, the client timeout is shorter than the model's answer time: see 'lefi ai perf'
NETWORK	no such host|dial tcp|i/o timeout|tls handshake|network is unreachable|connection refused|no connection to	A network connection failed: either a download (pull needs internet) or a client could not reach Ollama.	For pulls: connect to the internet temporarily. For clients: 'lefi ai status', 'lefi net', firewall rules for TCP 11434
EMPTY_ANSWER	only produced reasoning|empty answer	The model answered but the visible text was empty (it spent the token budget on hidden reasoning).	Requests must send "think": false or a larger num_predict; the CLI already does this
SERVER_5XX	[|] 5[0-9][0-9] [|]	Ollama answered a request with a server error.	Look at the other problems listed at the same time; they explain the cause
CLIENT_4XX	[|] 4[0-9][0-9] [|]	Ollama rejected a malformed request.	Usually a client bug or a wrong model/option name; check the Brain's request
OTHER	level=error|panic|fatal| error |failed|fail 	An error not in the known list.	Read the sample line and the context saved in the diagnose report
EOF
}

# explain_text TEXT → prints the explanation of the first catalog entry that matches.
explain_text() {
  local t; t="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr '\n' ' ')"
  [ -n "$t" ] || return 0
  printf '%s\n' "$t" | awk -F'\t' 'NR==FNR{ c[++k]=$1; re[k]=$2; why[k]=$3; fix[k]=$4; next }
    { for (i=1;i<=k;i++) if ($0 ~ re[i]) { printf "%s\t%s\t%s\n", c[i], why[i], fix[i]; exit } }' \
    <(ai_error_catalog) - | while IFS="$(printf '\t')" read -r code why fix; do
      info "  Cause ($code): $why"
      info "  What to do: $fix"
    done
}

# classify_logs FILE... → per code: count \t first \t last \t sample \t why \t fix
classify_logs() {
  local f
  for f in "$@"; do [ -f "$f" ] && tail -n "$NLINES" "$f" | sed "s|^|$(basename "$f")	|"; done | awk -F'\t' -v cutoff="$DIAG_CUTOFF" '
    NR==FNR { c[++k]=$1; re[k]=$2; why[$1]=$3; fix[$1]=$4; next }
    { src=$1; line=substr($0, length($1) + 2); l=tolower(line)
      if (src ~ /^install-/ && l !~ /fail|error/) next
      # INFO/WARN lines only count for problems Ollama reports at that level
      quiet = (l ~ /level=(info|debug|warn)/)
      ts=""; if (match(line, /[0-9][0-9][0-9][0-9][-\/][0-9][0-9][-\/][0-9][0-9][ T-]+[0-9][0-9]:[0-9][0-9]:[0-9][0-9]/)) ts=substr(line, RSTART, RLENGTH)
      if (cutoff != "" && ts != "") { key=ts; gsub(/[^0-9]/, "", key); if (key < cutoff) { old++; next } }
      for (i=1;i<=k;i++) if (l ~ re[i]) {
        if (quiet && c[i] !~ /^(PORT_BUSY|OUT_OF_MEMORY|DISK_FULL|MODEL_MISSING|LOAD_TIMEOUT)$/) continue
        code=c[i]; n[code]++
        if (!(code in first)) first[code]=ts; last[code]=ts; sample[code]=src ": " substr(line,1,220); break } }
    END { if (old) printf "_OLD\t%d\t-\t-\t-\t-\t-\n", old
          for (code in n) { if (first[code]=="") first[code]="?"; if (last[code]=="") last[code]="?"
            printf "%s\t%d\t%s\t%s\t%s\t%s\t%s\n", code, n[code], first[code], last[code], sample[code], why[code], fix[code] } }' \
    <(ai_error_catalog) - | sort -t"$(printf '\t')" -k2,2nr
}

# ---------------------------------------------------------------- lefi ai diagnose
DIAG_PROBLEMS=0
dok()  { ok "$*"; }
dbad() { DIAG_PROBLEMS=$((DIAG_PROBLEMS + 1)); err "$1"; shift; local l; for l in "$@"; do info "  $l"; done; }
dwarn() { DIAG_WARNS=$((DIAG_WARNS + 1)); warn "$1"; shift; local l; for l in "$@"; do info "  $l"; done; }

ai_diag_checks() {
  local bin url model pid lst ver models mf sw pw lim free_gb dir code runs
  url="http://127.0.0.1:11434"; model="$(env_get OLLAMA_MODEL)"
  header "1 · Health checks"
  bin="$(ollama_bin)"
  if [ -n "$bin" ]; then dok "Ollama installed: $(ollama_version "$bin") ($bin)"
  else dbad "Ollama binary not found" "Install it with: lefi setup"; bin=ollama; fi

  if [ -f "$AI_KILL_FLAG" ]; then dwarn "AI kill switch is ON — $(cat "$AI_KILL_FLAG")" "Everything below may be 'stopped' on purpose. Re-enable with: lefi ai on"; fi

  pid="$(svc_pid ai)"
  if [ -n "$pid" ]; then dok "Service com.lefi-crop.ollama running (PID $pid, up $(pid_elapsed "$pid"))"
  else dbad "Service com.lefi-crop.ollama is not running" "Start it: lefi start ai · if it stops again, the reason is in: lefi logs ai -n 100"; fi
  if is_macos && launchctl print "gui/$(id -u)/com.lefi-crop.ollama" >/dev/null 2>&1; then
    code="$(launchctl print "gui/$(id -u)/com.lefi-crop.ollama" 2>/dev/null | sed -n 's/.*last exit code = \(.*\)/\1/p' | head -n1)"
    runs="$(launchctl print "gui/$(id -u)/com.lefi-crop.ollama" 2>/dev/null | sed -n 's/.*runs = \([0-9]*\).*/\1/p' | head -n1)"
    info "launchd: started ${runs:-?} time(s) since login · last exit code: ${code:-?}"
    [ -n "$runs" ] && [ "$runs" -gt 3 ] 2>/dev/null && dwarn "The service was (re)started $runs times — it may be crashing and being respawned" "See the log analysis below (RUNNER_CRASH / OUT_OF_MEMORY / PORT_BUSY)"
  fi

  if pgrep -xq Ollama 2>/dev/null; then
    dbad "The Ollama desktop app is also running" "It competes for port 11434 and memory and ignores the Lefi Crop AI settings." "Quit it from the menu bar and remove it from Login Items"
  fi
  lst="$(lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $1" PID "$2" "$9}' | sort -u)"
  if [ -z "$lst" ]; then dbad "Nothing listens on port 11434" "The server is down; see the service line above"
  else
    info "Port 11434: $(echo "$lst" | tr '\n' ';' | sed 's/;$//')"
    if [ -n "$pid" ] && ! echo "$lst" | grep -q "PID $pid "; then
      dbad "Port 11434 is held by a process that is NOT the Lefi Crop AI service" "Another Ollama is answering with other settings (bind, keep-alive). Stop it, then: lefi restart ai"
    fi
  fi
  ver="$(curl -fsS -m 3 "$url/api/version" 2>/dev/null | json_field version)"
  if [ -n "$ver" ]; then dok "Ollama API answers (version $ver)"
  else dbad "Ollama API does not answer on $url" "The process may be starting, hung or crashed: lefi logs ai -n 100"; fi

  if [ -z "$model" ]; then dbad "OLLAMA_MODEL is not set in .env" "Run: lefi setup"
  else
    model_is_supported "$model" && dok "Configured model $model is in config/supported-models.tsv" \
      || dbad "Configured model $model is not in config/supported-models.tsv" "Choose a supported model: lefi setup"
    if OLLAMA_HOST=127.0.0.1:11434 "$bin" list 2>/dev/null | awk -v m="$model" '$1==m{f=1} END{exit !f}'; then dok "$model is installed"
    else dbad "$model is NOT installed (not in 'ollama list')" "Download it (needs internet once): lefi setup"; fi
  fi
  if [ -n "$ver" ]; then
    models="$(ps_models "$url")"
    if [ -z "$models" ]; then info "No model in memory right now (it loads on the next request)."
    else
      printf '%s\n' "$models" | while IFS= read -r m; do info "In memory: $(printf '%s' "$m" | json_field name) · $(model_line_info "$m")"; done
      [ -n "$(ps_model_line "$url" "$model")" ] || dwarn "The model in memory is not the configured one ($model)" "Someone loaded another model; free it with: lefi ai unload"
      printf '%s\n' "$models" | while IFS= read -r m; do
        awk -v s="$(printf '%s' "$m" | json_field size)" -v v="$(printf '%s' "$m" | json_field size_vram)" 'BEGIN{exit !(s>0 && v<s)}' \
          && warn "$(printf '%s' "$m" | json_field name) is only partly on the GPU — the CPU part is much slower (not enough free memory)"
      done
    fi
  fi

  mem_verdict
  if [ "$MV_LEVEL" = WARN ]; then
    dwarn "Memory: $MV_TEXT" "Parts of memory are on disk: answers get slower. On a 16 GB Mac the AI node should run" \
      "only Ollama: close browsers/IDEs/Docker, or reboot. Then measure: lefi ai bench" \
      "(< 8 tok/s → consider gemma4:e4b). Biggest memory users (the model's GPU memory is not listed):"
    top_mem_procs | sed 's/^/      /'
  else dok "Memory: $MV_TEXT"; fi
  dir="$(ollama_models_dir)"; [ -d "$dir" ] || dir="$HOME"
  free_gb="$(df -k "$dir" 2>/dev/null | awk 'NR==2{printf "%d", $4/1048576}')"
  if [ -n "$free_gb" ] && [ "$free_gb" -lt 10 ]; then dbad "Only $free_gb GB free on the disk holding the models" "Downloads and logs can fail: free space or run 'lefi logs rotate'"
  else dok "Disk free where models live: ${free_gb:-?} GB"; fi
  if is_macos; then
    pw="$(power_source)"; lim="$(cpu_speed_limit)"
    info "Power: ${pw:-?} · CPU speed limit: ${lim:-100}%"
    [ "$pw" = "Battery Power" ] && dwarn "Running on battery" "macOS may reduce performance; plug in the charger for demos"
    [ -n "$lim" ] && [ "$lim" -lt 100 ] 2>/dev/null && dwarn "Thermal throttling (CPU limited to $lim%)" "Improve ventilation; avoid running the Mac closed on a soft surface"
  fi
}

# Codes that describe normal behaviour: shown, never counted as problems.
DIAG_INFO_CODES="CLIENT_ABORT APP_ACCOUNT"

hours_ago_stamp() {  # hours_ago_stamp H -> YYYYMMDDHHMMSS of now - H hours
  date -v-"$1"H +%Y%m%d%H%M%S 2>/dev/null || date -d "$1 hours ago" +%Y%m%d%H%M%S 2>/dev/null
}

ai_diagnose() {
  local since=24 a
  for a in "$@"; do case "$a" in --all) since="" ;; esac; done
  while [ $# -gt 0 ]; do case "$1" in --since) shift; since="${1:-24}" ;; esac; shift; done
  case "$since" in ''|*[!0-9]*) [ -n "$since" ] && die "--since expects hours" ;; esac
  # shellcheck disable=SC2086
  parse_n 5000 $CLI_CMDLINE
  detect_system >/dev/null 2>&1
  local report ts files rows tmp window; DIAG_PROBLEMS=0; DIAG_WARNS=0
  DIAG_CUTOFF=""; [ -n "$since" ] && DIAG_CUTOFF="$(hours_ago_stamp "$since")"
  window="last ${since:-all} hour(s)"; [ -z "$since" ] && window="whole log (--all)"
  ts="$(date +%Y%m%d-%H%M%S)"; mkdir -p "$REPORT_DIR"; chmod 700 "$REPORT_DIR"
  report="$REPORT_DIR/ai-diagnose-$ts.txt"; tmp="$(mktemp)"
  header "AI node diagnosis · $(hostname -s 2>/dev/null) · $(date '+%Y-%m-%d %H:%M')"
  {
    ai_diag_checks

    header "2 · Log analysis ($window, up to $NLINES lines per log)"
    files="$(svc_log ai)"
    [ -f "$HOME/.ollama/logs/server.log" ] && files="$files $HOME/.ollama/logs/server.log"
    files="$files $AI_EVENTS_LOG $(ls -1t "$LOG_DIR"/install-*.log 2>/dev/null | head -n1)"
    info "Sources: $(for f in $files; do [ -f "$f" ] && printf '%s ' "$f"; done)"
    [ -f "$HOME/.ollama/logs/server.log" ] && info "(server.log belongs to the Ollama desktop app, not to the Lefi Crop AI service)"
    # shellcheck disable=SC2086
    rows="$(classify_logs $files)"
    local old; old="$(printf '%s\n' "$rows" | awk -F'\t' '$1=="_OLD"{print $2}')"
    rows="$(printf '%s\n' "$rows" | grep -v '^_OLD' | grep -v '^$')"
    if [ -z "$rows" ]; then ok "No known problem patterns found."
    else
      printf '%s\n' "$rows" | while IFS="$(printf '\t')" read -r code n first last sample why fix; do
        case " $DIAG_INFO_CODES " in
          *" $code "*) printf '\n  %s%s%s · %s time(s) · first %s · last %s %s(informational, not a problem)%s\n' "$C_BLUE$C_BOLD" "$code" "$C_RESET" "$n" "$first" "$last" "$C_DIM" "$C_RESET" ;;
          *) printf '\n  %s%s%s · %s time(s) · first %s · last %s\n' "$C_RED$C_BOLD" "$code" "$C_RESET" "$n" "$first" "$last" ;;
        esac
        info "  What it means: $why"
        info "  What to do:    $fix"
        info "  Last line:     $sample"
      done
      local real; real="$(printf '%s\n' "$rows" | cut -f1 | while read -r c; do
        case " $DIAG_INFO_CODES " in *" $c "*) ;; *) echo "$c" ;; esac; done | grep -c .)"
      DIAG_PROBLEMS=$((DIAG_PROBLEMS + ${real:-0}))
    fi
    [ -n "$old" ] && info "$old older matching line(s) ignored (before the window). Include them: lefi ai diagnose --all"

    header "3 · Recent AI events (ai-events.log)"
    if [ -s "$AI_EVENTS_LOG" ]; then tail -n 10 "$AI_EVENTS_LOG" | cut -c1-200 | sed 's/^/    /'
    else info "No events recorded yet (lefi ai test / bench / off / cancel write here)."; fi

    header "Verdict"
    if [ "$DIAG_PROBLEMS" -eq 0 ] && [ "$DIAG_WARNS" -eq 0 ]; then ok "No problems found. Performance: lefi ai bench · history: lefi ai perf"
    elif [ "$DIAG_PROBLEMS" -eq 0 ]; then warn "No problems, $DIAG_WARNS warning(s) above: the AI works but may be slower or less reliable."
    else warn "$DIAG_PROBLEMS problem(s) found — follow the 'What to do' lines above, top to bottom."; fi
    ai_event INFO diagnose "problems=$DIAG_PROBLEMS report=$report"
  } 2>&1 | tee "$tmp"
  sed 's/\x1b\[[0-9;]*m//g' "$tmp" | redact >"$report"; rm -f "$tmp"
  {
    echo; echo "================ Context for deep analysis ================"
    echo "--- versions"; uname -a; [ -n "$(ollama_bin)" ] && ollama_version "$(ollama_bin)"
    echo "--- .env (redacted, AI keys)"; [ -f "$ENV_FILE" ] && grep -E '^(OLLAMA|LEFI_AI)' "$ENV_FILE" | redact
    echo "--- service spec"; [ -f "$(svc_spec ai)" ] && redact <"$(svc_spec ai)"
    echo "--- processes"; lefi_procs | awk '$6 ~ /^ai/'
    echo "--- last 80 lines of $(svc_log ai)"; [ -f "$(svc_log ai)" ] && tail -n 80 "$(svc_log ai)" | redact
    echo "--- last 40 AI events"; [ -f "$AI_EVENTS_LOG" ] && tail -n 40 "$AI_EVENTS_LOG"
    echo "--- last 20 performance measurements"; [ -f "$AI_PERF_LOG" ] && tail -n 20 "$AI_PERF_LOG"
  } >>"$report" 2>&1
  chmod 600 "$report"
  echo; info "Full report with context: $report"
}

# ---------------------------------------------------------------- lefi ai health
# Fast yes/no health of the AI (seconds, no generation unless --deep), with an exit code for
# scripts: 0 OK · 1 DEGRADED (works, but something will hurt quality/speed) · 2 DOWN / DISABLED.
# Works on the AI node (all checks) and on a core node (remote checks through OLLAMA_BASE_URL).
H_CHECKS=""
hc() { H_CHECKS="${H_CHECKS}$1	$2	$3
"; }  # hc NAME OK|WARN|FAIL DETAIL

api_has_model() {  # api_has_model URL MODEL -> 0 if MODEL is in /api/tags
  curl -fsS -m 5 "$1/api/tags" 2>/dev/null | awk '{gsub(/\{"name":/, "\n{\"name\":"); print}' | grep '^{"name"' \
    | while IFS= read -r m; do [ "$(printf '%s' "$m" | json_field name)" = "$2" ] && echo yes; done | grep -q yes
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r\t'; }

ai_health_collect() {  # ai_health_collect DEEP(0|1) -> H_CHECKS, H_STATUS
  local deep="$1" url model ver t0 t1 ms m line size vram mf sw dir free_gb pw lim pid
  url="$(ai_url)"; model="$(env_get OLLAMA_MODEL)"; H_CHECKS=""
  if [ -f "$AI_KILL_FLAG" ]; then hc killswitch FAIL "AI disabled by kill switch — $(head -n1 "$AI_KILL_FLAG")"
  elif [ "$HAS_AI" != 1 ] && [ "$(env_get LEFI_AI_ENABLED)" = false ]; then hc killswitch FAIL "LEFI_AI_ENABLED=false on this Brain"
  else hc killswitch OK "AI allowed"; fi

  if [ "$HAS_AI" = 1 ]; then
    pid="$(svc_pid ai)"
    if [ -n "$pid" ]; then hc service OK "com.lefi-crop.ollama running (PID $pid)"
    elif port_listening 11434; then hc service WARN "port 11434 answered by a process that is not the Lefi Crop AI service"
    else hc service FAIL "Ollama service not running (lefi start ai)"; fi
  fi

  [ -n "$url" ] || { hc api FAIL "OLLAMA_BASE_URL not configured"; ai_health_status; return; }
  t0="$(perl -MTime::HiRes=time -e 'printf "%d", time*1000' 2>/dev/null || date +%s000)"
  ver="$(curl -fsS -m 3 "$url/api/version" 2>/dev/null | json_field version)"
  t1="$(perl -MTime::HiRes=time -e 'printf "%d", time*1000' 2>/dev/null || date +%s000)"; ms=$((t1 - t0))
  if [ -z "$ver" ]; then hc api FAIL "Ollama API not answering at $url"; ai_health_status; return; fi
  if [ "$ms" -gt 1000 ]; then hc api WARN "Ollama $ver at $url answered slowly (${ms} ms)"
  else hc api OK "Ollama $ver at $url (${ms} ms)"; fi

  if [ -z "$model" ]; then hc model FAIL "OLLAMA_MODEL not set in .env"
  elif ! model_is_supported "$model"; then hc model FAIL "$model is not in config/supported-models.tsv"
  elif ! api_has_model "$url" "$model"; then hc model FAIL "$model is not installed on the AI node"
  else hc model OK "$model installed"; fi

  if [ -n "$model" ]; then
    line="$(ps_model_line "$url" "$model" | head -n1)"
    if [ -n "$line" ]; then
      size="$(printf '%s' "$line" | json_field size)"; vram="$(printf '%s' "$line" | json_field size_vram)"
      if awk -v s="${size:-0}" -v v="${vram:-0}" 'BEGIN{exit !(s>0 && v<s)}'; then
        hc loaded WARN "$model loaded but only $(model_gpu_pct "$url" "$model")% on the GPU (slow CPU part)"
      else hc loaded OK "$model in memory ($(human_bytes "${size:-0}"), 100% GPU)"; fi
    elif [ -n "$(ps_models "$url")" ]; then
      hc loaded WARN "another model is in memory, not $model (lefi ai unload)"
    else hc loaded OK "not in memory yet — loads on the next request (first answer slower)"; fi
  fi

  if [ "$HAS_AI" = 1 ]; then
    mem_verdict; hc memory "$MV_LEVEL" "$MV_TEXT"
    dir="$(ollama_models_dir)"; [ -d "$dir" ] || dir="$HOME"
    free_gb="$(df -k "$dir" 2>/dev/null | awk 'NR==2{printf "%d", $4/1048576}')"
    if [ -n "$free_gb" ] && [ "$free_gb" -lt 2 ]; then hc disk FAIL "only ${free_gb} GB free"
    elif [ -n "$free_gb" ] && [ "$free_gb" -lt 10 ]; then hc disk WARN "only ${free_gb} GB free"
    else hc disk OK "${free_gb:-?} GB free"; fi
    if is_macos; then
      pw="$(power_source)"; lim="$(cpu_speed_limit)"
      if [ "$pw" = "Battery Power" ]; then hc power WARN "on battery — plug in for full performance"
      elif [ -n "$lim" ] && [ "$lim" -lt 100 ] 2>/dev/null; then hc power WARN "thermal throttling (CPU limited to ${lim}%)"
      else hc power OK "${pw:-?}, no throttling"; fi
    fi
  fi

  if [ "$deep" = 1 ] && [ -n "$model" ] && [ ! -f "$AI_KILL_FLAG" ]; then
    # ~30 tokens: enough for a meaningful tokens/s figure, still only a few seconds.
    if ollama_generate "$url" "$model" "Count from 1 to 15, numbers separated by spaces, nothing else." 40 '"temperature":0'; then
      gen_metrics "$GEN_BODY"
      if [ "${M_GEN_N:-0}" -lt 10 ]; then
        hc inference OK "answered in ${M_TOTAL_MS} ms (answer too short to measure speed: lefi ai bench)"
      else
        perf_record health "$model" "$(model_gpu_pct "$url" "$model")"
        if awk -v t="$M_GEN_TPS" 'BEGIN{exit !(t<8)}'; then hc inference WARN "answered in ${M_TOTAL_MS} ms but slow: ${M_GEN_TPS} tok/s over ${M_GEN_N} tokens (lefi ai bench)"
        else hc inference OK "answered in ${M_TOTAL_MS} ms · ${M_GEN_TPS} tok/s over ${M_GEN_N} tokens"; fi
      fi
    else
      hc inference FAIL "$GEN_ERROR"
      ai_event ERROR health "deep inference failed: model=$model http=${GEN_HTTP:-?} error=\"$GEN_ERROR\" body=$(printf '%s' "$GEN_BODY" | tr -d '\n' | head -c 400)"
    fi
  fi
  ai_health_status
}

ai_health_status() {
  if printf '%s' "$H_CHECKS" | awk -F'\t' '$1=="killswitch" && $2=="FAIL"{f=1} END{exit !f}'; then H_STATUS=DISABLED
  elif printf '%s' "$H_CHECKS" | awk -F'\t' '$2=="FAIL"{f=1} END{exit !f}'; then H_STATUS=DOWN
  elif printf '%s' "$H_CHECKS" | awk -F'\t' '$2=="WARN"{f=1} END{exit !f}'; then H_STATUS=DEGRADED
  else H_STATUS=OK; fi
}

# Record only state changes in ai-events.log (keeps the history readable).
ai_health_track() {
  local f="$LEFI_STATE_DIR/run/ai-health.state" prev reasons lvl
  mkdir -p "$(dirname "$f")" 2>/dev/null || return 0
  prev="$(cat "$f" 2>/dev/null)"; [ "$prev" = "$H_STATUS" ] && return 0
  echo "$H_STATUS" >"$f"
  reasons="$(printf '%s' "$H_CHECKS" | awk -F'\t' '$2!="OK"{printf "%s%s: %s", (n++?"; ":""), $1, $3}')"
  case "$H_STATUS" in OK) lvl=INFO ;; DEGRADED) lvl=WARN ;; *) lvl=ERROR ;; esac
  ai_event "$lvl" health "${prev:-UNKNOWN} -> $H_STATUS${reasons:+ ($reasons)}"
}

ai_health() {
  local deep=0 fmt=text a col sym
  for a in "$@"; do case "$a" in --deep) deep=1 ;; --json) fmt=json ;; -q|--quiet) fmt=quiet ;;
    *) die "Usage: lefi ai health [--deep] [--json | --quiet]" ;; esac; done
  detect_system >/dev/null 2>&1
  ai_health_collect "$deep"
  ai_health_track
  case "$fmt" in
    json)
      printf '{"status":"%s","checked_at":"%s","node":"%s","model":"%s","deep":%s,"checks":[' "$H_STATUS" \
        "$(date +%Y-%m-%dT%H:%M:%S%z)" "$(json_escape "$(hostname -s 2>/dev/null)")" "$(json_escape "$(env_get OLLAMA_MODEL)")" \
        "$( [ "$deep" = 1 ] && echo true || echo false)"
      printf '%s' "$H_CHECKS" | while IFS="$(printf '\t')" read -r n s d; do
        printf '%s{"name":"%s","status":"%s","detail":"%s"}' "$sep" "$n" "$s" "$(json_escape "$d")"; sep=","
      done
      printf ']}\n' ;;
    quiet) printf 'AI %s%s\n' "$H_STATUS" "$(printf '%s' "$H_CHECKS" | awk -F'\t' '$2!="OK"{printf "%s%s", (n++?"; ":" — "), $3}')" ;;
    *)
      case "$H_STATUS" in OK) col="$C_GREEN" ;; DEGRADED) col="$C_YELLOW" ;; *) col="$C_RED" ;; esac
      printf '\n  %sAI health: %s%s%s\n' "$C_BOLD" "$col" "$H_STATUS" "$C_RESET"
      printf '%s' "$H_CHECKS" | while IFS="$(printf '\t')" read -r n s d; do
        case "$s" in OK) sym="${C_GREEN}✔${C_RESET}" ;; WARN) sym="${C_YELLOW}!${C_RESET}" ;; *) sym="${C_RED}✖${C_RESET}" ;; esac
        printf '  %s %-11s %s\n' "$sym" "$n" "$d"
      done
      case "$H_STATUS" in
        DEGRADED) info "Works, but something hurts speed or reliability. Details: lefi ai diagnose" ;;
        DOWN) info "The AI cannot answer right now. Explained causes: lefi ai diagnose" ;;
        DISABLED) info "Stopped on purpose by the kill switch. Re-enable: lefi ai on" ;;
      esac
      [ "$deep" = 1 ] || info "Quick check (no generation). Add --deep for a real inference."
      echo ;;
  esac
  case "$H_STATUS" in OK) return 0 ;; DEGRADED) return 1 ;; *) return 2 ;; esac
}
