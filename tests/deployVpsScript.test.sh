#!/usr/bin/env bash
#
# Mock-based tests for scripts/deploy-vps.sh.
#
# Runs the real deploy script against a sandboxed fake VPS project with
# mocked git/docker/tar/date binaries in PATH. Requires bash 4+ with
# mktemp and tar (Git Bash on Windows or any Linux host).
#
# Permission assertions are only enforced on hosts where chmod actually
# changes modes (e.g. Linux); MSYS/Windows silently ignores chmod, so
# those assertions degrade to skips there.
#
# Usage:
#   bash tests/deployVpsScript.test.sh
#
# Exit code 0 when all assertions pass, 1 otherwise.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SCRIPT="$ROOT/scripts/deploy-vps.sh"
WORKFLOW="$ROOT/.github/workflows/deploy-production.yml"

FAILURES=0
CHECKS=0
SKIPS=0

PASS_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
PREV_SHA="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

pass() { CHECKS=$((CHECKS + 1)); printf 'ok - %s\n' "$1"; }
fail() {
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  printf 'FAIL - %s\n' "$1"
}
skip() { CHECKS=$((CHECKS + 1)); SKIPS=$((SKIPS + 1)); printf 'skip - %s\n' "$1"; }

# ---------------------------------------------------------------------------
# Sandbox helpers
# ---------------------------------------------------------------------------

SANDBOX="$(mktemp -d 2>/dev/null || mktemp -d "${TMPDIR:-/tmp}/deploytest.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

MOCKS="$SANDBOX/bin"
TEST_RUNS="$SANDBOX/runs"
mkdir -p "$MOCKS" "$TEST_RUNS"

# Does chmod actually change modes on this host?
CAPS_FILE="$SANDBOX/caps_check"
printf 'x' > "$CAPS_FILE"
chmod 600 "$CAPS_FILE" 2>/dev/null || true
CAPS_MODE="$(stat -c '%a' "$CAPS_FILE" 2>/dev/null || stat -f '%Lp' "$CAPS_FILE" 2>/dev/null || echo none)"
CHMOD_OK=0
[ "$CAPS_MODE" = "600" ] && CHMOD_OK=1

# Shared mock state files
GIT_CURRENT="$SANDBOX/git_current"
GIT_ANCESTOR_FAIL="$SANDBOX/git_ancestor_fail"     # exists => merge-base fails
GIT_CHECKOUT_FAIL="$SANDBOX/git_checkout_fail"     # exists => checkout always fails
GIT_CHECKOUT_FAIL_SHA="$SANDBOX/git_checkout_fail_sha" # contains SHA whose checkout fails
GIT_FETCH_FAIL="$SANDBOX/git_fetch_fail"           # exists => fetch fails
GIT_DIRTY_FLAG="$SANDBOX/git_dirty"                # exists => dirty tree
DOCKER_BUILD_EXIT="$SANDBOX/docker_build_exit"
DOCKER_BUILD_FAIL_SHA="$SANDBOX/docker_build_fail_sha" # contains SHA whose build fails
DOCKER_UP_EXIT="$SANDBOX/docker_up_exit"
DOCKER_EXEC_EXIT="$SANDBOX/docker_exec_exit"
DOCKER_EXEC_FAIL_SHA="$SANDBOX/docker_exec_fail_sha"   # contains SHA whose exec fails
DOCKER_STOP_EXIT="$SANDBOX/docker_stop_exit"
TAR_FAIL="$SANDBOX/tar_fail"                       # exists => tar fails

printf '%s' "$PREV_SHA" > "$GIT_CURRENT"
printf '0' > "$DOCKER_BUILD_EXIT"
printf '0' > "$DOCKER_UP_EXIT"
printf '0' > "$DOCKER_EXEC_EXIT"
printf '0' > "$DOCKER_STOP_EXIT"

cat > "$MOCKS/git" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  rev-parse)
    [ "$2" = "--git-dir" ] && exit 0
    [ "$2" = "HEAD" ] && cat "$GIT_CURRENT" && exit 0
    exit 1
    ;;
  status)
    if [ -f "$GIT_DIRTY_FLAG" ]; then
      printf ' M package.json\n'
    fi
    exit 0
    ;;
  fetch)
    if [ -f "$GIT_FETCH_FAIL" ]; then exit 1; fi
    exit 0
    ;;
  merge-base)
    if [ -f "$GIT_ANCESTOR_FAIL" ]; then exit 1; fi
    exit 0
    ;;
  checkout)
    if [ -f "$GIT_CHECKOUT_FAIL_SHA" ] && [ "$(cat "$GIT_CHECKOUT_FAIL_SHA")" = "${3:-}" ]; then
      exit 1
    fi
    if [ -f "$GIT_CHECKOUT_FAIL" ]; then exit 1; fi
    printf '%s' "$3" > "$GIT_CURRENT"
    exit 0
    ;;
esac
exit 1
EOF

cat > "$MOCKS/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$DOCKER_CALLS_LOG"
if [ "${1:-}" = "compose" ]; then
  case "$2" in
    version) exit 0 ;;
    stop) exit "$(cat "$DOCKER_STOP_EXIT")" ;;
    start) exit 0 ;;
    config) exit 0 ;;
    build)
      if [ -f "$DOCKER_BUILD_FAIL_SHA" ] \
        && [ "$(cat "$DOCKER_BUILD_FAIL_SHA")" = "$(cat "$GIT_CURRENT")" ]; then
        exit 1
      fi
      exit "$(cat "$DOCKER_BUILD_EXIT")" ;;
    up) exit "$(cat "$DOCKER_UP_EXIT")" ;;
    exec)
      if [ -f "$DOCKER_EXEC_FAIL_SHA" ] \
        && [ "$(cat "$DOCKER_EXEC_FAIL_SHA")" = "$(cat "$GIT_CURRENT")" ]; then
        exit 1
      fi
      exit "$(cat "$DOCKER_EXEC_EXIT")" ;;
    ps) printf 'vacancy-bot Running (mock)\n' ;;
    logs) printf 'vacancy-bot mock log line\n' ;;
  esac
fi
exit 0
EOF

cat > "$MOCKS/tar" <<'EOF'
#!/usr/bin/env bash
printf 'tar %s\n' "$*" >> "$TAR_CALLS_LOG"
out=""
for a in "$@"; do
  if [[ "$a" == -*f* ]]; then
    shift
    out="${1:-}"
    break
  fi
done
if [ -f "$TAR_FAIL" ]; then
  printf 'mock tar failure\n' >&2
  exit 1
fi
if [ -n "$out" ]; then
  : > "$out"
fi
exit 0
EOF

# MSYS/Windows cannot chmod directories, so `install -d -m 700` fails
# there even though it works on the Linux VPS. The mock keeps the strict
# script unchanged while tolerating hosts without directory chmod.
cat > "$MOCKS/install" <<'EOF'
#!/usr/bin/env bash
dir=""
mode=""
while [ $# -gt 0 ]; do
  case "$1" in
    -d) : ;;
    -m) shift; mode="$1" ;;
    -*) : ;;
    *) dir="$1" ;;
  esac
  shift
done
[ -n "$dir" ] || exit 1
mkdir -p "$dir" || exit 1
if [ -n "$mode" ]; then
  chmod "$mode" "$dir" 2>/dev/null || true
fi
exit 0
EOF

cat > "$MOCKS/date" <<'EOF'
#!/usr/bin/env bash
printf '20260722T120000Z'
EOF

chmod +x "$MOCKS/git" "$MOCKS/docker" "$MOCKS/tar" "$MOCKS/install" "$MOCKS/date"

# ---------------------------------------------------------------------------
# Sandbox project
# ---------------------------------------------------------------------------

mkdir -p "$SANDBOX/project/scripts"
mkdir -p "$SANDBOX/project/data"
touch "$SANDBOX/project/docker-compose.yml"
printf 'BOT_TOKEN=test-token\n' > "$SANDBOX/project/.env"
cp "$DEPLOY_SCRIPT" "$SANDBOX/project/scripts/deploy-vps.sh"

DOCKER_CALLS_LOG="$TEST_RUNS/docker_calls"
TAR_CALLS_LOG="$TEST_RUNS/tar_calls"

reset_state() {
  printf '%s' "$PREV_SHA" > "$GIT_CURRENT"
  printf '0' > "$DOCKER_BUILD_EXIT"
  printf '0' > "$DOCKER_UP_EXIT"
  printf '0' > "$DOCKER_EXEC_EXIT"
  printf '0' > "$DOCKER_STOP_EXIT"
  rm -f "$GIT_ANCESTOR_FAIL" "$GIT_CHECKOUT_FAIL" "$GIT_CHECKOUT_FAIL_SHA" "$GIT_FETCH_FAIL" "$GIT_DIRTY_FLAG" "$TAR_FAIL"
  rm -f "$DOCKER_BUILD_FAIL_SHA" "$DOCKER_EXEC_FAIL_SHA"
  rm -f "$DOCKER_CALLS_LOG" "$TAR_CALLS_LOG"
  rm -rf "$SANDBOX/project/deploy-backups"
}

run_deploy() {
  local expected="$1"
  shift
  set +e
  PATH="$MOCKS:$PATH" \
    DOCKER_CALLS_LOG="$DOCKER_CALLS_LOG" \
    TAR_CALLS_LOG="$TAR_CALLS_LOG" \
    GIT_CURRENT="$GIT_CURRENT" \
    GIT_ANCESTOR_FAIL="$GIT_ANCESTOR_FAIL" \
    GIT_CHECKOUT_FAIL="$GIT_CHECKOUT_FAIL" \
    GIT_CHECKOUT_FAIL_SHA="$GIT_CHECKOUT_FAIL_SHA" \
    GIT_FETCH_FAIL="$GIT_FETCH_FAIL" \
    GIT_DIRTY_FLAG="$GIT_DIRTY_FLAG" \
    DOCKER_BUILD_EXIT="$DOCKER_BUILD_EXIT" \
    DOCKER_BUILD_FAIL_SHA="$DOCKER_BUILD_FAIL_SHA" \
    DOCKER_UP_EXIT="$DOCKER_UP_EXIT" \
    DOCKER_EXEC_EXIT="$DOCKER_EXEC_EXIT" \
    DOCKER_EXEC_FAIL_SHA="$DOCKER_EXEC_FAIL_SHA" \
    DOCKER_STOP_EXIT="$DOCKER_STOP_EXIT" \
    TAR_FAIL="$TAR_FAIL" \
    DEPLOY_HEALTHCHECK_MAX_ATTEMPTS=2 \
    DEPLOY_HEALTHCHECK_DELAY_SECONDS=0 \
    bash "$SANDBOX/project/scripts/deploy-vps.sh" "$@" > "$TEST_RUNS/out" 2>&1
  local code=$?
  set -e
  if [ "$code" -ne "$expected" ]; then
    fail "expected exit $expected, got $code"
    sed 's/^/    | /' "$TEST_RUNS/out" || true
    return 1
  fi
  pass "exit code $expected as expected"
  return 0
}

# ---------------------------------------------------------------------------
# 1. Invalid commit SHA is rejected
# ---------------------------------------------------------------------------

reset_state
run_deploy 1 "not-a-sha" && grep -q "invalid commit SHA" "$TEST_RUNS/out" \
  && pass "invalid SHA message" || fail "invalid SHA rejected"
run_deploy 1 "abcdef1234567890abcdef1234567890abc" && grep -q "invalid commit SHA" "$TEST_RUNS/out" \
  && pass "short SHA rejected" || fail "short SHA rejected"
run_deploy 1 && grep -q "commit SHA is required" "$TEST_RUNS/out" \
  && pass "missing SHA rejected" || fail "missing SHA rejected"

# ---------------------------------------------------------------------------
# 2. Missing .env stops the deploy
# ---------------------------------------------------------------------------

reset_state
mv "$SANDBOX/project/.env" "$SANDBOX/project/.env.tmp"
run_deploy 1 "$PASS_SHA" && grep -q "\.env is missing" "$TEST_RUNS/out" \
  && pass ".env missing stops deploy" || fail ".env missing stops deploy"
mv "$SANDBOX/project/.env.tmp" "$SANDBOX/project/.env"

# ---------------------------------------------------------------------------
# 3. Missing docker-compose.yml stops the deploy
# ---------------------------------------------------------------------------

reset_state
mv "$SANDBOX/project/docker-compose.yml" "$SANDBOX/project/docker-compose.yml.tmp"
run_deploy 1 "$PASS_SHA" && grep -q "docker-compose.yml is missing" "$TEST_RUNS/out" \
  && pass "docker-compose.yml missing stops deploy" || fail "docker-compose.yml missing stops deploy"
mv "$SANDBOX/project/docker-compose.yml.tmp" "$SANDBOX/project/docker-compose.yml"

# ---------------------------------------------------------------------------
# 4. Dirty tracked working tree stops the deploy
# ---------------------------------------------------------------------------

reset_state
touch "$GIT_DIRTY_FLAG"
run_deploy 1 "$PASS_SHA" && grep -q "unexpected tracked changes" "$TEST_RUNS/out" \
  && pass "dirty tree stops deploy" || fail "dirty tree stops deploy"

# ---------------------------------------------------------------------------
# 5. SHA not on origin/develop stops the deploy
# ---------------------------------------------------------------------------

reset_state
touch "$GIT_ANCESTOR_FAIL"
run_deploy 1 "$PASS_SHA" && grep -q "not present on origin/develop" "$TEST_RUNS/out" \
  && pass "SHA not on develop stops deploy" || fail "SHA not on develop stops deploy"

# ---------------------------------------------------------------------------
# 6. Backup failure stops the deploy and restarts the bot
# ---------------------------------------------------------------------------

reset_state
touch "$TAR_FAIL"
run_deploy 1 "$PASS_SHA" \
  && grep -q "backup creation failed" "$TEST_RUNS/out" \
  && grep -q "docker compose start vacancy-bot" "$DOCKER_CALLS_LOG" \
  && pass "backup failure stops deploy and restarts bot" \
  || fail "backup failure stops deploy and restarts bot"

# ---------------------------------------------------------------------------
# 7. Successful deployment creates a backup and exits 0
# ---------------------------------------------------------------------------

reset_state
run_deploy 0 "$PASS_SHA" && pass "deployment succeeded"
grep -q "deployed commit: $PASS_SHA" "$TEST_RUNS/out" && pass "deployed SHA reported" \
  || fail "deployed SHA reported"
grep -q "backup created" "$TEST_RUNS/out" && pass "backup created message" \
  || fail "backup created message"
BACKUP_FILE="$(find "$SANDBOX/project/deploy-backups" -name '*.tar.gz' | head -n 1)"
[ -n "$BACKUP_FILE" ] && pass "backup file exists" || fail "backup file exists"
case "$(basename "$BACKUP_FILE")" in
  *20260722T120000Z*"$PREV_SHA"*) pass "backup name has UTC timestamp and previous SHA" ;;
  *) fail "backup name has UTC timestamp and previous SHA: $(basename "$BACKUP_FILE")" ;;
esac
PERMS="$(stat -c '%a' "$BACKUP_FILE" 2>/dev/null || stat -f '%Lp' "$BACKUP_FILE" 2>/dev/null || echo none)"
if [ "$CHMOD_OK" = "1" ]; then
  [ "$PERMS" = "600" ] && pass "backup file perms 600" || fail "backup file perms 600 (got $PERMS)"
else
  skip "backup file perms 600 (chmod unsupported on this host)"
fi
grep -q "docker compose exec -T vacancy-bot node dist/healthcheck.js" "$DOCKER_CALLS_LOG" \
  && pass "healthcheck invoked" || fail "healthcheck invoked"
grep -q "tar -czf" "$TAR_CALLS_LOG" && pass "backup archive created via tar" \
  || fail "backup archive created via tar"

# ---------------------------------------------------------------------------
# 8. Docker build failure triggers rollback (exit 2) and restores previous SHA
# ---------------------------------------------------------------------------

reset_state
printf '%s' "$PASS_SHA" > "$DOCKER_BUILD_FAIL_SHA"
run_deploy 2 "$PASS_SHA" && pass "build failure exits 2"
grep -q "rollback result: success" "$TEST_RUNS/out" && pass "rollback success reported" \
  || fail "rollback success reported"
grep -q "rollback to previous commit $PREV_SHA" "$TEST_RUNS/out" \
  && pass "rollback to previous SHA" || fail "rollback to previous SHA"
grep -q "backup file: " "$TEST_RUNS/out" && pass "backup path reported on rollback" \
  || fail "backup path reported on rollback"
grep -q "new SHA: $PASS_SHA" "$TEST_RUNS/out" && pass "new SHA reported on rollback" \
  || fail "new SHA reported on rollback"

# ---------------------------------------------------------------------------
# 9. Healthcheck failure triggers rollback (exit 2)
# ---------------------------------------------------------------------------

reset_state
printf '%s' "$PASS_SHA" > "$DOCKER_EXEC_FAIL_SHA"
run_deploy 2 "$PASS_SHA" && pass "healthcheck failure exits 2"
grep -q "healthcheck did not pass" "$TEST_RUNS/out" && pass "healthcheck failure message" \
  || fail "healthcheck failure message"
grep -q "rollback result: success" "$TEST_RUNS/out" && pass "rollback after healthcheck failure" \
  || fail "rollback after healthcheck failure"

# ---------------------------------------------------------------------------
# 10. Failed rollback exits 3
# ---------------------------------------------------------------------------

reset_state
printf '%s' "$PASS_SHA" > "$DOCKER_BUILD_FAIL_SHA"
printf '%s' "$PREV_SHA" > "$GIT_CHECKOUT_FAIL_SHA"
run_deploy 3 "$PASS_SHA" && pass "rollback failure exits 3"
grep -q "rollback result: failed" "$TEST_RUNS/out" && pass "rollback failed reported" \
  || fail "rollback failed reported"
grep -q "backup is retained" "$TEST_RUNS/out" && pass "backup retained message" \
  || fail "backup retained message"

# ---------------------------------------------------------------------------
# 11. Workflow: master is not in the deployment trigger
# ---------------------------------------------------------------------------

if grep -A 3 '^on:' "$WORKFLOW" | grep -q 'push' && grep -q 'branches:' "$WORKFLOW" \
  && ! grep -A 3 'branches:' "$WORKFLOW" | grep -q 'master'; then
  pass "deployment trigger does not include master"
else
  fail "deployment trigger does not include master"
fi
grep -q '^\s*- develop$' "$WORKFLOW" && pass "deployment trigger includes develop" \
  || fail "deployment trigger includes develop"

# ---------------------------------------------------------------------------
# 12. Workflow: concurrency blocks parallel deploys
# ---------------------------------------------------------------------------

grep -q 'group: production-deploy' "$WORKFLOW" && pass "concurrency group production-deploy" \
  || fail "concurrency group production-deploy"
grep -q 'cancel-in-progress: false' "$WORKFLOW" && pass "cancel-in-progress false" \
  || fail "cancel-in-progress false"

# ---------------------------------------------------------------------------
# 13. Secrets are not printed
# ---------------------------------------------------------------------------

if grep -qiE 'VPS_SSH_PRIVATE_KEY|VPS_SSH_HOST_KEY|BOT_TOKEN' "$DEPLOY_SCRIPT" \
  || grep -qE 'printenv|cat .*\.env' "$DEPLOY_SCRIPT"; then
  fail "deploy script does not print secrets"
else
  pass "deploy script does not print secrets"
fi
if grep -qE 'run:.*(printenv|cat.*\.env|echo.*secrets\.VPS_SSH_PRIVATE_KEY)' "$WORKFLOW"; then
  fail "workflow does not print secrets"
else
  pass "workflow does not print secrets"
fi
grep -q 'StrictHostKeyChecking=no' "$WORKFLOW" && fail "workflow does not disable host key checking" \
  || pass "workflow does not disable host key checking"
grep -q 'ssh-keyscan' "$WORKFLOW" && fail "workflow does not fetch host key via ssh-keyscan" \
  || pass "workflow does not fetch host key via ssh-keyscan"

# ---------------------------------------------------------------------------
# 14. Workflow uses exact SHA and GitHub Environment
# ---------------------------------------------------------------------------

grep -q "github.sha" "$WORKFLOW" && pass "workflow passes exact github.sha" \
  || fail "workflow passes exact github.sha"
grep -q 'environment: production' "$WORKFLOW" && pass "production environment used" \
  || fail "production environment used"
grep -q "ref: \${{ github.sha }}" "$WORKFLOW" && pass "checkout pinned to github.sha" \
  || fail "checkout pinned to github.sha"

# ---------------------------------------------------------------------------
# 15. Deploy script runs the healthcheck in the container
# ---------------------------------------------------------------------------

grep -q 'node dist/healthcheck.js' "$DEPLOY_SCRIPT" && pass "healthcheck command present in script" \
  || fail "healthcheck command present in script"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf '\n%d checks (%d passed, %d skipped, %d failed)\n' "$CHECKS" \
  "$((CHECKS - SKIPS - FAILURES))" "$SKIPS" "$FAILURES"
[ "$FAILURES" -eq 0 ]
