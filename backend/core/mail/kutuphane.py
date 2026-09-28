"""Kütüphane e-postaları — deneme sınavı biletleri, çalışma alanı
rezervasyonları ve kütüphane başvurusu.

Bu şablonlar henüz olaylara BAĞLANMADI (kullanıcı kararı, 28 Eyl 2026: önce
tasarım + önizleme). Olay yeri her docstring'de yazar.

Bilet ve rezervasyonlarda QR görseli gömülmez; kısa kod büyük kutuda yazılır,
QR "Biletimi göster" düğmesinin açtığı sayfadadır (Gmail gömülü görseli engeller).
"""
from __future__ import annotations

import datetime

from core import frontend_yollari as yol
from core.mail import components as c
from core.mail.base import EmailMessage

# Deneme bileti sınava bu kadar kala iptal edilirse ücretin tamamı iade edilir
# (library_exam_service.cancel_registration).
_BILET_TAM_IADE_SAAT = 24


def _bilet_url(tur: str, kayit_id: int) -> str:
    """``/rezervasyon/:tur/:id`` — tur: "deneme" | "calisma"."""
    return c.site_url(f"{yol.REZERVASYON_DETAY}/{tur}/{kayit_id}")


def deneme_bileti(
    *,
    to: str,
    name: str,
    kayit_id: int,
    oturum: str,
    baslangic: datetime.datetime,
    sure_dk: int,
    kutuphane: str,
    tutar: str,
    kisa_kod: str,
) -> EmailMessage:
    """Deneme sınavı bileti alındı.

    Olay: ``library_exam_service.complete_checkout``. Bugün hiçbir bildirim
    yok; öğrenci sınav günü bileti bulmak için siteye girmek zorunda.
    """
    zaman = c.tarih_tr(baslangic)
    sure = c.sure_tr(baslangic, baslangic + datetime.timedelta(minutes=sure_dk))
    url = _bilet_url("deneme", kayit_id)
    return c.eposta(
        to,
        f"Deneme sınavı biletin hazır: {oturum} 🎫",
        f"{zaman} · {kutuphane} · Giriş kodun: {kisa_kod}",
        c.metin(
            f"Merhaba {name},",
            "",
            f"'{oturum}' deneme sınavı biletin hazır.",
            f"Zaman: {zaman} ({sure})",
            f"Kütüphane: {kutuphane}",
            f"Giriş kodun: {kisa_kod}",
            "",
            f"Biletini göster: {url}",
        ),
        [
            c.heading("Deneme sınavı biletin hazır"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph("Yerin ayrıldı. Sınav günü girişte aşağıdaki kodu ya da biletindeki QR kodu göster."),
            c.code_box(kisa_kod, "Giriş kodun"),
            c.info_rows(
                [
                    ("belge", "Sınav", oturum),
                    ("takvim", "Zaman", f"{zaman} · {sure}"),
                    ("konum", "Kütüphane", kutuphane),
                    ("tutar", "Ödenen", c.tl(tutar)),
                ]
            ),
            c.button("Biletimi göster", url),
            c.fine_print(
                f"Sınavdan {_BILET_TAM_IADE_SAAT} saatten fazla önce iptal edersen ücretin tamamı "
                "iade edilir."
            ),
        ],
    )


def deneme_bileti_iptal(
    *,
    to: str,
    name: str,
    oturum: str,
    baslangic: datetime.datetime,
    iptal_eden: str,
    iade_tutari: str | None,
) -> EmailMessage:
    """Deneme bileti iptal edildi.

    ``iptal_eden="ogrenci"``: öğrenci biletini iptal etti
    (``cancel_registration``). ``iptal_eden="kutuphane"``: oturum iptal edildi
    (``cancel_session``, ücret iade edilir). ``iade_tutari=None``: iade yok
    (sınava 24 saatten az kala öğrenci iptali).
    """
    zaman = c.tarih_tr(baslangic)
    if iptal_eden == "kutuphane":
        baslik = "Deneme sınavı oturumu iptal edildi"
        aciklama = f"'{oturum}' oturumu kütüphane tarafından iptal edildi."
    else:
        baslik = "Deneme sınavı biletin iptal edildi"
        aciklama = f"'{oturum}' biletin talebin üzerine iptal edildi."
    if iade_tutari:
        kutu = c.callout(
            f"Ödediğin {c.tl(iade_tutari)} iade edilecek. Tutarın hesabına yansıma süresi "
            "bankana göre değişebilir.",
            tone="success",
        )
        iade_metin = f"Ödediğin {c.tl(iade_tutari)} iade edilecek."
    else:
        kutu = c.callout(
            f"Sınava {_BILET_TAM_IADE_SAAT} saatten az kala iptal edildiği için ücret iade edilmez.",
            tone="note",
        )
        iade_metin = "Ücret iade edilmez."
    return c.eposta(
        to,
        f"{baslik} ❌",
        f"{oturum} · {zaman}",
        c.metin(f"Merhaba {name},", "", aciklama, iade_metin, "", f"Denemeler: {c.site_url(yol.DENEMELER)}"),
        [
            c.heading(baslik),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph(aciklama),
            c.info_rows(
                [
                    ("belge", "Sınav", oturum),
                    ("takvim", "Zaman", c.fmt("{t} {b}", t=c.strike(zaman), b=c.badge("İptal edildi"))),
                ]
            ),
            kutu,
            c.button("Diğer denemelere göz at", c.site_url(yol.DENEMELER), space=0),
        ],
    )


def deneme_karnesi(*, to: str, name: str, oturum: str) -> EmailMessage:
    """Deneme sınavı karnesi açıklandı. Olay: ``library_exam_service.publish_results``."""
    url = c.site_url(yol.REZERVASYONLAR)
    return c.eposta(
        to,
        f"Deneme karnen açıklandı: {oturum} 📊",
        "Sonuçlarına ve konu analizine göz at.",
        c.metin(f"Merhaba {name},", "", f"'{oturum}' deneme sınavı karnen açıklandı.", "", f"Karnen: {url}"),
        [
            c.heading("Deneme karnen açıklandı"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph(f"'{oturum}' deneme sınavının sonuçları açıklandı. Karnene göz atabilirsin."),
            c.button("Karnemi gör", url, space=0),
        ],
    )


def calisma_rezervasyonu(
    *,
    to: str,
    name: str,
    kayit_id: int,
    kutuphane: str,
    baslangic: datetime.datetime,
    bitis: datetime.datetime,
    tutar: str,
    kisa_kod: str,
) -> EmailMessage:
    """Çalışma alanı rezervasyonu onaylandı.

    Olay: ``study_reservation_service.complete_checkout``. Bugün bildirim yok.
    """
    zaman = c.tarih_tr(baslangic)
    sure = c.sure_tr(baslangic, bitis)
    url = _bilet_url("calisma", kayit_id)
    return c.eposta(
        to,
        f"Çalışma alanı rezervasyonun onaylandı: {kutuphane} 📚",
        f"{zaman} · {sure} · Giriş kodun: {kisa_kod}",
        c.metin(
            f"Merhaba {name},",
            "",
            f"{kutuphane} çalışma alanı rezervasyonun onaylandı.",
            f"Zaman: {zaman} ({sure})",
            f"Giriş kodun: {kisa_kod}",
            "",
            f"Rezervasyonun: {url}",
        ),
        [
            c.heading("Çalışma alanı rezervasyonun onaylandı"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph("Yerin hazır. Girişte aşağıdaki kodu ya da rezervasyonundaki QR kodu göster."),
            c.code_box(kisa_kod, "Giriş kodun"),
            c.info_rows(
                [
                    ("konum", "Kütüphane", kutuphane),
                    ("takvim", "Zaman", f"{zaman} · {sure}"),
                    ("tutar", "Ödenen", c.tl(tutar)),
                ]
            ),
            c.button("Rezervasyonumu göster", url, space=0),
        ],
    )


def calisma_rezervasyonu_iptal(
    *, to: str, name: str, kutuphane: str, baslangic: datetime.datetime, iade_tutari: str | None
) -> EmailMessage:
    """Çalışma alanı rezervasyonu iptal edildi. Olay: ``study_reservation_service.cancel``."""
    zaman = c.tarih_tr(baslangic)
    blocks = [
        c.heading("Çalışma alanı rezervasyonun iptal edildi"),
        c.paragraph(f"Merhaba {name},", space=12),
        c.info_rows(
            [
                ("konum", "Kütüphane", kutuphane),
                ("takvim", "Zaman", c.fmt("{t} {b}", t=c.strike(zaman), b=c.badge("İptal edildi"))),
            ]
        ),
    ]
    if iade_tutari:
        blocks.append(
            c.callout(
                f"Ödediğin {c.tl(iade_tutari)} iade edilecek. Tutarın hesabına yansıma süresi "
                "bankana göre değişebilir.",
                tone="success",
            )
        )
    blocks.append(c.button("Kütüphanelere göz at", c.site_url(yol.KUTUPHANELER), space=0))
    return c.eposta(
        to,
        "Çalışma alanı rezervasyonun iptal edildi",
        f"{kutuphane} · {zaman}",
        c.metin(
            f"Merhaba {name},",
            "",
            f"{kutuphane} için {zaman} tarihli çalışma alanı rezervasyonun iptal edildi.",
            *([f"Ödediğin {c.tl(iade_tutari)} iade edilecek."] if iade_tutari else []),
        ),
        blocks,
    )


def kutuphane_basvurusu_alindi(*, to: str, name: str, kutuphane: str) -> EmailMessage:
    """Kütüphane kendi kendine kayıt oldu; başvuru incelemede.

    Olay: ``library_onboarding_service.register``. Bugün ne başvurana ne
    yöneticiye bildirim gidiyor.
    """
    govde = (
        f"'{kutuphane}' başvurunu aldık. Ekibimiz bilgileri inceliyor; sonucu sana "
        "e-postayla bildireceğiz."
    )
    return c.eposta(
        to,
        "Kütüphane başvurunu aldık ✨",
        "Başvurun inceleniyor; sonucu e-postayla bildireceğiz.",
        c.metin(f"Merhaba {name},", "", govde),
        [
            c.heading("Başvurunu aldık"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph(govde, space=0),
        ],
    )


def kutuphane_basvurusu_sonuc(
    *, to: str, name: str, kutuphane: str, onaylandi: bool, gerekce: str | None = None
) -> EmailMessage:
    """Kütüphane başvurusu onaylandı / reddedildi.

    Olay: ``library_onboarding_service.approve`` / ``reject`` (bugün yalnız
    site içi bildirim, bağlantısı ana sayfaya gidiyor).
    """
    panel = c.site_url(yol.KUTUPHANEM)
    if onaylandi:
        return c.eposta(
            to,
            f"{kutuphane} artık yayında! 🎉",
            "Öğrenciler kütüphaneni görebilir; oturumlarını eklemeye başlayabilirsin.",
            c.metin(
                f"Merhaba {name},",
                "",
                f"'{kutuphane}' başvurun onaylandı; kütüphanen artık yayında.",
                "",
                f"Kütüphanem: {panel}",
            ),
            [
                c.heading("Kütüphanen yayında!"),
                c.callout(
                    f"Tebrikler {name}, '{kutuphane}' başvurun onaylandı. Öğrenciler kütüphaneni "
                    "artık görebilir.",
                    tone="success",
                ),
                c.button("Kütüphanemi yönet", panel, space=0),
            ],
            more_cards=[
                [
                    c.heading("İlk adımların"),
                    c.steps(
                        [
                            ("Deneme oturumu ekle", "Sınav tarihini, süresini ve kontenjanını belirle."),
                            ("Çalışma alanını aç", "Öğrencilerin ayırabileceği masa ve saatleri ekle."),
                        ]
                    ),
                ]
            ],
        )
    blocks = [
        c.heading("Kütüphane başvurun onaylanmadı"),
        c.paragraph(f"Merhaba {name},", space=12),
        c.paragraph(f"'{kutuphane}' başvurunu inceledik ve şu an için onaylayamadık."),
    ]
    if gerekce:
        blocks.append(c.quote("Gerekçe", gerekce))
    blocks.append(c.button("Bize ulaş", c.site_url(yol.ILETISIM), variant="secondary", space=0))
    return c.eposta(
        to,
        "Kütüphane başvurun onaylanmadı",
        "Başvurunla ilgili karar.",
        c.metin(
            f"Merhaba {name},",
            "",
            f"'{kutuphane}' başvurun onaylanmadı.",
            *([f"Gerekçe: {gerekce}"] if gerekce else []),
        ),
        blocks,
    )
