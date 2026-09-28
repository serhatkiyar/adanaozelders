"""E-posta şablonlarının ortak layout ve bileşenleri.

Görsel referans: BRIX "120+ Email templates" Figma dosyası (sayfa
``🎨 Email Templates``), özellikle Password Reset 02 (18202:2021). Ölçüler
(kart/düğme yarıçapları, iç boşluklar, gölge) Figma'dan alındı; birincil
mavi, logo lacivertine çevrildi.

Tek düzen, tek yazı ölçeği — her e-posta aynı standardı izler:

- Logo, başlık ve metin sola yaslıdır. Güvenlik e-postaları logonun sağında
  gönderim zamanını gösterir.
- Yazı ölçeği dört adımdır (``_TYPE``): başlık 30, gövde 18, ikincil 16,
  etiket 14. Başka boyut kullanılmaz.
- Gövde metninde kalın vurgu yoktur. Vurgu yalnız başlıkta, kart değerinde ve
  düğmededir.
- Ham bağlantı ("düğme çalışmazsa…") HTML'de gösterilmez; bağlantının tamamı
  düz metin gövdede durur.

E-posta istemcisi kısıtları bilerek uygulanır:

- Yerleşim ``<table role="presentation">`` ile kurulur; Outlook (Word motoru)
  ``div`` dolgusunu ve flex/grid'i tanımaz.
- Tüm stiller inline'dır. ``<style>`` bloğu yalnız web fontu ve mobil daraltma
  içindir; desteklemeyen istemcide yerleşim zaten 600px'e kadar akışkandır.
- Figtree web fontu sitenin kendi HTTPS kökünden yüklenir (Apple Mail, iOS,
  Outlook for Mac, Thunderbird). Gmail ve Outlook masaüstü web fontu
  yüklemez; oralarda Segoe UI / Roboto / Helvetica'ya düşer.
- Düğmeler "bulletproof"tur: Outlook için VML ``roundrect``, diğerleri için
  dolgulu ``<a>``.
- Görseller yalnız mutlak HTTPS adresinden yüklenir (bkz. ``_https_base``);
  aksi halde marka adı metin olarak yazılır — kırık görsel kutusu çıkmaz.

Kullanıcıdan gelen her değer (ad, ürün adı, mesaj konusu…) burada kaçışlanır.
Şablon yazarı yalnız ``fmt``/``link`` ile işaretleme üretir; ham string
bileşenlere verilirse metin olarak kaçışlanır.
"""
from __future__ import annotations

import datetime
import html as _html
from collections.abc import Iterable, Sequence

from core.config import settings

BRAND = "Adana Özel Ders"

# ── Renk token'ları ──
# Figma'nın `Neutral Colors` ölçeği. Birincil mavi (#2388FF) logo laciverti
# ailesindeki koyu düğmeye (Password Reset 02'deki ``#19213D`` düğme)
# çevrildi; e-postalar beyaz zemin + lacivert vurguyla kalır.
PAGE_BG = "#EEF2F9"  # Figma kanvasındaki açık zemin
CARD_BG = "#FFFFFF"
INK = "#19213D"  # Figma neutral-800 — başlık, kart değeri, düğme
BODY = "#646B84"  # Figma neutral-600'ün (#6D758F) bir tık koyusu: açık gri kartta da ≥ 4,5
SUBTLE_BG = "#F8FAFF"  # Figma neutral-200
LINE = "#E1E4ED"  # Figma neutral-400
PENDING = "#A8AEC3"  # Figma neutral-500 — bekleyen adım / pasif nokta

FONT = "Figtree,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

# ── Yazı ölçeği ── (boyut, satır yüksekliği). Bileşenler yalnız bunları kullanır.
_TYPE = {
    "title": (30, 36),  # Figma Display/7/Bold
    "body": (18, 28),  # Figma Paragraph/Large/Regular
    "small": (16, 24),  # Figma Paragraph/Medium/Regular
    "caption": (14, 20),  # Figma Display/2
}

CONTENT_WIDTH = 600
_PAD = 60  # Figma kart iç boşluğu
_INNER = CONTENT_WIDTH - 2 * _PAD  # 480 — Outlook VML düğme genişliği

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
        f'<a href="{esc(url)}" style="color:{INK};text-decoration:underline;">{esc(label)}</a>'
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
# E-posta görselleri: frontend/public/eposta/ (logo = Logolar/yatay-renkli.svg'nin
# 3x PNG'si, ikonlar = site footer ikonlarının 3x PNG'si). SVG kullanılmaz:
# Gmail ve Outlook SVG görsel göstermez.
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
# Her bileşen içerik tablosuna eklenecek tam bir ``<tr>`` döndürür; aradaki
# boşluk hücre alt dolgusuyla verilir (Outlook ``margin``'i güvenilir uygulamaz).


def _row(inner: str, *, space: int = 24) -> Html:
    return Html(f'<tr><td align="left" style="padding:0 0 {space}px 0;">{inner}</td></tr>')


def _text(step: str, *, color: str = BODY, weight: int = 400) -> str:
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


def logo(*, aside: object | None = None) -> Html:
    """Logo şeridi — Figma Password Reset 02 ``Top Bar`` (solda logo, sağda tarih).

    Görsel: güncel yatay renkli logo (``frontend/public/eposta/logo.png``,
    687×96, 32px yükseklikte gösterilir). ``aside`` verilirse sağda durur;
    mobilde logonun altına iner.
    """
    base = _https_base()
    if base:
        mark = (
            f'<img src="{esc(base)}{_ASSET_DIR}/logo.png" width="229" height="32" alt="{BRAND}" '
            f'style="display:block;border:0;outline:none;text-decoration:none;'
            f'width:229px;height:auto;max-width:229px;">'
        )
    else:
        mark = f'<span style="{_text("title", color=INK, weight=600)}font-size:24px;">{BRAND}</span>'
    if aside is None:
        return _row(mark, space=56)
    return _row(
        _table(
            f'<tr><td class="ao-stack" align="left" valign="middle">{mark}</td>'
            f'<td class="ao-stack ao-aside" align="right" valign="middle" '
            f'style="{_text("small")}">{esc(aside)}</td></tr>'
        ),
        space=56,
    )


def tag(text: object) -> Html:
    """Küçük etiket — Multi-step Progress 01 ``Tag``."""
    return _row(
        _table(
            f'<tr><td style="background:{SUBTLE_BG};border:1px solid {LINE};'
            f'border-radius:10px;padding:6px 10px;{_text("caption", color=INK, weight=600)}">'
            f"{esc(text)}</td></tr>",
            width="auto",
        ),
        space=16,
    )


def heading(text: object, *, space: int = 20) -> Html:
    """Başlık — ``title`` adımı (30/36, 600). Mobilde 26/32."""
    return _row(
        f'<h1 class="ao-h1" style="{_text("title", color=INK, weight=600)}">{esc(text)}</h1>',
        space=space,
    )


def paragraph(content: object, *, space: int = 32) -> Html:
    """Gövde metni — ``body`` adımı (18/28). Mobilde 16/25."""
    return _row(f'<p class="ao-p" style="{_text("body")}">{esc(content)}</p>', space=space)


def note(content: object, *, space: int = 0) -> Html:
    """İkincil metin (geçerlilik süresi, "talebi sen yapmadıysan…") — ``small`` adımı."""
    return _row(f'<p style="{_text("small")}">{esc(content)}</p>', space=space)


_BUTTON_VARIANTS = {
    # (zemin, yazı, kenarlık) — Figma ``Buttons`` bileşeninin koyu ve açık türü
    "primary": (INK, "#FFFFFF", INK),
    "secondary": (SUBTLE_BG, INK, LINE),
}
_BUTTON_H = 62  # Figma düğme yüksekliği
_BUTTON_RADIUS = 16


def _button_cell(label: object, url: str, *, variant: str, vml_width: int = _INNER) -> str:
    bg, fg, border = _BUTTON_VARIANTS[variant]
    safe_url = esc(url)
    safe_label = esc(label)
    # Outlook masaüstü: VML roundrect (genişlik % kabul etmez, piksel verilir).
    vml = (
        "<!--[if mso]>"
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:w="urn:schemas-microsoft-com:office:word" '
        f'href="{safe_url}" style="height:{_BUTTON_H}px;v-text-anchor:middle;width:{vml_width}px;" '
        f'arcsize="26%" strokecolor="{border}" fillcolor="{bg}">'
        "<w:anchorlock/>"
        f'<center style="color:{fg};font-family:Arial,sans-serif;font-size:18px;'
        f'font-weight:bold;">{safe_label}</center>'
        "</v:roundrect><![endif]-->"
    )
    size, line = _TYPE["body"]
    html_btn = (
        "<!--[if !mso]><!-->"
        f'<a href="{safe_url}" target="_blank" rel="noopener" '
        f'style="display:block;background:{bg};border:1px solid {border};'
        f"border-radius:{_BUTTON_RADIUS}px;font-family:{FONT};font-size:{size}px;"
        f"line-height:{line}px;font-weight:600;color:{fg};text-decoration:none;"
        f"text-align:center;padding:{(_BUTTON_H - line - 2) // 2}px 24px;"
        f'box-shadow:0 7px 8px rgba(85,108,135,0.07);mso-hide:all;">{safe_label}</a>'
        "<!--<![endif]-->"
    )
    return vml + html_btn


def button(label: object, url: str, *, space: int = 32) -> Html:
    """Tam genişlik düğme — Figma ``Buttons`` (18199:1780), koyu tür: 62px, yarıçap 16."""
    return _row(_table(f"<tr><td>{_button_cell(label, url, variant='primary')}</td></tr>"), space=space)


def button_pair(
    primary: tuple[object, str], secondary: tuple[object, str], *, space: int = 32
) -> Html:
    """Yan yana iki düğme — Security Alert 01 ``Button Set`` (16px aralık). Mobilde alt alta."""
    half = (_INNER - 16) // 2
    left = _button_cell(primary[0], primary[1], variant="primary", vml_width=half)
    right = _button_cell(secondary[0], secondary[1], variant="secondary", vml_width=half)
    return _row(
        _table(
            "<tr>"
            f'<td class="ao-stack" width="50%" valign="top" style="padding:0 8px 0 0;">{left}</td>'
            f'<td class="ao-stack ao-stack-last" width="50%" valign="top" '
            f'style="padding:0 0 0 8px;">{right}</td>'
            "</tr>"
        ),
        space=space,
    )


def _card(inner_rows: str) -> str:
    """Açık gri kart — Security Alert 01 ``Inner Card`` (yarıçap 24, 32/36 dolgu)."""
    return _table(
        f'<tr><td class="ao-card-inner" style="padding:28px 32px;">{_table(inner_rows)}</td></tr>',
        extra=(
            f' style="background:{SUBTLE_BG};border:1px solid {LINE};border-radius:24px;'
            'border-collapse:separate;"'
        ),
    )


def info_card(rows: Sequence[tuple[object, object]], *, space: int = 32) -> Html:
    """Etiket–değer listesi — Security Alert 01 ``Inner Card`` (Date / IP Address).

    Etiket ``small`` gri, değer ``small`` lacivert 500; satırlar arasında ince
    çizgi. Uzun değer (e-posta, IBAN) mobilde alt satıra kırılır.
    """
    parts: list[str] = []
    last = len(rows) - 1
    for i, (label, value) in enumerate(rows):
        top = "" if i == 0 else f"border-top:1px solid {LINE};"
        pad_top = 0 if i == 0 else 16
        pad_bottom = 0 if i == last else 16
        parts.append(
            f'<tr><td style="{top}padding:{pad_top}px 0 {pad_bottom}px 0;">'
            + _table(
                "<tr>"
                f'<td class="ao-kv" valign="top" style="{_text("small")}padding-right:12px;">'
                f"{esc(label)}</td>"
                f'<td class="ao-kv ao-kv-val" valign="top" align="right" '
                f'style="{_text("small", color=INK, weight=500)}text-align:right;'
                f'word-break:break-word;">{esc(value)}</td>'
                "</tr>"
            )
            + "</td></tr>"
        )
    return _row(_card("".join(parts)), space=space)


def message_card(label: object, body: object, *, space: int = 32) -> Html:
    """Çok satırlı serbest metin (iletişim mesajı, başvuru notu).

    Kullanıcı metni kaçışlanır; satır sonları ``white-space:pre-wrap`` ile
    korunur (``<br>`` üretmeye gerek kalmaz, kaçış sırası da basit kalır).
    """
    rows = (
        f'<tr><td style="{_text("small")}padding-bottom:8px;">{esc(label)}</td></tr>'
        f'<tr><td style="{_text("small", color=INK)}white-space:pre-wrap;'
        f'word-break:break-word;">{esc(body)}</td></tr>'
    )
    return _row(_card(rows), space=space)


def progress_steps(labels: Sequence[str], current: int, *, space: int = 32) -> Html:
    """Adım çubuğu — Multi-step Progress 01 ``Steps`` (10px çubuk, 8px aralık).

    ``current`` 0 tabanlı etkin adımdır; öncekiler tamamlanmış sayılır.
    Tamamlanan/etkin çubuk lacivert, bekleyen gri.
    """
    cells: list[str] = []
    n = len(labels)
    for i, label in enumerate(labels):
        bar = INK if i <= current else LINE
        color = INK if i == current else (BODY if i < current else PENDING)
        pad_l = 0 if i == 0 else 4
        pad_r = 0 if i == n - 1 else 4
        cells.append(
            f'<td width="{100 // n}%" valign="top" style="padding:0 {pad_r}px 0 {pad_l}px;">'
            f'<div style="height:10px;line-height:10px;font-size:0;background:{bar};border-radius:8px;">&nbsp;</div>'
            f'<p style="{_text("caption", color=color, weight=600 if i == current else 400)}'
            f'padding-top:12px;">{esc(label)}</p></td>'
        )
    return _row(_table(f"<tr>{''.join(cells)}</tr>"), space=space)


def timeline(items: Iterable[tuple[object, object, bool]], *, space: int = 32) -> Html:
    """Durum listesi — Refund Processed 01 ``Column Items`` (nokta + başlık + açıklama).

    ``items``: (başlık, açıklama, etkin_mi). Etkin madde lacivert nokta taşır.
    """
    rows: list[str] = []
    items = list(items)
    for i, (title, body, active) in enumerate(items):
        dot = INK if active else PENDING
        pad = "0" if i == len(items) - 1 else "0 0 24px 0"
        rows.append(
            f'<tr><td style="padding:{pad};">'
            + _table(
                "<tr>"
                f'<td width="24" valign="top" style="width:24px;padding-top:7px;">'
                f'<div style="width:10px;height:10px;line-height:10px;font-size:0;border-radius:5px;'
                f'background:{dot};">&nbsp;</div></td>'
                f'<td valign="top"><p style="{_text("small", color=INK, weight=600)}">{esc(title)}</p>'
                f'<p style="{_text("small")}padding-top:4px;">{esc(body)}</p></td>'
                "</tr>"
            )
            + "</td></tr>"
        )
    return _row(_card("".join(rows)), space=space)


def social_icons() -> str:
    """Sosyal hesap ikonları — Figma ``Social Icons`` (20px, 16px aralık).

    HTTPS kök yoksa (yerel geliştirme) görsel yerine metin bağlantı yazılır.
    """
    base = _https_base()
    cells: list[str] = []
    for i, (name, url, key) in enumerate(SOCIAL_LINKS):
        pad = "0" if i == 0 else "0 0 0 16px"
        if base:
            inner = (
                f'<img src="{esc(base)}{_ASSET_DIR}/{key}.png" width="20" height="20" alt="{name}" '
                'style="display:block;border:0;outline:none;width:20px;height:20px;">'
            )
        else:
            inner = name
        cells.append(
            f'<td style="padding:{pad};{_text("caption", color=INK)}">'
            f'<a href="{esc(url)}" target="_blank" rel="noopener" '
            f'style="color:{INK};text-decoration:none;">{inner}</a></td>'
        )
    return _table(f"<tr>{''.join(cells)}</tr>", width="auto")


_PREHEADER_PAD = "&#8199;&#65279;&#847; " * 40

_BASE_CSS = """
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{-ms-interpolation-mode:bicubic;}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
@media only screen and (max-width:620px){
  .ao-outer{padding:16px 10px!important;}
  .ao-pad{padding:36px 24px!important;}
  .ao-h1{font-size:26px!important;line-height:32px!important;}
  .ao-p{font-size:16px!important;line-height:25px!important;}
  .ao-card-inner{padding:20px!important;}
  .ao-stack{display:block!important;width:100%!important;padding:0!important;}
  .ao-stack-last{padding-top:12px!important;}
  .ao-aside{padding-top:8px!important;text-align:left!important;}
  .ao-kv{display:block!important;width:100%!important;text-align:left!important;padding-right:0!important;}
}
""".strip()


def render(*, title: str, preheader: str, blocks: Sequence[str]) -> str:
    """Tam e-posta belgesi.

    ``preheader``: gelen kutusu önizlemesinde konu satırının yanında görünen
    metin; gövdede gizlidir. Arkasındaki dolgu, istemcinin önizlemeye gövde
    metnini eklemesini engeller.

    Footer, Password Reset 02 ``Bot Bar`` gibi kartın içinde: ince çizginin
    altında solda sosyal ikonlar, sağda © satırı (mobilde alt alta).
    """
    year = datetime.datetime.now(_TR_TZ).year
    footer = _row(
        f'<div style="height:1px;line-height:1px;font-size:0;background:{LINE};">&nbsp;</div>',
        space=28,
    ) + Html(
        "<tr><td>"
        + _table(
            f'<tr><td class="ao-stack" align="left" valign="middle">{social_icons()}</td>'
            f'<td class="ao-stack ao-aside" align="right" valign="middle" '
            f'style="{_text("caption")}">© {year} {BRAND}</td></tr>'
        )
        + "</td></tr>"
    )
    card = (
        f'<tr><td class="ao-pad" style="padding:{_PAD}px;">'
        f'{_table("".join(blocks) + _row("", space=16) + footer)}</td></tr>'
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
            + _table(
                f'<tr><td style="background:{CARD_BG};border-radius:32px;overflow:hidden;'
                'box-shadow:0 20px 24px rgba(85,108,135,0.06);">'
                f"{_table(card)}</td></tr>",
                extra=f' style="max-width:{CONTENT_WIDTH}px;margin:0 auto;"',
            )
            + "\n<!--[if mso]></td></tr></table><![endif]-->\n"
            "</td></tr>",
            extra=f' style="background:{PAGE_BG};"',
        )
        + "\n</body>\n</html>"
    )


def text_footer() -> str:
    """Düz metin gövdenin ortak kapanışı (HTML footer'ın karşılığı)."""
    return f"\n\n--\n{BRAND} · {site_url()}"
