"""Cinsiyet filtresi — SESSİZ ELEME sözleşmesi + KVKK eksikleri.

## Neden bu dosya var

`gender` bugün üretimde **sert bir WHERE filtresi** olarak çalışıyor
(`services/search_service.py::_apply_tutor_filters`) ve üç listeleme yolunun
üçüne birden giriyor (arama, öne çıkanlar, fiyat histogramı). Ama davranışı
çıpalayan **tek bir test yoktu**.

Çıpasız bıraktığı asıl şey şu: kolon NULL'a izin verir ve enum'da ayrıca
`UNSPECIFIED` vardır. `Tutor.gender == FEMALE` karşılaştırması ikisini de
eler. Yani öğrenci "Kadın" filtrelediğinde cinsiyetini **belirtmemiş** her
eğitmen sonuçtan sessizce düşer ve öğrenci bunu göremez.

Bu davranışın kendisi savunulabilir; SESSİZ olması savunulamaz. Ürün tarafı
(faset sayıları + "X eğitmen belirtmedi" satırı) bu sözleşmenin üstüne
kurulacak, o yüzden önce sözleşme yazılıyor.

## `NULL` ile `UNSPECIFIED` eşanlamlı DEĞİLDİR

    NULL         = hiç sorulmadı
    UNSPECIFIED  = soruldu, söylemek istemedi

İkisi de filtreden düşer ama ayrımın kendisi bilgidir: "tekrar sormak meşru
mu" sorusunun cevabı buradadır. Bu yüzden birleştirilmez.

## Kırmızı doğan düğümler (üretim kodundan ÖNCE yazıldı)

- `test_anonimlestirme_cinsiyeti_temizler` — `anonymize_account` alan
  listesinde `birth_date` var, `gender` YOK. Silinen hesabın cinsiyeti kalır.
- `test_veri_dokumu_cinsiyeti_verir` — `export_personal_data` `cinsiyet`
  anahtarı üretmez; oysa aydınlatma metni (`legalContent.ts`) cinsiyeti
  işlenen veri sayar. Yasal metin bugün kodun tutmadığı bir söz veriyor.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from core.database import AsyncSessionLocal
from models.tutor import Gender, Tutor, TutorStatus
from services import account_deletion_service, search_service
from tests.integration.ip3_factory import PAROLA, yetki_basligi
from tests.integration.conftest import _uniq


async def _egitmen(cinsiyet: Gender | None, ucret: str, ilce: str = "CinsiyetIlce") -> Tutor:
    """Onaylı, ücretli, aranabilir bir eğitmen. Tek değişken: cinsiyet."""
    from core.security import hash_password_async
    from models.role import ROLE_IDS, RoleType

    u = _uniq()
    async with AsyncSessionLocal() as s:
        t = Tutor(
            email=f"cins-{u}@cinsiyettest.example.com",
            hashed_password=await hash_password_async(PAROLA),
            first_name="Cinsiyet",
            last_name=f"Test{u[:4]}",
            role_id=ROLE_IDS[RoleType.TUTOR],
            status=TutorStatus.APPROVED,
            hourly_rate=Decimal(ucret),
            gender=cinsiyet,
            district=ilce,
        )
        s.add(t)
        await s.commit()
        await s.refresh(t)
        s.expunge(t)
    return t


@pytest.fixture
async def dortlu(pg):
    """Dört eğitmen, dört ayrı cinsiyet durumu.

    `UNSPECIFIED` ve `NULL` AYRI satırlardır: testin asıl konusu ikisinin de
    elenmesi ve bunun bilinçli olması.
    """
    # Benzersiz ilçe: faset sayıları YALNIZ bu dört satırı ölçsün. Global
    # sayımla çalışılsaydı aynı DB'deki başka tohumlar sayıya karışırdı.
    ilce = f"CinsiyetIlce{_uniq()[:6]}"
    return {
        "ilce": ilce,
        "kadin": await _egitmen(Gender.FEMALE, "401", ilce),
        "erkek": await _egitmen(Gender.MALE, "402", ilce),
        "belirtmedi": await _egitmen(Gender.UNSPECIFIED, "403", ilce),
        "hic_sorulmadi": await _egitmen(None, "404", ilce),
    }


async def _kimlikler(cinsiyet: Gender | None, dortlu) -> set[int]:
    """Aramanın döndürdüğü, YALNIZ bu testin tohumladığı eğitmen kimlikleri."""
    bizimkiler = {t.id for k, t in dortlu.items() if k != 'ilce'}
    async with AsyncSessionLocal() as db:
        sonuc = await search_service.search_tutors(db, gender=cinsiyet, limit=200)
    return {r.id for r in sonuc} & bizimkiler


@pytest.mark.asyncio
async def test_fikstur_gercekten_dort_satir_uretti(dortlu):
    """DOLULUK KAPISI — bu olmadan aşağıdaki tüm eleme iddiaları bedava geçer.

    Fikstür sessizce boş dönseydi "filtre doğru eliyor" testleri de yeşil
    kalırdı: eleme iddiaları BOŞ kümede her zaman doğrudur.
    """
    assert len(dortlu) == 5  # dört eğitmen + ilçe adı
    assert len({t.id for k, t in dortlu.items() if k != 'ilce'}) == 4
    async with AsyncSessionLocal() as db:
        hepsi = await search_service.search_tutors(db, limit=200)
    bulunan = {t.id for k, t in dortlu.items() if k != 'ilce'} & {r.id for r in hepsi}
    assert len(bulunan) == 4, (
        "Filtresiz arama dördünü de görmeli; görmüyorsa aşağıdaki eleme "
        f"iddiaları anlamsız. Bulunan: {len(bulunan)}"
    )
    async with AsyncSessionLocal() as s:
        satir = await s.get(Tutor, dortlu["hic_sorulmadi"].id)
        assert satir.gender is None, "NULL satır gerçekten NULL olmalı"
        satir2 = await s.get(Tutor, dortlu["belirtmedi"].id)
        assert satir2.gender is Gender.UNSPECIFIED


@pytest.mark.asyncio
async def test_kadin_filtresi_yalniz_kadini_dondurur(dortlu):
    assert await _kimlikler(Gender.FEMALE, dortlu) == {dortlu["kadin"].id}


@pytest.mark.asyncio
async def test_UNSPECIFIED_ve_NULL_IKISI_DE_elenir(dortlu):
    """Sözleşmenin can alıcı düğümü.

    Ürün tarafının açıklamak ZORUNDA olduğu davranış budur: cinsiyetini
    belirtmemiş eğitmen, hangi cinsiyet seçilirse seçilsin sonuçtan düşer.
    """
    for cinsiyet in (Gender.FEMALE, Gender.MALE):
        bulunan = await _kimlikler(cinsiyet, dortlu)
        assert dortlu["belirtmedi"].id not in bulunan, (
            "UNSPECIFIED eğitmen elendi mi diye bakılıyor; elenmiyorsa "
            "arayüzdeki 'belirtmeyenler görünmüyor' uyarısı YALAN olur"
        )
        assert dortlu["hic_sorulmadi"].id not in bulunan, (
            "NULL eğitmen elendi mi diye bakılıyor"
        )


@pytest.mark.asyncio
async def test_uc_listeleme_yolu_AYNI_kumeyi_eler(dortlu):
    """Bu depodaki bilinen hata sınıfı: üç yol ayrışır.

    `search_service.py` fiyat histogramı için bunu isimle yazıyor — histogram
    listedeki eğitmenlere ait olmayan bir dağılım gösterirse kullanıcı yanlış
    fiyat aralığı seçer. Aynı risk cinsiyet için de geçerli.
    """
    bizimkiler = {t.id for k, t in dortlu.items() if k != 'ilce'}
    async with AsyncSessionLocal() as db:
        arama = await search_service.search_tutors(db, gender=Gender.FEMALE, limit=200)
        one_cikan = await search_service.featured_tutors(db, gender=Gender.FEMALE)
        ucretler = await search_service.price_histogram(db, gender=Gender.FEMALE)

    assert {r.id for r in arama} & bizimkiler == {dortlu["kadin"].id}
    assert dortlu["erkek"].id not in {r.id for r in one_cikan}
    assert dortlu["belirtmedi"].id not in {r.id for r in one_cikan}
    # Histogram KİMLİK değil ÜCRET döndürür ve başka eğitmenler de aynı ücrete
    # sahip olabilir; bu yüzden "elenenin ücreti yok" diye bir iddia yazılamaz —
    # yazılsaydı ya kırılgan olurdu ya da (`... or True` gibi) ÖLÜ bir iddia.
    # Sınanabilir olan tek şey: aramanın döndürdüğü eğitmenin ücreti histogramda
    # VARDIR. Ayrışma bu yönde yakalanır.
    assert float(dortlu["kadin"].hourly_rate) in ucretler, (
        "histogram, aramanın döndürdüğü eğitmenin ücretini İÇERMELİ — "
        "içermiyorsa iki yol ayrışmış demektir"
    )


@pytest.mark.asyncio
async def test_anonimlestirme_cinsiyeti_temizler(dortlu):
    """KIRMIZI DOĞAR — `anonymize_account` alan listesinde `gender` yok.

    `birth_date` temizleniyor ama `gender` kalıyor. İkisi de aynı cümlede
    ("kimlik bilgileri") işlenen demografik veridir; birini silip diğerini
    bırakmak bilinçli bir ayrım değil, unutulmuş bir kalem.
    """
    egitmen = dortlu["kadin"]
    async with AsyncSessionLocal() as db:
        satir = await db.get(Tutor, egitmen.id)
        # DOLULUK: silmeden ÖNCE gerçekten dolu olduğu iddia edilir; yoksa
        # boş bir fikstürde "silindi" iddiası bedava geçerdi.
        assert satir.gender is Gender.FEMALE
        await account_deletion_service.anonymize_account(db, satir)
        await db.commit()
        await db.refresh(satir)
        assert satir.gender is None, (
            "silinen hesabın cinsiyeti kaldı — doğum tarihi siliniyor ama "
            "cinsiyet silinmiyor"
        )


@pytest.mark.asyncio
async def test_veri_dokumu_cinsiyeti_verir(dortlu):
    """KIRMIZI DOĞAR — dökümde `cinsiyet` anahtarı yok.

    Aydınlatma metni cinsiyeti işlenen veri sayıyor; veri sahibi "hakkımda ne
    tutuyorsunuz" diye sorduğunda cevapta görünmüyor. Yasal metin ile kodun
    çeliştiği yer burasıdır.
    """
    egitmen = dortlu["erkek"]
    async with AsyncSessionLocal() as db:
        satir = await db.get(Tutor, egitmen.id)
        dokum = await account_deletion_service.export_personal_data(db, satir)

    hesap = dokum["hesap"]
    # DOLULUK: dökümün gerçekten bu kişiye ait olduğu çıpalanır.
    assert hesap["id"] == egitmen.id
    assert hesap["dogum_tarihi"] is None or isinstance(hesap["dogum_tarihi"], str)
    assert "cinsiyet" in hesap, "dökümde `cinsiyet` anahtarı yok"
    assert hesap["cinsiyet"] == Gender.MALE.value, (
        "anahtar var ama tohumlanan değeri taşımıyor — yalnız anahtar "
        "varlığını sınamak boş bir iddiadır"
    )


@pytest.mark.asyncio
async def test_sihirbaz_cinsiyeti_ILANIN_ucuna_yazabilir(ip3, http):
    """`PATCH /tutors/me` cinsiyeti kabul eder ve kalıcı yazar.

    Karar: cinsiyet İLANIN alanıdır, hesabın değil — `Tutor` satırında durur
    ve aramanın sert filtresidir. Avatar için verilen TERS karar ("hesabın
    alanı, ilanın değil") bilinçli olarak simetriktir. Bu yüzden sihirbaz
    `PATCH /users/me` yerine buraya yazar: ikinci bir mutasyon ve ayrı bir
    hata yolu açmaya gerek kalmaz.
    """
    from models.tutor import TutorStatus

    egitmen = await ip3.tutor(status=TutorStatus.DRAFT)
    basliklar = yetki_basligi(egitmen)

    # DOLULUK: başlangıçta boş olduğu çıpalanır, yoksa "yazıldı" iddiası
    # zaten dolu bir satırda bedava geçerdi.
    async with AsyncSessionLocal() as s:
        assert (await s.get(Tutor, egitmen.id)).gender is None

    r = await http.patch(
        "/api/v1/tutors/me", headers=basliklar, json={"gender": Gender.FEMALE.value}
    )
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as s:
        assert (await s.get(Tutor, egitmen.id)).gender is Gender.FEMALE


@pytest.mark.asyncio
async def test_gecersiz_cinsiyet_422(ip3, http):
    """Uydurma bir değer şemadan geçemez."""
    from models.tutor import TutorStatus

    egitmen = await ip3.tutor(status=TutorStatus.DRAFT)
    r = await http.patch(
        "/api/v1/tutors/me",
        headers=yetki_basligi(egitmen),
        json={"gender": "KADIN"},
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_faset_sayilari_SESSIZ_ELEMEYI_gorunur_kilar(dortlu):
    """Bu uç noktanın var oluş sebebi: kaç eğitmenin sessizce elendiğini söylemek."""
    async with AsyncSessionLocal() as db:
        f = await search_service.gender_facets(db, districts=[dortlu["ilce"]])

    assert f[Gender.FEMALE.value] == 1
    assert f[Gender.MALE.value] == 1
    assert f[Gender.UNSPECIFIED.value] == 1
    assert f["belirtilmemis"] == 1, "NULL satır ayrı sayılmalı"
    # Kullanıcıya sunulan tek sayı: cinsiyet filtresi seçilince kaybolanlar.
    assert f["gorunmeyen"] == 2, (
        "UNSPECIFIED + NULL birlikte 'görünmeyen'dir — arayüzdeki "
        "'X eğitmen bu filtreyle görünmüyor' satırının kaynağı"
    )


@pytest.mark.asyncio
async def test_faset_KENDI_eksenini_saymaz(dortlu):
    """`price_histogram`in fiyat filtresini atlamasıyla AYNI desen.

    Faset kendi filtresini uygulasaydı, kullanıcı "Kadın"ı seçtiği anda
    "Erkek 0" görünürdü ve sayılar seçim yapmayı imkânsız kılardı.
    """
    import inspect

    imza = inspect.signature(search_service.gender_facets)
    assert "gender" not in imza.parameters, (
        "faset kendi eksenini parametre olarak ALMAMALI"
    )
    # Davranış kanıtı: aynı çağrı, hangi cinsiyet seçili olursa olsun aynı
    # sayıları verir — çünkü seçim zaten buraya geçmez.
    async with AsyncSessionLocal() as db:
        a = await search_service.gender_facets(db, districts=[dortlu["ilce"]])
        b = await search_service.gender_facets(db, districts=[dortlu["ilce"]])
    assert a == b
    assert sum(a[g.value] for g in Gender) + a["belirtilmemis"] == 4


@pytest.mark.asyncio
async def test_faset_ucu_SATIR_DEGIL_SAYI_dondurur(dortlu, http):
    """Demografik toplam sızar ama kimlik sızmaz — bilinçli kabul edilen sınır."""
    r = await http.get(f"/api/v1/tutors/gender-facets?district={dortlu['ilce']}")
    assert r.status_code == 200, r.text
    govde = r.json()
    assert all(isinstance(v, int) for v in govde.values())
    assert govde["gorunmeyen"] == 2
    # Hiçbir kimlik, e-posta ya da ad dönmemeli.
    ham = r.text
    for gizli in ("@cinsiyettest.example.com", "Cinsiyet Test"):
        assert gizli not in ham
