"""F30 paket etiketi sözleşmesi + geri dönüş kuyruğu sayfalaması.

GERÇEK PostgreSQL + GERÇEK HTTP (ASGI taşıyıcı, gerçek izin zinciri). "Servisi
çağırdım, çalıştı" bu dosyada kanıt sayılmaz (kök `CLAUDE.md` §B): etiketin
gerçekten basılabilir olması, uçtan dönen GÖVDENİN alan alan doğru olmasıdır.

## Neden bu dosya var

Bağımsız denetim ölü kod buldu: `PackageLabel.tsx` alıcı + adres + teslimat
tercihi ister, bunlar `PackageOut`'ta YOKTUR (yalnız kuyruk satırı taşır) ve
paket `PACKED` olduğu anda kuyruktan düştüğü için tam da basma anında o satır
elde değildir. Sonuç: bileşene hiçbir ekrandan ulaşılamıyordu. Düzeltme ayrı bir
etiket ucudur (`GET /packing/packages/{id}/label`, gerekçe
`schemas/packing.py::PackageLabelOut`) ve buradaki düğümler onun nöbetçisidir.

İkinci konu `GET /packing/return-queue`: sayfalamasız ve tavansızdı. Kuyruk tam
olarak "kimsenin kapatmadığı" satırların biriktiği yerdir (TB-7), yani sınırsız
büyümeye en yatkın olanıdır.

## Sınıflandırma (kök `CLAUDE.md` §H)

Gerçek PostgreSQL + gerçek HTTP: 1-7 · gerçek PostgreSQL + gerçek SQL sayacı: 8.
Snapshot yok, mock yok, "render oldu" yok.
"""
from __future__ import annotations

import contextlib
import json
import math
import re

import httpx
import pytest
from sqlalchemy import event, text

from core.database import AsyncSessionLocal, engine
from services import delivery_service, packing_rules, packing_service
from tests.integration.f30_factory import PaketFabrikasi

VIEW, PACK, MANAGE = "packing.view", "packing.pack", "packing.manage"

ETIKET = "/api/v1/packing/packages/{}/label"
KUYRUK = "/api/v1/packing/return-queue"


def _bas(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def client():
    """Gerçek ASGI istemcisi — doğrulama/yetki zinciri atlanmaz."""
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
async def fab(pg) -> PaketFabrikasi:
    f = PaketFabrikasi()
    try:
        yield f
    finally:
        # `finally`: test BAŞARISIZ olsa da temizlik çalışır (kök `CLAUDE.md` §G).
        await f.temizle()


@pytest.fixture
async def kur(pg):
    """Gerçek admin + gerçek rol + gerçek izin (kardeş dosyaların kurulumu).

    Kurulum sınıfı kopyalanmaz: iki kopya er ya da geç ayrışır ve biri sessizce
    yanlış izin kümesiyle koşar.
    """
    from tests.integration.test_f30_packing_api_pg import Kurulum

    k = Kurulum()
    try:
        yield k
    finally:
        await k.temizle()


# ══════════════════ Kurulum yardımcıları ════════════════════════════════════


async def _packed_paket(fab: PaketFabrikasi, aid: int, *, adetler=(1,)):
    """Kalem kalem doğrulanmış (`PACKED`) paket. (order_id, paket, kalem_bilgisi)

    `kalem_bilgisi`: `[(product_id, sku, ean, adet), ...]` — etiket satırlarının
    beklenen değerleri buradan gelir, uçtan dönen değerle karşılaştırılır.
    """
    kalem_bilgisi = []
    kalemler = []
    for adet in adetler:
        pid, sku, ean = await fab.barkodlu_urun(stock=10 + adet)
        kalem_bilgisi.append((pid, sku, ean, adet))
        kalemler.append((pid, adet))
    oid = await fab.fiziksel_siparis(kalemler=kalemler)
    async with AsyncSessionLocal() as s:
        paket = await packing_service.open_package(s, oid, admin_id=aid)
    for _pid, _sku, ean, adet in kalem_bilgisi:
        for _ in range(adet):
            async with AsyncSessionLocal() as s:
                await packing_service.scan(s, paket.id, code=ean, admin_id=aid)
    async with AsyncSessionLocal() as s:
        paket = await packing_service.complete(s, paket.id, admin_id=aid)
    return oid, paket, kalem_bilgisi


async def _siparis_alanlari(order_id: int) -> dict:
    """Siparişin sevkiyat kolonlarının DB'deki gerçek hâli.

    Etiket iddiaları sabit metinlerle değil BU değerlerle karşılaştırılır: fabrika
    yarın adresi değiştirse test yine doğru şeyi ölçer, ve daha önemlisi kolon
    karışması (ör. `ship_city` alanının `district`'e basılması) yakalanır —
    `city='Adana'` ile `district='Seyhan'` bilinçli olarak FARKLIDIR.
    """
    async with AsyncSessionLocal() as s:
        satir = (
            await s.execute(
                text(
                    "SELECT ship_recipient, ship_phone, ship_address, ship_city, "
                    "ship_district, delivery_pref, delivery_pref_note "
                    "FROM orders WHERE id = :i"
                ),
                {"i": order_id},
            )
        ).one()
    return dict(satir._mapping)


async def _sql(sorgu: str, **params) -> None:
    """Fikstür verisi için doğrudan yazma.

    Yalnız DURUM DIŞI alanlar (teslimat tercihi, adres metni) böyle kurulur;
    paket/sipariş durum geçişleri her zaman gerçek servis yollarından geçer
    (`f30_factory` kuralı) — aksi hâlde F30'un ölçmek istediği geçiş mantığı
    atlanmış olurdu.
    """
    async with AsyncSessionLocal() as s:
        await s.execute(text(sorgu), params)
        await s.commit()


async def _qr_token(package_id: int) -> str:
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(
                text("SELECT qr_token FROM order_packages WHERE id = :i"),
                {"i": package_id},
            )
        ).scalar_one()


@contextlib.contextmanager
def _sorgu_sayaci():
    """Engine üzerinden geçen GERÇEK ifadeleri toplar (mock yok).

    Kayıt `before_cursor_execute`'tan, yani Postgres'e gönderilen metnin
    kendisinden gelir. Her ölçüm ısıtılmış bir session'da yapılır ki sayaç
    bağlantı kurulum gürültüsünü değil yalnız sorguyu görsün.
    """
    ifadeler: list[tuple[str, object]] = []

    def _kaydet(conn, cursor, statement, parameters, context, executemany):
        ifadeler.append((statement, parameters))

    event.listen(engine.sync_engine, "before_cursor_execute", _kaydet)
    try:
        yield ifadeler
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _kaydet)


def _limit_offset(metin: str, params: list) -> tuple[int, int]:
    """Gönderilen cümledeki `LIMIT`/`OFFSET` değerleri.

    Parametre listesinin SONUNU okumak yetmez: `IN (...)` yüklemleri asyncpg'de
    çalışma anında genişler ve kendi değerlerini listenin sonuna ekler; yer
    tutucu numarası bu yüzden cümlenin METNİNDEN çözülür.
    """
    esles = re.search(r"LIMIT \$(\d+)(?:::\w+)? OFFSET \$(\d+)(?:::\w+)?", metin)
    assert esles is not None, f"cümlede parametreli LIMIT/OFFSET yok: {metin[-200:]}"
    return params[int(esles.group(1)) - 1], params[int(esles.group(2)) - 1]


# ══════════════════ 1 · Etiket sevkiyat kimliğini TAŞIYOR ═══════════════════


async def test_ETIKET_ALICI_ADRES_TERCIH_VE_KALEMLERI_TASIR(client, fab, kur):
    """Etiket tek istekte basılabilir mi? Alan alan ölçülür.

    Denetimin bulduğu hata "bileşen yok"tu değil, "**veri yok**"tu: alıcı/adres/
    tercih hiçbir paket yanıtında dönmüyordu. Bu düğüm o alanların gerçekten ve
    DOĞRU kolondan geldiğini kanıtlar; herhangi biri kaldırılırsa ya da yanlış
    kolona bağlanırsa kırılır.
    """
    _aid, token = await kur.admin(izinler=[VIEW])
    aid = await fab.admin()
    oid, paket, kalemler = await _packed_paket(fab, aid, adetler=(1, 2))
    # Tercih + not fikstürü: varsayılan `ADRESIMDEYIM` etiketin en riskli
    # alanını (kuryeye kâğıttan verilen talimat) sessiz bırakırdı.
    await _sql(
        "UPDATE orders SET delivery_pref = 'KOMSUYA_BIRAK', "
        "delivery_pref_note = :n WHERE id = :i",
        n="3. kat, komşu Ayşe Hanım",
        i=oid,
    )
    beklenen = await _siparis_alanlari(oid)

    r = await client.get(ETIKET.format(paket.id), headers=_bas(token))
    assert r.status_code == 200, r.text
    govde = r.json()

    assert govde["package_id"] == paket.id
    assert govde["order_id"] == oid
    assert govde["code"] == f"PKT-{paket.id:06d}"
    assert govde["status"] == "PACKED"
    assert govde["recipient"] == beklenen["ship_recipient"]
    assert govde["address"] == beklenen["ship_address"]
    assert govde["city"] == beklenen["ship_city"] == "Adana"
    assert govde["district"] == beklenen["ship_district"] == "Seyhan"
    assert govde["city"] != govde["district"], "il/ilçe aynı kolondan gelmiş"
    assert govde["delivery_pref"] == "KOMSUYA_BIRAK"
    assert govde["delivery_pref_note"] == "3. kat, komşu Ayşe Hanım"

    # Kalemler: sipariş kalemi kimliği + SKU snapshot'ı + BEKLENEN adet.
    kalem_idleri = await fab.kalem_idleri(oid)
    satirlar = {k["sku"]: k for k in govde["items"]}
    assert len(govde["items"]) == 2, govde["items"]
    for pid, sku, _ean, adet in kalemler:
        assert sku in satirlar, f"{sku} etikette yok: {govde['items']}"
        satir = satirlar[sku]
        assert satir["expected_qty"] == adet
        assert satir["title"] == f"Paket Kalemi {pid}"
        assert satir["order_item_id"] in kalem_idleri
    # Etikette BEKLENEN adet yazar: 1 + 2 = 3 parça. `scanned_qty` diye bir alan
    # YOKTUR — yarım paketin etiketi eksik içeriği "doğru" gösterirdi.
    assert sum(k["expected_qty"] for k in govde["items"]) == 3
    assert all("scanned_qty" not in k for k in govde["items"])

    # Telefon BİLİNÇLİ OLARAK yok (gerekçe `PackageLabelOut`): kâğıt teslimattan
    # sonra da yaşar, kurye numarayı taze ve yetki denetimli kaynaktan alır.
    assert "phone" not in govde
    assert beklenen["ship_phone"] not in json.dumps(govde, ensure_ascii=False)


# ══════════════════ 2 · QR yükü backend'in ürettiğinin AYNISI ═══════════════


async def test_ETIKET_QR_YUKU_URETILEN_PAYLOAD_ILE_BIREBIR_AYNI(client, fab, kur):
    """Kâğıda basılan yük gerçekten okutulabilir mi?

    Üç kat: (a) `packing_rules.build_package_qr` çıktısıyla birebir eşitlik,
    (b) `PKG1:` öneki (durak uzayından ayrılmanın tek yapısal işareti —
    sözleşme §3.3), (c) yükün gerçekten ÇÖZÜLMESİ: aynı gövde
    `get_package_by_qr`'a verildiğinde aynı paketi bulur. Yalnız (a) yazılsaydı
    test iki tarafı da aynı fonksiyondan alan bir totoloji olurdu.
    """
    _aid, token = await kur.admin(izinler=[VIEW])
    aid = await fab.admin()
    _oid, paket, _k = await _packed_paket(fab, aid)
    token_ham = await _qr_token(paket.id)

    govde = (await client.get(ETIKET.format(paket.id), headers=_bas(token))).json()

    assert govde["qr_payload"] == packing_rules.build_package_qr(paket.id, token_ham)
    assert govde["qr_payload"].startswith("PKG1:")
    assert packing_rules.parse_package_qr(govde["qr_payload"]) == (
        paket.id,
        token_ham,
    )
    async with AsyncSessionLocal() as s:
        cozulen = await packing_service.get_package_by_qr(s, govde["qr_payload"])
    assert cozulen is not None and cozulen.id == paket.id


# ══════════════════ 3 · Ham token AYRI BİR ALAN olarak sızmıyor ═════════════


async def test_HAM_QR_TOKEN_YALNIZ_PAYLOAD_ICINDE_GECER(client, fab, kur):
    """Token hiçbir yanıtta AYRI bir alan olarak dolaşmaz.

    Naif kontrol ("token gövdede hiç geçmesin") burada YANLIŞ KIRMIZI olurdu:
    `qr_payload` yükün tanımı gereği token'ı İÇERİR (`PKG1:{id}:{token}`,
    sözleşme §3.3) — etiket onsuz basılamaz. Ölçülen şey bu yüzden şudur:
    token'ın gövdedeki TEK geçiş yeri `qr_payload` değeridir; `qr_token` adında
    bir anahtar hiçbir seviyede yoktur. Ayrıca liste yüzeyleri (`return-queue`,
    `queue`) token'ı hiç görmez.
    """
    _aid, token = await kur.admin(izinler=[VIEW])
    aid = await fab.admin()
    _oid, paket, _k = await _packed_paket(fab, aid)
    token_ham = await _qr_token(paket.id)

    govde = (await client.get(ETIKET.format(paket.id), headers=_bas(token))).json()
    assert "qr_token" not in govde
    assert all("qr_token" not in k for k in govde["items"])

    # `qr_payload` DIŞINDA kalan gövde token'ı içermemeli.
    kalan = dict(govde)
    kalan.pop("qr_payload")
    assert token_ham not in json.dumps(kalan, ensure_ascii=False)

    # Liste yüzeyleri token'ı hiçbir biçimde yaymaz — payload'un içinde bile.
    for yol in (KUYRUK, "/api/v1/packing/queue"):
        metin = (await client.get(yol, headers=_bas(token))).text
        assert token_ham not in metin, f"{yol} ham token sızdırıyor"
        assert "qr_token" not in metin, f"{yol} qr_token alanı taşıyor"


# ══════════════════ 4 · Adresi NULL olan sipariş ════════════════════════════


async def test_ADRESSIZ_SIPARISTE_ETIKET_500_VERMEZ_VE_NULL_DONER(client, fab, kur):
    """Eksik adres bir hata değil, bir VERİDİR — ve `null` olarak döner.

    Sözleşme: sunucu yer tutucu üretmez. `""` dönseydi ekran veriyi VAR sanar,
    "—" dönseydi "veri eksik" uyarısı imkânsızlaşırdı; ikisi de F26'daki "etiket
    bomboş basıldı, kimse fark etmedi" hatasının yoluydu. Yalnız-boşluk değer de
    `null`'a indirgenir, yoksa istemci iki farklı "boş" ile uğraşırdı.
    """
    _aid, token = await kur.admin(izinler=[VIEW])
    aid = await fab.admin()
    oid, paket, _k = await _packed_paket(fab, aid)
    await _sql(
        "UPDATE orders SET ship_recipient = NULL, ship_address = NULL, "
        "ship_city = NULL, ship_district = '   ', delivery_pref_note = '' "
        "WHERE id = :i",
        i=oid,
    )

    r = await client.get(ETIKET.format(paket.id), headers=_bas(token))
    assert r.status_code == 200, r.text
    govde = r.json()
    for alan in ("recipient", "address", "city", "district", "delivery_pref_note"):
        assert alan in govde, f"{alan} sözleşmeden düşmüş"
        assert govde[alan] is None, f"{alan} = {govde[alan]!r} (null bekleniyordu)"
    # NOT NULL kolon: tercih her zaman doludur, "boş" bir talimat yoktur.
    assert govde["delivery_pref"] == "ADRESIMDEYIM"
    # Paket kimliği ve kalemler eksik adresten ETKİLENMEZ — kutu hâlâ basılabilir.
    assert govde["qr_payload"].startswith("PKG1:")
    assert len(govde["items"]) == 1


# ══════════════════ 5 · Yetki ═══════════════════════════════════════════════


@pytest.mark.parametrize("izinler", [[], [PACK, MANAGE]], ids=["izinsiz", "pack+manage"])
async def test_PACKING_VIEW_OLMADAN_ETIKET_ALINAMAZ(client, fab, kur, izinler):
    """Etiket verisi `packing.view` kapısının ARKASINDADIR.

    İki vaka bilinçli: izinsiz admin (kapının varlığı) ve `pack`+`manage` yetkili
    admin (kapının DOĞRU izne bağlı olduğu). İkincisi olmasaydı, ucu herhangi bir
    paketleme iznine bağlamak testi geçerdi.
    """
    _aid_yetkili, yetkili = await kur.admin(izinler=[VIEW])
    aid = await fab.admin()
    _oid, paket, _k = await _packed_paket(fab, aid)
    _aid, token = await kur.admin(izinler=izinler)

    r = await client.get(ETIKET.format(paket.id), headers=_bas(token))
    assert r.status_code == 403, f"{izinler} → {r.status_code}: {r.text}"

    # Ters prova: aynı uç, `packing.view` ile 200 — "hep 403 dönen" bir uç da
    # yukarıdaki iddiayı geçerdi.
    ok = await client.get(ETIKET.format(paket.id), headers=_bas(yetkili))
    assert ok.status_code == 200, ok.text


async def test_ETIKET_TOKENSIZ_401_MUSTERIYE_403(client, fab, kur):
    """Kimliksiz istek 401; CLIENT token'ı 403 — sevkiyat kimliği paketleme
    yüzeyinin dışına çıkmaz."""
    from core.security import create_access_token

    aid = await fab.admin()
    _oid, paket, _k = await _packed_paket(fab, aid)

    assert (await client.get(ETIKET.format(paket.id))).status_code == 401
    cid = await fab.musteri()
    musteri = create_access_token(subject=cid, role="CLIENT", role_id=3)
    r = await client.get(ETIKET.format(paket.id), headers=_bas(musteri))
    assert r.status_code == 403, r.text


# ══════════════════ 6 · return-queue sayfalaması ════════════════════════════


async def _return_pending_paketler(fab: PaketFabrikasi, aid: int, adet: int):
    """`adet` kadar `RETURN_PENDING` paket — GERÇEK yoldan.

    Zincir kısaltılmaz: paket açılır, kalem okutulur, tamamlanır, tura eklenir,
    kuryeye ZİMMETLENİR, tur başlar ve durak `fail_stop` ile sonuçlanır. Durumu
    SQL ile yazmak, kuyruğun beslendiği geçiş mantığını (ve `handed_to_courier_id`
    dolgusunu) atlardı.

    Hepsi TEK turdadır: `uq_delivery_run_planned` gün+araç başına tek planlı tura
    izin verir, yani paket başına ayrı tur açmak fikstürü gereksizce günlere
    yayardı.
    """
    kurye = await fab.kurye()
    run = await fab.tur(courier_id=kurye)
    paketler = []
    for _ in range(adet):
        oid, paket, _k = await _packed_paket(fab, aid)
        paketler.append((oid, paket))
    async with AsyncSessionLocal() as s:
        tur = await delivery_service.add_stops(s, run, [o for o, _p in paketler])
    for _oid, paket in paketler:
        async with AsyncSessionLocal() as s:
            await delivery_service.handover_scan(
                s, paket.qr_payload, courier_id=kurye, actor=f"courier:{kurye}"
            )
    async with AsyncSessionLocal() as s:
        await delivery_service.start_run(s, run)
    for oid, _paket in paketler:
        stop_id = [d for d in tur.stops if d.order_id == oid][0].id
        async with AsyncSessionLocal() as s:
            await delivery_service.fail_stop(
                s, stop_id, reason="Kimse yoktu", reason_code="EVDE_YOK"
            )
    return kurye, [p.id for _o, p in paketler]


async def test_RETURN_QUEUE_SAYFALARI_KAYIT_TEKRARI_VE_ATLAMASI_URETMEZ(
    client, fab, kur
):
    """Çok sayfalı gerçek veri: `total` süzülmüş toplamdır ve sayfalar TAM KÜME.

    Üç ayrı iddia:
      1. `total` sayfanın uzunluğu DEĞİLDİR (`total > len(items)` açıkça ölçülür)
         — eski uç bu ayrımı hiç yapmıyordu.
      2. Sayfa sayfa gezilen kayıtların birleşimi, tek istekte alınan tam kümeye
         **sırasıyla** eşittir: hiçbir kayıt iki sayfada görünmez, hiçbiri
         atlanmaz.
      3. Sıralama bağlayıcısı gerçekten çalışır: fikstür beş paketin
         `handed_over_at` damgasını EŞİTLER, yani sırayı yalnız `id` belirler.
         Bu eşitleme olmasaydı zaman damgaları doğal olarak ayrışır ve test
         bağlayıcı kaldırılsa da yeşil kalırdı (yalancı yeşil).
    """
    _aid, token = await kur.admin(izinler=[VIEW])
    aid = await fab.admin()
    kurye, paket_idleri = await _return_pending_paketler(fab, aid, 5)
    await _sql(
        "UPDATE order_packages SET handed_over_at = "
        "(SELECT min(handed_over_at) FROM order_packages WHERE id = ANY(:p)) "
        "WHERE id = ANY(:p)",
        p=paket_idleri,
    )

    tam = (await client.get(KUYRUK, params={"limit": 200}, headers=_bas(token))).json()
    assert tam["total"] == len(tam["items"]) <= 200, tam["total"]
    assert set(paket_idleri) <= {r["package_id"] for r in tam["items"]}
    toplam = tam["total"]
    assert math.ceil(toplam / 2) >= 3, f"en az 3 sayfa gerekiyordu: {toplam}"

    sayfalar = []
    for offset in range(0, toplam, 2):
        r = await client.get(
            KUYRUK, params={"limit": 2, "offset": offset}, headers=_bas(token)
        )
        assert r.status_code == 200, r.text
        sayfa = r.json()
        assert sayfa["limit"] == 2 and sayfa["offset"] == offset
        assert sayfa["total"] == toplam, "toplam sayfadan sayfaya değişti"
        assert sayfa["total"] > len(sayfa["items"]), "total = sayfa uzunluğu"
        assert len(sayfa["items"]) <= 2
        sayfalar.append(sayfa["items"])

    gezilen = [r["package_id"] for sayfa in sayfalar for r in sayfa]
    assert len(gezilen) == len(set(gezilen)), f"kayıt tekrarı: {gezilen}"
    assert gezilen == [r["package_id"] for r in tam["items"]], "kayıt atlandı/kaydı"

    # Satırın kendisi de anlamlı: hangi kuryede olduğu ve kaç gündür beklediği
    # (TB-7 görünürlüğü) sayfalı yanıtta da duruyor mu?
    ornek = next(r for r in tam["items"] if r["package_id"] == paket_idleri[0])
    assert ornek["package_code"] == f"PKT-{paket_idleri[0]:06d}"
    assert ornek["courier_id"] == kurye
    assert ornek["courier_name"] is not None
    assert ornek["waiting_days"] == 0


# ══════════════════ 7 · Geçersiz sayfalama ══════════════════════════════════


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 201},
        {"limit": "abc"},
        {"offset": -1},
        {"offset": 100001},
    ],
    ids=["limit=0", "limit=201", "limit=abc", "offset=-1", "offset=asiri"],
)
async def test_RETURN_QUEUE_GECERSIZ_SAYFALAMA_422(client, kur, params):
    """Tavan/taban ihlali sessizce kırpılmaz, **422** ile reddedilir.

    Sessiz kırpma istemciye "istediğin sayfayı verdim" der; 201 isteyip 200
    alan bir istemci son kaydı hiç görmez ve bunu anlayamaz.
    """
    _aid, token = await kur.admin(izinler=[VIEW])
    r = await client.get(KUYRUK, params=params, headers=_bas(token))
    assert r.status_code == 422, f"{params} → {r.status_code}: {r.text}"


async def test_RETURN_QUEUE_TAVANI_SERVISTE_DE_UYGULANIR(pg):
    """Router `Query`'si tek koruma değildir: servisi doğrudan çağıran bir arka
    plan işi de tabloyu tek istekte çekememelidir.

    Ölçüm gerçek SQL üzerindendir — `LIMIT` değeri Postgres'e ne olarak gitti?
    "200 satır üretip say" yaklaşımı test veritabanında gerçekçi değildi ve
    tavan kaldırılsa bile yeşil kalırdı (kardeş dosyada mutasyon provası bunu
    yakaladı).
    """
    async with AsyncSessionLocal() as s:
        await s.execute(text("SELECT 1"))          # bağlantıyı ısıt
        with _sorgu_sayaci() as ifadeler:
            await packing_service.return_queue(s, limit=10_000, offset=-5)
    sayfa = [
        (metin, params)
        for metin, params in ifadeler
        if "order_packages" in metin and "count(" not in metin
    ]
    assert len(sayfa) == 1, f"kuyruk sorgusu bulunamadı: {[m for m, _p in sayfa]}"
    metin, params = sayfa[0]
    limit, offset = _limit_offset(metin, list(params or []))
    assert limit == packing_service.RETURN_QUEUE_MAX_LIMIT, metin
    assert offset == 0, metin
    # Deterministik sıra: son bağlayıcı `id` gerçekten cümlede mi?
    assert "ORDER BY" in metin
    assert metin.split("ORDER BY")[1].split("LIMIT")[0].strip().endswith("id ASC"), (
        f"sayfalar arası kayma nöbetçisi (id bağlayıcısı) cümlede yok: {metin}"
    )


# ══════════════════ 8 · Sorgu sayısı satırla ARTMIYOR ═══════════════════════


async def _kuyruk_sorgu_sayisi() -> int:
    async with AsyncSessionLocal() as s:
        await s.execute(text("SELECT 1"))          # bağlantıyı ısıt (sayım dışı)
        with _sorgu_sayaci() as ifadeler:
            await packing_service.return_queue_page(s, limit=200)
    return len(ifadeler)


async def test_RETURN_QUEUE_SORGU_SAYISI_SATIR_SAYISIYLA_ARTMAZ(fab):
    """Kurye adı satır başına ikinci bir sorgu ATMAZ (N+1 nöbetçisi).

    1 satırlık ve 5 satırlık kuyruk AYNI sayıda sorgu üretmelidir. `outerjoin`
    yerine satır başına `Courier` okuması yazılırsa sayı 5 artar ve düğüm kırılır
    — `packing_queue`'da bu hata bir kez gerçekten yapılmıştı (25 satır = 29
    sorgu) ve `eligible_orders`'ta bir kez daha.
    """
    aid = await fab.admin()
    await _return_pending_paketler(fab, aid, 1)
    bir_satir = await _kuyruk_sorgu_sayisi()

    await _return_pending_paketler(fab, aid, 4)
    bes_satir = await _kuyruk_sorgu_sayisi()

    # Kuyrukta gerçekten 5 satır var mı? (ölçümün boş kümede yapılmadığının kanıtı)
    async with AsyncSessionLocal() as s:
        satirlar = await packing_service.return_queue(s, limit=200)
    assert len(satirlar) >= 5, f"fikstür kuyruğu doldurmamış: {len(satirlar)}"

    assert bes_satir == bir_satir, (
        f"sorgu sayısı satırla arttı: 1 satır → {bir_satir}, 5 satır → {bes_satir}"
    )
    # Üst sınır: sayfa + sayım = 2 (aynı fonksiyonun iki cümlesi).
    assert bes_satir <= 2, f"beklenenden fazla sorgu: {bes_satir}"
