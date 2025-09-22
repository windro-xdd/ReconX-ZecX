from __future__ import annotations
import asyncio
import json
import socket
from typing import List, Optional, Dict, Any, Set
import aiohttp
import aiodns
from datetime import datetime, timezone
import shutil


async def provider_subfinder(domain: str) -> Set[str]:
    exe = shutil.which("subfinder")
    if not exe:
        return set()
    try:
        proc = await asyncio.create_subprocess_exec(
            exe, "-silent", "-d", domain,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        names = {line.strip().decode().lower() for line in out.splitlines() if line}
        return {n for n in names if n.endswith(domain)}
    except Exception:
        return set()


async def provider_crtsh(session: aiohttp.ClientSession, domain: str) -> Set[str]:
    url = f"https://crt.sh/?q=%25.{domain}&output=json"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                return set()
            txt = await r.text()
            try:
                data = json.loads(txt)
            except json.JSONDecodeError:
                return set()
            names = set()
            for row in data:
                name_value = row.get("name_value", "")
                for n in name_value.split("\n"):
                    n = n.strip().lower()
                    if n.endswith(domain):
                        names.add(n)
            return names
    except Exception:
        return set()


async def provider_sonar(session: aiohttp.ClientSession, domain: str) -> Set[str]:
    url = f"https://sonar.omnisint.io/subdomains/{domain}"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                return set()
            data = await r.json(content_type=None)
            return {str(x).lower() for x in data if str(x).lower().endswith(domain)}
    except Exception:
        return set()


async def provider_doh(session: aiohttp.ClientSession, domain: str) -> Set[str]:
    # Try a simple common set like www, api, dev, staging, mail, vpn
    candidates = {f"{sub}.{domain}" for sub in ["www", "api", "dev", "staging", "mail", "vpn", "test"]}
    found: Set[str] = set()
    for name in candidates:
        try:
            url = f"https://dns.google/resolve?name={name}&type=A"
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    continue
                data = await r.json(content_type=None)
                if data.get("Answer"):
                    found.add(name)
        except Exception:
            continue
    return found


async def resolve_dns(resolver: aiodns.DNSResolver, name: str) -> List[str]:
    """Resolve to concrete A/AAAA addresses only; ignore CNAMEs for IP list.
    This avoids saving entries with empty strings (which render as N/A in UI).
    """
    ips: List[str] = []
    for qtype in ("A", "AAAA"):
        try:
            ans = await resolver.query(name, qtype)
            for a in ans:
                host = getattr(a, "host", "")
                if host:
                    ips.append(host)
        except Exception:
            pass
    # Deduplicate and drop empties
    cleaned = [s for s in dict.fromkeys(ips) if isinstance(s, str) and s.strip()]
    return cleaned


class SubdomainRunner:
    async def run(
        self,
        domain: str,
        resolvers: Optional[List[str]] = None,
        concurrency: int = 50,
        timeout: int = 30,
        cancel: Optional[asyncio.Event] = None,
        pause: Optional[asyncio.Event] = None,
        progress_cb: Optional[callable] = None,
    ) -> List[Dict[str, Any]]:
        timeout_cfg = aiohttp.ClientTimeout(total=timeout)
        connector = aiohttp.TCPConnector(limit=concurrency, ssl=False)
        results: Dict[str, Dict[str, Any]] = {}
        now_iso = datetime.now(timezone.utc).isoformat()
        async with aiohttp.ClientSession(timeout=timeout_cfg, connector=connector, headers={"User-Agent": "ReconX/0.1"}) as session:
            providers = [
                provider_crtsh(session, domain),
                provider_sonar(session, domain),
                provider_doh(session, domain),
            ]
            prov_sets = await asyncio.gather(*providers, return_exceptions=True)
        # Prefer subfinder if available
        subf = await provider_subfinder(domain)
        if subf:
            prov_sets.append(subf)
        candidates: Set[str] = set()
        for s in prov_sets:
            if isinstance(s, set):
                candidates |= s

        if not candidates:
            return []

        resolver = aiodns.DNSResolver()
        if resolvers:
            resolver.nameservers = resolvers

        # wildcard detection
        wildcard_ips: Set[str] = set()
        try:
            wname = f"nonexistent-{int(asyncio.get_running_loop().time()*1000)}.{domain}"
            wips = await resolve_dns(resolver, wname)
            wildcard_ips = set(wips)
        except Exception:
            pass

        total = max(1, len(candidates))
        done = 0
        sem = asyncio.Semaphore(concurrency)

        async def worker(name: str):
            nonlocal done
            async with sem:
                if cancel and cancel.is_set():
                    return
                if pause:
                    # wait while paused
                    while pause.is_set():
                        await asyncio.sleep(0.2)
                try:
                    ips = await asyncio.wait_for(resolve_dns(resolver, name), timeout=timeout)
                except Exception:
                    ips = []
                if wildcard_ips and set(ips) <= wildcard_ips:
                    done += 1
                    if progress_cb:
                        try:
                            progress_cb(min(100, int(done * 100 / total)))
                        except Exception:
                            pass
                    return
                if not ips:
                    done += 1
                    if progress_cb:
                        try:
                            progress_cb(min(100, int(done * 100 / total)))
                        except Exception:
                            pass
                    return
                entry = results.get(name)
                if not entry:
                    results[name] = {
                        "subdomain": name,
                        "source": "mixed",
                        "resolved_ips": ips,
                        "first_seen": now_iso,
                        "last_seen": now_iso,
                    }
                else:
                    entry["resolved_ips"] = list(dict.fromkeys(entry["resolved_ips"] + ips))
                    entry["last_seen"] = now_iso
                done += 1
                if progress_cb:
                    try:
                        progress_cb(min(100, int(done * 100 / total)))
                    except Exception:
                        pass

        await asyncio.gather(*(worker(n) for n in sorted(candidates)))

        return list(results.values())
