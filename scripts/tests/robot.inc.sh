# shellcheck shell=bash
# The simulated robot as a component (ADR-091, ADR-090). Sourced by run.sh (uses its helpers).
# Linux paths (background process + pidfile) in a temporary HOME; a FAKE uv and a FAKE bridge
# that only sleeps. No real starter, Genesis or GPU is used.

echo "== simulated robot role (fake uv and bridge, temporary HOME)"
RB="$TMP/robot"; mkdir -p "$RB/bin" "$RB/home/.lefi-crop/services" "$RB/home/.lefi-crop/logs"
cat >"$RB/bin/uv" <<'FAKE'
#!/bin/sh
echo "uv $*" >>"$RBTEST/calls"
FAKE
chmod +x "$RB/bin/uv"
cp "$LINUX_BIN/uname" "$RB/bin/uname"

# rbrun SCRIPT — the libraries as the installer loads them, on "Linux", in user mode.
rbrun() {
  ( export RBTEST="$RB" HOME="$RB/home" PATH="$RB/bin:/usr/bin:/bin" LEFI_ROOT="$ROOT" \
      LEFI_SERVICE_MODE=user LEFI_STATE_DIR="$RB/home/.lefi-crop" ENV_FILE="$RB/home/lefi.env" \
      LOG_DIR="$RB/home/.lefi-crop/logs" ANSWERS_FILE="$RB/answers"
    bash -c '
      for lib in common detect system journal robot_sim role_ai role_optional; do . "$LEFI_ROOT/scripts/lib/$lib.sh"; done
      detect_os 2>/dev/null; answers_load "$ANSWERS_FILE"; LOG_FILE=/dev/null
      '"$1" ) >"$RB/out.txt" 2>&1
}
printf 'ROBOT_BACKEND=lite\n' >"$RB/answers"

printf 'LEFI_ROLES=ai,core\n' >"$RB/home/lefi.env"
rbrun 'role_robot_install'; rc=$?
expect_eq "robot: refused on the AI node's PC, with its code" \
  "$rc $(grep -c 'This PC runs the AI node' "$RB/out.txt") $([ -f "$RB/home/.lefi-crop/robot-sim/robot.conf" ] && echo conf)" "1 1 "

printf 'LEFI_ROLES=core,admin\n' >"$RB/home/lefi.env"
rbrun 'role_robot_install'; rc=$?
expect_eq "robot lite: installed, off, recorded how to start" \
  "$rc $(grep -c '^BACKEND=lite$' "$RB/home/.lefi-crop/robot-sim/robot.conf") $(grep -c '^ARG=--backend$' "$RB/home/.lefi-crop/robot-sim/robot.conf") $(stat -c %a "$RB/home/.lefi-crop/robot-sim/robot.conf" 2>/dev/null || stat -f %Lp "$RB/home/.lefi-crop/robot-sim/robot.conf")" \
  "0 1 1 600"
rbrun 'robot_status_json'
expect_eq "robot status: installed and off" \
  "$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["installed"], d["running"], d["backend"], d["port"], d["ai_here"])' "$RB/out.txt")" \
  "True False lite 8765 False"

rbrun 'role_ai_install'; rc=$?
expect_eq "AI node: refused where the robot is installed" "$rc $(grep -c 'AI_ON_ROBOT_PC\|simulated robot is installed on this PC' "$RB/out.txt")" "1 1"

# Start and stop by PID: the recorded program is replaced by a FAKE bridge that sleeps.
printf '#!/bin/sh\nexec sleep 60\n' >"$RB/bin/fake-bridge"; chmod +x "$RB/bin/fake-bridge"
sed -i.bak '/^ARG=/d' "$RB/home/.lefi-crop/robot-sim/robot.conf" && echo "ARG=$RB/bin/fake-bridge" >>"$RB/home/.lefi-crop/robot-sim/robot.conf"
rbrun 'robot_start; sleep 1; robot_status_json'
expect_eq "robot start: running (not answering yet)" \
  "$(tail -n1 "$RB/out.txt" | python3 -I -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["running"], d["answering"])')" "True False"
rbrun 'robot_stop; robot_status_json'
expect_eq "robot stop: off, pidfile gone" \
  "$(tail -n1 "$RB/out.txt" | python3 -I -c 'import json,sys; print(json.loads(sys.stdin.read())["running"])') $([ -f "$RB/home/.lefi-crop/run/robot-sim.pid" ] && echo pid)" "False "

# A bridge that dies at once is reported by `robot start` itself, with the log's last lines (ADR-104).
printf '#!/bin/sh\necho "ModuleNotFoundError: fake-missing"\nexit 3\n' >"$RB/bin/dying-bridge"; chmod +x "$RB/bin/dying-bridge"
sed -i.bak '/^ARG=/d' "$RB/home/.lefi-crop/robot-sim/robot.conf" && echo "ARG=$RB/bin/dying-bridge" >>"$RB/home/.lefi-crop/robot-sim/robot.conf"
rbrun 'ROBOT_START_WAIT=2 robot_start'; rc=$?
expect_eq "robot start: a bridge that dies at once fails, with its last log lines" \
  "$rc $(grep -c 'stopped right after starting' "$RB/out.txt") $(grep -c 'fake-missing' "$RB/out.txt")" "1 1 1"
rbrun 'robot_status_json'
expect_eq "robot status: a ready lite robot has no problem" \
  "$(tail -n1 "$RB/out.txt" | python3 -I -c 'import json,sys; print(json.loads(sys.stdin.read())["problem"])')" "None"

# The LaunchAgent's PATH holds uv's folder: launchd gives an agent only /usr/bin:/bin:/usr/sbin:/sbin
# and the starter's run.sh looks uv up by name ("uv was not found", main MacBook, ADR-104).
mkdir -p "$RB/uvdir"; printf '#!/bin/sh\n' >"$RB/uvdir/uv"; chmod +x "$RB/uvdir/uv"
echo "UV=$RB/uvdir/uv" >>"$RB/home/.lefi-crop/robot-sim/robot.conf"
rbrun 'robot_write_plist'
expect_eq "robot plist: PATH starts with uv's folder and keeps the system's" \
  "$(sed -n 's|.*<key>PATH</key><string>\([^<]*\)</string>.*|\1|p' "$RB/home/Library/LaunchAgents/com.lefi-crop.robot-sim.plist" | tr ':' '\n' | sed -n '1p;$p' | tr '\n' ' ')" \
  "$RB/uvdir /sbin "

# Genesis whose starter is gone (it used to live inside Lefi Crop Helper.app): refused, explained.
cp "$RB/home/.lefi-crop/robot-sim/robot.conf" "$RB/conf.lite"
{ echo "BACKEND=genesis"; echo "STARTER=$RB/home/.lefi-crop/robot-sim/starter/GDG-Hackathon"; echo "ARG=$ROOT/simulators/robot-mh3/run.sh"; } >"$RB/home/.lefi-crop/robot-sim/robot.conf"
rbrun 'robot_status_json'
expect_eq "robot status: genesis without its starter says starter_missing" \
  "$(tail -n1 "$RB/out.txt" | python3 -I -c 'import json,sys; print(json.loads(sys.stdin.read())["problem"])')" "starter_missing"
rbrun 'robot_start'; rc=$?
expect_eq "robot start: refused without the starter, pointing to Reinstall" \
  "$rc $(grep -c 'Reinstall' "$RB/out.txt") $([ -f "$RB/home/.lefi-crop/run/robot-sim.pid" ] && echo pid)" "4 1 "
cp "$RB/conf.lite" "$RB/home/.lefi-crop/robot-sim/robot.conf"

# --remove-role robot through the installer itself.
printf 'LEFI_ROLES=core,admin,robot\n' >"$RB/home/lefi.env"
( RBTEST="$RB" HOME="$RB/home" PATH="$RB/bin:/usr/bin:/bin" LEFI_STATE_DIR="$RB/home/.lefi-crop" \
    ENV_FILE="$RB/home/lefi.env" LEFI_SERVICE_MODE=user \
    "$ROOT/scripts/install.sh" --remove-role robot --service-mode user --events ndjson >"$RB/ev.ndjson" 2>"$RB/err.txt" ); rc=$?
expect_eq "remove robot: its settings gone and the role no longer recorded" \
  "$rc $([ -f "$RB/home/.lefi-crop/robot-sim/robot.conf" ] && echo conf) $(grep '^LEFI_ROLES=' "$RB/home/lefi.env") $(grep -c '"event":"plan.done".*"result":"ok"' "$RB/ev.ndjson")" \
  "0  LEFI_ROLES=core,admin 1"
