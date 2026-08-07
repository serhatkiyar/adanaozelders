"""İP-12 · Mağaza panel yüzeyi — SUNUCU KABUL MATRİSİ (gerçek Postgres + gerçek HTTP).

SÖZLEŞME: Bu dosya davranış bilinçli değiştirilmedikçe DÜZENLENMEZ.

Paketin kırmızı matris commit'i olduğu için uçlar henüz bu sözleşmeyi
taşımıyor: ilk koşum KIRMIZIDIR.

## Bu dosya neyi kanıtlar, neyi kanıtlamaz

Kanıtlar: uca giden parametrenin sunucuda GERÇEKTEN filtrelediğini, yanıtın
alanlarını ve toplam sayıyı. Her iddia gerçek HTTP + gerçek yetki çözümü +
gerçek Postgres üzerinden ölçülür; dependency override yoktur.

Kanıtlamaz: ekranda ne göründüğünü. Onu `AdminStore` DOM matrisi ölçer —
"uç doğru veriyi dönüyor" ile "kullanıcı doğru veriyi görüyor" ayrı iddialardır
ve bu paketin başarısızlık sınıfı tam olarak ikisinin arasında yaşıyor.

## Ölçülen taban (bu dosya yazılmadan önce)

- `GET /store/admin/products` yalnız `limit` + `offset` alıyor; `q`, filtre ve
  toplam sayı YOK. Yani "yayınevi/yazar zaten destekleniyor" ifadesi **public**
  uç (`/store/products`) için doğru, admin ucu için değil.
- `ProductSearchOut` yalnız `in_stock: bool` taşıyor; `stock` yalnız
  `ProductDetailOut`'ta.
- `Product.search_vector` = `title + description + author + publisher`
  (Computed, persisted). ISBN ve SKU vektörde YOK; trigram kolu yalnız `title`.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

ADMIN_URUN = "/api/v1/store/admin/products"
PUBLIC_URUN = "/api/v1/store/products"


async def _liste(http, headers, **params) -> list[dict]:
    r = await http.get(ADMIN_URUN, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _basliklar(kayitlar) -> set[str]:
    return {k["title"] for k in kayitlar}


# ═══════════════════════════════════════════════════════════════════════════
# P · Ürün listesi sözleşmesi
# ═══════════════════════════════════════════════════════════════════════════


class TestUrunListesi:
    async def test_p3_toplam_kayit_sayisi_donuyor(self, http, fab12):
        """P-3 · Toplam kayıt sayısı GÖRÜNÜR.

        Sayfalaması olan bir listede toplam sayı olmadan "101. ürün nerede"
        sorusu cevaplanamaz: kullanıcı sayfanın son olup olmadığını bilemez.
        Panelin geri kalanı bunu `X-Total-Count` ile veriyor (admin kullanıcı /
        booking / demand / audit listeleri) — aynı sözleşme burada da geçerli.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        for _ in range(3):
            await fab12.kitap()

        r = await http.get(ADMIN_URUN, headers=headers, params={"limit": 2})
        assert r.status_code == 200, r.text
        assert len(r.json()) == 2, "limit uygulanmadı"

        assert "x-total-count" in {k.lower() for k in r.headers}, (
            "X-Total-Count yok — istemci toplam kaydı bilemez, sayfalama "
            "'son sayfa mıyım' sorusunu cevaplayamaz"
        )
        assert int(r.headers["X-Total-Count"]) >= 3

    async def test_p3b_toplam_sayfalamadan_bagimsiz(self, http, fab12):
        """P-3 · Toplam, DÖNEN satır sayısı değil EŞLEŞEN kayıt sayısıdır.

        Mutasyona duyarlılık: uç `len(rows)` döndürerek de header'ı
        doldurabilirdi ve önceki test bunu yakalamazdı (limit=2, total=2).
        Burada limit toplamdan KÜÇÜK seçilir; eşitlik ölçülür.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        for _ in range(4):
            await fab12.kitap()

        tam = await http.get(ADMIN_URUN, headers=headers, params={"limit": 200})
        toplam_gercek = len(tam.json())

        r = await http.get(ADMIN_URUN, headers=headers, params={"limit": 1})
        assert len(r.json()) == 1
        assert int(r.headers["X-Total-Count"]) == toplam_gercek, (
            "X-Total-Count dönen satır sayısını yansıtıyor; eşleşen kayıt "
            "sayısını değil"
        )

    async def test_p5_stok_sayi_olarak_doner(self, http, fab12):
        """P-5 · Liste şeması stoğu SAYI olarak taşır (`in_stock` boolean değil).

        "X kitabından kaç adet var" sorusu bugün modal açmadan cevaplanamıyor;
        `in_stock` yalnız 0/0-değil ayrımı yapıyor ve o da basılmıyor.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        k = await fab12.kitap(stock=7)

        kayitlar = await _liste(http, headers, limit=200)
        satir = next(x for x in kayitlar if x["id"] == k.id)

        assert "stock" in satir, "ProductSearchOut'ta stock alanı yok"
        assert satir["stock"] == 7, f"stok yanlış: {satir['stock']}"

    async def test_p5b_dijital_urunde_stok_null(self, http, fab12):
        """P-5 · Dijitalde stok `null` — 0 DEĞİL.

        0 yazmak "tükendi" demektir ve dijital ürün tükenmez. Şema
        `int | None` olmalı; rozet mantığı da bu ayrımı okuyacak.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        d = await fab12.kitap(kind="DIGITAL", stock=0)

        kayitlar = await _liste(http, headers, limit=200)
        satir = next(x for x in kayitlar if x["id"] == d.id)

        assert satir["stock"] is None, (
            f"dijital ürün stoğu {satir['stock']} — null olmalı, "
            "aksi hâlde 'Tükendi' rozeti basılır"
        )

    async def test_p2_offset_gercekten_kaydiriyor(self, http, fab12):
        """P-2 · Sunucu sayfalaması: `offset` FARKLI kayıt döndürür.

        İstemci dilimlemesi ile sunucu sayfalamasının ayırt edici testi budur:
        aynı `limit` ile iki farklı `offset`, kesişmeyen kümeler vermeli.

        DÜRÜSTLÜK NOTU — bu node kırmızı BAŞLAMAZ ve başlaması da beklenmez:
        `limit`/`offset` uçta zaten var, eksik olan istemcinin onları
        GÖNDERMESİ. P-2'nin kırmızı yarısı bu yüzden DOM matrisinde yaşıyor
        (istek gövdesi ölçülerek). Buradaki test, uygulama sırasında sunucu
        yarısının bozulmadığını garanti eden nöbetçidir.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        for _ in range(3):
            await fab12.kitap()

        s0 = await _liste(http, headers, limit=1, offset=0)
        s1 = await _liste(http, headers, limit=1, offset=1)

        assert len(s0) == 1 and len(s1) == 1
        assert s0[0]["id"] != s1[0]["id"], "offset kaydırmıyor"


# ═══════════════════════════════════════════════════════════════════════════
# F · Stok ve künye filtreleri
# ═══════════════════════════════════════════════════════════════════════════


class TestStokFiltresi:
    """F-1/F-2/F-3 · `?stok=tukendi|azalan|var`.

    Eşik TEK kaynaktan gelir (`LOW_STOCK_THRESHOLD`); testler eşiği kendi
    sabitleriyle tekrarlamaz — tekrarlasalardı, eşik değiştiğinde test
    üretimle birlikte kaymaz ve yalancı yeşile dönerdi.
    """

    async def _kurulum(self, fab12):
        return {
            "tukendi": await fab12.kitap(stock=0),
            "az": await fab12.kitap(stock=1),
            "bol": await fab12.kitap(stock=500),
        }

    async def test_f1_tukendi_yalniz_sifir(self, http, fab12):
        from core.stock_policy import LOW_STOCK_THRESHOLD  # noqa: F401

        admin_id, headers = await fab12.admin(izinler=["products.view"])
        u = await self._kurulum(fab12)

        kayitlar = await _liste(http, headers, limit=200, stok="tukendi")
        idler = {k["id"] for k in kayitlar}

        assert u["tukendi"].id in idler
        assert u["az"].id not in idler, "stoğu olan ürün 'tükendi' filtresinde"
        assert u["bol"].id not in idler
        assert all(k["stock"] == 0 for k in kayitlar), "0 olmayan kayıt sızdı"

    async def test_f2_azalan_sifir_ile_esik_arasi(self, http, fab12):
        from core.stock_policy import LOW_STOCK_THRESHOLD

        admin_id, headers = await fab12.admin(izinler=["products.view"])
        u = await self._kurulum(fab12)
        esikte = await fab12.kitap(stock=LOW_STOCK_THRESHOLD)
        esik_ustu = await fab12.kitap(stock=LOW_STOCK_THRESHOLD + 1)

        kayitlar = await _liste(http, headers, limit=200, stok="azalan")
        idler = {k["id"] for k in kayitlar}

        assert u["az"].id in idler
        assert esikte.id in idler, "eşiğin KENDİSİ 'azalan' sayılmalı (<=)"
        assert esik_ustu.id not in idler, "eşiğin üstü 'azalan' değil"
        assert u["tukendi"].id not in idler, (
            "stoğu 0 olan 'azalan' değil 'tükendi'dir — ikisi ayrı karar: "
            "biri yeniden sipariş, diğeri acil"
        )
        assert all(0 < k["stock"] <= LOW_STOCK_THRESHOLD for k in kayitlar)

    async def test_f3_var_yalniz_esik_ustu(self, http, fab12):
        from core.stock_policy import LOW_STOCK_THRESHOLD

        admin_id, headers = await fab12.admin(izinler=["products.view"])
        u = await self._kurulum(fab12)

        kayitlar = await _liste(http, headers, limit=200, stok="var")
        idler = {k["id"] for k in kayitlar}

        assert u["bol"].id in idler
        assert u["az"].id not in idler
        assert u["tukendi"].id not in idler
        assert all(
            k["stock"] is None or k["stock"] > LOW_STOCK_THRESHOLD for k in kayitlar
        )

    async def test_f_gecersiz_stok_degeri_422(self, http, fab12):
        """Geçersiz filtre 422 döner — SESSİZCE BOŞ LİSTE değil.

        [[TB-19]]/1 bu sınıfı kayda geçirmişti: `str` tipli filtre
        parametresi yazım hatasında sessizce boş liste döndürüyor ve admin
        "hiç ürün yok" sanıyor. Yeni parametre o hatayı tekrarlamamalı —
        şema seviyesinde Enum/Literal ile bağlanmalı.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        await fab12.kitap(stock=3)

        r = await http.get(
            ADMIN_URUN, headers=headers, params={"stok": "azalann"}
        )
        assert r.status_code == 422, (
            f"geçersiz filtre {r.status_code} döndü — sessiz boş liste, "
            "adminin 'katalog boş' sanmasına yol açar"
        )


class TestKunyeFiltresi:
    async def test_f7_yayinevi_filtresi_sunucuda(self, http, fab12):
        """F-7 · Yayınevi filtresi ADMIN ucunda.

        Rapor "search_products zaten destekliyor, bağlanması yeter" diyordu;
        ölçüm bunu düzeltti: destek **public** uçta. Admin listesi ayrı bir
        servis fonksiyonu (`list_products_admin`) ve public uca yönlendirmek
        de çözüm değil — o `status == ACTIVE` zorluyor, admin listesi ise
        taslak/gizli ürünü göstermek zorunda.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        palme = await fab12.kitap(publisher="Palme Yayınları")
        tonguc = await fab12.kitap(publisher="Tonguç Akademi")

        kayitlar = await _liste(
            http, headers, limit=200, publisher="Palme Yayınları"
        )
        idler = {k["id"] for k in kayitlar}

        assert palme.id in idler
        assert tonguc.id not in idler, "yayınevi filtresi filtrelemiyor"

    async def test_f7b_yayinevi_turkce_normalize(self, http, fab12):
        """F-7 · Filtre Türkçe normalize karşılaştırır.

        Public uç bunu zaten yapıyor (`normalized(column).in_(...)`);
        admin ucu aynı davranışı taşımalı, yoksa "palme yayinlari" yazan
        yönetici boş liste görür.

        NEGATİF KONTROL ŞART: FastAPI tanımadığı query parametresini sessizce
        yok sayar. Yalnız "palme listede var mı" diye sorsaydık, filtre HİÇ
        UYGULANMADIĞINDA da (tüm katalog döndüğü için) test geçerdi —
        yalancı yeşil. İlk yazımında tam olarak bu oldu.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        palme = await fab12.kitap(publisher="Palme Yayınları")
        tonguc = await fab12.kitap(publisher="Tonguç Akademi")

        kayitlar = await _liste(
            http, headers, limit=200, publisher="palme yayinlari"
        )
        idler = {k["id"] for k in kayitlar}
        assert palme.id in idler, "normalize edilmiş yayınevi eşleşmedi"
        assert tonguc.id not in idler, (
            "başka yayınevi de döndü — filtre uygulanmıyor (parametre sessizce "
            "yok sayılmış olabilir)"
        )

    async def test_f8_yazar_filtresi_sunucuda(self, http, fab12):
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        a = await fab12.kitap(author="Ahmet Yılmaz")
        b = await fab12.kitap(author="Zeynep Kaya")

        kayitlar = await _liste(http, headers, limit=200, author="Ahmet Yılmaz")
        idler = {k["id"] for k in kayitlar}

        assert a.id in idler
        assert b.id not in idler

    async def test_f_taslak_urun_admin_listesinde_kalir(self, http, fab12):
        """Filtreler eklendikten SONRA da admin listesi taslağı göstermeli.

        Regresyon nöbetçisi: admin ucunu public `search_products`'a
        yönlendirmek en kolay uygulama yoludur ve bu testi kırar.

        Test İKİ şeyi birden ister — filtrenin gerçekten uygulanmasını VE
        taslağın kalmasını. Yalnız ikincisini istemek yetmezdi: filtre hiç
        uygulanmadığında da taslak dönerdi (yalancı yeşil).
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        taslak = await fab12.kitap(status="HIDDEN", publisher="Palme Yayınları")
        baska = await fab12.kitap(status="ACTIVE", publisher="Tonguç Akademi")

        kayitlar = await _liste(
            http, headers, limit=200, publisher="Palme Yayınları"
        )
        idler = {k["id"] for k in kayitlar}
        assert baska.id not in idler, "filtre uygulanmıyor"
        assert taslak.id in idler, (
            "gizli/taslak ürün admin listesinden düştü — admin listesi "
            "katalogun tamamını göstermek zorunda"
        )


# ═══════════════════════════════════════════════════════════════════════════
# A · Arama (q) — başlık / yazar / yayınevi / ISBN / SKU
# ═══════════════════════════════════════════════════════════════════════════


class TestArama:
    async def test_a1_baslikla_eslesir(self, http, fab12):
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        hedef = await fab12.kitap(title="Nişantaşı Geometri Soru Bankası")
        digeri = await fab12.kitap(title="Fizik Konu Anlatımı")

        kayitlar = await _liste(http, headers, limit=200, q="geometri")
        idler = {k["id"] for k in kayitlar}

        assert hedef.id in idler
        assert digeri.id not in idler

    async def test_a1b_diakritik_duyarsiz(self, http, fab12):
        """"nisantasi" yazan yönetici "Nişantaşı"yı bulmalı.

        Public uç bunu `tr_normalize` ile yapıyor; admin araması aynı
        normalizasyonu kullanmalı — ayrı bir arama yolu yazmak iki yüzeyin
        davranışını zamanla ayırır.

        Negatif kontrol aynı sebeple zorunlu (bkz. `test_f7b_...`): `q` yok
        sayılırsa tüm katalog döner ve pozitif iddia kendiliğinden doğrulanır.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        hedef = await fab12.kitap(title="Nişantaşı Geometri Soru Bankası")
        alakasiz = await fab12.kitap(title="Kimya Konu Anlatımı")

        kayitlar = await _liste(http, headers, limit=200, q="nisantasi")
        idler = {k["id"] for k in kayitlar}
        assert hedef.id in idler, "diakritiksiz sorgu eşleşmedi"
        assert alakasiz.id not in idler, (
            "alakasız ürün de döndü — arama uygulanmıyor"
        )

    async def test_a2_yazar_ve_yayineviyle_eslesir(self, http, fab12):
        """A-2 · Kullanıcı çoğu zaman kitabın adını değil yazarını hatırlar."""
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        yazarli = await fab12.kitap(title="Konu Anlatımı", author="Tonguç Öğretmen")
        yayinevili = await fab12.kitap(title="Deneme Seti", publisher="Palme Yayınları")
        alakasiz = await fab12.kitap(title="Tarih Atlası")

        y = await _liste(http, headers, limit=200, q="tonguç")
        assert yazarli.id in {k["id"] for k in y}
        assert alakasiz.id not in {k["id"] for k in y}

        p = await _liste(http, headers, limit=200, q="palme")
        assert yayinevili.id in {k["id"] for k in p}
        assert alakasiz.id not in {k["id"] for k in p}

    async def test_a3_isbn_tam_eslesme(self, http, fab12):
        """A-3 · ISBN ile TAM eşleşme.

        Bugün ISBN `search_vector`'de yok — ne yönetici ne müşteri kitabı
        ISBN'iyle bulabiliyor. Barkod okuyucu ISBN'i klavye girdisi olarak
        yazdığı için bu, fiziksel mağaza akışının önündeki tek engel.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        hedef = await fab12.kitap(title="Geometri", isbn="9786051234567")
        komsu = await fab12.kitap(title="Geometri 2", isbn="9786051234568")

        kayitlar = await _liste(http, headers, limit=200, q="9786051234567")
        idler = {k["id"] for k in kayitlar}

        assert hedef.id in idler, "ISBN ile arama sonuç vermedi"
        assert komsu.id not in idler, (
            "komşu ISBN de döndü — ISBN'de 'yakın eşleşme' diye bir şey "
            "yoktur, komşu ISBN BAŞKA bir kitaptır"
        )

    async def test_a4_sku_ile_eslesir(self, http, fab12):
        """A-4 · SKU ile arama.

        SKU bizim ürettiğimiz stok kalemi kimliği (`FZK-000042`) ve
        BEFORE INSERT trigger'ı yazar. Fabrika onu DB'den okur, uydurmaz.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        hedef = await fab12.kitap()
        digeri = await fab12.kitap()

        kayitlar = await _liste(http, headers, limit=200, q=hedef.sku)
        idler = {k["id"] for k in kayitlar}

        assert hedef.id in idler, f"SKU ({hedef.sku}) ile arama sonuç vermedi"
        assert digeri.id not in idler

    async def test_a5_onuc_hane_trigram_gurultusu_uretmez(self, http, fab12):
        """A-5 · 13 haneli rakam dizisi trigram koluna DÜŞMEZ.

        Trigram, rakam dizilerinde gürültü üretir: "9786051234567" ile
        "9786051234568" üç-gram düzeyinde neredeyse aynıdır. Bu yüzden 13
        haneli saf rakam girdisi tam eşleşmeye YÖNLENDİRİLİR; benzerlik
        koluna bırakılmaz.

        Testin ayırt ediciliği: başlığı rakam dizisi olan bir ürün eklenir.
        Trigram kolu açık kalırsa o da eşleşir ve sonuç kirlenir.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        hedef = await fab12.kitap(title="Geometri", isbn="9786051234567")
        yakin_baslik = await fab12.kitap(title="9786051234568")
        yakin_isbn = await fab12.kitap(title="Fizik", isbn="9786051234568")

        kayitlar = await _liste(http, headers, limit=200, q="9786051234567")
        idler = {k["id"] for k in kayitlar}

        assert hedef.id in idler
        assert yakin_baslik.id not in idler, (
            "trigram gürültüsü: başlığı komşu rakam dizisi olan ürün de döndü"
        )
        assert yakin_isbn.id not in idler
        assert len(kayitlar) == 1, (
            f"13 hane taramında {len(kayitlar)} kayıt döndü — tam eşleşme "
            "tek kayıt vermeli"
        )

    async def test_a6_kismi_isbn_prefix_esler(self, http, fab12):
        """A-6 · Kısmi ISBN davranışı — SÖZLEŞME.

        Karar: 13 haneden KISA saf rakam dizisi **önek (prefix)** olarak
        eşleşir. Gerekçe: yayınevi öneki (978-605-...) kitapçının gerçek bir
        daraltma ekseni ve barkod okuyucu bazen eksik okur. Trigram DEĞİL
        önek: "0605" gibi ortadan bir parça eşleşmez, çünkü ISBN'de ortadaki
        benzerlik anlam taşımaz.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        a = await fab12.kitap(title="A", isbn="9786051234567")
        b = await fab12.kitap(title="B", isbn="9786051239999")
        c = await fab12.kitap(title="C", isbn="9789441234567")

        onek = await _liste(http, headers, limit=200, q="978605")
        idler = {k["id"] for k in onek}
        assert a.id in idler and b.id in idler, "yayınevi öneki eşleşmedi"
        assert c.id not in idler, "başka önekli ISBN de döndü"

        orta = await _liste(http, headers, limit=200, q="0512")
        assert a.id not in {k["id"] for k in orta}, (
            "ISBN ortasından bir parça eşleşti — önek sözleşmesi değil "
            "benzerlik uygulanmış"
        )


class TestVitrinAramasi:
    async def test_a7_vitrin_de_isbn_ile_bulur(self, http, fab12):
        """A-7 · Aynı `search_vector` vitrinde de çalışır.

        Vitrin araması ile admin araması aynı vektörü paylaşır; ISBN'i
        yalnız admin tarafına eklemek iki yüzeyi ayırırdı. Müşteri de elindeki
        kitabın arkasındaki numarayı yazabilmeli.
        """
        _, _ = await fab12.admin(izinler=["products.view"])
        hedef = await fab12.kitap(
            title="Vitrin Geometri", isbn="9786059876543", status="ACTIVE"
        )

        r = await http.get(PUBLIC_URUN, params={"q": "9786059876543", "limit": 50})
        assert r.status_code == 200, r.text
        assert hedef.id in {k["id"] for k in r.json()}, (
            "vitrin araması ISBN'i bulamıyor"
        )


# ═══════════════════════════════════════════════════════════════════════════
# Eşiğin tek kaynak olması
# ═══════════════════════════════════════════════════════════════════════════


class TestEsikTekKaynak:
    async def test_p9_dashboard_ayni_esigi_kullanir(self, http, fab12):
        """P-9 · Düşük stok eşiği TEK sabitten gelir.

        Ölçüm: eşik bugün ÜÇ yerde ayrı gömülü — `admin_service.py`
        (`stock <= 5`), `ProductDetailPage.tsx` (`LOW_STOCK = 5`) ve dashboard
        açıklama metni. Üçü bağımsız değiştirilebiliyor; biri kayarsa alarm
        kartı ile liste farklı ürün kümesi gösterir ve kimse fark etmez.

        Bu test davranışla ölçer: dashboard'ın saydığı ürün sayısı ile kartın
        AÇTIĞI listenin (`?stok=kritik`) aktif olanları aynı olmalı.

        Neden `kritik`, `azalan` değil: dashboard sayacı `stock <= eşik`
        diyor ve stoğu 0 olanı da sayıyor; `azalan` ise bilerek `0 < stock`
        (F-2: "stoğu 0 olan 'azalan' değil 'tükendi'dir"). Kart `azalan`a
        bağlansaydı sayı ile liste FARKLI küme gösterirdi — bu testin
        engellemek için var olduğu sapmanın ta kendisi. `kritik` ikisinin
        birleşimidir ve köprüyü kurar.

        KAPSAM FARKI bilinçlidir ve testte hesaba katılır: dashboard sayacı
        yalnız `ACTIVE` fiziksel ürünü sayar (kart metni de öyle diyor),
        yönetim listesi ise katalogun tamamını (taslak/gizli dahil) gösterir.
        Test bu yüzden listeyi `status == ACTIVE` ile daraltır — aksi hâlde
        kataloğa eklenen gizli bir ürün testi sebepsiz kırardı. Ölçülen şey
        kapsam değil, EŞİĞİN VE KOVA TANIMININ AYNI OLMASI.
        """
        from core.stock_policy import LOW_STOCK_THRESHOLD

        admin_id, headers = await fab12.admin(
            izinler=["products.view", "dashboard.view"]
        )
        await fab12.kitap(stock=LOW_STOCK_THRESHOLD)
        await fab12.kitap(stock=LOW_STOCK_THRESHOLD + 1)
        await fab12.kitap(stock=0)
        # Eşiğin ALTINDA ama gizli: dashboard saymamalı, liste göstermeli.
        await fab12.kitap(stock=1, status="HIDDEN")

        liste = await _liste(http, headers, limit=200, stok="kritik")
        aktif_azalan = [k for k in liste if k.get("status") == "ACTIVE"]

        # Dashboard sayaçları `/admin/dashboard` ucunda (`/admin/stats` ayrı
        # ve daha dar bir özet döner).
        r = await http.get("/api/v1/admin/dashboard", headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["low_stock_products"] == len(aktif_azalan), (
            "dashboard sayacı ile 'azalan' filtresi farklı küme sayıyor — "
            "eşik tek kaynaktan gelmiyor"
        )
        # Kapsam farkının kendisi de sözleşme: gizli ürün listede DURUR.
        assert len(liste) > len(aktif_azalan), (
            "gizli düşük-stoklu ürün yönetim listesinden düşmüş"
        )
        # `kritik` gerçekten birleşim mi: hem 0 hem eşik-altı içermeli.
        stoklar = {k["stock"] for k in liste}
        assert 0 in stoklar, "'kritik' tükenenleri kapsamıyor"
        assert any(0 < s <= LOW_STOCK_THRESHOLD for s in stoklar), (
            "'kritik' azalanları kapsamıyor"
        )
