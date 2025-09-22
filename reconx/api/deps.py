from fastapi import Header, Query
from typing import Optional, Tuple


async def get_identity(
    x_org_user: Optional[str] = Header(default="anon", alias="X-Org-User"),
    project: Optional[str] = Query(default="default"),
) -> Tuple[str, str]:
    return x_org_user or "anon", project or "default"
