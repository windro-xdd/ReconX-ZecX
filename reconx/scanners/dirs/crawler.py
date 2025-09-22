from __future__ import annotations
from typing import Set
import aiohttp
from urllib.parse import urljoin, urlparse
import re


class Crawler:
    async def crawl(self, base_url: str) -> Set[str]:
        urls: Set[str] = set()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(base_url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                    if r.status >= 400:
                        return set()
                    text = await r.text(errors="ignore")
        except Exception:
            return set()
        for m in re.finditer(r'href=["\']([^"\']+)["\']', text, flags=re.I):
            href = m.group(1)
            if href.startswith("#"):
                continue
            u = urljoin(base_url, href)
            bp = urlparse(base_url)
            up = urlparse(u)
            if bp.netloc == up.netloc:
                urls.add(u)
        return urls
