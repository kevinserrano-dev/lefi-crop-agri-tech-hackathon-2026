# shellcheck shell=bash
# Backups on an external disk and restore by parts (ADR-098). Sourced by run.sh (uses its helpers).
# macOS paths with a FAKE `diskutil` (fixture plists below, not a real disk), a FAKE `launchctl`
# that only records calls, a temporary HOME and fake "volumes" folders. Lefi Brain is never
# started: its port in this test is 1 (closed).

echo "== backups to an external disk (fake diskutil/launchctl, temporary HOME)"
BK="$TMP/backup"; mkdir -p "$BK/bin" "$BK/plists" "$BK/volumes" "$BK/home/.lefi-crop/data"
H="$BK/home"; S="$H/.lefi-crop"
cat >"$BK/bin/uname" <<'FAKE'
#!/bin/sh
case "$1" in -s) echo Darwin ;; -m) echo arm64 ;; -r) echo 25.0.0 ;; *) echo Darwin ;; esac
FAKE
cat >"$BK/bin/diskutil" <<'FAKE'
#!/bin/sh
[ "$1" = info ] && [ "$2" = -plist ] || exit 1
f="$BKTEST/plists/$(basename "$3").plist"; [ -f "$f" ] || exit 1
cat "$f"
FAKE
cat >"$BK/bin/launchctl" <<'FAKE'
#!/bin/sh
echo "launchctl $*" >>"$BKTEST/launchctl.calls"
case "$1" in print)
  case "$2" in *helperd-main) [ -f "$BKTEST/helperd-running" ] && { echo "	state = running"; exit 0; } ;; esac
  exit 113 ;; esac
exit 0
FAKE
chmod +x "$BK/bin/uname" "$BK/bin/diskutil" "$BK/bin/launchctl"

# fake_volume NAME UUID INTERNAL BUS WRITABLE ENCRYPTED — a folder and its FAKE diskutil answer.
fake_volume() {
  mkdir -p "$BK/volumes/$1"
  cat >"$BK/plists/$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>VolumeName</key><string>$1</string><key>VolumeUUID</key><string>$2</string>
<key>Internal</key><$3/><key>BusProtocol</key><string>$4</string>
<key>FilesystemUserVisibleName</key><string>APFS</string>
<key>TotalSize</key><integer>2000000000000</integer><key>FreeSpace</key><integer>1500000000000</integer>
<key>WritableVolume</key><$5/><key>Encryption</key><$6/>
</dict></plist>
PLIST
}
fake_volume HomeDisk 11111111-AAAA-4BBB-8CCC-000000000001 false USB true false
fake_volume Macintosh_Data 22222222-AAAA-4BBB-8CCC-000000000002 true PCI-Express true true
fake_volume LefiCropHelper 33333333-AAAA-4BBB-8CCC-000000000003 false "Disk Image" false false
fake_volume OldNTFS 44444444-AAAA-4BBB-8CCC-000000000004 false USB false false
ln -s / "$BK/volumes/Macintosh HD"

# What a main PC has (FAKE contents): Lefi Brain's database, photos, settings, CA, broker, gateway,
# Lefi Crop Helper's and Lefi Desktop's data.
mkdir -p "$S/camera-photos/z1" "$S/task-photos" "$S/ca" "$S/mosquitto/data" "$S/caddy/data/caddy" "$S/flags" "$S/services" \
  "$S/install" "$H/helper-data/fleet" "$H/helper-data/ca" "$H/helper-data/logs" "$H/desktop-data" "$H/Library/LaunchAgents"
printf 'LEFI_ROLES=core,admin\nLEFI_API_PORT=1\nLEFI_MQTT_PORT=1\nLEFI_ADMIN_URL=https://lefi-main.local:1\nFAKE=before\n' >"$S/lefi.env"
python3 -I -c 'import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute("create table alembic_version(version_num text)")
c.execute("insert into alembic_version values (\"0028_fake\")"); c.execute("create table t(v text)")
c.execute("insert into t values (\"first\")"); c.commit()' "$S/data/lefi.db"
echo photo1 >"$S/camera-photos/z1/a.jpg"; echo FAKE-CA-KEY >"$S/ca/issuing.key"; echo acl >"$S/mosquitto/acl"
echo retained >"$S/mosquitto/data/mosquitto.db"; echo Caddyfile >"$S/caddy/Caddyfile"; echo FAKE >"$S/caddy/data/caddy/x"
echo registry-before >"$H/helper-data/fleet/registry.json"; echo BIG >"$H/helper-data/fleet/payload.tgz"
echo log >"$H/helper-data/logs/a.log"; echo FAKE-ROOT >"$H/helper-data/ca/root-ca.pem"; echo '{"id":"d1"}' >"$H/desktop-data/pairing.json"

# bkrun ARGS... — the real CLI, as on a Mac, in the temporary HOME.
bkrun() {
  ( export BKTEST="$BK" HOME="$H" PATH="$BK/bin:/usr/bin:/bin:/usr/sbin:/sbin" OS=Darwin \
      LEFI_SERVICE_MODE=launchd LEFI_STATE_DIR="$S" ENV_FILE="$S/lefi.env" LEFI_BACKUP_VOLUMES_DIR="$BK/volumes" \
      LEFI_HELPER_DATA="$H/helper-data" LEFI_DESKTOP_DATA="$H/desktop-data" LEFI_BACKUP_HEALTH_TRIES=1 NO_COLOR=1
    unset LEFI_SESSION_DIR LEFI_CLI_USER
    "$ROOT/bin/lefi" "$@" ) >"$BK/out.txt" 2>"$BK/err.txt"
}
jq_out() { python3 -I -c 'import json,sys; d=json.loads(open(sys.argv[1]).read().strip().splitlines()[-1]); print(eval(sys.argv[2]))' "$BK/out.txt" "$1" 2>&1; }

bkrun backup disks --json
expect_eq "disks: only external, writable or not; never internal, disk images or the boot link" \
  "$(jq_out '[(x["name"], x["usable"], x["why_not"], x["encrypted"]) for x in d]')" \
  "[('HomeDisk', True, None, False), ('OldNTFS', False, 'read_only', False)]"

bkrun backup run --scheduled --json
expect_eq "scheduled run without a disk: nothing to do" "$(jq_out 'd["ran"], d["reason"]')" "(False, 'not_configured')"

bkrun backup set-disk 22222222-AAAA-4BBB-8CCC-000000000002; rc=$?
expect_eq "an internal disk cannot be chosen" "$rc $(grep -c 'No usable external disk' "$BK/err.txt")" "1 1"
bkrun backup set-disk 11111111-AAAA-4BBB-8CCC-000000000001 --installation inst-test --json
expect_eq "external disk chosen: every 12 h, connected" \
  "$(jq_out 'd["disk"]["name"], d["disk"]["connected"], d["interval_hours"], d["next_due"], d["cloud"]["available"]')" \
  "('HomeDisk', True, 12, 'now', False)"

bkrun backup run --scheduled --json; rc=$?
ID="$(jq_out 'd["id"]')"; ROOTDIR="$BK/volumes/HomeDisk/Lefi Crop Backups/inst-test"
expect_eq "scheduled run when due: a complete backup folder, no partial left" \
  "$rc $(jq_out 'd["ran"]') $([ -f "$ROOTDIR/$ID/manifest.json" ] && echo manifest) $(find "$ROOTDIR" -name '.*partial' | wc -l | tr -d ' ')" \
  "0 True manifest 0"
M="$ROOTDIR/$ID/manifest.json"
expect_eq "manifest: every part saved with its revision; excluded what is rebuilt" \
  "$(python3 -I -c 'import json,sys; m=json.load(open(sys.argv[1])); print([(p["id"],p["status"]) for p in m["parts"]], m["installation"], [p.get("db_revision") for p in m["parts"] if p["id"]=="database"])' "$M")" \
  "[('database', 'saved'), ('files', 'saved'), ('settings', 'saved'), ('security', 'saved'), ('helper', 'saved'), ('desktop', 'saved')] inst-test ['0028_fake']"
expect_eq "helper part: no logs, no package for other PCs; security: no broker data" \
  "$(tar -tzf "$ROOTDIR/$ID/helper.tar.gz" | grep -c -e payload.tgz -e logs) $(tar -tzf "$ROOTDIR/$ID/security.tar.gz" | grep -c mosquitto/data) $(tar -tzf "$ROOTDIR/$ID/settings.tar.gz" | grep -c '^lefi.env$')" \
  "0 0 1"

bkrun backup run --scheduled --json
expect_eq "scheduled run right after a backup: not due" "$(jq_out 'd["ran"], d["reason"]')" "(False, 'not_due')"

bkrun backup verify "$ID" --json
expect_eq "verify: intact" "$(jq_out 'd["ok"]')" "True"

# Changes after the backup, then restore only the database and the settings.
python3 -I -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("update t set v=\"second\""); c.commit()' "$S/data/lefi.db"
sed -i.bak 's/FAKE=before/FAKE=after/' "$S/lefi.env"; rm -f "$S/lefi.env.bak"
echo registry-after >"$H/helper-data/fleet/registry.json"; echo photo2 >"$S/camera-photos/z1/b.jpg"
bkrun backup restore "$ID" --parts database,settings --json; rc=$?
expect_eq "restore by parts: database and settings back, everything else untouched" \
  "$rc $(python3 -I -c 'import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("select v from t").fetchone()[0])' "$S/data/lefi.db") $(grep -c 'FAKE=before' "$S/lefi.env") $(cat "$H/helper-data/fleet/registry.json") $([ -f "$S/camera-photos/z1/b.jpg" ] && echo photo2-kept)" \
  "0 first 1 registry-after photo2-kept"
SAFE="$(jq_out 'd["safety_copy"]')"
expect_eq "restore kept a copy of the state it replaced" \
  "$(python3 -I -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m["kind"], [p["id"] for p in m["parts"]])' "$SAFE/manifest.json")" \
  "pre-restore ['database', 'settings']"
expect_eq "restore stopped Lefi Brain while replacing its files" "$(grep -c 'bootout gui/.*/com.lefi-crop.brain' "$BK/launchctl.calls")" "1"

: >"$BK/helperd-running"
bkrun backup restore "$ID" --parts helper --json; rc=$?
expect_eq "Lefi Crop Helper part refused while its service runs (the app stops it first)" \
  "$rc $(jq_out 'd["code"]') $(cat "$H/helper-data/fleet/registry.json")" "1 HELPER_RUNNING registry-after"
rm -f "$BK/helperd-running"
bkrun backup restore "$ID" --parts helper --json; rc=$?
expect_eq "…and restored once it is stopped; its logs and package stay" \
  "$rc $(cat "$H/helper-data/fleet/registry.json") $(ls "$H/helper-data/logs") $(cat "$H/helper-data/fleet/payload.tgz")" "0 registry-before a.log BIG"

# A damaged archive: nothing is changed.
cp "$ROOTDIR/$ID/files.tar.gz" "$BK/files.bak"; printf 'x' >>"$ROOTDIR/$ID/files.tar.gz"
bkrun backup restore "$ID" --all --json; rc=$?
expect_eq "damaged backup: refused before touching anything" "$rc $(jq_out 'd["code"]') $([ -f "$S/camera-photos/z1/b.jpg" ] && echo kept)" "1 DAMAGED kept"
cp "$BK/files.bak" "$ROOTDIR/$ID/files.tar.gz"

# Lefi Brain does not come back after the restore: everything is put back as it was.
python3 -I -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("update t set v=\"third\""); c.commit()' "$S/data/lefi.db"
printf 'LOG=%s\n' "$S/logs/brain.log" >"$S/services/brain.svc"; : >"$H/Library/LaunchAgents/com.lefi-crop.brain.plist"
bkrun backup restore "$ID" --parts database --json; rc=$?
expect_eq "Lefi Brain fails after restore: undone, the newer data is back" \
  "$rc $(jq_out 'd["code"]') $(python3 -I -c 'import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute("select v from t").fetchone()[0])' "$S/data/lefi.db")" \
  "1 RESTORE_UNDONE third"
rm -f "$H/Library/LaunchAgents/com.lefi-crop.brain.plist"

# Retention: only KEEP backups stay on the disk.
printf 'KEEP=2\n' >>"$S/backup/backup.conf"
bkrun backup run --json; sleep 1; bkrun backup run --json; sleep 1; bkrun backup run --json
expect_eq "retention keeps the 2 most recent" "$(jq_out 'd["kept"]') $(find "$ROOTDIR" -name manifest.json | wc -l | tr -d ' ')" "2 2"

# The disk unplugged: the failure is recorded and retried later, not every minute.
mv "$BK/plists/HomeDisk.plist" "$BK/plists/HomeDisk.unplugged"
python3 -I -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["last_ok_epoch"]=0; d["attempt_epoch"]=0; json.dump(d,open(p,"w"))' "$S/backup/last.json"
bkrun backup run --scheduled --json; rc=$?
expect_eq "disk not connected: failed with its code" "$rc $(jq_out 'd["code"]')" "1 DISK_NOT_CONNECTED"
bkrun backup run --scheduled --json
expect_eq "…and not tried again within 10 minutes" "$(jq_out 'd["ran"], d["reason"]')" "(False, 'not_due')"
mv "$BK/plists/HomeDisk.unplugged" "$BK/plists/HomeDisk.plist"
