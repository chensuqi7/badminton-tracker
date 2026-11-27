#!/bin/sh
# Configure an isolated PostgreSQL service and password file outside the repo.
set -eu
umask 077
export PGSERVICEFILE="${PGSERVICEFILE:-$HOME/.config/badminton-diary/pg_service.conf}"
export PGPASSFILE="${PGPASSFILE:-$HOME/.config/badminton-diary/pgpass}"
destination="${DIARY_BACKUP_DIR:-$HOME/Library/Application Support/BadmintonDiary/Backups}"
test -r "$PGSERVICEFILE"
test -r "$PGPASSFILE"
mkdir -p "$destination"
tmp=$(mktemp "$destination/.diary.XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM
"${PG_DUMP_BIN:-pg_dump}" --dbname='service=badminton_diary sslmode=verify-full' \
  --no-owner --no-privileges --data-only --strict-names \
  --table=public.diary_profiles --table=public.diary_settings \
  --table=public.diary_records --table=public.diary_expenses --table=public.diary_history >"$tmp"
test -s "$tmp"
mv "$tmp" "$destination/diary-$(date -u +%Y%m%dT%H%M%SZ).sql"
