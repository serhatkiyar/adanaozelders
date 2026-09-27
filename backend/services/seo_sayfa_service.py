"""Kök SEO sayfaları (Modül 6) — adres çözümü ve sayfa içeriği.

Üç sayfa türü (adres kuralları `core/seo_adres.py`):

    /<ilan-slug>                   ilan (eğitmen profili)
    /<ders>-ozel-ders              ders sayfası
    /<ilce>/<ders>-ozel-ders       ilçe + ders sayfası

## Tek kaynak

Başlık, açıklama, sayılar, SSS ve yapısal veri BURADA üretilir. Hem ön-çizim
(`services/on_cizim.py`, herkese giden sunucu HTML'i) hem React sayfası
(`GET /seo/sayfa`) aynı çıktıyı kullanır — kullanıcıya ve arama motoruna giden
içerik iki yerde yazılıp ayrışamaz (cloaking yok).

## Açılma koşulu

Ders ve ilçe sayfası yalnız EN AZ BİR yayındaki eğitmen varsa açılır; yoksa
None (→ 404). Boş sayfa üretilmez. Eşleşme aramayla aynı kuraldır:
`subject_service.resolve_filter_terms` dersin adını, eşanlamlılarını ve alt
derslerini eğitmenin serbest metin branşıyla `tr_normalize` üzerinden
karşılaştırır. Aşağıdaki dizin o kuralın toplu (tek geçişte) hâlidir; kartlar
doğrudan `search_service.search_tutors` ile çekilir, yani sayfadaki liste
"tüm öğretmenleri gör" ile açılan arama sonucuyla aynı sıradadır.
"""
from __future__ import annotations

import datetime
import re
from dataclasses import dataclass, field
from urllib.parse import urlencode

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import seo_adres, storage
from core.config import settings
from core.search_text import normalize_tr, normalized
from models.seo_slug import SeoSlug
from models.subject import Subject, SubjectAlias
from models.tutor import Tutor, TutorSubject
from schemas.seo import (
    DersIstatistik,
    DersSayfasiOut,
    IlanSayfasiOut,
    PopulerDersOut,
    SeoBaglanti,
    SeoSss,
    YonlendirmeOut,
)
from services import search_service, seo_slug_service, subject_service

SITE_ADI = "Adana Özel Ders"

#: Kart listesinin üst sınırı; fazlası "tüm öğretmenleri gör" aramasında.
KART_SINIRI = 24

#: İlgili ders / ilçe bağlantısı üst sınırı.
BAGLANTI_SINIRI = 8

#: Bulunma hâli ("-de"): ünlü uyumu ve ünsüz sertleşmesi yer adına özgü
#: olduğundan kurala değil sözlüğe bağlandı (Karataş'ta, İmamoğlu'nda).
_BULUNMA = {
    "Adana": "Adana'da",
    "Seyhan": "Seyhan'da",
    "Çukurova": "Çukurova'da",
    "Yüreğir": "Yüreğir'de",
    "Sarıçam": "Sarıçam'da",
    "Ceyhan": "Ceyhan'da",
    "Kozan": "Kozan'da",
    "Karaisalı": "Karaisalı'da",
    "Karataş": "Karataş'ta",
    "Yumurtalık": "Yumurtalık'ta",
    "İmamoğlu": "İmamoğlu'nda",
    "Pozantı": "Pozantı'da",
    "Aladağ": "Aladağ'da",
    "Feke": "Feke'de",
    "Saimbeyli": "Saimbeyli'de",
    "Tufanbeyli": "Tufanbeyli'de",
}

_MOD_ETIKETI = {
    "IN_PERSON": "yüz yüze",
    "ONLINE": "online",
    "BOTH": "yüz yüze ve online",
}

_SONDAKI_ID = re.compile(r"(?:^|-)(\d+)$")


def bulunma(yer: str) -> str:
    return _BULUNMA.get(yer, f"{yer}'da")


def tl(tutar: float | int) -> str:
    """1250 → "1.250 TL" — sitenin para biçimi (`frontend/src/lib/money.ts`:
    ₺ sembolü değil "TL" soneki)."""
    return f"{int(round(tutar)):,} TL".replace(",", ".")


def kirp(metin: str, sinir: int = 160) -> str:
    """Meta açıklama kırpması — `frontend/src/lib/seo.ts::clampDescription` ile
    BİREBİR (ön-çizilmiş ve React'in kurduğu açıklama aynı kalsın)."""
    temiz = " ".join(metin.split())
    return temiz if len(temiz) <= sinir else temiz[: sinir - 1].rstrip() + "…"


def mutlak(yol: str) -> str:
    return settings.FRONTEND_BASE_URL.rstrip("/") + yol


def ders_yolu(ders_slug: str, ilce_slug: str | None = None) -> str:
    sayfa = seo_adres.ders_sayfasi_slugu(ders_slug)
    return f"/{ilce_slug}/{sayfa}" if ilce_slug else f"/{sayfa}"


def arama_yolu(ders_slug: str, ilce: str | None = None) -> str:
    """Aynı süzgeçle açılan arama sayfası (`lib/aramaUrl.ts` anahtarları)."""
    parametre = [("ders", ders_slug)]
    if ilce:
        parametre.append(("ilce", ilce))
    return "/egitmenler?" + urlencode(parametre)


# ── Dizin: yayındaki eğitmen × ders eşleşmesi, tek geçişte ────────────────


@dataclass
class _Egitmen:
    id: int
    ilce: str | None
    ucret: float | None
    mod: str | None
    ilk_ucretsiz: bool
    yorum_sayisi: int
    puan_toplami: int
    metinler: set[str] = field(default_factory=set)


@dataclass
class _Ders:
    id: int
    slug: str
    ad: str
    grup: str
    sira: int
    parent_id: int | None
    aktif: bool
    terimler: set[str] = field(default_factory=set)
    #: `seo_slugs`'ta güncel ders adresi var mı. Yoksa adres çözülemez; liste
    #: yüzeyleri (sitemap, iç linkler) 404'e işaret etmesin diye dışarıda kalır.
    adresli: bool = False


@dataclass
class Dizin:
    dersler: dict[int, _Ders]
    egitmenler: list[_Egitmen]

    def eslesenler(self, ders: _Ders, ilce: str | None = None) -> list[_Egitmen]:
        return [
            e
            for e in self.egitmenler
            if e.metinler & ders.terimler and (ilce is None or e.ilce == ilce)
        ]

    def acik_dersler(self) -> list[_Ders]:
        """Sayfası açılabilen dersler: vitrindeki (aktif) ve arkasında arz olan."""
        return [
            d
            for d in self.dersler.values()
            if d.aktif and d.adresli and self.eslesenler(d)
        ]


async def dizin_kur(db: AsyncSession) -> Dizin:
    """Beş sorguyla bütün eşleşme dizinini kurar (N+1 yok)."""
    dersler: dict[int, _Ders] = {}
    ad_norm: dict[int, str] = {}
    for sid, slug, ad, ad_n, parent, grup, aktif, sira in (
        await db.execute(
            select(
                Subject.id,
                Subject.slug,
                Subject.name,
                normalized(Subject.name),
                Subject.parent_id,
                Subject.group_code,
                Subject.is_active,
                Subject.sort_order,
            ).where(Subject.deleted_at.is_(None))
        )
    ).all():
        dersler[sid] = _Ders(sid, slug, ad, grup, sira, parent, bool(aktif))
        ad_norm[sid] = ad_n

    for sid, slug in (
        await db.execute(
            select(SeoSlug.subject_id, SeoSlug.slug).where(
                SeoSlug.kind == "ders", SeoSlug.is_current.is_(True)
            )
        )
    ).all():
        d = dersler.get(sid)
        if d is not None and slug == seo_adres.ders_sayfasi_slugu(d.slug):
            d.adresli = True

    esanlam: dict[int, set[str]] = {}
    for sid, n in (
        await db.execute(select(SubjectAlias.subject_id, SubjectAlias.normalized))
    ).all():
        esanlam.setdefault(sid, set()).add(n)

    cocuklar: dict[int, list[int]] = {}
    for d in dersler.values():
        if d.parent_id is not None:
            cocuklar.setdefault(d.parent_id, []).append(d.id)

    # `resolve_filter_terms([slug])` ile aynı küme: slug + ad + eşanlamlılar,
    # alt derslerin ad ve eşanlamlıları dahil.
    for d in dersler.values():
        terimler = {normalize_tr(d.slug)}
        for sid in (d.id, *cocuklar.get(d.id, ())):
            terimler.add(ad_norm[sid])
            terimler |= esanlam.get(sid, set())
        d.terimler = {t for t in terimler if t}

    egitmenler: dict[int, _Egitmen] = {}
    for tid, ilce, ucret, mod, ilk, yc, yt in (
        await db.execute(
            select(
                Tutor.id,
                Tutor.district,
                Tutor.hourly_rate,
                Tutor.teaching_mode,
                Tutor.first_lesson_free,
                Tutor.rating_count,
                Tutor.rating_sum,
            ).where(*seo_slug_service.yayinda_kosulu())
        )
    ).all():
        egitmenler[tid] = _Egitmen(
            tid,
            seo_adres.ilce_adi(ilce),
            float(ucret) if ucret is not None else None,
            mod,
            bool(ilk),
            yc or 0,
            yt or 0,
        )
    for tid, metin in (
        await db.execute(
            select(TutorSubject.tutor_id, normalized(TutorSubject.subject))
            .join(Tutor, Tutor.id == TutorSubject.tutor_id)
            .where(*seo_slug_service.yayinda_kosulu())
        )
    ).all():
        if tid in egitmenler and metin:
            egitmenler[tid].metinler.add(metin)
    return Dizin(dersler, list(egitmenler.values()))


# ── Saf metin üreticileri (pytest'li) ─────────────────────────────────────


def istatistik(egitmenler: list[_Egitmen]) -> DersIstatistik:
    ucretler = [e.ucret for e in egitmenler if e.ucret is not None]
    yorum = sum(e.yorum_sayisi for e in egitmenler)
    puan = sum(e.puan_toplami for e in egitmenler)
    return DersIstatistik(
        egitmen_sayisi=len(egitmenler),
        ucretli_sayisi=len(ucretler),
        en_dusuk_ucret=int(round(min(ucretler))) if ucretler else None,
        en_yuksek_ucret=int(round(max(ucretler))) if ucretler else None,
        ortalama_ucret=int(round(sum(ucretler) / len(ucretler))) if ucretler else None,
        yuz_yuze_sayisi=sum(1 for e in egitmenler if e.mod in ("IN_PERSON", "BOTH")),
        online_sayisi=sum(1 for e in egitmenler if e.mod in ("ONLINE", "BOTH")),
        ilk_ders_ucretsiz_sayisi=sum(1 for e in egitmenler if e.ilk_ucretsiz),
        yorum_sayisi=yorum,
        ortalama_puan=round(puan / yorum, 1) if yorum else None,
    )


def ders_basligi(ders: str, n: int, ilce: str | None = None) -> str:
    """Aranan kelime ÖNDE: "Adana Matematik Özel Ders – 12 Öğretmen | Adana Özel Ders"."""
    yer = ilce or "Adana"
    return f"{yer} {ders} Özel Ders – {n} Öğretmen | {SITE_ADI}"


def ders_h1(ders: str, ilce: str | None = None) -> str:
    return f"{ilce or 'Adana'} {ders} Özel Ders"


def ders_ozeti(ders: str, ist: DersIstatistik, ilce: str | None = None) -> str:
    """Sayfa özeti — YALNIZ gerçek sayılardan (uydurma iddia yok)."""
    yer = bulunma(ilce or "Adana")
    parca = [f"{yer} {ist.egitmen_sayisi} {ders} öğretmeni."]
    if ist.en_dusuk_ucret is not None and ist.ortalama_ucret is not None:
        if ist.en_dusuk_ucret == ist.en_yuksek_ucret:
            parca.append(f"Saatlik ücret {tl(ist.en_dusuk_ucret)}.")
        else:
            parca.append(
                f"Saatlik ücretler {tl(ist.en_dusuk_ucret)} – "
                f"{tl(ist.en_yuksek_ucret or 0)}, ortalama {tl(ist.ortalama_ucret)}."
            )
    mod = []
    if ist.yuz_yuze_sayisi:
        mod.append(f"{ist.yuz_yuze_sayisi} yüz yüze")
    if ist.online_sayisi:
        mod.append(f"{ist.online_sayisi} online")
    if mod:
        parca.append(" · ".join(mod) + ".")
    return " ".join(parca)


def ders_aciklamasi(ders: str, ist: DersIstatistik, ilce: str | None = None) -> str:
    """Meta açıklama: özet + eylem cümlesi."""
    return kirp(
        f"{ders_ozeti(ders, ist, ilce)} "
        "İlanları incele, öğretmeninle mesajlaş ve dersini ayarla."
    )


def ders_sss(
    ders: str,
    ist: DersIstatistik,
    ilce: str | None,
    ilce_sayilari: list[SeoBaglanti],
) -> list[SeoSss]:
    """Sık sorulan sorular: şablon metin + gerçek sayılar. Sayı yoksa soru yok."""
    yer = ilce or "Adana"
    sss: list[SeoSss] = []
    if ist.ucretli_sayisi and ist.en_dusuk_ucret is not None:
        if ist.en_dusuk_ucret == ist.en_yuksek_ucret:
            aralik = f"saatlik ücreti {tl(ist.en_dusuk_ucret)}"
        else:
            aralik = (
                f"saatlik ücretleri {tl(ist.en_dusuk_ucret)} ile "
                f"{tl(ist.en_yuksek_ucret or 0)} arasında; ortalama "
                f"{tl(ist.ortalama_ucret or 0)}"
            )
        sss.append(
            SeoSss(
                soru=f"{yer} {ders} özel ders ücretleri ne kadar?",
                cevap=(
                    f"{SITE_ADI}'te ücret belirten {ist.ucretli_sayisi} {ders} "
                    f"öğretmeninin {aralik}. Ücreti her öğretmen kendi ilanında belirler."
                ),
            )
        )
    sss.append(
        SeoSss(
            soru=f"{yer} kaç {ders} öğretmeni var?",
            cevap=(
                f"Şu anda {bulunma(yer)} {ist.egitmen_sayisi} {ders} öğretmeninin "
                "ilanı yayında."
            ),
        )
    )
    if ist.yuz_yuze_sayisi or ist.online_sayisi:
        parca = []
        if ist.yuz_yuze_sayisi:
            parca.append(f"{ist.yuz_yuze_sayisi} öğretmen yüz yüze")
        if ist.online_sayisi:
            parca.append(f"{ist.online_sayisi} öğretmen online")
        cevap = " ve ".join(parca) + " ders veriyor."
        if ist.yuz_yuze_sayisi and ist.online_sayisi:
            cevap += " İki şekilde de ders veren öğretmenler her iki sayıya dahildir."
        sss.append(
            SeoSss(soru=f"{ders} dersi yüz yüze mi, online mı?", cevap=cevap)
        )
    if ist.ilk_ders_ucretsiz_sayisi:
        sss.append(
            SeoSss(
                soru="İlk ders ücretsiz mi?",
                cevap=(
                    f"{ist.egitmen_sayisi} öğretmenden {ist.ilk_ders_ucretsiz_sayisi} "
                    "tanesi ilk dersi ücretsiz veriyor; ilanlarında "
                    "\"İlk ders ücretsiz\" etiketiyle görünür."
                ),
            )
        )
    if ilce is None and ilce_sayilari:
        liste = ", ".join(f"{b.ad} ({b.egitmen_sayisi})" for b in ilce_sayilari)
        sss.append(
            SeoSss(
                soru=f"Hangi ilçelerde {ders} özel dersi veriliyor?",
                cevap=f"İlçesini belirten öğretmen sayıları: {liste}.",
            )
        )
    return sss


def _kirinti_ld(kirintilar: list[SeoBaglanti]) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": i,
                "name": k.ad,
                "item": mutlak(k.yol),
            }
            for i, k in enumerate(kirintilar, start=1)
        ],
    }


def _ilan_yolu(t) -> str:
    return f"/{t.url_slug}" if t.url_slug else f"/egitmenler/{t.slug}"


# ── Ders / ilçe sayfası ───────────────────────────────────────────────────


async def ders_sayfasi(
    db: AsyncSession,
    subject_id: int,
    ilce: str | None = None,
    *,
    dizin: Dizin | None = None,
) -> DersSayfasiOut | None:
    """Ders (ilçe verilirse ilçe+ders) sayfası; arz yoksa None (→ 404)."""
    dizin = dizin or await dizin_kur(db)
    ders = dizin.dersler.get(subject_id)
    if ders is None or not ders.aktif:
        return None
    eslesen = dizin.eslesenler(ders, ilce)
    if not eslesen:
        return None

    ilce_slug = seo_adres.ilce_slugu(ilce) if ilce else None
    yol = ders_yolu(ders.slug, ilce_slug)
    ist = istatistik(eslesen)

    # İlçe bağlantıları: bu dersin öğretmeni olan ilçeler (bulunulan hariç).
    ilceler: list[SeoBaglanti] = []
    for ad in seo_adres.ADANA_ILCELERI:
        if ad == ilce:
            continue
        n = len(dizin.eslesenler(ders, ad))
        if n:
            ilceler.append(
                SeoBaglanti(
                    ad=f"{ad} {ders.ad} Özel Ders",
                    yol=ders_yolu(ders.slug, seo_adres.ilce_slugu(ad)),
                    egitmen_sayisi=n,
                )
            )
    ilceler.sort(key=lambda b: -(b.egitmen_sayisi or 0))

    # İlgili dersler: ders sayfasında aynı gruptaki dersler (şehir geneli),
    # ilçe sayfasında aynı ilçedeki diğer dersler.
    adaylar = []
    for d in dizin.dersler.values():
        if d.id == ders.id or not d.aktif or not d.adresli:
            continue
        if ilce is None and d.grup != ders.grup:
            continue
        n = len(dizin.eslesenler(d, ilce))
        if n:
            adaylar.append((n, d))
    adaylar.sort(key=lambda x: (-x[0], x[1].sira, x[1].ad))
    ilgili = [
        SeoBaglanti(
            ad=f"{ilce + ' ' if ilce else ''}{d.ad} Özel Ders",
            yol=ders_yolu(d.slug, ilce_slug),
            egitmen_sayisi=n,
        )
        for n, d in adaylar[:BAGLANTI_SINIRI]
    ]

    egitmenler = await search_service.search_tutors(
        db,
        subjects=[ders.slug],
        districts=[ilce] if ilce else None,
        limit=KART_SINIRI,
    )

    kirintilar = [SeoBaglanti(ad="Ana sayfa", yol="/")]
    kirintilar.append(SeoBaglanti(ad=f"{ders.ad} Özel Ders", yol=ders_yolu(ders.slug)))
    if ilce:
        kirintilar.append(SeoBaglanti(ad=f"{ilce} {ders.ad} Özel Ders", yol=yol))

    sss = ders_sss(ders.ad, ist, ilce, ilceler if ilce is None else [])
    h1 = ders_h1(ders.ad, ilce)
    json_ld = [
        _kirinti_ld(kirintilar),
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": h1,
            "numberOfItems": len(egitmenler),
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": i,
                    "url": mutlak(_ilan_yolu(t)),
                    "name": t.headline or t.display_name,
                }
                for i, t in enumerate(egitmenler, start=1)
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": s.soru,
                    "acceptedAnswer": {"@type": "Answer", "text": s.cevap},
                }
                for s in sss
            ],
        },
    ]

    return DersSayfasiOut(
        tur="ilce" if ilce else "ders",
        yol=yol,
        ders_adi=ders.ad,
        ders_slug=ders.slug,
        ilce_adi=ilce,
        ilce_slug=ilce_slug,
        baslik=ders_basligi(ders.ad, ist.egitmen_sayisi, ilce),
        h1=h1,
        aciklama=ders_aciklamasi(ders.ad, ist, ilce),
        ozet=ders_ozeti(ders.ad, ist, ilce),
        istatistik=ist,
        egitmenler=egitmenler,
        ilceler=ilceler,
        ilgili_dersler=ilgili,
        sss=sss,
        kirintilar=kirintilar,
        arama_yolu=arama_yolu(ders.slug, ilce),
        json_ld=json_ld,
    )


# ── İlan sayfası ──────────────────────────────────────────────────────────


def ilan_basligi(baslik: str | None, ad: str, ders: str | None) -> str:
    """İlan başlığı önde, ardından aranan kalıp: "<başlık> | Adana Matematik Özel Ders".

    İsim başlığın başında DEĞİL (kullanıcı kararı): aranan şey ders, isim değil.
    """
    on = (baslik or "").strip() or ad
    return f"{on} | Adana {ders} Özel Ders" if ders else f"{on} | {SITE_ADI}"


def ilan_aciklamasi(t, ders: str | None) -> str:
    parca = []
    yer = t.district and seo_adres.ilce_adi(t.district)
    konu = ders or (", ".join(t.subjects[:3]) if t.subjects else None)
    if konu:
        parca.append(
            f"{t.display_name}, {bulunma(yer or 'Adana')} {konu} özel dersi veriyor."
        )
    mod = _MOD_ETIKETI.get(t.teaching_mode.value if t.teaching_mode else "", None)
    if mod:
        parca.append(f"Ders şekli: {mod}.")
    if t.hourly_rate is not None:
        parca.append(f"Saatlik ücret {tl(float(t.hourly_rate))}.")
    if t.rating_count and t.rating_average:
        parca.append(f"{t.rating_average:.1f}/5 puan, {t.rating_count} yorum.")
    metin = " ".join(parca)
    if t.bio:
        metin = f"{metin} {t.bio}"
    return kirp(metin)


async def _ana_ders(db: AsyncSession, t) -> tuple[str | None, str | None]:
    """İlanın ana branşının kanonik adı ve ders sayfası yolu (varsa).

    Ana branş = ilan başlığında adı GEÇEN ilk branş; hiçbiri geçmiyorsa
    listedeki ilk branş. Liste sırası eğitmenin seçim sırasıdır ve başlıkla
    çelişebilir ("TYT Matematik" ilanında başlık "Coğrafya Özel Ders"
    olmasın diye, 18 Eyl 2026).
    """
    adaylar: list[tuple[str, str | None, str]] = []
    for metin in t.subjects or []:
        harita = await subject_service.map_texts_to_ids(db, [metin])
        sid = harita.get(normalize_tr(metin))
        if sid is None:
            continue
        ders = await db.get(Subject, sid)
        if ders is None or ders.deleted_at is not None:
            continue
        yol = ders_yolu(ders.slug) if ders.is_active else None
        adaylar.append((ders.name, yol, normalize_tr(metin)))
    if not adaylar:
        return (t.subjects[0] if t.subjects else None), None
    baslik = normalize_tr(getattr(t, "headline", None) or "")
    for ad, yol, norm in adaylar:
        if baslik and (normalize_tr(ad) in baslik or norm in baslik):
            return ad, yol
    return adaylar[0][0], adaylar[0][1]


async def ilan_sayfasi(db: AsyncSession, satir: SeoSlug) -> IlanSayfasiOut | None:
    tutor = await db.get(Tutor, satir.tutor_id)
    if tutor is None or not seo_slug_service.yayinda_mi(tutor):
        return None
    t = await search_service.get_tutor_public(db, tutor.id)
    ders, ders_sayfa_yolu = await _ana_ders(db, t)
    yol = f"/{satir.slug}"
    baslik = ilan_basligi(t.headline, t.display_name, ders)

    kirintilar = [SeoBaglanti(ad="Ana sayfa", yol="/")]
    if ders and ders_sayfa_yolu:
        kirintilar.append(SeoBaglanti(ad=f"{ders} Özel Ders", yol=ders_sayfa_yolu))
    kirintilar.append(SeoBaglanti(ad=(t.headline or t.display_name), yol=yol))

    kisi: dict = {
        "@context": "https://schema.org",
        "@type": "Person",
        "name": t.display_name,
        "url": mutlak(yol),
        "jobTitle": "Özel Ders Öğretmeni",
    }
    gorsel = storage.resolve_url(t.avatar_url, allow_private=False)
    if gorsel:
        kisi["image"] = gorsel
    if t.headline:
        kisi["description"] = t.headline
    if t.subjects:
        kisi["knowsAbout"] = list(t.subjects)
    ilce = seo_adres.ilce_adi(t.district)
    if ilce:
        kisi["address"] = {
            "@type": "PostalAddress",
            "addressLocality": ilce,
            "addressRegion": "Adana",
            "addressCountry": "TR",
        }
    # AggregateRating YALNIZ gerçek yorum varsa (Google boş puanı cezalandırır).
    if t.rating_count and t.rating_average:
        kisi["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": round(t.rating_average, 2),
            "reviewCount": t.rating_count,
            "bestRating": 5,
            "worstRating": 1,
        }
    if t.hourly_rate is not None:
        kisi["makesOffer"] = {
            "@type": "Offer",
            "priceCurrency": "TRY",
            "price": float(t.hourly_rate),
            "itemOffered": {
                "@type": "Service",
                "name": f"{ders} özel ders" if ders else "Özel ders",
                "areaServed": ilce or "Adana",
            },
        }

    return IlanSayfasiOut(
        yol=yol,
        tutor_id=t.id,
        url_slug=satir.slug,
        baslik=baslik,
        aciklama=ilan_aciklamasi(t, ders),
        kirintilar=kirintilar,
        json_ld=[kisi, _kirinti_ld(kirintilar)],
    )


# ── Adres çözümü ──────────────────────────────────────────────────────────


def _satir_yolu(satir: SeoSlug) -> str:
    return f"/{satir.slug}"


async def sayfa(
    db: AsyncSession, yol: str
) -> DersSayfasiOut | IlanSayfasiOut | YonlendirmeOut | None:
    """Kök adres ne? Sayfa verisi, kalıcı yönlendirme ya da None (404).

    None, "bu adres bir SEO sayfası değil ya da şu an kapalı" demektir;
    ön-çizim ucu bunu sayfa şekline göre 404 ya da normal SPA'ya çevirir.
    """
    parca = [p for p in yol.split("?")[0].split("/") if p]
    if len(parca) == 1:
        slug = parca[0]
        if not seo_adres.gecerli_slug_mi(slug) or seo_adres.rezerve_mi(slug):
            return None
        satir = await seo_slug_service.kayit(db, slug)
        if satir is None:
            return None
        if not satir.is_current:
            guncel = await seo_slug_service.guncel_karsilik(db, satir)
            if guncel is None or guncel.kind == "ilce":
                return None
            return YonlendirmeOut(hedef=_satir_yolu(guncel))
        if satir.kind == "ilan":
            return await ilan_sayfasi(db, satir)
        if satir.kind == "ders" and satir.subject_id is not None:
            return await ders_sayfasi(db, satir.subject_id)
        return None

    if len(parca) != 2:
        return None

    # Eski eğitmen adresi (`/egitmenler/dilan-4`) → yeni ilan adresine 301.
    if parca[0] == "egitmenler":
        m = _SONDAKI_ID.search(parca[1])
        if not m:
            return None
        tutor = await db.get(Tutor, int(m.group(1)))
        if tutor is None or not seo_slug_service.yayinda_mi(tutor):
            return None
        slug = await seo_slug_service.ilan_slugu(db, tutor.id)
        return YonlendirmeOut(hedef=f"/{slug}") if slug else None

    ilce_slug, ders_slug = parca
    if not (
        seo_adres.gecerli_slug_mi(ilce_slug)
        and seo_adres.gecerli_slug_mi(ders_slug)
        and seo_adres.ders_sayfasi_mi(ders_slug)
    ):
        return None
    ilce_satir = await seo_slug_service.kayit(db, ilce_slug)
    ders_satir = await seo_slug_service.kayit(db, ders_slug)
    if (
        ilce_satir is None
        or ilce_satir.kind != "ilce"
        or not ilce_satir.is_current
        or ders_satir is None
        or ders_satir.kind != "ders"
        or ders_satir.subject_id is None
    ):
        return None
    if not ders_satir.is_current:
        guncel = await seo_slug_service.guncel_karsilik(db, ders_satir)
        return (
            YonlendirmeOut(hedef=f"/{ilce_slug}/{guncel.slug}") if guncel else None
        )
    return await ders_sayfasi(db, ders_satir.subject_id, ilce_satir.district)


def seo_sekilli_mi(yol: str) -> bool:
    """Yol bir ders/ilçe sayfası ŞEKLİNDE mi (kapalıysa 404 verilecek küme)."""
    parca = [p for p in yol.split("?")[0].split("/") if p]
    if len(parca) == 1:
        return seo_adres.ders_sayfasi_mi(parca[0])
    if len(parca) == 2 and parca[0] != "egitmenler":
        return seo_adres.ders_sayfasi_mi(parca[1])
    return False


# ── Liste yüzeyleri: ana sayfa/footer bağlantıları ve sitemap ─────────────


async def populer_dersler(db: AsyncSession, limit: int = 8) -> list[PopulerDersOut]:
    """En çok öğretmeni olan dersler (iç link — Google sayfaları bulsun diye)."""
    dizin = await dizin_kur(db)
    sayim = [(len(dizin.eslesenler(d)), d) for d in dizin.acik_dersler()]
    sayim.sort(key=lambda x: (-x[0], x[1].sira, x[1].ad))
    return [
        PopulerDersOut(ad=d.ad, yol=ders_yolu(d.slug), egitmen_sayisi=n)
        for n, d in sayim[:limit]
    ]


async def acik_sayfa_yollari(db: AsyncSession) -> list[str]:
    """Açık bütün ders ve ilçe+ders sayfaları (sitemap)."""
    await seo_slug_service.ders_ilce_adreslerini_esitle(db)
    dizin = await dizin_kur(db)
    yollar: list[str] = []
    for d in sorted(dizin.acik_dersler(), key=lambda d: (d.grup, d.sira, d.ad)):
        yollar.append(ders_yolu(d.slug))
        for ad in seo_adres.ADANA_ILCELERI:
            if dizin.eslesenler(d, ad):
                yollar.append(ders_yolu(d.slug, seo_adres.ilce_slugu(ad)))
    return yollar


async def ilan_adresleri(db: AsyncSession) -> list[tuple[str, datetime.datetime | None]]:
    """Yayındaki ilanların kök adresleri ve son güncelleme zamanı (sitemap)."""
    return [
        (f"/{slug}", guncel)
        for slug, guncel in (
            await db.execute(
                select(SeoSlug.slug, Tutor.updated_at)
                .join(Tutor, Tutor.id == SeoSlug.tutor_id)
                .where(
                    SeoSlug.kind == "ilan",
                    SeoSlug.is_current.is_(True),
                    *seo_slug_service.yayinda_kosulu(),
                )
            )
        ).all()
    ]
