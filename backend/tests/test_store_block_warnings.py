"""Vitrin bloklarında 'hiçbir yere gitmiyor' uyarılarının kuralı.

NEDEN VAR (B-2, ölçüldü 24 Ağu 2026): canlı mağaza ana sayfasındaki dört
görsel kartın da `config.cards[0].link_url` alanı boştu, blok `link_url`'ü
`None`'dı ve hero slaytının da hedefi yoktu. Sonuç: kartlar mağazada link
gibi görünüp hiçbir yere gitmiyordu ve **panel bunu yöneticiye hiç
söylemiyordu**. Kayıt sırasında bir doğrulama, panelde bir uyarı yoktu.

Bu testler kuralın kendisini (saf fonksiyon) sınar. Uyarının yönetici
ekranında GERÇEKTEN göründüğü ayrıca DOM testiyle kanıtlanır
(`frontend/src/components/admin/store/landingUyarilari.test.tsx`) — saf
kural tek başına "kullanıcı uyarıyı görüyor" demez.
"""

from services.store_merchandising_service import block_link_warnings


def test_hedefsiz_baglanti_metni_uyarir():
    """Heading, `link_url` boşken metni HİÇ basmıyor -> sessiz veri kaybı."""
    uyarilar = block_link_warnings(
        block_type="IMAGE_CARD_GRID",
        link_label="Okula Dönüş Alışverişi",
        link_url=None,
        config={"cards": [{"image_url": "x.webp", "link_url": "/magaza/okula-donus"}]},
    )
    assert any("hedef" in u.lower() for u in uyarilar), uyarilar


def test_hedefi_olan_baglanti_metni_uyarmaz():
    assert (
        block_link_warnings(
            block_type="IMAGE_CARD_GRID",
            link_label="Keşfet",
            link_url="/magaza/okula-donus",
            config={"cards": [{"image_url": "x.webp"}]},
        )
        == []
    )


def test_hedefsiz_gorsel_kartlari_sayiyla_uyarir():
    uyarilar = block_link_warnings(
        block_type="IMAGE_CARD_GRID",
        link_label="",
        link_url=None,
        config={
            "cards": [
                {"image_url": "a.webp", "link_url": ""},
                {"image_url": "b.webp", "link_url": None},
                {"image_url": "c.webp", "link_url": "/magaza/kalemler"},
            ]
        },
    )
    assert len(uyarilar) == 1
    # Sayı ŞART: "bazı kartlar" cümlesi düzeltilebilir bir uyarı değildir.
    assert "2" in uyarilar[0], uyarilar


def test_blok_hedefi_kartlarin_hedefi_yerine_gecer():
    """Kart hedefi boşsa blok `link_url`'ü devreye girer (TrackedLink böyle)."""
    assert (
        block_link_warnings(
            block_type="IMAGE_CARD_GRID",
            link_label="",
            link_url="/magaza/okula-donus",
            config={"cards": [{"image_url": "a.webp", "link_url": ""}]},
        )
        == []
    )


def test_hedefsiz_hero_slaytlari_uyarir():
    uyarilar = block_link_warnings(
        block_type="HERO_CAROUSEL",
        link_label="",
        link_url=None,
        config={"slides": [{"image_url": "a.webp", "link_url": None}]},
    )
    assert len(uyarilar) == 1
    assert "1" in uyarilar[0], uyarilar


def test_hedefsiz_banner_uyarir():
    uyarilar = block_link_warnings(
        block_type="BANNER",
        link_label="",
        link_url=None,
        config={"image_url": "a.webp"},
    )
    assert len(uyarilar) == 1


def test_hedef_gerektirmeyen_bloklar_uyarmaz():
    """Metin, kategori, ürün ve son görüntülenenler blokları kendi
    yönlendirmesini üretir; hedefsizlik onlarda hata değildir."""
    for tip, config in (
        ("RICH_TEXT", {"text": "merhaba"}),
        ("CATEGORY_GRID", {"category_ids": [1, 2]}),
        ("PRODUCT_RAIL", {}),
        ("RECENTLY_VIEWED", {}),
    ):
        assert block_link_warnings(
            block_type=tip, link_label="", link_url=None, config=config
        ) == [], tip


def test_bos_config_cokmez():
    for tip in ("HERO_CAROUSEL", "IMAGE_CARD_GRID", "BANNER"):
        assert isinstance(
            block_link_warnings(
                block_type=tip, link_label="", link_url=None, config={}
            ),
            list,
        )
