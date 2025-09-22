# Deploying ReconX

This project has a FastAPI backend and a Vite React frontend.

## Local run

Backend (SQLite fallback):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m uvicorn reconx.api.main:app --host 0.0.0.0 --port 8000
```

Frontend (dev):

```powershell
cd viz-recon-main
npm install
npm run dev
```

Visit http://localhost:8080 (or the port Vite picks) and it will proxy `/api` to `http://localhost:8000`.

## Deploy backend (Render)

Render can build from this repo using the Dockerfile. Add the service from `render.yaml`:

1. Push this repo to GitHub.
2. In Render dashboard, "New +" → "Blueprint" and point to your repo.
3. Set environment variables as needed:
   - `PORT` (Render sets this automatically; we map it in `render.yaml`).
   - Optionally `DATABASE_URL` to use Postgres; otherwise SQLite file in container.
4. Deploy; health check at `/healthz` should return 200.

## Deploy backend (Fly.io)

Install Fly CLI and deploy with the provided `fly.toml`:

```powershell
flyctl launch --no-deploy
flyctl secrets set PYTHONUNBUFFERED=1
flyctl deploy
```

The app listens on `$PORT` (configured as 8080). Make sure the Docker `CMD` reads it. For Fly, set `PORT=8080` and start uvicorn on that port.

## Deploy frontend (Vercel)

The frontend can be deployed standalone. In `viz-recon-main/vercel.json`, set `VITE_API_BASE_URL` to your backend URL (Render or Fly). Then:

```powershell
cd viz-recon-main
vercel deploy --prod
```

Alternatively, deploy to Netlify or Cloudflare Pages; set `VITE_API_BASE_URL` accordingly.

## Notes

- For persistent storage, prefer Postgres (Render Postgres, Fly Postgres) and set `DATABASE_URL` (asyncpg driver). The code falls back to SQLite if not set.
- CORS is `*` by default; restrict with `CORS_ORIGINS` if needed.
- The `/api` routes provide JSON; the UI proxies to the backend in dev and uses `VITE_API_BASE_URL` in production.
