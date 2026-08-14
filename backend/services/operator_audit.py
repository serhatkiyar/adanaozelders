"""Kütüphane operatörünün para etkili aksiyonlarını denetim izine bağlar (İP-14 §7).

## Neden ayrı bir modül

İP-3'te kurye saha aksiyonları `audit_logs`'a bağlanmıştı
(`delivery_service.py::_ZimmetAktoru` + `audit_service.record`). Operatör aynı
sınıfta etki üretir — ama izi yalnız `attended_by_operator_id` kolonundaydı:

* **yoklama doğrulama** emaneti kütüphaneye serbest bırakır (`released_at`,
  geri alınamaz damga),
* **oturum iptali** ödeyen herkese iade tetikler,
* **karne yayınlama** öğrencilere bildirim gönderir ve geri alınamaz.

Bir operatör hesabı ele geçirilirse "kim, ne zaman, hangi girişi doğruladı"
sorusunun cevabı tek kolonla verilemez: kolon yalnız son doğrulayanı tutar,
iptal ve yayın aksiyonlarında ise hiç yoktur.

## Sözleşme

* Aktör **gerçek kullanıcıdır**: `actor_role` operatörde 4 (`LIBRARY_OPERATOR`),
  aynı uçları kullanan adminde 1. Aksiyonu operatör yaptıysa admin adına satır
  yazmak, iz olmamasından daha kötüdür (denetim yanlış kişiyi gösterir).
* Yazım **aksiyonla aynı transaction'dadır**: `audit_service.record` yalnız
  `flush()` eder, `commit` çağırana aittir. Böylece aksiyon geri alınırsa iz de
  geri alınır; "olmamış bir doğrulamanın izi" birikmez.
* Aktörü **bilinmeyen** çağrı (servis düzeyinde otomasyon, arka plan döngüsü)
  audit YAZMAZ — uydurulmuş bir aktör, hiç aktör olmamasından kötüdür. Bu,
  `delivery_service.mark_handed_over` içindeki kararla birebir aynıdır.
* `reason` bilinçli olarak BOŞ bırakılır: bu üç aksiyonun hiçbirinde kullanıcıya
  gerekçe sorulmaz (yoklama fiziksel bir olayın kaydıdır; iptal ve yayın
  operatörün kendi işletme kararıdır). Gerekçe alanı ileride bir onay
  penceresine eklenirse `record`'a doğrudan geçirilebilir.
"""
from __future__ import annotations

from typing import Protocol

from services import audit_service


class AuditAktoru(Protocol):
    """`audit_service.record` yalnız `id` ve `role_id` okur.

    Operatör (`LibraryOperator`, role 4) ve admin (`Admin`, role 1) ayrı
    tablolardır; ortak taban sınıfları yoktur. Protokol, servis imzalarının
    ikisini de kabul etmesini sağlar ve yanlışlıkla `Client` geçirilmesini tip
    düzeyinde engellemez ama çağrı noktaları rotadaki rol kapısından geçer.
    """

    id: int
    role_id: int


async def kaydet(
    db,
    *,
    actor: AuditAktoru | None,
    action: str,
    target_type: str,
    target_id: int,
    details: str | None = None,
    after: dict | None = None,
    meta: dict | None = None,
) -> None:
    """Operatör/admin aksiyonunu denetim izine yazar (commit ETMEZ).

    Aktör yoksa sessizce hiçbir şey yapmaz — bkz. modül docstring'i.
    """
    if actor is None:
        return
    await audit_service.record(
        db,
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
        after=after,
        meta=meta,
    )
