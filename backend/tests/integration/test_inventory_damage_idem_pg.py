"""F29 hasar servisi — idempotency KAPSAMI ve event↔ledger bağı (commit 6 denetimi).

Bu dosya kapanış denetiminde bulunan iki gerçek kusuru kapatır:

1. Idempotency kapsamı **global**di (`uq_stock_damage_events_idem` yalnız
   `idempotency_key`); iki yönetici aynı metni bağımsız kullanamıyordu.
   Kapsam artık `(actor_admin_id, idempotency_key)`.
2. Aynı anahtar **farklı ürünlerde** eşzamanlı geldiğinde ürün kilidi istekleri
   serileştirmiyor, ikisi de INSERT'e gidiyor ve kaybeden ham `IntegrityError`
   (HTTP'de 500) alıyordu. Artık INSERT savepoint içinde; ihlal kontrollü
   409/replay'e çevriliyor.

## Determinizm

Yarış penceresi `sleep` ile değil, **ürün kilidiyle** açılır: bir transaction
kilidi tutarken istekler başlatılır, kilit bırakıldığında hepsi aynı anda
INSERT/flush noktasına gelir. Farklı ürünlerde ise ortak bir "bariyer ürünü"
kilidi kullanılır — kilit bırakılana kadar hiçbir istek ilerleyemez.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from services import inventory_damage, stock_ledger
from tests.integration.inventory_factory import Fabrika

ADMIN_ID = 1


def _uniq() -> str:
    return uuid.uuid4().hex[:10]


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


def _ham_hata_yok(sonuclar) -> None:
    """Beklenen tek hata tipi `HTTPException`; ham DB hatası SIZAMAZ."""
    from fastapi import HTTPException

    for r in sonuclar:
        if not isinstance(r, BaseException):
            continue
        if not isinstance(r, HTTPException):
            raise AssertionError(f"ham hata sızdı (HTTP'de 500 olurdu): {r!r}")
        # `HTTPException(500)` de bir kusurdur: "ham hata değil" diye kabul
        # etmek, servisin kendi 500'ünü görünmez kılardı.
        if r.status_code >= 500:
            raise AssertionError(f"servis 5xx üretti: {r.status_code} {r.detail}")


async def _islem(
    pid: int, *, key: str, admin_id: int = ADMIN_ID, qty: int = 1,
    kind: str = "transfer", bariyer: int | None = None,
):
    """Tek hasar işlemi. `bariyer` verilirse ÖNCE o ürünün kilidi beklenir —
    farklı ürünlerdeki istekleri aynı ana getirmenin deterministik yolu."""
    async with AsyncSessionLocal() as db:
        if bariyer is not None:
            await stock_ledger.lock_products(db, [bariyer])
        fn = {
            "transfer": inventory_damage.damage_transfer,
            "disposal": inventory_damage.damage_disposal,
        }[kind]
        olay = await fn(
            db, pid, qty=qty, reason_code="KIRIK", admin_id=admin_id,
            idempotency_key=key,
        )
        await db.commit()
        return olay.id


async def _olaylar(pid: int) -> int:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text("SELECT count(*) FROM stock_damage_events WHERE product_id = :i"),
                {"i": pid},
            )
        ).scalar_one()


async def _kovalar(pid: int) -> tuple[int, int]:
    async with AsyncSessionLocal() as db:
        r = (
            await db.execute(
                text("SELECT stock, damaged_stock FROM products WHERE id = :i"),
                {"i": pid},
            )
        ).one()
    return int(r.stock), int(r.damaged_stock)


async def _bariyerli_yaris(bariyer: int, gorevler_fn):
    """Ortak bir ürün kilidi tutulurken görevleri başlatır, sonra bırakır.

    Böylece bütün istekler — FARKLI ürünlerde olsalar bile — aynı anda
    ilerlemeye başlar ve `stock_damage_events` INSERT'ine birlikte varır.
    """
    tutan = AsyncSessionLocal()
    try:
        await stock_ledger.lock_products(tutan, [bariyer])
        gorevler = gorevler_fn()
        await asyncio.sleep(0.3)
        assert all(not g.done() for g in gorevler), "bariyer tutmadı"
    finally:
        await tutan.rollback()
        await tutan.close()
    return await asyncio.gather(*gorevler, return_exceptions=True)


# ══════════ 1. Aynı aktör + aynı key + aynı ürün + aynı payload ══════════

async def test_AYNI_urun_AYNI_payload_TEK_event_ve_hareketler_BIR_KEZ(fab):
    pid = await fab.urun(stock=10)
    key = f"k-{_uniq()}"
    sonuclar = await _bariyerli_yaris(
        pid,
        lambda: [
            asyncio.create_task(_islem(pid, key=key, bariyer=pid)) for _ in range(3)
        ],
    )
    _ham_hata_yok(sonuclar)
    basarili = [r for r in sonuclar if not isinstance(r, BaseException)]
    assert len(basarili) == 3, f"üçü de replay/başarı olmalıydı: {sonuclar}"
    assert len(set(basarili)) == 1, "birden fazla olay üretildi"
    assert await _olaylar(pid) == 1
    assert await _kovalar(pid) == (9, 1)
    async with AsyncSessionLocal() as db:
        hareket = (
            await db.execute(
                text(
                    "SELECT count(*) FROM stock_movements WHERE ref_type = "
                    "'damage_event' AND ref_id = :i"
                ),
                {"i": basarili[0]},
            )
        ).scalar_one()
    assert hareket == 2, "ledger bacakları tam bir kez olmalı"


# ══════════ 2. Aynı aktör + aynı key + FARKLI ürün ══════════

async def test_FARKLI_urun_ayni_key_TAM_OLARAK_BIRI_kazanir(fab):
    """Ürün kilidi bu iki isteği serileştirmez — garanti composite unique
    index'ten gelir. Kaybeden **kontrollü 409** almalı, ham hata değil."""
    bariyer = await fab.urun(stock=1)
    a = await fab.urun(stock=10)
    b = await fab.urun(stock=10)
    key = f"k-{_uniq()}"

    sonuclar = await _bariyerli_yaris(
        bariyer,
        lambda: [
            asyncio.create_task(_islem(a, key=key, bariyer=bariyer)),
            asyncio.create_task(_islem(b, key=key, bariyer=bariyer)),
        ],
    )
    _ham_hata_yok(sonuclar)
    basarili = [r for r in sonuclar if not isinstance(r, BaseException)]
    hatalar = [r for r in sonuclar if isinstance(r, BaseException)]
    assert len(basarili) == 1, f"tam olarak biri kazanmalıydı: {sonuclar}"
    assert len(hatalar) == 1
    assert getattr(hatalar[0], "status_code", None) == 409, hatalar[0]
    assert "product_id" in str(hatalar[0].detail)
    # Kaybeden ürünün bakiyesi hiç değişmemeli.
    toplam = await _olaylar(a) + await _olaylar(b)
    assert toplam == 1
    assert {await _kovalar(a), await _kovalar(b)} == {(9, 1), (10, 0)}


# ══════════ 3. Aynı key + aynı ürün + FARKLI qty ══════════

async def test_AYNI_urun_FARKLI_qty_biri_409(fab):
    pid = await fab.urun(stock=10)
    key = f"k-{_uniq()}"
    await _islem(pid, key=key, qty=2)
    with pytest.raises(Exception) as exc:
        await _islem(pid, key=key, qty=5)
    assert getattr(exc.value, "status_code", None) == 409
    assert "qty" in str(exc.value.detail)
    assert await _kovalar(pid) == (8, 2), "ikinci isteğin bakiye etkisi olmamalı"
    assert await _olaylar(pid) == 1


async def test_ESZAMANLI_FARKLI_qty_biri_409(fab):
    pid = await fab.urun(stock=10)
    key = f"k-{_uniq()}"
    sonuclar = await _bariyerli_yaris(
        pid,
        lambda: [
            asyncio.create_task(_islem(pid, key=key, qty=2, bariyer=pid)),
            asyncio.create_task(_islem(pid, key=key, qty=5, bariyer=pid)),
        ],
    )
    _ham_hata_yok(sonuclar)
    hatalar = [r for r in sonuclar if isinstance(r, BaseException)]
    assert len(hatalar) == 1 and hatalar[0].status_code == 409
    assert await _olaylar(pid) == 1


# ══════════ 4. Aynı key + FARKLI işlem türü ══════════

async def test_AYNI_key_FARKLI_islem_turu_409(fab):
    pid = await fab.urun(stock=10)
    key = f"k-{_uniq()}"
    await _islem(pid, key=key, qty=3, kind="transfer")     # 7 / 3
    with pytest.raises(Exception) as exc:
        await _islem(pid, key=key, qty=3, kind="disposal")
    assert getattr(exc.value, "status_code", None) == 409
    detay = str(exc.value.detail)
    assert "kind" in detay or "source_bucket" in detay, detay
    assert await _kovalar(pid) == (7, 3)
    assert await _olaylar(pid) == 1


# ══════════ 5. Kapsam AKTÖR bazlı ══════════

async def test_IKI_AYRI_ADMIN_ayni_metinsel_key_BAGIMSIZ(fab):
    """Kapsam `(actor_admin_id, idempotency_key)`: anahtar isteği gönderenin
    kendi alanıdır. Global kapsamda ikinci yönetici sebepsiz 409 alırdı."""
    ikinci = await fab.admin()
    pid = await fab.urun(stock=10)
    ortak = "gunluk-hasar-1"
    ilk = await _islem(pid, key=ortak, admin_id=ADMIN_ID, qty=2)
    digeri = await _islem(pid, key=ortak, admin_id=ikinci, qty=3)
    assert ilk != digeri, "ikinci yönetici birincinin olayını replay etti"
    assert await _olaylar(pid) == 2
    assert await _kovalar(pid) == (5, 5)


async def test_AYNI_ADMIN_ayni_key_farkli_urun_ARDISIK_da_409(fab):
    """Eşzamanlı olmayan hâlde de kapsam aynı: aynı aktör + aynı anahtar."""
    a = await fab.urun(stock=10)
    b = await fab.urun(stock=10)
    key = f"k-{_uniq()}"
    await _islem(a, key=key)
    with pytest.raises(Exception) as exc:
        await _islem(b, key=key)
    assert getattr(exc.value, "status_code", None) == 409
    assert "product_id" in str(exc.value.detail)
    assert await _kovalar(b) == (10, 0)


# ══════════ DIGER notu semantik payload ══════════

async def test_DIGER_notu_FARKLIYSA_ayni_key_CATISIR(fab):
    """`DIGER`'de anlam notta durur; farklı açıklama farklı iştir."""
    pid = await fab.urun(stock=10)
    key = f"k-{_uniq()}"
    async with AsyncSessionLocal() as db:
        await inventory_damage.damage_transfer(
            db, pid, qty=1, reason_code="DIGER", note="rafta ezilmiş",
            admin_id=ADMIN_ID, idempotency_key=key,
        )
        await db.commit()
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_damage.damage_transfer(
                db, pid, qty=1, reason_code="DIGER", note="nakliyede ıslanmış",
                admin_id=ADMIN_ID, idempotency_key=key,
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 409
    assert "note" in str(exc.value.detail)
    assert await _kovalar(pid) == (9, 1)


async def test_DIGER_notu_AYNIYSA_REPLAY(fab):
    pid = await fab.urun(stock=10)
    key = f"k-{_uniq()}"
    for _ in range(2):
        async with AsyncSessionLocal() as db:
            await inventory_damage.damage_transfer(
                db, pid, qty=1, reason_code="DIGER", note="rafta ezilmiş",
                admin_id=ADMIN_ID, idempotency_key=key,
            )
            await db.commit()
    assert await _olaylar(pid) == 1
    assert await _kovalar(pid) == (9, 1)


async def test_DIGER_DISI_gerekcede_not_payload_DISINDA(fab):
    """Sözleşme: `DIGER` dışında not karşılaştırmaya girmez → replay olur ve
    **yeni not sessizce yazılmaz** (olay append-only'dir)."""
    pid = await fab.urun(stock=10)
    key = f"k-{_uniq()}"
    async with AsyncSessionLocal() as db:
        olay = await inventory_damage.damage_transfer(
            db, pid, qty=1, reason_code="KIRIK", note="ilk not",
            admin_id=ADMIN_ID, idempotency_key=key,
        )
        await db.commit()
        olay_id = olay.id
    async with AsyncSessionLocal() as db:
        tekrar = await inventory_damage.damage_transfer(
            db, pid, qty=1, reason_code="KIRIK", note="BASKA not",
            admin_id=ADMIN_ID, idempotency_key=key,
        )
        await db.commit()
    assert tekrar.id == olay_id
    async with AsyncSessionLocal() as db:
        not_alan = (
            await db.execute(
                text("SELECT note FROM stock_damage_events WHERE id = :i"),
                {"i": olay_id},
            )
        ).scalar_one()
    assert not_alan == "ilk not", "yeni not sessizce yazıldı"


# ══════════ Actor sözleşmesi ══════════

async def test_OLMAYAN_ADMIN_ile_hasar_islemi_REDDEDILIR(fab):
    """Aktör FK ile korunur: uydurma bir kimlik DB'de tutunamaz."""
    from sqlalchemy.exc import DBAPIError, IntegrityError

    pid = await fab.urun(stock=10)
    with pytest.raises((IntegrityError, DBAPIError)):
        async with AsyncSessionLocal() as db:
            await inventory_damage.damage_transfer(
                db, pid, qty=1, reason_code="KIRIK", admin_id=99_999_999
            )
            await db.commit()
    assert await _kovalar(pid) == (10, 0)
    assert await _olaylar(pid) == 0


def test_hasar_metotlari_ADMIN_ID_zorunlu_ister():
    """Sözleşme: `admin_id` varsayılanı YOKTUR; aktörsüz hasar yazılamaz."""
    import inspect

    for fn in (
        inventory_damage.damage_transfer,
        inventory_damage.damage_recovery,
        inventory_damage.damage_disposal,
        inventory_damage.supplier_return,
    ):
        par = inspect.signature(fn).parameters["admin_id"]
        assert par.default is inspect.Parameter.empty, fn.__name__


async def test_actor_event_uzerinde_APPEND_ONLY_korunur(fab):
    from sqlalchemy.exc import DBAPIError, IntegrityError

    pid = await fab.urun(stock=10)
    olay_id = await _islem(pid, key=f"k-{_uniq()}")
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        async with AsyncSessionLocal() as db:
            await db.execute(
                text(
                    "UPDATE stock_damage_events SET actor_admin_id = 1 WHERE id = :i"
                ),
                {"i": olay_id},
            )
            await db.commit()
    assert "append-only" in str(exc.value).lower()


# ══════════ Event ↔ ledger bağı (yapısal referans) ══════════

async def _hareketler_ref(event_id: int):
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                text(
                    "SELECT bucket, qty_delta, movement_type FROM stock_movements "
                    "WHERE ref_type = 'damage_event' AND ref_id = :i "
                    "ORDER BY bucket"
                ),
                {"i": event_id},
            )
        ).all()


async def test_TRANSFER_eventinden_TAM_IKI_dogru_satira_gidilir(fab):
    """Bağ **yapısaldır**: `ref_type='damage_event'` + `ref_id=event.id`.
    Metinsel idempotency anahtarına güvenilmez."""
    pid = await fab.urun(stock=10)
    olay_id = await _islem(pid, key=f"k-{_uniq()}", qty=3)
    satirlar = await _hareketler_ref(olay_id)
    assert [(r.bucket, r.qty_delta) for r in satirlar] == [
        ("DAMAGED", 3), ("SALEABLE", -3)
    ]
    assert {r.movement_type for r in satirlar} == {"DAMAGE_TRANSFER"}


async def test_RECOVERY_eventinden_TAM_IKI_dogru_satira_gidilir(fab):
    pid = await fab.urun(stock=10)
    await _islem(pid, key=f"h-{_uniq()}", qty=4)
    async with AsyncSessionLocal() as db:
        olay = await inventory_damage.damage_recovery(
            db, pid, qty=2, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        await db.commit()
        olay_id = olay.id
    satirlar = await _hareketler_ref(olay_id)
    assert [(r.bucket, r.qty_delta) for r in satirlar] == [
        ("DAMAGED", -2), ("SALEABLE", 2)
    ]


async def test_DISPOSAL_ve_SUPPLIER_RETURN_eventinden_TEK_satir(fab):
    pid = await fab.urun(stock=10)
    await _islem(pid, key=f"h-{_uniq()}", qty=5)
    async with AsyncSessionLocal() as db:
        imha = await inventory_damage.damage_disposal(
            db, pid, qty=2, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        iade = await inventory_damage.supplier_return(
            db, pid, qty=1, bucket="SALEABLE", reason_code="BASKI_HATASI",
            admin_id=ADMIN_ID,
        )
        await db.commit()
        imha_id, iade_id = imha.id, iade.id
    assert [(r.bucket, r.qty_delta) for r in await _hareketler_ref(imha_id)] == [
        ("DAMAGED", -2)
    ]
    assert [(r.bucket, r.qty_delta) for r in await _hareketler_ref(iade_id)] == [
        ("SALEABLE", -1)
    ]


async def test_BASKA_eventin_hareketleri_KARISMAZ(fab):
    pid = await fab.urun(stock=20)
    bir = await _islem(pid, key=f"a-{_uniq()}", qty=2)
    iki = await _islem(pid, key=f"b-{_uniq()}", qty=3)
    assert len(await _hareketler_ref(bir)) == 2
    assert len(await _hareketler_ref(iki)) == 2
    assert [abs(r.qty_delta) for r in await _hareketler_ref(bir)] == [2, 2]
    assert [abs(r.qty_delta) for r in await _hareketler_ref(iki)] == [3, 3]


async def test_REPLAY_ayni_event_ve_ayni_hareketleri_dondurur(fab):
    pid = await fab.urun(stock=10)
    olay_id = await _islem(pid, key=f"k-{_uniq()}", qty=3)
    once = await _hareketler_ref(olay_id)
    async with AsyncSessionLocal() as db:
        tekrar = await inventory_damage.replay_damage_event(db, olay_id)
        await db.commit()
    assert tekrar.id == olay_id
    assert await _hareketler_ref(olay_id) == once
    assert await _kovalar(pid) == (7, 3)


async def test_EKSIK_ledger_bacagi_INVARIANT_ihlali_olarak_yakalanir(fab):
    """Bir bacak silinirse kova zinciri bakiyeyle uyuşmaz → `verify_ledger`
    bulgu üretir. Bağ yapısal olduğu için hangi olaya ait olduğu da bellidir."""
    pid = await fab.urun(stock=10)
    olay_id = await _islem(pid, key=f"k-{_uniq()}", qty=3)
    async with AsyncSessionLocal() as db:
        await db.execute(text("ALTER TABLE stock_movements DISABLE TRIGGER USER"))
        await db.execute(
            text(
                "DELETE FROM stock_movements WHERE ref_type = 'damage_event' "
                "AND ref_id = :i AND bucket = 'DAMAGED'"
            ),
            {"i": olay_id},
        )
        await db.execute(text("ALTER TABLE stock_movements ENABLE TRIGGER USER"))
        await db.commit()
    async with AsyncSessionLocal() as db:
        sonuc = await stock_ledger.verify_ledger(db, pid)
    assert not sonuc.consistent
    assert {p.bucket for p in sonuc.problems} == {"DAMAGED"}
    assert len(await _hareketler_ref(olay_id)) == 1, "eksik bacak görünür olmalı"


# ══════════ Savepoint: IntegrityError yarışı 409'a çevrilir ══════════

async def _ham_olay(pid: int, admin_id: int, key: str, db) -> None:
    """Ham SQL ile olay satırı — servis yolundan geçmeden."""
    await db.execute(
        text(
            "INSERT INTO stock_damage_events (product_id,kind,qty,source_bucket,"
            "reason_code,actor_admin_id,idempotency_key,created_at) VALUES "
            "(:p,'TRANSFER',1,'SALEABLE','KIRIK',:a,:k,now())"
        ),
        {"p": pid, "a": admin_id, "k": key},
    )


async def test_COMMIT_EDILMEMIS_cakisan_kayit_SAVEPOINT_ile_409a_cevrilir(fab):
    """Deterministik `IntegrityError` yarışı — `sleep` yok.

    Çakışan satır **commit edilmemiş** bir transaction'da tutulur: servisin
    ilk `SELECT`'i onu göremez (MVCC), `INSERT` ise unique index üzerinde
    bloklanır. Diğer transaction commit edince ihlal doğar.

    Savepoint olmasaydı transaction "aborted" duruma düşer, sonraki `SELECT`
    `InFailedSqlTransaction` verir ve çağırana **ham DB hatası** (HTTP'de 500)
    dönerdi. Savepoint sayesinde yalnız INSERT geri alınır ve sonuç kontrollü
    409 olur.
    """
    a = await fab.urun(stock=10)
    b = await fab.urun(stock=10)
    key = f"cak-{_uniq()}"

    tutan = AsyncSessionLocal()
    try:
        await _ham_olay(a, ADMIN_ID, key, tutan)   # COMMIT YOK

        async def deneyen():
            async with AsyncSessionLocal() as db:
                await inventory_damage.damage_transfer(
                    db, b, qty=1, reason_code="KIRIK", admin_id=ADMIN_ID,
                    idempotency_key=key,
                )
                await db.commit()

        gorev = asyncio.create_task(deneyen())
        await asyncio.sleep(0.3)
        assert not gorev.done(), "unique index üzerinde bloklanmadı"
        await tutan.commit()          # çakışma ŞİMDİ doğar
    finally:
        await tutan.close()

    with pytest.raises(Exception) as exc:
        await gorev
    from fastapi import HTTPException

    assert isinstance(exc.value, HTTPException), (
        f"ham DB hatası sızdı (HTTP'de 500 olurdu): {exc.value!r}"
    )
    assert exc.value.status_code == 409
    assert "product_id" in str(exc.value.detail)
    assert await _kovalar(b) == (10, 0), "kaybeden ürünün bakiyesi değişmiş"


async def test_COMMIT_EDILMEMIS_cakismada_AYNI_payload_REPLAY_olur(fab):
    """Aynı yarış, ama payload aynı: sonuç 409 değil **replay**.

    Tutulan kayıt **servis yoluyla** (dolayısıyla defter bacaklarıyla birlikte)
    üretilir — ham SQL ile yarım bir olay bırakmak bütünlük ihlali olurdu ve
    replay artık onu reddeder (bkz. `assert_ledger_intact`).
    """
    pid = await fab.urun(stock=10)
    key = f"cak-{_uniq()}"

    tutan = AsyncSessionLocal()
    try:
        await inventory_damage.damage_transfer(
            tutan, pid, qty=1, reason_code="KIRIK", admin_id=ADMIN_ID,
            idempotency_key=key,
        )   # COMMIT YOK

        async def deneyen():
            async with AsyncSessionLocal() as db:
                olay = await inventory_damage.damage_transfer(
                    db, pid, qty=1, reason_code="KIRIK", admin_id=ADMIN_ID,
                    idempotency_key=key,
                )
                await db.commit()
                return olay.id

        gorev = asyncio.create_task(deneyen())
        await asyncio.sleep(0.3)
        assert not gorev.done(), "unique index üzerinde bloklanmadı"
        await tutan.commit()
    finally:
        await tutan.close()

    olay_id = await gorev
    assert await _olaylar(pid) == 1, "ikinci olay üretildi"
    assert len(await _hareketler_ref(olay_id)) == 2
    assert await _kovalar(pid) == (9, 1), "replay bakiyeyi İKİNCİ kez değiştirdi"


# ══════════ Replay BÜTÜNLÜK DOĞRULAMASI (onarım DEĞİL) ══════════
#
# Olay, iki defter satırı ve iki bakiye AYNI transaction'da yazılır; üretim
# akışında yarım bir olay OLUŞAMAZ. Olay varken bacak eksikse bu idempotent
# retry değil **veri bütünlüğü ihlalidir** ve sebebi bilinmez: bakiye çoktan
# değişmiş, yalnız defter satırı kaybolmuş olabilir. Yeniden uygulamak stoğu
# ikinci kez değiştirirdi. Servis onarmaz — durur ve adıyla söyler.


async def _bacak_sil(event_id: int, bucket: str) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(text("ALTER TABLE stock_movements DISABLE TRIGGER USER"))
        await db.execute(
            text(
                "DELETE FROM stock_movements WHERE ref_type = 'damage_event' "
                "AND ref_id = :i AND bucket = :b"
            ),
            {"i": event_id, "b": bucket},
        )
        await db.execute(text("ALTER TABLE stock_movements ENABLE TRIGGER USER"))
        await db.commit()


async def _ham_bacak(pid: int, event_id: int, **cols) -> None:
    """Defter servisini ATLAYARAK olaya bağlı bir satır yazar."""
    varsayilan = dict(
        product_id=pid, bucket="DAMAGED", qty_delta=1, qty_after=99,
        movement_type="DAMAGE_TRANSFER", reason_code="KIRIK",
        ref_type="damage_event", ref_id=event_id, ref_line_id=None,
        idempotency_key=f"ham-{_uniq()}", actor_type="ADMIN", actor_id=ADMIN_ID,
        note=None, request_id=None,
    )
    varsayilan.update(cols)
    kolonlar = ", ".join(varsayilan)
    yerler = ", ".join(f":{k}" for k in varsayilan)
    async with AsyncSessionLocal() as db:
        await db.execute(
            text(f"INSERT INTO stock_movements ({kolonlar}) VALUES ({yerler})"),
            varsayilan,
        )
        await db.commit()


async def _bozuk_olayla_retry(pid: int, key: str):
    """Aynı anahtarla ikinci istek — bütünlük ihlali beklenir."""
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_damage.damage_transfer(
                db, pid, qty=2, reason_code="KIRIK", admin_id=ADMIN_ID,
                idempotency_key=key,
            )
            await db.commit()
    assert getattr(exc.value, "status_code", None) == 409, exc.value
    assert inventory_damage.INVARIANT_MARKER in str(exc.value.detail)
    return exc.value


async def _hazir_olay(fab, pid_stok: int = 10, adet: int = 2):
    pid = await fab.urun(stock=pid_stok)
    key = f"inv-{_uniq()}"
    async with AsyncSessionLocal() as db:
        olay = await inventory_damage.damage_transfer(
            db, pid, qty=adet, reason_code="KIRIK", admin_id=ADMIN_ID,
            idempotency_key=key,
        )
        await db.commit()
        return pid, key, olay.id


async def test_RETRY_yarim_kalmis_ledger_bacaklarini_TAMAMLAMAZ(fab):
    """(1) Eksik transfer bacağı replay ile TAMAMLANMAZ.

    Sözleşme tersine çevrildi: önceki uygulama eksik bacağı yeniden yazıyordu
    ve bakiye zaten değişmişse stoğu ikinci kez değiştirebiliyordu.
    """
    pid, key, olay_id = await _hazir_olay(fab)
    assert await _kovalar(pid) == (8, 2)
    await _bacak_sil(olay_id, "DAMAGED")

    once_kova = await _kovalar(pid)
    once_bacak = await _hareketler_ref(olay_id)
    await _bozuk_olayla_retry(pid, key)

    assert await _kovalar(pid) == once_kova, "bakiye değişti"
    assert await _hareketler_ref(olay_id) == once_bacak, "eksik bacak yazıldı"
    assert await _olaylar(pid) == 1, "yeni olay üretildi"


async def test_FAZLA_UCUNCU_bacak_INVARIANT_hatasidir(fab):
    """(2)"""
    pid, key, olay_id = await _hazir_olay(fab)
    await _ham_bacak(pid, olay_id, bucket="DAMAGED", qty_delta=1)
    once = await _kovalar(pid)
    await _bozuk_olayla_retry(pid, key)
    assert await _kovalar(pid) == once
    assert len(await _hareketler_ref(olay_id)) == 3


async def test_YANLIS_BUCKET_INVARIANT_hatasidir(fab):
    """(3) Bacak sayısı doğru ama kova yanlış."""
    pid, key, olay_id = await _hazir_olay(fab)
    await _bacak_sil(olay_id, "DAMAGED")
    await _ham_bacak(pid, olay_id, bucket="SALEABLE", qty_delta=2)
    once = await _kovalar(pid)
    await _bozuk_olayla_retry(pid, key)
    assert await _kovalar(pid) == once


async def test_YANLIS_QTY_DELTA_INVARIANT_hatasidir(fab):
    """(4) Kova doğru, miktar yanlış."""
    pid, key, olay_id = await _hazir_olay(fab)
    await _bacak_sil(olay_id, "DAMAGED")
    await _ham_bacak(pid, olay_id, bucket="DAMAGED", qty_delta=99)
    once = await _kovalar(pid)
    await _bozuk_olayla_retry(pid, key)
    assert await _kovalar(pid) == once


async def test_BASKA_EVENT_ID_sine_bagli_hareket_KABUL_EDILMEZ(fab):
    """(5) Bağ yapısaldır: `ref_id` başka olaya işaret eden satır bu olayın
    bacağı sayılmaz — eksik bacak olarak görünür."""
    pid, key, olay_id = await _hazir_olay(fab)
    await _bacak_sil(olay_id, "DAMAGED")
    # Doğru kova/miktar, ama BAŞKA bir olay kimliğine bağlı.
    await _ham_bacak(pid, olay_id, bucket="DAMAGED", qty_delta=2,
                     ref_id=olay_id + 10_000)
    once = await _kovalar(pid)
    await _bozuk_olayla_retry(pid, key)
    # Yanlış bağlanan satır BU olayın bacağı sayılmıyor: yalnız SALEABLE kaldı.
    assert [r.bucket for r in await _hareketler_ref(olay_id)] == ["SALEABLE"]
    # Satır kaybolmadı; başka bir kimliğe bağlı olarak duruyor.
    assert len(await _hareketler_ref(olay_id + 10_000)) == 1
    assert await _kovalar(pid) == once


async def test_EKSIKSIZ_event_ayni_key_ile_GUVENLI_REPLAY(fab):
    """(6) Karşı prova: bütünlük tamsa replay sorunsuz ve bakiye değişmez.

    Bu test olmadan "her replay'i reddet" gibi aşırı-korumacı bir uygulama da
    yeşil kalırdı.
    """
    pid, key, olay_id = await _hazir_olay(fab)
    once = await _kovalar(pid)
    async with AsyncSessionLocal() as db:
        tekrar = await inventory_damage.damage_transfer(
            db, pid, qty=2, reason_code="KIRIK", admin_id=ADMIN_ID,
            idempotency_key=key,
        )
        await db.commit()
    assert tekrar.id == olay_id
    assert await _kovalar(pid) == once
    assert len(await _hareketler_ref(olay_id)) == 2
    # `replay_damage_event` de doğrular, onarmaz.
    async with AsyncSessionLocal() as db:
        assert (await inventory_damage.replay_damage_event(db, olay_id)).id == olay_id


async def test_INVARIANT_hatasi_sonrasi_TRANSACTION_kullanilabilir(fab):
    """(7) Hata ham DB istisnası değil domain hatası; transaction aborted
    duruma DÜŞMEZ — çağıran aynı session'da okumaya devam edebilir ve güvenle
    rollback edebilir."""
    from fastapi import HTTPException

    pid, key, olay_id = await _hazir_olay(fab)
    await _bacak_sil(olay_id, "DAMAGED")

    async with AsyncSessionLocal() as db:
        with pytest.raises(HTTPException) as exc:
            await inventory_damage.damage_transfer(
                db, pid, qty=2, reason_code="KIRIK", admin_id=ADMIN_ID,
                idempotency_key=key,
            )
        assert exc.value.status_code == 409
        # Transaction hâlâ kullanılabilir:
        deger = (await db.execute(text("SELECT 1"))).scalar_one()
        assert deger == 1
        await db.rollback()

    assert await _kovalar(pid) == (8, 2)
    assert await _olaylar(pid) == 1


async def test_DISPOSAL_eksik_bacagi_da_INVARIANT_hatasidir(fab):
    """Tek bacaklı işlemler de aynı sözleşmeye tabi."""
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        await inventory_damage.damage_transfer(
            db, pid, qty=4, reason_code="KIRIK", admin_id=ADMIN_ID
        )
        imha = await inventory_damage.damage_disposal(
            db, pid, qty=2, reason_code="KIRIK", admin_id=ADMIN_ID,
            idempotency_key="imha-1",
        )
        await db.commit()
        imha_id = imha.id
    await _bacak_sil(imha_id, "DAMAGED")
    with pytest.raises(Exception) as exc:
        async with AsyncSessionLocal() as db:
            await inventory_damage.damage_disposal(
                db, pid, qty=2, reason_code="KIRIK", admin_id=ADMIN_ID,
                idempotency_key="imha-1",
            )
            await db.commit()
    assert inventory_damage.INVARIANT_MARKER in str(exc.value.detail)


async def test_UNIQUE_INDEX_DB_tarafindan_uygulaniyor(fab):
    """Kapsam garantisi uygulama `SELECT`'inde değil **DB index'inde**.

    Aynı aktör + aynı anahtar ham INSERT ile de yazılamaz.
    """
    from sqlalchemy.exc import DBAPIError, IntegrityError

    pid = await fab.urun(stock=10)
    key = f"db-{_uniq()}"
    async with AsyncSessionLocal() as db:
        await _ham_olay(pid, ADMIN_ID, key, db)
        await db.commit()
    with pytest.raises((IntegrityError, DBAPIError)) as exc:
        async with AsyncSessionLocal() as db:
            await _ham_olay(pid, ADMIN_ID, key, db)
            await db.commit()
    assert "uq_stock_damage_events_idem" in str(exc.value)
