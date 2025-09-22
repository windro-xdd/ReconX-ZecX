from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import MetaData
from .config import settings

metadata_obj = MetaData()

class Base(DeclarativeBase):
    metadata = metadata_obj

dsn = settings.database_url or f"postgresql+asyncpg://{settings.db_user}:{settings.db_password}@{settings.db_host}:{settings.db_port}/{settings.db_name}"

# Fallback to SQLite if Postgres is unavailable and no DATABASE_URL provided
if settings.database_url is None:
    dsn = "sqlite+aiosqlite:///./reconx.db"

is_sqlite = dsn.startswith("sqlite+")
_engine = create_async_engine(dsn, echo=False, pool_pre_ping=not is_sqlite)

AsyncSessionLocal = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)

async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session

def get_engine():
    return _engine

async def init_db():
    if is_sqlite:
        async with _engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
