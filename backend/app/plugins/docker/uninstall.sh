#!/bin/bash
# Docker Engine uninstallation script
set -euo pipefail
log() { echo "[DOCKER-UNINSTALL] $*"; }

OS_ID=""
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="${ID:-}"
fi

log "Stopping Docker..."
systemctl stop docker docker.socket containerd 2>/dev/null || true
systemctl disable docker docker.socket containerd 2>/dev/null || true

case "$OS_ID" in
  ubuntu|debian)
    apt-get remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || true
    apt-get purge -y docker-ce docker-ce-cli 2>/dev/null || true
    ;;
  centos|rhel|fedora|amzn)
    yum remove -y docker-ce docker-ce-cli containerd.io 2>/dev/null || true
    ;;
esac

rm -rf /var/lib/docker /var/lib/containerd /etc/docker
log "Docker uninstalled."
