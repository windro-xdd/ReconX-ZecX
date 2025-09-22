from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from typing import List, Optional
from ..db import get_session, AsyncSessionLocal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..models import ReconJob, ReconFinding, JobState
from ..scanners.ports.runner import PortScanner
from ..job_manager import job_manager
from ..metrics import metrics
from .deps import get_identity
import re

router = APIRouter()

class PortScanRequest(BaseModel):
    targets: List[str] | str
    ports: Optional[List[int] | str] = None
    timeout: int = 5
    project: str = "default"
    authorized: bool = False

    @field_validator('targets', mode='before')
    @classmethod
    def normalize_targets(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            return [s.strip() for s in re.split(r"[\s,]+", v) if s.strip()]
        if isinstance(v, list):
            return [str(s).strip() for s in v if str(s).strip()]
        return v

    @field_validator('ports', mode='before')
    @classmethod
    def normalize_ports(cls, v):
        if v is None or v == '':
            return None
        if isinstance(v, str):
            parts = [p.strip() for p in re.split(r"[\s,]+", v) if p.strip()]
            nums: List[int] = []
            for p in parts:
                try:
                    nums.append(int(p))
                except Exception:
                    continue
            return nums or None
        if isinstance(v, list):
            nums: List[int] = []
            for p in v:
                try:
                    nums.append(int(p))
                except Exception:
                    continue
            return nums or None
        return v

@router.post("/scan")
async def port_scan(req: PortScanRequest, session: AsyncSession = Depends(get_session), ident=Depends(get_identity)):
    if not req.authorized:
        raise HTTPException(status_code=400, detail="Authorization checkbox required")
    org_user, project = ident
    # ensure targets exist after normalization
    targets: List[str] = req.targets if isinstance(req.targets, list) else []
    if not targets:
        raise HTTPException(status_code=400, detail="At least one target is required")

    job = ReconJob(type="ports", params=req.model_dump(), state=JobState.queued, project=project, org_user=org_user)
    session.add(job)
    await session.flush()

    ports = req.ports if isinstance(req.ports, list) else None
    ports = ports or [80, 443, 22, 3389, 8080, 8443]

    async def run_job(cancel, pause):
        async with AsyncSessionLocal() as bsession:
            try:
                metrics.inc_started()
                dbjob = await bsession.get(ReconJob, job.id)
                if not dbjob:
                    return
                dbjob.state = JobState.running
                await bsession.commit()
                scanner = PortScanner()
                last_written = -1
                def on_progress(pct: int):
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
                results = await scanner.run(targets, ports, req.timeout, cancel, pause, on_progress)
                for item in results:
                    bsession.add(ReconFinding(job_id=job.id, kind="port", data=item))
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

@router.get("/jobs/{job_id}/findings")
async def job_findings(job_id: int, session: AsyncSession = Depends(get_session)):
    res = await session.execute(
        select(ReconFinding)
        .where(ReconFinding.job_id == job_id, ReconFinding.kind == "port")
        .order_by(ReconFinding.id.asc())
    )
    rows = res.scalars().all()
    return [r.data for r in rows]
