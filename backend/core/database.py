from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from core.config import settings

def _connect_args() -> dict:
    """asyncpg bağlantı ayarları.

    `statement_timeout` sunucu tarafındadır: kaçak bir sorgu (planı bozulmuş,
    indekssiz büyük tarama) bağlantıyı süresiz meşgul edip havuzu tüketemesin.
    Uygulama tarafı iptal yetmez — istemci vazgeçse de sunucu sorguyu sürdürür.
    """
    if settings.DB_STATEMENT_TIMEOUT_MS <= 0:
        return {}
    return {
        "server_settings": {
            "statement_timeout": str(settings.DB_STATEMENT_TIMEOUT_MS),
            # Uygulama adı: pg_stat_activity'de hangi sürecin ne yaptığı görünsün.
            "application_name": settings.PROJECT_NAME[:60],
        }
    }


engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DB_ECHO,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
    pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
    connect_args=_connect_args(),
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        else:
            # WS push'ları yalnızca commit BAŞARILI olduktan sonra gönderilir
            # (commit öncesi gönderim alıcıda eski veri refetch'ine yol açıyordu).
            from core import ws_outbox

            await ws_outbox.flush(session)
        finally:
            await session.close()
