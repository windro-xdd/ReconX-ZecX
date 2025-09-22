from __future__ import annotations
import socket
import asyncio
from typing import Optional, Tuple


async def tcp_connect(host: str, port: int, timeout: float) -> Tuple[bool, Optional[str]]:
    try:
        fut = asyncio.open_connection(host, port)
        reader, writer = await asyncio.wait_for(fut, timeout=timeout)
        try:
            peer = writer.get_extra_info("peername")
        finally:
            writer.close()
            await writer.wait_closed()
        return True, str(peer)
    except Exception as e:
        return False, str(e)
