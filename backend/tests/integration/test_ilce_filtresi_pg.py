"""İlçe filtresi — TÜRKÇE KATLAMALI eşleşme sözleşmesi.

## Neden bu dosya var (8 Eyl 2026, ölçümle)

Eğitmen ilçe filtresi bugüne kadar birebir eşitlikti:

    stmt.where(Tutor.district.in_(districts))

Bunun iki ayrı sonucu vardı ve ikisi de SESSİZDİ — hata değil, boş liste:

1. Türkçe klavyesi olmayan ya da acele yazan kullanıcının "Cukurova"sı
   veritabanındaki "Çukurova" ile eşleşmiyordu.
2. Büyük harfli ya da farklı yazılmış her değer ("SEYHAN", "seyhan") aynı
   şekilde düşüyordu.

Kütüphane tarafı bu sorunu `normalized()` ile çoktan çözmüştü
(`library_service`); eğitmen tarafı geride kalmıştı. İki arama yüzeyi aynı
kutuya aynı değeri yazan kullanıcıya farklı cevap veriyordu.

Ayrıca ölçülen daha büyük arıza: yerel veritabanındaki 7 eğitmenin 7'sinde de
`district` kolonu BOŞTU — ilçe bilgisi serbest metin `location_text` alanında
duruyordu ("Adana, Seyhan"). Yani filtre hangi ilçe için sorulursa sorulsun 0
sonuç veriyordu. O kısım `scripts/ilce_backfill.py` ile onarıldı; bu dosya
filtrenin KENDİSİNİ çıpalar.

## Bu testin ASIL iddiası

Normalizasyonun iki tarafı da aynı fonksiyondan geçmeli. Sorgu tarafı
`normalize_tr` (Python), kolon tarafı `tr_normalize` (SQL) kullanır. İkisi
ayrışırsa arama sessizce boşalır — kaynak dosyanın kendi uyarısı bu
(`core/search_text.py`). Burada ikisinin AYNI sonucu verdiği gerçek PostgreSQL
üzerinde sınanır; Python'da taklit edilemez, çünkü katlama SQL'de yapılıyor.

## Gücü ve sınırı (kök CLAUDE.md §C)

Gerçek PostgreSQL + gerçek `search_service`. Filtrenin döndürdüğü kümeyi
yalnız bu testin tohumladığı satırlarla kesiştirir — aynı veritabanındaki
başka tohumlar sayıya karışmasın diye ilçe adı her koşuda benzersizdir.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from core.database import AsyncSessionLocal
from models.tutor import Tutor, TutorStatus
from services import search_service
from tests.integration.conftest import _uniq
from tests.integration.ip3_factory import PAROLA


async def _egitmen(
    ilce: str | None,
    lat: float | None = None,
    lng: float | None = None,
) -> Tutor:
    """Onaylı, aranabilir bir eğitmen. Değişkenler: ilçe ve harita pini."""
    from core.security import hash_password_async
    from models.role import ROLE_IDS, RoleType

    u = _uniq()
    async with AsyncSessionLocal() as s:
        t = Tutor(
            email=f"ilce-{u}@ilcetest.example.com",
            hashed_password=await hash_password_async(PAROLA),
            first_name="Ilce",
            last_name=f"Test{u[:4]}",
            role_id=ROLE_IDS[RoleType.TUTOR],
            status=TutorStatus.APPROVED,
            hourly_rate=Decimal("500"),
            district=ilce,
            location_lat=lat,
            location_lng=lng,
        )
        s.add(t)
        await s.commit()
        await s.refresh(t)
        s.expunge(t)
    return t


@pytest.fixture
async def ikili(pg):
    """İki eğitmen, iki AYRI ilçe.

    İkincisi bir "ters prova" ortağıdır: filtrenin gerçekten filtrelediğini
    ancak dışarıda kalması gereken bir satır varsa gösterebiliriz. Tek satırla
    çalışılsaydı "hepsini döndüren" bozuk bir filtre de yeşil geçerdi.
    """
    ek = _uniq()[:6]
    # Aksanlı harf BİLEREK: normalizasyonun sınandığı yer tam olarak burası.
    hedef, diger = f"Çukurova{ek}", f"Seyhan{ek}"
    return {
        "hedef_ilce": hedef,
        "diger_ilce": diger,
        "hedef": await _egitmen(hedef),
        "diger": await _egitmen(diger),
    }


async def _bulunanlar(ilceler: list[str], ikili) -> set[int]:
    """Sorgunun döndürdüğü, YALNIZ bu testin tohumladığı kimlikler."""
    bizimkiler = {ikili["hedef"].id, ikili["diger"].id}
    async with AsyncSessionLocal() as db:
        sonuc = await search_service.search_tutors(db, districts=ilceler, limit=200)
    return {r.id for r in sonuc} & bizimkiler


@pytest.mark.asyncio
async def test_fikstur_gercekten_iki_satir_uretti(ikili):
    """DOLULUK KAPISI — bu olmadan aşağıdaki eşleşme iddiaları bedava geçer.

    Fikstür sessizce boş dönseydi "aksansız da bulur" testi de yeşil kalırdı:
    boş kümede kesişim iddiaları anlamsızdır.
    """
    assert ikili["hedef"].id != ikili["diger"].id
    async with AsyncSessionLocal() as db:
        hepsi = await search_service.search_tutors(db, limit=200)
    kimlikler = {r.id for r in hepsi}
    assert ikili["hedef"].id in kimlikler, "hedef öğretmen aramada hiç görünmüyor"
    assert ikili["diger"].id in kimlikler, "diğer öğretmen aramada hiç görünmüyor"


@pytest.mark.asyncio
async def test_birebir_yazim_bulur(ikili):
    """Temel durum: kolonda ne yazıyorsa o sorulduğunda bulunur."""
    assert await _bulunanlar([ikili["hedef_ilce"]], ikili) == {ikili["hedef"].id}


@pytest.mark.asyncio
async def test_aksansiz_yazim_da_bulur(ikili):
    """"Cukurova" yazan kullanıcı "Çukurova"yı bulmalı.

    Eski birebir eşitlikle bu sorgu BOŞ dönüyordu. Türkçe klavyesi olmayan
    kullanıcı için filtre fiilen çalışmıyordu.
    """
    aksansiz = ikili["hedef_ilce"].replace("Ç", "C").replace("ç", "c")
    assert aksansiz != ikili["hedef_ilce"], "test kendi girdisini bozmuş"
    assert await _bulunanlar([aksansiz], ikili) == {ikili["hedef"].id}


@pytest.mark.asyncio
async def test_buyuk_harf_de_bulur(ikili):
    """Büyük harfle gelen değer de eşleşmeli."""
    assert await _bulunanlar([ikili["hedef_ilce"].upper()], ikili) == {
        ikili["hedef"].id
    }


@pytest.mark.asyncio
async def test_baska_ilce_ESLESMEZ(ikili):
    """TERS PROVA — filtre gerçekten eliyor mu?

    Yukarıdaki üç test, "her şeyi döndüren" bozuk bir filtreyle de yeşil
    geçerdi. Bu test o kaçışı kapatır.
    """
    bulunan = await _bulunanlar([ikili["hedef_ilce"]], ikili)
    assert ikili["diger"].id not in bulunan


@pytest.mark.asyncio
async def test_bos_deger_filtreyi_bozmaz(ikili):
    """Boş/whitespace ilçe elenmeli, geri kalan filtre çalışmaya devam etmeli.

    Boş dize normalize edilip listeye girseydi hiçbir kayda eşleşmez ve
    yanındaki geçerli ilçeyi de götürmezdi ama `IN ('')` gereksiz iş olurdu;
    asıl risk listenin TAMAMEN boşalıp filtrenin sessizce kalkmasıdır — o
    durumda `diger` de sonuca girerdi.
    """
    assert await _bulunanlar(["", "   ", ikili["hedef_ilce"]], ikili) == {
        ikili["hedef"].id
    }


@pytest.mark.asyncio
async def test_yalniz_bos_deger_verilirse_filtre_uygulanmaz(ikili):
    """Hepsi boşsa ilçe filtresi hiç kurulmaz — iki eğitmen de görünür.

    Alternatif (boş listeyle `IN ()` kurmak) her şeyi eler ve kullanıcıya
    sebepsiz boş liste gösterirdi.
    """
    assert await _bulunanlar(["", "  "], ikili) == {
        ikili["hedef"].id,
        ikili["diger"].id,
    }


# ── Yumuşak yarıçap: mahalle araması pinsiz eğitmeni ELEMEZ ───────────────
#
# İlan sihirbazı ilçeyi ZORUNLU, harita pinini OPSİYONEL tutuyor
# (`frontend/src/pages/tutorOnboarding/sozlesme.ts` — `dogrula` yalnız
# `district`e bakar). "İlçesini seçmiş ama pin koymamış" eğitmen normal bir
# durumdur; ölçüldüğünde dev veritabanında henüz yoktu ama sözleşme gereği
# kaçınılmazdır.
#
# Sert yarıçap onları sessizce elerdi: kullanıcı Reşatbey'i seçer, Seyhan'daki
# pinsiz eğitmen listeden düşer ve bunu kimse göremez. Kullanıcının sorduğu
# "eşleştirme oranını düşürür mü" sorusunun somut karşılığı tam olarak budur.


ADANA_LAT, ADANA_LNG = 36.9855, 35.3253


@pytest.fixture
async def pinli_ve_pinsiz(pg):
    """Aynı ilçede iki eğitmen: biri haritada işaretli, diğeri değil."""
    ilce = f"YaricapIlce{_uniq()[:6]}"
    return {
        "ilce": ilce,
        "pinli": await _egitmen(ilce, ADANA_LAT, ADANA_LNG),
        "pinsiz": await _egitmen(ilce),
    }


async def _yaricapla(veri, *, ilceyle: bool) -> set[int]:
    bizimkiler = {veri["pinli"].id, veri["pinsiz"].id}
    async with AsyncSessionLocal() as db:
        sonuc = await search_service.search_tutors(
            db,
            districts=[veri["ilce"]] if ilceyle else None,
            lat=ADANA_LAT,
            lng=ADANA_LNG,
            radius_km=3,
            limit=200,
        )
    return {r.id for r in sonuc} & bizimkiler


@pytest.mark.asyncio
async def test_fikstur_pinli_ve_pinsiz_gercekten_var(pinli_ve_pinsiz):
    """DOLULUK KAPISI — iki satır da aramada görünüyor mu?"""
    async with AsyncSessionLocal() as db:
        hepsi = await search_service.search_tutors(
            db, districts=[pinli_ve_pinsiz["ilce"]], limit=200
        )
    assert {r.id for r in hepsi} == {
        pinli_ve_pinsiz["pinli"].id,
        pinli_ve_pinsiz["pinsiz"].id,
    }


@pytest.mark.asyncio
async def test_mahalle_aramasi_pinsiz_egitmeni_ELEMEZ(pinli_ve_pinsiz):
    """İlçe + yarıçap birlikteyken pinsiz eğitmen listede KALIR."""
    assert await _yaricapla(pinli_ve_pinsiz, ilceyle=True) == {
        pinli_ve_pinsiz["pinli"].id,
        pinli_ve_pinsiz["pinsiz"].id,
    }


@pytest.mark.asyncio
async def test_yakinimdakiler_pinsiz_egitmeni_ELER(pinli_ve_pinsiz):
    """TERS PROVA — yumuşama YALNIZ ilçeyle birlikte geçerli.

    "Yakınımdakiler" kullanıcının kendi konumuna göre arar ve mesafe
    sıralamanın kendisidir; konumu olmayan eğitmenin orada karşılığı yok.
    Bu test olmasaydı "her koşulda pinsizleri dahil et" gibi bozuk bir
    gevşetme de yeşil geçerdi.
    """
    assert await _yaricapla(pinli_ve_pinsiz, ilceyle=False) == {
        pinli_ve_pinsiz["pinli"].id
    }
