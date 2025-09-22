from fastapi import FastAPI, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from ..config import settings
from ..logging_config import setup_logging
from .routes_subdomains import router as subdomains_router
from .routes_ports import router as ports_router
from .routes_dirs import router as dirs_router
from .routes_jobs import router as jobs_router
from ..metrics import metrics
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..db import get_session, get_engine
from ..models import ReconJob, ReconFinding, JobState
from ..db import Base
import asyncio
from datetime import datetime, timedelta, timezone
from .deps import get_identity

setup_logging(settings.log_level)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"ok": True, "name": settings.app_name, "legal": "Use only on targets you are authorized to test."}

@app.get("/api/metrics")
async def get_metrics(session: AsyncSession = Depends(get_session), ident=Depends(get_identity), response: Response = None):
    # Derive metrics from DB for accuracy, scoped by project
    _, project = ident
    # Jobs totals
    total_jobs_q = select(func.count()).select_from(ReconJob).where(ReconJob.project == project)
    completed_jobs_q = select(func.count()).select_from(ReconJob).where(ReconJob.project == project, ReconJob.state == JobState.completed)
    failed_jobs_q = select(func.count()).select_from(ReconJob).where(ReconJob.project == project, ReconJob.state == JobState.failed)
    total_jobs = (await session.execute(total_jobs_q)).scalar() or 0
    completed_jobs = (await session.execute(completed_jobs_q)).scalar() or 0
    failed_jobs = (await session.execute(failed_jobs_q)).scalar() or 0

    # Findings totals: join to jobs to respect project
    total_findings_q = (
        select(func.count())
        .select_from(ReconFinding)
        .join(ReconJob, ReconFinding.job_id == ReconJob.id)
        .where(ReconJob.project == project)
    )
    findings_total = (await session.execute(total_findings_q)).scalar() or 0

    # Findings per minute: count in trailing 60 seconds
    cutoff = datetime.utcnow() - timedelta(seconds=60)
    fpm_q = (
        select(func.count())
        .select_from(ReconFinding)
        .join(ReconJob, ReconFinding.job_id == ReconJob.id)
        .where(ReconJob.project == project, ReconFinding.created_at >= cutoff)
    )
    findings_last_min = (await session.execute(fpm_q)).scalar() or 0
    findings_per_min = float(findings_last_min)

    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return {
        "started_jobs": int(total_jobs),
        "completed_jobs": int(completed_jobs),
        "failed_jobs": int(failed_jobs),
        "findings_total": int(findings_total),
        "findings_per_min": findings_per_min,
    }

@app.get("/healthz")
async def healthz():
    try:
        eng = get_engine()
        # hide password in connection string
        db_url = eng.url.render_as_string(hide_password=True)
        return {"ok": True, "db": db_url}
    except Exception:
        return {"ok": False}

app.include_router(subdomains_router, prefix="/api/recon/subdomains")
app.include_router(ports_router, prefix="/api/recon/ports")
app.include_router(dirs_router, prefix="/api/recon/dirs")
app.include_router(jobs_router, prefix="/api/jobs")

@app.get("/api/jobs/{job_id}/export.csv")
async def export_job_csv(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(ReconJob, job_id)
    if not job:
        return StreamingResponse(iter(["kind,data\n"]), media_type="text/csv")
    kind = "dir" if job.type == "dirs" else ("port" if job.type == "ports" else ("subdomain" if job.type == "subdomains" else None))
    query = select(ReconFinding).where(ReconFinding.job_id == job_id)
    if kind:
        query = query.where(ReconFinding.kind == kind)
    query = query.order_by(ReconFinding.id.asc())
    res = await session.execute(query)
    rows = res.scalars().all()
    def gen():
        yield "kind,data\n"
        for r in rows:
            import json
            yield f"{r.kind},{json.dumps(r.data)}\n"
    return StreamingResponse(gen(), media_type="text/csv")

@app.get("/api/jobs/{job_id}/export.json")
async def export_job_json(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(ReconJob, job_id)
    kind = None
    if job:
        kind = "dir" if job.type == "dirs" else ("port" if job.type == "ports" else ("subdomain" if job.type == "subdomains" else None))
    query = select(ReconFinding).where(ReconFinding.job_id == job_id)
    if kind:
        query = query.where(ReconFinding.kind == kind)
    query = query.order_by(ReconFinding.id.asc())
    res = await session.execute(query)
    rows = res.scalars().all()
    return [r.data for r in rows]

@app.on_event("startup")
async def on_startup():
    # Ensure tables exist when using SQLite fallback (no-op if Postgres + Alembic is used)
    try:
        eng = get_engine()
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception:
        # Avoid blocking startup if migrations handle schema
        pass
