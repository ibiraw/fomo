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
# Who sees which version, early access and free-until dates (small; kept next to the database copy).
[ -f "$HOME/limit/deploy/data/access.json" ] && cp "$HOME/limit/deploy/data/access.json" "$DIR/access-$(date -u +%Y%m%d-%H%M).json"
find "$DIR" \( -name 'orders-*.db.gz' -o -name 'access-*.json' \) -mtime +14 -delete
# Housekeeping: each server rebuild leaves Docker build cache behind (hundreds of MB); drop what's over 3 days old.
docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
