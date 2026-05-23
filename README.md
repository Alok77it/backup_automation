# Backup Intelligence

**AI-Powered Backup & Recovery Intelligence SaaS Platform**

Enterprise-grade platform for connecting servers, creating backups, restoring data, monitoring infrastructure, managing policies, and using AI for infrastructure troubleshooting — fully self-hosted on a single server.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Folder Structure](#3-folder-structure)
4. [Environment Variables](#4-environment-variables)
5. [Local Development Setup](#5-local-development-setup)
6. [Production Deployment](#6-production-deployment)
7. [Docker Installation](#7-docker-installation)
8. [PostgreSQL Setup](#8-postgresql-setup)
9. [Redis Setup](#9-redis-setup)
10. [Running Migrations](#10-running-migrations)
11. [Starting Workers](#11-starting-workers)
12. [Starting Frontend & Backend](#12-starting-frontend--backend)
13. [Nginx Setup](#13-nginx-setup)
14. [SSL Setup](#14-ssl-setup)
15. [Backup Engines](#15-backup-engines)
16. [AI Layer](#16-ai-layer)
17. [Monitoring](#17-monitoring)
18. [Security](#18-security)
19. [Scaling Guide](#19-scaling-guide)
20. [Troubleshooting](#20-troubleshooting)
21. [Common Errors](#21-common-errors)
22. [Health Checks](#22-health-checks)
23. [Logs Management](#23-logs-management)
24. [Restore Testing](#24-restore-testing)
25. [Upgrade Instructions](#25-upgrade-instructions)
26. [Commands Reference](#26-commands-reference)
27. [Deployment Checklist](#27-deployment-checklist)

---

## 1. Project Overview

Backup Intelligence is a multi-tenant SaaS platform that provides:

- **Infrastructure management** — SSH-connected Linux servers with live CPU/RAM/Disk/IO metrics
- **Backup orchestration** — Restic, Rsync, Rclone, BorgBackup engines
- **Database backups** — PostgreSQL, MySQL, MongoDB, Redis
- **Docker backups** — Container export and volume backup
- **Restore Center** — AI-analyzed restore with confidence scoring
- **AI Intelligence** — Claude/OpenAI-powered assistant (optional API keys)
- **Health Engine** — Backup health score, corruption probability, risk levels
- **Alerts** — In-app and email notifications
- **RBAC** — Owner, Admin, Operator, Viewer roles

**Stack:** Next.js · FastAPI · PostgreSQL · Redis · Celery · Prometheus · Nginx · Docker Compose

---

## 2. Architecture

```
                    ┌─────────────┐
                    │   Nginx :80 │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌──────────────┐
    │  Next.js   │  │  FastAPI   │  │  Prometheus  │
    │  Frontend  │  │    API     │  │   :9090      │
    └────────────┘  └─────┬──────┘  └──────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
  ┌────────────┐   ┌────────────┐   ┌────────────┐
  │ PostgreSQL │   │   Redis    │   │  /data/    │
  │            │   │  + Celery  │   │  backups   │
  └────────────┘   └────────────┘   └────────────┘
```

- **API** handles auth, CRUD, AI requests
- **Celery workers** execute backups, restores, metric collection
- **Celery beat** runs scheduled backups and maintenance
- **Backup tools** run inside worker containers (restic, rsync, rclone, borg)

---

## 3. Folder Structure

```
├── backend/
│   ├── app/
│   │   ├── api/           # REST routes
│   │   ├── core/          # Config, auth, RBAC, DB
│   │   ├── models/        # SQLAlchemy entities
│   │   ├── schemas/       # Pydantic models
│   │   ├── services/      # Business logic
│   │   └── workers/       # Celery tasks
│   ├── alembic/           # DB migrations
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/           # Next.js pages
│   │   ├── components/    # UI components
│   │   └── lib/           # API client, utils
│   └── Dockerfile
├── nginx/                 # Reverse proxy config
├── prometheus/            # Metrics config
├── scripts/               # Startup helpers
├── docker-compose.yml
└── .env.example
```

---

## 4. Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for JWT signing (min 32 chars) |
| `ENCRYPTION_KEY` | Fernet key for credential encryption |

Generate secrets:

```bash
bash scripts/generate-secrets.sh
```

### Optional (AI)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API — auto-detected first |
| `OPENAI_API_KEY` | OpenAI API — used if Anthropic not set |

Without AI keys, heuristic analysis still works. You can deploy first and add keys later (see below).

### Adding AI keys after deployment

You do **not** need an API key to deploy. Run `deploy-production.ps1` or `deploy-production.sh` first; the platform works fully with built-in heuristic AI until you add a key.

When you are ready:

1. Open `.env` in the project root and set **one** of:

   ```env
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

   or

   ```env
   OPENAI_API_KEY=sk-your-key-here
   ```

   If both are set, Anthropic is used first.

2. Restart services so the API reloads environment variables (you do **not** need to re-run the deploy script):

   ```bash
   docker compose restart api
   ```

   Or restart the full stack:

   ```bash
   docker compose restart
   ```

3. Confirm in the UI: open **AI Intelligence** and send a message — responses should use Claude or OpenAI instead of the basic heuristic mode.

**Important:** Edit `.env` on the host and restart containers. Do not only change variables inside a running container; Docker Compose reads `.env` when containers start or restart.

---

## 5. Local Development Setup

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for frontend dev)
- Python 3.12+ (for backend dev)

### Backend (local)

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

export DATABASE_URL=postgresql+asyncpg://backupintel:backupintel_secret@localhost:5432/backup_intelligence
export JWT_SECRET=dev-secret-change-in-production-32chars
export ENCRYPTION_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### Frontend (local)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

### Workers (local)

```bash
cd backend
celery -A app.workers.celery_app worker --loglevel=info
celery -A app.workers.celery_app beat --loglevel=info
```

---

## 6. Production Deployment

### One-command deploy (recommended)

The deployment script auto-detects everything: host URL, Docker, secrets, AI keys from your environment, builds images, migrates the DB, and starts the full stack.

**Windows (PowerShell):**

```powershell
cd "C:\path\to\main project"
.\deploy-production.ps1
```

**Linux / macOS / WSL / Git Bash:**

```bash
chmod +x deploy-production.sh
./deploy-production.sh
```

**Optional overrides (detected automatically if omitted):**

```powershell
# Custom public URL (HTTPS production)
$env:DEPLOY_HOST = "https://backup.yourcompany.com"
.\deploy-production.ps1
```

```bash
# Pass AI key for this run only
ANTHROPIC_API_KEY=sk-ant-your-key ./deploy-production.sh

# Custom host
DEPLOY_HOST=https://backup.example.com ./deploy-production.sh
```

**What the script auto-detects / generates:**

| Variable | Behavior |
|----------|----------|
| `DEPLOY_HOST` / `FRONTEND_URL` | Machine IP, hostname, or `DEPLOY_HOST` env |
| `JWT_SECRET` | Generated once, preserved on re-run |
| `ENCRYPTION_KEY` | Fernet key generated once, preserved on re-run |
| `POSTGRES_PASSWORD` | Generated once, preserved on re-run |
| `ANTHROPIC_API_KEY` | From `$env:ANTHROPIC_API_KEY` / `.env` / `.env.example` |
| `OPENAI_API_KEY` | From `$env:OPENAI_API_KEY` / `.env` / `.env.example` |
| `DATABASE_URL`, Redis, Celery, CORS | Wired for Docker Compose automatically |

Access after deploy:
- **Web UI:** URL printed at end of script (e.g. `http://<your-ip>`)
- **API Docs:** `<host>/api/docs`
- **Prometheus:** http://localhost:9090

AI API keys are optional at deploy time. Add them later in `.env` and run `docker compose restart api` — see [Adding AI keys after deployment](#adding-ai-keys-after-deployment).

### Manual deploy (alternative)

```bash
docker compose up -d postgres redis
sleep 10
docker compose --profile migrate run --rm migrate
docker compose up -d
```

---

## 7. Docker Installation

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

### Verify

```bash
docker --version
docker compose version
```

---

## 8. PostgreSQL Setup

PostgreSQL runs in Docker via `docker-compose.yml`. Data persists in `postgres_data` volume.

### Manual connection

```bash
docker exec -it bi-postgres psql -U backupintel -d backup_intelligence
```

### Backup database

```bash
docker exec bi-postgres pg_dump -U backupintel backup_intelligence > backup.sql
```

### Restore database

```bash
cat backup.sql | docker exec -i bi-postgres psql -U backupintel backup_intelligence
```

---

## 9. Redis Setup

Redis runs in Docker on port 6379 (internal). Used for:

- Celery broker (DB 1)
- Celery results (DB 2)
- Caching (DB 0)

```bash
docker exec -it bi-redis redis-cli ping
# PONG
```

---

## 10. Running Migrations

```bash
# Via Docker
docker compose --profile migrate run --rm migrate

# Local
cd backend
alembic upgrade head

# Create new migration
alembic revision --autogenerate -m "description"
```

---

## 11. Starting Workers

Workers are started automatically via Docker Compose:

```bash
docker compose up -d worker beat
docker compose logs -f worker
docker compose logs -f beat
```

### Scheduled tasks

| Task | Interval |
|------|----------|
| Collect metrics | Every 5 min |
| Scheduled backups | Every 15 min |
| Health scores | Every 30 min |
| Storage analytics | Hourly |
| Alert checks | Every 10 min |

---

## 12. Starting Frontend & Backend

```bash
# All services
docker compose up -d

# Individual
docker compose up -d api
docker compose up -d frontend
docker compose restart api
```

---

## 13. Nginx Setup

Nginx proxies:
- `/` → Next.js frontend (port 3000)
- `/api/` → FastAPI (port 8000)
- `/metrics` → Prometheus metrics endpoint

Config: `nginx/nginx.conf`

```bash
docker compose restart nginx
docker compose logs nginx
```

---

## 14. SSL Setup

Use Certbot with Nginx on the host, or add SSL termination:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

Update `nginx/nginx.conf` to listen on 443 with certificates, and set in `.env`:

```
SESSION_COOKIE_SECURE=true
```

---

## 15. Backup Engines

| Engine | Use Case | Command |
|--------|----------|---------|
| **Restic** | Encrypted deduplicated backups | `restic backup` |
| **Rsync** | Fast file sync | `rsync -az` |
| **Rclone** | Cloud/local sync | `rclone sync` |
| **Borg** | Deduplicated archives | `borg create` |

### Backup types

- `full`, `incremental`, `differential`, `snapshot`, `path`
- `database` — pg_dump, mysqldump, mongodump, redis-cli
- `docker` — docker export + volume tar

Storage path: `/data/backups/{org_id}/{backup_id}/`

---

## 16. AI Layer

Auto-detects provider:

1. `ANTHROPIC_API_KEY` → Claude (claude-sonnet-4-20250514)
2. `OPENAI_API_KEY` → GPT-4o
3. Neither → Heuristic analysis engine

To enable Claude or OpenAI after install, add the key to `.env` and run `docker compose restart api`. See [Adding AI keys after deployment](#adding-ai-keys-after-deployment).

### Capabilities

- Chat assistant with infrastructure context
- Backup failure analysis
- Restore readiness prediction
- Log summarization
- Storage/retention recommendations

---

## 17. Monitoring

- **Prometheus** scrapes `/metrics` from API
- **Metric snapshots** collected via SSH every 5 minutes
- **Dashboard** shows CPU, RAM, Disk, throughput charts

```bash
# View Prometheus
open http://localhost:9090
```

---

## 18. Security

| Feature | Implementation |
|---------|----------------|
| Password hashing | Argon2 |
| JWT auth | Access + refresh tokens |
| Credential storage | Fernet encryption |
| CSRF | Cookie + X-CSRF-Token header |
| RBAC | 4 roles with permission matrix |
| Rate limiting | slowapi (200/min default, 10/min auth) |
| Security headers | X-Frame-Options, HSTS, etc. |
| Audit logs | All sensitive actions logged |

### Roles

| Role | Permissions |
|------|-------------|
| Owner | Full access + billing |
| Admin | Manage org, servers, backups |
| Operator | Run backups/restores |
| Viewer | Read-only |

---

## 19. Scaling Guide

### Horizontal

```yaml
# docker-compose.yml — scale workers
docker compose up -d --scale worker=4
```

### Vertical

Increase worker concurrency:

```bash
celery -A app.workers.celery_app worker --concurrency=8
```

### Database

- Add connection pooling (already configured, pool_size=20)
- Consider read replicas for analytics queries

### Storage

- Mount larger volume at `/data/backups`
- Add NFS/SAN mount for backup storage path

---

## 20. Troubleshooting

```bash
# View all logs
docker compose logs -f

# API logs
docker compose logs -f api

# Worker logs
docker compose logs -f worker

# Database connectivity
docker exec bi-api curl -f http://localhost:8000/api/health

# Redis
docker exec bi-redis redis-cli ping
```

---

## 21. Common Errors

| Error | Solution |
|-------|----------|
| `Connection refused` to postgres | Wait for healthcheck: `docker compose ps` |
| `bi-api` Restarting loop | Run `docker compose logs api --tail=100` — usually a Python import/syntax error; rebuild: `docker compose build --no-cache api && docker compose up -d api` |
| All pages show 404 | API may be down; rebuild frontend: `docker compose build --no-cache frontend && docker compose up -d frontend nginx` |
| `Invalid token` | Re-login; check JWT_SECRET hasn't changed |
| `CSRF validation failed` | Ensure csrf_token cookie + X-CSRF-Token header sent |
| `Restic init failed` | Check BACKUP_STORAGE_PATH is writable |
| `SSH connection failed` | Verify hostname, port, credentials; test via UI |
| Migration errors | Run `docker compose --profile migrate run --rm migrate` |

---

## 22. Health Checks

| Endpoint | Expected |
|----------|----------|
| `GET /api/health` | `{"status": "healthy"}` |
| `GET /metrics` | Prometheus format metrics |
| PostgreSQL | `pg_isready` in container |
| Redis | `redis-cli ping` → PONG |

```bash
curl http://localhost/api/health
```

---

## 23. Logs Management

- **Application logs:** `docker compose logs`
- **Centralized logs:** Platform Logs page (backup, restore, infrastructure, AI, audit)
- **AI summarization:** POST `/api/logs/summarize`

Log retention is managed via PostgreSQL; configure cleanup cron as needed.

---

## 24. Restore Testing

1. Go to **Restore Center**
2. Select a backup
3. Click **AI Analysis** — review confidence score and risks
4. Set target path
5. Click **Start Restore**
6. Monitor job status in Restore Jobs list

Overwrite protection prevents restoring to non-empty directories.

---

## 25. Upgrade Instructions

```bash
git pull origin main
docker compose build
docker compose --profile migrate run --rm migrate
docker compose up -d
```

---

## 26. Commands Reference

```bash
# Full production deploy (auto .env + build + migrate + start)
./deploy-production.sh          # Linux / WSL / Git Bash
.\deploy-production.ps1         # Windows PowerShell

# Start
docker compose up -d

# Stop
docker compose down

# Rebuild
docker compose build --no-cache

# Migrations
docker compose --profile migrate run --rm migrate

# Shell into API
docker exec -it bi-api bash

# Create user (via UI signup at /signup)

# View backup storage
docker exec bi-worker ls -la /data/backups/

# Scale workers
docker compose up -d --scale worker=3

# Generate secrets
bash scripts/generate-secrets.sh
```

---

## 27. Deployment Checklist

- [ ] Set strong `JWT_SECRET` and `ENCRYPTION_KEY`
- [ ] Configure `.env` with production values
- [ ] Run database migrations
- [ ] Verify all containers healthy: `docker compose ps`
- [ ] Test signup/login flow
- [ ] Add at least one server and test SSH connection
- [ ] Create and run a test backup
- [ ] Run restore analysis
- [ ] Configure SMTP for email alerts (optional)
- [ ] Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (optional)
- [ ] Enable SSL with Certbot
- [ ] Set `SESSION_COOKIE_SECURE=true`
- [ ] Configure firewall (allow 80, 443; restrict 9090)
- [ ] Set up backup of PostgreSQL and `/data/backups`
- [ ] Verify Prometheus scraping
- [ ] Test alert generation

---

## License

Proprietary — All rights reserved.

## Support

For issues, check logs with `docker compose logs -f` and refer to the troubleshooting section above.
