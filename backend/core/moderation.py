"""Anti-disintermediation: kullanıcı içeriğinde telefon/e-posta gibi iletişim
bilgilerini maskeler. Mesajlaşma, ders yorumları, profil metinleri ve diğer
serbest-metin kanallarında ikinci savunma katmanı olarak kullanılır.

NEDEN ÖNEMLİ: platform eşleşmeden komisyon alır. Taraflar iletişim bilgisi
paylaşıp dışarıda anlaşırsa hem gelir kaybolur hem de ödeme/iade/ihtilaf
koruması devre dışı kalır (kullanıcı için de kötüdür).

YANLIŞ POZİTİF NEDEN KRİTİK: maske eskiden yalnız mesaj gövdesine
uygulanıyordu; profil metinlerine yayarken ilk regex'in "2020 - 2024 arası
lisans" ifadesini de gizlediği görüldü. Eğitmen biyografilerinde tarih aralığı
çok yaygındır — aşırı hevesli bir maske ürünü sessizce bozar. Bu yüzden karar
iki aşamalı: geniş bir aday yakalanır, sonra `_looks_like_phone` telefon olup
olmadığına karar verir (saf fonksiyon, testli).
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

_PLACEHOLDER = "[gizlendi]"

# Aday: rakamla başlayıp rakamla biten, arada yalnız ayırıcı bulunan diziler.
# Telefon olup olmadığına `_looks_like_phone` karar verir.
_CANDIDATE = re.compile(r"\+?\d[\d\s().\-]{7,}\d")

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+", re.IGNORECASE)

# Doğrudan mesajlaşmaya götüren kısayol bağlantıları: numara yazmadan
# "wa.me/905321234567" paylaşmak da aynı atlatmadır.
_DIRECT_LINK = re.compile(
    r"\b(?:wa\.me|api\.whatsapp\.com|t\.me|telegram\.me|m\.me)/\S+",
    re.IGNORECASE,
)

# ISBN/barkod telefonla aynı uzunlukta olabilir ve kitap yorumunda meşrudur.
_ISBN_PREFIX = re.compile(r"(?:isbn|barkod)\D{0,4}$", re.IGNORECASE)

# Telefon uzunluğu: yerel 10 hane (5321234567), ülke kodlu 12, uluslararası
# 13'e kadar. Alt sınır 10 olduğu için yıl aralıkları (8 hane) elenir.
_MIN_DIGITS = 10
_MAX_DIGITS = 13


def _looks_like_phone(raw: str) -> bool:
    """Yakalanan dizi gerçekten telefon numarası mı?

    Elenen tipik yanlış pozitifler:
      "2020 - 2024"          → 8 rakam, alt sınırın altında
      "1 2 3 4 5 6 7 8 9 10" → 10 parça; numara 5 parçadan fazlasına bölünmez
      "14:00 - 16:00"        → iki nokta ayırıcı sayılmaz, aday bile olmaz
    """
    digits = [ch for ch in raw if ch.isdigit()]
    if not (_MIN_DIGITS <= len(digits) <= _MAX_DIGITS):
        return False
    groups = [g for g in re.split(r"\D+", raw) if g]
    if len(groups) > 5:
        return False
    # Tek haneli parça en fazla bir tane olabilir (baştaki "0" gibi); daha
    # fazlası numara değil, sayı listesidir.
    if sum(1 for g in groups if len(g) == 1) > 1:
        return False
    return True


def mask_contact_info(text: str | None) -> str | None:
    """Metindeki telefon/e-posta/doğrudan mesajlaşma bağlantılarını gizler."""
    if not text:
        return text

    out = _EMAIL.sub(_PLACEHOLDER, text)
    out = _DIRECT_LINK.sub(_PLACEHOLDER, out)

    def _maybe_mask(m: re.Match[str]) -> str:
        raw = m.group(0)
        if not _looks_like_phone(raw):
            return raw
        # "ISBN 978-605-..." gibi meşru kullanımları koru.
        if _ISBN_PREFIX.search(out[: m.start()]):
            return raw
        return _PLACEHOLDER

    return _CANDIDATE.sub(_maybe_mask, out)


# Genel web bağlantısı: şema (http/https) ya da "www." ile başlayan dizi.
# Şemasız ve "www."suz alan adları ("x.com/y") bilinçli olarak yakalanmaz:
# düz metindeki "a.b" kalıbı yanlış pozitif üretir.
_URL = re.compile(r"\b(?:https?://|www\.)[^\s<>\"']+", re.IGNORECASE)


def _norm_host(host: str | None) -> str:
    h = (host or "").lower()
    return h[4:] if h.startswith("www.") else h


def mask_external_links(
    text: str | None, allowed_hosts: frozenset[str]
) -> str | None:
    """Ders öncesi sohbette dış bağlantıları gizler; izinli (kendi) alan adı kalır.

    Karşılaştırma küçük harfle ve "www." öneki atılarak yapılır; port
    karşılaştırmaya girmez. Host çıkarılamayan bağlantı dış sayılır.
    """
    if not text:
        return text
    allowed = {_norm_host(h) for h in allowed_hosts if h}

    def _maybe_mask(m: re.Match[str]) -> str:
        raw = m.group(0)
        url = raw if raw.lower().startswith(("http://", "https://")) else "https://" + raw
        # Tarayıcı (WHATWG URL) http(s) adreslerinde "\\" karakterini "/" sayar;
        # urlsplit saymaz. Aynı host'u görmek için önce normalize edilir.
        url = url.replace("\\", "/")
        try:
            parts = urlsplit(url)
            host = parts.hostname
        except ValueError:
            parts, host = None, None
        # Kullanıcı bilgisi ("x@host") içeren adres aldatıcıdır; dış sayılır.
        if parts is not None and "@" in parts.netloc:
            return _PLACEHOLDER
        if host and _norm_host(host) in allowed:
            return raw
        return _PLACEHOLDER

    return _URL.sub(_maybe_mask, text)
