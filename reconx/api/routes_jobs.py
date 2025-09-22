from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from ..db import get_session
from ..models import ReconJob, JobState, ReconFinding
from .deps import get_identity
from ..job_manager import job_manager
from urllib.parse import urlparse

router = APIRouter()

@router.get("")
async def list_jobs(session: AsyncSession = Depends(get_session), ident=Depends(get_identity), response: Response = None):
    org_user, project = ident
    res = await session.execute(
        select(ReconJob)
        .where(ReconJob.project == project)
        .order_by(ReconJob.created_at.desc())
        .limit(100)
    )
    rows = res.scalars().all()
    def _serialize_job(j: ReconJob):
        ca = j.created_at
        if ca is None:
            created = None
        else:
            created = ca.isoformat() if hasattr(ca, "isoformat") else str(ca)
        state_val = getattr(j.state, "value", j.state)
        prog = int(j.progress or 0)
        if state_val == "completed" and prog < 100:
            prog = 100
        # derive summary fields from params
        base_url = None
        domain = None
        targets = None
        try:
            p = j.params or {}
            if j.type == "dirs":
                base_url = p.get("base_url")
            elif j.type == "subdomains":
                domain = p.get("domain")
            elif j.type == "ports":
                targets = p.get("targets")
        except Exception:
            pass
        return {
            "id": j.id,
            "type": j.type,
            "state": state_val,
            "project": j.project,
            "created_at": created,
            "progress": prog,
            **({"base_url": base_url} if base_url else {}),
            **({"domain": domain} if domain else {}),
            **({"targets": targets} if targets else {}),
        }
    out = [_serialize_job(j) for j in rows]
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return out

@router.get("/{job_id}")
async def get_job(job_id: int, session: AsyncSession = Depends(get_session), response: Response = None):
    job = await session.get(ReconJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    ca = job.created_at
    if ca is None:
        created = None
    else:
        created = ca.isoformat() if hasattr(ca, "isoformat") else str(ca)
    state_val = getattr(job.state, "value", job.state)
    prog = int(job.progress or 0)
    if state_val == "completed" and prog < 100:
        prog = 100
    payload = {
        "id": job.id,
        "type": job.type,
        "state": state_val,
        "progress": prog,
        "created_at": created,
    }
    try:
        p = job.params or {}
        if job.type == "dirs" and p.get("base_url"):
            payload["base_url"] = p.get("base_url")
        if job.type == "subdomains" and p.get("domain"):
            payload["domain"] = p.get("domain")
        if job.type == "ports" and p.get("targets"):
            payload["targets"] = p.get("targets")
    except Exception:
        pass
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return payload

@router.post("/{job_id}/pause")
async def pause_job(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(ReconJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job_manager.pause_job(job_id)
    try:
        job.state = JobState.paused
        await session.commit()
    except Exception:
        await session.rollback()
    return {"ok": True}

@router.post("/{job_id}/resume")
async def resume_job(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(ReconJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job_manager.resume_job(job_id)
    try:
        # If job is still active, mark as running again
        if job.state == JobState.paused:
            job.state = JobState.running
        await session.commit()
    except Exception:
        await session.rollback()
    return {"ok": True}

@router.post("/{job_id}/cancel")
async def cancel_job(job_id: int, session: AsyncSession = Depends(get_session)):
    job = await session.get(ReconJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job_manager.cancel_job(job_id)
    try:
        job.state = JobState.cancelled
        await session.commit()
    except Exception:
        await session.rollback()
    return {"ok": True}

@router.get("/{job_id}/findings")
async def job_findings(job_id: int, session: AsyncSession = Depends(get_session), ident=Depends(get_identity), response: Response = None):
    job = await session.get(ReconJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    org_user, project = ident
    if job.project != project:
        raise HTTPException(status_code=403, detail="Forbidden")
    kind = "dir" if job.type == "dirs" else ("port" if job.type == "ports" else ("subdomain" if job.type == "subdomains" else None))
    query = select(ReconFinding).where(ReconFinding.job_id == job_id)
    if kind:
        query = query.where(ReconFinding.kind == kind)
    query = query.order_by(ReconFinding.id.asc())
    res = await session.execute(query)
    rows = res.scalars().all()
    out = []
    # For directory jobs, capture host filter from params to avoid any accidental cross-host records
    dir_host = None
    if job.type == "dirs":
        try:
            bu = (job.params or {}).get("base_url")
            if bu:
                dir_host = urlparse(bu).netloc.lower()
        except Exception:
            dir_host = None
    for r in rows:
        data = dict(r.data) if isinstance(r.data, dict) else {"value": r.data}
        # Normalize directory status to integer when possible to avoid frontend blanks
        if r.kind == "dir":
            # Host-scope: keep only rows whose URL host matches job base_url host
            if dir_host:
                try:
                    u = (data.get("url") or "").strip()
                    if not u:
                        # drop empty URL rows
                        continue
                    uh = urlparse(u).netloc.lower()
                    if uh != dir_host:
                        # skip rows that don't belong to this job's host
                        continue
                except Exception:
                    # if parsing fails, keep the row only if URL starts with the base host string
                    if dir_host not in str(data.get("url") or ""):
                        continue
            s = data.get("status")
            try:
                data["status"] = int(s)
            except Exception:
                # also expose alternate fields if present
                if "code" in data and isinstance(data.get("code"), (int, str)):
                    try:
                        data["status"] = int(data.get("code"))
                    except Exception:
                        pass
        # include identifiers for stable rendering/traceability
        data["id"] = r.id
        data["job_id"] = r.job_id
        data["kind"] = r.kind
        out.append(data)
    # Advise clients not to cache
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    return out

@router.delete("/{job_id}")
async def delete_job(job_id: int, session: AsyncSession = Depends(get_session), ident=Depends(get_identity)):
    job = await session.get(ReconJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    org_user, project = ident
    if job.project != project:
        raise HTTPException(status_code=403, detail="Forbidden")
    # cancel if running
    job_manager.cancel_job(job_id)
    # delete findings then job (FK cascade should handle findings too)
    await session.delete(job)
    await session.commit()
    return {"ok": True}
