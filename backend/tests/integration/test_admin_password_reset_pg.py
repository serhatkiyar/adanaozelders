"""Güvenli admin şifre sıfırlama (devir belgesi Öncelik 2) — GERÇEK Postgres.

Eski akış geçici parolayı admin ekranına döndürüyor ve oturumları açık
bırakıyordu. Yeni akış: parola üretilmez/dönmez; tek kullanımlık sıfırlama
token'ı (hash'li) yazılır + e-postalanır ve TÜM aktif refresh token'ları
iptal edilir.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from core.database import AsyncSessionLocal
from models.client import Client
from models.verification_token import TokenPurpose, VerificationToken
from services import admin_service, refresh_token_service


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


class ResetFactory:
    def __init__(self) -> None:
        self.client_ids: list[int] = []

    async def client(self) -> int:
        async with AsyncSessionLocal() as s:
            u = _uniq()
            c = Client(
                email=f"c-{u}@reset.test", hashed_password="x",
                first_name="Reset", last_name="Testi", role_id=3,
            )
            s.add(c)
            await s.flush()
            self.client_ids.append(c.id)
            await s.commit()
        return self.client_ids[-1]

    async def cleanup(self) -> None:
        async with AsyncSessionLocal() as s:
            ids = {"ids": self.client_ids or [0]}
            await s.execute(
                text(
                    "DELETE FROM verification_tokens "
                    "WHERE role_id = 3 AND user_id = ANY(:ids)"
                ),
                ids,
            )
            await s.execute(
                text("DELETE FROM refresh_tokens WHERE role_id = 3 AND user_id = ANY(:ids)"),
                ids,
            )
            await s.execute(text("DELETE FROM clients WHERE id = ANY(:ids)"), ids)
            await s.commit()


@pytest.fixture
async def rf(pg) -> ResetFactory:
    f = ResetFactory()
    yield f
    await f.cleanup()


@pytest.mark.asyncio
async def test_reset_parola_dondurmez_token_yazar_oturumlari_keser(rf: ResetFactory):
    client_id = await rf.client()

    # Aktif bir oturum (refresh token) var.
    async with AsyncSessionLocal() as s:
        raw_refresh = await refresh_token_service.issue(db=s, role_id=3, user_id=client_id)
        await s.commit()

    async with AsyncSessionLocal() as s:
        masked = await admin_service.initiate_password_reset(
            s, role="client", user_id=client_id
        )
        await s.commit()

    # Dönen şey parola değil, maskeli e-posta.
    assert masked.startswith("c***") and "@reset.test" in masked

    async with AsyncSessionLocal() as s:
        # Tek kullanımlık PASSWORD_RESET token'ı yazıldı (hash'li).
        tok = (
            await s.execute(
                select(VerificationToken).where(
                    VerificationToken.role_id == 3,
                    VerificationToken.user_id == client_id,
                    VerificationToken.purpose == TokenPurpose.PASSWORD_RESET,
                )
            )
        ).scalars().first()
        assert tok is not None and tok.used_at is None
        assert tok.token_hash and len(tok.token_hash) == 64  # sha256 hex

        # Eldeki refresh token artık ÇALIŞMAZ (rotate reddedilir).
        rotated = await refresh_token_service.rotate(s, raw_token=raw_refresh)
        assert rotated is None


@pytest.mark.asyncio
async def test_reset_gecersiz_rol_ve_kullanici(rf: ResetFactory):
    async with AsyncSessionLocal() as s:
        with pytest.raises(HTTPException) as exc:
            await admin_service.initiate_password_reset(s, role="admin", user_id=1)
        assert exc.value.status_code == 400
        with pytest.raises(HTTPException) as exc:
            await admin_service.initiate_password_reset(
                s, role="client", user_id=99_999_999
            )
        assert exc.value.status_code == 404
