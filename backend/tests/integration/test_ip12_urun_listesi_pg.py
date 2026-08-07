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


    async def test_a3b_isbn_ve_sku_arama_vektorunde(self, http, fab12):
        """A-3/A-4 · ISBN ve SKU `search_vector`'ün İÇİNDE (migration nöbetçisi).

        Neden ayrı bir node: `_arama_kolu`'nun kimlik dalları ISBN ve SKU'yu
        DOĞRUDAN kolondan okur ve vektöre hiç uğramaz. Yani
        `test_a3_isbn_tam_eslesme` ile `test_a4_sku_ile_eslesir`, migration
        geri alınsa bile GEÇERDİ — vektör değişikliğinin nöbetçisi değiller.

        Neden HTTP değil SQL: vektörü uçtan zorlamak için çok kelimeli bir
        sorgu gerekiyor ("geometri 978..."), ama o sorguda trigram kolu
        (`title % q`) başlık benzerliğiyle zaten eşleşme üretiyor ve iddiayı
        maskeliyor — ilk yazımında test tam olarak bu yüzden ayırt edici
        değildi (vektörsüz de geçiyordu). Vektörün İÇERİĞİ yapısal bir
        iddiadır ve doğrudan ölçülür; davranış tarafını A-3/A-4/A-7 taşıyor.
        """
        from sqlalchemy import text

        from core.database import AsyncSessionLocal

        k = await fab12.kitap(title="Alfa Kitap", isbn="9786051234567")

        async with AsyncSessionLocal() as s:
            eslesme = (
                await s.execute(
                    text(
                        "SELECT search_vector @@ to_tsquery('simple', :isbn) AS isbn_var,"
                        "       search_vector @@ to_tsquery('simple', :sku)  AS sku_var "
                        "FROM products WHERE id = :i"
                    ),
                    {"isbn": "9786051234567", "sku": k.sku.lower(), "i": k.id},
                )
            ).first()

        assert eslesme is not None, "ürün bulunamadı"
        assert eslesme[0] is True, (
            "ISBN arama vektöründe YOK — migration uygulanmamış ya da geri "
            "alınmış olabilir"
        )
        assert eslesme[1] is True, "SKU arama vektöründe YOK"


class TestVitrinAramasi:
    async def test_a7_vitrin_de_isbn_ile_bulur(self, http, fab12):
        """A-7 · Aynı `search_vector` vitrinde de çalışır.

        Vitrin araması ile admin araması aynı vektörü paylaşır; ISBN'i
        yalnız admin tarafına eklemek iki yüzeyi ayırırdı. Müşteri de elindeki
        kitabın arkasındaki numarayı yazabilmeli.

        NEGATİF KONTROL + KÜME BOYUTU ŞART (P1-3): ilk yazımında bu node
        yalnız "hedef sonuçta var mı" diye soruyordu ve audit M16 ile
        gösterdi ki vitrin arama dalı (`if q:`) tamamen kaldırılsa bile test
        GEÇİYORDU — o durumda tüm ACTIVE katalog dönüyor ve hedef doğal
        olarak içinde kalıyor. Yani node aramanın çalıştığını değil,
        katalogun boş olmadığını ölçüyordu.

        Artık üç şey birden isteniyor: hedef döner, eşleşmemesi gereken ürün
        DÖNMEZ, ve sonuç kümesi TAM OLARAK bir kayıttır. Sonuncusu kritik:
        yalnız negatif kontrol, arama dalı kalkıp katalogda başka ürün
        bulunmadığında yine sessizce geçerdi.
        """
        _, _ = await fab12.admin(izinler=["products.view"])
        hedef = await fab12.kitap(
            title="Vitrin Geometri", isbn="9786059876543", status="ACTIVE"
        )
        # Eşleşmemesi gereken, vitrinde GÖRÜNÜR (ACTIVE) ürünler: arama dalı
        # kapatılırsa bunlar da döner ve node kırılır.
        baska_isbn = await fab12.kitap(
            title="Vitrin Fizik", isbn="9789441112223", status="ACTIVE"
        )
        isbnsiz = await fab12.kitap(title="Vitrin Kimya", status="ACTIVE")

        r = await http.get(PUBLIC_URUN, params={"q": "9786059876543", "limit": 50})
        assert r.status_code == 200, r.text
        donenler = r.json()
        idler = {k["id"] for k in donenler}

        assert hedef.id in idler, "vitrin araması ISBN'i bulamıyor"
        assert baska_isbn.id not in idler, (
            "başka ISBN'li ürün de döndü — komşu ISBN başka bir kitaptır"
        )
        assert isbnsiz.id not in idler, (
            "ISBN'i olmayan ürün de döndü — arama dalı uygulanmıyor olabilir"
        )
        assert len(donenler) == 1, (
            f"ISBN tam eşleşmesi {len(donenler)} kayıt döndürdü; tam olarak "
            "bir kayıt beklenir. Katalogun tamamı dönüyorsa arama dalı hiç "
            "uygulanmıyordur"
        )


# ═══════════════════════════════════════════════════════════════════════════
# P1-5 · Sipariş listesi kesilme sözleşmesi
# ═══════════════════════════════════════════════════════════════════════════


ADMIN_SIPARIS = "/api/v1/store/admin/orders"


class TestSiparisKesilmesi:
    """Sipariş listesi kesildiğinde bunu SÖYLEYEBİLİR olmalı.

    Audit ölçümü: 130 siparişten 100'ü dönüyordu; istemci `limit`
    göndermiyor, sunucu varsayılanı 100 uyguluyor, `X-Total-Count` dönmüyordu
    ve ekrandaki uyarı sabit 200'e bakıyordu — yani uyarı ÜRETİMDE HİÇBİR
    KOŞULDA tetiklenemiyordu. DOM testi sahte sunucuya 200 kayıt uydurarak
    geçiyordu; sözleşme gerçek davranışla hiç sınanmamıştı.
    """

    async def test_p1_5_toplam_donuyor_ve_kesilmeyi_gorunur_kiliyor(
        self, http, fab12
    ):
        admin_id, headers = await fab12.admin(izinler=["orders.view"])
        await fab12.siparisler(130)

        r = await http.get(ADMIN_SIPARIS, headers=headers, params={"limit": 100})
        assert r.status_code == 200, r.text

        assert "x-total-count" in {k.lower() for k in r.headers}, (
            "X-Total-Count yok — istemci listenin kesilip kesilmediğini "
            "bilemez ve 'göremediğim kayıt var mı' sorusu sessizce "
            "cevapsız kalır"
        )
        donen = len(r.json())
        toplam = int(r.headers["X-Total-Count"])

        assert donen == 100, f"limit uygulanmadı: {donen}"
        assert toplam >= 130, f"toplam eşleşen sayı yanlış: {toplam}"
        # Kesilmenin GÖRÜNÜR olmasının ölçütü budur: toplam > dönen.
        assert toplam > donen, (
            "toplam ile dönen eşit — kesilme istemciye görünmüyor"
        )

    async def test_p1_5_toplam_esleseni_sayar_donen_satiri_degil(
        self, http, fab12
    ):
        """Toplam, filtreye göre EŞLEŞEN sayıdır; sayfa boyutu değil.

        Mutasyona duyarlılık: uç `len(rows)` döndürerek de başlığı
        doldurabilirdi ve önceki node bunu yakalamazdı (limit=100, dönen=100,
        toplam=100 → "kesilme yok" derdi).
        """
        admin_id, headers = await fab12.admin(izinler=["orders.view"])
        await fab12.siparisler(12, status="PAID")

        r = await http.get(ADMIN_SIPARIS, headers=headers, params={"limit": 5})
        assert r.status_code == 200, r.text
        assert len(r.json()) == 5
        assert int(r.headers["X-Total-Count"]) >= 12, (
            "X-Total-Count dönen satır sayısını yansıtıyor; eşleşen kayıt "
            "sayısını değil"
        )

    async def test_p1_5_durum_filtresi_toplami_da_daraltir(self, http, fab12):
        """Filtre uygulanınca toplam da daralmalı.

        Sayım ile listenin ayrı yüklem kullanması, "12 kayıt" yazıp 3 satır
        gösteren bir liste üretirdi — ürün ucunda bu ortak yardımcıyla
        çözülmüştü, sipariş ucunda da aynı sözleşme geçerli.
        """
        admin_id, headers = await fab12.admin(izinler=["orders.view"])
        await fab12.siparisler(7, status="PAID")
        await fab12.siparisler(3, status="SHIPPED")

        hepsi = await http.get(ADMIN_SIPARIS, headers=headers, params={"limit": 200})
        kargoda = await http.get(
            ADMIN_SIPARIS, headers=headers, params={"limit": 200, "status": "SHIPPED"}
        )

        toplam_hepsi = int(hepsi.headers["X-Total-Count"])
        toplam_kargoda = int(kargoda.headers["X-Total-Count"])

        assert toplam_kargoda < toplam_hepsi, "durum filtresi toplamı daraltmıyor"
        assert toplam_kargoda == len(kargoda.json()), (
            "filtreli listede toplam ile dönen satır sayısı tutmuyor"
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

        KAPSAM DA AYNI (P1-1): sayaç `status == ACTIVE` filtreliyordu, liste
        filtrelemiyordu; ölçümde sayaç 5, liste 7 çıktı (fark: bir taslak, bir
        gizli ürün). Karar — LİSTE DE `ACTIVE` filtreler. Gerekçe: kart bir
        "yeniden sipariş ver" alarmıdır ve taslak/gizli ürün zaten satışta
        değildir; onun için sipariş verilmez.

        Test artık DARALTMA YAPMADAN eşitlik ölçüyor. Önceki hâli listeyi
        `status == ACTIVE` ile süzüp karşılaştırıyordu — yani tam da sapmanın
        yaşandığı yeri test tarafında kapatıyordu ve kusuru göremezdi.
        """
        from core.stock_policy import LOW_STOCK_THRESHOLD

        admin_id, headers = await fab12.admin(
            izinler=["products.view", "dashboard.view"]
        )
        await fab12.kitap(stock=LOW_STOCK_THRESHOLD)
        await fab12.kitap(stock=LOW_STOCK_THRESHOLD + 1)
        await fab12.kitap(stock=0)
        # Eşiğin ALTINDA ama satışta DEĞİL: ikisi de sayaçtan da listeden de
        # düşmeli. Nöbetçinin çekirdeği bu iki satır.
        await fab12.kitap(stock=1, status="HIDDEN")
        await fab12.kitap(stock=2, status="DRAFT")

        liste = await _liste(http, headers, limit=200, stok="kritik")

        # Dashboard sayaçları `/admin/dashboard` ucunda (`/admin/stats` ayrı
        # ve daha dar bir özet döner).
        r = await http.get("/api/v1/admin/dashboard", headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["low_stock_products"] == len(liste), (
            f"kart {r.json()['low_stock_products']} diyor, açtığı liste "
            f"{len(liste)} kayıt gösteriyor — sayı ile liste AYNI küme değil"
        )

        # Satışta olmayan ürün kümenin DIŞINDA.
        durumlar = {k.get("status") for k in liste}
        assert durumlar <= {"ACTIVE"}, (
            f"listede satışta olmayan ürün var: {durumlar} — kart yeniden "
            "sipariş alarmı, taslak/gizli ürün için sipariş verilmez"
        )

        # `kritik` gerçekten birleşim mi: hem 0 hem eşik-altı içermeli.
        stoklar = {k["stock"] for k in liste}
        assert 0 in stoklar, "'kritik' tükenenleri kapsamıyor"
        assert any(0 < s <= LOW_STOCK_THRESHOLD for s in stoklar), (
            "'kritik' azalanları kapsamıyor"
        )

    async def test_p1_1_tukendi_ve_azalan_da_satista_olani_sayar(
        self, http, fab12
    ):
        """P1-1 · `tukendi` ve `azalan` da satışta olmayanı DIŞARIDA bırakır.

        `kritik` düzeltilip kardeşleri unutulursa üç kova birbirinden ayrışır:
        `kritik` ≠ `tukendi` ∪ `azalan` olur ve `stock_policy`'nin "birleşim"
        sözleşmesi sessizce yalana döner.
        """
        admin_id, headers = await fab12.admin(izinler=["products.view"])
        await fab12.kitap(stock=0, status="HIDDEN")
        await fab12.kitap(stock=1, status="DRAFT")

        for kova in ("tukendi", "azalan", "kritik"):
            kayitlar = await _liste(http, headers, limit=200, stok=kova)
            durumlar = {k.get("status") for k in kayitlar}
            assert durumlar <= {"ACTIVE"}, (
                f"'{kova}' filtresi satışta olmayan ürün döndürüyor: {durumlar}"
            )
