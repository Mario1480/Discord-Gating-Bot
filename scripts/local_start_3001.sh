#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env.local.3001 ]]; then
  echo "Missing .env.local.3001. Copy from .env.example and fill required values." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source .env.local.3001
set +a

for key in DISCORD_TOKEN DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET; do
  val="${!key:-}"
  if [[ -z "$val" || "$val" == REPLACE_WITH_* ]]; then
    echo "Please set a real value for $key in .env.local.3001 before starting." >&2
    exit 1
  fi
done

echo "Starting isolated local instance on PORT=${PORT:-3001}..."
exec npm run start
