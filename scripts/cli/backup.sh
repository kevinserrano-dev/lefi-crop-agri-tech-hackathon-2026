# shellcheck shell=bash
# lefi backup … — backups of the main PC on an external disk, restore by parts (ADR-098).
#
# One backup = one folder on the chosen disk:
#   <volume>/Lefi Crop Backups/<installation>/<YYYYMMDD-HHMMSS>/
#     manifest.json        what is inside, versions, SHA-256 and size of every part
#     <part>.tar.gz        one archive per part (BACKUP_PARTS)
# Written as a hidden ".<id>.partial" folder and renamed only when complete: a half-written
# backup is never listed. Lefi Crop Helper's service runs `lefi backup run --scheduled` every
# 10 minutes; this file decides whether a backup is due. No cloud: everything stays on the LAN.

BACKUP_PARTS="database files settings security helper desktop"
BACKUP_DIR="$LEFI_STATE_DIR/backup"
BACKUP_CONF="$BACKUP_DIR/backup.conf"
BACKUP_LAST="$BACKUP_DIR/last.json"
BACKUP_LAST_RESTORE="$BACKUP_DIR/last-restore.json"
BACKUP_LOCK="$BACKUP_DIR/lock"
BACKUP_FOLDER="Lefi Crop Backups"
BACKUP_FORMAT=1
BACKUP_INTERVALS="6 12 24"

bk_volumes_dir() { echo "${LEFI_BACKUP_VOLUMES_DIR:-/Volumes}"; }
bk_helper_data() { echo "${LEFI_HELPER_DATA:-$HOME/Library/Application Support/ai.leficrop.helper}"; }
bk_desktop_data() { echo "${LEFI_DESKTOP_DATA:-$HOME/Library/Application Support/ai.leficrop.desktop}"; }

bk_part_title() {
  case "$1" in
    database) echo "Lefi Brain database" ;;
    files) echo "Photos and evidence" ;;
    settings) echo "Settings" ;;
    security) echo "Certificates and passwords" ;;
    helper) echo "Lefi Crop Helper" ;;
    desktop) echo "Lefi Desktop on this PC" ;;
  esac
}

# ---------------------------------------------------------------- small helpers
bk_q() { _evq "$1"; }   # JSON string (common.sh)
# Python for reading JSON: Lefi Brain's own when installed (macOS's python3 may be only a stub).
bk_py() { if [ -x "${BRAIN_PY:-}" ]; then echo "$BRAIN_PY"; else echo python3; fi; }
bk_sha256() { if have shasum; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi; }
bk_bytes() { wc -c <"$1" | tr -d ' '; }
bk_now_epoch() { date +%s; }
bk_iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
bk_valid_id() { case "$1" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]|[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9]) return 0 ;; *) return 1 ;; esac; }

bk_conf_get() { [ -f "$BACKUP_CONF" ] && grep -E "^$1=" "$BACKUP_CONF" | tail -n1 | cut -d= -f2-; }
bk_conf_set() {  # bk_conf_set KEY VALUE (values are plain: no newline)
  local tmp
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR" 2>/dev/null
  [ -f "$BACKUP_CONF" ] || { : >"$BACKUP_CONF"; chmod 600 "$BACKUP_CONF"; }
  tmp="$BACKUP_CONF.tmp"
  grep -vE "^$1=" "$BACKUP_CONF" >"$tmp" 2>/dev/null
  printf '%s=%s\n' "$1" "$2" >>"$tmp"
  mv "$tmp" "$BACKUP_CONF"; chmod 600 "$BACKUP_CONF"
}
bk_interval() { local h; h="$(bk_conf_get INTERVAL_HOURS)"; case " $BACKUP_INTERVALS " in *" $h "*) echo "$h" ;; *) echo 12 ;; esac; }
bk_keep() { local k; k="$(bk_conf_get KEEP)"; case "$k" in ''|*[!0-9]*) echo 14 ;; *) [ "$k" -ge 2 ] && echo "$k" || echo 2 ;; esac; }

# bk_plist_get FILE KEY — one value of a plist (plutil on macOS, else Python's plistlib).
bk_plist_get() {
  if have plutil; then plutil -extract "$2" raw -o - "$1" 2>/dev/null; return; fi
  "$(bk_py)" -I -c 'import plistlib,sys
d=plistlib.load(open(sys.argv[1],"rb")); v=d.get(sys.argv[2])
if v is None: sys.exit(1)
print(str(v).lower() if isinstance(v,bool) else v)' "$1" "$2" 2>/dev/null
}

# ---------------------------------------------------------------- disks (macOS)
# bk_disk_fields MOUNT FILE — reads `diskutil info -plist MOUNT` into BK_* variables. Returns 1 for a
# volume that is not a disk at all (a network share has no answer).
bk_disk_fields() {
  diskutil info -plist "$1" >"$2" 2>/dev/null || return 1
  BK_UUID="$(bk_plist_get "$2" VolumeUUID)"
  BK_NAME="$(bk_plist_get "$2" VolumeName)"; [ -n "$BK_NAME" ] || BK_NAME="$(basename "$1")"
  BK_INTERNAL="$(bk_plist_get "$2" Internal)"
  BK_BUS="$(bk_plist_get "$2" BusProtocol)"
  BK_FS="$(bk_plist_get "$2" FilesystemUserVisibleName)"; [ -n "$BK_FS" ] || BK_FS="$(bk_plist_get "$2" FilesystemName)"
  BK_TOTAL="$(bk_plist_get "$2" TotalSize)"; [ -n "$BK_TOTAL" ] || BK_TOTAL="$(bk_plist_get "$2" Size)"
  BK_FREE="$(bk_plist_get "$2" APFSContainerFree)"; [ -n "$BK_FREE" ] || BK_FREE="$(bk_plist_get "$2" FreeSpace)"
  BK_WRITABLE="$(bk_plist_get "$2" WritableVolume)"; [ -n "$BK_WRITABLE" ] || BK_WRITABLE="$(bk_plist_get "$2" Writable)"
  BK_ENCRYPTED=false
  [ "$(bk_plist_get "$2" Encryption)" = true ] && BK_ENCRYPTED=true
  [ "$(bk_plist_get "$2" FileVault)" = true ] && BK_ENCRYPTED=true
  return 0
}

# bk_disk_why MOUNT — empty when the volume can hold backups, else the reason. Only external disks:
# internal disks, disk images (a mounted .dmg such as Lefi Crop Helper's) and network shares never.
bk_disk_why() {
  [ "$BK_INTERNAL" = false ] || { echo internal; return; }
  case "$BK_BUS" in "Disk Image"|"") echo disk_image; return ;; esac
  [ -n "$BK_UUID" ] || { echo no_uuid; return; }
  [ "$BK_WRITABLE" = true ] || { echo read_only; return; }
  [ -w "$1" ] || { echo read_only; return; }
  echo ""
}

# One JSON object per external volume (internal disks and disk images are never listed).
bk_disks_json() {
  local vd mp tmp why first=1
  vd="$(bk_volumes_dir)"; tmp="$(mktemp)"
  printf '['
  for mp in "$vd"/*; do
    [ -d "$mp" ] && [ ! -L "$mp" ] || continue   # "Macintosh HD" is a link to /
    bk_disk_fields "$mp" "$tmp" || continue
    why="$(bk_disk_why "$mp")"
    case "$why" in internal|disk_image) continue ;; esac
    [ "$first" = 1 ] || printf ','; first=0
    printf '{"uuid":%s,"name":%s,"mount":%s,"filesystem":%s,"bus":%s,"total_bytes":%s,"free_bytes":%s,"encrypted":%s,"usable":%s,"why_not":%s}' \
      "$(bk_q "$BK_UUID")" "$(bk_q "$BK_NAME")" "$(bk_q "$mp")" "$(bk_q "$BK_FS")" "$(bk_q "$BK_BUS")" \
      "${BK_TOTAL:-null}" "${BK_FREE:-null}" "$BK_ENCRYPTED" "$([ -z "$why" ] && echo true || echo false)" \
      "$([ -n "$why" ] && bk_q "$why" || echo null)"
  done
  printf ']\n'
  rm -f "$tmp"
}

# bk_find_mount UUID — the mount point of that volume now (its name or mount may have changed).
bk_find_mount() {
  local vd mp tmp
  [ -n "$1" ] || return 1
  vd="$(bk_volumes_dir)"; tmp="$(mktemp)"
  for mp in "$vd"/*; do
    [ -d "$mp" ] && [ ! -L "$mp" ] || continue
    bk_disk_fields "$mp" "$tmp" || continue
    if [ "$BK_UUID" = "$1" ] && [ -z "$(bk_disk_why "$mp")" ]; then rm -f "$tmp"; echo "$mp"; return 0; fi
  done
  rm -f "$tmp"; return 1
}

bk_root_on() { echo "$1/$BACKUP_FOLDER/$(bk_conf_get INSTALLATION)"; }

# ---------------------------------------------------------------- parts
# Every part says where its files come from (base) and which items (paths relative to base) it holds.
# Nothing else is ever backed up or replaced: AI models, programs, logs and the installer's journal
# are reinstalled or rebuilt, not restored.
bk_db_file() { db_path; }
bk_part_base() {
  case "$1" in
    database) dirname "$(bk_db_file)" ;;
    files|settings|security) echo "$LEFI_STATE_DIR" ;;
    helper) bk_helper_data ;;
    desktop) bk_desktop_data ;;
  esac
}
bk_part_items() {  # existing items of a part on this PC, one per line
  local base i
  base="$(bk_part_base "$1")"
  case "$1" in
    database) [ -f "$(bk_db_file)" ] && basename "$(bk_db_file)" ;;
    files) for i in camera-photos task-photos robot-photos; do [ -d "$base/$i" ] && echo "$i"; done ;;
    settings)
      [ -f "$ENV_FILE" ] && echo lefi.env
      for i in install/components.tsv flags services helper/link.json robot-sim/robot.conf robot-sim/token; do
        [ -e "$base/$i" ] && echo "$i"
      done ;;
    security)
      for i in ca mosquitto/mosquitto.conf mosquitto/acl mosquitto/passwd caddy/Caddyfile caddy/data; do
        [ -e "$base/$i" ] && echo "$i"
      done ;;
    helper|desktop)
      [ -d "$base" ] || return 0
      # The package sent to other PCs is rebuilt from the app; logs are not history.
      for i in "$base"/* "$base"/.[!.]*; do
        [ -e "$i" ] || continue
        case "$(basename "$i")" in logs|Logs|.DS_Store|EBWebView|WebKit|Cache|Caches) continue ;; esac
        basename "$i"
      done ;;
  esac
  return 0
}

# bk_sqlite_copy SRC DEST — consistent online copy (SQLite backup API, safe while Lefi Brain writes).
bk_sqlite_copy() {
  local py=""
  if [ -x "${BRAIN_PY:-}" ]; then py="$BRAIN_PY"; elif have python3; then py=python3; fi
  if [ -n "$py" ]; then
    "$py" -I -c 'import sqlite3,sys
s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d)
ok=d.execute("PRAGMA quick_check").fetchone()[0]; d.close(); s.close(); sys.exit(0 if ok=="ok" else 3)' "$1" "$2"
    return
  fi
  have sqlite3 || return 2
  sqlite3 "$1" ".backup '$2'" && [ "$(sqlite3 -readonly "$2" 'PRAGMA quick_check;')" = ok ]
}
bk_db_revision() {  # Alembic revision inside a database file (empty if none)
  local py=""
  if [ -x "${BRAIN_PY:-}" ]; then py="$BRAIN_PY"; elif have python3; then py=python3; fi
  [ -n "$py" ] || return 0
  "$py" -I -c 'import sqlite3,sys
try: print(sqlite3.connect(sys.argv[1]).execute("SELECT version_num FROM alembic_version").fetchone()[0])
except Exception: pass' "$1" 2>/dev/null
}

# bk_make_part PART WORKDIR — writes WORKDIR/PART.tar.gz; prints one JSON object for the manifest.
bk_make_part() {
  local part="$1" work="$2" base items stage arc rev="" list="" i
  base="$(bk_part_base "$part")"
  items="$(bk_part_items "$part")"
  if [ -z "$items" ]; then
    printf '{"id":%s,"title":%s,"status":"not_here"}' "$(bk_q "$part")" "$(bk_q "$(bk_part_title "$part")")"
    return 0
  fi
  arc="$work/$part.tar.gz"
  stage="$work/.stage-$part"; rm -rf "$stage"; mkdir -p "$stage"
  case "$part" in
    database)
      bk_sqlite_copy "$(bk_db_file)" "$stage/$items" || { rm -rf "$stage"; return 1; }
      rev="$(bk_db_revision "$stage/$items")"
      tar -czf "$arc" -C "$stage" "$items" || { rm -rf "$stage"; return 1; } ;;
    settings)
      # lefi.env may live outside the state folder (a development checkout's .env).
      while IFS= read -r i; do
        [ -n "$i" ] || continue
        if [ "$i" = lefi.env ]; then cp -p "$ENV_FILE" "$stage/lefi.env"
        else mkdir -p "$stage/$(dirname "$i")"; cp -Rp "$base/$i" "$stage/$i"; fi || { rm -rf "$stage"; return 1; }
      done <<EOF
$items
EOF
      ( cd "$stage" && printf '%s\n' "$items" | tr '\n' '\0' | xargs -0 tar -czf "$arc" ) || { rm -rf "$stage"; return 1; } ;;
    *)
      # The package Lefi Crop Helper sends to other PCs is rebuilt when its service starts.
      ( cd "$base" && printf '%s\n' "$items" | tr '\n' '\0' | xargs -0 tar --exclude 'fleet/payload.tgz' -czf "$arc" ) \
        || { rm -rf "$stage"; return 1; } ;;
  esac
  rm -rf "$stage"
  chmod 600 "$arc" 2>/dev/null
  while IFS= read -r i; do [ -n "$i" ] && list="$list$(bk_q "$i"),"; done <<EOF
$items
EOF
  printf '{"id":%s,"title":%s,"status":"saved","file":%s,"bytes":%s,"sha256":%s,"items":[%s]%s}' \
    "$(bk_q "$part")" "$(bk_q "$(bk_part_title "$part")")" "$(bk_q "$part.tar.gz")" "$(bk_bytes "$arc")" \
    "$(bk_q "$(bk_sha256 "$arc")")" "${list%,}" "${rev:+,\"db_revision\":$(bk_q "$rev")}"
}

# Size the parts will take (KB, before compression): the disk must hold them.
bk_need_kb() {
  local part base i total=0 kb
  for part in $1; do
    base="$(bk_part_base "$part")"
    while IFS= read -r i; do
      [ -n "$i" ] || continue
      if [ "$part" = settings ] && [ "$i" = lefi.env ]; then kb="$(du -sk "$ENV_FILE" 2>/dev/null | awk '{print $1}')"
      else kb="$(du -sk "$base/$i" 2>/dev/null | awk '{print $1}')"; fi
      total=$((total + ${kb:-0}))
    done <<EOF
$(bk_part_items "$part")
EOF
  done
  echo "$total"
}
bk_free_kb() { df -Pk "$1" 2>/dev/null | awk 'NR==2{print $4}'; }

# bk_write_backup DESTDIR PARTS KIND — every part into DESTDIR (created; must not exist) + manifest.
bk_write_backup() {
  local dest="$1" parts="$2" kind="$3" part obj objs="" created
  mkdir -p "$dest" || return 1
  chmod 700 "$dest" 2>/dev/null
  created="$(bk_now_epoch)"
  for part in $parts; do
    BK_STEP="$part"
    obj="$(bk_make_part "$part" "$dest")" || return 1
    objs="$objs$obj,"
  done
  BK_STEP=manifest
  {
    printf '{"format":%s,"kind":%s,"created_at":%s,"created_epoch":%s,"installation":%s,' \
      "$BACKUP_FORMAT" "$(bk_q "$kind")" "$(bk_q "$(bk_iso "$created")")" "$created" "$(bk_q "$(bk_conf_get INSTALLATION)")"
    printf '"hostname":%s,"release":%s,"brain_version":%s,"helper_version":%s,"parts":[%s]}\n' \
      "$(bk_q "$(hostname -s 2>/dev/null)")" "$(bk_q "$LEFI_VERSION")" "$(bk_q "$(bk_brain_version)")" \
      "$(bk_q "${LEFI_HELPER_VERSION:-}")" "${objs%,}"
  } >"$dest/manifest.json" || return 1
  chmod 600 "$dest/manifest.json" 2>/dev/null
  return 0
}
bk_brain_version() {
  sed -n 's/^version *= *"\(.*\)"/\1/p' "$LEFI_ROOT/services/brain/pyproject.toml" 2>/dev/null | head -n1
}

# ---------------------------------------------------------------- lock (one backup or restore at a time)
bk_lock() {
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR" 2>/dev/null
  if ! mkdir "$BACKUP_LOCK" 2>/dev/null; then
    local pid; pid="$(cat "$BACKUP_LOCK/pid" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then return 1; fi
    rm -rf "$BACKUP_LOCK"; mkdir "$BACKUP_LOCK" 2>/dev/null || return 1   # left by a run that died
  fi
  echo "$$" >"$BACKUP_LOCK/pid"
  return 0
}
bk_unlock() { rm -rf "$BACKUP_LOCK"; }

# ---------------------------------------------------------------- status
bk_last_field() { [ -f "$BACKUP_LAST" ] && sed -n "s/.*\"$1\":\([^,}]*\).*/\1/p" "$BACKUP_LAST" | head -n1 | tr -d '"'; }

# Due when there is no successful backup within the interval, and the last attempt (successful or
# not) is not newer than 10 minutes — a missing disk is retried, not hammered.
bk_due() {
  local now ok_at try_at iv
  now="$(bk_now_epoch)"; iv=$(( $(bk_interval) * 3600 ))
  ok_at="$(bk_last_field last_ok_epoch)"; try_at="$(bk_last_field attempt_epoch)"
  [ -n "$try_at" ] && [ $((now - try_at)) -lt 540 ] && return 1
  [ -z "$ok_at" ] && return 0
  [ $((now - ok_at)) -ge "$iv" ]
}

bk_record() {  # bk_record RESULT CODE MESSAGE [ID] [BYTES]
  local now ok_at ok_id ok_bytes
  now="$(bk_now_epoch)"
  ok_at="$(bk_last_field last_ok_epoch)"; ok_id="$(bk_last_field last_ok_id)"; ok_bytes="$(bk_last_field last_ok_bytes)"
  if [ "$1" = ok ]; then ok_at="$now"; ok_id="$4"; ok_bytes="$5"; fi
  mkdir -p "$BACKUP_DIR"
  printf '{"result":%s,"code":%s,"message":%s,"attempt_epoch":%s,"attempt_at":%s,"last_ok_epoch":%s,"last_ok_at":%s,"last_ok_id":%s,"last_ok_bytes":%s}\n' \
    "$(bk_q "$1")" "$(bk_q "$2")" "$(bk_q "$3")" "$now" "$(bk_q "$(bk_iso "$now")")" \
    "${ok_at:-null}" "$([ -n "$ok_at" ] && bk_q "$(bk_iso "$ok_at")" || echo null)" \
    "$([ -n "$ok_id" ] && bk_q "$ok_id" || echo null)" "${ok_bytes:-null}" >"$BACKUP_LAST.tmp" \
    && mv "$BACKUP_LAST.tmp" "$BACKUP_LAST"
}

bk_status_json() {
  local uuid mount="" next=null ok_at enabled
  uuid="$(bk_conf_get DISK_UUID)"; enabled="$(bk_conf_get ENABLED)"
  [ -n "$uuid" ] && mount="$(bk_find_mount "$uuid")"
  ok_at="$(bk_last_field last_ok_epoch)"
  if [ -n "$uuid" ] && [ "$enabled" != 0 ]; then
    if [ -n "$ok_at" ]; then next="$(bk_q "$(bk_iso $((ok_at + $(bk_interval) * 3600)))")"; else next='"now"'; fi
  fi
  printf '{"configured":%s,"enabled":%s,"disk":{"uuid":%s,"name":%s,"connected":%s,"mount":%s},"interval_hours":%s,"keep":%s,"next_due":%s,"running":%s,"last":%s,"last_restore":%s,"parts":[%s],"cloud":{"available":false,"note":"coming soon"}}\n' \
    "$([ -n "$uuid" ] && echo true || echo false)" "$([ "$enabled" = 0 ] && echo false || echo true)" \
    "$([ -n "$uuid" ] && bk_q "$uuid" || echo null)" "$([ -n "$uuid" ] && bk_q "$(bk_conf_get DISK_NAME)" || echo null)" \
    "$([ -n "$mount" ] && echo true || echo false)" "$([ -n "$mount" ] && bk_q "$mount" || echo null)" \
    "$(bk_interval)" "$(bk_keep)" "$next" \
    "$([ -d "$BACKUP_LOCK" ] && kill -0 "$(cat "$BACKUP_LOCK/pid" 2>/dev/null)" 2>/dev/null && echo true || echo false)" \
    "$(cat "$BACKUP_LAST" 2>/dev/null || echo null)" "$(cat "$BACKUP_LAST_RESTORE" 2>/dev/null || echo null)" \
    "$(for p in $BACKUP_PARTS; do printf '{"id":%s,"title":%s},' "$(bk_q "$p")" "$(bk_q "$(bk_part_title "$p")")"; done | sed 's/,$//')"
}

# ---------------------------------------------------------------- run
# bk_fail CODE MESSAGE — records the failure, removes the half-written folder, exits 1.
bk_fail() {
  [ -n "${BK_WORK:-}" ] && rm -rf "$BK_WORK"
  bk_record failed "$1" "$2"
  bk_unlock
  if [ "$BK_JSON" = 1 ]; then printf '{"ok":false,"code":%s,"message":%s}\n' "$(bk_q "$1")" "$(bk_q "$2")"
  else err "$2"; fi
  exit 1
}

bk_run() {
  local scheduled=0 mount root id need free kept total=0 b
  BK_JSON=0; BK_WORK=""
  for a in "$@"; do case "$a" in --scheduled) scheduled=1 ;; --json) BK_JSON=1 ;; esac; done
  if [ -z "$(bk_conf_get DISK_UUID)" ]; then
    [ "$scheduled" = 1 ] && { [ "$BK_JSON" = 1 ] && echo '{"ok":true,"ran":false,"reason":"not_configured"}'; return 0; }
    bk_record failed NOT_CONFIGURED "No backup disk chosen yet."
    [ "$BK_JSON" = 1 ] && echo '{"ok":false,"code":"NOT_CONFIGURED","message":"No backup disk chosen yet."}' || err "No backup disk chosen yet: lefi backup disks, then lefi backup set-disk UUID"
    return 1
  fi
  if [ "$scheduled" = 1 ]; then
    if [ "$(bk_conf_get ENABLED)" = 0 ] || ! bk_due; then
      [ "$BK_JSON" = 1 ] && echo '{"ok":true,"ran":false,"reason":"not_due"}'
      return 0
    fi
  fi
  bk_lock || { [ "$BK_JSON" = 1 ] && echo '{"ok":false,"code":"BUSY","message":"A backup or restore is already running."}' || err "A backup or restore is already running."; return 1; }
  mount="$(bk_find_mount "$(bk_conf_get DISK_UUID)")" \
    || bk_fail DISK_NOT_CONNECTED "The backup disk $(bk_conf_get DISK_NAME) is not connected to this Mac."
  root="$(bk_root_on "$mount")"
  mkdir -p "$root" || bk_fail DISK_WRITE "Cannot write to $mount."
  need="$(bk_need_kb "$BACKUP_PARTS")"; free="$(bk_free_kb "$mount")"
  if [ -n "$free" ] && [ "$free" -lt $((need + 51200)) ]; then
    bk_fail DISK_FULL "The backup disk has $(human_kb "$free") free; this backup needs up to $(human_kb "$need")."
  fi
  id="$(date +%Y%m%d-%H%M%S)"; [ -e "$root/$id" ] && id="$id-2"
  BK_WORK="$root/.$id.partial"
  [ "$BK_JSON" = 1 ] || step "Backing up to $mount ($id)"
  bk_write_backup "$BK_WORK" "$BACKUP_PARTS" "$([ "$scheduled" = 1 ] && echo scheduled || echo manual)" \
    || bk_fail WRITE_FAILED "Could not write the part '${BK_STEP:-?}' to the backup disk."
  mv "$BK_WORK" "$root/$id" || bk_fail WRITE_FAILED "Could not finish the backup folder on the disk."
  BK_WORK=""
  for b in "$root/$id"/*.tar.gz; do [ -f "$b" ] && total=$((total + $(bk_bytes "$b"))); done
  kept="$(bk_prune "$root")"
  bk_record ok OK "Backup $id saved." "$id" "$total"
  bk_unlock
  if [ "$BK_JSON" = 1 ]; then printf '{"ok":true,"ran":true,"id":%s,"bytes":%s,"kept":%s,"path":%s}\n' "$(bk_q "$id")" "$total" "$kept" "$(bk_q "$root/$id")"
  else ok "Backup $id ($(human_bytes "$total")) · $kept kept on the disk"; fi
}

# Keeps the KEEP most recent complete backups; removes older ones and leftovers of runs that died.
bk_prune() {
  local root="$1" keep n=0 d
  keep="$(bk_keep)"
  for d in "$root"/.*.partial; do [ -d "$d" ] && rm -rf "$d"; done
  for d in $(bk_ids "$root" | sort -r); do
    n=$((n + 1)); [ "$n" -gt "$keep" ] && rm -rf "${root:?}/$d"
  done
  [ "$n" -gt "$keep" ] && n="$keep"
  echo "$n"
}
bk_ids() { local d; for d in "$1"/*; do [ -f "$d/manifest.json" ] && bk_valid_id "$(basename "$d")" && basename "$d"; done; return 0; }

bk_list_json() {
  local mount root first=1 d
  mount="$(bk_find_mount "$(bk_conf_get DISK_UUID)")" || { echo '{"connected":false,"backups":[]}'; return 0; }
  root="$(bk_root_on "$mount")"
  printf '{"connected":true,"path":%s,"backups":[' "$(bk_q "$root")"
  for d in $(bk_ids "$root" | sort -r); do
    [ "$first" = 1 ] || printf ','; first=0
    printf '{"id":%s,"manifest":%s}' "$(bk_q "$d")" "$(tr -d '\n' <"$root/$d/manifest.json")"
  done
  printf ']}\n'
}

# ---------------------------------------------------------------- verify
# bk_manifest_part DIR PART FIELD — a field of one part in a manifest (Python: the manifest is JSON).
bk_manifest_part() {
  "$(bk_py)" -I -c 'import json,sys
m=json.load(open(sys.argv[1]))
for p in m["parts"]:
    if p["id"]==sys.argv[2]:
        v=p.get(sys.argv[3]); print("\n".join(v) if isinstance(v,list) else ("" if v is None else v)); break' \
    "$1/manifest.json" "$2" "$3" 2>/dev/null
}
bk_verify_dir() {  # bk_verify_dir DIR PARTS -> prints the first problem, returns 1
  local dir="$1" part st want got
  [ -f "$dir/manifest.json" ] || { echo "manifest.json missing"; return 1; }
  for part in $2; do
    st="$(bk_manifest_part "$dir" "$part" status)"
    [ "$st" = saved ] || { echo "$part: not in this backup"; return 1; }
    [ -f "$dir/$part.tar.gz" ] || { echo "$part: file missing"; return 1; }
    want="$(bk_manifest_part "$dir" "$part" sha256)"; got="$(bk_sha256 "$dir/$part.tar.gz")"
    [ "$want" = "$got" ] || { echo "$part: damaged (checksum differs)"; return 1; }
    tar -tzf "$dir/$part.tar.gz" >/dev/null 2>&1 || { echo "$part: archive cannot be read"; return 1; }
  done
  return 0
}
bk_saved_parts() { local p out=""; for p in $BACKUP_PARTS; do [ "$(bk_manifest_part "$1" "$p" status)" = saved ] && out="$out $p"; done; echo "${out# }"; }

bk_locate() {  # bk_locate ID -> backup folder on the chosen disk
  local mount
  bk_valid_id "$1" || return 2
  mount="$(bk_find_mount "$(bk_conf_get DISK_UUID)")" || return 1
  [ -f "$(bk_root_on "$mount")/$1/manifest.json" ] || return 3
  echo "$(bk_root_on "$mount")/$1"
}

bk_verify() {
  local id="$1" json=0 dir problem
  has_flag --json "$@" && json=1
  dir="$(bk_locate "$id")" || { bk_say_err "$json" NOT_FOUND "Backup '$id' is not on the connected backup disk."; return 1; }
  if problem="$(bk_verify_dir "$dir" "$(bk_saved_parts "$dir")")"; then
    [ "$json" = 1 ] && printf '{"ok":true,"id":%s}\n' "$(bk_q "$id")" || ok "Backup $id: every part is intact"
  else
    bk_say_err "$json" DAMAGED "Backup $id: $problem"; return 1
  fi
}
bk_say_err() { if [ "$1" = 1 ]; then printf '{"ok":false,"code":%s,"message":%s}\n' "$(bk_q "$2")" "$(bk_q "$3")"; else err "$3"; fi; }

# ---------------------------------------------------------------- restore
# What must be stopped while a part is replaced, and started again after.
bk_services_for() {
  local parts=" $1 " out=""
  case "$parts" in *" database "*|*" files "*|*" settings "*|*" security "*) out="brain" ;; esac
  case "$parts" in *" security "*|*" settings "*) out="$out mqtt admin" ;; esac
  echo "$out"
}

bk_desktop_running() {  # Lefi Desktop's own executable, never a text match on command lines
  ps -axo comm= 2>/dev/null | grep -q '/Lefi Crop.app/Contents/MacOS/'
}
bk_helperd_main_running() {
  [ "${LEFI_BACKUP_HELPER_STOPPED:-0}" = 1 ] && return 1
  is_macos || return 1
  launchctl print "system/com.lefi-crop.helperd-main" 2>/dev/null | grep -q 'state = running' && return 0
  launchctl print "gui/$(id -u)/com.lefi-crop.helperd-main" 2>/dev/null | grep -q 'state = running'
}

# bk_put_part DIR PART — replaces this PC's items of PART with the ones in DIR/PART.tar.gz.
bk_put_part() {
  local dir="$1" part="$2" base tmp i dest
  base="$(bk_part_base "$part")"
  tmp="$BACKUP_DIR/.restore-$part"; rm -rf "$tmp"; mkdir -p "$tmp"
  tar -xzf "$dir/$part.tar.gz" -C "$tmp" || { rm -rf "$tmp"; return 1; }
  mkdir -p "$base"
  while IFS= read -r i; do
    [ -n "$i" ] || continue
    case "$i" in /*|*..*) rm -rf "$tmp"; return 1 ;; esac   # never outside the part's folder
    [ -e "$tmp/$i" ] || continue
    if [ "$part" = settings ] && [ "$i" = lefi.env ]; then dest="$ENV_FILE"; else dest="$base/$i"; fi
    # Lefi Crop Helper's package for other PCs is not in the backup: keep the one here.
    if [ "$part" = helper ] && [ "$i" = fleet ] && [ -f "$dest/payload.tgz" ] && [ ! -e "$tmp/fleet/payload.tgz" ]; then
      mv "$dest/payload.tgz" "$tmp/fleet/payload.tgz"
    fi
    rm -rf "$dest"
    [ "$part" = database ] && rm -f "$dest-wal" "$dest-shm"
    mkdir -p "$(dirname "$dest")"
    mv "$tmp/$i" "$dest" || { rm -rf "$tmp"; return 1; }
  done <<EOF
$(bk_manifest_part "$dir" "$part" items)
EOF
  rm -rf "$tmp"
  return 0
}

bk_brain_healthy() {  # up to 90 s for Lefi Brain to answer after a restart (it migrates on start)
  local i=0 port tries="${LEFI_BACKUP_HEALTH_TRIES:-45}"; port="$(svc_port brain)"
  while [ "$i" -lt "$tries" ]; do
    curl -fsS -m 2 "http://127.0.0.1:$port/api/v1/health" 2>/dev/null | grep -q '"lefi-brain"' && return 0
    sleep 2; i=$((i + 1))
  done
  return 1
}

bk_restore() {
  local id="" parts="" all=0 yes=0 dir problem stamp safety svcs s failed="" rc=0
  BK_JSON=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --parts) shift; parts="$(echo "${1:-}" | tr ',' ' ')" ;;
      --all) all=1 ;;
      --yes) yes=1 ;;
      --json) BK_JSON=1 ;;
      -*) bk_say_err "$BK_JSON" USAGE "Unknown option $1"; return 2 ;;
      *) id="$1" ;;
    esac
    shift
  done
  dir="$(bk_locate "$id")" || { bk_say_err "$BK_JSON" NOT_FOUND "Backup '$id' is not on the connected backup disk."; return 1; }
  [ "$all" = 1 ] && parts="$(bk_saved_parts "$dir")"
  [ -n "$parts" ] || { bk_say_err "$BK_JSON" USAGE "Say what to restore: --parts database,settings,… or --all"; return 2; }
  for s in $parts; do
    case " $BACKUP_PARTS " in *" $s "*) ;; *) bk_say_err "$BK_JSON" USAGE "Unknown part '$s' (parts: $BACKUP_PARTS)"; return 2 ;; esac
  done
  problem="$(bk_verify_dir "$dir" "$parts")" || { bk_say_err "$BK_JSON" DAMAGED "Nothing was changed: $problem"; return 1; }
  case " $parts " in *" desktop "*) bk_desktop_running && { bk_say_err "$BK_JSON" DESKTOP_RUNNING "Close Lefi Desktop on this Mac first: its pairing is being restored."; return 1; } ;; esac
  case " $parts " in *" helper "*) bk_helperd_main_running && { bk_say_err "$BK_JSON" HELPER_RUNNING "Lefi Crop Helper's service is running: restore this part from Lefi Crop Helper, which stops it first."; return 1; } ;; esac
  if [ "$yes" != 1 ] && [ "$BK_JSON" != 1 ]; then
    confirm "Replace ${parts// /, } on this PC with backup $id?" n || { info "Nothing changed."; return 1; }
  fi
  bk_lock || { bk_say_err "$BK_JSON" BUSY "A backup or restore is already running."; return 1; }

  # 1. A copy of what is here now, on this PC's own disk: the way back if the restore fails.
  stamp="$(date +%Y%m%d-%H%M%S)"; safety="$LEFI_STATE_DIR/backups/pre-restore-$stamp"
  [ "$BK_JSON" = 1 ] || step "Keeping a copy of the current state in $safety"
  BK_STEP=""
  if ! bk_write_backup "$safety" "$parts" pre-restore; then
    rm -rf "$safety"; bk_unlock
    bk_say_err "$BK_JSON" SAFETY_COPY_FAILED "Nothing was changed: the copy of the current state failed (${BK_STEP:-?}). Free some space on this Mac."; return 1
  fi

  # 2. Stop what uses these files, replace them, start again.
  svcs="$(bk_services_for "$parts")"
  for s in $svcs; do svc_installed "$s" && { svc_stop "$s" >/dev/null 2>&1 || true; }; done
  for s in $parts; do bk_put_part "$dir" "$s" || { failed="$s"; break; }; done
  local started=""
  for s in $svcs; do svc_installed "$s" && svc_start "$s" >/dev/null 2>&1 && started="$started $s"; done

  # 3. Lefi Brain must come back (it migrates an older database on start); otherwise undo.
  case " $started " in *" brain "*) [ -z "$failed" ] && ! bk_brain_healthy && failed=brain_start ;; esac
  if [ -n "$failed" ]; then
    for s in $svcs; do svc_installed "$s" && { svc_stop "$s" >/dev/null 2>&1 || true; }; done
    for s in $(bk_saved_parts "$safety"); do bk_put_part "$safety" "$s" || true; done
    for s in $svcs; do svc_installed "$s" && { svc_start "$s" >/dev/null 2>&1 || true; }; done
    rc=1
  fi
  printf '{"result":%s,"id":%s,"parts":[%s],"at":%s,"safety_copy":%s,"failed":%s}\n' \
    "$([ "$rc" = 0 ] && echo '"ok"' || echo '"undone"')" "$(bk_q "$id")" \
    "$(for s in $parts; do printf '%s,' "$(bk_q "$s")"; done | sed 's/,$//')" \
    "$(bk_q "$(bk_iso "$(bk_now_epoch)")")" "$(bk_q "$safety")" "$([ -n "$failed" ] && bk_q "$failed" || echo null)" \
    >"$BACKUP_LAST_RESTORE"
  bk_unlock
  if [ "$rc" = 0 ]; then
    if [ "$BK_JSON" = 1 ]; then printf '{"ok":true,"id":%s,"safety_copy":%s}\n' "$(bk_q "$id")" "$(bk_q "$safety")"
    else ok "Restored $parts from $id · the previous state is kept in $safety"; fi
  else
    local why="could not put the part '$failed' back"
    [ "$failed" = brain_start ] && why="Lefi Brain did not start with the restored files"
    bk_say_err "$BK_JSON" RESTORE_UNDONE "The restore was undone: $why. This PC is as it was before; the copy is in $safety."
  fi
  return "$rc"
}

# ---------------------------------------------------------------- command
cmd_backup() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift
  case "$sub" in
    disks)
      is_macos || die "Choosing a backup disk is built for macOS only (Linux: not yet, ADR-098)."
      if has_flag --json "$@"; then bk_disks_json; return; fi
      header "External disks for backups"
      "$(bk_py)" -I -c 'import json,sys
for d in json.loads(sys.stdin.read()):
    gb=lambda b: "%.1f GB"%(b/1e9) if b else "?"
    print("  %s  %-20s %s free of %s · %s%s%s"%(d["uuid"],d["name"],gb(d["free_bytes"]),gb(d["total_bytes"]),d["filesystem"] or "?",
          "" if d["encrypted"] else " · not encrypted"," · cannot be used: "+d["why_not"] if not d["usable"] else ""))' <<EOF
$(bk_disks_json)
EOF
      ;;
    status)
      if has_flag --json "$@"; then bk_status_json; return; fi
      header "Backups"
      "$(bk_py)" -I -c 'import json,sys
s=json.loads(sys.stdin.read()); d=s["disk"]; l=s["last"] or {}
print("  Disk:      %s"%((d["name"] or "?")+(" (connected)" if d["connected"] else " (not connected)") if s["configured"] else "none chosen (lefi backup disks)"))
print("  Every:     %s h · keep %s · %s"%(s["interval_hours"],s["keep"],"on" if s["enabled"] else "OFF"))
print("  Last ok:   %s %s"%(l.get("last_ok_at") or "never", l.get("last_ok_id") or ""))
if l.get("result")=="failed": print("  Last try:  failed at %s: %s"%(l.get("attempt_at"),l.get("message")))
print("  Next:      %s"%(s["next_due"] or "-"))
print("  Cloud:     coming soon")' <<EOF
$(bk_status_json)
EOF
      ;;
    set-disk)
      local uuid="" inst="" sj=0
      while [ $# -gt 0 ]; do case "$1" in --installation) shift; inst="${1:-}" ;; --json) sj=1 ;; *) uuid="$1" ;; esac; shift; done
      is_macos || die "Choosing a backup disk is built for macOS only (ADR-098)."
      [ -n "$uuid" ] || die "Usage: lefi backup set-disk VOLUME_UUID [--installation ID]"
      case "$uuid" in *[!0-9A-Fa-f-]*) die "Not a volume UUID: $uuid" ;; esac
      local mp tmp; mp="$(bk_find_mount "$uuid")" || die "No usable external disk with UUID $uuid is connected."
      tmp="$(mktemp)"; bk_disk_fields "$mp" "$tmp"; rm -f "$tmp"   # BK_NAME in this shell
      [ -n "$inst" ] || inst="$(bk_conf_get INSTALLATION)"
      case "$inst" in ''|*[!0-9A-Za-z_-]*) inst="this-installation" ;; esac
      bk_conf_set DISK_UUID "$uuid"; bk_conf_set DISK_NAME "$(printf '%s' "$BK_NAME" | tr -d '\n=')"
      bk_conf_set INSTALLATION "$inst"; bk_conf_set ENABLED 1
      [ -n "$(bk_conf_get INTERVAL_HOURS)" ] || bk_conf_set INTERVAL_HOURS 12
      if [ "$sj" = 1 ]; then bk_status_json; else ok "Backups go to $BK_NAME ($mp), every $(bk_interval) h"; fi ;;
    schedule)
      local h="${1:-}"
      case "$h" in off) bk_conf_set ENABLED 0 ;; on) bk_conf_set ENABLED 1 ;;
        *) case " $BACKUP_INTERVALS " in *" $h "*) bk_conf_set INTERVAL_HOURS "$h"; bk_conf_set ENABLED 1 ;;
             *) die "Usage: lefi backup schedule 6|12|24|on|off" ;; esac ;;
      esac
      has_flag --json "$@" && bk_status_json || ok "Backups: every $(bk_interval) h, $([ "$(bk_conf_get ENABLED)" = 0 ] && echo off || echo on)" ;;
    run) require_role CORE "The core node (Lefi Brain's data)"; bk_run "$@" ;;
    list)
      if has_flag --json "$@"; then bk_list_json; return; fi
      header "Backups on the disk"
      "$(bk_py)" -I -c 'import json,sys
l=json.loads(sys.stdin.read())
if not l["connected"]: print("  The backup disk is not connected."); sys.exit()
for b in l["backups"]:
    m=b["manifest"]; saved=[p["id"] for p in m["parts"] if p["status"]=="saved"]
    print("  %s  %s  %6.1f MB  %s"%(b["id"],m["kind"],sum(p.get("bytes",0) for p in m["parts"])/1e6,",".join(saved)))' <<EOF
$(bk_list_json)
EOF
      ;;
    verify) bk_verify "$@" ;;
    restore) require_role CORE "The core node (Lefi Brain's data)"; bk_restore "$@" ;;
    *) die "Unknown: lefi backup $sub (status, disks, set-disk, schedule, run, list, verify, restore)" ;;
  esac
}
