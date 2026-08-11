#!/usr/bin/env bash
#
# Validates the GitHub Actions deployment secrets before they are used to
# build the SSH command. Exits 0 when every secret is present and matches
# the expected shape, 1 otherwise. The values are never printed; failure
# messages only name the invalid variable.
#
# Required environment (set by the workflow step):
#   VPS_HOST VPS_PORT VPS_USER VPS_SSH_PRIVATE_KEY VPS_SSH_HOST_KEY VPS_DEPLOY_PATH
#
# VPS_HOST  - hostname or IPv4 address used by the runner to connect;
#             must not contain newlines or shell metacharacters.
# VPS_PORT  - SSH port, integer between 1 and 65535.
# VPS_USER  - SSH username; letters, digits, '_', '.', '-' and must not
#             start with '-' (no option injection).
# VPS_DEPLOY_PATH - absolute path of the project directory on the VPS;
#             only safe characters, no quotes, spaces, or shell
#             metacharacters (it is embedded in a single-quoted SSH
#             remote command).
# VPS_SSH_PRIVATE_KEY / VPS_SSH_HOST_KEY - only checked for presence.

set -euo pipefail

fail() { printf '[deploy-secrets][ERROR] %s\n' "$*" >&2; exit 1; }

for name in VPS_HOST VPS_PORT VPS_USER VPS_SSH_PRIVATE_KEY VPS_SSH_HOST_KEY VPS_DEPLOY_PATH; do
  if [ -z "${!name:-}" ]; then
    fail "missing required secret: $name"
  fi
done

if ! [[ "$VPS_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$VPS_PORT" -lt 1 ] || [ "$VPS_PORT" -gt 65535 ]; then
  fail "VPS_PORT must be an integer between 1 and 65535"
fi

if ! [[ "$VPS_USER" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$ ]]; then
  fail "VPS_USER must be a valid SSH username (letters, digits, '_', '.', '-', max 32 chars, must not start with '-')"
fi

if ! [[ "$VPS_HOST" =~ ^[A-Za-z0-9._-]+$ ]]; then
  fail "VPS_HOST must be a hostname or IP address without shell metacharacters"
fi

if ! [[ "$VPS_DEPLOY_PATH" =~ ^/[A-Za-z0-9._+:@/=-]*$ ]]; then
  fail "VPS_DEPLOY_PATH must be an absolute path without quotes, spaces, or shell metacharacters"
fi

exit 0
