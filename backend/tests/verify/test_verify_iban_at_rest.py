"""IBAN gerçekten şifreli mi yazılıyor? (gerçek Postgres)

Şifreleme TypeDecorator ile şeffaf çalışır: Python tarafı düz metin görür.
Bu yüzden "şifreli saklanıyor" iddiası ancak HAM SQL ile okunarak doğrulanır —
ORM üzerinden bakan bir test, kolon düz metne geri dönse bile geçerdi.
"""
from __future__ import annotations

from sqlalchemy import text

IBAN = "TR330006100519786457841326"


async def test_tutor_ibani_ham_sqlde_okunamaz(db, factory):
    tutor = await factory.tutor(db)
    tutor.iban = IBAN
    await db.commit()

    raw = (
        await db.execute(text("SELECT iban FROM tutors WHERE id = :i"), {"i": tutor.id})
    ).scalar()
    assert raw is not None
    assert IBAN not in raw, "IBAN veritabanına düz metin yazılmış"
    assert raw.startswith("gAAAAA"), "beklenen Fernet token'ı değil"

    # ORM tarafında düz metin görünmeye devam etmeli (aksi halde ödeme
    # sağlayıcısına şifreli değer gönderilirdi).
    db.expunge(tutor)
    again = await db.get(type(tutor), tutor.id)
    assert again.iban == IBAN


async def test_payout_snapshot_da_sifreli(db, factory):
    """Kaynak şifreliyken snapshot düz kalırsa şifreleme anlamsızdır."""
    from decimal import Decimal

    from models.payout import PayoutRecord

    tutor = await factory.tutor(db)
    record = PayoutRecord(
        payee_type="TUTOR",
        payee_id=tutor.id,
        amount=Decimal("100.00"),
        iban_snapshot=IBAN,
        paid_by_admin_id=None,
    )
    db.add(record)
    await db.commit()

    raw = (
        await db.execute(
            text("SELECT iban_snapshot FROM payout_records WHERE id = :i"),
            {"i": record.id},
        )
    ).scalar()
    assert IBAN not in raw
    assert raw.startswith("gAAAAA")
