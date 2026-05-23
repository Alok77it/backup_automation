#!/usr/bin/env bash
# Backup Intelligence — full production deployment (Linux / macOS / WSL / Git Bash)
# Auto-detects host URL, generates secrets, preserves AI keys from env or .env
#
# Usage:
#   chmod +x deploy-production.sh && ./deploy-production.sh
#
# Optional overrides:
#   DEPLOY_HOST=https://backup.example.com ./deploy-production.sh
#   ANTHROPIC_API_KEY=sk-ant-... ./deploy-production.sh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "\n${CYAN}==>${NC} $1"; }
ok()   { echo -e "    ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "    ${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "    ${RED}[ERROR]${NC} $1"; exit 1; }

random_hex() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex "${1:-32}"
  else
    head -c "$1" /dev/urandom | xxd -p -c 256 | tr -d '\n' | head -c "$(( ${1:-32} * 2 ))"
  fi
}

fernet_key() {
  if command -v python3 &>/dev/null; then
    python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())' 2>/dev/null && return
  fi
  openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
}

get_env_from_file() {
  local name="$1" file="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^[[:space:]]*${name}[[:space:]]*=" "$file" 2>/dev/null | tail -1 | sed -E "s/^[^=]+=//" | sed -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

is_placeholder() {
  local v="${1,,}"
  [[ -z "$v" ]] && return 0
  [[ "$v" == *"change-this"* || "$v" == *"change_this"* || "$v" == *"your-"* || "$v" == *"min-32"* ]] && return 0
  return 1
}

detect_deploy_host() {
  if [[ -n "${DEPLOY_HOST:-}" ]]; then
    local h="${DEPLOY_HOST%/}"
    [[ "$h" =~ ^https?:// ]] || h="http://${h}"
    echo "$h"
    return
  fi

  local existing
  existing="$(get_env_from_file FRONTEND_URL .env 2>/dev/null || true)"
  if [[ -n "$existing" && "$existing" != http://localhost* && "$existing" != https://localhost* ]]; then
    echo "${existing%/}"
    return
  fi

  local ip=""
  if command -v hostname &>/dev/null; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [[ -z "$ip" ]] && command -v ip &>/dev/null; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' || true)"
  fi
  if [[ -n "$ip" && "$ip" != 127.* ]]; then
    echo "http://${ip}"
    return
  fi

  echo "http://localhost"
}

compose() {
  if docker compose version &>/dev/null; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  else
    err "Docker Compose not found"
  fi
}

wait_postgres() {
  step "Waiting for PostgreSQL to become healthy..."
  local i=0 max=120
  while [[ $i -lt $max ]]; do
    local st
    st="$(docker inspect --format '{{.State.Health.Status}}' bi-postgres 2>/dev/null || echo "starting")"
    if [[ "$st" == "healthy" ]]; then
      ok "PostgreSQL is healthy"
      return
    fi
    sleep 3
    i=$((i + 3))
    echo "    ... waiting (${i}s)"
  done
  err "PostgreSQL not healthy after ${max}s — run: docker compose logs postgres"
}

wait_api() {
  step "Waiting for API health check..."
  local i=0 max=180
  while [[ $i -lt $max ]]; do
    if curl -sf "http://localhost/api/health" &>/dev/null; then
      ok "API is healthy"
      return
    fi
    sleep 5
    i=$((i + 5))
    echo "    ... waiting (${i}s)"
  done
  warn "API health check timed out — check: docker compose logs api nginx"
}

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Backup Intelligence — Production Deployment             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"

step "Checking prerequisites"
command -v docker &>/dev/null || err "Docker not installed"
docker version &>/dev/null || err "Docker daemon not running"
ok "Docker is available"

ENV_FILE="${PROJECT_ROOT}/.env"
ENV_EXAMPLE="${PROJECT_ROOT}/.env.example"

declare -A EXISTING=()
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    EXISTING[$key]="$val"
  done < "$ENV_FILE"
  ok "Loaded existing .env"
fi

step "Auto-detecting environment"
DEPLOY_HOST_URL="$(detect_deploy_host)"
API_URL="${DEPLOY_HOST_URL}/api"
CORS_ORIGINS="${DEPLOY_HOST_URL},http://localhost,http://127.0.0.1"
SESSION_SECURE="false"
[[ "$DEPLOY_HOST_URL" == https://* ]] && SESSION_SECURE="true"

ok "Deploy host: ${DEPLOY_HOST_URL}"
ok "API URL:     ${API_URL}"

PG_USER="${EXISTING[POSTGRES_USER]:-backupintel}"
PG_DB="${EXISTING[POSTGRES_DB]:-backup_intelligence}"
PG_PASS="${EXISTING[POSTGRES_PASSWORD]:-}"
if is_placeholder "$PG_PASS"; then PG_PASS=""; fi
[[ -z "$PG_PASS" ]] && { PG_PASS="$(random_hex 24)"; ok "Generated POSTGRES_PASSWORD"; } || ok "Using existing POSTGRES_PASSWORD"

JWT_SECRET="${EXISTING[JWT_SECRET]:-}"
if is_placeholder "$JWT_SECRET"; then JWT_SECRET=""; fi
[[ -z "$JWT_SECRET" ]] && { JWT_SECRET="$(random_hex 32)"; ok "Generated JWT_SECRET"; } || ok "Using existing JWT_SECRET"

ENC_KEY="${EXISTING[ENCRYPTION_KEY]:-}"
if is_placeholder "$ENC_KEY"; then ENC_KEY=""; fi
[[ -z "$ENC_KEY" ]] && { ENC_KEY="$(fernet_key)"; ok "Generated ENCRYPTION_KEY"; } || ok "Using existing ENCRYPTION_KEY"

ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-${EXISTING[ANTHROPIC_API_KEY]:-}}"
OPENAI_KEY="${OPENAI_API_KEY:-${EXISTING[OPENAI_API_KEY]:-}}"
[[ -z "$ANTHROPIC_KEY" ]] && ANTHROPIC_KEY="$(get_env_from_file ANTHROPIC_API_KEY "$ENV_EXAMPLE" || true)"
[[ -z "$OPENAI_KEY" ]] && OPENAI_KEY="$(get_env_from_file OPENAI_API_KEY "$ENV_EXAMPLE" || true)"

if [[ -n "$ANTHROPIC_KEY" ]]; then ok "AI provider: Anthropic"
elif [[ -n "$OPENAI_KEY" ]]; then ok "AI provider: OpenAI"
else warn "No AI API key — heuristic AI mode"; fi

DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}"
SMTP_HOST="${EXISTING[SMTP_HOST]:-localhost}"
SMTP_PORT="${EXISTING[SMTP_PORT]:-25}"
SMTP_FROM="${EXISTING[SMTP_FROM]:-noreply@backup-intelligence.local}"

AI_DETECTED="none"
[[ -n "$ANTHROPIC_KEY" ]] && AI_DETECTED="anthropic"
[[ -n "$OPENAI_KEY" && "$AI_DETECTED" == "none" ]] && AI_DETECTED="openai"

step "Writing .env"
cat > "$ENV_FILE" <<EOF
# Auto-generated by deploy-production.sh on $(date -Iseconds 2>/dev/null || date)
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENC_KEY}
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
OPENAI_API_KEY=${OPENAI_KEY}
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/1
CELERY_RESULT_BACKEND=redis://redis:6379/2
BACKUP_STORAGE_PATH=/data/backups
FRONTEND_URL=${DEPLOY_HOST_URL}
API_URL=${API_URL}
CORS_ORIGINS=${CORS_ORIGINS}
POSTGRES_USER=${PG_USER}
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=${PG_DB}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_FROM=${SMTP_FROM}
SESSION_COOKIE_SECURE=${SESSION_SECURE}

# AI_PROVIDER_DETECTED=${AI_DETECTED}
EOF
ok "Wrote ${ENV_FILE}"

step "Building Docker images"
compose build --no-cache api frontend
compose build --parallel

step "Starting PostgreSQL and Redis"
compose up -d postgres redis
wait_postgres

step "Running database migrations"
compose --profile migrate run --rm migrate
ok "Migrations complete"

step "Starting all production services"
compose up -d --remove-orphans
ok "Services started"

wait_api

step "Deployment status"
compose ps

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              DEPLOYMENT COMPLETE                             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Web UI:        ${DEPLOY_HOST_URL}"
echo "  Sign up:       ${DEPLOY_HOST_URL}/signup"
echo "  API Docs:      ${DEPLOY_HOST_URL}/api/docs"
echo "  Prometheus:    http://localhost:9090"
echo "  AI Provider:   ${AI_DETECTED}"
echo ""
echo "  docker compose logs -f"
echo ""
