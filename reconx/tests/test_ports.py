import pytest
from reconx.scanners.ports.runner import PortScanner


@pytest.mark.asyncio
async def test_port_scanner_runs():
    scanner = PortScanner(retries=0)
    res = await scanner.run(["127.0.0.1"], [9], timeout=0.2)
    assert isinstance(res, list)