#!/bin/sh
# limit — daily database backup (Reborn1987)
# Uses SQLite's online backup, so it is consistent while the server keeps writing. Keeps the last 14 days.
# crontab (user deploy): 0 4 * * * ~/limit/deploy/backup.sh
set -eu
DIR="$HOME/backups"
mkdir -p "$DIR"
OUT="$DIR/orders-$(date -u +%Y%m%d-%H%M).db"
sqlite3 "$HOME/limit/deploy/data/orders.db" ".backup '$OUT'"
gzip -f "$OUT"
find "$DIR" -name 'orders-*.db.gz' -mtime +14 -delete
