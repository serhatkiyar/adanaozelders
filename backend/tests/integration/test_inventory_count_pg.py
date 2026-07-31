"""F29 sayım oturumu — GERÇEK PostgreSQL davranışı.

Kapsam: FSM geçişleri · kova bazlı tekillik · dijital ürün reddi · boş oturum ·
`STALE` satırın atomik uygulamayı engellemesi · retry replay'i · ikinci apply
isteğinin reddi · sıfır fark.

Kurulum ve güvenlik kilidi `tests/integration/conftest.py` (`pg` fixture'ı
`assert_test_database()` çağırır). Veri `inventory_factory.Fabrika` ile
üretilir ve teardown'da FİZİKSEL olarak silinir.

Paketin ilk test commit'i olduğu için implementasyon yok: koşum KIRMIZIDIR.
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from tests.integration.inventory_factory import Fabrika, now
from tests.inventory_api import servis, uye

SERVIS = "services.inventory_service"
ADMIN_ID = 1


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


async def _oturum_ac(pid: int, *, admin_id: int = ADMIN_ID, bucket: str = "SALEABLE"):
    """DRAFT → IN_PROGRESS; tek ürünlük elle kapsam."""
    s_mod = servis()
    async with AsyncSessionLocal() as db:
        oturum = await s_mod.create_session(
            db, scope="MANUAL", product_ids=[pid], admin_id=admin_id
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await s_mod.start_session(db, sid, admin_id=admin_id)
        await db.commit()
    return sid


async def _satir(sid: int, pid: int, bucket: str = "SALEABLE") -> int:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text(
                    "SELECT id FROM stock_count_lines WHERE session_id = :s "
                    "AND product_id = :p AND bucket = :b"
                ),
                {"s": sid, "p": pid, "b": bucket},
            )
        ).scalar_one()


async def _durum(sid: int) -> str:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text("SELECT status FROM stock_count_sessions WHERE id = :i"), {"i": sid}
            )
        ).scalar_one()


# ── FSM ────────────────────────────────────────────────────────────────────

async def test_mutlu_yol_DRAFT_IN_PROGRESS_REVIEW_APPLIED(fab):
    pid = await fab.urun(stock=10)
    s_mod = servis()
    sid = await _oturum_ac(pid)
    assert await _durum(sid) == "IN_PROGRESS"

    async with AsyncSessionLocal() as db:
        await s_mod.set_counted(db, await _satir(sid, pid), 8, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    assert await _durum(sid) == "REVIEW"

    async with AsyncSessionLocal() as db:
        await s_mod.apply_session(db, sid, admin_id=ADMIN_ID, idempotency_key="k1")
        await db.commit()
    assert await _durum(sid) == "APPLIED"
    assert await fab.stok(pid) == 8


async def test_IN_PROGRESSten_dogrudan_APPLIED_REDDEDILIR(fab):
    pid = await fab.urun(stock=5)
    sid = await _oturum_ac(pid)
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await servis().apply_session(
                db, sid, admin_id=ADMIN_ID, idempotency_key="k"
            )
    assert getattr(exc.value, "status_code", None) == 409
    assert await _durum(sid) == "IN_PROGRESS"


async def test_REVIEWden_IN_PROGRESSe_donus_ONAYI_TEMIZLER(fab):
    """Geri dönüş, eski gözden geçirmeyi geçersiz kılar: yeni sayı eski onayla
    uygulanamaz."""
    pid = await fab.urun(stock=5)
    s_mod = servis()
    sid = await _oturum_ac(pid)
    async with AsyncSessionLocal() as db:
        await s_mod.set_counted(db, await _satir(sid, pid), 5, admin_id=ADMIN_ID)
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.reopen_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        satir = (
            await db.execute(
                text(
                    "SELECT status, reviewed_by_admin_id, reviewed_at "
                    "FROM stock_count_sessions WHERE id = :i"
                ),
                {"i": sid},
            )
        ).one()
    assert satir.status == "IN_PROGRESS"
    assert satir.reviewed_by_admin_id is None and satir.reviewed_at is None


async def test_APPLIED_oturum_iptal_EDILEMEZ(fab):
    pid = await fab.urun(stock=3)
    s_mod = servis()
    sid = await _oturum_ac(pid)
    async with AsyncSessionLocal() as db:
        await s_mod.set_counted(db, await _satir(sid, pid), 3, admin_id=ADMIN_ID)
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.apply_session(db, sid, admin_id=ADMIN_ID, idempotency_key="k")
        await db.commit()
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await s_mod.cancel_session(db, sid, admin_id=ADMIN_ID, reason="olmaz")
    assert getattr(exc.value, "status_code", None) == 409


# ── Kova bazlı tekillik ────────────────────────────────────────────────────

async def test_ayni_urun_ayni_kovada_IKI_KEZ_bulunamaz(fab):
    pid = await fab.urun(stock=4)
    sid = await _oturum_ac(pid)
    with pytest.raises(Exception):
        async with AsyncSessionLocal() as db:
            await servis().add_products(db, sid, [pid], admin_id=ADMIN_ID)
            await db.commit()
    async with AsyncSessionLocal() as db:
        adet = (
            await db.execute(
                text(
                    "SELECT count(*) FROM stock_count_lines "
                    "WHERE session_id = :s AND product_id = :p AND bucket = 'SALEABLE'"
                ),
                {"s": sid, "p": pid},
            )
        ).scalar_one()
    assert adet == 1


async def test_ayni_urun_IKI_FARKLI_kovada_bulunabilir(fab):
    """Kova ayrımının varlık sebebi: hasarlı sayımı satılabilirden bağımsızdır."""
    pid = await fab.urun(stock=4)
    sid = await _oturum_ac(pid)
    async with AsyncSessionLocal() as db:
        kovalar = (
            await db.execute(
                text(
                    "SELECT bucket FROM stock_count_lines "
                    "WHERE session_id = :s AND product_id = :p ORDER BY bucket"
                ),
                {"s": sid, "p": pid},
            )
        ).scalars().all()
    assert kovalar == ["DAMAGED", "SALEABLE"]


# ── Dijital ürün ───────────────────────────────────────────────────────────

async def test_dijital_urun_sayima_EKLENEMEZ(fab):
    pid = await fab.urun(stock=None, kind="DIGITAL")
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await servis().create_session(
                db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 400


async def test_stogu_takip_edilmeyen_FIZIKSEL_urun_de_EKLENEMEZ(fab):
    """`stock IS NULL` = 'takip edilmiyor'. Fiziksel görünse de sayılamaz;
    aksi hâlde sayım ona bir bakiye uydururdu."""
    pid = await fab.urun(stock=None, kind="PHYSICAL")
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await servis().create_session(
                db, scope="MANUAL", product_ids=[pid], admin_id=ADMIN_ID
            )
    assert getattr(exc.value, "status_code", None) == 400


# ── Boş oturum ─────────────────────────────────────────────────────────────

async def test_hic_sayilmamis_oturum_REVIEWe_GECEMEZ(fab):
    pid = await fab.urun(stock=6)
    sid = await _oturum_ac(pid)
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await servis().submit_session(db, sid, admin_id=ADMIN_ID)
    assert getattr(exc.value, "status_code", None) == 400
    assert await _durum(sid) == "IN_PROGRESS"


async def test_farklari_SIFIR_olan_oturum_uygulanir_ama_HAREKET_YAZMAZ(fab):
    """'Sayıldı, fark yok' geçerli ve değerli bir sonuçtur; gürültü satırı değil."""
    pid = await fab.urun(stock=7)
    s_mod = servis()
    once = await fab.hareket_sayisi(pid)
    sid = await _oturum_ac(pid)
    async with AsyncSessionLocal() as db:
        await s_mod.set_counted(db, await _satir(sid, pid), 7, admin_id=ADMIN_ID)
        await s_mod.set_counted(db, await _satir(sid, pid, "DAMAGED"), 0, admin_id=ADMIN_ID)
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.apply_session(db, sid, admin_id=ADMIN_ID, idempotency_key="k")
        await db.commit()
    assert await _durum(sid) == "APPLIED"
    assert await fab.hareket_sayisi(pid) == once
    assert await fab.stok(pid) == 7


# ── STALE ve atomiklik ─────────────────────────────────────────────────────

async def test_STALE_satir_TUM_oturumun_uygulanmasini_engeller(fab):
    """Atomiklik: iki üründen biri belirsizse **hiçbiri** uygulanmaz.

    Kısmi uygulama olsaydı temiz satır yazılır, `STALE` satır beklerdi ve
    oturum yarım `APPLIED` durumunda kalırdı — direktifle yasak.
    """
    temiz = await fab.urun(stock=10)
    belirsiz = await fab.urun(stock=10)
    s_mod = servis()
    async with AsyncSessionLocal() as db:
        oturum = await s_mod.create_session(
            db, scope="MANUAL", product_ids=[temiz, belirsiz], admin_id=ADMIN_ID
        )
        await db.commit()
        sid = oturum.id
    async with AsyncSessionLocal() as db:
        await s_mod.start_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.set_counted(db, await _satir(sid, temiz), 9, admin_id=ADMIN_ID)
        await s_mod.set_counted(db, await _satir(sid, belirsiz), 9, admin_id=ADMIN_ID)
        await db.commit()

    # Sayımdan SONRA fiziksel etkisi BELİRSİZ bir olay: admin elle düzeltmesi.
    async with AsyncSessionLocal() as db:
        from services import stock_ledger

        await stock_ledger.apply_movement(
            db, belirsiz,
            bucket=stock_ledger.StockBucket.SALEABLE,
            qty_delta=+1,
            movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="HATALI_GIRIS",
            actor_type="ADMIN", actor_id=ADMIN_ID,
        )
        await db.commit()

    async with AsyncSessionLocal() as db:
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()

    temiz_once = await fab.stok(temiz)
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await s_mod.apply_session(db, sid, admin_id=ADMIN_ID, idempotency_key="k")
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 409
    assert await _durum(sid) == "REVIEW"
    assert await fab.stok(temiz) == temiz_once, "temiz satır da yazılmamalıydı"


async def test_STALE_satir_yeniden_sayilinca_uygulanabilir(fab):
    pid = await fab.urun(stock=10)
    s_mod = servis()
    sid = await _oturum_ac(pid)
    async with AsyncSessionLocal() as db:
        await s_mod.set_counted(db, await _satir(sid, pid), 9, admin_id=ADMIN_ID)
        await s_mod.set_counted(db, await _satir(sid, pid, "DAMAGED"), 0, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        from services import stock_ledger

        await stock_ledger.apply_movement(
            db, pid, qty_delta=+1,
            bucket=stock_ledger.StockBucket.SALEABLE,
            movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
            reason_code="HATALI_GIRIS", actor_type="ADMIN", actor_id=ADMIN_ID,
        )
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        satir = (
            await db.execute(
                text("SELECT status FROM stock_count_lines WHERE id = :i"),
                {"i": await _satir(sid, pid)},
            )
        ).scalar_one()
    assert satir == "STALE"

    # Yeniden say → belirsizlik giderildi
    async with AsyncSessionLocal() as db:
        await s_mod.reopen_session(db, sid, admin_id=ADMIN_ID)
        await s_mod.set_counted(db, await _satir(sid, pid), 11, admin_id=ADMIN_ID)
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.apply_session(db, sid, admin_id=ADMIN_ID, idempotency_key="k")
        await db.commit()
    assert await _durum(sid) == "APPLIED"
    assert await fab.stok(pid) == 11


# ── Retry / ikinci apply ───────────────────────────────────────────────────

async def _uygulanmis_oturum(fab, pid: int, sayilan: int) -> int:
    s_mod = servis()
    sid = await _oturum_ac(pid)
    async with AsyncSessionLocal() as db:
        await s_mod.set_counted(db, await _satir(sid, pid), sayilan, admin_id=ADMIN_ID)
        await s_mod.set_counted(db, await _satir(sid, pid, "DAMAGED"), 0, admin_id=ADMIN_ID)
        await s_mod.submit_session(db, sid, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        await s_mod.apply_session(db, sid, admin_id=ADMIN_ID, idempotency_key="idem-1")
        await db.commit()
    return sid


async def test_AYNI_anahtarla_retry_REPLAY_eder(fab):
    """Ağ koptu, istemci aynı isteği tekrarladı: yeni hareket YAZILMAZ."""
    pid = await fab.urun(stock=10)
    sid = await _uygulanmis_oturum(fab, pid, 8)
    hareket = await fab.hareket_sayisi(pid)
    stok = await fab.stok(pid)

    async with AsyncSessionLocal() as db:
        await servis().apply_session(
            db, sid, admin_id=ADMIN_ID, idempotency_key="idem-1"
        )
        await db.commit()

    assert await fab.hareket_sayisi(pid) == hareket
    assert await fab.stok(pid) == stok
    assert await _durum(sid) == "APPLIED"


async def test_FARKLI_anahtarla_ikinci_apply_REDDEDILIR(fab):
    """Kullanıcı ikinci kez 'Uygula'ya bastı: açık 'zaten uygulandı' cevabı."""
    pid = await fab.urun(stock=10)
    sid = await _uygulanmis_oturum(fab, pid, 8)
    hareket = await fab.hareket_sayisi(pid)

    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await servis().apply_session(
                db, sid, admin_id=ADMIN_ID, idempotency_key="idem-2"
            )
    assert getattr(exc.value, "status_code", None) == 409
    assert await fab.hareket_sayisi(pid) == hareket


# ── counted_at otoritesi ───────────────────────────────────────────────────

async def test_counted_at_SUNUCU_zamanidir(fab):
    """İstemci saati/cihaz saati uzlaştırmanın güven kaynağı olamaz."""
    pid = await fab.urun(stock=5)
    sid = await _oturum_ac(pid)
    once = now()
    async with AsyncSessionLocal() as db:
        await servis().set_counted(db, await _satir(sid, pid), 5, admin_id=ADMIN_ID)
        await db.commit()
    sonra = now()
    async with AsyncSessionLocal() as db:
        ts = (
            await db.execute(
                text("SELECT counted_at FROM stock_count_lines WHERE id = :i"),
                {"i": await _satir(sid, pid)},
            )
        ).scalar_one()
    assert once <= ts <= sonra, "counted_at sunucu zamanı aralığında değil"


async def test_set_counted_ISTEMCI_ZAMANI_KABUL_ETMEZ(fab):
    """Sözleşme: fonksiyon `counted_at` parametresi almaz. Alsaydı, istemci
    geçmişe tarih atıp uzlaştırmayı istediği yöne çevirebilirdi."""
    import inspect

    f = uye(SERVIS, "set_counted")
    assert "counted_at" not in inspect.signature(f).parameters


async def test_yeniden_sayim_ESKI_DEGERI_korur_ve_counted_at_YENILER(fab):
    # İkinci admin GERÇEK olmalı: aktör kolonları `admins`'e RESTRICT FK ile
    # bağlı, uydurma bir id FK ihlaliyle patlar (kayıt aktörünü kaybedemez).
    ikinci_admin = await fab.admin()
    pid = await fab.urun(stock=5)
    sid = await _oturum_ac(pid)
    line_id = await _satir(sid, pid)
    async with AsyncSessionLocal() as db:
        await servis().set_counted(db, line_id, 4, admin_id=ADMIN_ID)
        await db.commit()
    async with AsyncSessionLocal() as db:
        ilk = (
            await db.execute(
                text("SELECT counted_at FROM stock_count_lines WHERE id = :i"),
                {"i": line_id},
            )
        ).scalar_one()
    async with AsyncSessionLocal() as db:
        await servis().set_counted(db, line_id, 6, admin_id=ikinci_admin)
        await db.commit()
    async with AsyncSessionLocal() as db:
        satir = (
            await db.execute(
                text(
                    "SELECT counted_qty, counted_at, counted_by_admin_id "
                    "FROM stock_count_lines WHERE id = :i"
                ),
                {"i": line_id},
            )
        ).one()
        olaylar = (
            await db.execute(
                text(
                    "SELECT old_qty, new_qty FROM stock_count_line_events "
                    "WHERE line_id = :i ORDER BY id"
                ),
                {"i": line_id},
            )
        ).all()
    assert satir.counted_qty == 6
    assert satir.counted_at > ilk
    assert satir.counted_by_admin_id == ikinci_admin
    assert [(o.old_qty, o.new_qty) for o in olaylar] == [(None, 4), (4, 6)]


# ── Negatif miktar ─────────────────────────────────────────────────────────

async def test_negatif_sayim_miktari_REDDEDILIR(fab):
    pid = await fab.urun(stock=5)
    sid = await _oturum_ac(pid)
    with pytest.raises(Exception):
        async with AsyncSessionLocal() as db:
            await servis().set_counted(db, await _satir(sid, pid), -1, admin_id=ADMIN_ID)
            await db.commit()
