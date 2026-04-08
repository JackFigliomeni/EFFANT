#!/bin/bash
set -e

python scripts/migrate.py

if [ "$SERVICE" = "worker" ]; then
  echo "Starting pipeline worker..."
  exec python pipeline/scheduler.py --interval 30 --batch 200
else
  echo "Starting API server..."
  exec uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 --log-level info
fi
