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

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Run scripts/vps_install.sh first."
  exit 1
fi

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(${SUDO} docker)
fi

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
"${DOCKER[@]}" compose up -d --build

echo "==> Waiting for health endpoint..."
healthy=0
for _ in $(seq 1 40); do
  if curl -fsS http://localhost:3000/healthz >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "${healthy}" -ne 1 ]]; then
  echo "Health check failed. Last logs:"
  "${DOCKER[@]}" compose logs --tail=120 app postgres
  exit 1
fi

echo "==> Registering slash commands..."
"${DOCKER[@]}" compose exec -T app node dist/bot/registerCommands.js

echo
echo "Update finished successfully."
echo "- Branch: ${CURRENT_BRANCH}"
echo "- App health: http://localhost:3000/healthz"
echo
echo "Useful commands:"
echo "  ${DOCKER[*]} compose ps"
echo "  ${DOCKER[*]} compose logs -f app"
