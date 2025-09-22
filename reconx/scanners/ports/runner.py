from __future__ import annotations
import asyncio
import ssl
from typing import List, Dict, Any, Optional


class PortScanner:
    def __init__(self, retries: int = 1):
        self.retries = retries

    async def _probe(self, host: str, port: int, timeout: float) -> Dict[str, Any]:
        data: Dict[str, Any] = {"target": host, "port": port, "status": "closed"}
        for _ in range(max(1, self.retries)):
            try:
                reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
                data["status"] = "open"
                try:
                    writer.write(b"\r\n\r\n")
                    await writer.drain()
                    banner = await asyncio.wait_for(reader.read(128), timeout=1.0)
                    if banner:
                        data["banner"] = banner.decode(errors="ignore")
                except Exception:
                    pass
                finally:
                    writer.close()
                    await writer.wait_closed()
                break
            except Exception as e:
                data["error"] = str(e)
        # Optional TLS probe for common TLS ports
        if data["status"] == "open" and port in (443, 8443, 993, 995, 465):
            try:
                ctx = ssl.create_default_context()
                reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port, ssl=ctx, server_hostname=host), timeout=timeout)
                peercert = writer.get_extra_info("ssl_object").getpeercert()
                if peercert:
                    tls_info = {
                        "subject": dict(x[0] for x in peercert.get("subject", [])),
                        "issuer": dict(x[0] for x in peercert.get("issuer", [])),
                        "notAfter": peercert.get("notAfter"),
                        "notBefore": peercert.get("notBefore"),
                    }
                    data["tls_info"] = tls_info
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
        return data

    async def run(self, targets: List[str], ports: List[int], timeout: int = 5, cancel: Optional[asyncio.Event] = None, pause: Optional[asyncio.Event] = None, progress_cb: Optional[callable] = None) -> List[Dict[str, Any]]:
        sem = asyncio.Semaphore(200)
        results: List[Dict[str, Any]] = []
        total = max(1, len(targets) * len(ports))
        done = 0

        async def task(host: str, port: int):
            nonlocal done
            async with sem:
                if cancel and cancel.is_set():
                    return
                if pause:
                    while pause.is_set():
                        await asyncio.sleep(0.2)
                res = await self._probe(host, port, timeout)
                results.append(res)
                done += 1
                if progress_cb:
                    try:
                        progress_cb(min(100, int(done * 100 / total)))
                    except Exception:
                        pass

        await asyncio.gather(*(task(h, p) for h in targets for p in ports))
        return results
