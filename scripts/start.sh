#!/bin/bash
set -e

echo "=== Backup Intelligence Platform ==="

if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "IMPORTANT: Edit .env and set JWT_SECRET and ENCRYPTION_KEY before production use."
fi

echo "Starting services..."
docker compose up -d postgres redis

echo "Waiting for PostgreSQL..."
sleep 10

echo "Running migrations..."
docker compose --profile migrate run --rm migrate

echo "Starting all services..."
docker compose up -d

echo ""
echo "Platform is starting!"
echo "  Web UI:     http://localhost"
echo "  API Docs:   http://localhost/api/docs"
echo "  Prometheus: http://localhost:9090"
echo ""
echo "Run 'docker compose logs -f' to view logs."
