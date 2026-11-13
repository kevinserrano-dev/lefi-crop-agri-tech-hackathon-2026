#!/bin/sh
# FAKE installer for helperd tests: prints the same NDJSON event shapes as scripts/install.sh
# (plan/step/rollback events), honours --cancel-file and --rollback. Changes nothing.
CANCEL=""; MODE=install; DRY=false; JOURNALS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cancel-file) shift; CANCEL="$1" ;; --rollback) MODE=rollback ;; --dry-run) DRY=true ;;
    --journal) shift; JOURNALS="$JOURNALS $(basename "$1")" ;;
    --remove-role) shift; MODE=remove; ROLE="$1" ;;
    --uninstall-everything) MODE=uninstall ;;
  esac
  shift
done
JOURNAL="${TMPDIR:-/tmp}/fake-run-$$.tsv"   # a fake journal path, one per run (never written)
ev() { printf '{"event":"%s","seq":0,"ts":"2026-01-01T00:00:00Z"%s}\n' "$1" "$2"; }
rollback() {
  ev rollback.started ',"reason":"'"$1"'","items_total":1,"journal":"/fake"'
  ev rollback.item ',"index":1,"items_total":1,"action":"file_created","label":"Undo runs:'"${JOURNALS:- latest}"'","result":"ok","message":""'
  ev rollback.done ',"result":"ok","ok":1,"failed":0,"skipped":0,"report":"/fake/report"'
}
if [ "$MODE" = rollback ]; then rollback requested; exit 0; fi
if [ "$MODE" = remove ]; then
  ev plan.started ',"mode":"remove","dry_run":false,"roles":"'"$ROLE"'","steps_total":1,"steps":[{"id":"r","title":"Remove"}]'
  ev step.started ',"step":"r","steps_done":0,"steps_total":1,"title":"Remove"'
  ev step.ok ',"step":"r","steps_done":1,"steps_total":1'
  ev plan.done ',"result":"ok","steps_done":1,"steps_total":1'
  exit 0
fi
if [ "$MODE" = uninstall ]; then
  ev plan.started ',"mode":"uninstall","dry_run":false,"roles":"","steps_total":1,"steps":[{"id":"u","title":"Uninstall"}]'
  ev step.started ',"step":"u","steps_done":0,"steps_total":1,"title":"Uninstall"'
  ev step.ok ',"step":"u","steps_done":1,"steps_total":1'
  ev plan.done ',"result":"ok","steps_done":1,"steps_total":1'
  exit 0
fi
if [ -n "${FAKE_FAIL_LOG:-}" ]; then
  printf 'first line\nBootstrap failed: 5: Input/output error\n' >"$FAKE_FAIL_LOG"
  ev plan.started ',"mode":"install","dry_run":false,"roles":"ai","steps_total":1,"steps":[{"id":"a","title":"Step A"}]'
  ev step.started ',"step":"a","steps_done":0,"steps_total":1,"title":"Step A"'
  ev step.failed ',"step":"a","steps_done":0,"steps_total":1,"code":"STEP_FAILED","message":"Could not start","hint":""'
  ev plan.done ',"result":"failed","steps_done":0,"steps_total":1,"log":"'"$FAKE_FAIL_LOG"'"'
  exit 1
fi
ev plan.started ',"mode":"install","dry_run":'"$DRY"',"roles":"ai","steps_total":3,"steps":[{"id":"a","title":"Step A"},{"id":"b","title":"Step B"},{"id":"c","title":"Step C"}],"journal":"'"$JOURNAL"'"'
done=0
for s in a b c; do
  if [ -n "$CANCEL" ] && [ -e "$CANCEL" ]; then
    rollback cancelled
    ev plan.done ',"result":"cancelled","steps_done":'"$done"',"steps_total":3'
    exit 130
  fi
  ev step.started ',"step":"'"$s"'","steps_done":'"$done"',"steps_total":3,"title":"Step '"$s"'"'
  echo "fake human output for step $s" >&2
  sleep "${FAKE_STEP_SECS:-1}"
  done=$((done + 1))
  ev step.ok ',"step":"'"$s"'","steps_done":'"$done"',"steps_total":3'
done
ev plan.done ',"result":"ok","steps_done":3,"steps_total":3'
