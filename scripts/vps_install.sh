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

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer currently supports Ubuntu/Debian VPS only."
  exit 1
fi

echo "==> Installing base packages..."
${SUDO} apt-get update -y
${SUDO} apt-get install -y ca-certificates curl gnupg lsb-release

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "==> Docker + Compose already installed."
    return
  fi

  local distro arch codename
  distro="$(. /etc/os-release && echo "$ID")"
  arch="$(dpkg --print-architecture)"
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"

  if [[ -z "${codename}" ]]; then
    codename="$(lsb_release -cs)"
  fi

  echo "==> Installing Docker Engine + Compose plugin..."
  ${SUDO} install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL "https://download.docker.com/linux/${distro}/gpg" | ${SUDO} gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    ${SUDO} chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  echo \
    "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${distro} ${codename} stable" \
    | ${SUDO} tee /etc/apt/sources.list.d/docker.list >/dev/null

  ${SUDO} apt-get update -y
  ${SUDO} apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  ${SUDO} systemctl enable --now docker

  if id -nG "${TARGET_USER}" | tr ' ' '\n' | grep -qx docker; then
    true
  else
    ${SUDO} usermod -aG docker "${TARGET_USER}"
    echo "Added ${TARGET_USER} to docker group."
    echo "You may need to log out and back in for docker group changes to apply."
  fi
}

install_docker

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(${SUDO} docker)
fi

if [[ ! -f ".env" ]]; then
  echo "==> Creating .env from .env.example"
  cp .env.example .env
fi

echo "==> Ensuring Docker-internal DATABASE_URL in .env"
if grep -q '^DATABASE_URL=' .env; then
  sed -i.bak 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord_gating#' .env
else
  echo 'DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord_gating' >> .env
fi

check_env_var() {
  local key="$1"
  local value
  value="$(sed -n "s/^${key}=//p" .env | head -n1)"

  if [[ -z "${value}" ]]; then
    echo "Missing required .env value: ${key}"
    return 1
  fi

  if [[ "${value}" == REPLACE_WITH_* ]] || [[ "${value}" == *YOUR_KEY* ]]; then
    echo "Placeholder detected in .env for: ${key}"
    return 1
  fi

  return 0
}

echo "==> Validating required .env values..."
missing=0
for key in \
  DISCORD_TOKEN \
  DISCORD_CLIENT_ID \
  DISCORD_CLIENT_SECRET \
  VERIFY_TOKEN_SECRET \
  INTERNAL_API_SECRET \
  ADMIN_SESSION_SECRET \
  SOLANA_RPC_URL \
  SOLANA_DAS_URL \
  VERIFY_BASE_URL \
  ADMIN_UI_BASE_URL
do
  if ! check_env_var "${key}"; then
    missing=1
  fi
done

if [[ "${missing}" -ne 0 ]]; then
  echo
  echo "Please fix .env values and run this script again."
  exit 1
fi

if grep -q '^VERIFY_BASE_URL=http://localhost' .env || grep -q '^ADMIN_UI_BASE_URL=http://localhost' .env; then
  echo "Warning: VERIFY_BASE_URL/ADMIN_UI_BASE_URL still point to localhost."
  echo "For production, set them to your public domain (https://...)."
fi

echo "==> Building and starting containers..."
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
echo "VPS install finished successfully."
echo "- App health: http://localhost:3000/healthz"
echo "- Admin UI:   http://localhost:3000/admin"
echo
echo "Useful commands:"
echo "  ${DOCKER[*]} compose ps"
echo "  ${DOCKER[*]} compose logs -f app"
