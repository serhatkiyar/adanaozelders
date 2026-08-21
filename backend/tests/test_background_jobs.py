"""Arka plan döngüsü: hata izolasyonu ve tek-replika kilidi.

Neden: bütün periyodik işler tek `try` bloğundaydı. Görev hatırlatıcısı
patladığında escrow mutabakatı ve teslimat watchdog'u o turda HİÇ çalışmıyordu
— ilgisiz bir bildirim hatası, emanetteki paranın çözülmesini erteliyordu.
Ayrıca döngüler her replikada koştuğundan iki süreç aynı bildirimi iki kez
gönderebiliyordu.

Burada DB yok: `AsyncSessionLocal` sahte bir oturumla değiştirilir, böylece
`_leader_job`'ın kilit alma / hata yutma / kilidi bırakma mantığı doğrudan
sınanır.
"""
from __future__ import annotations

import pytest

import main


class FakeResult:
    def __init__(self, value=None) -> None:
        self._value = value


class FakeSession:
    """`pg_try_advisory_lock` çağrılarını kaydeden asgari oturum."""

    def __init__(self, *, lock_granted: bool = True) -> None:
        self.lock_granted = lock_granted
        self.statements: list[str] = []
        self.committed = False

    async def __aenter__(self) -> "FakeSession":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def scalar(self, stmt, params=None):
        self.statements.append(str(stmt))
        return self.lock_granted

    async def execute(self, stmt, params=None):
        self.statements.append(str(stmt))
        return FakeResult()

    async def commit(self) -> None:
        self.committed = True


@pytest.fixture
def sessions(monkeypatch):
    """Her `AsyncSessionLocal()` çağrısı için yeni sahte oturum üretir."""
    created: list[FakeSession] = []

    def factory(*_a, **_kw):
        s = FakeSession()
        created.append(s)
        return s

    monkeypatch.setattr(main, "AsyncSessionLocal", factory)
    return created


async def test_leader_job_hata_yutar_ve_kilidi_birakir(sessions):
    async def patlayan(_session):
        raise RuntimeError("bilerek")

    # İstisna dışarı SIZMAMALI: yoksa döngü turu tamamen durur.
    await main._leader_job("test", 1, patlayan)

    assert len(sessions) == 1
    stmts = " ".join(sessions[0].statements)
    assert "pg_try_advisory_lock" in stmts
    # İş patlasa bile kilit bırakılmalı — aksi halde diğer replikalar
    # oturum kapanana dek bu işi hiç çalıştıramaz.
    assert "pg_advisory_unlock" in stmts


async def test_kilit_alinamazsa_is_calismaz(monkeypatch):
    """Kilidi başka replika tutuyorsa bu tur sessizce atlanır (bekleme yok)."""
    calls: list[str] = []

    def factory(*_a, **_kw):
        return FakeSession(lock_granted=False)

    monkeypatch.setattr(main, "AsyncSessionLocal", factory)

    async def job(_session):
        calls.append("çalıştı")

    await main._leader_job("test", 1, job)
    assert calls == []


async def test_bir_is_patlarsa_digerleri_yine_calisir(monkeypatch, sessions):
    """Asıl garanti: hatırlatma patlasa da escrow mutabakatı koşar."""
    ran: list[str] = []

    async def patla(*_a, **_kw):
        raise RuntimeError("hatırlatma servisi düştü")

    async def kaydet(name):
        async def _inner(*_a, **_kw):
            ran.append(name)

        return _inner

    monkeypatch.setattr(main.booking_service, "send_due_reminders", patla)
    monkeypatch.setattr(
        main.escrow_reconciler, "reconcile_refunding", await kaydet("escrow_refunding")
    )
    monkeypatch.setattr(
        main.escrow_reconciler, "reconcile_stale_checkouts", await kaydet("escrow_stale")
    )
    monkeypatch.setattr(
        main.delivery_service, "expire_stale_runs", await kaydet("teslimat_watchdog")
    )

    await main._reminder_tick()

    assert "escrow_refunding" in ran
    assert "escrow_stale" in ran
    assert "teslimat_watchdog" in ran


async def test_kilit_anahtarlari_benzersiz() -> None:
    """Çakışan anahtar, iki farklı işin birbirini bloklaması demektir."""
    keys = [
        main._LOCK_REMINDERS,
        main._LOCK_ESCROW,
        main._LOCK_DELIVERY,
        main._LOCK_OUTBOX,
        main._LOCK_SUPPLIER_SYNC,
    ]
    assert len(keys) == len(set(keys))


async def test_tedarikci_senkronu_kendi_kilidiyle_kosar(monkeypatch, sessions):
    """Tedarikçi taraması tek replikada koşmalı.

    İki replika aynı anda tararsa: aynı satırlar iki kez upsert edilmeye
    çalışılır (`uq_supplier_products_external` çakışması), Yıldırım origin'i
    iki katı istek alır ve otomatik bağlama iki tarafta da "tek eşleşme" görüp
    yarışır. `_leader_job` bunu tek satırla çözer — ama ancak ÇAĞRILIRSA.
    """
    cagri: list[tuple[str, int]] = []

    async def sahte_leader(name, lock_key, job):
        cagri.append((name, lock_key))

    monkeypatch.setattr(main, "_leader_job", sahte_leader)
    await main._supplier_sync_tick()

    assert cagri, "tedarikçi turu `_leader_job` üzerinden geçmiyor"
    assert cagri[0][1] == main._LOCK_SUPPLIER_SYNC


async def test_tedarikci_senkronu_patlarsa_dongu_devam_eder(monkeypatch, sessions):
    """`_run_job` sınırı: senkron her turda patlasa bile döngü ölmemeli."""
    async def patlayan():
        raise RuntimeError("Yıldırım düştü")

    monkeypatch.setattr(main, "_supplier_sync_tick", patlayan)
    # İstisna dışarı SIZMAMALI.
    await main._run_job("tedarikçi senkronu", main._supplier_sync_tick)
