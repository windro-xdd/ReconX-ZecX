# ReconX

Lightweight reconnaissance toolkit (FastAPI + Typer + React).

## Quickstart (dev)

1. Start Postgres and API

    ```powershell
    python -m venv .venv; .\.venv\Scripts\Activate.ps1
    pip install -e .
    $env:DB_HOST="localhost"; $env:DB_PORT="5432"; $env:DB_USER="postgres"; $env:DB_PASSWORD="postgres"; $env:DB_NAME="reconx"
    uvicorn reconx.api.main:app --reload
    ```

2. DB migrate

    ```powershell
    alembic upgrade head
    ```

3. UI (optional)

    ```powershell
    cd reconx\ui
    npm install
    npm run dev
    ```

    Open http://localhost:5173 (set backend base to http://localhost:8000).

## Deployment

### Backend (Render quick start)
1. Push this repo to GitHub.
2. In Render, create a New Web Service → Select your repo → Environment: Docker.
3. Keep default build; set Environment Variables as needed:
  - `PORT`: Render injects a port; leave default or set explicitly.
  - `DATABASE_URL`: Optional (use Postgres in production). For demo, SQLite is embedded.
4. Deploy. Health check is `GET /healthz`.

Render YAML is provided in `render.yaml` for Infrastructure as Code.

### Backend (Fly.io quick start)
1. Install Fly CLI and run:
  ```bash
  fly launch --no-deploy
  fly deploy
  ```
2. Health checks are configured in `fly.toml` (`/healthz`).

### Frontend (Vercel)
1. Import the `viz-recon-main` folder as a new project on Vercel.
2. Build settings: Framework = Other, Build Command = `npm run build`, Output Directory = `dist`.
3. Set Project Environment Variable:
  - `VITE_API_BASE_URL`: your backend base URL (e.g., `https://<your-api>.onrender.com`).
4. Deploy. The SPA route fallback is configured in `vercel.json`.

### Wiring the URLs
- After backend deploy, copy its public base (e.g., `https://reconx-api.onrender.com`).
- In Vercel Project → Settings → Environment Variables, set `VITE_API_BASE_URL` to that base.
- In dev, you can override via PowerShell:
  ```powershell
  cd viz-recon-main
  $env:VITE_API_BASE_URL="https://reconx-api.onrender.com"; npm run dev
  ```

### Favicon cache busting
Browsers cache favicons aggressively. After replacing icons, add a version query or do a hard refresh:
```html
<link rel="icon" type="image/png" href="/reconx-logo.png?v=1" sizes="192x192" />
```
Or in dev: use Ctrl+F5 / clear cache.

### Local Dev
- UI: `cd reconx/ui && npm install && npm run dev`
- Backend: `python -m uvicorn reconx.api.main:app --host 0.0.0.0 --port 8000`

### Notes
- For full-stack hosting, deploy backend first, then set the UI's `VITE_API_BASE_URL` to the backend's public URL.
- Free hosting: Vercel (UI), Render/Railway (API)
- SQLite is fine for demo, but use Postgres for production.

## Internal REST API

- Definition: "Internal" means the API is intended to be used by your own tools and UI rather than exposed publicly to the internet unauthenticated. In dev it runs locally; in deployments, protect it (VPN, IP allowlist, auth gateway) if you expose it.

- Base URL: `/api`

- Health/metrics:
  - `GET /healthz` → `{ ok: true, db: "..." }`
  - `GET /api/metrics` → job/finding counters

- Jobs:
  - `GET /api/jobs` → recent jobs
  - `GET /api/jobs/{job_id}` → status and progress
  - `GET /api/jobs/{job_id}/findings` → array of findings
  - `POST /api/jobs/{job_id}/pause|resume|cancel` → control job
  - `GET /api/jobs/{job_id}/export.csv|export.json` → export findings

- Scans:
  - Subdomains: `POST /api/recon/subdomains/scan`
    - Body: `{ "domain": "example.com", "authorized": true, "concurrency"?: number, "timeout"?: number, "resolvers"?: string[] }`
  - Ports: `POST /api/recon/ports/scan`
    - Body: `{ "targets": ["1.1.1.1","example.com"], "authorized": true, "ports"?: number[], "timeout"?: number }`
  - Directories: `POST /api/recon/dirs/scan`
    - Body: `{ "base_url": "https://example.com", "authorized": true, "extensions"?: string[], "timeout"?: number }`

- Example (PowerShell):
    ```powershell
    # Start a subdomains scan
    $resp = Invoke-WebRequest -Uri http://localhost:8000/api/recon/subdomains/scan -Method POST -ContentType 'application/json' -Body '{"domain":"owasp.org","authorized":true}'
    $job = $resp.Content | ConvertFrom-Json

    # Poll status
    Invoke-WebRequest -Uri "http://localhost:8000/api/jobs/$($job.job_id)" | Select-Object -ExpandProperty Content

    # Get findings
    Invoke-WebRequest -Uri "http://localhost:8000/api/jobs/$($job.job_id)/findings" | Select-Object -ExpandProperty Content
    ```

## CLI usage

```powershell
reconx version
reconx subdomains scan --domain example.com --timeout 20
reconx ports scan --targets "1.1.1.1,example.com" --ports "80,443,22"
reconx dirs scan --base-url https://example.com --extensions "php,html"
```

## Legal

You must have explicit authorization to test any target. The API enforces an authorization checkbox in requests.