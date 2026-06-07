#!/usr/bin/env bash
#
# Restores a Life Planner backup created by backup.sh.
#
# Usage:
#   DATABASE_URL=postgres://admin:password123@localhost:5432/life_planner \
#   ./scripts/restore.sh /var/backups/life_planner/20260607_030000
#
# WARNING: this DROPS and recreates objects in the target database.
set -euo pipefail

SRC="${1:-}"
if [ -z "${SRC}" ] || [ ! -d "${SRC}" ]; then
  echo "Usage: $0 <backup-dir>" >&2
  exit 1
fi

DATABASE_URL="${DATABASE_URL:-postgres://admin:password123@localhost:5432/life_planner}"
KB_PARENT="${KB_PARENT:-$HOME/Documents}"
STATE_DIR="${STATE_DIR:-$HOME/Documents}"

echo "[restore] Restoring Postgres from ${SRC}/postgres.dump"
# --clean --if-exists drops existing objects first; vector extension is recreated by the dump.
pg_restore --clean --if-exists --no-owner --dbname="${DATABASE_URL}" "${SRC}/postgres.dump"

if [ -f "${SRC}/knowledge_base.tar.gz" ]; then
  echo "[restore] Extracting knowledge base -> ${KB_PARENT}"
  mkdir -p "${KB_PARENT}"
  tar -xzf "${SRC}/knowledge_base.tar.gz" -C "${KB_PARENT}"
fi

for f in Vector_KnowledgeBase_State.json RefinementState.json; do
  [ -f "${SRC}/${f}" ] && cp "${SRC}/${f}" "${STATE_DIR}/" && echo "[restore] Restored ${f}"
done

echo "[restore] Done."
