#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/vps_install.sh [--repo <git_url>] [--branch <branch>] [--dir <install_dir>]

Modes:
  1) Run inside an already cloned repository (no --repo needed).
  2) Clone directly from GitHub/Git (--repo) and install from there.

Examples:
  ./scripts/vps_install.sh
  ./scripts/vps_install.sh --repo https://github.com/<owner>/<repo>.git --branch main
  ./scripts/vps_install.sh --repo git@github.com:<owner>/<repo>.git --dir /opt/discord-gating-bot
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_USER="${SUDO_USER:-$USER}"
if command -v getent >/dev/null 2>&1; then
  TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6 2>/dev/null || echo "${HOME}")"
else
  TARGET_HOME="${HOME}"
fi
ORIG_ARGS=("$@")
SELF_REEXEC_DONE="${SELF_REEXEC_DONE:-0}"

REPO_URL=""
BRANCH=""
INSTALL_DIR="${TARGET_HOME}/discord-gating-bot"
REPO_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

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
${SUDO} apt-get install -y ca-certificates curl gnupg lsb-release git

run_as_target_user() {
  if [[ "$(id -u)" -eq 0 && "${TARGET_USER}" != "root" ]]; then
    ${SUDO} -u "${TARGET_USER}" -H "$@"
  else
    "$@"
  fi
}

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

resolve_repo_root() {
  local candidate_root
  candidate_root="$(cd "${SCRIPT_DIR}/.." && pwd)"

  if [[ -f "${candidate_root}/docker-compose.yml" && -f "${candidate_root}/.env.example" ]]; then
    REPO_ROOT="${candidate_root}"
    return 0
  fi

  return 1
}

clone_repo_if_requested() {
  if [[ -z "${REPO_URL}" ]]; then
    return 1
  fi

  echo "==> Preparing repository from ${REPO_URL}"
  local install_parent
  install_parent="$(dirname "${INSTALL_DIR}")"
  ${SUDO} mkdir -p "${install_parent}"
  ${SUDO} chown "${TARGET_USER}:${TARGET_USER}" "${install_parent}" || true

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    echo "==> Existing git repo found in ${INSTALL_DIR}; reusing it."
    local old_rev new_rev
    old_rev="$(run_as_target_user git -C "${INSTALL_DIR}" rev-parse HEAD 2>/dev/null || echo "")"
    run_as_target_user git -C "${INSTALL_DIR}" fetch --all --prune

    if [[ -n "${BRANCH}" ]]; then
      run_as_target_user git -C "${INSTALL_DIR}" checkout "${BRANCH}"
      run_as_target_user git -C "${INSTALL_DIR}" pull --ff-only origin "${BRANCH}"
    fi
    new_rev="$(run_as_target_user git -C "${INSTALL_DIR}" rev-parse HEAD 2>/dev/null || echo "")"

    if [[ "${SELF_REEXEC_DONE}" != "1" && -n "${old_rev}" && -n "${new_rev}" && "${old_rev}" != "${new_rev}" ]]; then
      echo "==> Repository was updated during install. Restarting installer with latest script..."
      exec env SELF_REEXEC_DONE=1 bash "${INSTALL_DIR}/scripts/vps_install.sh" "${ORIG_ARGS[@]}"
    fi

    REPO_ROOT="${INSTALL_DIR}"
    return 0
  fi

  if [[ -e "${INSTALL_DIR}" && -n "$(ls -A "${INSTALL_DIR}" 2>/dev/null)" ]]; then
    echo "Install dir is not empty and is not a git repo: ${INSTALL_DIR}"
    echo "Choose another --dir or clean it up."
    exit 1
  fi

  local clone_cmd=(git clone)
  if [[ -n "${BRANCH}" ]]; then
    clone_cmd+=(--branch "${BRANCH}" --single-branch)
  fi
  clone_cmd+=("${REPO_URL}" "${INSTALL_DIR}")

  run_as_target_user "${clone_cmd[@]}"
  REPO_ROOT="${INSTALL_DIR}"
  return 0
}

install_docker

if clone_repo_if_requested; then
  true
elif resolve_repo_root; then
  true
else
  echo "Could not detect repository root from script location."
  echo "Run with --repo <git_url> to clone directly from GitHub."
  exit 1
fi

echo "==> Using repository: ${REPO_ROOT}"
cd "${REPO_ROOT}"

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
