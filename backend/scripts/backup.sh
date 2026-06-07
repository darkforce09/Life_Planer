#!/usr/bin/env bash
#
# Backs up the two sources of truth for the Life Planner:
#   1. PostgreSQL (all relational + pgvector data) via pg_dump (custom format).
#   2. The on-disk knowledge base (~/Documents/Vector_KnowledgeBase) + state JSON.
#
# Usage:
#   DATABASE_URL=postgres://admin:password123@localhost:5432/life_planner \
#   BACKUP_DIR=/var/backups/life_planner ./scripts/backup.sh
#
# Schedule via cron, e.g. daily at 03:00:
#   0 3 * * * DATABASE_URL=... BACKUP_DIR=/var/backups/life_planner /app/scripts/backup.sh
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://admin:password123@localhost:5432/life_planner}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/life_planner_backups}"
KB_DIR="${KB_DIR:-$HOME/Documents/Vector_KnowledgeBase}"
STATE_DIR="${STATE_DIR:-$HOME/Documents}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DEST="${BACKUP_DIR}/${TIMESTAMP}"
mkdir -p "${DEST}"

echo "[backup] Dumping Postgres -> ${DEST}/postgres.dump"
pg_dump --format=custom --no-owner --dbname="${DATABASE_URL}" --file="${DEST}/postgres.dump"

if [ -d "${KB_DIR}" ]; then
  echo "[backup] Archiving knowledge base -> ${DEST}/knowledge_base.tar.gz"
  tar -czf "${DEST}/knowledge_base.tar.gz" -C "$(dirname "${KB_DIR}")" "$(basename "${KB_DIR}")"
else
  echo "[backup] Knowledge base dir ${KB_DIR} not found; skipping."
fi

# State JSON files used for delta-sync (best-effort).
for f in "${STATE_DIR}/Vector_KnowledgeBase_State.json" "${STATE_DIR}/RefinementState.json"; do
  [ -f "${f}" ] && cp "${f}" "${DEST}/" && echo "[backup] Copied $(basename "${f}")"
done

echo "[backup] Pruning backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -maxdepth 1 -type d -name '20*' -mtime "+${RETENTION_DAYS}" -exec rm -rf {} +

echo "[backup] Done: ${DEST}"
