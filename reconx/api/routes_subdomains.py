from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from ..db import get_session, AsyncSessionLocal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import insert, update, select
from ..models import ReconJob, ReconFinding, JobState
from ..scanners.subdomains.runner import SubdomainRunner
from ..job_manager import job_manager
from ..metrics import metrics
from .deps import get_identity

router = APIRouter()

class SubdomainScanRequest(BaseModel):
    domain: str
    resolvers: Optional[List[str]] = None
    concurrency: int = 50
    timeout: int = 30
    project: str = "default"
    authorized: bool = False

@router.post("/scan")
async def subdomain_scan(req: SubdomainScanRequest, session: AsyncSession = Depends(get_session), ident=Depends(get_identity)):
    if not req.authorized:
        raise HTTPException(status_code=400, detail="Authorization checkbox required")
    org_user, project = ident
    job = ReconJob(type="subdomains", params=req.model_dump(), state=JobState.queued, project=project, org_user=org_user)
    session.add(job)
    await session.flush()

    async def run_job(cancel, pause):
        async with AsyncSessionLocal() as bsession:
            try:
                metrics.inc_started()
                dbjob = await bsession.get(ReconJob, job.id)
                if not dbjob:
                    return
                dbjob.state = JobState.running
                await bsession.commit()
                runner = SubdomainRunner()
                last_written = -1
                def on_progress(pct: int):
                    # fire-and-forget update
                    async def _upd():
                        async with AsyncSessionLocal() as ps:
                            dbjob = await ps.get(ReconJob, job.id)
                            if dbjob:
                                dbjob.progress = int(pct)
                                await ps.commit()
                    import asyncio
                    nonlocal last_written
                    if pct >= 100 or pct - last_written >= 5:
                        last_written = pct
                        try:
                            asyncio.create_task(_upd())
                        except Exception:
                            pass
                results = await runner.run(req.domain, req.resolvers, req.concurrency, req.timeout, cancel, pause, on_progress)
                for item in results:
                    name = str(item.get("subdomain", "")).strip()
                    ips = item.get("resolved_ips") or []
                    # Save only real hits that have at least one IP
                    if not name or not isinstance(ips, list) or len([x for x in ips if str(x).strip()]) == 0:
                        continue
                    f = ReconFinding(job_id=job.id, kind="subdomain", data=item)
                    bsession.add(f)
                    metrics.add_finding()
                dbjob = await bsession.get(ReconJob, job.id)
                if dbjob:
                    if cancel.is_set():
                        dbjob.state = JobState.cancelled
                        await bsession.commit()
                    else:
                        dbjob.progress = 100
                        dbjob.state = JobState.completed
                        await bsession.commit()
                        metrics.inc_completed()
            except Exception:
                try:
                    dbjob = await bsession.get(ReconJob, job.id)
                    if dbjob:
                        dbjob.state = JobState.failed
                        await bsession.commit()
                finally:
                    metrics.inc_failed()

    await job_manager.start_job(job, lambda c, p: run_job(c, p))
    await session.commit()
    return {"status": job.state, "job_id": job.id}

@router.get("/jobs/{job_id}")
async def job_status(job_id: int, session: AsyncSession = Depends(get_session)):
    res = await session.execute(select(ReconJob).where(ReconJob.id == job_id))
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"id": job.id, "state": job.state, "progress": job.progress}

@router.post("/jobs/{job_id}/pause")
async def pause_job(job_id: int):
    job_manager.pause_job(job_id)
    return {"ok": True}

@router.post("/jobs/{job_id}/resume")
async def resume_job(job_id: int):
    job_manager.resume_job(job_id)
    return {"ok": True}

@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: int):
    job_manager.cancel_job(job_id)
    return {"ok": True}

@router.get("/jobs/{job_id}/findings")
async def job_findings(job_id: int, session: AsyncSession = Depends(get_session)):
    res = await session.execute(
        select(ReconFinding)
        .where(ReconFinding.job_id == job_id, ReconFinding.kind == "subdomain")
        .order_by(ReconFinding.id.asc())
    )
    rows = res.scalars().all()
    return [r.data for r in rows]
