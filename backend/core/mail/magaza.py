"""Mağaza ve ödeme e-postaları — sipariş durumu maillerinin (templates.py)
kapsamadığı olaylar.

Bu şablonlar henüz olaylara BAĞLANMADI (kullanıcı kararı, 28 Eyl 2026: önce
tasarım + önizleme). Olay yeri her docstring'de yazar.
"""
from __future__ import annotations

from collections.abc import Sequence

from core import frontend_yollari as yol
from core.mail import components as c
from core.mail.base import EmailMessage


def _siparis_url(siparis_id: int) -> str:
    return c.site_url(f"{yol.SIPARISLERIM}/{siparis_id}")


def odeme_basarisiz(
    *, to: str, name: str, konu: str, tutar: str, url: str, satirlar: Sequence[tuple[str | None, object, object]] = ()
) -> EmailMessage:
    """Ödeme tamamlanamadı — sipariş, deneme bileti ya da çalışma rezervasyonu.

    Olay: ``order_service.complete_checkout`` (``payment_status=FAILED``) ve
    kütüphane ödemelerinde kayıt ``PENDING_PAYMENT`` kalır. Bugün kullanıcıya
    yalnız ``?odeme=basarisiz`` yönlendirmesi gidiyor; sekmeyi kapatan
    ödemenin alınmadığını hiç öğrenmiyor.
    ``konu``: "siparişin" | "deneme sınavı biletin" | "çalışma alanı rezervasyonun".
    """
    para = c.tl(tutar)
    return c.eposta(
        to,
        "Ödemen tamamlanamadı",
        f"{konu.capitalize()} için ödeme alınamadı. Yeniden deneyebilirsin.",
        c.metin(
            f"Merhaba {name},",
            "",
            f"{konu.capitalize()} için {para} tutarındaki ödeme tamamlanamadı; işlem onaylanmadı.",
            "Kart bilgilerini kontrol edip yeniden deneyebilirsin.",
            "",
            f"Yeniden dene: {url}",
        ),
        [
            c.heading("Ödemen tamamlanamadı"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph(f"{konu.capitalize()} için ödeme tamamlanamadı; işlem henüz onaylanmadı."),
            c.info_rows([*satirlar, ("tutar", "Tutar", para)]),
            c.callout(
                "Kart bilgilerini, limitini ve 3D Secure doğrulamasını kontrol edip yeniden "
                "deneyebilirsin.",
                tone="note",
            ),
            c.button("Yeniden dene", url),
            c.fine_print(
                c.fmt(
                    "Tutar kartından çekildiyse ya da sorun devam ederse {link}",
                    link=c.link("bize ulaş", c.site_url(yol.ILETISIM)),
                )
            ),
        ],
    )


def iade_talebi_alindi(
    *,
    to: str,
    name: str,
    siparis_id: int,
    siparis_no: str,
    iade_turu: str,
    urunler: Sequence[str],
    tutar: str | None = None,
) -> EmailMessage:
    """Mağaza iade talebi alındı (incelemeye düştü).

    Olay: ``order_service.request_return`` (bekleyen dal). Bugün talebi yapan
    müşteriye de yöneticiye de hiçbir şey gitmiyor.
    """
    rows: list[tuple[str | None, object, object]] = [
        ("siparis", "Sipariş no", siparis_no),
        ("bilgi", "İade türü", iade_turu),
    ]
    if tutar:
        rows.append(("tutar", "İade tutarı", c.tl(tutar)))
    return c.eposta(
        to,
        f"İade talebini aldık ({siparis_no})",
        "Talebini inceleyip sonucu sana bildireceğiz.",
        c.metin(
            f"Merhaba {name},",
            "",
            f"{siparis_no} numaralı siparişin için iade talebini aldık.",
            "Ürünler: " + ", ".join(urunler),
            "Talebini inceleyip sonucu sana bildireceğiz.",
            "",
            f"Siparişin: {_siparis_url(siparis_id)}",
        ),
        [
            c.heading("İade talebini aldık"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph("İade talebin bize ulaştı. İnceleyip sonucu sana bildireceğiz."),
            c.info_rows(rows),
            c.quote("İade edilecek ürünler", "\n".join(f"• {u}" for u in urunler)),
            c.button("Siparişimi gör", _siparis_url(siparis_id), space=0),
        ],
    )


def iade_talebi_reddedildi(
    *, to: str, name: str, siparis_id: int, siparis_no: str, not_: str | None = None
) -> EmailMessage:
    """İade talebi reddedildi. Olay: ``order_service.reject_return``."""
    blocks = [
        c.heading("İade talebin onaylanmadı"),
        c.paragraph(f"Merhaba {name},", space=12),
        c.paragraph(f"{siparis_no} numaralı siparişin için iade talebini inceledik ve onaylayamadık."),
    ]
    if not_:
        blocks.append(c.quote("İnceleme notu", not_))
    blocks += [
        c.button("Siparişimi gör", _siparis_url(siparis_id)),
        c.fine_print(
            c.fmt(
                "Karara itiraz etmek ya da soru sormak için {link}",
                link=c.link("bize ulaş", c.site_url(yol.ILETISIM)),
            )
        ),
    ]
    return c.eposta(
        to,
        f"İade talebin onaylanmadı ({siparis_no})",
        "İade talebinle ilgili karar.",
        c.metin(
            f"Merhaba {name},",
            "",
            f"{siparis_no} numaralı siparişin için iade talebin onaylanmadı.",
            *([f"İnceleme notu: {not_}"] if not_ else []),
            "",
            f"Siparişin: {_siparis_url(siparis_id)}",
        ),
        blocks,
    )


def iade_tamamlandi(
    *, to: str, name: str, siparis_id: int, siparis_no: str, tutar: str
) -> EmailMessage:
    """İade edilen ürün teslim alındı, (kısmi) iade yapıldı.

    Olay: ``order_service.receive_return`` / ``settle_completed_return``. Tam
    iade (``REFUNDED``) zaten ``templates.order_status_email`` ile gidiyor; bu
    şablon kısmi iadeler içindir.
    """
    para = c.tl(tutar)
    return c.eposta(
        to,
        f"İaden tamamlandı: {para}",
        f"{siparis_no} numaralı siparişin için {para} iade edildi.",
        c.metin(
            f"Merhaba {name},",
            "",
            f"{siparis_no} numaralı siparişin için {para} iade edildi.",
            "Tutarın hesabında görünme süresi bankana göre değişebilir.",
            "",
            f"Siparişin: {_siparis_url(siparis_id)}",
        ),
        [
            c.heading("İaden tamamlandı"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph("İade ettiğin ürünleri teslim aldık ve ücretini iade ettik."),
            c.info_rows([("siparis", "Sipariş no", siparis_no), ("tutar", "İade tutarı", para)]),
            c.callout("Tutarın hesabında görünme süresi bankana göre değişebilir.", tone="note"),
            c.button("Siparişimi gör", _siparis_url(siparis_id), space=0),
        ],
    )


def siparis_iptal_edildi(*, to: str, name: str, siparis_id: int, siparis_no: str) -> EmailMessage:
    """Ödenmemiş sipariş iptal edildi.

    Olay: ``order_service._cancel_order`` (ödenmemiş dal). Ödenmiş sipariş
    iptalinde iade maili (``order_status_email`` REFUNDED) zaten gidiyor.
    """
    return c.eposta(
        to,
        f"Siparişin iptal edildi ({siparis_no})",
        "Bu sipariş için senden ücret alınmadı.",
        c.metin(
            f"Merhaba {name},",
            "",
            f"{siparis_no} numaralı siparişin iptal edildi. Bu sipariş için senden ücret alınmadı.",
            "",
            f"Mağaza: {c.site_url(yol.MAGAZA)}",
        ),
        [
            c.heading("Siparişin iptal edildi"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.info_rows([("siparis", "Sipariş", c.fmt("{n} {b}", n=siparis_no, b=c.badge("İptal edildi")))]),
            c.callout("Bu sipariş için senden ücret alınmadı.", tone="note"),
            c.button("Mağazaya göz at", c.site_url(yol.MAGAZA), space=0),
        ],
    )
