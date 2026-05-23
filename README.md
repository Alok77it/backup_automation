# Backup Intelligence

**AI-Powered Backup & Recovery Intelligence SaaS Platform**

Self-hosted platform to connect Linux servers over SSH, run backups (Restic, Rsync, Rclone, Borg), restore data with AI-assisted analysis, monitor infrastructure, and manage policies — on a single server with Docker Compose.

**Stack:** Next.js · FastAPI · PostgreSQL · Redis · Celery · Prometheus · Nginx · Docker Compose

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [URLs After Setup](#2-urls-after-setup)
3. [Using the Dashboard](#3-using-the-dashboard)
4. [Project Overview](#4-project-overview)
5. [Architecture](#5-architecture)
6. [Folder Structure](#6-folder-structure)
7. [Environment Variables](#7-environment-variables)
8. [Production Deployment](#8-production-deployment)
9. [Local Development](#9-local-development)
10. [Database, Redis & Migrations](#10-database-redis--migrations)
11. [Workers & Scheduled Tasks](#11-workers--scheduled-tasks)
12. [Nginx & SSL](#12-nginx--ssl)
13. [Backup Engines](#13-backup-engines)
14. [AI Layer](#14-ai-layer)
15. [Monitoring](#15-monitoring)
16. [Security & RBAC](#16-security--rbac)
17. [Troubleshooting](#17-troubleshooting)
18. [Commands Reference](#18-commands-reference)
19. [Deployment Checklist](#19-deployment-checklist)

---

## 1. Quick Start

### Prerequisites

- Docker & Docker Compose v2
- 4 GB+ RAM recommended
- Ports **80** (web), **8000** (API debug, optional), **9090** (Prometheus, optional)

### One-command deploy

**Windows (PowerShell):**

```powershell
cd "C:\path\to\main project"
.\deploy-production.ps1
```

**Linux / macOS / WSL:**

```bash
chmod +x deploy-production.sh
./deploy-production.sh
```

The script will:

- Create or update `.env` (secrets, DB password, host URL)
- Build Docker images
- Run database migrations
- Start all services (API, frontend, nginx, postgres, redis, worker, beat, prometheus)

### First login

1. Open **`http://YOUR_SERVER/signup`** (replace `YOUR_SERVER` with your machine IP, domain, or `localhost`)
2. Create account + organization
3. You are redirected to the **Dashboard**
4. Go to **Infrastructure** → add a Linux server → **Connect Server**
5. Go to **Backups** → **New Backup** → select **target server** → create job → run backup

---

## 2. URLs After Setup

Replace **`YOUR_SERVER`** with:

- **Same machine:** `localhost` or `127.0.0.1`
- **Remote VPS:** public IP (e.g. `203.0.113.10`) or domain (e.g. `backup.company.com`)
- **After SSL:** `https://yourdomain.com`

Default entry point is **port 80** via Nginx (not port 3000 in production).

### Auth pages (before login)

| Page | URL |
|------|-----|
| **Home / app** | `http://YOUR_SERVER` |
| **Login** | `http://YOUR_SERVER/login` |
| **Sign up** | `http://YOUR_SERVER/signup` |
| **Forgot password** | `http://YOUR_SERVER/forgot-password` |
| **Reset password** | `http://YOUR_SERVER/reset-password?token=...` |

### Dashboard pages (after login)

| Page | URL |
|------|-----|
| Dashboard | `http://YOUR_SERVER/dashboard` |
| Infrastructure (servers) | `http://YOUR_SERVER/infrastructure` |
| Backups | `http://YOUR_SERVER/backups` |
| Restore Center | `http://YOUR_SERVER/restore` |
| Monitoring | `http://YOUR_SERVER/monitoring` |
| AI Intelligence | `http://YOUR_SERVER/ai` |
| Logs | `http://YOUR_SERVER/logs` |
| Policies | `http://YOUR_SERVER/policies` |
| Alerts | `http://YOUR_SERVER/alerts` |
| Storage | `http://YOUR_SERVER/storage` |
| Organizations | `http://YOUR_SERVER/organizations` |
| Billing | `http://YOUR_SERVER/billing` |
| Settings | `http://YOUR_SERVER/settings` |

### API & health (for checks and integrations)

| Endpoint | URL |
|----------|-----|
| Health check | `http://YOUR_SERVER/api/health` |
| OpenAPI / Swagger | `http://YOUR_SERVER/api/docs` |
| Prometheus metrics (API) | `http://YOUR_SERVER/metrics` |
| API direct (debug, host port) | `http://YOUR_SERVER:8000/api/health` |

### Other services

| Service | URL |
|---------|-----|
| **Prometheus UI** | `http://YOUR_SERVER:9090` |

### Routing summary

```
http://YOUR_SERVER/          → Next.js UI (login, dashboard, all pages)
http://YOUR_SERVER/api/      → FastAPI backend
http://YOUR_SERVER:8000/     → API direct (optional, exposed in docker-compose)
http://YOUR_SERVER:9090/     → Prometheus
```

---

## 3. Using the Dashboard

### Infrastructure

1. Open **Infrastructure** → **Add Server**
2. Enter name, hostname/IP, port (22), username, SSH password
3. Click **Connect Server**
4. Use **Test** to verify SSH; **Metrics** to collect CPU/RAM/Disk

If a button fails, read the red error banner (e.g. CSRF, SSH, permissions).

### Backups

1. Open **Backups** → **New Backup**
2. Choose **Target server** (where source data lives)
3. Set backup type, engine (restic/rsync/rclone/borg), source paths, cron schedule
4. Click **Create Backup**, then **Run** (play icon) on a job

Backup storage on the host: Docker volume → `/data/backups/{org_id}/{backup_id}/`

### Restore Center

1. Select a **backup**
2. Choose **destination**:
   - **Same server** as backup source
   - **Different server** (dropdown)
   - **Custom path** only (no SSH target)
3. Set restore path → optional **AI Analysis** → **Start Restore**
4. Track jobs in **Restore Jobs** list

### Monitoring

- View fleet-wide averages or filter by **server**
- Click **Refresh**; collect metrics from Infrastructure first if charts are empty

### AI Intelligence

- Chat about failures, risks, restores, storage
- Status banner shows **anthropic** / **openai** when keys are loaded, or heuristic mode without keys
- Requires `ai:use` permission (Owner/Admin/Operator)

### If buttons do nothing or AI shows errors

1. **Sign out and sign in again** (refreshes CSRF token)
2. Rebuild frontend after code updates:

   ```bash
   docker compose build --no-cache frontend
   docker compose up -d --force-recreate frontend nginx
   ```

3. For AI keys: add to `.env` and `docker compose restart api worker`

---

## 4. Project Overview

| Feature | Description |
|---------|-------------|
| Infrastructure | SSH Linux servers, live CPU/RAM/Disk metrics |
| Backups | Restic, Rsync, Rclone, Borg; full/incremental/DB/Docker/path |
| Restore | AI analysis, confidence score, overwrite protection |
| AI | Claude or OpenAI (optional); heuristic fallback |
| Health engine | Health score, corruption risk, restore readiness |
| Alerts | In-app (+ email with SMTP) |
| RBAC | Owner, Admin, Operator, Viewer |

---

## 5. Architecture

```
                    ┌─────────────┐
                    │   Nginx :80 │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌──────────────┐
    │  Next.js   │  │  FastAPI   │  │  Prometheus  │
    │  :3000     │  │  :8000     │  │   :9090      │
    └────────────┘  └─────┬──────┘  └──────────────┘
                          │
         ┌────────────────┼────────────────┐
         ▼                ▼                ▼
  ┌────────────┐   ┌────────────┐   ┌────────────┐
  │ PostgreSQL │   │   Redis    │   │  backups   │
  │            │   │  + Celery  │   │  volume    │
  └────────────┘   └────────────┘   └────────────┘
```

- **Nginx** — single public entry; `/` → frontend, `/api/` → API
- **API** — auth, CRUD, AI, dashboard stats
- **Worker** — backup/restore jobs, SSH metrics
- **Beat** — scheduled backups and maintenance

---

## 6. Folder Structure

```
├── backend/
│   ├── app/api/          # REST routes
│   ├── app/core/         # Config, auth, RBAC, CSRF
│   ├── app/services/     # SSH, AI, backup engines
│   ├── app/workers/      # Celery tasks
│   └── alembic/          # Migrations
├── frontend/
│   └── src/app/          # Next.js pages (login, dashboard, …)
├── nginx/nginx.conf      # Reverse proxy (edit on host only)
├── prometheus/
├── docker-compose.yml
├── deploy-production.ps1
├── deploy-production.sh
└── .env.example
```

---

## 7. Environment Variables

Copy the example file:

```bash
cp .env.example .env
```

Or let `deploy-production.ps1` / `deploy-production.sh` generate `.env` for you.

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL URL (async driver in app; sync for Alembic in migrate container) |
| `JWT_SECRET` | JWT signing secret (32+ characters) |
| `ENCRYPTION_KEY` | Fernet key for encrypted SSH passwords/keys |

Generate secrets:

```bash
bash scripts/generate-secrets.sh
```

### Optional — AI

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude (preferred if both set) |
| `OPENAI_API_KEY` | GPT-4o |

Leave empty to use built-in heuristic AI (still works for chat and analysis).

### Other common variables

| Variable | Default / notes |
|----------|-----------------|
| `FRONTEND_URL` | `http://localhost` or your public URL |
| `CORS_ORIGINS` | Must include your browser origin |
| `BACKUP_STORAGE_PATH` | `/data/backups` in containers |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Used by postgres service |
| `SESSION_COOKIE_SECURE` | `true` when using HTTPS |

### Adding AI keys after deployment

1. Edit `.env` on the **host**:

   ```env
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

   or

   ```env
   OPENAI_API_KEY=sk-your-key-here
   ```

   Do not use quotes unless the value itself contains spaces. Empty values are treated as unset.

2. Restart API and worker:

   ```bash
   docker compose restart api worker
   ```

3. Open **AI Intelligence** — green banner should show `AI provider active: anthropic` (or `openai`).

4. Check status via API:

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        -H "X-Organization-Id: YOUR_ORG_ID" \
        http://YOUR_SERVER/api/ai/status
   ```

---

## 8. Production Deployment

### Deploy script options

```powershell
# Windows — custom public URL
$env:DEPLOY_HOST = "https://backup.yourcompany.com"
.\deploy-production.ps1

# Pass AI key for this run
$env:ANTHROPIC_API_KEY = "sk-ant-..."
.\deploy-production.ps1
```

```bash
# Linux — custom host
DEPLOY_HOST=https://backup.example.com ./deploy-production.sh

ANTHROPIC_API_KEY=sk-ant-... ./deploy-production.sh
```

**Auto-detected / preserved on re-run:**

| Item | Behavior |
|------|----------|
| `DEPLOY_HOST` / `FRONTEND_URL` | Machine IP, hostname, or env override |
| `JWT_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_PASSWORD` | Generated once, kept on re-run |
| AI keys | Read from env or existing `.env` |

### Manual deploy

```bash
docker compose up -d postgres redis
sleep 10
docker compose --profile migrate run --rm migrate
docker compose up -d
```

### Apply UI / code updates

```bash
docker compose build --no-cache api frontend
docker compose up -d --force-recreate api frontend nginx worker beat
```

### Nginx

- Config file: **`nginx/nginx.conf`** only (mounted into container)
- Upstreams must use Compose service names: `api:8000`, `frontend:3000`
- After editing: `docker compose up -d nginx --force-recreate`

---

## 9. Local Development

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

export DATABASE_URL=postgresql+asyncpg://backupintel:backupintel_secret@localhost:5432/backup_intelligence
export JWT_SECRET=dev-secret-change-in-production-32chars
export ENCRYPTION_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** (dev server proxies API or set `NEXT_PUBLIC_API_URL`).

### Workers (local)

```bash
cd backend
celery -A app.workers.celery_app worker --loglevel=info
celery -A app.workers.celery_app beat --loglevel=info
```

---

## 10. Database, Redis & Migrations

### PostgreSQL

```bash
docker exec -it bi-postgres psql -U backupintel -d backup_intelligence
```

Backup / restore:

```bash
docker exec bi-postgres pg_dump -U backupintel backup_intelligence > backup.sql
cat backup.sql | docker exec -i bi-postgres psql -U backupintel backup_intelligence
```

### Redis

```bash
docker exec -it bi-redis redis-cli ping
# PONG
```

### Migrations

```bash
docker compose --profile migrate run --rm migrate
```

New migration (development):

```bash
cd backend
alembic revision --autogenerate -m "description"
```

---

## 11. Workers & Scheduled Tasks

```bash
docker compose up -d worker beat
docker compose logs -f worker
```

| Task | Interval |
|------|----------|
| Collect server metrics | Every 5 min |
| Scheduled backups | Every 15 min |
| Health scores | Every 30 min |
| Storage analytics | Hourly |
| Alert checks | Every 10 min |

Scale workers:

```bash
docker compose up -d --scale worker=4
```

---

## 12. Nginx & SSL

### Nginx routes

| Path | Target |
|------|--------|
| `/` | Next.js frontend |
| `/api/` | FastAPI |
| `/metrics` | API Prometheus endpoint |
| `/_next/` | Next.js static assets |

### SSL (production)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

In `.env`:

```env
SESSION_COOKIE_SECURE=true
FRONTEND_URL=https://yourdomain.com
CORS_ORIGINS=https://yourdomain.com
```

---

## 13. Backup Engines

| Engine | Use case |
|--------|----------|
| **Restic** | Encrypted, deduplicated snapshots |
| **Rsync** | Fast file sync |
| **Rclone** | Cloud or remote sync |
| **Borg** | Deduplicated archives |

**Backup types:** `full`, `incremental`, `differential`, `snapshot`, `path`, `database`, `docker`

**Storage path (inside worker/API containers):** `/data/backups/{organization_id}/{backup_id}/`

---

## 14. AI Layer

**Provider priority:**

1. `ANTHROPIC_API_KEY` → Claude (`claude-sonnet-4-20250514`)
2. `OPENAI_API_KEY` → GPT-4o
3. Neither → heuristic engine (no external API)

**Features:**

- Chat with infrastructure context (`/api/ai/chat`)
- Provider status (`GET /api/ai/status`)
- Backup failure analysis
- Restore readiness summaries

**UI:** **AI Intelligence** page shows configured provider or heuristic mode.

---

## 15. Monitoring

- **Prometheus:** `http://YOUR_SERVER:9090`
- **Dashboard → Monitoring:** CPU, memory, disk charts (24h)
- **Per-server filter** in Monitoring UI
- Metrics collected via SSH from **Infrastructure → Metrics**

---

## 16. Security & RBAC

| Feature | Implementation |
|---------|----------------|
| Passwords | Argon2 |
| Sessions | JWT access + refresh tokens |
| SSH secrets | Fernet encryption at rest |
| CSRF | `csrf_token` cookie + `X-CSRF-Token` header on POST/PUT/DELETE |
| RBAC | Owner, Admin, Operator, Viewer |
| Rate limits | 200/min default; 10/min on auth routes |

### Roles

| Role | Typical access |
|------|----------------|
| Owner | Full access + billing |
| Admin | Servers, backups, policies, AI |
| Operator | Run backups/restores, AI |
| Viewer | Read-only |

### CSRF note

If **Add Server**, **Create Backup**, or **AI chat** fails with `CSRF validation failed`:

1. Sign out → sign in (refreshes token)
2. Ensure you use the app via **Nginx on port 80** (same origin for cookies)
3. Rebuild frontend if you updated the UI recently

---

## 17. Troubleshooting

### Logs

```bash
docker compose logs -f
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f frontend
docker compose logs -f nginx
```

### Health

```bash
curl http://localhost/api/health
docker compose ps
docker exec bi-redis redis-cli ping
```

### Common errors

| Symptom | Solution |
|---------|----------|
| Signup 500 / `relation "users" does not exist` | Run migrations: `docker compose --profile migrate run --rm migrate` |
| `bi-api` restart loop | `docker compose logs api --tail=100`; rebuild: `docker compose build --no-cache api && docker compose up -d api` |
| All pages 404 | Rebuild frontend + nginx: `docker compose build --no-cache frontend && docker compose up -d frontend nginx` |
| Buttons silent / no action | Sign out/in; check browser console; rebuild frontend; look for `CSRF validation failed` in API logs |
| `CSRF validation failed` | Re-login; use `http://YOUR_SERVER` not mixed IP/localhost |
| AI always says configure API key | Add key to `.env`, `docker compose restart api worker`; check `/api/ai/status` |
| `Invalid token` | Re-login; do not change `JWT_SECRET` after users exist |
| SSH connection failed | Check host, port 22, firewall, password; use **Test** on Infrastructure |
| Empty monitoring charts | Add server → **Metrics** on Infrastructure |
| Restore blocked | Set destination + path; disable overwrite if target must be overwritten |
| Nginx wrong backend | Edit only `nginx/nginx.conf`; upstreams `api:8000`, `frontend:3000` |
| Port 8000 refused | Normal if only using Nginx; use `http://YOUR_SERVER/api/health` |

---

## 18. Commands Reference

```bash
# Full deploy
./deploy-production.sh              # Linux / WSL
.\deploy-production.ps1             # Windows

# Lifecycle
docker compose up -d
docker compose down
docker compose ps

# Rebuild after code changes
docker compose build --no-cache api frontend
docker compose up -d --force-recreate api frontend nginx worker

# Migrations
docker compose --profile migrate run --rm migrate

# Restart after .env change
docker compose restart api worker

# AI keys only
docker compose restart api worker

# Shell / debug
docker exec -it bi-api bash
docker exec bi-worker ls -la /data/backups/

# Scale workers
docker compose up -d --scale worker=3

# Secrets
bash scripts/generate-secrets.sh
```

---

## 19. Deployment Checklist

- [ ] Docker and Compose installed
- [ ] Run `deploy-production.ps1` or `deploy-production.sh`
- [ ] Migrations succeeded (`docker compose --profile migrate run --rm migrate`)
- [ ] All containers healthy: `docker compose ps`
- [ ] `curl http://YOUR_SERVER/api/health` returns healthy
- [ ] Sign up at `/signup` and log in at `/login`
- [ ] Add server on **Infrastructure** and **Test** SSH
- [ ] Create backup with **target server** selected
- [ ] Run backup job; check **Logs** / **Backups** status
- [ ] Test **Restore Center** (analysis + job)
- [ ] Check **Monitoring** after collecting metrics
- [ ] Optional: set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, restart API
- [ ] Optional: SMTP for email alerts
- [ ] Optional: SSL + `SESSION_COOKIE_SECURE=true`
- [ ] Firewall: allow **80** / **443**; restrict **9090** if public
- [ ] Backup PostgreSQL volume and `/data/backups` regularly

---

## License

Proprietary — All rights reserved.

## Support

1. Check [URLs After Setup](#2-urls-after-setup) and [Troubleshooting](#17-troubleshooting)
2. Run `docker compose logs -f api` and reproduce the error
3. Note the exact message from the red banner in the UI (if shown)
