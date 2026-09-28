"""E-posta şablonlarının ortak layout ve bileşenleri.

Görsel referans: BRIX "120+ Email templates" Figma dosyası (sayfa
``🎨 Email Templates``). Ölçüler (tipografi ölçeği, kart/düğme yarıçapları,
iç boşluklar, gölge) Figma'dan birebir alındı; yalnız birincil renk sitenin
marka token'larına (``frontend/src/index.css``) çevrildi. Hangi bileşenin
hangi frame'den geldiği her fonksiyonda yazar.

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
Şablon yazarı yalnız ``fmt``/``strong`` ile işaretleme üretir; ham string
bileşenlere verilirse metin olarak kaçışlanır.
"""
from __future__ import annotations

import datetime
import html as _html
from collections.abc import Iterable, Sequence

from core.config import settings

BRAND = "Adana Özel Ders"

# ── Renk token'ları ──
# Nötrler Figma'nın `Neutral Colors` ölçeğinden; birincil mavi (#2388FF) ve
# açık mavi kart zemini marka turuncusuna / sıcak zemine çevrildi
# (frontend/src/index.css `--marka*`, `--dikkat*`).
PAGE_BG = "#EEF2F9"  # Figma kanvasındaki açık zemin
CARD_BG = "#FFFFFF"
INK = "#19213D"  # Figma neutral-800 — başlık ve vurgulu değer
BODY = "#646B84"  # Figma neutral-600'ün (#6D758F) bir tık koyusu: sıcak zeminde de ≥ 4,5
SUBTLE_BG = "#F8FAFF"  # Figma neutral-200
LINE = "#E1E4ED"  # Figma neutral-400
MARKA = "#FF9900"  # dolgu — METİN OLARAK KULLANILMAZ (beyazda < 3)
MARKA_FG = "#2B1000"  # dolgu üstündeki yazı
MARKA_METIN = "#96430A"  # açık zeminde marka yazısı (beyazda 6,77)
MARKA_SOFT = "#FFF4E9"
MARKA_LINE = "#FDD9B5"
DIKKAT_SOFT = "#FFFBEC"  # Figma Security Alert 01 uyarı karosu
DIKKAT_LINE = "#FFEFB8"

FONT = "Figtree,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
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
    verisi olabilir ve kaçışlanır (``strong(...)`` gibi ``Html`` hariç).
    """
    return Html(template.format(**{k: esc(v) for k, v in values.items()}))


def strong(value: object) -> Html:
    return Html(f'<strong style="color:{INK};font-weight:600;">{esc(value)}</strong>')


def link(label: object, url: str) -> Html:
    return Html(
        f'<a href="{esc(url)}" style="color:{MARKA_METIN};font-weight:600;'
        f'text-decoration:none;">{esc(label)}</a>'
    )


def site_url(path: str = "") -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}{path}"


def now_tr() -> str:
    return datetime.datetime.now(_TR_TZ).strftime("%d.%m.%Y %H:%M")


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


def _row(inner: str, *, space: int = 24, align: str = "left") -> Html:
    return Html(
        f'<tr><td align="{align}" style="padding:0 0 {space}px 0;'
        f'text-align:{align};">{inner}</td></tr>'
    )


def _text_style(*, size: int, line: int, color: str, weight: int = 400) -> str:
    return (
        f"margin:0;font-family:{FONT};font-size:{size}px;line-height:{line}px;"
        f"color:{color};font-weight:{weight};"
    )


def _table(inner: str, *, width: str = "100%", extra: str = "") -> str:
    return (
        f'<table role="presentation" width="{width}" cellpadding="0" cellspacing="0" '
        f'border="0"{extra}>{inner}</table>'
    )


def logo(*, align: str = "center", aside: object | None = None) -> Html:
    """Şirket logotipi — Figma ``Company Logotype`` ("Replace Here") yuvası, 32px yükseklik.

    ``aside`` verilirse sağda ikincil metin durur (Password Reset 02'nin
    tarih şeridi / Multi-step Progress 01'in alan adı).
    """
    base = _https_base()
    if base:
        mark = (
            f'<img src="{esc(base)}/logo.png" width="203" height="32" alt="{BRAND}" '
            f'style="display:block;border:0;outline:none;text-decoration:none;'
            f'width:203px;height:auto;max-width:203px;">'
        )
    else:
        mark = (
            f'<span style="font-family:{FONT};font-size:24px;line-height:32px;'
            f'font-weight:600;color:{INK};">{BRAND}</span>'
        )
    if aside is None:
        if align == "center":
            mark = _table(
                f"<tr><td>{mark}</td></tr>", width="auto", extra=' align="center" style="margin:0 auto;"'
            )
        return _row(mark, space=52, align=align)
    return _row(
        _table(
            f'<tr><td align="left" valign="middle">{mark}</td>'
            f'<td align="right" valign="middle" style="{_text_style(size=16, line=24, color=BODY)}">'
            f"{esc(aside)}</td></tr>"
        ),
        space=52,
    )


def tag(text: object, *, align: str = "left") -> Html:
    """Küçük etiket — Multi-step Progress 01 ``Tag`` ("Step 3 of 4")."""
    return _row(
        _table(
            f'<tr><td style="background:{MARKA_SOFT};border:1px solid {MARKA_LINE};'
            f'border-radius:10px;padding:6px 10px;'
            f'{_text_style(size=15, line=22, color=MARKA_METIN, weight=600)}">{esc(text)}</td></tr>',
            width="auto",
            extra=f' align="{align}"' + (' style="margin:0 auto;"' if align == "center" else ""),
        ),
        space=16,
        align=align,
    )


def heading(text: object, *, align: str = "left", space: int = 20) -> Html:
    """Başlık — Figma ``Display/7/Bold`` (30/36, 600). Mobilde 26/32."""
    return _row(
        f'<h1 class="ao-h1" style="{_text_style(size=30, line=36, color=INK, weight=600)}">'
        f"{esc(text)}</h1>",
        space=space,
        align=align,
    )


def paragraph(
    content: object, *, align: str = "left", space: int = 32, size: int = 18, color: str = BODY
) -> Html:
    """Gövde metni — Figma ``Paragraph/Large/Regular`` (18/1.5). Mobilde 16/24."""
    cls = ' class="ao-p"' if size >= 18 else ""
    return _row(
        f'<p{cls} style="{_text_style(size=size, line=round(size * 1.5), color=color)}">'
        f"{esc(content)}</p>",
        space=space,
        align=align,
    )


def note(content: object, *, align: str = "left", space: int = 20) -> Html:
    """İkincil metin — Figma ``Paragraph/Medium/Regular`` (16/24)."""
    return paragraph(content, align=align, space=space, size=16)


def divider(*, space: int = 32) -> Html:
    return _row(
        f'<div style="height:1px;line-height:1px;font-size:0;background:{LINE};">&nbsp;</div>',
        space=space,
    )


_BUTTON_VARIANTS = {
    # (zemin, yazı, kenarlık) — Figma ``Buttons`` bileşeninin üç türü
    "primary": (MARKA, MARKA_FG, MARKA),
    "dark": (INK, "#FFFFFF", INK),
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
    html_btn = (
        "<!--[if !mso]><!-->"
        f'<a class="ao-btn" href="{safe_url}" target="_blank" rel="noopener" '
        f'style="display:block;background:{bg};border:1px solid {border};'
        f"border-radius:{_BUTTON_RADIUS}px;font-family:{FONT};font-size:18px;line-height:24px;"
        f'font-weight:600;color:{fg};text-decoration:none;text-align:center;'
        f"padding:{(_BUTTON_H - 26) // 2}px 24px;"
        f'box-shadow:0 7px 8px rgba(85,108,135,0.07);mso-hide:all;">{safe_label}</a>'
        "<!--<![endif]-->"
    )
    return vml + html_btn


def button(label: object, url: str, *, variant: str = "primary", space: int = 32) -> Html:
    """Tam genişlik düğme — Figma ``Buttons`` (18199:1780): 62px, yarıçap 16, 600."""
    return _row(
        _table(f"<tr><td>{_button_cell(label, url, variant=variant)}</td></tr>"),
        space=space,
    )


def button_pair(
    primary: tuple[object, str], secondary: tuple[object, str], *, space: int = 32,
    primary_variant: str = "dark",
) -> Html:
    """Yan yana iki düğme — Security Alert 01 ``Button Set`` (16px aralık). Mobilde alt alta."""
    half = (_INNER - 16) // 2
    left = _button_cell(primary[0], primary[1], variant=primary_variant, vml_width=half)
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


def fallback_link(url: str, *, align: str = "left") -> Html:
    """Düğme açılmazsa kopyalanacak ham bağlantı (bazı kurumsal istemciler
    düğmeyi kırpar; bağlantı tokensiz kalmasın)."""
    return paragraph(
        fmt(
            "Düğme çalışmazsa bu bağlantıyı tarayıcına yapıştır:<br>"
            '<a href="{url}" style="color:{c};word-break:break-all;text-decoration:none;">{url}</a>',
            url=url,
            c=MARKA_METIN,
        ),
        size=14,
        space=0,
        align=align,
    )


def _card(
    inner_rows: str, *, bg: str, border: str, padding: str = "32px 36px", radius: int = 24
) -> str:
    return _table(
        f'<tr><td class="ao-card-inner" style="padding:{padding};">{_table(inner_rows)}</td></tr>',
        extra=(
            f' style="background:{bg};border:1px solid {border};border-radius:{radius}px;'
            'border-collapse:separate;"'
        ),
    )


def highlight_card(
    title: object, subtitle: object | None = None, *, tone: str = "brand", space: int = 32
) -> Html:
    """Öne çıkan kart — Order Confirmation 01 ``Inner Card`` (36px dolgu, yarıçap 16).

    ``tone="brand"`` sıcak marka zemini (Figma'daki yeşil başarı kartının
    karşılığı; durum rengi rozete kilitli olduğu için yeşil kullanılmadı),
    ``tone="neutral"`` gri kart.
    """
    bg, border = (MARKA_SOFT, MARKA_LINE) if tone == "brand" else (SUBTLE_BG, LINE)
    rows = f'<tr><td style="{_text_style(size=20, line=27, color=INK, weight=600)}">{esc(title)}</td></tr>'
    if subtitle is not None:
        rows += (
            f'<tr><td style="padding-top:12px;{_text_style(size=18, line=28, color=BODY, weight=500)}">'
            f"{esc(subtitle)}</td></tr>"
        )
    return _row(_card(rows, bg=bg, border=border, padding="36px", radius=16), space=space)


def info_card(rows: Sequence[tuple[object, object]], *, space: int = 32) -> Html:
    """Etiket–değer listesi — Security Alert 01 ``Inner Card`` (Date / IP Address).

    Satırlar arasında ince çizgi, 24px ritim. Uzun değer (e-posta, IBAN) mobilde
    alt satıra kırılabilsin diye ``word-break`` açıktır.
    """
    parts: list[str] = []
    last = len(rows) - 1
    for i, (label, value) in enumerate(rows):
        top = "" if i == 0 else f"border-top:1px solid {LINE};"
        pad_top = 0 if i == 0 else 20
        pad_bottom = 0 if i == last else 20
        parts.append(
            f'<tr><td style="{top}padding:{pad_top}px 0 {pad_bottom}px 0;">'
            + _table(
                "<tr>"
                f'<td class="ao-kv" valign="top" style="{_text_style(size=18, line=28, color=BODY)}'
                f'padding-right:12px;">{esc(label)}</td>'
                f'<td class="ao-kv ao-kv-val" valign="top" align="right" '
                f'style="{_text_style(size=18, line=28, color=INK, weight=500)}'
                f'text-align:right;word-break:break-word;">{esc(value)}</td>'
                "</tr>"
            )
            + "</td></tr>"
        )
    return _row(_card("".join(parts), bg=SUBTLE_BG, border=LINE, padding="32px 42px"), space=space)


def message_card(label: object, body: object, *, space: int = 32) -> Html:
    """Çok satırlı serbest metin (iletişim mesajı, başvuru notu).

    Kullanıcı metni kaçışlanır; satır sonları ``white-space:pre-wrap`` ile
    korunur (``<br>`` üretmeye gerek kalmaz, kaçış sırası da basit kalır).
    """
    rows = (
        f'<tr><td style="{_text_style(size=14, line=20, color=BODY, weight=600)}'
        f'text-transform:uppercase;letter-spacing:.05em;padding-bottom:12px;">{esc(label)}</td></tr>'
        f'<tr><td style="{_text_style(size=17, line=27, color=INK)}white-space:pre-wrap;'
        f'word-break:break-word;">{esc(body)}</td></tr>'
    )
    return _row(_card(rows, bg=SUBTLE_BG, border=LINE), space=space)


def alert_header(icon: str, title: object, body: object, *, space: int = 32) -> Html:
    """Uyarı başlığı — Security Alert 01 (56px ⚠️ karo + başlık + açıklama, 16px aralık).

    Karo "dikkat" paletinden: açık zemin + koyu içerik (docs/tasarim-dili.md
    §1.3 madde 2 — uyarı asla dolgulu değildir). ``icon`` bir emoji; görsel
    dosyası yok, bu yüzden görsel engellendiğinde de görünür.
    """
    tile = _table(
        f'<tr><td width="56" height="56" align="center" valign="middle" style="width:56px;height:56px;'
        f'background:{DIKKAT_SOFT};border:1px solid {DIKKAT_LINE};border-radius:8px;'
        f'font-size:28px;line-height:56px;" aria-hidden="true">{icon}</td></tr>',
        width="auto",
    )
    return _row(
        _table(
            f'<tr><td class="ao-alert-icon" width="72" valign="top" style="width:72px;">{tile}</td>'
            '<td valign="top">'
            f'<h1 class="ao-h1" style="{_text_style(size=30, line=36, color=INK, weight=600)}">{esc(title)}</h1>'
            f'<p class="ao-p" style="{_text_style(size=18, line=28, color=BODY)}padding-top:12px;">'
            f"{esc(body)}</p>"
            "</td></tr>"
        ),
        space=space,
    )


def progress_steps(labels: Sequence[str], current: int, *, space: int = 36) -> Html:
    """Adım çubuğu — Multi-step Progress 01 ``Steps`` (10px çubuk, 8px aralık, 14px etiket).

    ``current`` 0 tabanlı etkin adımdır; öncekiler tamamlanmış sayılır.
    Tamamlanan/etkin çubuk marka dolgusu, bekleyen gri. Etiket rengi metin
    kontrastını korumak için dolgu değil ``MARKA_METIN``/lacivert.
    """
    cells: list[str] = []
    n = len(labels)
    for i, label in enumerate(labels):
        done = i <= current
        bar = MARKA if done else LINE
        if i == current:
            color = INK
        elif done:
            color = MARKA_METIN
        else:
            color = "#8A91A8"
        pad_l = 0 if i == 0 else 4
        pad_r = 0 if i == n - 1 else 4
        cells.append(
            f'<td width="{100 // n}%" valign="top" style="padding:0 {pad_r}px 0 {pad_l}px;">'
            f'<div style="height:10px;line-height:10px;font-size:0;background:{bar};border-radius:8px;">&nbsp;</div>'
            f'<p style="{_text_style(size=14, line=18, color=color, weight=600)}padding-top:14px;'
            f'text-align:center;">{esc(label)}</p></td>'
        )
    return _row(_table(f"<tr>{''.join(cells)}</tr>"), space=space)


def amount(text: object, *, align: str = "center", space: int = 0) -> Html:
    """Büyük tutar — Refund Processed 01 ``Display/10/Bold`` (60/66). Mobilde 42."""
    return _row(
        f'<p class="ao-amount" style="{_text_style(size=60, line=66, color=MARKA_METIN, weight=600)}'
        f'letter-spacing:-0.01em;">{esc(text)}</p>',
        space=space,
        align=align,
    )


def timeline(items: Iterable[tuple[object, object, bool]], *, space: int = 36) -> Html:
    """Durum listesi — Refund Processed 01 ``Column Items`` (nokta + başlık + açıklama, 42px ritim).

    ``items``: (başlık, açıklama, etkin_mi). Etkin madde marka noktası taşır.
    """
    rows: list[str] = []
    items = list(items)
    for i, (title, body, active) in enumerate(items):
        dot = MARKA if active else "#A8AEC3"
        pad = "0" if i == len(items) - 1 else "0 0 32px 0"
        rows.append(
            f'<tr><td style="padding:{pad};">'
            + _table(
                "<tr>"
                f'<td width="28" valign="top" style="width:28px;padding-top:9px;">'
                f'<div style="width:10px;height:10px;line-height:10px;font-size:0;border-radius:5px;'
                f'background:{dot};">&nbsp;</div></td>'
                f'<td valign="top"><p style="{_text_style(size=20, line=27, color=INK, weight=600)}">{esc(title)}</p>'
                f'<p style="{_text_style(size=16, line=25, color=BODY)}padding-top:10px;">{esc(body)}</p></td>'
                "</tr>"
            )
            + "</td></tr>"
        )
    return _row(_card("".join(rows), bg=SUBTLE_BG, border=LINE, padding="36px"), space=space)


_PREHEADER_PAD = "&#8199;&#65279;&#847; " * 40

_BASE_CSS = """
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{-ms-interpolation-mode:bicubic;}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
@media only screen and (max-width:620px){
  .ao-outer{padding:16px 10px!important;}
  .ao-pad{padding:36px 24px!important;}
  .ao-hero{padding:40px 24px 32px 24px!important;}
  .ao-h1{font-size:26px!important;line-height:32px!important;}
  .ao-p{font-size:16px!important;line-height:25px!important;}
  .ao-amount{font-size:42px!important;line-height:48px!important;}
  .ao-card-inner{padding:24px 20px!important;}
  .ao-btn{font-size:17px!important;}
  .ao-alert-icon{display:block!important;width:100%!important;padding-bottom:16px!important;}
  .ao-stack{display:block!important;width:100%!important;padding:0!important;}
  .ao-stack-last{padding-top:12px!important;}
  .ao-kv{display:block!important;width:100%!important;text-align:left!important;padding-right:0!important;}
}
""".strip()


def render(
    *,
    title: str,
    preheader: str,
    blocks: Sequence[str],
    footer_reason: str,
    hero: Sequence[str] | None = None,
    accent_bar: bool = False,
) -> str:
    """Tam e-posta belgesi.

    - ``preheader``: gelen kutusu önizlemesinde konu satırının yanında görünen
      metin; gövdede gizlidir. Arkasındaki dolgu, istemcinin önizlemeye gövde
      metnini eklemesini engeller.
    - ``hero``: kartın üstünde sıcak zeminli bölge (Refund Processed 01
      ``Top Card``). Verilirse logo oraya girer.
    - ``accent_bar``: kartın tepesinde marka şeridi (Order Confirmation 01'in
      32px üst kenarlığı; e-postada 12px).
    - ``footer_reason``: "Bu e-postayı … aldın." cümlesi — alıcının mesajı
      neden aldığını bilmesi spam şikâyetini azaltır.

    Footer, Figma'daki gibi kartın içinde ve ortalıdır (© satırı; adres satırı
    yerine gönderim sebebi + site bağlantısı).
    """
    year = datetime.datetime.now(_TR_TZ).year
    site = site_url()
    site_host = site.split("://", 1)[-1].split("/", 1)[0]
    footer = (
        f'<tr><td align="center" style="padding-top:14px;text-align:center;">'
        f'<p style="{_text_style(size=16, line=24, color=BODY)}">© {year} {BRAND} '
        f'<span style="color:{LINE};">|</span> Tüm hakları saklıdır</p>'
        f'<p style="{_text_style(size=13, line=20, color=BODY)}padding-top:10px;">{esc(footer_reason)} '
        f'<a href="{esc(site)}" style="color:{BODY};text-decoration:underline;">{esc(site_host)}</a></p>'
        "</td></tr>"
    )
    card_rows = ""
    if accent_bar:
        card_rows += (
            f'<tr><td style="background:{MARKA};height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>'
        )
    if hero:
        card_rows += (
            f'<tr><td class="ao-hero" style="background:{MARKA_SOFT};border-bottom:1px solid {MARKA_LINE};'
            f'padding:{_PAD}px {_PAD}px 42px {_PAD}px;">{_table("".join(hero))}</td></tr>'
        )
    top_pad = 42 if hero else (_PAD + 12 if accent_bar else _PAD)
    card_rows += (
        f'<tr><td class="ao-pad" style="padding:{top_pad}px {_PAD}px {_PAD}px {_PAD}px;">'
        f'{_table("".join(blocks) + _row("", space=32) + footer)}</td></tr>'
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
                f"{_table(card_rows)}</td></tr>",
                extra=f' style="max-width:{CONTENT_WIDTH}px;margin:0 auto;"',
            )
            + "\n<!--[if mso]></td></tr></table><![endif]-->\n"
            "</td></tr>",
            extra=f' style="background:{PAGE_BG};"',
        )
        + "\n</body>\n</html>"
    )


def text_footer(reason: str) -> str:
    """Düz metin gövdenin ortak kapanışı (HTML footer'ın karşılığı)."""
    return f"\n\n--\n{BRAND} · {site_url()}\n{reason}"
