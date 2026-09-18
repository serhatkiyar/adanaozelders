"""Kök SEO sayfalarının ön-çizimi (Modül 6) — HERKESE aynı HTML.

## Ne yapar

Ders, ilçe+ders ve ilan sayfaları için frontend'in DERLENMİŞ `index.html`
şablonu alınır; `<head>`e başlık/açıklama/canonical/Open Graph/JSON-LD,
`#root` içine sayfanın anlamlı içeriği (H1, özet, öğretmen listesi, SSS)
yerleştirilir. React açılınca `createRoot` kökün içeriğini kendi render'ıyla
değiştirir; gösterilen veri aynı uçtan (`seo_sayfa_service`) geldiği için
görsel içerik aynıdır.

## Cloaking yok

Kullanıcı, Googlebot ve paylaşım botu AYNI yanıtı alır: ayrım user-agent'a
göre DEĞİL, yola göre yapılır (frontend `nginx.conf`). `devops/Caddyfile`'daki
"Googlebot'a farklı içerik sunma" kuralı bu yüzden çiğnenmez.

## Şablon

`FRONTEND_INTERNAL_URL` + `/index.html` (compose ağında frontend konteyneri)
iç istekle alınır ve kısa süre önbelleğe konur: deploy'da asset adları
(hash) değişir, bayat şablon var olmayan chunk'a işaret ederdi. Şablon
alınamazsa 503 döner; nginx `error_page` ile normal `index.html`'e düşer —
sayfa yine açılır, yalnız ön-çizim gelmez.
"""
from __future__ import annotations

import json
import re
import time
from html import escape

import httpx
from fastapi import Response
from fastapi.responses import RedirectResponse

from core.config import settings
from core.database import AsyncSessionLocal
from schemas.seo import DersSayfasiOut, IlanSayfasiOut, YonlendirmeOut
from services import search_service, seo_sayfa_service, seo_slug_service
from services.seo_sayfa_service import SITE_ADI, mutlak, tl

#: Şablon önbelleği (saniye). Kısa tutuldu: deploy sonrası en geç bu kadar
#: süre eski asset adları sunulur (nginx eski chunk'ı zaten 404'ler).
SABLON_OMRU = 60

_onbellek: tuple[str, float] | None = None


class SablonYok(RuntimeError):
    pass


async def sablon_al() -> str:
    """Derlenmiş `index.html`; alınamazsa son iyi kopya, o da yoksa SablonYok."""
    global _onbellek
    simdi = time.monotonic()
    if _onbellek and simdi - _onbellek[1] < SABLON_OMRU:
        return _onbellek[0]
    taban = settings.FRONTEND_INTERNAL_URL.rstrip("/")
    if not taban:
        raise SablonYok("FRONTEND_INTERNAL_URL tanımsız")
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{taban}/index.html")
        r.raise_for_status()
        metin = r.text
        if '<div id="root"></div>' not in metin or "</head>" not in metin:
            raise SablonYok("beklenmeyen şablon biçimi")
    except (httpx.HTTPError, SablonYok) as exc:
        if _onbellek:
            return _onbellek[0]
        raise SablonYok(str(exc)) from exc
    _onbellek = (metin, simdi)
    return metin


# ── HTML parçaları (saf; pytest'li) ───────────────────────────────────────

_TITLE = re.compile(r"<title>.*?</title>", re.S)
_DESC = re.compile(r"<meta\s+name=\"description\"[^>]*>", re.S)


def _json_ld(veri: dict) -> str:
    govde = json.dumps(veri, ensure_ascii=False).replace("<", "\\u003c")
    return f'<script type="application/ld+json" data-rh="true">{govde}</script>'


def head_etiketleri(
    *,
    baslik: str,
    aciklama: str,
    yol: str | None,
    json_ld: list[dict] | None = None,
    noindex: bool = False,
    tur: str = "website",
    gorsel: str | None = None,
) -> str:
    """`data-rh` işaretli etiketler: react-helmet-async açılışta bunları kendi
    etiketleriyle DEĞİŞTİRİR (çift `description`/canonical kalmaz)."""
    b, a = escape(baslik), escape(aciklama)
    parca = [f'<title data-rh="true">{b}</title>',
             f'<meta name="description" content="{a}" data-rh="true">']
    if noindex:
        parca.append('<meta name="robots" content="noindex,nofollow" data-rh="true">')
    if yol:
        url = escape(mutlak(yol))
        img = escape(gorsel or mutlak("/logo.png"))
        parca += [
            f'<link rel="canonical" href="{url}" data-rh="true">',
            f'<meta property="og:site_name" content="{escape(SITE_ADI)}" data-rh="true">',
            f'<meta property="og:title" content="{b}" data-rh="true">',
            f'<meta property="og:description" content="{a}" data-rh="true">',
            f'<meta property="og:type" content="{escape(tur)}" data-rh="true">',
            f'<meta property="og:url" content="{url}" data-rh="true">',
            f'<meta property="og:image" content="{img}" data-rh="true">',
            '<meta property="og:locale" content="tr_TR" data-rh="true">',
            '<meta name="twitter:card" content="summary_large_image" data-rh="true">',
            f'<meta name="twitter:title" content="{b}" data-rh="true">',
            f'<meta name="twitter:description" content="{a}" data-rh="true">',
            f'<meta name="twitter:image" content="{img}" data-rh="true">',
        ]
    parca += [_json_ld(v) for v in json_ld or []]
    return "\n    ".join(parca)


def enjekte(sablon: str, head: str, govde: str = "") -> str:
    """Şablonun jenerik başlık/açıklamasını söküp sayfanınkini koyar."""
    html = _TITLE.sub("", sablon, count=1)
    html = _DESC.sub("", html, count=1)
    html = html.replace("</head>", f"    {head}\n  </head>", 1)
    if govde:
        html = html.replace('<div id="root"></div>', f'<div id="root">{govde}</div>', 1)
    return html


def _baglantilar(baslik: str, liste) -> str:
    if not liste:
        return ""
    li = "".join(
        f'<li><a href="{escape(b.yol)}">{escape(b.ad)}</a>'
        + (f" ({b.egitmen_sayisi})" if b.egitmen_sayisi else "")
        + "</li>"
        for b in liste
    )
    return f"<section><h2>{escape(baslik)}</h2><ul>{li}</ul></section>"


def _kirinti_html(kirintilar) -> str:
    li = "".join(
        f'<li><a href="{escape(k.yol)}">{escape(k.ad)}</a></li>' for k in kirintilar
    )
    return f'<nav aria-label="Sayfa konumu"><ol>{li}</ol></nav>'


def ders_govdesi(s: DersSayfasiOut) -> str:
    ist = s.istatistik
    olcu = [f"<li>{ist.egitmen_sayisi} öğretmen</li>"]
    if ist.ortalama_ucret is not None:
        olcu.append(f"<li>Ortalama saatlik ücret {escape(tl(ist.ortalama_ucret))}</li>")
    if ist.yuz_yuze_sayisi:
        olcu.append(f"<li>{ist.yuz_yuze_sayisi} yüz yüze</li>")
    if ist.online_sayisi:
        olcu.append(f"<li>{ist.online_sayisi} online</li>")
    kartlar = []
    for t in s.egitmenler:
        yol = f"/{t.url_slug}" if t.url_slug else f"/egitmenler/{t.slug}"
        alt = [escape(t.display_name)]
        if t.district:
            alt.append(escape(t.district))
        if t.hourly_rate is not None:
            alt.append(escape(tl(float(t.hourly_rate))))
        kartlar.append(
            f'<li><a href="{escape(yol)}"><h3>{escape(t.headline or t.display_name)}</h3></a>'
            f"<p>{' · '.join(alt)}</p></li>"
        )
    sss = "".join(
        f"<dt>{escape(q.soru)}</dt><dd>{escape(q.cevap)}</dd>" for q in s.sss
    )
    return (
        '<main class="mx-auto max-w-[76rem] px-4 py-8">'
        f"{_kirinti_html(s.kirintilar)}"
        f"<h1>{escape(s.h1)}</h1>"
        f"<p>{escape(s.ozet)}</p>"
        f"<ul>{''.join(olcu)}</ul>"
        f"<section><h2>{escape(s.ders_adi)} öğretmenleri</h2><ul>{''.join(kartlar)}</ul>"
        f'<p><a href="{escape(s.arama_yolu)}">Tüm öğretmenleri gör</a></p></section>'
        f"{_baglantilar('İlçelere göre', s.ilceler)}"
        f"{_baglantilar('İlgili dersler', s.ilgili_dersler)}"
        f"<section><h2>Sık sorulan sorular</h2><dl>{sss}</dl></section>"
        "</main>"
    )


def ilan_govdesi(s: IlanSayfasiOut, t) -> str:
    alt = [escape(t.display_name)]
    if t.district:
        alt.append(escape(t.district))
    if t.hourly_rate is not None:
        alt.append(f"Saatlik {escape(tl(float(t.hourly_rate)))}")
    if t.rating_count and t.rating_average:
        alt.append(f"{t.rating_average:.1f}/5 ({t.rating_count} yorum)")
    bolumler = [
        '<main class="mx-auto max-w-[76rem] px-4 py-8">',
        _kirinti_html(s.kirintilar),
        f"<h1>{escape(t.headline or t.display_name)}</h1>",
        f"<p>{' · '.join(alt)}</p>",
    ]
    if t.subjects:
        li = "".join(f"<li>{escape(x)}</li>" for x in t.subjects)
        bolumler.append(f"<section><h2>Verdiği dersler</h2><ul>{li}</ul></section>")
    if t.bio:
        bolumler.append(f"<section><h2>Hakkımda</h2><p>{escape(t.bio)}</p></section>")
    if t.lesson_info:
        bolumler.append(
            f"<section><h2>Ders hakkında</h2><p>{escape(t.lesson_info)}</p></section>"
        )
    bolumler.append("</main>")
    return "".join(bolumler)


# ── Uç ────────────────────────────────────────────────────────────────────

_HTML = "text/html; charset=utf-8"
_TAZE = {"Cache-Control": "no-cache, must-revalidate"}


async def yanit(yol: str, sorgu: str = "") -> Response:
    """`/__sayfa?path=` — nginx yalnız SEO şeklindeki yolları buraya yollar."""
    async with AsyncSessionLocal() as db:
        sonuc = await seo_sayfa_service.sayfa(db, yol)
        if isinstance(sonuc, YonlendirmeOut):
            hedef = mutlak(sonuc.hedef) + (f"?{sorgu}" if sorgu else "")
            return RedirectResponse(hedef, status_code=301)
        tutor = None
        if isinstance(sonuc, IlanSayfasiOut):
            tutor = await search_service.get_tutor_public(db, sonuc.tutor_id)
        kapali = sonuc is None and (
            seo_sayfa_service.seo_sekilli_mi(yol) or await _kayitli_tek_parca(db, yol)
        )
        # Sayfa değişmediği sürece ön-çizim her açılışta yeniden hesaplanır;
        # yazma yok, commit gerekmez.

    try:
        sablon = await sablon_al()
    except SablonYok:
        return Response(status_code=503, headers=_TAZE)

    if isinstance(sonuc, DersSayfasiOut):
        head = head_etiketleri(
            baslik=sonuc.baslik, aciklama=sonuc.aciklama, yol=sonuc.yol,
            json_ld=sonuc.json_ld,
        )
        return Response(enjekte(sablon, head, ders_govdesi(sonuc)), media_type=_HTML, headers=_TAZE)
    if isinstance(sonuc, IlanSayfasiOut):
        head = head_etiketleri(
            baslik=sonuc.baslik, aciklama=sonuc.aciklama, yol=sonuc.yol,
            json_ld=sonuc.json_ld, tur="profile",
            gorsel=tutor.avatar_url if tutor is not None else None,
        )
        return Response(
            enjekte(sablon, head, ilan_govdesi(sonuc, tutor)), media_type=_HTML, headers=_TAZE
        )
    if kapali:
        # Kapalı ders sayfası ya da yayında olmayan ilan: gerçek 404 + noindex.
        # Gövde SPA'nın kendisi; React "sayfa bulunamadı" ekranını çizer.
        head = head_etiketleri(
            baslik=f"Sayfa bulunamadı | {SITE_ADI}",
            aciklama="Aradığın sayfa şu anda yayında değil.",
            yol=None,
            noindex=True,
        )
        return Response(enjekte(sablon, head), status_code=404, media_type=_HTML, headers=_TAZE)
    # SEO kaydı olmayan yol (`/sifremi-unuttum` gibi SPA rotaları): şablon AYNEN.
    return Response(sablon, media_type=_HTML, headers=_TAZE)


async def _kayitli_tek_parca(db, yol: str) -> bool:
    parca = [p for p in yol.split("/") if p]
    if len(parca) != 1:
        return False
    return await seo_slug_service.kayit(db, parca[0]) is not None
