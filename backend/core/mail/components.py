"""E-posta şablonlarının ortak layout ve bileşenleri.

Görsel referans: Preply işlemsel e-postaları (kullanıcının paylaştığı ekran
görüntüleri) ve BRIX "120+ Email templates" Figma dosyası. Düzen:

- Açık gri zemin; logo kartın ÜSTÜNDE, zeminde ve ortalı.
- Beyaz kart (yarıçap 8, gölgesiz). Başlık ortalı ve kalın; metin sola yaslı,
  koyu ve 18px.
- Bilgi satırları ayrı renkli kutulardır: ikon + kalın etiket + değer
  ("Sipariş no: #1042").
- Durum kutuları: başarı (mint), not/uyarı (sarı) — ikonlu.
- Düğme tam genişlik, düz renk + koyu çerçeve.
- Kartın altında, zeminde: sosyal ikonlar ve © satırı.

Yazı ölçeği dört adımdır (``_TYPE``): başlık 26, gövde 18, ikincil 16,
küçük 14. Kalın yalnız başlıkta, satır etiketinde ve alıntı adında kullanılır;
gövde cümlelerinde kalın vurgu yoktur.

E-posta istemcisi kısıtları bilerek uygulanır:

- Yerleşim ``<table role="presentation">`` ile kurulur; Outlook (Word motoru)
  ``div`` dolgusunu ve flex/grid'i tanımaz.
- Tüm stiller inline'dır. ``<style>`` bloğu yalnız web fontu ve mobil daraltma
  içindir; desteklemeyen istemcide yerleşim zaten 600px'e kadar akışkandır.
- Figtree web fontu sitenin kendi HTTPS kökünden yüklenir (Apple Mail, iOS,
  Outlook for Mac). Gmail ve Outlook masaüstü web fontu yüklemez; oralarda
  Segoe UI / Roboto / Helvetica'ya düşer.
- Düğmeler "bulletproof"tur: Outlook için VML ``roundrect``, diğerleri için
  dolgulu ``<a>``.
- Görseller (logo, ikonlar) yalnız mutlak HTTPS adresinden PNG olarak yüklenir
  (bkz. ``_https_base``); Gmail/Outlook SVG göstermez. HTTPS kök yoksa logo
  metin olur, ikonlar çizilmez — kırık görsel kutusu çıkmaz.

Kullanıcıdan gelen her değer (ad, ürün adı, mesaj konusu…) burada kaçışlanır.
Şablon yazarı yalnız ``fmt``/``link`` ile işaretleme üretir; ham string
bileşenlere verilirse metin olarak kaçışlanır.
"""
from __future__ import annotations

import datetime
import html as _html
from collections.abc import Sequence

from core.config import settings

BRAND = "Adana Özel Ders"

# ── Renk token'ları ──
# Marka: logo laciverti #1A365D (Logolar/Logo-Bilgi.txt). Kutu tonları
# Preply'nin açık pembe/mint/sarı kutularının karşılığı; birincil ton lacivert
# ailesinden açık mavi.
PAGE_BG = "#F2F3F7"  # dış zemin (Preply'deki açık gri)
CARD_BG = "#FFFFFF"
INK = "#14161F"  # başlık ve gövde metni — gri değil, koyu
MUTED = "#5B6072"  # ikincil/küçük metin (beyazda 6,3)
NAVY = "#1A365D"  # marka laciverti — düğme
NAVY_DARK = "#0F2240"  # düğme çerçevesi
TINT = "#EAF1FB"  # bilgi satırı zemini
SUCCESS_BG = "#E3F6EF"  # başarı kutusu (Preply mint)
NOTE_BG = "#FFF4CC"  # not/uyarı kutusu (Preply sarı)
QUOTE_BG = "#F4F5F9"
LINE = "#D9DCE5"

FONT = "Figtree,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

# ── Yazı ölçeği ── (boyut, satır yüksekliği). Bileşenler yalnız bunları kullanır.
_TYPE = {
    "title": (26, 34),
    "body": (18, 29),
    "small": (16, 24),
    "caption": (14, 21),
}

CONTENT_WIDTH = 600
_PAD_X = 32  # kart yatay iç boşluğu
_INNER = CONTENT_WIDTH - 2 * _PAD_X  # 536 — Outlook VML düğme genişliği

# Türkiye kalıcı olarak UTC+3; tzdata'ya bağımlı olmamak için sabit ofset.
_TR_TZ = datetime.timezone(datetime.timedelta(hours=3))


class Html(str):
    """Kaçışlanmış/güvenli kabul edilen işaretleme. Düz ``str`` metindir."""


def esc(value: object) -> Html:
    if isinstance(value, Html):
        return value
    return Html(_html.escape(str(value), quote=True))


def fmt(template: str, **values: object) -> Html:
    """Güvenilen şablon metnine kaçışlanmış değerleri yerleştirir.

    ``template`` geliştiricinin yazdığı sabit metindir; ``values`` kullanıcı
    verisi olabilir ve kaçışlanır (``link(...)`` gibi ``Html`` hariç).
    """
    return Html(template.format(**{k: esc(v) for k, v in values.items()}))


def link(label: object, url: str) -> Html:
    return Html(
        f'<a href="{esc(url)}" style="color:{NAVY};text-decoration:underline;">{esc(label)}</a>'
    )


def site_url(path: str = "") -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}{path}"


def now_tr() -> str:
    return datetime.datetime.now(_TR_TZ).strftime("%d.%m.%Y %H:%M")


# Sitenin sosyal hesapları — kaynak: frontend/src/components/SiteFooter.tsx
# (SOSYAL_HESAPLAR). Oradaki liste değişirse burası da güncellenir.
SOCIAL_LINKS: tuple[tuple[str, str, str], ...] = (
    ("Instagram", "https://www.instagram.com/adanaozeldersofficial/", "instagram"),
    ("TikTok", "https://www.tiktok.com/@adanaozeldersofficial", "tiktok"),
    ("YouTube", "https://www.youtube.com/@adanaozeldersofficial", "youtube"),
    ("Facebook", "https://www.facebook.com/adanaozeldersofficial", "facebook"),
    ("X", "https://x.com/adanaozelderstr", "x"),
)
# E-posta görselleri: frontend/public/eposta/ — logo (Logolar/yatay-renkli.svg),
# sosyal ikonlar (site footer ikonları) ve satır ikonları (``i-*.png``), hepsi
# 3x PNG.
_ASSET_DIR = "/eposta"


def _https_base() -> str | None:
    """Görsel ve font yalnız HTTPS kökten sunulur.

    E-posta istemcileri göreli yolu çözemez; Gmail/Apple Mail HTTP görseli ya
    engeller ya da "güvensiz içerik" uyarısı gösterir. Yerel geliştirmede
    (``http://localhost``) bu yüzden metin logo ve sistem fontu kullanılır.
    """
    base = settings.FRONTEND_BASE_URL.strip().rstrip("/")
    if not base.lower().startswith("https://"):
        return None
    return base


def _asset(name: str) -> str | None:
    base = _https_base()
    return f"{base}{_ASSET_DIR}/{name}" if base else None


def _font_face_css() -> str:
    """Sitenin kendi Figtree dosyaları (frontend/public/fonts). Unicode aralıkları
    ``frontend/src/index.css`` ile aynı: ş/ğ/İ latin-ext dosyasındadır."""
    base = _https_base()
    if not base:
        return ""
    ext = (
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,"
        "U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,"
        "U+2113,U+2C60-2C7F,U+A720-A7FF"
    )
    latin = (
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,"
        "U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,"
        "U+FEFF,U+FFFD"
    )
    return "".join(
        "@font-face{font-family:'Figtree';font-style:normal;font-weight:300 900;"
        f"src:url('{base}/fonts/{name}') format('woff2');unicode-range:{rng};}}\n"
        for name, rng in (("figtree-latin-ext.woff2", ext), ("figtree-latin.woff2", latin))
    )


# ── Satır yardımcıları ──
# Her bileşen kart içeriğine eklenecek tam bir ``<tr>`` döndürür; aradaki
# boşluk hücre alt dolgusuyla verilir (Outlook ``margin``'i güvenilir uygulamaz).


def _row(inner: str, *, space: int = 24, align: str = "left") -> Html:
    return Html(
        f'<tr><td align="{align}" style="padding:0 0 {space}px 0;text-align:{align};">'
        f"{inner}</td></tr>"
    )


def _text(step: str, *, color: str = INK, weight: int = 400) -> str:
    size, line = _TYPE[step]
    return (
        f"margin:0;font-family:{FONT};font-size:{size}px;line-height:{line}px;"
        f"color:{color};font-weight:{weight};"
    )


def _table(inner: str, *, width: str = "100%", extra: str = "") -> str:
    return (
        f'<table role="presentation" width="{width}" cellpadding="0" cellspacing="0" '
        f'border="0"{extra}>{inner}</table>'
    )


def _icon(name: str | None, *, size: int = 24) -> str:
    """Satır/kutu ikonu (``frontend/public/eposta/i-<ad>.png``). HTTPS yoksa boş."""
    url = _asset(f"i-{name}.png") if name else None
    if not url:
        return ""
    return (
        f'<img src="{esc(url)}" width="{size}" height="{size}" alt="" '
        f'style="display:block;border:0;outline:none;width:{size}px;height:{size}px;">'
    )


def _box(inner: str, *, bg: str, icon: str | None, border: str | None = None) -> str:
    """Renkli kutu: solda ikon, sağda içerik (Preply bilgi satırı / durum kutusu)."""
    ic = _icon(icon)
    icon_cell = (
        f'<td width="40" valign="top" style="width:40px;padding-top:3px;">{ic}</td>' if ic else ""
    )
    border_css = f"border:1px solid {border};" if border else ""
    return _table(
        '<tr><td class="ao-box" style="padding:18px 22px;">'
        + _table(f"<tr>{icon_cell}<td valign=\"top\">{inner}</td></tr>")
        + "</td></tr>",
        extra=f' style="background:{bg};{border_css}border-radius:6px;border-collapse:separate;"',
    )


# ── Bileşenler ──


def heading(text: object, *, space: int = 20) -> Html:
    """Başlık — ortalı, kalın (Preply: "We've processed your refund")."""
    return _row(
        f'<h1 class="ao-h1" style="{_text("title", weight=700)}">{esc(text)}</h1>',
        space=space,
        align="center",
    )


def paragraph(content: object, *, space: int = 20) -> Html:
    """Gövde metni — 18/29, koyu, sola yaslı."""
    return _row(f'<p class="ao-p" style="{_text("body")}">{esc(content)}</p>', space=space)


def fine_print(content: object, *, space: int = 0) -> Html:
    """Düğmenin altındaki küçük gri not (geçerlilik süresi, "talebi sen yapmadıysan…")."""
    return _row(f'<p style="{_text("caption", color=MUTED)}">{esc(content)}</p>', space=space)


def info_rows(rows: Sequence[tuple[str | None, object, object]], *, space: int = 24) -> Html:
    """Bilgi satırları — Preply "🎓 Öğrenci: SERHAT" kutuları.

    ``rows``: (ikon, etiket, değer). Her satır ayrı açık mavi kutudur; etiket
    kalın, değer normal. Uzun değer (e-posta, IBAN) kırılır.
    """
    parts: list[str] = []
    last = len(rows) - 1
    for i, (icon, label, value) in enumerate(rows):
        inner = (
            f'<p class="ao-p" style="{_text("body")}word-break:break-word;">'
            f'<span style="font-weight:700;">{esc(label)}:</span> {esc(value)}</p>'
        )
        gap = 0 if i == last else 10
        parts.append(f'<tr><td style="padding:0 0 {gap}px 0;">{_box(inner, bg=TINT, icon=icon)}</td></tr>')
    return _row(_table("".join(parts)), space=space)


def callout(content: object, *, tone: str = "note", space: int = 24) -> Html:
    """Durum kutusu — Preply mint "Tebrikler…" / sarı "Please note…" kutusu.

    ``tone``: ``success`` (mint, onay ikonu), ``note`` (sarı, bilgi ikonu),
    ``warning`` (sarı, uyarı ikonu).
    """
    bg, icon = {
        "success": (SUCCESS_BG, "tamam"),
        "note": (NOTE_BG, "bilgi"),
        "warning": (NOTE_BG, "uyari"),
    }[tone]
    inner = f'<p class="ao-p" style="{_text("body")}">{esc(content)}</p>'
    return _row(_box(inner, bg=bg, icon=icon), space=space)


def quote(
    name: object,
    body: object,
    *,
    avatar_url: str | None = None,
    with_avatar: bool = False,
    space: int = 24,
) -> Html:
    """Alıntı kartı — Preply "Emre / Hocam merhaba" mesaj önizlemesi.

    ``with_avatar`` açıksa solda kişinin fotoğrafı (yoksa baş harfleri) durur
    (Preply "New message from …" kartı). Kullanıcı metni kaçışlanır; satır
    sonları ``white-space:pre-wrap`` ile korunur.
    """
    text = (
        f'<p style="{_text("body", weight=700)}">{esc(name)}</p>'
        f'<p class="ao-p" style="{_text("body")}padding-top:6px;white-space:pre-wrap;'
        f'word-break:break-word;">{esc(body)}</p>'
    )
    if with_avatar:
        text = _table(
            f'<tr><td width="68" valign="top" style="width:68px;">{avatar(name, avatar_url, size=52)}</td>'
            f'<td valign="top">{text}</td></tr>'
        )
    return _row(_box(text, bg=QUOTE_BG, icon=None, border=LINE), space=space)


# ── Özel ders bileşenleri ──

_AYLAR = (
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
)
_GUNLER = ("Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar")


def tarih_tr(dt: datetime.datetime) -> str:
    """``23 Eylül Çarşamba, 14:30`` — Türkiye saatiyle (ders saatleri UTC saklanır)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    t = dt.astimezone(_TR_TZ)
    return f"{t.day} {_AYLAR[t.month - 1]} {_GUNLER[t.weekday()]}, {t:%H:%M}"


def sure_tr(start: datetime.datetime, end: datetime.datetime) -> str:
    """``60 dk`` / ``1,5 saat`` yerine öğrencinin okuduğu biçim: ``1 saat 30 dk``."""
    dakika = max(0, int((end - start).total_seconds() // 60))
    saat, kalan = divmod(dakika, 60)
    if saat and kalan:
        return f"{saat} saat {kalan} dk"
    if saat:
        return f"{saat} saat"
    return f"{kalan} dk"


def tl(tutar: object) -> str:
    """Türkçe para biçimi: ``450`` → ``450 TL``, ``1250.5`` → ``1.250,50 TL``.

    Sayıya çevrilemeyen değer (ör. zaten biçimlenmiş ``"1.250,00"``) olduğu gibi
    kullanılır.
    """
    from decimal import Decimal, InvalidOperation

    try:
        d = Decimal(str(tutar))
    except InvalidOperation:
        return f"{tutar} TL"
    tam, kesir = f"{d:,.2f}".split(".")
    tam = tam.replace(",", ".")
    return f"{tam} TL" if kesir == "00" else f"{tam},{kesir} TL"


def strike(text: object) -> Html:
    """Üstü çizili değer — iptal edilen / taşınan dersin eski saati (Preply p13)."""
    return Html(f'<span style="text-decoration:line-through;color:{MUTED};">{esc(text)}</span>')


def badge(text: object, *, tone: str = "danger") -> Html:
    """Küçük durum etiketi — Preply "Ders iptal edildi" kırmızı rozeti."""
    bg, fg = {"danger": ("#B42318", "#FFFFFF"), "info": (NAVY, "#FFFFFF")}[tone]
    size, _ = _TYPE["caption"]
    return Html(
        f'<span style="display:inline-block;background:{bg};color:{fg};font-size:{size}px;'
        f'line-height:20px;font-weight:700;padding:1px 8px;border-radius:4px;'
        f'white-space:nowrap;">{esc(text)}</span>'
    )


def stars(rating: int) -> Html:
    """Puan yıldızları (1–5). Metin karakteri: görsel engellense de görünür."""
    r = max(0, min(5, int(rating)))
    return Html(
        f'<span style="color:#E8A317;letter-spacing:2px;">{"★" * r}</span>'
        f'<span style="color:{LINE};letter-spacing:2px;">{"★" * (5 - r)}</span>'
    )


def avatar(name: object, url: str | None, *, size: int = 52) -> str:
    """Kişi fotoğrafı; HTTPS değilse ya da yoksa baş harfleri (lacivert daire)."""
    if url and url.lower().startswith("https://"):
        return (
            f'<img src="{esc(url)}" width="{size}" height="{size}" alt="{esc(name)}" '
            f'style="display:block;border:0;outline:none;width:{size}px;height:{size}px;'
            f'border-radius:8px;object-fit:cover;">'
        )
    harfler = "".join(p[0] for p in str(name).split()[:2]).upper() or "?"
    size_px, _ = _TYPE["body"]
    return _table(
        f'<tr><td width="{size}" height="{size}" align="center" valign="middle" '
        f'style="width:{size}px;height:{size}px;background:{NAVY};border-radius:8px;'
        f"color:#FFFFFF;font-family:{FONT};font-size:{size_px}px;font-weight:700;"
        f'line-height:{size}px;text-align:center;">{esc(harfler)}</td></tr>',
        width="auto",
    )


def person_card(
    name: object, photo_url: str | None, chips: Sequence[object], *, space: int = 24
) -> Html:
    """Öğretmen kartı — Preply "Start your subscription" kartı (fotoğraf + ad + etiketler)."""
    # ``_text`` ``margin:0`` taşır; etiket aralığı ondan SONRA yazılmalı.
    chip_html = " ".join(
        f'<span style="{_text("small", color=NAVY, weight=500)}display:inline-block;'
        f'border:1px solid {NAVY};border-radius:6px;padding:2px 10px;margin:8px 4px 0 0;'
        f'white-space:nowrap;">{esc(ch)}</span>'
        for ch in chips
    )
    inner = _table(
        f'<tr><td width="92" valign="middle" style="width:92px;">{avatar(name, photo_url, size=76)}</td>'
        f'<td valign="middle"><p style="{_text("title", weight=700)}">{esc(name)}</p>'
        f"{chip_html}</td></tr>"
    )
    return _row(_box(inner, bg=CARD_BG, icon=None, border=LINE), space=space)


def steps(items: Sequence[tuple[object, object]], *, space: int = 0) -> Html:
    """Numaralı adımlar — Preply "Yolculuğunda seni destekliyoruz" kartı.

    ``items``: (başlık, açıklama). Numara lacivert daire içinde.
    """
    rows: list[str] = []
    size, _ = _TYPE["small"]
    for i, (title, body) in enumerate(items, start=1):
        gap = 0 if i == len(items) else 20
        rows.append(
            f'<tr><td style="padding:0 0 {gap}px 0;">'
            + _table(
                '<tr><td width="44" valign="top" style="width:44px;">'
                + _table(
                    f'<tr><td width="30" height="30" align="center" valign="middle" '
                    f'style="width:30px;height:30px;background:{NAVY};border-radius:15px;'
                    f"color:#FFFFFF;font-family:{FONT};font-size:{size}px;font-weight:700;"
                    f'line-height:30px;text-align:center;">{i}</td></tr>',
                    width="auto",
                )
                + "</td>"
                f'<td valign="top"><p style="{_text("body", weight=700)}">{esc(title)}</p>'
                f'<p style="{_text("small", color=MUTED)}padding-top:2px;">{esc(body)}</p></td></tr>'
            )
            + "</td></tr>"
        )
    return _row(_table("".join(rows)), space=space)


_BUTTON_VARIANTS = {
    # (zemin, yazı, çerçeve)
    "primary": (NAVY, "#FFFFFF", NAVY_DARK),
    "secondary": (CARD_BG, NAVY, NAVY),
}
_BUTTON_H = 56


def _button_cell(label: object, url: str, *, variant: str) -> str:
    bg, fg, border = _BUTTON_VARIANTS[variant]
    safe_url = esc(url)
    safe_label = esc(label)
    # Outlook masaüstü: VML roundrect (genişlik % kabul etmez, piksel verilir).
    vml = (
        "<!--[if mso]>"
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:w="urn:schemas-microsoft-com:office:word" '
        f'href="{safe_url}" style="height:{_BUTTON_H}px;v-text-anchor:middle;width:{_INNER}px;" '
        f'arcsize="14%" strokecolor="{border}" strokeweight="2px" fillcolor="{bg}">'
        "<w:anchorlock/>"
        f'<center style="color:{fg};font-family:Arial,sans-serif;font-size:18px;">'
        f"{safe_label}</center>"
        "</v:roundrect><![endif]-->"
    )
    size, line = _TYPE["body"]
    html_btn = (
        "<!--[if !mso]><!-->"
        f'<a href="{safe_url}" target="_blank" rel="noopener" '
        f'style="display:block;background:{bg};border:2px solid {border};border-radius:8px;'
        f"font-family:{FONT};font-size:{size}px;line-height:{line}px;font-weight:500;"
        f"color:{fg};text-decoration:none;text-align:center;"
        f'padding:{(_BUTTON_H - line - 4) // 2}px 20px;mso-hide:all;">{safe_label}</a>'
        "<!--<![endif]-->"
    )
    return vml + html_btn


def button(label: object, url: str, *, variant: str = "primary", space: int = 16) -> Html:
    """Tam genişlik düğme — Preply "E-posta adresimi doğrula" (düz renk + koyu çerçeve)."""
    return _row(_button_cell(label, url, variant=variant), space=space)


def tag(text: object) -> Html:
    """Küçük etiket (iç e-postalar: "İletişim formu")."""
    return _row(
        _table(
            f'<tr><td style="background:{TINT};border-radius:6px;padding:4px 10px;'
            f'{_text("caption", color=NAVY, weight=700)}">{esc(text)}</td></tr>',
            width="auto",
            extra=' align="center" style="margin:0 auto;"',
        ),
        space=14,
        align="center",
    )


def _logo() -> str:
    url = _asset("logo.png")
    if url:
        return (
            f'<img src="{esc(url)}" width="258" height="36" alt="{BRAND}" '
            'style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;'
            'width:258px;height:auto;max-width:258px;">'
        )
    return f'<span style="{_text("title", color=NAVY, weight=700)}">{BRAND}</span>'


def _social_icons() -> str:
    """Sosyal hesap ikonları (20px, 18px aralık). HTTPS yoksa metin bağlantı."""
    cells: list[str] = []
    for i, (name, url, key) in enumerate(SOCIAL_LINKS):
        pad = "0" if i == 0 else "0 0 0 18px"
        img = _asset(f"{key}.png")
        inner = (
            f'<img src="{esc(img)}" width="20" height="20" alt="{name}" '
            'style="display:block;border:0;outline:none;width:20px;height:20px;">'
            if img
            else name
        )
        cells.append(
            f'<td style="padding:{pad};{_text("caption")}">'
            f'<a href="{esc(url)}" target="_blank" rel="noopener" '
            f'style="color:{INK};text-decoration:none;">{inner}</a></td>'
        )
    return _table(
        f"<tr>{''.join(cells)}</tr>", width="auto", extra=' align="center" style="margin:0 auto;"'
    )


_PREHEADER_PAD = "&#8199;&#65279;&#847; " * 40

_BASE_CSS = """
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{-ms-interpolation-mode:bicubic;}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
@media only screen and (max-width:620px){
  .ao-outer{padding:24px 12px!important;}
  .ao-card{padding:28px 20px!important;}
  .ao-h1{font-size:22px!important;line-height:29px!important;}
  .ao-p{font-size:16px!important;line-height:25px!important;}
  .ao-box{padding:14px 16px!important;}
}
""".strip()


def _card_row(blocks: Sequence[str], *, top: int = 0) -> str:
    return (
        f'<tr><td style="padding-top:{top}px;">'
        + _table(
            f'<tr><td class="ao-card" style="background:{CARD_BG};border-radius:8px;'
            f'padding:36px {_PAD_X}px;">{_table("".join(blocks))}</td></tr>'
        )
        + "</td></tr>"
    )


def render(
    *,
    title: str,
    preheader: str,
    blocks: Sequence[str],
    more_cards: Sequence[Sequence[str]] = (),
) -> str:
    """Tam e-posta belgesi.

    ``preheader``: gelen kutusu önizlemesinde konu satırının yanında görünen
    metin; gövdede gizlidir. Arkasındaki dolgu, istemcinin önizlemeye gövde
    metnini eklemesini engeller.

    ``more_cards``: ana kartın altında ayrı beyaz kartlar (Preply hoş geldin
    mailindeki "Yolculuğunda seni destekliyoruz" kartı gibi).
    """
    year = datetime.datetime.now(_TR_TZ).year
    body = _table(
        # Logo — kartın üstünde, zeminde.
        f'<tr><td align="center" style="padding:0 0 28px 0;">{_logo()}</td></tr>'
        # Kartlar
        + _card_row(blocks)
        + "".join(_card_row(card, top=16) for card in more_cards)
        +
        # Footer — zeminde
        f'<tr><td align="center" style="padding:32px 0 12px 0;">{_social_icons()}</td></tr>'
        f'<tr><td align="center" style="{_text("caption", color=MUTED)}text-align:center;">'
        f"© {year} {BRAND}</td></tr>",
        extra=f' style="max-width:{CONTENT_WIDTH}px;margin:0 auto;"',
    )
    return (
        "<!DOCTYPE html>\n"
        '<html lang="tr" xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<meta http-equiv="X-UA-Compatible" content="IE=edge">\n'
        '<meta name="x-apple-disable-message-reformatting">\n'
        '<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">\n'
        '<meta name="color-scheme" content="light">\n'
        '<meta name="supported-color-schemes" content="light">\n'
        f"<title>{esc(title)}</title>\n"
        "<!--[if mso]><noscript><xml><o:OfficeDocumentSettings>"
        "<o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->\n"
        f"<style>\n{_font_face_css()}{_BASE_CSS}\n</style>\n"
        "</head>\n"
        f'<body style="margin:0;padding:0;width:100%;background:{PAGE_BG};">\n'
        f'<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;'
        f'mso-hide:all;font-size:1px;line-height:1px;color:{PAGE_BG};">'
        f"{esc(preheader)}{_PREHEADER_PAD}</div>\n"
        + _table(
            '<tr><td class="ao-outer" align="center" style="padding:40px 16px;">\n'
            f'<!--[if mso]><table role="presentation" width="{CONTENT_WIDTH}" cellpadding="0" '
            'cellspacing="0" border="0"><tr><td><![endif]-->\n'
            + body
            + "\n<!--[if mso]></td></tr></table><![endif]-->\n"
            "</td></tr>",
            extra=f' style="background:{PAGE_BG};"',
        )
        + "\n</body>\n</html>"
    )


def text_footer() -> str:
    """Düz metin gövdenin ortak kapanışı (HTML footer'ın karşılığı)."""
    return f"\n\n--\n{BRAND} · {site_url()}"
