#!/bin/bash
# n8n installation via Docker Compose
# Variables injected by the plugin manager via env
set -euo pipefail

log() { echo "[N8N-INSTALL] $*"; }

INSTALL_PATH="${INSTALL_PATH:-/opt/n8n}"
N8N_PORT="${N8N_PORT:-5678}"

log "Install path: $INSTALL_PATH"
log "Port: $N8N_PORT"

# Require Docker
if ! command -v docker &>/dev/null; then
  log "ERROR: Docker not found. Install the Docker plugin first."
  exit 1
fi

# Create directories
mkdir -p "$INSTALL_PATH/data"
chmod 700 "$INSTALL_PATH/data"

# Copy composed docker-compose.yml (rendered by plugin manager, passed as env)
if [ -z "${COMPOSE_CONTENT:-}" ]; then
  log "ERROR: COMPOSE_CONTENT env var not set — plugin manager must inject it"
  exit 1
fi

echo "$COMPOSE_CONTENT" > "$INSTALL_PATH/docker-compose.yml"
log "Wrote docker-compose.yml"

# Pull images
cd "$INSTALL_PATH"
docker compose pull --quiet
log "Images pulled"

# Start n8n
docker compose up -d
log "n8n containers started"

# Wait for health
log "Waiting for n8n to become healthy..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${N8N_PORT}/healthz" &>/dev/null; then
    log "n8n is healthy after ${i}x tries"
    break
  fi
  sleep 2
done

# Final check
if ! docker compose ps | grep -q "Up"; then
  log "ERROR: n8n failed to start"
  docker compose logs --tail=50
  exit 1
fi

log "n8n installation complete. Access at http://localhost:${N8N_PORT}"
