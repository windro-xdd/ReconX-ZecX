from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response
from pydantic import BaseModel, field_validator
from typing import List, Optional
from ..db import get_session, AsyncSessionLocal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..models import ReconJob, ReconFinding, JobState
from ..scanners.dirs.runner import DirScanner
from ..job_manager import job_manager
from ..metrics import metrics
from .deps import get_identity

router = APIRouter()

class DirsScanRequest(BaseModel):
    base_url: str
    wordlist: Optional[List[str] | str] = None
    status_include: Optional[List[int] | str] = None
    extensions: Optional[List[str] | str] = None
    auth: Optional[str] = None
    proxies: Optional[dict | str] = None
    timeout: int = 10
    retries: int = 1
    qps_per_host: Optional[float] = None
    project: str = "default"
    authorized: bool = False

    @field_validator('wordlist', mode='before')
    @classmethod
    def normalize_wordlist(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            import re
            items = [s.strip() for s in re.split(r"[\r\n,]+", v) if s.strip()]
            return items or None
        if isinstance(v, list):
            return [str(s).strip() for s in v if str(s).strip()] or None
        return v

    @field_validator('extensions', mode='before')
    @classmethod
    def normalize_extensions(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            parts = [s.strip().lstrip('.') for s in v.replace('\n', ',').split(',') if s.strip()]
            return parts or None
        if isinstance(v, list):
            return [str(s).strip().lstrip('.') for s in v if str(s).strip()] or None
        return v

    @field_validator('status_include', mode='before')
    @classmethod
    def normalize_status(cls, v):
        if v is None or v == '':
            return None
        if isinstance(v, str):
            parts = [p.strip() for p in v.replace('\n', ',').split(',') if p.strip()]
            out: List[int] = []
            for p in parts:
                try:
                    out.append(int(p))
                except Exception:
                    continue
            return out or None
        if isinstance(v, list):
            out: List[int] = []
            for p in v:
                try:
                    out.append(int(p))
                except Exception:
                    continue
            return out or None
        return v

    @field_validator('proxies', mode='before')
    @classmethod
    def normalize_proxies(cls, v):
        if v is None:
            return None
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return None
            try:
                import json
                return json.loads(v)
            except Exception:
                # accept single proxy url string for both http/https
                return {"http": v, "https": v}
        return v

@router.post("/scan")
async def dirs_scan(req: DirsScanRequest, session: AsyncSession = Depends(get_session), ident=Depends(get_identity)):
    if not req.authorized:
        raise HTTPException(status_code=400, detail="Authorization checkbox required")
    org_user, project = ident
    job = ReconJob(type="dirs", params=req.model_dump(), state=JobState.queued, project=project, org_user=org_user)
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
                runner = DirScanner()
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
                results = await runner.run(
                    req.base_url,
                    req.wordlist,
                    req.status_include,
                    req.extensions,
                    req.auth,
                    req.proxies,
                    req.timeout,
                    cancel,
                    pause,
                    on_progress,
                    concurrency=50,
                    retries=req.retries,
                    qps_per_host=req.qps_per_host,
                )
                for item in results:
                    url = str(item.get("url", "")).strip()
                    status = item.get("status")
                    # Skip rows with no URL or missing status
                    if not url or status is None or status == "":
                        continue
                    bsession.add(ReconFinding(job_id=job.id, kind="dir", data=item))
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

@router.post("/scan/upload")
async def dirs_scan_upload(
    base_url: str = Form(...),
    authorized: bool = Form(False),
    timeout: int = Form(10),
    project: str = Form("default"),
    wordlist_file: Optional[UploadFile] = File(None),
    inline_wordlist: Optional[str] = Form(None),
    status_include: Optional[str] = Form(None),
    extensions: Optional[str] = Form(None),
    auth: Optional[str] = Form(None),
    proxies: Optional[str] = Form(None),
    retries: int = Form(1),
    qps_per_host: Optional[float] = Form(None),
    session: AsyncSession = Depends(get_session),
    ident = Depends(get_identity),
):
    if not authorized:
        raise HTTPException(status_code=400, detail="Authorization checkbox required")
    org_user, proj = ident
    # Build words from file or inline text
    words: Optional[List[str]] = None
    if wordlist_file is not None:
        try:
            content = (await wordlist_file.read()).decode('utf-8', errors='ignore')
            words = [s.strip() for s in content.splitlines() if s.strip()]
        except Exception:
            raise HTTPException(status_code=400, detail="Failed to read wordlist file")
    if not words and inline_wordlist is not None:
        items = [s.strip() for s in inline_wordlist.replace('\r', '').split('\n') if s.strip()]
        words = items or None
    if not words:
        raise HTTPException(status_code=400, detail="Provide either wordlist_file or inline_wordlist")
    # normalize other fields via request model to reuse validation
    req = DirsScanRequest(
        base_url=base_url,
        wordlist=words,
        status_include=status_include,
        extensions=extensions,
        auth=auth,
        proxies=proxies,
        timeout=timeout,
        retries=retries,
        qps_per_host=qps_per_host,
        project=project,
        authorized=authorized,
    )
    # reuse logic by calling dirs_scan's inner flow (duplicated briefly)
    job = ReconJob(type="dirs", params=req.model_dump(), state=JobState.queued, project=proj, org_user=org_user)
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
                runner = DirScanner()
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
                results = await runner.run(
                    req.base_url,
                    req.wordlist,
                    req.status_include,
                    req.extensions,
                    req.auth,
                    req.proxies,
                    req.timeout,
                    cancel,
                    pause,
                    on_progress,
                    concurrency=50,
                    retries=req.retries,
                    qps_per_host=req.qps_per_host,
                )
                for item in results:
                    url = str(item.get("url", "")).strip()
                    status = item.get("status")
                    if not url or status is None or status == "":
                        continue
                    bsession.add(ReconFinding(job_id=job.id, kind="dir", data=item))
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
async def job_findings(job_id: int, session: AsyncSession = Depends(get_session), response: Response = None):
    res = await session.execute(
        select(ReconFinding)
        .where(ReconFinding.job_id == job_id, ReconFinding.kind == "dir")
        .order_by(ReconFinding.id.asc())
    )
    rows = res.scalars().all()
    out = []
    for r in rows:
        data = dict(r.data) if isinstance(r.data, dict) else {"value": r.data}
        s = data.get("status")
        try:
            data["status"] = int(s)
        except Exception:
            if "code" in data and isinstance(data.get("code"), (int, str)):
                try:
                    data["status"] = int(data.get("code"))
                except Exception:
                    pass
        data["id"] = r.id
        data["job_id"] = r.job_id
        data["kind"] = r.kind
        out.append(data)
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return out
