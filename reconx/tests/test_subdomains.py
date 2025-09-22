import pytest
import asyncio
from reconx.scanners.subdomains.runner import SubdomainRunner


@pytest.mark.asyncio
async def test_subdomain_runner_basic(monkeypatch):
    async def fake_run(self, domain, resolvers=None, concurrency=10, timeout=5):
        return [{
            "subdomain": f"www.{domain}",
            "source": "test",
            "resolved_ips": ["1.2.3.4"],
            "first_seen": "now",
            "last_seen": "now",
        }]
    monkeypatch.setattr(SubdomainRunner, 'run', fake_run)
    res = await SubdomainRunner().run('example.com')
    assert res and res[0]['subdomain'].endswith('example.com')
