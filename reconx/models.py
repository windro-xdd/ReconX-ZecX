from __future__ import annotations
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Integer, DateTime, JSON, ForeignKey, Enum, Index
from sqlalchemy.sql import func
import enum
from .db import Base

class JobState(str, enum.Enum):
    queued = "queued"
    running = "running"
    paused = "paused"
    cancelled = "cancelled"
    completed = "completed"
    failed = "failed"

class ReconJob(Base):
    __tablename__ = "recon_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(32), index=True)
    params: Mapped[dict] = mapped_column(JSON)
    state: Mapped[JobState] = mapped_column(Enum(JobState), default=JobState.queued, index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    project: Mapped[str] = mapped_column(String(64), index=True, default="default")
    org_user: Mapped[str] = mapped_column(String(64), default="anon")

    __table_args__ = (
        Index("ix_jobs_project_type_state", "project", "type", "state"),
    )

class ReconFinding(Base):
    __tablename__ = "recon_findings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("recon_jobs.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_findings_job_kind", "job_id", "kind"),
    )
