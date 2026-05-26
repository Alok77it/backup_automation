#!/bin/bash
# k3s Kubernetes installation script
set -euo pipefail
log() { echo "[K3S-INSTALL] $*"; }

K3S_VERSION="${K3S_VERSION:-latest}"
NODE_ROLE="${NODE_ROLE:-server}"
DISABLE_FLAGS=""
[ "${DISABLE_TRAEFIK:-false}" = "true" ] && DISABLE_FLAGS="$DISABLE_FLAGS --disable traefik"
[ "${DISABLE_SERVICELB:-false}" = "true" ] && DISABLE_FLAGS="$DISABLE_FLAGS --disable servicelb"

log "Installing k3s ($NODE_ROLE node, version: $K3S_VERSION)..."

if [ "$NODE_ROLE" = "server" ]; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="$K3S_VERSION" sh -s - $DISABLE_FLAGS
  log "k3s server installed. Getting node token..."
  sleep 10
  NODE_TOKEN=$(cat /var/lib/rancher/k3s/server/node-token 2>/dev/null || echo "token-not-ready")
  log "Node token: $NODE_TOKEN"
  log "Kubeconfig: /etc/rancher/k3s/k3s.yaml"
else
  if [ -z "${SERVER_URL:-}" ] || [ -z "${NODE_TOKEN:-}" ]; then
    log "ERROR: SERVER_URL and NODE_TOKEN required for agent nodes"
    exit 1
  fi
  curl -sfL https://get.k3s.io | K3S_URL="$SERVER_URL" K3S_TOKEN="$NODE_TOKEN" sh -
fi

systemctl enable k3s --now
log "k3s installation complete."
kubectl get nodes 2>/dev/null || log "kubectl output unavailable (normal for agent nodes)"
