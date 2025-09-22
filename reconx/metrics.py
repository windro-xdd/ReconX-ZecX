import time
from dataclasses import dataclass, field


@dataclass
class Metrics:
    started_jobs: int = 0
    completed_jobs: int = 0
    failed_jobs: int = 0
    findings_total: int = 0
    findings_window: list[float] = field(default_factory=list)

    def inc_started(self) -> None:
        self.started_jobs += 1

    def inc_completed(self) -> None:
        self.completed_jobs += 1

    def inc_failed(self) -> None:
        self.failed_jobs += 1

    def add_finding(self) -> None:
        self.findings_total += 1
        now = time.time()
        self.findings_window.append(now)
        # Keep last 5 minutes
        cutoff = now - 300
        self.findings_window = [t for t in self.findings_window if t >= cutoff]

    def findings_per_min(self) -> float:
        # average last 5 minutes
        if not self.findings_window:
            return 0.0
        span = max(1.0, (self.findings_window[-1] - self.findings_window[0]) / 60.0)
        return len(self.findings_window) / span


metrics = Metrics()
