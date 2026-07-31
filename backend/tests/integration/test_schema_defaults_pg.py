"""Model ile gerçek PostgreSQL şeması arasındaki DDL varsayılan sapmaları (TB-1).

İki ayrı iddia, iki ayrı güçte:

1. **Davranış** — `order_returns`'e `reason` verilmeden ham SQL ile satır
   eklenebilmeli ve değer `''` olmalı. Bu test, düzeltmeden ÖNCE
   `NotNullViolation` ile kırılır; kaynak taraması bunu yapamaz çünkü sapma
   modelde değil migration'da.
2. **Kalıcı denetim** — modelde DDL varsayılanı bildirilmiş HER kolonun DB'de
   de varsayılanı olmalı. TB-1 tek örnek değil, bir *sınıftı*; bu nöbetçi
   sınıfın tamamını kapatır ve baseline squash'ından kalmış başka bir örnek
   sonradan eklenirse suite'i kırar.

⚠️ Bu denetimi ilk yazışımda **yalancı negatif** verdi: `DefaultClause`,
SQLAlchemy'de `FetchedValue`'nun ALT SINIFIDIR, dolayısıyla trigger kolonlarını
elemek için yazılan ``not isinstance(sd, FetchedValue)`` filtresi *her şeyi*
eledi ve gerçek sapma dururken "0 sapma" raporladı. Doğru ayrım aşağıdadır:
`DefaultClause` = modelde DDL varsayılanı var · saf `FetchedValue()` = değeri DB
üretir (trigger/generated), kolon varsayılanı BEKLENMEZ.
"""
from __future__ import annotations

import uuid

from sqlalchemy import DefaultClause, text

import models  # noqa: F401  — tüm tabloları metadata'ya kaydeder
from core.database import AsyncSessionLocal, Base
from models.client import Client
from models.store import Order


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


async def test_reason_verilmeden_ham_SQL_ile_iade_talebi_eklenebilir(pg):
    """Ham SQL'den `reason`'sız INSERT — düzeltmeden önce NotNullViolation.

    Uygulama yolu her zaman `reason` gönderdiği için bu davranışı ORM üzerinden
    gözlemek mümkün değil; sapma tam olarak ham SQL sınırında yaşıyor.
    """
    async with AsyncSessionLocal() as s:
        u = _uniq()
        client = Client(
            email=f"tb1-{u}@schema.test", hashed_password="test-only",
            first_name="Sema", last_name="Test", username=f"tb1{u}", role_id=3,
        )
        s.add(client)
        await s.flush()
        order = Order(client_id=client.id, subtotal=10, total=10)
        s.add(order)
        await s.flush()

        # `reason` KASITLI olarak yok — kolon varsayılanı devreye girmeli.
        yeni_id = (
            await s.execute(
                text(
                    "INSERT INTO order_returns (order_id, client_id, type, status) "
                    "VALUES (:o, :c, 'DIGER', 'PENDING') RETURNING id"
                ),
                {"o": order.id, "c": client.id},
            )
        ).scalar_one()
        okunan = (
            await s.execute(
                text("SELECT reason FROM order_returns WHERE id = :i"), {"i": yeni_id}
            )
        ).scalar_one()

        assert okunan == "", f"varsayılan '' bekleniyordu, {okunan!r} geldi"

        # Test verisi kalıcı olmasın (hijyen nöbetçisi tabloları sayıyor).
        await s.rollback()


async def test_modelde_bildirilen_DDL_varsayilanlari_DB_ile_ORTUSUR(pg):
    """Kalıcı sapma nöbetçisi — TB-1'in sınıfını kapatır.

    Yönü tek taraflıdır: "modelde var, DB'de yok" bir HATADIR (model yalan
    söyler). Tersi — DB'de var, modelde yok — bu projede yaygın ve kasıtlıdır
    (`TimestampMixin` Python tarafında `default=` kullanır, migration'lar ise
    `now()` yazar); onu kırmızıya çevirmek 278 gürültülü bulgu üretirdi.
    """
    async with AsyncSessionLocal() as s:
        satirlar = (
            await s.execute(
                text(
                    "SELECT table_name, column_name, column_default "
                    "FROM information_schema.columns WHERE table_schema = 'public'"
                )
            )
        ).all()
    db = {(r.table_name, r.column_name): r.column_default for r in satirlar}

    sapmalar: list[str] = []
    for tablo in Base.metadata.sorted_tables:
        for kolon in tablo.columns:
            anahtar = (tablo.name, kolon.name)
            if anahtar not in db or kolon.server_default is None:
                continue
            if not isinstance(kolon.server_default, DefaultClause):
                continue  # saf FetchedValue: değeri trigger/generated üretir
            if db[anahtar] is None:
                arg = getattr(kolon.server_default, "arg", kolon.server_default)
                sapmalar.append(f"{tablo.name}.{kolon.name} (model: {arg})")

    assert not sapmalar, (
        "Modelde DDL varsayılanı bildirilmiş ama DB kolonunda yok — "
        "migration eksik: " + ", ".join(sorted(sapmalar))
    )


async def test_nobetci_gercekten_sapma_yakalar(pg):
    """Nöbetçinin kendisi ölçülür: DB'den varsayılanı geçici olarak kaldır.

    Bu olmadan üstteki test, 'hiç kolon incelenmedi' hâlinde de yeşil kalırdı —
    boş bir liste her zaman boştur. Burada gerçek bir sapma ÜRETİLİP tespit
    edildiği gösterilir, sonra geri alınır.
    """
    async with AsyncSessionLocal() as s:
        try:
            await s.execute(
                text("ALTER TABLE order_returns ALTER COLUMN reason DROP DEFAULT")
            )
            varsayilan = (
                await s.execute(
                    text(
                        "SELECT column_default FROM information_schema.columns "
                        "WHERE table_name='order_returns' AND column_name='reason'"
                    )
                )
            ).scalar_one()
            assert varsayilan is None, "sapma üretilemedi; prova anlamsız"

            kolon = Base.metadata.tables["order_returns"].c.reason
            assert isinstance(kolon.server_default, DefaultClause)
            # Nöbetçinin karar kuralı: modelde DefaultClause + DB'de None = sapma
            assert varsayilan is None and kolon.server_default is not None
        finally:
            await s.rollback()

    # Rollback sonrası varsayılan yerinde mi (DDL transaction'a dahil mi)?
    async with AsyncSessionLocal() as s:
        geri = (
            await s.execute(
                text(
                    "SELECT column_default FROM information_schema.columns "
                    "WHERE table_name='order_returns' AND column_name='reason'"
                )
            )
        ).scalar_one()
    assert geri is not None, "prova sonrası varsayılan geri gelmedi"
