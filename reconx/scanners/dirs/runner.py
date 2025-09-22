from __future__ import annotations
import asyncio
from typing import List, Dict, Any, Optional, Tuple
import aiohttp
from .crawler import Crawler
import random


class DirScanner:
    def __init__(self):
        self.crawler = Crawler()

    async def run(
        self,
        base_url: str,
        wordlist: Optional[List[str]] = None,
        status_include: Optional[List[int]] = None,
        extensions: Optional[List[str]] = None,
        auth: Optional[str] = None,
        proxies: Optional[dict] = None,
        timeout: int = 10,
        cancel: Optional[asyncio.Event] = None,
        pause: Optional[asyncio.Event] = None,
        progress_cb: Optional[callable] = None,
        concurrency: int = 50,
        jitter_range: Tuple[float, float] = (0.05, 0.2),
        retries: int = 1,
        qps_per_host: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        headers = {"User-Agent": "ReconX/0.1"}
        auth_obj = None
        # Support either Basic "user:pass" or explicit Authorization header value
        if auth:
            if ":" in auth and not auth.lower().startswith("authorization:"):
                user, pwd = auth.split(":", 1)
                auth_obj = aiohttp.BasicAuth(user, pwd)
            elif auth.lower().startswith("authorization:"):
                # e.g., "Authorization: Bearer <token>"
                try:
                    k, v = auth.split(":", 1)
                    headers[k.strip()] = v.strip()
                except Exception:
                    pass
        to_check: List[str] = []
        wl = wordlist or ["admin", "login", "api", "dashboard"]
        if extensions:
            for w in wl:
                to_check.append(f"{base_url.rstrip('/')}/{w}")
                for ext in extensions:
                    to_check.append(f"{base_url.rstrip('/')}/{w}.{ext.lstrip('.')}")
        else:
            to_check = [f"{base_url.rstrip('/')}/{w}" for w in wl]

        # simple crawl seed
        try:
            seeds = await self.crawler.crawl(base_url)
            for s in seeds:
                to_check.append(s)
        except Exception:
            pass

        # De-duplicate to avoid unnecessary work
        to_check = list(dict.fromkeys(to_check))

        client_timeout = aiohttp.ClientTimeout(total=timeout)
        # Cap outbound concurrency to avoid overwhelming targets
        max_conn = max(1, int(concurrency) if isinstance(concurrency, int) else 50)
        connector = aiohttp.TCPConnector(limit=max_conn)
        results: List[Dict[str, Any]] = []
        status_set = set(status_include or [200, 204, 301, 302, 401, 403])

        # Helper to pick a proxy for a given URL scheme
        def pick_proxy(url: str) -> Optional[str]:
            if not proxies:
                return None
            try:
                scheme = url.split(":", 1)[0].lower()
                # If single string provided, use for both; else map by scheme
                if isinstance(proxies, str):
                    return proxies
                return proxies.get(scheme) or proxies.get("http") or None
            except Exception:
                return None

        # Per-host throttle state
        host_next_time: Dict[str, float] = {}
        host_locks: Dict[str, asyncio.Lock] = {}

        def get_host(url: str) -> str:
            try:
                return url.split('//', 1)[-1].split('/', 1)[0].lower()
            except Exception:
                return ''

        async def throttle_host(url: str):
            if not qps_per_host or qps_per_host <= 0:
                return
            host = get_host(url)
            if host not in host_locks:
                host_locks[host] = asyncio.Lock()
                host_next_time[host] = 0.0
            async with host_locks[host]:
                now = asyncio.get_event_loop().time()
                next_allowed = host_next_time.get(host, 0.0)
                if now < next_allowed:
                    await asyncio.sleep(next_allowed - now)
                    now = asyncio.get_event_loop().time()
                # schedule next slot
                interval = 1.0 / float(qps_per_host)
                # small randomization to avoid lockstep
                j = 0.0
                try:
                    lo, hi = jitter_range
                    j = random.uniform(lo * 0.5, hi * 0.5)
                except Exception:
                    pass
                host_next_time[host] = now + interval + j

        async with aiohttp.ClientSession(timeout=client_timeout, connector=connector, headers=headers, auth=auth_obj, trust_env=True) as session:
            async def fetch(url: str):
                # Simple retry with exponential backoff
                attempts = max(1, int(retries))
                for attempt in range(1, attempts + 1):
                    try:
                        if cancel and cancel.is_set():
                            return
                        if pause:
                            while pause.is_set():
                                await asyncio.sleep(0.2)
                        # Randomized jitter to smooth burstiness
                        try:
                            lo, hi = jitter_range
                            j = random.uniform(float(lo), float(hi))
                            if j > 0:
                                await asyncio.sleep(j)
                        except Exception:
                            pass
                        await throttle_host(url)
                        proxy = pick_proxy(url)
                        async with session.head(url, allow_redirects=False, proxy=proxy) as r:
                            status = r.status
                            loc = r.headers.get("Location")
                            if status in (405, 501):
                                raise RuntimeError("HEAD not allowed; fallback to GET")
                            if status not in status_set:
                                # retry on 429/5xx if configured
                                if status == 429 or status >= 500:
                                    raise RuntimeError(f"Retryable status {status}")
                                return
                            ct = r.headers.get("Content-Type", "")
                            results.append({
                                "url": url,
                                "status": status,
                                "length": int(r.headers.get("Content-Length", "0") or 0),
                                "title": "",
                                "content_type": ct,
                                "redirected_to": loc,
                            })
                            return
                    except Exception:
                        try:
                            if cancel and cancel.is_set():
                                return
                            if pause:
                                while pause.is_set():
                                    await asyncio.sleep(0.2)
                            # Apply jitter before the GET as well
                            try:
                                lo, hi = jitter_range
                                j = random.uniform(float(lo), float(hi))
                                if j > 0:
                                    await asyncio.sleep(j)
                            except Exception:
                                pass
                            await throttle_host(url)
                            proxy = pick_proxy(url)
                            async with session.get(url, allow_redirects=False, proxy=proxy) as r:
                                status = r.status
                                if status not in status_set:
                                    if status == 429 or status >= 500:
                                        raise RuntimeError(f"Retryable status {status}")
                                    return
                                text = await r.text(errors="ignore")
                                title = ""
                                ti = text.lower().find("<title>")
                                if ti >= 0:
                                    tj = text.lower().find("</title>", ti)
                                    if tj > ti:
                                        title = text[ti + 7:tj].strip()[:120]
                                results.append({
                                    "url": url,
                                    "status": status,
                                    "length": len(text),
                                    "title": title,
                                    "content_type": r.headers.get("Content-Type", ""),
                                    "redirected_to": r.headers.get("Location"),
                                })
                                return
                        except Exception:
                            if attempt >= attempts:
                                return
                            # backoff with jitter
                            delay = min(2.0, 0.25 * (2 ** (attempt - 1)))
                            try:
                                lo, hi = jitter_range
                                delay += random.uniform(lo, hi)
                            except Exception:
                                pass
                            await asyncio.sleep(delay)

            total = max(1, len(to_check))
            done = 0
            sem = asyncio.Semaphore(max_conn)

            async def wrapped(u: str):
                if cancel and cancel.is_set():
                    return
                async with sem:
                    await fetch(u)
                nonlocal done
                done += 1
                if progress_cb:
                    try:
                        progress_cb(min(100, int(done * 100 / total)))
                    except Exception:
                        pass

            await asyncio.gather(*(wrapped(u) for u in to_check))

        # Ensure final progress reaches 100
        if progress_cb:
            try:
                progress_cb(100)
            except Exception:
                pass

        return results
