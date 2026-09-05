"""Editör HTML'inin allowlist tabanlı temizliği — TEK KAYNAK.

XSS sınırı burasıdır: sanitize edilmiş HTML public tarafta
`dangerouslySetInnerHTML` ile basılır ve DB'ye ham HTML asla yazılmaz. Temizlik
OKUMA anında değil KAYDETME anında yapılır — okuma yolu sıcak, yazma yolu
nadirdir ve temizlik bir kez yapılınca kolondaki veri her tüketici için
güvenlidir.

Modül `services/blog_service.py`den çıkarıldı: aynı temizlik artık ürün
açıklamasında da gerekiyor ve iki ayrı allowlist tutmak, birinin gevşemesiyle
sonuçlanırdı. Ürün açıklaması ayrıca EĞİTMEN tarafından da yazılabildiği için
(dijital ürün) yüzey blogdan geniştir; tek ve dar bir allowlist bu yüzden daha
da önemli.
"""
from __future__ import annotations

import re

import nh3

#: TipTap StarterKit çıktısının karşılığı — allowlist DIŞI her şey atılır.
#: `script`, `iframe`, `style`, on* öznitelikleri ve javascript: şeması nh3'ün
#: varsayılan davranışıyla zaten temizlenir; burada kapsamı daha da daraltıyoruz.
_ALLOWED_TAGS = {
    "p", "br", "hr",
    "h2", "h3", "h4",
    "strong", "em", "s", "u", "mark",
    "a", "ul", "ol", "li",
    "blockquote", "code", "pre",
    "img", "figure", "figcaption",
    "table", "thead", "tbody", "tr", "th", "td",
}
_ALLOWED_ATTRIBUTES = {
    "a": {"href", "title"},
    "img": {"src", "alt", "title", "width", "height"},
    "th": {"colspan", "rowspan"},
    "td": {"colspan", "rowspan"},
    # `style` yalnız hizalama için: attribute_filter değeri süzer (aşağıda).
    "p": {"style"},
    "h2": {"style"},
    "h3": {"style"},
    "h4": {"style"},
}
_ALLOWED_URL_SCHEMES = {"http", "https", "mailto"}

#: TipTap TextAlign'ın ürettiği tek biçim. `style` genel bir CSS kapısı DEĞİL:
#: bu kalıba uymayan her style özniteliği bütünüyle atılır (color, font, url()
#: — hepsi). Bkz. test_blog_sanitize.py.
_HIZA_STILI = re.compile(r"^\s*text-align:\s*(left|center|right|justify)\s*;?\s*$")


def _oznitelik_suzgeci(element: str, attribute: str, value: str) -> str | None:
    if attribute != "style":
        return value
    m = _HIZA_STILI.match(value)
    return f"text-align: {m.group(1)}" if m else None


def sanitize_html(raw: str) -> str:
    """Editör HTML'ini allowlist'e indirger (saf; pytest'li)."""
    if not raw:
        return ""
    return nh3.clean(
        raw,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRIBUTES,
        attribute_filter=_oznitelik_suzgeci,
        url_schemes=_ALLOWED_URL_SCHEMES,
        link_rel="noopener noreferrer",
    )
