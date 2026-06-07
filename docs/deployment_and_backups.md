# Deployment & Backups (Phase F)

## Architecture

The backend (Express API + cron + Playwright scrapers + AI pipeline) runs as a
container alongside the `ankane/pgvector` Postgres service defined in
[`docker-compose.yml`](../docker-compose.yml).

- `backend/Dockerfile` is a multi-stage build on the official Playwright image
  (`mcr.microsoft.com/playwright:v1.60.0-jammy`), so all browser deps are present.
  It additionally installs `ffmpeg` and `yt-dlp` for the transcription/video pipeline.
- Migrations run automatically on boot (`src/index.ts` ensures the `vector`
  extension and applies Drizzle migrations before serving).

## Local / self-hosted run

```bash
# From the repo root. Provide secrets via a root .env (see backend/.env.example).
docker compose up -d --build

# API: http://localhost:3000   Postgres: localhost:5432
docker compose logs -f backend
```

The `backend` service reads `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
`API_AUTH_TOKEN`, `CREDENTIAL_ENCRYPTION_KEY`, and `ENABLE_ORCHESTRATOR` from the
environment. The on-disk knowledge base is persisted in the `kbdata` volume.

## CI auto-deploy

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) has two jobs:

1. **build-and-test** - lint + migrate + Vitest (backend), Vitest (admin-ui),
   Jest (frontend) against a real `pgvector` service.
2. **deploy** - runs only on passing pushes to `main`. It builds the backend
   image and pushes it to GHCR as
   `ghcr.io/<owner>/<repo>/backend:latest` (and `:<sha>`).

### Optional self-hosted rollout

The deploy job will SSH into the self-hosted box and `docker compose pull && up -d`
**only if** the `DEPLOY_HOST` secret is set. Configure these repo secrets to enable it:

| Secret           | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `DEPLOY_HOST`    | Server hostname/IP                                 |
| `DEPLOY_USER`    | SSH user                                           |
| `DEPLOY_SSH_KEY` | Private key with access to the server              |
| `DEPLOY_PATH`    | Directory on the server containing docker-compose  |

Without `DEPLOY_HOST`, the image is still published to GHCR and the box can be
updated manually (`docker compose pull backend && docker compose up -d`).

## Backups

Postgres is the single source of truth; the on-disk `Vector_KnowledgeBase` and
its delta-sync state JSON are the second. Both are backed up by
[`backend/scripts/backup.sh`](../backend/scripts/backup.sh).

```bash
DATABASE_URL=postgres://admin:password123@localhost:5432/life_planner \
BACKUP_DIR=/var/backups/life_planner \
backend/scripts/backup.sh
```

This writes a timestamped folder containing:
- `postgres.dump` - `pg_dump` custom-format dump (includes pgvector data).
- `knowledge_base.tar.gz` - the `Vector_KnowledgeBase` tree.
- `Vector_KnowledgeBase_State.json`, `RefinementState.json` - delta-sync state.

Old backups beyond `RETENTION_DAYS` (default 14) are pruned automatically.

### Schedule (cron example)

```cron
0 3 * * * DATABASE_URL=postgres://admin:password123@localhost:5432/life_planner \
  BACKUP_DIR=/var/backups/life_planner /app/backend/scripts/backup.sh >> /var/log/lp-backup.log 2>&1
```

### Restore

```bash
DATABASE_URL=postgres://admin:password123@localhost:5432/life_planner \
backend/scripts/restore.sh /var/backups/life_planner/20260607_030000
```

`restore.sh` uses `pg_restore --clean --if-exists` (drops existing objects first)
and re-extracts the knowledge base + state files. Test restores periodically
against a scratch database to validate the procedure.
