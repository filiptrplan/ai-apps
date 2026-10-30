#!/bin/sh
# Database dumps into /dumps, run by deploy/compose.yaml in postgres:17-alpine
# (connection from the PG* variables):
#
#   dump.sh <name> <keep>               one dump, /dumps/<name>-<UTC time>.sql.gz,
#                                       keeping the newest <keep> of that name
#   dump.sh daily <HH:MM> <name> <keep> the same every day at HH:MM UTC
#
# Restore with: gunzip -c <file> | psql -U ai_apps -d <empty database>
set -eu -o pipefail

dump() {
  name=$1 keep=$2
  file="/dumps/$name-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  # Written under a dot name first, so a failed dump never counts as one.
  pg_dump --no-password | gzip > "/dumps/.partial.sql.gz"
  mv /dumps/.partial.sql.gz "$file"
  echo "dump: wrote $file ($(du -k "$file" | cut -f1) kB)"
  ls -1 /dumps/"$name"-*.sql.gz | sort -r | tail -n +"$((keep + 1))" | xargs -r rm -f --
}

if [ "$1" = daily ]; then
  at=$2
  shift 2
  while :; do
    now=$(date -u +%s)
    next=$(date -u -d "$(date -u +%Y-%m-%d) $at" +%s)
    [ "$next" -gt "$now" ] || next=$((next + 86400))
    sleep $((next - now))
    dump "$@" || echo "dump: failed" >&2
  done
fi

dump "$@"
