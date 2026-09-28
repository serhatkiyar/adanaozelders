"""E-posta şablonlarının ortak layout ve bileşenleri.

Görsel referans: BRIX "120+ Email templates" Figma dosyası (sayfa
``🎨 Email Templates``). Frame'ler birebir kopyalanmadı; kart/ızgara/tipografi
ritmi alındı, renkler sitenin marka token'larına (``frontend/src/index.css``)
çevrildi. Hangi bileşenin hangi frame'den geldiği her fonksiyonda yazar.

E-posta istemcisi kısıtları bilerek uygulanır:

- Yerleşim ``<table role="presentation">`` ile kurulur; Outlook (Word motoru)
  ``div`` dolgusunu ve flex/grid'i tanımaz.
- Tüm stiller inline'dır. ``<style>`` bloğu yalnız mobil daraltma içindir ve
  desteklemeyen istemcide (Gmail uygulamasının bazı hesapları) masaüstü
  yerleşimi zaten 600px'e kadar akışkandır.
- Düğmeler "bulletproof"tur: Outlook için VML ``roundrect``, diğerleri için
  dolgulu ``<a>``.
- Görseller yalnız mutlak HTTPS adresinden yüklenir (bkz. ``_logo_url``);
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
# Kaynak: frontend/src/index.css (`--marka*`, `--dikkat*`) ve logo laciverti.
# Figma'daki mavi birincil (#2388FF) → marka dolgusu; lacivert başlık
# (#19213D) → logo laciverti; açık mavi kart zemini → sıcak marka zemini.
PAGE_BG = "#F1F5F9"
CARD_BG = "#FFFFFF"
INK = "#1A365D"  # başlık + logo laciverti
BODY = "#475569"  # gövde metni (beyazda 7,6)
MUTED = "#64748B"  # ikincil metin (beyazda 4,8)
SUBTLE_BG = "#F8FAFC"
LINE = "#E2E8F0"
MARKA = "#FF9900"  # dolgu — METİN OLARAK KULLANILMAZ (beyazda < 3)
MARKA_FG = "#2B1000"  # dolgu üstündeki yazı
MARKA_METIN = "#96430A"  # açık zeminde marka yazısı (beyazda 6,77)
MARKA_SOFT = "#FFF4E9"
MARKA_LINE = "#FDD9B5"
DIKKAT_SOFT = "#FEF3C7"
DIKKAT_LINE = "#FDE68A"

FONT = "Figtree,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
CONTENT_WIDTH = 600

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
        f'text-decoration:underline;">{esc(label)}</a>'
    )


def site_url(path: str = "") -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}{path}"


def now_tr() -> str:
    return datetime.datetime.now(_TR_TZ).strftime("%d.%m.%Y %H:%M")


def _logo_url() -> str | None:
    """Logo yalnız HTTPS kökten sunulur.

    E-posta istemcileri göreli yolu çözemez; Gmail/Apple Mail HTTP görseli ya
    engeller ya da "güvensiz içerik" uyarısı gösterir. Yerel geliştirmede
    (``http://localhost``) bu yüzden metin logo kullanılır.
    """
    base = settings.FRONTEND_BASE_URL.strip().rstrip("/")
    if not base.lower().startswith("https://"):
        return None
    return f"{base}/logo.png"


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


def logo(*, align: str = "center", aside: object | None = None) -> Html:
    """Şirket logotipi — Figma ``Company Logotype`` ("Replace Here") yuvası.

    ``aside`` verilirse sağda ikincil metin durur (Password Reset 02'nin
    tarih şeridi / Multi-step Progress 01'in alan adı).
    """
    url = _logo_url()
    if url:
        mark = (
            f'<img src="{esc(url)}" width="190" height="30" alt="{BRAND}" '
            f'style="display:block;border:0;outline:none;text-decoration:none;'
            f'width:190px;height:auto;max-width:190px;">'
        )
    else:
        mark = (
            f'<span style="font-family:{FONT};font-size:22px;line-height:30px;'
            f'font-weight:600;color:{INK};">{BRAND}</span>'
        )
    if aside is None:
        if align == "center":
            mark = (
                '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
                f'align="center" style="margin:0 auto;"><tr><td>{mark}</td></tr></table>'
            )
        return _row(mark, space=40, align=align)
    return _row(
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f'<tr><td align="left" valign="middle">{mark}</td>'
        f'<td align="right" valign="middle" style="{_text_style(size=14, line=20, color=MUTED)}">'
        f"{esc(aside)}</td></tr></table>",
        space=40,
    )


def tag(text: object, *, align: str = "left") -> Html:
    """Küçük hap etiket — Multi-step Progress 01 ``Tag`` ("Step 3 of 4")."""
    return _row(
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'align="{align}" style="margin:0{" auto" if align == "center" else ""};">'
        f'<tr><td style="background:{MARKA_SOFT};border:1px solid {MARKA_LINE};'
        f'border-radius:8px;padding:6px 10px;{_text_style(size=13, line=18, color=MARKA_METIN, weight=600)}">'
        f"{esc(text)}</td></tr></table>",
        space=16,
        align=align,
    )


def heading(text: object, *, align: str = "left", space: int = 16) -> Html:
    """Başlık — Figma ``Display/7/Bold`` (30/36). Mobilde 24/30'a iner."""
    return _row(
        f'<h1 class="ao-h1" style="{_text_style(size=28, line=36, color=INK, weight=600)}">'
        f"{esc(text)}</h1>",
        space=space,
        align=align,
    )


def paragraph(
    content: object, *, align: str = "left", space: int = 24, size: int = 16, color: str = BODY
) -> Html:
    """Gövde metni — Figma ``Paragraph/Large/Regular`` (18/1.5), e-postada 16/26."""
    line = 26 if size >= 16 else 22
    return _row(
        f'<p style="{_text_style(size=size, line=line, color=color)}">{esc(content)}</p>',
        space=space,
        align=align,
    )


def note(content: object, *, align: str = "left", space: int = 16) -> Html:
    return paragraph(content, align=align, space=space, size=14, color=MUTED)


def divider(*, space: int = 24) -> Html:
    return _row(
        f'<div style="height:1px;line-height:1px;font-size:0;background:{LINE};">&nbsp;</div>',
        space=space,
    )


_BUTTON_VARIANTS = {
    # (zemin, yazı, kenarlık)
    "primary": (MARKA, MARKA_FG, MARKA),
    "dark": (INK, "#FFFFFF", INK),
    "secondary": (SUBTLE_BG, INK, LINE),
}


def _button_cell(label: object, url: str, *, variant: str, height: int = 52) -> str:
    bg, fg, border = _BUTTON_VARIANTS[variant]
    safe_url = esc(url)
    safe_label = esc(label)
    # Outlook masaüstü: VML roundrect, genişlik tam satır (%100 desteklenmez →
    # 504px = 600 − 2×48 dolgu).
    vml = (
        "<!--[if mso]>"
        '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:w="urn:schemas-microsoft-com:office:word" '
        f'href="{safe_url}" style="height:{height}px;v-text-anchor:middle;width:504px;" '
        f'arcsize="24%" strokecolor="{border}" fillcolor="{bg}">'
        "<w:anchorlock/>"
        f'<center style="color:{fg};font-family:Arial,sans-serif;font-size:16px;'
        f'font-weight:bold;">{safe_label}</center>'
        "</v:roundrect><![endif]-->"
    )
    html_btn = (
        "<!--[if !mso]><!-->"
        f'<a href="{safe_url}" target="_blank" rel="noopener" '
        f'style="display:block;background:{bg};border:1px solid {border};border-radius:12px;'
        f"font-family:{FONT};font-size:16px;line-height:20px;font-weight:600;color:{fg};"
        f'text-decoration:none;text-align:center;padding:{(height - 22) // 2}px 24px;'
        f'mso-hide:all;">{safe_label}</a>'
        "<!--<![endif]-->"
    )
    return vml + html_btn


def button(label: object, url: str, *, variant: str = "primary", space: int = 24) -> Html:
    """Tam genişlik düğme — Figma ``Buttons`` bileşeni (18199:1780), yükseklik 62→52."""
    return _row(
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f'<tr><td class="ao-btn">{_button_cell(label, url, variant=variant)}</td></tr></table>',
        space=space,
    )


def button_pair(
    primary: tuple[object, str], secondary: tuple[object, str], *, space: int = 24,
    primary_variant: str = "dark",
) -> Html:
    """Yan yana iki düğme — Security Alert 01 ``Button Set``. Mobilde alt alta."""
    left = _button_cell(primary[0], primary[1], variant=primary_variant)
    right = _button_cell(secondary[0], secondary[1], variant="secondary")
    # VML genişliği iki sütunda yarıya iner.
    left = left.replace("width:504px", "width:244px")
    right = right.replace("width:504px", "width:244px")
    return _row(
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        '<tr>'
        f'<td class="ao-stack" width="50%" valign="top" style="padding:0 8px 0 0;">{left}</td>'
        f'<td class="ao-stack ao-stack-last" width="50%" valign="top" style="padding:0 0 0 8px;">{right}</td>'
        "</tr></table>",
        space=space,
    )


def fallback_link(url: str) -> Html:
    """Düğme açılmazsa kopyalanacak ham bağlantı (bazı kurumsal istemciler
    düğmeyi kırpar; bağlantı tokensiz kalmasın)."""
    return note(
        fmt(
            'Düğme çalışmazsa bu bağlantıyı tarayıcına yapıştır:<br>'
            '<a href="{url}" style="color:{c};word-break:break-all;">{url}</a>',
            url=url,
            c=MARKA_METIN,
        ),
        space=0,
    )


def _card(inner_rows: str, *, bg: str, border: str, padding: str = "24px 28px") -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background:{bg};border:1px solid {border};border-radius:16px;border-collapse:separate;">'
        f'<tr><td class="ao-card-inner" style="padding:{padding};">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f"{inner_rows}</table></td></tr></table>"
    )


def highlight_card(
    title: object, subtitle: object | None = None, *, tone: str = "brand", space: int = 24
) -> Html:
    """Öne çıkan kart — Order Confirmation 01 ``Inner Card``.

    ``tone="brand"`` sıcak marka zemini (Figma'daki yeşil başarı kartının
    karşılığı; durum rengi rozete kilitli olduğu için yeşil kullanılmadı),
    ``tone="neutral"`` gri kart.
    """
    bg, border = (MARKA_SOFT, MARKA_LINE) if tone == "brand" else (SUBTLE_BG, LINE)
    rows = (
        f'<tr><td style="{_text_style(size=18, line=26, color=INK, weight=600)}">{esc(title)}</td></tr>'
    )
    if subtitle is not None:
        rows += (
            f'<tr><td style="padding-top:6px;{_text_style(size=15, line=22, color=BODY)}">'
            f"{esc(subtitle)}</td></tr>"
        )
    return _row(_card(rows, bg=bg, border=border), space=space)


def info_card(rows: Sequence[tuple[object, object]], *, space: int = 24) -> Html:
    """Etiket–değer listesi — Security Alert 01 ``Inner Card`` (Date / IP Address).

    Satırlar arasında ince çizgi. Değer sağa yaslanır ama uzun değer (e-posta,
    IBAN) mobilde alt satıra kırılabilsin diye ``word-break`` açıktır.
    """
    parts: list[str] = []
    for i, (label, value) in enumerate(rows):
        top = "" if i == 0 else f"border-top:1px solid {LINE};"
        pad = "0 0 12px 0" if i == 0 else ("12px 0 0 0" if i == len(rows) - 1 else "12px 0")
        if len(rows) == 1:
            pad = "0"
        parts.append(
            f'<tr><td style="{top}padding:{pad};">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td class="ao-kv" valign="top" style="{_text_style(size=15, line=22, color=MUTED)}padding-right:12px;">'
            f"{esc(label)}</td>"
            f'<td class="ao-kv ao-kv-val" valign="top" align="right" style="{_text_style(size=15, line=22, color=INK, weight=600)}'
            f'text-align:right;word-break:break-word;">{esc(value)}</td>'
            "</tr></table></td></tr>"
        )
    return _row(_card("".join(parts), bg=SUBTLE_BG, border=LINE), space=space)


def message_card(label: object, body: object, *, space: int = 24) -> Html:
    """Çok satırlı serbest metin (iletişim mesajı, başvuru notu).

    Kullanıcı metni kaçışlanır; satır sonları ``white-space:pre-wrap`` ile
    korunur (``<br>`` üretmeye gerek kalmaz, kaçış sırası da basit kalır).
    """
    rows = (
        f'<tr><td style="{_text_style(size=13, line=18, color=MUTED, weight=600)}'
        f'text-transform:uppercase;letter-spacing:.04em;padding-bottom:8px;">{esc(label)}</td></tr>'
        f'<tr><td style="{_text_style(size=15, line=24, color=INK)}white-space:pre-wrap;'
        f'word-break:break-word;">{esc(body)}</td></tr>'
    )
    return _row(_card(rows, bg=SUBTLE_BG, border=LINE), space=space)


def alert_header(icon: str, title: object, body: object, *, space: int = 24) -> Html:
    """Uyarı başlığı — Security Alert 01 (⚠️ karo + başlık + açıklama).

    Karo "dikkat" paletinden: açık zemin + koyu metin (docs/tasarim-dili.md
    §1.3 madde 2 — uyarı asla dolgulu değildir). ``icon`` bir emoji; görsel
    dosyası yok, bu yüzden görsel engellendiğinde de görünür.
    """
    tile = (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td width="52" height="52" align="center" valign="middle" style="width:52px;height:52px;'
        f'background:{DIKKAT_SOFT};border:1px solid {DIKKAT_LINE};border-radius:12px;'
        f'font-size:26px;line-height:52px;" aria-hidden="true">{icon}</td></tr></table>'
    )
    return _row(
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td width="68" valign="top" style="width:68px;padding-top:2px;">{tile}</td>'
        '<td valign="top">'
        f'<h1 class="ao-h1" style="{_text_style(size=26, line=32, color=INK, weight=600)}">{esc(title)}</h1>'
        f'<p style="{_text_style(size=16, line=26, color=BODY)}padding-top:8px;margin:0;">{esc(body)}</p>'
        "</td></tr></table>",
        space=space,
    )


def progress_steps(labels: Sequence[str], current: int, *, space: int = 28) -> Html:
    """Adım çubuğu — Multi-step Progress 01 ``Steps``.

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
            color, weight = INK, 600
        elif done:
            color, weight = MARKA_METIN, 600
        else:
            color, weight = MUTED, 400
        pad_l = 0 if i == 0 else 4
        pad_r = 0 if i == n - 1 else 4
        cells.append(
            f'<td width="{100 // n}%" valign="top" style="padding:0 {pad_r}px 0 {pad_l}px;">'
            f'<div style="height:8px;line-height:8px;font-size:0;background:{bar};border-radius:8px;">&nbsp;</div>'
            f'<p style="{_text_style(size=13, line=18, color=color, weight=weight)}padding-top:10px;'
            f'text-align:center;">{esc(label)}</p></td>'
        )
    return _row(
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f"<tr>{''.join(cells)}</tr></table>",
        space=space,
    )


def amount(text: object, *, align: str = "center", space: int = 0) -> Html:
    """Büyük tutar — Refund Processed 01 (``Display/10/Bold``, 60px → 44px)."""
    return _row(
        f'<p class="ao-amount" style="{_text_style(size=44, line=52, color=MARKA_METIN, weight=600)}">'
        f"{esc(text)}</p>",
        space=space,
        align=align,
    )


def timeline(items: Iterable[tuple[object, object, bool]], *, space: int = 24) -> Html:
    """Durum listesi — Refund Processed 01 ``Column Items`` (renkli nokta + başlık + açıklama).

    ``items``: (başlık, açıklama, etkin_mi). Etkin madde marka noktası taşır.
    """
    rows: list[str] = []
    items = list(items)
    for i, (title, body, active) in enumerate(items):
        dot = MARKA if active else "#CBD5E1"
        pad = "0" if i == len(items) - 1 else "0 0 20px 0"
        rows.append(
            f'<tr><td style="padding:{pad};">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td width="22" valign="top" style="width:22px;padding-top:7px;">'
            f'<div style="width:10px;height:10px;line-height:10px;font-size:0;border-radius:5px;'
            f'background:{dot};">&nbsp;</div></td>'
            f'<td valign="top"><p style="{_text_style(size=17, line=26, color=INK, weight=600)}">{esc(title)}</p>'
            f'<p style="{_text_style(size=15, line=22, color=BODY)}padding-top:4px;">{esc(body)}</p></td>'
            "</tr></table></td></tr>"
        )
    return _row(_card("".join(rows), bg=SUBTLE_BG, border=LINE), space=space)


_PREHEADER_PAD = "&#8199;&#65279;&#847; " * 40

_RESPONSIVE_CSS = """
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{-ms-interpolation-mode:bicubic;}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
@media only screen and (max-width:620px){
  .ao-outer{padding:16px 8px!important;}
  .ao-pad{padding:32px 22px!important;}
  .ao-h1{font-size:24px!important;line-height:30px!important;}
  .ao-amount{font-size:36px!important;line-height:44px!important;}
  .ao-card-inner{padding:20px!important;}
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
      32px üst kenarlığı; e-postada 8px).
    - ``footer_reason``: "Bu e-postayı … aldın." cümlesi — alıcının mesajı
      neden aldığını bilmesi spam şikâyetini azaltır.
    """
    year = datetime.datetime.now(_TR_TZ).year
    body_rows = "".join(blocks)
    card_rows = ""
    if accent_bar:
        card_rows += (
            f'<tr><td style="background:{MARKA};height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>'
        )
    if hero:
        card_rows += (
            f'<tr><td class="ao-pad" style="background:{MARKA_SOFT};border-bottom:1px solid {MARKA_LINE};'
            'padding:48px 48px 36px 48px;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
            f"{''.join(hero)}</table></td></tr>"
        )
    card_rows += (
        '<tr><td class="ao-pad" style="padding:48px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f"{body_rows}</table></td></tr>"
    )
    site = site_url()
    footer = (
        f'<p style="{_text_style(size=13, line=20, color=MUTED)}">{esc(footer_reason)}</p>'
        f'<p style="{_text_style(size=13, line=20, color=MUTED)}padding-top:8px;">'
        f'<a href="{esc(site)}" style="color:{MUTED};text-decoration:underline;">{BRAND}</a>'
        f' &nbsp;·&nbsp; <a href="{esc(site_url("/iletisim"))}" '
        f'style="color:{MUTED};text-decoration:underline;">İletişim</a></p>'
        f'<p style="{_text_style(size=13, line=20, color=MUTED)}padding-top:8px;">'
        f"© {year} {BRAND} · Tüm hakları saklıdır</p>"
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
        f"<style>\n{_RESPONSIVE_CSS}\n</style>\n"
        "</head>\n"
        f'<body style="margin:0;padding:0;width:100%;background:{PAGE_BG};">\n'
        f'<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;'
        f'mso-hide:all;font-size:1px;line-height:1px;color:{PAGE_BG};">'
        f"{esc(preheader)}{_PREHEADER_PAD}</div>\n"
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background:{PAGE_BG};">\n'
        '<tr><td class="ao-outer" align="center" style="padding:32px 12px;">\n'
        f'<!--[if mso]><table role="presentation" width="{CONTENT_WIDTH}" cellpadding="0" '
        'cellspacing="0" border="0"><tr><td><![endif]-->\n'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="max-width:{CONTENT_WIDTH}px;margin:0 auto;">\n'
        f'<tr><td style="background:{CARD_BG};border-radius:24px;overflow:hidden;'
        'border:1px solid #E2E8F0;">\n'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f"{card_rows}</table>\n"
        "</td></tr>\n"
        f'<tr><td align="center" style="padding:24px 24px 0 24px;text-align:center;">{footer}</td></tr>\n'
        "</table>\n"
        "<!--[if mso]></td></tr></table><![endif]-->\n"
        "</td></tr>\n"
        "</table>\n"
        "</body>\n"
        "</html>"
    )


def text_footer(reason: str) -> str:
    """Düz metin gövdenin ortak kapanışı (HTML footer'ın karşılığı)."""
    return f"\n\n--\n{BRAND} · {site_url()}\n{reason}"
