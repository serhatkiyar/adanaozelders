"""F29 saf kurallar — olay → fiziksel etki tablosu, sayım FSM'i, fark aritmetiği.

**Bu modül veritabanına dokunmaz.** Sebebi: F29'un en kolay sessizce bozulan
yeri olay ile fiziksel etki arasındaki eşlemedir. `RETURN`'ü "otomatik
uzlaştırılabilir" yapmak tek satırlık bir değişikliktir, hiçbir şey patlamaz ve
sayım, henüz işletmeye ulaşmamış iade kitabını varmış gibi kabul eder. Tablo
**veri olarak** durduğunda bu değişiklik bir testte görünür.

## Üç büyüklük

* `saleable`  — `products.stock`, yani **satılabilir** miktar.
* `damaged`   — `products.damaged_stock`, işletmedeki satılamaz miktar.
* `reserved`  — ödenmiş ama işletmeden çıkmamış kalemler (türetilir, kolon değil).
* `on_premise` = `saleable + damaged + reserved`, işletmedeki **fiziksel** mevcut.

İşaretler: `+1` artar · `-1` azalır · `0` değişmez · `None` **belirsiz**.

## Neden `SALE` fiziksel mevcudu değiştirmez

`SALE` hareketi ödeme kesinleşirken yazılır (`order_service.py`
`_finalize_paid`); kitap işletmeden ancak tur başlarken çıkar
(`delivery_service.py`, `SHIPPED`). Arada paketleme adımı bile vardır ve o da
paketi işletmede tutar. Bu yüzden `SALE` satılabilirden düşer, rezerveye
eklenir, fiziksel mevcut **değişmez**.

## Değişmez: belirsiz olay otomatik uzlaştırmaya giremez

`on_premise is None` olan bir satır `auto_reconcilable=True` olamaz. Bu
kombinasyon "ne olduğunu bilmiyorum ama yine de düzelteyim" demektir; sayımın
tüm anlamını yok eder. Kural bir testle korunur.
"""
from __future__ import annotations

import dataclasses


@dataclasses.dataclass(frozen=True, slots=True)
class Effect:
    """Bir olayın dört eksendeki etkisi + otomatik uzlaştırılabilirliği.

    `auto_reconcilable=False` olan bir olay sayımdan sonra geçtiyse ilgili satır
    `STALE` olur ve yeniden sayılmadan ya da açıkça çözülmeden uygulanamaz.
    """

    saleable: int | None
    damaged: int | None
    reserved: int | None
    on_premise: int | None
    auto_reconcilable: bool


#: Olay adı → etki. Kaynak: docs/arsiv/stok/f29-sayim-hasarli-stok-plani.md §3.
#:
#: Adlar `StockMovementType` değerleriyle **aynı yazılır** (ör. `SALE`), çünkü
#: uzlaştırma defter satırlarını bu adla arar. Defter satırı olmayan olaylar
#: (`ORDER_SHIPPED`, `DELIVERY_FAILED`…) sipariş yaşam döngüsünden gelir.
PHYSICAL_EFFECT: dict[str, Effect] = {
    # ── Defter hareketleri ──
    "INITIAL": Effect(+1, 0, 0, +1, True),
    # Ödeme: satılabilirden düşer, rezerveye geçer, kitap İŞLETMEDE kalır.
    "SALE": Effect(-1, 0, +1, 0, True),
    # Çıkıştan ÖNCE iptal: rezerve çözülür, fiziksel mevcut değişmez.
    "SALE_CANCEL": Effect(+1, 0, -1, 0, True),
    # Çıkıştan SONRA iptal: kitap yolda ya da müşteride; geri geldi mi bilinmez.
    "SALE_CANCEL_SHIPPED": Effect(+1, 0, 0, None, False),
    # İade ONAYINDA yazılır; kitabın işletmeye ulaşıp ulaşmadığı KAYITLI DEĞİL.
    "RETURN": Effect(+1, 0, 0, None, False),
    # Niyet bilinmiyor: veri düzeltmesi mi, fiziksel kayıp mı?
    "ADMIN_ADJUSTMENT": Effect(None, 0, 0, None, False),
    # Veriyi fiziğe hizalar; fiziği değiştirmez.
    "COUNT_ADJUSTMENT": Effect(None, None, 0, 0, True),
    "DAMAGE_TRANSFER": Effect(-1, +1, 0, 0, True),
    "DAMAGE_RECOVERY": Effect(+1, -1, 0, 0, True),
    "DAMAGE_DISPOSAL": Effect(0, -1, 0, -1, True),
    "SUPPLIER_RETURN": Effect(None, None, 0, -1, True),
    # ── Sipariş yaşam döngüsü (defter satırı üretmez) ──
    "ORDER_PREPARED": Effect(0, 0, 0, 0, True),
    "ORDER_SHIPPED": Effect(0, 0, -1, -1, True),
    "ORDER_DELIVERED": Effect(0, 0, 0, 0, True),
    "DELIVERY_FAILED": Effect(0, 0, +1, +1, True),
    "STOP_REMOVED": Effect(0, 0, +1, +1, True),
    # ── Kaydı olmayan olaylar ──
    # Müşteri iadesinin fiziksel kabulü: akış YOK (F29 kapsam dışı).
    "RETURN_RECEIVED": Effect(0, 0, 0, None, False),
    "MANUAL_DB_CHANGE": Effect(None, None, None, None, False),
}


def is_auto_reconcilable(event: str) -> bool:
    """Olay sayımdan sonra geçtiyse satır yine de uygulanabilir mi?

    **Fail-safe:** tabloda olmayan olay `False` döner. Varsayılan "evet"
    olsaydı, ileride eklenen her yeni hareket türü sessizce uzlaştırmaya girer
    ve sayımı yanlış yönlendirirdi.
    """
    etki = PHYSICAL_EFFECT.get(event)
    return bool(etki and etki.auto_reconcilable)


# ══════════════════════ Sayım oturumu FSM'i ══════════════════════

DRAFT = "DRAFT"
IN_PROGRESS = "IN_PROGRESS"
REVIEW = "REVIEW"
APPLIED = "APPLIED"
CANCELLED = "CANCELLED"

#: Terminal durumlar — çıkışı olmayan düğümler.
TERMINAL: frozenset[str] = frozenset({APPLIED, CANCELLED})

#: İZİNLİ geçişlerin TAM listesi. Burada olmayan her geçiş yasaktır; asıl risk
#: izinli geçişlerin çalışmaması değil, **izinsiz bir geçişin sessizce açık
#: kalmasıdır** (ör. APPLIED → IN_PROGRESS ile uygulanmış sayımın "düzeltilmesi").
TRANSITIONS: frozenset[tuple[str, str]] = frozenset(
    {
        (DRAFT, IN_PROGRESS),
        (IN_PROGRESS, REVIEW),
        # Gözden geçirmede düzeltme gerekirse geri dönülür; önceki onay
        # geçersizleşir (servis `reviewed_by/at`'i temizler).
        (REVIEW, IN_PROGRESS),
        (REVIEW, APPLIED),
        (DRAFT, CANCELLED),
        (IN_PROGRESS, CANCELLED),
        (REVIEW, CANCELLED),
    }
)


def can_transition(source: str, target: str) -> bool:
    """Geçiş izinli mi? Tek doğruluk kaynağı `TRANSITIONS` tablosudur."""
    return (source, target) in TRANSITIONS


# ══════════════════════ Fark aritmetiği ══════════════════════


def line_difference(*, counted: int, expected: int, reserved: int) -> int:
    """Sayım satırının fiziksel farkı — **sayım ANINA** ait değişmez bir gerçek.

    `expected` satırın kovasına karşılık gelen sistem kolonunun sayım anındaki
    değeri, `reserved` ise ödenmiş ama işletmeden çıkmamış miktardır. Beklenen
    fiziksel mevcut ikisinin TOPLAMIDIR:

        fark = counted - (expected + reserved)

    Kullanıcının senaryosu: stok 10, sayım sırasında 2 satış, rafta 10 kitap.
    Satış fiziksel mevcudu değiştirmediği için beklenen 8 + 2 = 10'dur ve fark
    **0**'dır. Naif `counted - stock` hesabı burada +2 yazar ve sayımı bozar.

    `reserved` hasarlı kovada **her zaman 0** geçilir: hasarlı ürün siparişe
    ayrılamaz, dolayısıyla orada rezerve kavramı yoktur.
    """
    return int(counted) - (int(expected) + int(reserved))


__all__ = [
    "APPLIED",
    "CANCELLED",
    "DRAFT",
    "Effect",
    "IN_PROGRESS",
    "PHYSICAL_EFFECT",
    "REVIEW",
    "TERMINAL",
    "TRANSITIONS",
    "can_transition",
    "is_auto_reconcilable",
    "line_difference",
]
