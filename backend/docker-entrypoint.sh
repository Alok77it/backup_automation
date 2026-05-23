#!/bin/sh
set -e
echo "Validating application import..."
python -c "from app.main import app; print('Application import OK')"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
