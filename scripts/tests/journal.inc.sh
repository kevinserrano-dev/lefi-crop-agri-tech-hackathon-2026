# shellcheck shell=bash
# Install journal, cancel and rollback tests (ADR-032). Sourced by run.sh (uses its helpers).
# Everything happens under $J: a fake HOME, a fake Homebrew whose "installed" list is a file, and
# a fake launchctl that only records its arguments. No real package or service is touched.

echo "== install journal, cancel and rollback (fake brew/launchctl, temporary HOME)"
J="$TMP/journal"; mkdir -p "$J/bin" "$J/home"
cat >"$J/bin/brew" <<'FAKE'
#!/bin/sh
db="$JTEST/brew-installed"
case "$1" in
  list) cat "$db" ;;
  install) echo "$2" >>"$db"; [ "$2" = mosquitto ] && echo libwebsockets >>"$db"; touch "$JTEST/bin/$2"; chmod +x "$JTEST/bin/$2" ;;
  uninstall) shift; [ "$1" = --formula ] && shift
    for p in "$@"; do grep -vx "$p" "$db" >"$db.n"; mv "$db.n" "$db"; rm -f "$JTEST/bin/$p"; done
    echo "uninstall $*" >>"$JTEST/calls" ;;
  --version) echo "Homebrew 9.9.9-fake" ;;
esac
FAKE
cat >"$J/bin/launchctl" <<'FAKE'
#!/bin/sh
echo "launchctl $*" >>"$JTEST/calls"
FAKE
chmod +x "$J/bin/"*

# jrun SCRIPT — libraries loaded as on macOS, inside the sandbox; NDJSON events in events.ndjson.
jrun() {
  ( export JTEST="$J" HOME="$J/home" OS=Darwin PATH="$J/bin:/usr/bin:/bin" LEFI_ROOT="$ROOT" \
      LEFI_SERVICE_MODE=launchd LEFI_STATE_DIR="$J/home/.lefi-crop" ENV_FILE="$J/home/repo.env"
    bash -c '
      for lib in common detect system journal role_desktop; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
      EVENTS=1; exec 3>&1 1>>"$JTEST/human.log" 2>&1
      '"$1" ) >"$J/events.ndjson"
}
snapshot() { (cd "$J/home" && find . -print | LC_ALL=C sort; cat "$J/brew-installed"; cat "$J/home/.zshrc") 2>/dev/null; }
ev_py() { python3 -I -c "import json,sys
ev=[json.loads(l) for l in open(sys.argv[1])]
$1" "$J/events.ndjson" 2>&1; }

# 1) A fresh install: everything it created disappears; what existed before is untouched.
printf 'git\n' >"$J/brew-installed"; printf 'export ORIGINAL=1\n' >"$J/home/.zshrc"; : >"$J/calls"
before="$(snapshot)"
printf 'port={{PORT}}\n' >"$J/tpl"
jrun '
  state_existed=0; [ -d "$LEFI_STATE_DIR" ] && state_existed=1
  log_init; journal_init TEST; [ "$state_existed" = 1 ] || j_add dir_created "$LEFI_STATE_DIR"
  env_set LEFI_TEST 1
  render "'"$J/tpl"'" "$LEFI_STATE_DIR/app/app.conf" PORT=1883
  pkg_install mosquitto mosquitto
  start_service ollama "$LOG_DIR/ollama.log" "" /usr/bin/true serve
  j_file "$HOME/.zshrc"; echo "export PATH=/fake:\$PATH" >>"$HOME/.zshrc"
  rollback_run "$JOURNAL_FILE" requested'
expect_eq "fresh install: home, Homebrew list and .zshrc back to the original" "$(snapshot)" "$before"
expect_eq "fresh install: the service was unloaded" \
  "$(grep -c 'launchctl bootout gui/[0-9]*/com.lefi-crop.ollama' "$J/calls")" "2"
expect_eq "fresh install: only the packages this run added were uninstalled" \
  "$(grep '^uninstall' "$J/calls")" "uninstall libwebsockets mosquitto"
expect_eq "fresh install: rollback.done ok, every item reported" "$(ev_py '
d=[e for e in ev if e["event"]=="rollback.done"][0]; s=[e for e in ev if e["event"]=="rollback.started"][0]
print(d["result"], d["failed"], len([e for e in ev if e["event"]=="rollback.item"])==s["items_total"])')" "ok 0 True"
expect_eq "fresh install: the report survives the deleted state folder" "$(ev_py '
import os
d=[e for e in ev if e["event"]=="rollback.done"][0]
print(all(os.path.exists(os.path.join(d["report"],f)) for f in ("rollback.log","summary.tsv","journal.tsv")))')" "True"

# 2) A re-install: files that existed are restored, the previous service is loaded again.
mkdir -p "$J/home/.lefi-crop" "$J/home/Library/LaunchAgents"
printf 'LEFI_TEST=old\n' >"$J/home/repo.env"
printf '<plist>old</plist>\n' >"$J/home/Library/LaunchAgents/com.lefi-crop.ollama.plist"
: >"$J/calls"
keep_files() { cat "$J/home/repo.env" "$J/home/Library/LaunchAgents/com.lefi-crop.ollama.plist"; }
before="$(keep_files)"
jrun '
  log_init; journal_init TEST2
  env_set LEFI_TEST new; env_set LEFI_OTHER 2
  start_service ollama "$LOG_DIR/ollama.log" "" /usr/bin/true serve
  rollback_run "$JOURNAL_FILE" requested'
expect_eq "re-install: .env and the previous plist restored byte for byte" "$(keep_files)" "$before"
expect_eq "re-install: the state folder that existed before is kept" "$( [ -d "$J/home/.lefi-crop" ] && echo kept)" "kept"
expect_eq "re-install: the previous service was bootstrapped again" \
  "$(grep -c 'launchctl bootstrap gui/[0-9]* .*com.lefi-crop.ollama.plist' "$J/calls")" "2"

# 3) Safety: a journal can never make the rollback delete a system or home folder.
mkdir -p "$J/home/made"; echo x >"$J/home/made/f"
printf '# lefi install journal v1\ndir_created\t/\ndir_created\t%s\ndir_created\t/usr/local/bin\ndir_created\t%s/made\n' \
  "$J/home" "$J/home" >"$J/bad.tsv"
jrun 'LOG_FILE=/dev/null; rollback_run "'"$J/bad.tsv"'" requested'
expect_eq "safety: /, HOME and /usr/local/bin kept; a folder the run created is removed" \
  "$( [ -d "$J/home" ] && echo kept) $( [ -e "$J/home/made" ] && echo present || echo removed)" "kept removed"

# 4) Cancel between steps: the run stops, rolls back and reports "cancelled" (exit 130).
rm -rf "$J/home/.lefi-crop" "$J/home/repo.env"; : >"$J/human.log"; touch "$J/cancel"
jrun '
  log_init; journal_init TEST4; j_add dir_created "$LEFI_STATE_DIR"
  plan_add a "Step A"; plan_add b "Step B"; plan_start install
  step_begin a; env_set LEFI_TEST 1
  CANCEL_FILE="$JTEST/cancel"
  step_begin b; echo "NOT REACHED"'; rc=$?
expect_eq "cancel: exit 130, step B never ran, everything undone" \
  "$rc $(grep -c 'NOT REACHED' "$J/human.log") $( { [ -e "$J/home/.lefi-crop" ] || [ -e "$J/home/repo.env" ]; } && echo left || echo clean)" \
  "130 0 clean"
expect_eq "cancel: A finished, B never started, rollback ok, plan.done cancelled" "$(ev_py '
ok=[e["step"] for e in ev if e["event"]=="step.ok"]; st=[e["step"] for e in ev if e["event"]=="step.started"]
d=[e for e in ev if e["event"]=="plan.done"][0]
print(ok, st, d["result"], d["rollback"]["result"])')" "['a'] ['a'] cancelled ok"
rm -f "$J/cancel"

# 5) Cancel during the model download; latest_journal ignores runs already rolled back.
touch "$J/cancel"
res="$( LEFI_ROOT="$ROOT" LEFI_STATE_DIR="$TMP/pp" LEFI_SERVICE_MODE=user CANCEL_FILE="$J/cancel" bash -c '
  for lib in common hwscan recommend system journal role_ai; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
  PULL_STATE="$(mktemp)"; pull_progress <"$1" | tail -n1; rm -f "$PULL_STATE"' _ "$TMP/pull.ndjson")"
expect_eq "pull: a cancel request stops the download" "$res" "cancelled"
rm -f "$J/cancel"
mkdir -p "$J/lj/install/journal"
: >"$J/lj/install/journal/run-20260101-000000.tsv"; : >"$J/lj/install/journal/run-20260102-000000.tsv"
: >"$J/lj/install/journal/run-20260102-000000.tsv.rolledback"
lj="$( LEFI_ROOT="$ROOT" LEFI_STATE_DIR="$J/lj" LEFI_SERVICE_MODE=user bash -c '
  for lib in common system journal; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done; latest_journal')"
expect_eq "latest_journal: newest run not yet rolled back" "$(basename "$lj")" "run-20260101-000000.tsv"

# 6) install.sh --rollback with nothing to undo: clean exit and a machine-readable result.
if [ "$(uname -s)" = Darwin ]; then rb_args=""; else rb_args="--service-mode user"; fi
# shellcheck disable=SC2086
HOME="$J/home" LEFI_STATE_DIR="$J/none" ENV_FILE="$J/none.env" "$ROOT/scripts/install.sh" --rollback $rb_args --events ndjson \
  >"$J/rb.ndjson" 2>/dev/null; rc=$?
expect_eq "--rollback with no journal: exit 0, result nothing" \
  "$rc $(grep -c '"event":"rollback.done".*"result":"nothing"' "$J/rb.ndjson")" "0 1"

# 7) Models: the rollback deletes a model only if this run finished downloading that exact copy.
cat >"$J/bin/ollama" <<'FAKE'
#!/bin/sh
case "$1" in
  list) echo "NAME ID SIZE MODIFIED"; cat "$JTEST/ollama-models" ;;
  rm) echo "rm $2" >>"$JTEST/ollama-calls" ;;
esac
FAKE
chmod +x "$J/bin/ollama"
model_case() {  # model_case JOURNAL_LINES INSTALLED_LINE -> ollama calls
  : >"$J/ollama-calls"; printf '%s\n' "$2" >"$J/ollama-models"
  printf '# lefi install journal v1\n%b' "$1" >"$J/m.tsv"
  jrun 'LOG_FILE=/dev/null; RB_OLLAMA_HOST=127.0.0.1:9; rollback_run "'"$J/m.tsv"'" requested'
  cat "$J/ollama-calls"
}
expect_eq "model: download not finished (no model_ready) -> never deleted" \
  "$(model_case 'model_pulled\tfake:1b\n' 'fake:1b aaa111 1 GB now')" ""
expect_eq "model: installed copy differs from the one this run downloaded -> kept" \
  "$(model_case 'model_pulled\tfake:1b\nmodel_ready\tfake:1b\taaa111\n' 'fake:1b bbb222 1 GB now')" ""
expect_eq "model: this run downloaded this exact copy -> deleted" \
  "$(model_case 'model_pulled\tfake:1b\nmodel_ready\tfake:1b\taaa111\n' 'fake:1b aaa111 1 GB now')" "rm fake:1b"

# 8) --rollback --journal: exactly the runs of one command (before and after a restart), in
#    reverse order; journals outside this installation's folder and runs already undone are skipped.
R="$J/rj"; mkdir -p "$R/state/install/journal" "$R/files"
for n in 1 2 3; do echo x >"$R/files/f$n"; done
printf '# lefi install journal v1\nfile_created\t%s\n' "$R/files/f1" >"$R/state/install/journal/run-20260101-000001.tsv"
printf '# lefi install journal v1\nfile_created\t%s\n' "$R/files/f2" >"$R/state/install/journal/run-20260101-000002.tsv"
printf '# lefi install journal v1\nfile_created\t%s\n' "$R/files/f3" >"$R/state/install/journal/run-20260101-000003.tsv"
printf '# lefi install journal v1\nfile_created\t%s\n' "$R/files/f3" >"$R/outside.tsv"
if [ "$(uname -s)" = Darwin ]; then rb_args=""; else rb_args="--service-mode user"; fi
# shellcheck disable=SC2086
HOME="$R" LEFI_STATE_DIR="$R/state" ENV_FILE="$R/none.env" "$ROOT/scripts/install.sh" --rollback $rb_args \
  --journal "$R/state/install/journal/run-20260101-000001.tsv" --journal "$R/state/install/journal/run-20260101-000002.tsv" \
  --journal "$R/outside.tsv" --events ndjson >"$R/rb.ndjson" 2>/dev/null; rc=$?
expect_eq "--journal: both runs of the command undone, the other run and outside paths untouched" \
  "$rc $( [ -e "$R/files/f1" ] && echo f1) $( [ -e "$R/files/f2" ] && echo f2) $( [ -e "$R/files/f3" ] && echo f3-kept) $(grep -c '"event":"rollback.done"' "$R/rb.ndjson")" \
  "0   f3-kept 2"

# 9) Lefi Desktop role: copied from the payload, undone by the rollback; a version that was
#    already installed comes back (FAKE app bundles, temporary Applications folder).
mkdir -p "$J/fakeapp/new/Lefi Crop.app/Contents/MacOS" "$J/home/Apps"
echo "new" >"$J/fakeapp/new/Lefi Crop.app/Contents/MacOS/marker"
rm -rf "$J/home/.lefi-crop" "$J/home/repo.env"; : >"$J/human.log"
desk() {
  jrun '
    export LEFI_DESKTOP_SRC="$JTEST/fakeapp/new/Lefi Crop.app" LEFI_DESKTOP_DIR="$JTEST/home/Apps"
    log_init; journal_init D'"$1"'; j_add dir_created "$LEFI_STATE_DIR"
    role_desktop_install
    cat "$LEFI_DESKTOP_DIR/Lefi Crop.app/Contents/MacOS/marker" >>"$JTEST/desk.log"
    xattr -p com.apple.quarantine "$LEFI_DESKTOP_DIR/Lefi Crop.app/Contents/MacOS/marker" >>"$JTEST/desk-q.log" 2>/dev/null || true
    rollback_run "$JOURNAL_FILE" requested'
}
# The desktop role copies with macOS ditto (Linux packages are tech debt, ADR-034).
if ! command -v ditto >/dev/null 2>&1; then
  t_skip "desktop: installed from the payload, then removed by the rollback" "needs macOS ditto"
  t_skip "desktop: over an older version, the rollback brings the old one back" "needs macOS ditto"
else
# A file marked by a download or AirDrop; on other systems xattr does not exist and this stays a no-op.
xattr -w com.apple.quarantine "0081;00000000;test;" "$J/fakeapp/new/Lefi Crop.app/Contents/MacOS/marker" 2>/dev/null || true
: >"$J/desk-q.log"
: >"$J/desk.log"; desk 1
expect_eq "desktop: installed from the payload, then removed by the rollback" \
  "$(cat "$J/desk.log") $( [ -e "$J/home/Apps/Lefi Crop.app" ] && echo left || echo removed)" "new removed"
expect_eq "desktop: the installed app does not keep the quarantine mark" "$(cat "$J/desk-q.log")" ""
mkdir -p "$J/home/Apps/Lefi Crop.app/Contents/MacOS"; echo "old" >"$J/home/Apps/Lefi Crop.app/Contents/MacOS/marker"
: >"$J/desk.log"; desk 2
expect_eq "desktop: over an older version, the rollback brings the old one back" \
  "$(cat "$J/desk.log") $(cat "$J/home/Apps/Lefi Crop.app/Contents/MacOS/marker")" "new old"
fi

# One installer at a time: a live one is refused, one that ended is not.
mkdir -p "$J/other" "$J/home/.lefi-crop/install"
printf '#!/bin/sh\nwhile :; do sleep 1; done\n' >"$J/other/install.sh"; chmod +x "$J/other/install.sh"
"$J/other/install.sh" & OTHER_PID=$!
echo "$OTHER_PID" >"$J/home/.lefi-crop/install/installer.pid"
: >"$J/lock.log"
jrun 'log_init; install_lock; echo got >>"$JTEST/lock.log"'
expect_eq "lock: refused while another installer runs" "$(cat "$J/lock.log")" ""
kill "$OTHER_PID" 2>/dev/null; wait "$OTHER_PID" 2>/dev/null
jrun 'log_init; install_lock; echo got >>"$JTEST/lock.log"'
expect_eq "lock: taken when the other one ended" "$(cat "$J/lock.log")" "got"
rm -f "$J/home/.lefi-crop/install/installer.pid"

echo "== remove a component (fake launchctl, temporary HOME)"
R="$TMP/remove"; mkdir -p "$R/home/Library/LaunchAgents" "$R/home/.lefi-crop/services" "$R/home/.lefi-crop/flags" "$R/apps/Lefi Crop.app/Contents" "$R/home/.ollama/models"
echo x >"$R/home/Library/LaunchAgents/com.lefi-crop.ollama.plist"
echo x >"$R/home/.lefi-crop/services/ollama.svc"
echo model >"$R/home/.ollama/models/fake"
printf 'LEFI_ROLES=ai,desktop\n' >"$R/home/lefi.env"
rrun() {
  HOME="$R/home" OS=Darwin JTEST="$J" PATH="$J/bin:/usr/bin:/bin" LEFI_STATE_DIR="$R/home/.lefi-crop" \
    ENV_FILE="$R/home/lefi.env" LEFI_DESKTOP_DIR="$R/apps" LEFI_SERVICE_MODE=launchd \
    "$ROOT/scripts/lib/../install.sh" --remove-role "$1" --events ndjson >"$R/ev.ndjson" 2>"$R/err.txt"
}
if [ "$(uname -s)" = Darwin ]; then
  : >"$J/calls"
  rrun ai; rc=$?
  expect_eq "remove ai: service stopped and its files gone; Ollama's models stay" \
    "$rc $(grep -c 'bootout gui/[0-9]*/com.lefi-crop.ollama' "$J/calls") $([ -e "$R/home/Library/LaunchAgents/com.lefi-crop.ollama.plist" ] && echo plist) $([ -e "$R/home/.lefi-crop/services/ollama.svc" ] && echo svc) $(cat "$R/home/.ollama/models/fake") $(grep '^LEFI_ROLES=' "$R/home/lefi.env")" \
    "0 1   model LEFI_ROLES=desktop"
  expect_eq "remove ai: plan.done ok" "$(grep -c '"event":"plan.done".*"result":"ok"' "$R/ev.ndjson")" "1"
  rrun desktop; rc=$?
  expect_eq "remove desktop: the app is gone" "$rc $([ -e "$R/apps/Lefi Crop.app" ] && echo app)" "0 "
  mkdir -p "$R/home/.lefi-crop/robot-sim"; echo BACKEND=lite >"$R/home/.lefi-crop/robot-sim/robot.conf"
  echo x >"$R/home/Library/LaunchAgents/com.lefi-crop.robot-sim.plist"
  rrun robot; rc=$?
  expect_eq "remove robot: unloaded, its plist and settings gone" \
    "$rc $(grep -c 'bootout gui/[0-9]*/com.lefi-crop.robot-sim' "$J/calls") $([ -e "$R/home/Library/LaunchAgents/com.lefi-crop.robot-sim.plist" ] && echo plist) $([ -e "$R/home/.lefi-crop/robot-sim/robot.conf" ] && echo conf)" \
    "0 1  "
else t_skip "remove" "macOS paths"; fi

echo "== Homebrew layouts and known failures (fake Homebrew, temporary HOME)"
B="$TMP/brewfake"; mkdir -p "$B/prefix/bin" "$B/prefix/opt/kegged/bin" "$B/home" "$B/state/logs"
cat >"$B/prefix/bin/brew" <<'FAKE'
#!/bin/sh
# FAKE Homebrew. `install`: mosquitto puts its broker in sbin, like the real formula; kegged only in
# its own folder; nettrouble and locked fail with what the real tools print.
P="$(cd "$(dirname "$0")/.." && pwd)"
case "$1" in
  --prefix) if [ -n "$2" ]; then echo "$P/opt/$2"; else echo "$P"; fi ;;
  list) ;;
  install)
    n="$(cat "$P/tries" 2>/dev/null || echo 0)"; echo $((n + 1)) >"$P/tries"
    case "$2" in
      mosquitto) mkdir -p "$P/sbin"; printf '#!/bin/sh\n' >"$P/sbin/mosquitto"; chmod +x "$P/sbin/mosquitto" ;;
      kegged) printf '#!/bin/sh\n' >"$P/opt/kegged/bin/kegged"; chmod +x "$P/opt/kegged/bin/kegged" ;;
      nettrouble) if [ "$n" -ge 1 ] && [ -n "$NET_RECOVERS" ]; then printf '#!/bin/sh\n' >"$P/bin/nettrouble"; chmod +x "$P/bin/nettrouble"; exit 0; fi
        echo "curl: (6) Could not resolve host: ghcr.io"; exit 1 ;;
      full) echo "Error: No space left on device"; exit 1 ;;
      ghost) ;;
    esac ;;
  *) exit 0 ;;
esac
FAKE
chmod +x "$B/prefix/bin/brew"
brun() {  # brun COMMANDS — the real pkg_install with the fake Homebrew; `sleep` does not wait
  printf '#!/bin/sh\nexit 0\n' >"$B/prefix/bin/sleep"; chmod +x "$B/prefix/bin/sleep"
  HOME="$B/home" OS=Darwin PATH="$B/prefix/bin:/usr/bin:/bin" LEFI_ROOT="$ROOT" LEFI_SERVICE_MODE=launchd \
    LEFI_STATE_DIR="$B/state" ENV_FILE="$B/env" NET_RECOVERS="${NET_RECOVERS:-}" bash -c '
    for lib in common detect system; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
    is_macos() { true; }
    record_component() { :; }
    LOG_FILE="$LEFI_STATE_DIR/logs/t.log"; : >"$LOG_FILE"
    die() { printf "DIED code=%s hint=%s\n" "${DIE_CODE:-}" "${DIE_HINT:-}"; exit 1; }
    '"$1" 2>/dev/null
}
expect_eq "brew: a broker installed in sbin is found (the error of the first real install)" \
  "$(brun 'pkg_install mosquitto mosquitto >/dev/null; command -v mosquitto' | sed "s#$B/prefix/##")" "sbin/mosquitto"
expect_eq "brew: already installed in sbin, on the next run nothing is reinstalled" \
  "$(rm -f "$B/prefix/tries"; brun 'pkg_install mosquitto mosquitto >/dev/null; cat "$(brew --prefix)/tries" 2>/dev/null || echo none')" "none"
expect_eq "brew: a formula not linked into the prefix is found in its own folder" \
  "$(brun 'pkg_install kegged kegged >/dev/null; command -v kegged' | sed "s#$B/prefix/##")" "opt/kegged/bin/kegged"
expect_eq "brew: installed but no program -> says what to do" \
  "$(brun 'pkg_install ghost ghost' | sed -n 's/^DIED code=\([A-Z_]*\).*/\1/p')" "PROGRAM_NOT_FOUND"
rm -f "$B/prefix/tries"
expect_eq "brew: no internet -> tried twice, then known code and hint" \
  "$(brun 'pkg_install nettrouble nettrouble' | sed -n 's/^DIED code=\([A-Z_]*\) hint=This PC needs internet.*/\1/p') $(cat "$B/prefix/tries")" "NO_INTERNET 2"
rm -f "$B/prefix/tries"
expect_eq "brew: a hiccup that clears by itself is not a failure" \
  "$(NET_RECOVERS=1 brun 'pkg_install nettrouble nettrouble >/dev/null; echo "survived $(cat "$(brew --prefix)/tries")"')" "survived 2"
rm -f "$B/prefix/bin/nettrouble"
expect_eq "brew: disk full -> known code" \
  "$(brun 'pkg_install full full' | sed -n 's/^DIED code=\([A-Z_]*\).*/\1/p')" "DISK_FULL"
mkdir -p "$B/payload/scripts"; cp -R "$ROOT/scripts/lib" "$B/payload/scripts/lib"
expect_eq "verify: a packaged install has no repository, and that is not a failure" \
  "$(HOME="$B/home" PATH="/usr/bin:/bin" LEFI_FORCE_PACKAGED=1 LEFI_ROOT="$B/payload" LEFI_SERVICE_MODE=launchd LEFI_STATE_DIR="$B/state" ENV_FILE="$B/env" bash -c '
    for lib in common detect system verify; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
    pass() { echo "PASS $*"; }; fail() { echo "FAIL $*"; }; wrn() { :; }; header() { :; }
    DISK_FREE_GB=99; LAN_IP=1.2.3.4
    check_system' 2>/dev/null | grep -c "git-ignored")" "0"

echo "== what the Install steps contain"
if [ "$(uname -s)" = Darwin ]; then
  steps() {  # steps ROLES -> the plan's step titles, from a real dry run with fake tools
    mkdir -p "$B/plan"; printf 'ROLES=%s\nCONTINUE=yes\nAI_URL=http://127.0.0.1:1\nINSTALL_HOMEBREW=yes\nINSTALL_CLI=no\n' "$1" >"$B/plan/a"
    HOME="$B/home" PATH="$B/prefix/bin:/usr/bin:/bin:/usr/sbin:/sbin" LEFI_STATE_DIR="$B/plan/s" ENV_FILE="$B/plan/e" \
      "$ROOT/scripts/install.sh" --answers "$B/plan/a" --dry-run --events ndjson 2>/dev/null \
      | python3 -I -c 'import json,sys
for l in sys.stdin:
    e=json.loads(l)
    if e["event"]=="plan.started": print("\n".join(s["title"] for s in e["steps"]))'
  }
  without="$(steps core,admin)"; with="$(steps core,admin,desktop)"
  expect_eq "plan: Lefi Desktop only when selected" \
    "$(printf '%s\n' "$without" | grep -c 'Lefi Desktop') $(printf '%s\n' "$with" | grep -c 'Lefi Desktop')" "0 1"
  expect_eq "plan: no web admin step" "$(printf '%s\n' "$with" | grep -ci 'admin')" "0"
  expect_eq "plan: Lefi Gateway has its steps" "$(printf '%s\n' "$with" | grep -c 'Lefi Gateway')" "2"
else t_skip "plan" "macOS paths"; fi

echo "== uninstall everything (fake Homebrew and launchctl, temporary HOME)"
if [ "$(uname -s)" = Darwin ]; then
  U2="$TMP/uninstall"; mkdir -p "$U2/home/Library/LaunchAgents" "$U2/home/.lefi-crop/credentials" "$U2/home/.lefi-crop/data" "$U2/home/.lefi-crop/install/journal" "$U2/apps/Lefi Crop.app/Contents" "$U2/home/keep" "$U2/home/.local/bin"
  for l in brain mosquitto helperd-main; do echo x >"$U2/home/Library/LaunchAgents/com.lefi-crop.$l.plist"; done
  echo other >"$U2/home/Library/LaunchAgents/com.other.app.plist"
  echo secret >"$U2/home/.lefi-crop/credentials/admin.txt"; echo db >"$U2/home/.lefi-crop/data/lefi.db"; echo mine >"$U2/home/keep/file"
  printf '# lefi install journal v1\ndir_created\t%s/home/.lefi-crop/made-by-run\n' "$U2" >"$U2/home/.lefi-crop/install/journal/run-20260101-000000.tsv"
  mkdir -p "$U2/home/.lefi-crop/made-by-run"; ln -s /somewhere/bin/lefi "$U2/home/.local/bin/lefi"; ln -s /other/tool "$U2/home/.local/bin/tool"
  : >"$J/calls"
  HOME="$U2/home" OS=Darwin JTEST="$J" PATH="$J/bin:/usr/bin:/bin" LEFI_STATE_DIR="$U2/home/.lefi-crop" LEFI_DESKTOP_DIR="$U2/apps" LEFI_SERVICE_MODE=launchd ENV_FILE="$U2/home/.lefi-crop/lefi.env" \
    "$ROOT/scripts/install.sh" --uninstall-everything --events ndjson >"$U2/ev" 2>"$U2/err"; rc=$?
  expect_eq "uninstall: data and passwords gone, plan.done ok" \
    "$rc $([ -e "$U2/home/.lefi-crop" ] && echo state) $(grep -c '"event":"plan.done".*"result":"ok"' "$U2/ev")" "0  1"
  expect_eq "uninstall: its services and app gone; its own service left to the app" \
    "$(ls "$U2/home/Library/LaunchAgents" | tr '\n' ' ')$([ -e "$U2/apps/Lefi Crop.app" ] && echo app)" "com.lefi-crop.helperd-main.plist com.other.app.plist "
  expect_eq "uninstall: other people's files and links stay" \
    "$(cat "$U2/home/keep/file") $([ -L "$U2/home/.local/bin/lefi" ] && echo lefi-link) $([ -L "$U2/home/.local/bin/tool" ] && echo tool-link)" "mine  tool-link"
  LEFI_T="$U2/home2"; mkdir -p "$LEFI_T"
  HOME="$LEFI_T" OS=Darwin JTEST="$J" PATH="$J/bin:/usr/bin:/bin" LEFI_STATE_DIR="$LEFI_T" LEFI_SERVICE_MODE=launchd ENV_FILE="$LEFI_T/e" \
    "$ROOT/scripts/install.sh" --uninstall-everything --events ndjson >/dev/null 2>&1; rc=$?
  expect_eq "uninstall: refuses a state folder equal to HOME" "$rc $([ -d "$LEFI_T" ] && echo kept)" "1 kept"
  # An erased node (ADR-054): no Lefi Crop service to stop, nobody logged in (FAKE launchctl says
  # Background, no session helper): the uninstall still runs.
  U3="$TMP/uninstall-bg"; mkdir -p "$U3/bin" "$U3/home/Library/LaunchAgents" "$U3/home/.lefi-crop/data" "$U3/session"
  printf '#!/bin/sh\n[ "$1" = managername ] && { echo Background; exit 0; }\necho "$*" >>"%s/calls"\nexit 5\n' "$U3" >"$U3/bin/launchctl"; chmod 755 "$U3/bin/launchctl"
  echo x >"$U3/home/Library/LaunchAgents/com.lefi-crop.helperd-satellite.plist"
  HOME="$U3/home" OS=Darwin PATH="$U3/bin:/usr/bin:/bin" LEFI_STATE_DIR="$U3/home/.lefi-crop" LEFI_DESKTOP_DIR="$U3/apps" LEFI_SERVICE_MODE=launchd ENV_FILE="$U3/home/.lefi-crop/lefi.env" LEFI_SESSION_DIR="$U3/session" \
    "$ROOT/scripts/install.sh" --uninstall-everything --events ndjson >"$U3/ev" 2>"$U3/err"; rc=$?
  expect_eq "uninstall without a session: nothing to stop, still done" \
    "$rc $([ -e "$U3/home/.lefi-crop" ] && echo state) $([ -e "$U3/calls" ] && echo launchctl-used)" "0  "
  echo x >"$U3/home/Library/LaunchAgents/com.lefi-crop.brain.plist"; mkdir -p "$U3/home/.lefi-crop/data"
  HOME="$U3/home" OS=Darwin PATH="$U3/bin:/usr/bin:/bin" LEFI_STATE_DIR="$U3/home/.lefi-crop" LEFI_DESKTOP_DIR="$U3/apps" LEFI_SERVICE_MODE=launchd ENV_FILE="$U3/home/.lefi-crop/lefi.env" LEFI_SESSION_DIR="$U3/session" \
    "$ROOT/scripts/install.sh" --uninstall-everything --events ndjson >/dev/null 2>&1; rc=$?
  expect_eq "uninstall without a session but a service to stop: refused, nothing deleted" \
    "$rc $([ -d "$U3/home/.lefi-crop/data" ] && echo kept)" "1 kept"
else t_skip "uninstall" "macOS paths"; fi
