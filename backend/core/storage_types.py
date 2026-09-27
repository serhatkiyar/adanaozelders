"""Depolama nesnesine işaret eden yanıt alanlarının tipleri.

DB'de nesne anahtarı (``profiles/x.webp``, ``private/...``) ya da eski kayıtlarda
tam adres durur. İstemciye giden adres serileştirme anında
:func:`core.storage.resolve_url` ile üretilir; frontend sözleşmesi değişmez
(alan yine hazır bir URL taşır).

* ``PublicAsset``  — herkese gösterilen görsel. Private anahtar bu alandan
  ASLA çıkmaz (``None`` döner).
* ``PrivateAsset`` — yetkili uçlarda dönen hassas dosya; private anahtar kısa
  ömürlü imzalı adrese çevrilir. Dış bağlantı da taşıyabilen karma alanlar
  (ders materyali: link ya da dosya) da bu tiptedir.

* ``PublicAssetInput`` — GİRDİ şemalarındaki görsel adresi. Bize ait public
  adres anahtara çevrilir; private anahtar/adres 422 alır
  (:func:`core.storage.normalize_public_input`).

``PublicAsset``/``PrivateAsset`` yalnız YANIT şemalarında kullanılır; girdi
şemasında kullanılırsa dökümü imzalı adresi DB'ye geri yazabilir.
"""
from typing import Annotated

from pydantic import AfterValidator, PlainSerializer

from core import storage


def _public(value: str | None) -> str | None:
    return storage.resolve_url(value, allow_private=False)


def _private(value: str | None) -> str | None:
    return storage.resolve_url(value, allow_private=True)


PublicAsset = Annotated[str, PlainSerializer(_public, return_type=str | None)]
PrivateAsset = Annotated[str, PlainSerializer(_private, return_type=str | None)]
PublicAssetInput = Annotated[str, AfterValidator(storage.normalize_public_input)]
