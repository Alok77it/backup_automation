#!/bin/bash
# Docker Engine installation script
# Executed by the server agent in a sandboxed environment.
# Supports: Ubuntu, Debian, CentOS/RHEL, Amazon Linux
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export APT_LISTCHANGES_FRONTEND=none

log() { echo "[DOCKER-INSTALL] $*"; }

# ── OS detection ────────────────────────────────────────────────────
OS_ID=""
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="${ID:-}"
fi

log "Detected OS: $OS_ID"

# ── Idempotency check ────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  CURRENT=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')
  log "Docker already installed: $CURRENT — skipping engine install"
else
  # ── Install by OS ─────────────────────────────────────────────────
  case "$OS_ID" in
    ubuntu|debian)
      log "Installing Docker via apt..."
      apt-get update -y -qq
      apt-get install -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold ca-certificates curl gnupg lsb-release
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/${OS_ID}/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/${OS_ID} $(lsb_release -cs) stable" \
        > /etc/apt/sources.list.d/docker.list
      apt-get update -y -qq
      apt-get install -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    centos|rhel|fedora)
      log "Installing Docker via yum/dnf..."
      yum install -y -q yum-utils
      yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      yum install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    amzn)
      log "Installing Docker on Amazon Linux..."
      amazon-linux-extras install docker -y
      yum install -y docker
      ;;
    *)
      log "Unsupported OS: $OS_ID. Attempting generic curl install..."
      curl -fsSL https://get.docker.com | sh -s -- -y
      ;;
  esac
fi

# ── Start & enable Docker ─────────────────────────────────────────
systemctl enable docker --now
log "Docker service started"

if ! docker compose version >/dev/null 2>&1; then
  log "Docker Compose plugin missing. Installing Compose support..."
  case "$OS_ID" in
    ubuntu|debian)
      apt-get update -y -qq
      apt-get install -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold docker-compose-plugin \
        || apt-get install -y -qq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold docker-compose-v2
      ;;
    centos|rhel|fedora|amzn)
      yum install -y -q docker-compose-plugin || dnf install -y -q docker-compose-plugin
      ;;
  esac
fi

if ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Compose CLI plugin from GitHub..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) ARCH="x86_64" ;;
    aarch64|arm64) ARCH="aarch64" ;;
  esac
  mkdir -p /usr/local/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/libexec/docker/cli-plugins/docker-compose
fi

# ── Verify ────────────────────────────────────────────────────────
docker --version
docker compose version

log "Docker installation complete."
