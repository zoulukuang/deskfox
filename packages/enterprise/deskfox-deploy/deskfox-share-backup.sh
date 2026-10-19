#!/usr/bin/env bash
set -euo pipefail
umask 077

# Offline maintenance uses the same writer lock as the service. A failed backup must
# restore the service and must never prune the previous successful archives.
source /etc/deskfox-share.env
readonly root=/var/lib/deskfox-share
readonly backups="$root/backups"
[[ "$DESKFOX_SHARE_DIRECTORY" == "$root/data" ]] || { echo 'Unexpected share data directory' >&2; exit 1; }
[[ "$DESKFOX_SHARE_PUBLIC_ORIGIN" == https://deskfox.cn || "$DESKFOX_SHARE_PUBLIC_ORIGIN" == https://deskfox.ai ]] || exit 1
[[ ! -L "$backups" ]] || { echo 'Symlink backup root rejected' >&2; exit 1; }
install -d -m 0700 -o deskfox-share -g deskfox-share "$backups"
readonly archive="$backups/$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"

exec 9>"$root/backup.lock"
flock --exclusive --nonblock 9
active=false
complete=false
systemctl is-active --quiet deskfox-share.service && active=true
finish() {
  local result=$?
  trap - EXIT
  if [[ "$complete" == false && -d "$archive" && ! -L "$archive" ]]; then
    # The archive path is an absolute child generated above, never a caller-supplied path.
    [[ "$(dirname "$archive")" == "$backups" ]] || exit 1
    rm -rf -- "$archive" || result=1
  fi
  if [[ "$active" == true ]]; then
    systemctl start deskfox-share.service || result=1
    systemctl is-active --quiet deskfox-share.service || result=1
    curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 5 \
      http://127.0.0.1:4410/api/share/health >/dev/null || result=1
  fi
  exit "$result"
}
trap finish EXIT
if [[ "$active" == true ]]; then systemctl stop deskfox-share.service; fi

flock --exclusive --nonblock "$root/writer.lock" \
  runuser -u deskfox-share -- env \
  DESKFOX_SHARE_DIRECTORY="$DESKFOX_SHARE_DIRECTORY" \
  DESKFOX_SHARE_PUBLIC_ORIGIN="$DESKFOX_SHARE_PUBLIC_ORIGIN" \
  DESKFOX_SHARE_MAINTENANCE_LOCK=held \
  /opt/deskfox-share/node/bin/node /opt/deskfox-share/maintenance-current/maintenance.mjs backup "$archive"
complete=true

# Pruning only reads completed private backups; bring the public service back first.
if [[ "$active" == true ]]; then
  systemctl start deskfox-share.service
  systemctl is-active --quiet deskfox-share.service
  curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 5 \
    http://127.0.0.1:4410/api/share/health >/dev/null
  active=false
fi
runuser -u deskfox-share -- env \
  DESKFOX_SHARE_DIRECTORY="$DESKFOX_SHARE_DIRECTORY" \
  DESKFOX_SHARE_PUBLIC_ORIGIN="$DESKFOX_SHARE_PUBLIC_ORIGIN" \
  DESKFOX_SHARE_MAINTENANCE_LOCK=held \
  /opt/deskfox-share/node/bin/node /opt/deskfox-share/maintenance-current/maintenance.mjs prune-backups "$backups"
