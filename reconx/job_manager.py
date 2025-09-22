import asyncio
import structlog
from typing import Dict, Optional, Callable, Awaitable
from .models import ReconJob, JobState

log = structlog.get_logger()

class JobManager:
    def __init__(self):
        self.tasks: Dict[int, asyncio.Task] = {}
        self.cancel_events: Dict[int, asyncio.Event] = {}
        self.pause_events: Dict[int, asyncio.Event] = {}

    def is_running(self, job_id: int) -> bool:
        return job_id in self.tasks and not self.tasks[job_id].done()

    async def start_job(self, job: ReconJob, coro_factory: Callable[[asyncio.Event, asyncio.Event], Awaitable[None]]):
        if self.is_running(job.id):
            return
        cancel = asyncio.Event()
        pause = asyncio.Event()
        self.cancel_events[job.id] = cancel
        self.pause_events[job.id] = pause
        task = asyncio.create_task(coro_factory(cancel, pause))
        self.tasks[job.id] = task

    def pause_job(self, job_id: int):
        if job_id in self.pause_events:
            self.pause_events[job_id].set()

    def resume_job(self, job_id: int):
        if job_id in self.pause_events:
            self.pause_events[job_id].clear()

    def cancel_job(self, job_id: int):
        if job_id in self.cancel_events:
            self.cancel_events[job_id].set()
        # Allow tasks to exit gracefully based on the cancel event

job_manager = JobManager()
