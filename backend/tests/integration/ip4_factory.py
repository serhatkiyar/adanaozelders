"""İP-4 (admin operasyon yüzeyi) kabul testleri için gerçek veri fabrikası.

Sözleşme: `docs/ip4-admin-operasyon-sozlesme.md`.

Bu fabrika **stub kullanmaz**: her sıkışmış iade gerçek `orders`/`order_returns`
satırıdır, her ölü iş gerçek `outbox_events` satırıdır, her admin gerçek rol +
izin satırlarına ve gerçek imzalı JWT'ye sahiptir. Sebep somut: İP-4'ün iddiası
"yönetici sıkışmış parayı GÖREBİLİYOR" — sahte nesnelerle kurulan bir liste tam
olarak ölçülmek isteneni (hangi satırın kuyruğa girdiği) atlar.

Sipariş/iade/ürün/admin üretimi İP-2a fabrikasından DEVRALINIR
(`ip2a_factory.IadeFabrikasi`); İP-4 yalnız kendi eksiklerini ekler:

* ``sikismis_iade`` / ``sikismis_siparis`` — otomatik denemeleri tükenmiş ya da
  MANUAL_REVIEW'a düşmüş para kayıtları,
* ``outbox`` — dead-letter (FAILED) ve sağlıklı (PENDING/SENT) iş satırları,
* ``egitmen`` — onay kuyruğu uçları için gerçek `tutors` satırı.

Temizlik YALNIZ fabrikanın kaydettiği kimliklerle yapılır; global TRUNCATE yok.
"""
from __future__ import annotations

import datetime
import uuid
from decimal import Decimal

from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.outbox import OutboxEvent, OutboxStatus
from models.role import ROLE_IDS, RoleType
from models.tutor import Tutor, TutorStatus
from tests.integration.auth_headers import bearer_headers
from tests.integration.ip2a_factory import IadeFabrikasi, now, uniq


class IP4Fabrika(IadeFabrikasi):
    """İP-2a fabrikası + admin operasyon yüzeyinin ihtiyaç duyduğu tohumlar."""

    def __init__(self) -> None:
        super().__init__()
        self.outbox_ids: list[int] = []
        self.tutor_ids: list[int] = []

    # ── Sıkışmış para ────────────────────────────────────────────────────────

    async def sikismis_iade(
        self,
        *,
        order_id: int,
        client_id: int,
        items: list[tuple[int, int, str]],
        refund_amount: str = "50.00",
        refund_status: str = "REFUNDING",
        refund_attempts: int = 3,
        provider_ref: str | None = "pay-tx-ip4",
    ) -> int:
        """İade TALEBİ + para durumu (REFUNDING/MANUAL_REVIEW) + deneme sayacı.

        `refund_attempts` bilinçli olarak parametredir: kuyruğun eşiği
        `REFUND_MAX_ATTEMPTS`'tir ve eşiğin ALTINDAKİ kaydın kuyruğa
        GİRMEMESİ de sözleşmenin parçasıdır (aksi hâlde ekran, reconciler'ın
        birkaç dakika sonra kendiliğinden çözeceği her kaydı alarm sayar).
        """
        return_id = await self.iade_tohumla(
            order_id=order_id,
            client_id=client_id,
            items=items,
            status="APPROVED",
            refund_amount=refund_amount,
        )
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "UPDATE order_returns SET refund_status = :st, "
                    "refund_attempts = :n, refund_requested_at = :t, "
                    "provider_ref = :ref WHERE id = :i"
                ),
                {
                    "st": refund_status,
                    "n": refund_attempts,
                    "t": now() - datetime.timedelta(hours=3),
                    "ref": provider_ref,
                    "i": return_id,
                },
            )
            await s.commit()
        return return_id

    async def siparis_para_durumu(
        self,
        order_id: int,
        *,
        payment_status: str,
        refund_attempts: int = 3,
    ) -> None:
        """Siparişin PARA durumunu doğrudan kurar (sipariş yaşam döngüsü ayrı)."""
        async with AsyncSessionLocal() as s:
            await s.execute(
                text(
                    "UPDATE orders SET payment_status = :st, refund_attempts = :n, "
                    "refund_requested_at = :t WHERE id = :i"
                ),
                {
                    "st": payment_status,
                    "n": refund_attempts,
                    "t": now() - datetime.timedelta(hours=3),
                    "i": order_id,
                },
            )
            await s.commit()

    # ── Ölü iş (outbox dead-letter) ──────────────────────────────────────────

    async def outbox(
        self,
        *,
        kind: str = "sms:failed",
        payload: dict | None = None,
        status: str = OutboxStatus.FAILED.value,
        attempts: int = 5,
        last_error: str | None = "SMSGatewayError: 503",
    ) -> int:
        """Gerçek `outbox_events` satırı.

        Varsayılan payload BİLİNÇLİ olarak kişisel veri taşır (telefon):
        "ham payload yanıtta sızmıyor" iddiasının boş küme üzerinde geçmemesi
        için (kök `CLAUDE.md` §E).
        """
        async with AsyncSessionLocal() as s:
            ev = OutboxEvent(
                kind=kind,
                payload=payload or {"to": "+905321112233", "order_id": 987654},
                status=status,
                attempts=attempts,
                last_error=last_error,
            )
            s.add(ev)
            await s.commit()
            await s.refresh(ev)
            ev_id = ev.id
        self.outbox_ids.append(ev_id)
        return ev_id

    async def outbox_satiri(self, event_id: int) -> dict:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT status, attempts, next_attempt_at, last_error "
                        "FROM outbox_events WHERE id = :i"
                    ),
                    {"i": event_id},
                )
            ).one()
        return {
            "status": row[0],
            "attempts": row[1],
            "next_attempt_at": row[2],
            "last_error": row[3],
        }

    async def outbox_sayisi(self, *, kind: str) -> int:
        async with AsyncSessionLocal() as s:
            return int(
                (
                    await s.execute(
                        text("SELECT count(*) FROM outbox_events WHERE kind = :k"),
                        {"k": kind},
                    )
                ).scalar_one()
            )

    # ── Eğitmen onay kuyruğu ─────────────────────────────────────────────────

    async def egitmen(self, *, status: TutorStatus = TutorStatus.PENDING_APPROVAL) -> int:
        ek = uniq()
        async with AsyncSessionLocal() as s:
            t = Tutor(
                email=f"ip4t-{ek}@ip4egitmen.example.com",
                hashed_password="test-only",
                first_name="Egitmen",
                last_name=f"IP4{ek[:4]}",
                role_id=ROLE_IDS[RoleType.TUTOR],
                status=status,
                hourly_rate=Decimal("300"),
            )
            s.add(t)
            await s.commit()
            await s.refresh(t)
            tutor_id = t.id
        self.tutor_ids.append(tutor_id)
        return tutor_id

    async def egitmen_durumu(self, tutor_id: int) -> str:
        async with AsyncSessionLocal() as s:
            return str(
                (
                    await s.execute(
                        text("SELECT status FROM tutors WHERE id = :i"), {"i": tutor_id}
                    )
                ).scalar_one()
            )

    async def audit_kaydi(self, *, action: str, target_id: int) -> dict | None:
        async with AsyncSessionLocal() as s:
            row = (
                await s.execute(
                    text(
                        "SELECT reason, details, actor_id FROM audit_logs "
                        "WHERE action = :a AND target_id = :t "
                        "ORDER BY id DESC LIMIT 1"
                    ),
                    {"a": action, "t": target_id},
                )
            ).first()
        if row is None:
            return None
        return {"reason": row[0], "details": row[1], "actor_id": row[2]}

    # ── Temizlik ─────────────────────────────────────────────────────────────

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.outbox_ids:
                await s.execute(
                    text("DELETE FROM outbox_events WHERE id = ANY(:i)"),
                    {"i": self.outbox_ids},
                )
            if self.tutor_ids:
                # Onay/red uçları denetim izi yazar; hijyen nöbetçisi
                # `audit_logs` sayısını karşılaştırdığı için bunlar da gider.
                await s.execute(
                    text(
                        "DELETE FROM audit_logs WHERE target_type = 'tutor' "
                        "AND target_id = ANY(:t)"
                    ),
                    {"t": self.tutor_ids},
                )
                await s.execute(
                    text("DELETE FROM notifications WHERE role_id = 2 AND user_id = ANY(:t)"),
                    {"t": self.tutor_ids},
                )
                await s.execute(
                    text("DELETE FROM tutors WHERE id = ANY(:t)"), {"t": self.tutor_ids}
                )
            await s.commit()
        await super().temizle()


async def admin_basligi(admin_id: int) -> dict[str, str]:
    """Var olan bir admin için gerçek imzalı `Authorization` başlığı."""
    return await bearer_headers(admin_id, role="ADMIN", role_id=1)


__all__ = ["IP4Fabrika", "admin_basligi", "uniq", "now", "uuid"]
