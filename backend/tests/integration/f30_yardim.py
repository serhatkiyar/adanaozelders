"""F30 (paketleme/zimmet/dağıtım) testleri için ortak yardımcılar."""
from __future__ import annotations


def bozuk_token(gercek: str) -> str:
    """Verilen token'dan KESİNLİKLE farklı, aynı uzunlukta bir token üretir.

    Bu yardımcı 8 Eyl 2026'da CI kırmızıya döndüğü için yazıldı. Testler
    "yanlış token" üretmek için son karakteri sabit bir `x` ile
    değiştiriyordu:

        f"PKG1:{paket['id']}:{gercek[:-1]}x"

    Token `secrets.token_urlsafe` ile üretiliyor, yani alfabesi 64 karakter
    (A-Z a-z 0-9 - _). Gerçek token'ın son karakteri ZATEN "x" olduğunda
    mutasyon hiçbir şeyi değiştirmiyor, "yanlış" sanılan token GEÇERLİ kalıyor
    ve uç haklı olarak 200 dönüyordu. Yani test her koşuda ~1/64 (%1.6)
    olasılıkla kırılıyordu -- ölçtüğü güvenlik kuralı doğruydu, kuralı sınama
    biçimi bozuktu.

    Bu bir "flaky" mazereti değil, kapatılan bir kusurdur: burada üretilen
    token her zaman farklıdır.
    """
    son = gercek[-1]
    return gercek[:-1] + ("y" if son == "x" else "x")
