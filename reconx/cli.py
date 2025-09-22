from __future__ import annotations
import asyncio
import json
import typer
from .scanners.subdomains.runner import SubdomainRunner
from .scanners.ports.runner import PortScanner
from .scanners.dirs.runner import DirScanner

app = typer.Typer(name="reconx")

@app.command("version")
def version():
    from . import __version__
    typer.echo(json.dumps({"version": __version__}))

subdomains_app = typer.Typer()
ports_app = typer.Typer()
dirs_app = typer.Typer()

app.add_typer(subdomains_app, name="subdomains")
app.add_typer(ports_app, name="ports")
app.add_typer(dirs_app, name="dirs")

@subdomains_app.command("scan")
def subdomains_scan(domain: str, resolvers: str = typer.Option(None, help="Comma-separated resolvers"), concurrency: int = 50, timeout: int = 30):
    res_list = [r.strip() for r in resolvers.split(",")] if resolvers else None
    results = asyncio.run(SubdomainRunner().run(domain, res_list, concurrency, timeout))
    typer.echo(json.dumps(results))

@ports_app.command("scan")
def ports_scan(targets: str, ports: str = typer.Option("80,443,22,3389", help="Comma-separated list"), timeout: int = 5):
    target_list = [t.strip() for t in targets.split(",")]
    port_list = [int(p) for p in ports.split(",")]
    results = asyncio.run(PortScanner().run(target_list, port_list, timeout))
    typer.echo(json.dumps(results))

@dirs_app.command("scan")
def dirs_scan(base_url: str, wordlist: str = typer.Option(None), status_include: str = typer.Option(None), extensions: str = typer.Option(None), auth: str = typer.Option(None), timeout: int = 10):
    wl = [w.strip() for w in wordlist.split(",")] if wordlist else None
    si = [int(s) for s in status_include.split(",")] if status_include else None
    ex = [e.strip() for e in extensions.split(",")] if extensions else None
    results = asyncio.run(DirScanner().run(base_url, wl, si, ex, auth, None, timeout))
    typer.echo(json.dumps(results))
