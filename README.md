# Backup Automation

## Server Setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw rsync
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo apt install -y docker-compose-plugin
sudo mkdir -p /data/backups
exit
```

SSH login again after `exit`.

## Clone

Normal clone:

```bash
git clone REPO_URL backup_automation
cd backup_automation
```

Clone without `.env` and `README.md`:

```bash
git clone --no-checkout REPO_URL backup_automation
cd backup_automation
git sparse-checkout init --no-cone
git sparse-checkout set "/*" "!/.env" "!/README.md"
git checkout main
```

## Environment

```bash
cp .env.example .env
nano .env
```

Generate secrets:

```bash
echo "JWT_SECRET=$(openssl rand -hex 64)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
```

Required `.env` basics:

```env
JWT_SECRET=PASTE_HEX_SECRET
ENCRYPTION_KEY=PASTE_BASE64_KEY
POSTGRES_USER=backupintel
POSTGRES_PASSWORD=CHANGE_THIS_PASSWORD
POSTGRES_DB=backup_intelligence
BACKUP_STORAGE_PATH=/data/backups
FRONTEND_URL=http://YOUR_SERVER_IP
API_URL=http://YOUR_SERVER_IP/api
CORS_ORIGINS=http://YOUR_SERVER_IP
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

## Run With Welcome Enabled

```bash
docker compose up -d --build postgres redis
docker compose --profile migrate run --rm migrate
docker compose up -d --build
docker compose ps
```

Open:

```text
http://YOUR_SERVER_IP/welcome
http://YOUR_SERVER_IP/login
http://YOUR_SERVER_IP/signup
```

## Build And Push Customer Images

Use this from the private source checkout. The customer images are built with welcome disabled.

Make sure Docker Desktop is running, then verify Docker can reach the engine:

```powershell
docker context use desktop-linux
docker info
```

Build and push the latest public Docker Hub images:

```powershell
.\scripts\build-push-release.ps1 -Namespace aloktr2002 -Tag latest
```

For a customer release, prefer version tags:

```powershell
.\scripts\build-push-release.ps1 -Namespace aloktr2002 -Tag v1.0.0
```

Published images:

```text
https://hub.docker.com/r/aloktr2002/backup-automation-backend
https://hub.docker.com/r/aloktr2002/backup-automation-frontend
https://hub.docker.com/r/aloktr2002/backup-automation-nginx
https://hub.docker.com/r/aloktr2002/backup-automation-prometheus
```

## Customer Install Without Source Code

Use this for customer/on-prem installs:

```bash
mkdir -p backup_automation
cd backup_automation
```

Copy only these files to the customer server:

```text
docker-compose.customer.yml
.env
```

Create `.env` from `.env.customer.example`, then edit it:

```bash
cp .env.customer.example .env
nano .env
```

Required customer `.env` image settings:

```env
IMAGE_NAMESPACE=aloktr2002
IMAGE_TAG=v1.0.0
```

Run database, Redis, and migrations:

```bash
sudo mkdir -p /data/backups
docker compose -f docker-compose.customer.yml pull
docker compose -f docker-compose.customer.yml up -d postgres redis
docker compose -f docker-compose.customer.yml --profile migrate run --rm migrate
docker compose -f docker-compose.customer.yml up -d
docker compose -f docker-compose.customer.yml ps
```

Run migrations manually at any time:

```bash
docker compose -f docker-compose.customer.yml --profile migrate run --rm migrate
```

In this mode:

```text
/welcome -> /login
/login works
/signup works
```

## Update Existing Server

```bash
git pull
sudo mkdir -p /data/backups
docker compose up -d --build api worker beat frontend nginx
docker compose ps
```

Customer mode update:

For a new release, first update `.env`:

```env
IMAGE_NAMESPACE=aloktr2002
IMAGE_TAG=v1.0.1
```

Then pull the new images, run migrations, and restart services:

```bash
sudo mkdir -p /data/backups
docker compose -f docker-compose.customer.yml pull
docker compose -f docker-compose.customer.yml --profile migrate run --rm migrate
docker compose -f docker-compose.customer.yml up -d
docker compose -f docker-compose.customer.yml ps
```

If using `IMAGE_TAG=latest`, keep the same `.env` and run the same update commands after pushing new latest images.

Rollback to an older image tag:

```env
IMAGE_TAG=v1.0.0
```

```bash
docker compose -f docker-compose.customer.yml pull
docker compose -f docker-compose.customer.yml up -d
docker compose -f docker-compose.customer.yml ps
```

Take a database backup before production updates. Database migrations usually move forward and are not automatically rolled back by changing the image tag.

## Useful Checks

```bash
docker compose logs --tail=100 api
docker compose logs --tail=100 worker
docker compose logs --tail=100 frontend
docker compose logs --tail=100 nginx
sudo find /data/backups -maxdepth 5 -type f | sort
```
