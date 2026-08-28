"""Blog gövde sanitizasyonu — XSS sınırı.

`body_html` public tarafta dangerouslySetInnerHTML ile basılır; buradaki
allowlist o yüzden bir güvenlik SINIRIDIR, biçimlendirme tercihi değil.
"""
from __future__ import annotations

from services.blog_service import sanitize_html


def test_script_atilir() -> None:
    assert sanitize_html('<p>a</p><script>alert(1)</script>') == "<p>a</p>"


def test_on_event_oznitelikleri_atilir() -> None:
    out = sanitize_html('<p onclick="x()">a</p><img src="/x.png" onerror="y()">')
    assert "onclick" not in out and "onerror" not in out
    assert "<p>a</p>" in out


def test_javascript_semasi_atilir() -> None:
    out = sanitize_html('<a href="javascript:alert(1)">t</a>')
    assert "javascript:" not in out


def test_iframe_ve_style_atilir() -> None:
    out = sanitize_html('<iframe src="https://x"></iframe><style>p{}</style><p>a</p>')
    assert "<iframe" not in out and "<style" not in out
    assert "<p>a</p>" in out


def test_izinli_bicimlendirme_korunur() -> None:
    raw = '<h2>Başlık</h2><p><strong>k</strong> <em>i</em></p><ul><li>a</li></ul>'
    assert sanitize_html(raw) == raw


def test_linke_noopener_eklenir() -> None:
    out = sanitize_html('<a href="https://example.com">t</a>')
    assert 'rel="noopener noreferrer"' in out


def test_gorsel_korunur_ama_veri_semasi_atilir() -> None:
    ok = sanitize_html('<img src="https://cdn/x.webp" alt="a">')
    assert 'src="https://cdn/x.webp"' in ok
    kotu = sanitize_html('<img src="data:text/html;base64,PHNjcmlwdD4=">')
    assert "data:" not in kotu


def test_bos_girdi_bos_cikti() -> None:
    assert sanitize_html("") == ""


def test_hizalama_stili_gecer_diger_stiller_atilir() -> None:
    """TipTap TextAlign: style yalnız text-align değeriyle yaşar; genel CSS kapısı değildir."""
    assert sanitize_html('<p style="text-align: center">a</p>') == '<p style="text-align: center">a</p>'
    assert sanitize_html('<h2 style="text-align: right">b</h2>') == '<h2 style="text-align: right">b</h2>'
    # Hizalama dışı her style bütünüyle atılır — birleşik yazım dahil.
    assert sanitize_html('<p style="color:red">a</p>') == "<p>a</p>"
    assert sanitize_html('<p style="text-align: center; color:red">a</p>') == "<p>a</p>"
    assert sanitize_html('<p style="background:url(javascript:x)">a</p>') == "<p>a</p>"
