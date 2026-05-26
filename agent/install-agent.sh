#!/bin/bash
# DevOps Control Plane — Server Agent Installer
# Run as root on the target server:
#   curl -fsSL https://your-control-plane/agent/install-agent.sh | AGENT_TOKEN=xxx bash
set -euo pipefail

AGENT_DIR="/opt/devops-agent"
AGENT_PORT="${AGENT_PORT:-9977}"
AGENT_TOKEN="${AGENT_TOKEN:-}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-}"
AGENT_VERSION="${AGENT_VERSION:-latest}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

log() { echo "[AGENT-INSTALL] $*"; }
err() { echo "[AGENT-INSTALL] ERROR: $*" >&2; exit 1; }

[ -z "$AGENT_TOKEN" ] && err "AGENT_TOKEN is required. Get it from the Control Plane dashboard."

log "Installing DevOps Agent to $AGENT_DIR..."

# ── Python check ────────────────────────────────────────────────────
if ! command -v "$PYTHON_BIN" &>/dev/null; then
  log "Python3 not found — installing..."
  if command -v apt-get &>/dev/null; then
    apt-get update -qq && apt-get install -y -qq python3 python3-pip
  elif command -v yum &>/dev/null; then
    yum install -y python3 python3-pip
  else
    err "Cannot install Python3 — install it manually and re-run"
  fi
fi

PYTHON_VER=$($PYTHON_BIN --version 2>&1)
log "Python: $PYTHON_VER"

# ── Create directory ────────────────────────────────────────────────
mkdir -p "$AGENT_DIR"
cd "$AGENT_DIR"

# ── Download agent files ────────────────────────────────────────────
if [ -n "$CONTROL_PLANE_URL" ]; then
  curl -fsSL "${CONTROL_PLANE_URL}/agent/agent.py"           -o agent.py
  curl -fsSL "${CONTROL_PLANE_URL}/agent/requirements.txt"   -o requirements.txt
else
  log "CONTROL_PLANE_URL not set — assuming files already present in $AGENT_DIR"
fi

# ── Install dependencies ────────────────────────────────────────────
$PYTHON_BIN -m pip install --quiet -r requirements.txt

# ── Write .env ──────────────────────────────────────────────────────
cat > .env <<EOF
AGENT_TOKEN=${AGENT_TOKEN}
AGENT_PORT=${AGENT_PORT}
AGENT_LOG_PATH=/var/log/devops-agent.log
EOF
chmod 600 .env
log "Wrote .env (token secured, mode 600)"

# ── Install systemd service ─────────────────────────────────────────
if [ -f agent.service ]; then
  cp agent.service /etc/systemd/system/devops-agent.service
  systemctl daemon-reload
  systemctl enable devops-agent --now
  log "Systemd service installed and started"
else
  log "agent.service not found — starting manually:"
  log "  cd $AGENT_DIR && AGENT_TOKEN=xxx python3 agent.py"
fi

# ── Firewall ────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  log "Opening port $AGENT_PORT in ufw..."
  ufw allow "$AGENT_PORT/tcp" comment "DevOps Agent" 2>/dev/null || true
fi

log "Agent installed. Verify:"
log "  curl http://localhost:${AGENT_PORT}/v1/health"
