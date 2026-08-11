#!/usr/bin/env bash
#
# Controlled production deployment for vacancies-searcher.
#
# Runs ONLY inside the prepared project directory on the VPS.
# The script resolves the project root from its own location
# (project root = parent of the scripts/ directory).
#
# Usage:
#   scripts/deploy-vps.sh <full-commit-sha>
#   DEPLOY_COMMIT_SHA=<full-commit-sha> scripts/deploy-vps.sh
#
# Exit codes:
#   0 - deployment finished and application healthcheck passed
#   1 - preflight, backup, or update failure (no code change applied)
#   2 - new version failed; rollback to the previous SHA finished
#   3 - new version failed and rollback also failed; backup retained on server
#
# The script never prints the contents of .env or any environment variables.

set -euo pipefail

BACKUP_DIR_NAME="deploy-backups"
HEALTHCHECK_MAX_ATTEMPTS="${DEPLOY_HEALTHCHECK_MAX_ATTEMPTS:-10}"
HEALTHCHECK_DELAY_SECONDS="${DEPLOY_HEALTHCHECK_DELAY_SECONDS:-10}"

log() { printf '[deploy] %s\n' "$*"; }
err() { printf '[deploy][ERROR] %s\n' "$*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

wait_healthcheck() {
  local attempt=0
  while [ "$attempt" -lt "$HEALTHCHECK_MAX_ATTEMPTS" ]; do
    if docker compose exec -T vacancy-bot node dist/healthcheck.js >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -lt "$HEALTHCHECK_MAX_ATTEMPTS" ]; then
      sleep "$HEALTHCHECK_DELAY_SECONDS"
    fi
  done
  return 1
}

rollback() {
  local rollback_result="failed"

  log "rollback to previous commit $CURRENT_SHA"
  if git checkout --detach "$CURRENT_SHA" \
    && docker compose build \
    && docker compose up -d \
    && wait_healthcheck; then
    rollback_result="success"
  else
    docker compose logs --tail=50 vacancy-bot || true
  fi

  log "new SHA: $NEW_SHA"
  log "previous SHA: $CURRENT_SHA"
  log "rollback result: $rollback_result"
  log "backup file: $BACKUP_FILE"

  if [ "$rollback_result" = "success" ]; then
    err "deployment of $NEW_SHA failed; previous version restored."
    exit 2
  fi

  err "deployment of $NEW_SHA failed and rollback also failed."
  err "backup is retained on the server for manual recovery."
  exit 3
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

COMMIT_SHA="${1:-${DEPLOY_COMMIT_SHA:-}}"
if [ -z "$COMMIT_SHA" ]; then
  err "commit SHA is required (positional argument or DEPLOY_COMMIT_SHA)."
  exit 1
fi
if ! [[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  err "invalid commit SHA (expected exactly 40 lowercase hex characters): $COMMIT_SHA"
  exit 1
fi

for tool in git docker tar date; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "required tool not found: $tool"
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  err "docker compose (v2) is not available."
  exit 1
fi

if [ ! -d "$PROJECT_ROOT" ]; then
  err "project directory does not exist: $PROJECT_ROOT"
  exit 1
fi
cd "$PROJECT_ROOT"

if [ ! -f docker-compose.yml ]; then
  err "docker-compose.yml is missing; refusing to deploy."
  exit 1
fi
if [ ! -f .env ]; then
  err ".env is missing; refusing to deploy."
  exit 1
fi
if [ ! -d data ]; then
  err "data directory is missing; refusing to deploy."
  exit 1
fi
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  err "not a git repository; refusing to deploy."
  exit 1
fi

DIRTY="$(git status --porcelain --untracked-files=no || true)"
if [ -n "$DIRTY" ]; then
  err "unexpected tracked changes in the working tree; refusing to deploy."
  printf '%s\n' "$DIRTY" | sed 's/^/  /'
  exit 1
fi

CURRENT_SHA="$(git rev-parse HEAD)"
NEW_SHA="$COMMIT_SHA"

if [ "$NEW_SHA" = "$CURRENT_SHA" ]; then
  log "already deployed at $CURRENT_SHA; nothing to do."
  exit 0
fi

# ---------------------------------------------------------------------------
# Fetch and verify the exact commit
# ---------------------------------------------------------------------------

log "fetching origin develop"
git fetch origin develop

if ! git merge-base --is-ancestor "$NEW_SHA" origin/develop; then
  err "commit $NEW_SHA is not present on origin/develop; refusing to deploy."
  exit 1
fi

# ---------------------------------------------------------------------------
# Backup before replacing the container
# ---------------------------------------------------------------------------

BACKUP_DIR="$PROJECT_ROOT/$BACKUP_DIR_NAME"
install -d -m 700 "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/vacancies-searcher-$(date -u +%Y%m%dT%H%M%SZ)-$CURRENT_SHA.tar.gz"

log "stopping vacancy-bot before backup"
docker compose stop vacancy-bot

log "creating backup: $BACKUP_FILE"
if ! tar -czf "$BACKUP_FILE" .env data; then
  err "backup creation failed; deployment stopped."
  docker compose start vacancy-bot || true
  exit 1
fi
if ! chmod 600 "$BACKUP_FILE"; then
  err "cannot set restrictive permissions on backup file; deployment stopped."
  docker compose start vacancy-bot || true
  exit 1
fi
log "backup created"

# ---------------------------------------------------------------------------
# Switch the working tree to the exact commit
# ---------------------------------------------------------------------------

log "switching to commit $NEW_SHA"
if ! git checkout --detach "$NEW_SHA"; then
  err "git checkout failed; restoring previous version."
  git checkout --detach "$CURRENT_SHA" || true
  docker compose start vacancy-bot || true
  exit 1
fi

# ---------------------------------------------------------------------------
# Build and start
# ---------------------------------------------------------------------------

log "validating compose configuration"
if ! docker compose config --quiet; then
  err "docker compose config validation failed for $NEW_SHA."
  rollback
fi

log "building image"
if ! docker compose build; then
  err "docker compose build failed for $NEW_SHA."
  rollback
fi

log "starting vacancy-bot"
if ! docker compose up -d; then
  err "docker compose up failed for $NEW_SHA."
  docker compose logs --tail=50 vacancy-bot || true
  rollback
fi

# ---------------------------------------------------------------------------
# Application healthcheck
# ---------------------------------------------------------------------------

if ! wait_healthcheck; then
  err "application healthcheck did not pass for $NEW_SHA."
  docker compose ps --format '{{.Names}} {{.Status}}' || true
  docker compose logs --tail=50 vacancy-bot || true
  rollback
fi

log "deployment successful"
log "deployed commit: $NEW_SHA"
log "previous commit: $CURRENT_SHA"
log "backup file: $BACKUP_FILE"
exit 0
