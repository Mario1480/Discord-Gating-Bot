#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

TARGET_USER="${SUDO_USER:-$USER}"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Please run as root or install sudo first."
    exit 1
  fi
  SUDO="sudo"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "No git repository found in ${REPO_ROOT}."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env in ${REPO_ROOT}. Run scripts/vps_install.sh first."
  exit 1
fi

APP_PORT="$(sed -n 's/^APP_PORT=//p' .env | head -n1)"
if [[ -z "${APP_PORT}" ]]; then
  APP_PORT="3000"
fi

ENABLE_CADDY_RAW="$(sed -n 's/^ENABLE_CADDY=//p' .env | head -n1)"
ENABLE_CADDY_NORMALIZED="$(echo "${ENABLE_CADDY_RAW}" | tr '[:upper:]' '[:lower:]')"
if [[ "${ENABLE_CADDY_NORMALIZED}" == "true" || "${ENABLE_CADDY_NORMALIZED}" == "1" ]]; then
  ENABLE_CADDY="true"
else
  ENABLE_CADDY="false"
fi

CADDY_DOMAIN="$(sed -n 's/^CADDY_DOMAIN=//p' .env | head -n1)"
CADDY_DOMAIN="${CADDY_DOMAIN%\"}"
CADDY_DOMAIN="${CADDY_DOMAIN#\"}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Run scripts/vps_install.sh first."
  exit 1
fi

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(${SUDO} docker)
fi

COMPOSE_FILES=(-f docker-compose.yml)
if [[ "${ENABLE_CADDY}" == "true" ]]; then
  COMPOSE_FILES+=(-f docker-compose.caddy.yml)
fi
COMPOSE_CMD=("${DOCKER[@]}" compose "${COMPOSE_FILES[@]}")

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree has local changes. Commit/stash them before update."
  git status --short
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${CURRENT_BRANCH}" == "HEAD" ]]; then
  echo "Detached HEAD detected. Switch to a branch before update."
  exit 1
fi

echo "==> Fetching latest changes for ${CURRENT_BRANCH}..."
git fetch --all --prune

if git show-ref --verify --quiet "refs/remotes/origin/${CURRENT_BRANCH}"; then
  echo "==> Pulling origin/${CURRENT_BRANCH} (fast-forward only)..."
  git pull --ff-only origin "${CURRENT_BRANCH}"
else
  echo "No remote tracking branch origin/${CURRENT_BRANCH} found. Skipping pull."
fi

echo "==> Rebuilding and restarting containers..."
"${COMPOSE_CMD[@]}" up -d --build

echo "==> Waiting for health endpoint..."
healthy=0
for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:${APP_PORT}/healthz" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "${healthy}" -ne 1 ]]; then
  echo "Health check failed. Last logs:"
  if [[ "${ENABLE_CADDY}" == "true" ]]; then
    "${COMPOSE_CMD[@]}" logs --tail=120 app postgres caddy
  else
    "${COMPOSE_CMD[@]}" logs --tail=120 app postgres
  fi
  exit 1
fi

echo "==> Registering slash commands..."
"${COMPOSE_CMD[@]}" exec -T app node dist/bot/registerCommands.js

echo
echo "Update finished successfully."
echo "- Branch: ${CURRENT_BRANCH}"
echo "- App health: http://localhost:${APP_PORT}/healthz"
if [[ "${ENABLE_CADDY}" == "true" && -n "${CADDY_DOMAIN}" ]]; then
  echo "- Admin UI:   https://${CADDY_DOMAIN}/admin"
fi
echo
echo "Useful commands:"
echo "  ${COMPOSE_CMD[*]} ps"
echo "  ${COMPOSE_CMD[*]} logs -f app"
