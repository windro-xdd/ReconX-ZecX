#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Start backend (FastAPI via uvicorn) using venv if available
if [[ -x ".venv/bin/python" ]]; then
  .venv/bin/python -m uvicorn reconx.api.main:app --host 127.0.0.1 --port 8000 --reload &
else
  python3 -m uvicorn reconx.api.main:app --host 127.0.0.1 --port 8000 --reload &
fi

# Start frontend (Vite dev server)
( cd viz-recon-main && npm run dev ) &

wait
