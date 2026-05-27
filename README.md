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

## Customer Docker Image Install

Use this when the customer server should run from Docker images instead of source code. Welcome is disabled in this mode.

The customer compose expects these images to already exist for the selected `IMAGE_NAMESPACE` and `IMAGE_TAG`:

```text
IMAGE_NAMESPACE/backup-automation-backend:IMAGE_TAG
IMAGE_NAMESPACE/backup-automation-frontend:IMAGE_TAG
IMAGE_NAMESPACE/backup-automation-prometheus:IMAGE_TAG
```

Copy only these files/folders to the customer server:

```text
/opt/backup_automation/
├── docker-compose.customer.yml
├── .env
└── nginx/
    └── nginx.conf
```

Create the folder:

```bash
sudo mkdir -p /opt/backup_automation/nginx
cd /opt/backup_automation
sudo mkdir -p /data/backups
```

Use the normal `.env` values, then add/update these image settings:

```env
IMAGE_NAMESPACE=aloktr2002
IMAGE_TAG=latest
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
IMAGE_NAMESPACE=aloktr2002
IMAGE_TAG=latest
```

Run the customer stack:

```bash
docker compose -f docker-compose.customer.yml pull
docker compose -f docker-compose.customer.yml up -d postgres redis
docker compose -f docker-compose.customer.yml --profile migrate run --rm migrate
docker compose -f docker-compose.customer.yml up -d
docker compose -f docker-compose.customer.yml ps
```

Open:

```text
/welcome -> /login
http://YOUR_SERVER_IP/login
http://YOUR_SERVER_IP/signup
```

## Update Existing Server

```bash
git pull
sudo mkdir -p /data/backups
docker compose up -d --build api worker beat frontend nginx
docker compose ps
```

Customer image mode update:

```bash
cd /opt/backup_automation
sudo mkdir -p /data/backups
docker compose -f docker-compose.customer.yml pull
docker compose -f docker-compose.customer.yml --profile migrate run --rm migrate
docker compose -f docker-compose.customer.yml up -d
docker compose -f docker-compose.customer.yml ps
```

For versioned releases, change only `.env`:

```env
IMAGE_TAG=v1.0.1
```

Then run the same customer image update commands.

## Useful Checks

```bash
docker compose logs --tail=100 api
docker compose logs --tail=100 worker
docker compose logs --tail=100 frontend
docker compose logs --tail=100 nginx
sudo find /data/backups -maxdepth 5 -type f | sort
```

## License

This project is proprietary software. Copying, modification, resale,
redistribution, reverse engineering, white-label use, third-party hosting, or
enterprise/commercial use is not allowed without written permission.

See `LICENSE` for full terms.
