"""Hesap güvenliği ve KVKK e-postaları.

Bu şablonlar henüz olaylara BAĞLANMADI (kullanıcı kararı, 28 Eyl 2026: önce
tasarım + önizleme). Olay yeri her docstring'de yazar.
"""
from __future__ import annotations

from core import frontend_yollari as yol
from core.mail import components as c
from core.mail.base import EmailMessage


def sifre_degistirildi(*, to: str, name: str, sifirlama: bool = False) -> EmailMessage:
    """Şifre değiştirildi / sıfırlandı — güvenlik bildirimi.

    Olay: ``auth_service.change_password`` (tüm oturumlar kapatılır) ve
    ``auth_service.reset_password``. Bugün hiçbir bildirim yok; hesabı ele
    geçiren biri şifreyi değiştirse sahibi fark etmez (OWASP önerisi; IBAN
    mailiyle aynı gerekçe).
    """
    ne = "sıfırlandı" if sifirlama else "değiştirildi"
    zaman = c.now_tr()
    return c.eposta(
        to,
        f"Şifren {ne} 🔒",
        f"Hesabının şifresi {zaman} tarihinde {ne}.",
        c.metin(
            f"Merhaba {name},",
            "",
            f"Hesabının şifresi {zaman} tarihinde {ne}. Güvenliğin için tüm cihazlardaki "
            "oturumların kapatıldı.",
            "",
            "Bu işlemi sen yapmadıysan hemen şifreni sıfırla ve bize ulaş:",
            f"Şifreni sıfırla: {c.site_url(yol.SIFREMI_UNUTTUM)}",
            f"Bize ulaş: {c.site_url(yol.ILETISIM)}",
        ),
        [
            c.heading(f"Şifren {ne}"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph(
                "Hesabının şifresi değişti. Güvenliğin için tüm cihazlardaki oturumların "
                "kapatıldı; yeni şifrenle tekrar giriş yapman gerekecek."
            ),
            c.info_rows([("saat", "Tarih", zaman)]),
            c.callout(
                "Bu işlemi sen yapmadıysan hesabın başkasının eline geçmiş olabilir: hemen "
                "şifreni sıfırla ve bize ulaş.",
                tone="warning",
            ),
            c.button("Şifremi sıfırla", c.site_url(yol.SIFREMI_UNUTTUM), space=12),
            c.button("Bize ulaş", c.site_url(yol.ILETISIM), variant="secondary", space=0),
        ],
    )


def hesap_silindi(*, to: str, name: str) -> EmailMessage:
    """Hesap silindi (anonimleştirildi) — KVKK kapanış bildirimi.

    Olay: ``account_deletion_service.anonymize_account``. E-posta adresi
    anonimleştirme sırasında silindiği için bu mail anonimleştirmeden ÖNCE
    kuyruğa alınmalıdır. Mali kayıtlar mevzuat gereği saklanır
    (docs/ip3-yetki-kvkk-sozlesme.md).
    """
    return c.eposta(
        to,
        "Hesabın silindi",
        "Talebin üzerine hesabın ve kişisel verilerin silindi.",
        c.metin(
            f"Merhaba {name},",
            "",
            "Talebin üzerine Adana Özel Ders hesabın silindi ve kişisel verilerin anonimleştirildi.",
            "Sipariş ve ödeme kayıtların mevzuat gereği yasal süre boyunca saklanır.",
            "",
            f"Bu işlemi sen yapmadıysan bize ulaş: {c.site_url(yol.ILETISIM)}",
        ),
        [
            c.heading("Hesabın silindi"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph(
                "Talebin üzerine Adana Özel Ders hesabın silindi ve kişisel verilerin "
                "anonimleştirildi. Bize katıldığın için teşekkür ederiz."
            ),
            c.callout(
                "Sipariş ve ödeme kayıtların mevzuat gereği yasal süre boyunca saklanır.",
                tone="note",
            ),
            c.fine_print(
                c.fmt(
                    "Bu işlemi sen yapmadıysan {link}",
                    link=c.link("bize ulaş", c.site_url(yol.ILETISIM)),
                )
            ),
        ],
    )
