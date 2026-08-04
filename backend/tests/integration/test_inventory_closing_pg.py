"""F29 commit 9 kapanış denetiminde bulunan gerçek kusurların testleri.

Her test, bütünsel adversarial denetimde ortaya çıkan somut bir kusuru
sabitler. Hepsi GERÇEK PostgreSQL + gerçek HTTP kullanır.
"""
from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.security import create_access_token
from models.admin import Admin
from schemas.admin_access import AdminRoleCreate
from services import admin_access_service, inventory_service, stock_ledger
from tests.integration.inventory_factory import Fabrika

VIEW, COUNT, APPLY = "inventory.view", "inventory.count", "inventory.apply"
TAM = [VIEW, COUNT, APPLY]
KOK = "/api/v1/inventory"


@pytest.fixture
async def client():
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class Kurulum:
    def __init__(self) -> None:
        self.admin_ids: list[int] = []
        self.role_ids: list[int] = []

    async def admin(self, *, izinler: list[str] = TAM) -> tuple[int, dict]:
        ek = uuid.uuid4().hex[:10]
        async with AsyncSessionLocal() as s:
            a = Admin(
                email=f"kapanis-{ek}@test.local", hashed_password="test-only",
                first_name="Kapanis", last_name="Denetim", username=f"kd{ek}", role_id=1,
            )
            s.add(a)
            await s.flush()
            rol = await admin_access_service.create_role(
                s, AdminRoleCreate(code=f"KD_{ek.upper()}", name="Kapanis",
                                   permission_codes=izinler),
            )
            await admin_access_service.assign_role(
                s, admin_id=a.id, role_id=rol.id, assigned_by_admin_id=a.id
            )
            await s.commit()
            self.admin_ids.append(a.id)
            self.role_ids.append(rol.id)
            return a.id, {
                "Authorization": f"Bearer {create_access_token(subject=a.id, role='ADMIN', role_id=1, auth_version=a.auth_version)}"
            }

    async def temizle(self) -> None:
        async with AsyncSessionLocal() as s:
            if self.admin_ids:
                await s.execute(
                    text("DELETE FROM audit_logs WHERE actor_id = ANY(:i) AND actor_role = 1"),
                    {"i": self.admin_ids})
                await s.execute(
                    text("DELETE FROM admin_role_assignments WHERE admin_id = ANY(:i)"),
                    {"i": self.admin_ids})
            if self.role_ids:
                await s.execute(
                    text("DELETE FROM admin_role_permissions WHERE admin_role_id = ANY(:i)"),
                    {"i": self.role_ids})
                await s.execute(text("DELETE FROM admin_roles WHERE id = ANY(:i)"),
                                {"i": self.role_ids})
            if self.admin_ids:
                await s.execute(text("DELETE FROM admins WHERE id = ANY(:i)"),
                                {"i": self.admin_ids})
            await s.commit()


@pytest.fixture
async def kur(pg):
    k = Kurulum()
    try:
        yield k
    finally:
        await k.temizle()


@pytest.fixture
async def fab(pg):
    f = Fabrika()
    try:
        yield f
    finally:
        await f.temizle()


async def _oturum(client, h, *pids: int) -> int:
    r = await client.post(f"{KOK}/count-sessions",
                          json={"scope": "MANUAL", "product_ids": list(pids)}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def _say(client, h, sid: int, adet: int) -> None:
    for s in (await client.get(f"{KOK}/count-sessions/{sid}", headers=h)).json()["lines"]:
        r = await client.post(
            f"{KOK}/count-sessions/{sid}/lines/{s['id']}/count",
            json={"counted_qty": adet if s["bucket"] == "SALEABLE" else 0}, headers=h)
        assert r.status_code == 200, r.text


# ═══════════ K1: STALE kontrolü ürün kilidinin ALTINDA olmalı ═══════════


async def test_APPLY_stale_kontrolu_URUN_KILIDI_ALTINDA_yapilir(client, kur, fab):
    """Sayımdan sonra gelen belirsiz olay, APPLY tarafından GÖRÜLMELİ.

    Kusur: `_stale_isaretle` defteri KİLİTSİZ okuyordu ve ürün kilidi ancak
    ondan SONRA alınıyordu. Bu iki ifade arasında commit eden bir hareket
    (ör. başka bir yöneticinin stok düzeltmesi) STALE kararına giremiyor ama
    uygulanacak deltanın altını oyuyordu. F29'un asıl güvencesi buydu:
    *belirsiz olaydan sonra sayım uygulanamaz.*

    Deterministik bariyer — `sleep` YOK: ürün satırı başka bir transaction'da
    `FOR UPDATE` ile tutulur. Kilit doğru sıradaysa APPLY hareketleri OKUMADAN
    ÖNCE bloke olur; kilit bırakıldığında yeni hareketi görür ve 409 döner.
    Kilit yanlış sıradaysa APPLY hareketleri önce okur, hiçbir şey görmez ve
    farkı uygular.
    """
    _aid, h = await kur.admin()
    pid = await fab.urun(stock=10)
    sid = await _oturum(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    await _say(client, h, sid, 8)
    await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)

    kilit_alindi = asyncio.Event()
    birak = asyncio.Event()

    async def tutucu() -> None:
        """Ürünü kilitler, belirsiz bir hareket yazar, sonra commit eder."""
        async with AsyncSessionLocal() as db:
            await stock_ledger.lock_products(db, [pid])
            kilit_alindi.set()
            await stock_ledger.apply_movement(
                db, pid, qty_delta=+1, bucket=stock_ledger.StockBucket.SALEABLE,
                movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
                reason_code="SAYIM_FARKI", actor_type="ADMIN", actor_id=1,
                idempotency_key=f"k1-{uuid.uuid4().hex[:12]}",
            )
            await birak.wait()
            await db.commit()

    async def uygulayan() -> httpx.Response:
        await kilit_alindi.wait()
        gorev = asyncio.create_task(
            client.post(f"{KOK}/count-sessions/{sid}/apply",
                        json={"idempotency_key": f"ap-{uuid.uuid4().hex[:10]}"}, headers=h)
        )
        # İstek ürün kilidinde BLOKE olmalı. Tamamlandıysa kilit sırası yanlış:
        # hareketler kilitten önce okunmuş demektir.
        bitti, _ = await asyncio.wait({gorev}, timeout=2.0)
        erken = bool(bitti)
        birak.set()
        yanit = await gorev
        assert not erken, (
            "APPLY ürün kilidini BEKLEMEDEN tamamlandı — STALE kontrolü "
            "kilitsiz defter okumasına dayanıyor"
        )
        return yanit

    tut = asyncio.create_task(tutucu())
    yanit = await uygulayan()
    await tut

    assert yanit.status_code == 409, (
        f"sayımdan sonraki belirsiz olay görülmedi, oturum uygulandı: {yanit.text}"
    )
    detay = yanit.json()["detail"]
    assert "yeniden say" in detay.lower() or "belirsiz" in detay.lower(), detay

    # Ürün bakiyesi sayımdan DEĞİL, yalnız düzeltmeden etkilenmiş olmalı.
    async with AsyncSessionLocal() as db:
        stok = (await db.execute(text("SELECT stock FROM products WHERE id = :i"),
                                 {"i": pid})).scalar_one()
    assert stok == 11, f"beklenen 11 (10+1 düzeltme), görülen {stok}"


# ═══════════ K2: replay istemciye BİLDİRİLMELİ ═══════════


async def test_HASAR_replay_HTTP_200_doner_yeni_is_201(client, kur, fab):
    """Aynı anahtarla ikinci istek "yeni kayıt" gibi görünmemeli.

    Kusur: uç `status_code=201` sabitiyle tanımlıydı; servis replay'i doğru
    tespit etse de istemci bunu ANLAYAMIYORDU. Arayüz replay'i 200'den
    okuduğu için "zaten işlenmişti" dalı ÖLÜ koddu ve operatör imhayı
    yapılmamış sanıp ikinci kez gerçek imha yazabiliyordu.
    """
    _aid, h = await kur.admin()
    pid = await fab.urun(stock=10)
    govde = {
        "product_id": pid, "kind": "TRANSFER", "qty": 3,
        "reason_code": "KIRIK", "idempotency_key": f"rp-{uuid.uuid4().hex[:10]}",
    }

    ilk = await client.post(f"{KOK}/damage-events", json=govde, headers=h)
    assert ilk.status_code == 201, f"yeni iş 201 dönmeli: {ilk.status_code}"

    ikinci = await client.post(f"{KOK}/damage-events", json=govde, headers=h)
    assert ikinci.status_code == 200, (
        f"replay 200 dönmeli (yeni kayıt DEĞİL), görülen {ikinci.status_code}"
    )
    assert ikinci.json()["id"] == ilk.json()["id"]

    async with AsyncSessionLocal() as db:
        s, d = (await db.execute(
            text("SELECT stock, damaged_stock FROM products WHERE id = :i"), {"i": pid}
        )).one()
    assert (s, d) == (7, 3), "replay stoğu ikinci kez değiştirmiş"


# ═══════════ K3: çapraz oturum satırı HİÇ yazılmamalı ═══════════


async def test_BASKA_OTURUMUN_satiri_servise_HIC_girmez(client, kur, fab):
    """Aidiyet kontrolü mutasyondan ÖNCE olmalı.

    Kusur: satır önce yazılıyor, sonra "bu oturuma ait değil" diye 404
    veriliyordu. Kalıcı yazımı yalnız `get_db`'nin rollback'i engelliyordu —
    servise bir `commit` eklendiği gün açık gerçek olurdu. Ayrıca hata
    kodları bir ORACLE üretiyordu: okuma izni olmayan bir admin satır
    numarası tarayarak envanteri sayabiliyordu.
    """
    _aid, h = await kur.admin()
    a = await fab.urun(stock=10)
    b = await fab.urun(stock=10)
    sid_a = await _oturum(client, h, a)
    sid_b = await _oturum(client, h, b)
    await client.post(f"{KOK}/count-sessions/{sid_a}/start", headers=h)
    await client.post(f"{KOK}/count-sessions/{sid_b}/start", headers=h)
    satir_b = (await client.get(f"{KOK}/count-sessions/{sid_b}", headers=h)).json()["lines"][0]

    r = await client.post(f"{KOK}/count-sessions/{sid_a}/lines/{satir_b['id']}/count",
                          json={"counted_qty": 7}, headers=h)
    assert r.status_code == 404, r.text

    async with AsyncSessionLocal() as db:
        sayilan, iz = (await db.execute(
            text("SELECT (SELECT counted_qty FROM stock_count_lines WHERE id = :i), "
                 "(SELECT count(*) FROM stock_count_line_events WHERE line_id = :i)"),
            {"i": satir_b["id"]},
        )).one()
    assert sayilan is None, "reddedilen istek yine de sayım yazdı"
    assert iz == 0, "reddedilen istek append-only iz satırı bıraktı"

    # `resolve` ucu da aynı sözleşmeyi taşımalı.
    r2 = await client.post(f"{KOK}/count-sessions/{sid_a}/lines/{satir_b['id']}/resolve",
                           json={"note": "deneme"}, headers=h)
    assert r2.status_code == 404, r2.text


# ═══════════ K4: olmayan / silinmiş ürün 500 üretmemeli ═══════════


async def test_OLMAYAN_URUNDE_hasar_islemi_404_doner(client, kur, fab):
    """Kusur: `lock_products` kayıtsız bir `ValueError` fırlatıyordu ve global
    handler'ı olmadığı için uç 500 dönüyordu. Var olmayan kaynak 404'tür."""
    _aid, h = await kur.admin()
    r = await client.post(
        f"{KOK}/damage-events",
        json={"product_id": 999_999_999, "kind": "TRANSFER", "qty": 1,
              "reason_code": "KIRIK"},
        headers=h,
    )
    assert r.status_code == 404, f"beklenen 404, görülen {r.status_code}: {r.text}"
    assert "sql" not in r.text.lower() and "traceback" not in r.text.lower()


async def test_SILINMIS_URUNDE_hasar_islemi_REDDEDILIR(client, kur, fab):
    """Sayım silinmiş ürünü kapsam dışı bırakıyordu ama hasar yolu bırakmıyordu.
    Aynı gerçek üzerinde iki farklı kural, envanteri ikiye böler."""
    _aid, h = await kur.admin()
    pid = await fab.urun(stock=10)
    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE products SET deleted_at = now() WHERE id = :i"),
                         {"i": pid})
        await db.commit()

    r = await client.post(
        f"{KOK}/damage-events",
        json={"product_id": pid, "kind": "TRANSFER", "qty": 1, "reason_code": "KIRIK"},
        headers=h,
    )
    assert r.status_code == 404, f"silinmiş üründe hasar yazıldı: {r.status_code}"

    op = await client.get(f"{KOK}/products/{pid}/on-premise", headers=h)
    assert op.status_code == 404, "silinmiş ürünün stok dökümü döndü"


# ═══════════ K5: offset tavanı ═══════════


async def test_LISTE_UCLARI_offset_TAVANI_uygular(client, kur):
    _aid, h = await kur.admin()
    for yol in (f"{KOK}/count-sessions", f"{KOK}/damage-events"):
        r = await client.get(f"{yol}?limit=25&offset=100000000", headers=h)
        assert r.status_code == 422, f"{yol} sınırsız offset kabul etti"


# ═══════════ K6: çapraz oturum açık satır çakışması anlaşılır olmalı ═══════════


async def test_BASKA_OTURUMDA_ACIK_urun_ANLASILIR_409_uretir(client, kur, fab):
    """Kusur: DB kısıtı doğru engelliyordu ama operatöre "Resource already
    exists" diyordu; hangi ürünün nerede açık olduğu anlaşılmıyordu."""
    _aid, h = await kur.admin()
    pid = await fab.urun(stock=5)
    ilk = await _oturum(client, h, pid)

    r = await client.post(f"{KOK}/count-sessions",
                          json={"scope": "MANUAL", "product_ids": [pid]}, headers=h)
    assert r.status_code == 409, f"aynı ürün iki açık oturuma girdi: {r.status_code}"
    detay = r.json()["detail"]
    assert str(pid) in detay, f"hangi ürün olduğu yazılmamış: {detay}"
    assert str(ilk) in detay, f"hangi oturumda açık olduğu yazılmamış: {detay}"
    assert "resource already exists" not in detay.lower()


# ═══════════ K7: apply_session docstring'i kodla ÇELİŞMEMELİ ═══════════


def test_apply_session_dokumantasyonu_kodla_CELISMEZ():
    """Kusur: docstring "farkları kilit altındaki güncel bakiyeden hesapla"
    diyordu; kod farkı sayım anındaki KESİTTEN hesaplıyor (doğrusu bu).
    Docstring'e bakıp "düzelten" biri her aradaki satışı çift saydırırdı."""
    dok = inventory_service.apply_session.__doc__ or ""
    # Aranan şey İDDİA'nın kendisidir, kelimenin geçmesi değil: "güncel
    # bakiyeden hesapla" yanlış, "güncel bakiyeden DEĞİL" doğrudur. İlk
    # sürümde ham substring aradım ve kendi doğru cümlemi yakaladı.
    assert "güncel bakiyeden hesapla" not in dok, (
        "docstring farkın kaynağını yanlış anlatıyor — kod kesit kullanıyor"
    )
    assert "kesitten" in dok, "farkın kesitten geldiği docstring'de yazılı değil"
    assert "kesitten** hesaplanır" in dok or "kesitten hesaplanır" in dok


# ═══════════ K8: HASARLI kovada SIFIRDAN FARKLI fark uygulanmalı ═══════════


async def test_DAMAGED_kovada_SIFIRDAN_FARKLI_fark_uygulanir(client, kur, fab):
    """Hasarlı kova farkı gerçekten uygulanıyor mu?

    Kapanış denetiminde çıktı: fabrikanın `damaged` parametresi HİÇ
    kullanılmıyordu, bu yüzden her oturumda `damaged_stock = 0` başlıyor ve
    DAMAGED satırların farkı da 0 çıkıyordu. Beklenen de gerçekleşen de 0
    olduğu için, DAMAGED kovanın farkını sıfırlayan bir hata (ör. yanlış
    `bucket` filtresi) hiçbir testi kırmazdı.
    """
    _aid, h = await kur.admin()
    pid = await fab.urun(stock=10)

    # Gerçek yolla hasarlı kovaya 4 adet taşı (0 değil, ölçülebilir bir taban).
    r = await client.post(
        f"{KOK}/damage-events",
        json={"product_id": pid, "kind": "TRANSFER", "qty": 4, "reason_code": "KIRIK",
              "idempotency_key": f"d8-{uuid.uuid4().hex[:10]}"},
        headers=h,
    )
    assert r.status_code == 201, r.text

    sid = await _oturum(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    satirlar = (await client.get(f"{KOK}/count-sessions/{sid}", headers=h)).json()["lines"]
    hasarli = [s for s in satirlar if s["bucket"] == "DAMAGED"][0]
    saglam = [s for s in satirlar if s["bucket"] == "SALEABLE"][0]
    assert hasarli["system_qty_snapshot"] == 4, "hasarlı kova tabanı 0 kalmış"

    # Hasarlı rafta 4 değil 6 sayıldı (+2), satılabilir doğru (fark 0).
    for satir, adet in ((saglam, 6), (hasarli, 6)):
        rr = await client.post(
            f"{KOK}/count-sessions/{sid}/lines/{satir['id']}/count",
            json={"counted_qty": adet}, headers=h)
        assert rr.status_code == 200, rr.text

    await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)
    ap = await client.post(f"{KOK}/count-sessions/{sid}/apply",
                           json={"idempotency_key": f"a8-{uuid.uuid4().hex[:10]}"}, headers=h)
    assert ap.status_code == 200, ap.text

    async with AsyncSessionLocal() as db:
        s, d = (await db.execute(
            text("SELECT stock, damaged_stock FROM products WHERE id = :i"), {"i": pid}
        )).one()
        hareket = (await db.execute(
            text("SELECT bucket, qty_delta FROM stock_movements WHERE product_id = :i "
                 "AND movement_type = 'COUNT_ADJUSTMENT' ORDER BY id"), {"i": pid}
        )).all()

    assert (s, d) == (6, 6), f"beklenen (6, 6), görülen ({s}, {d})"
    kovalar = {b: q for b, q in hareket}
    assert kovalar.get("DAMAGED") == 2, (
        f"hasarlı kovanın farkı deftere yazılmadı: {hareket}"
    )
    assert "SALEABLE" not in kovalar, "sıfır farka hareket yazılmış"


# ═══════════ K9: DÖRT bileşenli karma yarış ═══════════


@pytest.mark.parametrize("tur", range(3))
async def test_DORT_BILESENLI_karma_yaris_tutarli_biter(client, kur, fab, tur):
    """Satış + sayım APPLY + hasar transferi + imha AYNI üründe, AYNI anda.

    Önceki turlarda ikili ve üçlü yarışlar sınandı; dördüncü bileşen
    (`DAMAGE_DISPOSAL`) hasarlı kovayı da yarışa sokar. Sözleşme: deadlock
    yok, kısmi hareket yok, defter zinciri sağlam, kova bakiyeleri defterin
    son `qty_after` değerleriyle birebir.
    """
    _aid, h = await kur.admin()
    pid = await fab.urun(stock=30)

    # Hasarlı kovaya ölçülebilir bir taban koy (imha edilecek).
    r = await client.post(
        f"{KOK}/damage-events",
        json={"product_id": pid, "kind": "TRANSFER", "qty": 6, "reason_code": "KIRIK",
              "idempotency_key": f"t{tur}-taban-{uuid.uuid4().hex[:8]}"}, headers=h)
    assert r.status_code == 201, r.text

    sid = await _oturum(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    satirlar = (await client.get(f"{KOK}/count-sessions/{sid}", headers=h)).json()["lines"]
    for s in satirlar:
        beklenen = 24 if s["bucket"] == "SALEABLE" else 6
        await client.post(f"{KOK}/count-sessions/{sid}/lines/{s['id']}/count",
                          json={"counted_qty": beklenen - 1}, headers=h)  # her kovada −1
    await client.post(f"{KOK}/count-sessions/{sid}/submit", headers=h)

    async def satis() -> object:
        async with AsyncSessionLocal() as db:
            await stock_ledger.apply_movement(
                db, pid, qty_delta=-2, bucket=stock_ledger.StockBucket.SALEABLE,
                movement_type=stock_ledger.StockMovementType.SALE,
                reason_code="ORDER_PAID", ref_type="order", ref_id=7000 + tur,
                ref_line_id=8000 + tur, actor_type="SYSTEM",
                idempotency_key=f"t{tur}-satis-{uuid.uuid4().hex[:8]}")
            await db.commit()
            return "satis"

    async def uygula() -> object:
        return await client.post(
            f"{KOK}/count-sessions/{sid}/apply",
            json={"idempotency_key": f"t{tur}-ap-{uuid.uuid4().hex[:8]}"}, headers=h)

    async def transfer() -> object:
        return await client.post(
            f"{KOK}/damage-events",
            json={"product_id": pid, "kind": "TRANSFER", "qty": 3, "reason_code": "ISLAK",
                  "idempotency_key": f"t{tur}-tr-{uuid.uuid4().hex[:8]}"}, headers=h)

    async def imha() -> object:
        return await client.post(
            f"{KOK}/damage-events",
            json={"product_id": pid, "kind": "DISPOSAL", "qty": 2, "reason_code": "KIRIK",
                  "idempotency_key": f"t{tur}-im-{uuid.uuid4().hex[:8]}"}, headers=h)

    sonuclar = await asyncio.gather(
        satis(), uygula(), transfer(), imha(), return_exceptions=True
    )

    # Beklenmeyen istisna YUTULMAZ. Beklenen tek şey HTTP yanıtı ya da
    # domain hatası; kilit/timeout/deadlock hatası kabul edilmez.
    for s in sonuclar:
        if isinstance(s, BaseException):
            metin = f"{s.__class__.__name__}: {s}"
            assert "deadlock" not in metin.lower(), metin
            assert "timeout" not in metin.lower() and "lock" not in metin.lower(), metin
            raise AssertionError(f"beklenmeyen istisna: {metin}")
    for s in sonuclar:
        if isinstance(s, httpx.Response):
            assert s.status_code in (200, 201, 400, 409), f"{s.status_code}: {s.text}"

    # ── Son durum: kova bakiyeleri = defterin son qty_after değerleri ──
    async with AsyncSessionLocal() as db:
        stok, hasar = (await db.execute(
            text("SELECT stock, damaged_stock FROM products WHERE id = :i"), {"i": pid}
        )).one()
        son = dict((await db.execute(
            text("SELECT DISTINCT ON (bucket) bucket, qty_after FROM stock_movements "
                 "WHERE product_id = :i ORDER BY bucket, id DESC"), {"i": pid}
        )).all())
        negatif = (await db.execute(
            text("SELECT count(*) FROM stock_movements WHERE product_id = :i "
                 "AND qty_after < 0"), {"i": pid}
        )).scalar_one()

    assert stok == son.get("SALEABLE"), f"satılabilir kova defterle ayrıştı: {stok} ≠ {son}"
    assert hasar == son.get("DAMAGED"), f"hasarlı kova defterle ayrıştı: {hasar} ≠ {son}"
    assert negatif == 0, "negatif bakiye üreten hareket var"
    assert stok >= 0 and hasar >= 0


# ═══════════ K10: counted_at KESİNLİKLE veritabanı saatinden gelir ═══════════


async def test_counted_at_PYTHON_saatinden_GELEMEZ(client, kur, fab, monkeypatch):
    """`counted_at`'in kaynağını KESİN olarak ayırt eder.

    Mevcut test `counted_at`'i iki DB `clock_timestamp()` okuması arasına
    sıkıştırıyor. Python'un saati de o aralığa düştüğü için (aynı makine,
    ~ms fark) `kesit.anda` yerine `_now()` yazan bir mutasyonu GÖREMİYOR.

    Burada Python saati bilerek 10 yıl ileri kaydırılır: `counted_at` hâlâ
    bugüne yakınsa değer veritabanından geliyor demektir. Uzlaştırmanın bütün
    zaman karşılaştırmaları bu tek saate dayanıyor; istemcinin ya da uygulama
    sunucusunun saatine kayması, sayımdan sonraki olayları görünmez yapardı.
    """
    import datetime as _dt

    _aid, h = await kur.admin()
    pid = await fab.urun(stock=5)
    sid = await _oturum(client, h, pid)
    await client.post(f"{KOK}/count-sessions/{sid}/start", headers=h)
    satir = (await client.get(f"{KOK}/count-sessions/{sid}", headers=h)).json()["lines"][0]

    sahte = _dt.datetime.now(_dt.UTC) + _dt.timedelta(days=3650)
    monkeypatch.setattr(inventory_service, "_now", lambda: sahte)

    r = await client.post(f"{KOK}/count-sessions/{sid}/lines/{satir['id']}/count",
                          json={"counted_qty": 5}, headers=h)
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as db:
        yazilan, simdi = (await db.execute(
            text("SELECT (SELECT counted_at FROM stock_count_lines WHERE id = :i), "
                 "clock_timestamp()"), {"i": satir["id"]}
        )).one()

    assert yazilan is not None
    fark = abs((yazilan - simdi).total_seconds())
    assert fark < 300, (
        f"counted_at veritabanı saatinden GELMİYOR (fark {fark:.0f} sn); "
        "uygulama sunucusunun saatine kaymış"
    )


# ═══════════ K11: EKSİK kova sessizce SALEABLE sayılamaz ═══════════


async def test_EKSIK_bucket_SESSIZCE_saleable_sayilmaz(fab):
    """Defter yazımında kova varsayımı YOKTUR.

    Kapanış mutasyon provasında çıktı: "eksik kova sessizce SALEABLE olur"
    kusurunu hiçbir test ölçmüyordu. Sözleşme yalnız kodda duruyordu — DB
    tarafında `NOT NULL` + default'suz kolon var ama uygulama katmanının
    varsayım yapmadığını kimse doğrulamıyordu. Bu kusur gerçekleşseydi bir
    DAMAGED hareketi satılabilir zincire yazılır ve iki kova sessizce
    birbirine karışırdı.
    """
    pid = await fab.urun(stock=5)
    async with AsyncSessionLocal() as db:
        for eksik in (None, ""):
            with pytest.raises(ValueError) as hata:
                await stock_ledger.apply_movement(
                    db, pid, qty_delta=+1, bucket=eksik,
                    movement_type=stock_ledger.StockMovementType.ADMIN_ADJUSTMENT,
                    reason_code="SAYIM_FARKI", actor_type="ADMIN", actor_id=1,
                    idempotency_key=f"nb-{uuid.uuid4().hex[:10]}",
                )
            assert "bucket" in str(hata.value).lower(), str(hata.value)
        await db.rollback()

    # Hiçbir hareket yazılmamış olmalı.
    async with AsyncSessionLocal() as db:
        n = (await db.execute(
            text("SELECT count(*) FROM stock_movements WHERE product_id = :i "
                 "AND movement_type = 'ADMIN_ADJUSTMENT'"), {"i": pid}
        )).scalar_one()
    assert n == 0, "eksik kovalı hareket deftere yazılmış"
