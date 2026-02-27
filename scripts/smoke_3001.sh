#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env.local.3001 ]]; then
  echo "Missing .env.local.3001. Create it first." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source .env.local.3001
set +a

TEST_GUILD_ID="${TEST_GUILD_ID:-}"

check_http() {
  local name="$1"
  local cmd="$2"

  printf "\n== %s ==\n" "$name"
  # shellcheck disable=SC2086
  eval "$cmd" | sed -n '1,10p'
}

check_http "Isolation check on :3000" "curl -sS -i http://localhost:3000/admin"
check_http "Healthcheck on :3001" "curl -sS -i http://localhost:3001/healthz"
check_http "Admin UI on :3001" "curl -sS -i http://localhost:3001/admin"
check_http "Session guard on :3001" "curl -sS -i http://localhost:3001/admin/api/session"
check_http "OAuth redirect start" "curl -sS -i 'http://localhost:3001/admin/login?redirect=/admin'"
check_http "Internal recheck unauthorized" "curl -sS -i -X POST http://localhost:3001/internal/recheck -H 'content-type: application/json' -d '{}'"

if [[ -n "$TEST_GUILD_ID" ]]; then
  check_http "Internal recheck authorized" "curl -sS -i -X POST http://localhost:3001/internal/recheck -H 'x-internal-secret: ${INTERNAL_API_SECRET}' -H 'content-type: application/json' -d '{\"guild_id\":\"${TEST_GUILD_ID}\"}'"
else
  printf "\n== Internal recheck authorized ==\n"
  echo "SKIPPED (set TEST_GUILD_ID to run this check)"
fi
