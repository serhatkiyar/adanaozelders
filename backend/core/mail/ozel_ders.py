"""Özel ders e-postaları — öğrenciye ve öğretmene giden ders yaşam döngüsü.

Her şablon koddaki gerçek bir olaya karşılık gelir (olay ve yeri docstring'de).
Bu modül yalnız içeriği üretir; olaylara BAĞLANMADI — bağlama ayrı bir adımdır
(kullanıcı kararı, 28 Eyl 2026: önce tasarım + önizleme).

Görsel referans: Preply'nin işlemsel e-postaları. Düzen ``components`` modülünün
başında yazar. Kişi adları çağıran taraftan ``display_name`` olarak gelmelidir
(ÜK-9: soyad açık yüzeyde gösterilmez).
"""
from __future__ import annotations

import datetime
from collections.abc import Sequence
from dataclasses import dataclass

from core import frontend_yollari as yol
from core.mail import components as c
from core.mail.base import EmailMessage

# Canlı ders odası dersten bu kadar önce açılır (core/canli_ders.py KATILIM_ACILIS).
_ODA_ACILIS_DK = 15
# Öğretmen dersi tamamladıktan sonra öğrencinin itiraz süresi
# (config LESSON_CONFIRM_WINDOW_HOURS).
_ONAY_SAAT = 72
# Öğrencinin geç iptal eşiği (config LESSON_LATE_CANCEL_HOURS).
_GEC_IPTAL_SAAT = 12


@dataclass(frozen=True, slots=True)
class Ders:
    """Bir ``Booking`` satırının e-postada gereken özeti."""

    id: int
    tutor_name: str
    student_name: str
    start_at: datetime.datetime
    end_at: datetime.datetime
    mode: str  # "ONLINE" | "IN_PERSON"
    location: str | None = None
    price: str | None = None  # Booking.price ("450.00"); ücretsiz derste None
    is_free_lesson: bool = False

    @property
    def online(self) -> bool:
        return self.mode == "ONLINE"

    @property
    def url(self) -> str:
        return c.site_url(f"{yol.DERS_TALEPLERI}/{self.id}")

    @property
    def canli_url(self) -> str:
        return c.site_url(f"{yol.CANLI_DERS}/{self.id}")

    @property
    def zaman(self) -> str:
        return c.tarih_tr(self.start_at)

    @property
    def sure(self) -> str:
        return c.sure_tr(self.start_at, self.end_at)

    @property
    def sekil(self) -> str:
        if self.online:
            return "Online"
        return f"Yüz yüze · {self.location}" if self.location else "Yüz yüze"

    @property
    def zaman_sure(self) -> str:
        return f"{self.zaman} · {self.sure}"

    @property
    def ucret(self) -> str | None:
        if self.is_free_lesson:
            return "İlk ders ücretsiz"
        return c.tl(self.price) if self.price else None


def _ders_satirlari(
    d: Ders, *, kisi: str | None, ucret: bool = False, zaman: object | None = None
) -> list[tuple[str | None, object, object]]:
    """Ders bilgi satırları. ``kisi``: "tutor" → Öğretmen satırı, "student" → Öğrenci."""
    rows: list[tuple[str | None, object, object]] = []
    if kisi == "tutor":
        rows.append(("kep", "Öğretmen", d.tutor_name))
    elif kisi == "student":
        rows.append(("kisi", "Öğrenci", d.student_name))
    rows.append(("takvim", "Zaman", zaman if zaman is not None else d.zaman_sure))
    rows.append(("online" if d.online else "konum", "Ders şekli", d.sekil))
    if ucret and d.ucret:
        rows.append(("tutar", "Ücret", d.ucret))
    return rows


def _metin(*satirlar: str) -> str:
    return "\n".join(satirlar) + c.text_footer()


def _ders_metni(d: Ders, *, kisi: str | None) -> str:
    parca = []
    if kisi == "tutor":
        parca.append(f"Öğretmen: {d.tutor_name}")
    elif kisi == "student":
        parca.append(f"Öğrenci: {d.student_name}")
    parca += [f"Zaman: {d.zaman_sure}", f"Ders şekli: {d.sekil}"]
    return "\n".join(parca)


def _mail(to: str, subject: str, preheader: str, text: str, blocks, more_cards=()) -> EmailMessage:
    html = c.render(title=subject, preheader=preheader, blocks=blocks, more_cards=more_cards)
    return EmailMessage(to=to, subject=subject, html=html, text=text)


# ─────────────────────────── Öğrenciye ───────────────────────────


def ders_teklifi(
    *,
    to: str,
    ders: Ders,
    tutor_photo_url: str | None = None,
    seri_hafta: int | None = None,
) -> EmailMessage:
    """Öğretmen öğrenciye ders (ya da haftalık seri) teklif etti.

    Olay: ``booking_service._teklif_yaz`` / ``lesson_series_service.create_series``.
    Preply karşılığı: "Start your subscription with …" (öğretmen kartı).
    """
    d = ders
    ne = f"{seri_hafta} haftalık ders serisi" if seri_hafta else "ders"
    subject = f"{d.tutor_name} sana {ne} teklif etti 📚"
    chips = [x for x in (d.ucret, "Online" if d.online else "Yüz yüze") if x]
    return _mail(
        to,
        subject,
        f"{d.zaman} için {ne} teklifi. İnceleyip kabul edebilirsin.",
        _metin(
            f"Merhaba {d.student_name},",
            "",
            f"{d.tutor_name} sana {ne} teklif etti.",
            _ders_metni(d, kisi=None),
            *( [f"Ücret: {d.ucret}"] if d.ucret else [] ),
            "",
            f"Teklifi incele: {d.url}",
        ),
        [
            c.heading(f"{d.tutor_name} sana {ne} teklif etti"),
            c.person_card(d.tutor_name, tutor_photo_url, chips),
            c.paragraph(f"Merhaba {d.student_name},", space=12),
            c.paragraph(
                f"{d.tutor_name} seninle çalışmak istiyor. "
                + (
                    f"İlk ders aşağıdaki saatte; seri {seri_hafta} hafta boyunca her hafta aynı "
                    "gün ve saatte devam eder."
                    if seri_hafta
                    else "Teklifin ayrıntıları aşağıda."
                )
            ),
            c.info_rows(_ders_satirlari(d, kisi=None)),
            c.button("Teklifi incele", d.url),
            c.fine_print("Teklifi kabul edebilir ya da uygun değilse reddedebilirsin."),
        ],
    )


def ders_kesinlesti(
    *, to: str, ders: Ders, odeme_gerekli: bool, dogrudan_odeme: bool = False
) -> EmailMessage:
    """Öğrencinin ders talebi öğretmen tarafından kabul edildi.

    Olay: ``booking_service.accept`` (öğrenci talebi). Emanetli ücretli derste
    ``payment_service.create_for_booking`` ödeme bekler → ``odeme_gerekli``.
    ``dogrudan_odeme``: ``payment_channel == DIRECT`` (ücret öğretmene elden).
    Preply karşılığı: "You booked your first lesson with …".
    """
    d = ders
    if odeme_gerekli:
        subject = f"{d.tutor_name} ders talebini kabul etti — ödemeyi tamamla"
        baslik = "Ders talebin kabul edildi"
        kutu = c.callout(
            "Dersin kesinleşmesi için ücreti ödemen gerekiyor.",
            tone="note",
        )
        dugme = c.button("Ödemeyi tamamla", d.url)
        onizleme = "Dersin kesinleşmesi için ödemeyi tamamla."
    else:
        subject = f"{d.tutor_name} ile dersin kesinleşti 🎉"
        baslik = "Dersin kesinleşti"
        kutu = c.callout(
            "Ders ücretini öğretmenine doğrudan ödersin."
            if dogrudan_odeme
            else f"{d.tutor_name} ders talebini kabul etti. Görüşmek üzere!",
            tone="note" if dogrudan_odeme else "success",
        )
        dugme = c.button("Dersi görüntüle", d.url)
        onizleme = f"{d.zaman} · {d.tutor_name}"
    return _mail(
        to,
        subject,
        onizleme,
        _metin(
            f"Merhaba {d.student_name},",
            "",
            f"{d.tutor_name} ders talebini kabul etti.",
            _ders_metni(d, kisi="tutor"),
            *( [f"Ücret: {d.ucret}"] if d.ucret else [] ),
            "",
            ("Dersin kesinleşmesi için ödemeyi tamamla: " if odeme_gerekli else "Dersi görüntüle: ")
            + d.url,
        ),
        [
            c.heading(baslik),
            c.paragraph(f"Merhaba {d.student_name},", space=12),
            kutu,
            c.info_rows(_ders_satirlari(d, kisi="tutor", ucret=True)),
            dugme,
            c.fine_print(
                "Online derslerde ders odası dersten 15 dakika önce açılır."
                if d.online
                else "Buluşma yerini ders sayfasından görebilir, öğretmeninle mesajlaşabilirsin."
            ),
        ],
    )


def ders_odemesi_alindi(
    *, to: str, ders: Ders, tutar: str
) -> EmailMessage:
    """Öğrencinin ders ödemesi alındı (emanete alındı) — öğrenci makbuzu.

    Olay: ``payment_service.pay`` / ``complete_checkout`` (ödeme HELD). Şu an
    öğrenciye hiçbir teyit gitmiyor; yalnız öğretmen bilgilendiriliyor.
    """
    d = ders
    subject = f"Ödemen alındı — {d.tutor_name} ile dersin kesinleşti"
    para = c.tl(tutar)
    return _mail(
        to,
        subject,
        f"{para} ödemen alındı. Dersin {d.zaman}.",
        _metin(
            f"Merhaba {d.student_name},",
            "",
            f"{para} tutarındaki ödemen alındı. Ücret, ders tamamlanana kadar emanette tutulur.",
            _ders_metni(d, kisi="tutor"),
            "",
            f"Dersi görüntüle: {d.url}",
        ),
        [
            c.heading("Ödemen alındı"),
            c.paragraph(f"Merhaba {d.student_name},", space=12),
            c.callout(
                "Ödemen güvende. Ücret, ders tamamlanana kadar emanette tutulur ve ancak "
                "ders gerçekleştikten sonra öğretmenine aktarılır.",
                tone="success",
            ),
            c.info_rows(
                [
                    ("kep", "Öğretmen", d.tutor_name),
                    ("takvim", "Ders", d.zaman),
                    ("tutar", "Ödenen tutar", para),
                ]
            ),
            c.button("Dersi görüntüle", d.url),
            c.fine_print(
                f"Dersi saatine {_GEC_IPTAL_SAAT} saatten fazla kala iptal edersen ücretin "
                "iade edilir."
            ),
        ],
    )


def ders_hatirlatma(*, to: str, ders: Ders, alici: str) -> EmailMessage:
    """Ders 1 saat sonra başlıyor — öğrenciye ve öğretmene.

    Olay: ``booking_service.send_due_reminders`` (her dakika, ders 1 saat
    kala, ders başına bir kez). ``alici``: "student" | "tutor".
    """
    d = ders
    ben = d.student_name if alici == "student" else d.tutor_name
    karsi_kisi = "tutor" if alici == "student" else "student"
    diger = d.tutor_name if alici == "student" else d.student_name
    subject = f"Dersin 1 saat sonra başlıyor ⏰ — {diger}"
    if d.online:
        dugme = c.button("Derse katıl", d.canli_url)
        not_ = f"Ders odası dersten {_ODA_ACILIS_DK} dakika önce açılır."
        metin_link = f"Derse katıl: {d.canli_url}"
    else:
        dugme = c.button("Ders ayrıntıları", d.url)
        not_ = "Buluşma yerinde bir değişiklik olursa ders sayfasında görünür."
        metin_link = f"Ders ayrıntıları: {d.url}"
    return _mail(
        to,
        subject,
        f"{d.zaman} · {d.sekil}",
        _metin(
            f"Merhaba {ben},",
            "",
            f"{diger} ile dersin 1 saat sonra başlıyor.",
            _ders_metni(d, kisi=karsi_kisi),
            "",
            metin_link,
        ),
        [
            c.heading("Dersin 1 saat sonra başlıyor"),
            c.paragraph(f"Merhaba {ben},", space=12),
            c.paragraph(f"{diger} ile dersin yaklaşıyor. Hazır mısın?"),
            c.info_rows(_ders_satirlari(d, kisi=karsi_kisi)),
            dugme,
            c.fine_print(not_),
        ],
    )


def ders_saati_degisti_ogrenciye(
    *, to: str, ders: Ders, eski_baslangic: datetime.datetime
) -> EmailMessage:
    """Öğretmen dersi başka bir saate aldı; öğrencinin onayı bekleniyor.

    Olay: ``booking_service.reschedule_by_tutor``. Öğrenci reddederse ders
    iptal edilir ve ücretin tamamı iade edilir (``decline_tutor_reschedule``).
    """
    d = ders
    eski = c.tarih_tr(eski_baslangic)
    subject = f"{d.tutor_name} dersini başka bir saate aldı"
    return _mail(
        to,
        subject,
        f"Yeni saat: {d.zaman}. Sana uyuyor mu?",
        _metin(
            f"Merhaba {d.student_name},",
            "",
            f"{d.tutor_name} dersini başka bir saate aldı.",
            f"Eski saat: {eski}",
            f"Yeni saat: {d.zaman}",
            "",
            "Yeni saat uymuyorsa reddedebilirsin; ödediğin ücretin tamamı iade edilir.",
            f"Yanıtla: {d.url}",
        ),
        [
            c.heading("Dersin yeni bir saate alındı"),
            c.paragraph(f"Merhaba {d.student_name},", space=12),
            c.paragraph(f"{d.tutor_name} dersini başka bir saate aldı. Yeni saat sana uyuyor mu?"),
            c.info_rows(
                [
                    ("kep", "Öğretmen", d.tutor_name),
                    ("takvim", "Eski saat", c.strike(eski)),
                    ("takvim", "Yeni saat", d.zaman_sure),
                ]
            ),
            c.callout(
                "Yeni saat uymuyorsa reddedebilirsin; bu durumda ders iptal edilir ve "
                "ödediğin ücretin tamamı iade edilir.",
                tone="note",
            ),
            c.button("Yeni saati onayla", d.url, space=12),
            c.button("Uygun değil", d.url, variant="secondary", space=0),
        ],
    )


def ders_iptal_edildi(
    *,
    to: str,
    ders: Ders,
    alici: str,
    iptal_eden: str,
    neden: str | None = None,
    ucretli: bool = False,
    gec_iptal: bool = False,
) -> EmailMessage:
    """Ders iptal edildi — karşı tarafa (ya da yönetici iptalinde ikisine).

    Olay: ``booking_service.cancel`` / ``cancel_by_admin``.
    ``alici``: "student" | "tutor"; ``iptal_eden``: "student" | "tutor" | "admin".
    ``ucretli``: ders emanetle ödenmişti. ``gec_iptal``: öğrenci derse 12 saatten
    az kala iptal etti → ücret öğretmene ödenir, öğrenciye iade yok.
    Preply karşılığı: "SERHAT deneme dersini iptal etti ❌".
    """
    d = ders
    ben = d.student_name if alici == "student" else d.tutor_name
    if iptal_eden == "admin":
        kim = "Yönetim"
        baslik = "Dersin iptal edildi"
    else:
        kim = d.student_name if iptal_eden == "student" else d.tutor_name
        baslik = f"{kim} dersi iptal etti"
    subject = f"{baslik} ❌"

    kutu = None
    if ucretli and alici == "student":
        if gec_iptal:
            kutu = c.callout(
                f"Ders saatine {_GEC_IPTAL_SAAT} saatten az kala iptal edildiği için ücret "
                "iade edilmez.",
                tone="note",
            )
        else:
            kutu = c.callout(
                "Ödediğin ücretin tamamı iade edilecek. Tutarın hesabına yansıma süresi "
                "bankana göre değişebilir.",
                tone="success",
            )
    elif ucretli and alici == "tutor" and gec_iptal:
        kutu = c.callout(
            f"Ders saatine {_GEC_IPTAL_SAAT} saatten az kala iptal edildiği için ders ücreti "
            "sana ödenecek.",
            tone="success",
        )

    karsi_kisi = "tutor" if alici == "student" else "student"
    blocks = [
        c.heading(baslik),
        c.info_rows(
            [
                ("kep" if karsi_kisi == "tutor" else "kisi",
                 "Öğretmen" if karsi_kisi == "tutor" else "Öğrenci",
                 d.tutor_name if karsi_kisi == "tutor" else d.student_name),
                ("takvim", "Ders", c.fmt("{t} {b}", t=c.strike(d.zaman), b=c.badge("İptal edildi"))),
            ]
        ),
    ]
    if neden:
        blocks.append(c.quote("İptal nedeni", neden))
    if kutu:
        blocks.append(kutu)
    if alici == "student":
        blocks += [
            c.paragraph(
                "Yeni bir saat ayarlamak için öğretmeninle mesajlaşabilir ya da başka "
                "öğretmenlere göz atabilirsin."
            ),
            c.button("Öğretmenime mesaj gönder", c.site_url(yol.MESAJLAR), space=12),
            c.button("Öğretmenlere göz at", c.site_url(yol.EGITMENLER), variant="secondary", space=0),
        ]
    else:
        blocks += [
            c.paragraph("Yeni bir saat önermek için öğrencinle mesajlaşabilirsin."),
            c.button("Öğrencime mesaj gönder", c.site_url(yol.MESAJLAR), space=0),
        ]
    return _mail(
        to,
        subject,
        f"{d.zaman} tarihli ders iptal edildi.",
        _metin(
            f"Merhaba {ben},",
            "",
            f"{d.zaman} tarihli dersin iptal edildi ({kim}).",
            *( [f"İptal nedeni: {neden}"] if neden else [] ),
            "",
            f"Mesajlar: {c.site_url(yol.MESAJLAR)}",
        ),
        [blocks[0], c.paragraph(f"Merhaba {ben},", space=12), *blocks[1:]],
    )


def ders_tamamlandi(*, to: str, ders: Ders, onay_bekliyor: bool) -> EmailMessage:
    """Ders tamamlandı — öğrenciye.

    ``onay_bekliyor=True``: öğretmen dersi tamamlandı işaretledi, öğrenci
    onaylamalı ya da 72 saat içinde sorun bildirmeli (``booking_service.complete``).
    ``onay_bekliyor=False``: ders otomatik tamamlandı, değerlendirme isteği
    (``auto_complete_past_bookings``).
    """
    d = ders
    if onay_bekliyor:
        subject = f"{d.tutor_name} ile dersin tamamlandı mı?"
        baslik = "Dersin gerçekleşti mi?"
        govde = (
            f"{d.tutor_name} dersi tamamlandı olarak işaretledi. Ders gerçekleştiyse onayla; "
            f"bir sorun varsa {_ONAY_SAAT} saat içinde bildir."
        )
        dugme = "Dersi onayla"
        not_ = f"{_ONAY_SAAT} saat içinde yanıt vermezsen ders tamamlanmış sayılır."
    else:
        subject = f"{d.tutor_name} ile dersin nasıl geçti? ⭐"
        baslik = "Dersin nasıl geçti?"
        govde = (
            f"{d.tutor_name} ile dersin tamamlandı. Değerlendirmen hem öğretmenine hem de "
            "öğretmen arayan diğer öğrencilere yardımcı olur."
        )
        dugme = "Dersi değerlendir"
        not_ = "Değerlendirmek bir dakikadan kısa sürer."
    return _mail(
        to,
        subject,
        govde,
        _metin(f"Merhaba {d.student_name},", "", govde, "", f"{dugme}: {d.url}"),
        [
            c.heading(baslik),
            c.paragraph(f"Merhaba {d.student_name},", space=12),
            c.paragraph(govde),
            c.info_rows([("kep", "Öğretmen", d.tutor_name), ("takvim", "Ders", d.zaman)]),
            c.button(dugme, d.url),
            c.fine_print(not_),
        ],
    )


def ders_ucreti_iade_edildi(
    *, to: str, ders: Ders, tutar: str
) -> EmailMessage:
    """İptal edilen dersin ücreti iade edildi.

    Olay: ``payment_service.refund`` → ``escrow.finalize_refund``.
    Preply karşılığı: "We've processed your refund".
    """
    d = ders
    para = c.tl(tutar)
    subject = "Ders ücretin iade edildi"
    return _mail(
        to,
        subject,
        f"{para} iade edildi.",
        _metin(
            f"Merhaba {d.student_name},",
            "",
            f"{d.tutor_name} ile {d.zaman} tarihli dersin için {para} iade edildi.",
            "Tutarın hesabında görünme süresi bankana göre değişebilir.",
            "",
            f"Derslerim: {c.site_url(yol.REZERVASYONLAR)}",
        ),
        [
            c.heading("Ders ücretin iade edildi"),
            c.paragraph(f"Merhaba {d.student_name},", space=12),
            c.paragraph(f"İptal edilen dersin için ödediğin {para} iade edildi."),
            c.info_rows(
                [
                    ("kep", "Öğretmen", d.tutor_name),
                    ("takvim", "Ders", c.strike(d.zaman)),
                    ("tutar", "İade tutarı", para),
                ]
            ),
            c.callout("Tutarın hesabında görünme süresi bankana göre değişebilir.", tone="note"),
            c.button("Derslerimi gör", c.site_url(yol.REZERVASYONLAR), space=0),
        ],
    )


# ─────────────────────────── Öğretmene ───────────────────────────


def yeni_ders_talebi(*, to: str, ders: Ders, ogrenci_notu: str | None = None) -> EmailMessage:
    """Öğrenci öğretmenden ders talep etti.

    Olay: ``booking_service.create_booking``. Preply karşılığı: "SERHAT bir
    deneme dersi ayırttı 🗓️".
    """
    d = ders
    ne = "ücretsiz ilk ders" if d.is_free_lesson else "ders"
    subject = f"{d.student_name} senden {ne} almak istiyor 🗓️"
    blocks = [
        c.heading(f"{d.student_name} senden {ne} almak istiyor"),
        c.paragraph(f"Merhaba {d.tutor_name},", space=12),
        c.paragraph("Yeni bir ders talebin var. Hızlı yanıt vermek, öğrencinle ilk dersi ayarlamanın en kolay yolu."),
        c.info_rows(_ders_satirlari(d, kisi="student", ucret=True)),
    ]
    if ogrenci_notu:
        blocks.append(c.quote(d.student_name, ogrenci_notu))
    blocks += [
        c.button("Talebi incele", d.url),
        c.fine_print("Talebi kabul ettiğinde öğrencine haber veririz."),
    ]
    return _mail(
        to,
        subject,
        f"{d.zaman} · {d.sekil}",
        _metin(
            f"Merhaba {d.tutor_name},",
            "",
            f"{d.student_name} senden {ne} almak istiyor.",
            _ders_metni(d, kisi="student"),
            *( [f"Ücret: {d.ucret}"] if d.ucret else [] ),
            *( ["", f"Öğrencinin notu: {ogrenci_notu}"] if ogrenci_notu else [] ),
            "",
            f"Talebi incele: {d.url}",
        ),
        blocks,
    )


def ders_saati_degisti_ogretmene(
    *, to: str, ders: Ders, eski_baslangic: datetime.datetime
) -> EmailMessage:
    """Öğrenci dersi yeni bir saate taşıdı; öğretmenin onayı bekleniyor.

    Olay: ``booking_service.reschedule`` (ders yeniden PENDING olur).
    """
    d = ders
    eski = c.tarih_tr(eski_baslangic)
    subject = f"{d.student_name} dersi yeni bir saate taşıdı"
    return _mail(
        to,
        subject,
        f"Yeni saat: {d.zaman}. Onayını bekliyor.",
        _metin(
            f"Merhaba {d.tutor_name},",
            "",
            f"{d.student_name} dersi yeni bir saate taşıdı ve onayını bekliyor.",
            f"Eski saat: {eski}",
            f"Yeni saat: {d.zaman}",
            "",
            f"Talebi incele: {d.url}",
        ),
        [
            c.heading(f"{d.student_name} dersi yeni bir saate taşıdı"),
            c.paragraph(f"Merhaba {d.tutor_name},", space=12),
            c.paragraph("Yeni saat onayını bekliyor."),
            c.info_rows(
                [
                    ("kisi", "Öğrenci", d.student_name),
                    ("takvim", "Eski saat", c.strike(eski)),
                    ("takvim", "Yeni saat", d.zaman_sure),
                ]
            ),
            c.button("Talebi incele", d.url, space=0),
        ],
    )


def ders_ucreti_ogretmene(
    *,
    to: str,
    ders: Ders,
    asama: str,
    tutar: str,
    kazanc: str | None = None,
) -> EmailMessage:
    """Ders ücreti — öğretmene.

    ``asama="emanette"``: öğrenci ödedi, ücret emanette (``payment_service.pay``).
    ``asama="aktarildi"``: ders tamamlandı, kazanç bakiyeye eklendi
    (``payment_service.release``; ``kazanc`` = ``tutor_earning``).
    """
    d = ders
    if asama == "emanette":
        para = c.tl(tutar)
        subject = f"{d.student_name} ders ücretini ödedi 💳"
        baslik = "Ders ücreti ödendi"
        kutu = c.callout(
            f"{d.student_name} ders ücretini ödedi. Ücret ders tamamlanana kadar emanette "
            "tutulur, ders sonrası kazancına eklenir.",
            tone="success",
        )
        satir = ("tutar", "Ders ücreti", para)
        dugme = c.button("Dersi görüntüle", d.url, space=0)
        metin_link = f"Dersi görüntüle: {d.url}"
    else:
        para = c.tl(kazanc or tutar)
        subject = f"Kazancın hesabına eklendi: {para} 💰"
        baslik = "Kazancın hesabına eklendi"
        kutu = c.callout(f"{d.student_name} ile dersin tamamlandı. Tebrikler!", tone="success")
        satir = ("tutar", "Kazancın", para)
        dugme = c.button("Bakiyemi gör", c.site_url(yol.BAKIYEM), space=0)
        metin_link = f"Bakiyem: {c.site_url(yol.BAKIYEM)}"
    return _mail(
        to,
        subject,
        f"{para} · {d.student_name} · {d.zaman}",
        _metin(f"Merhaba {d.tutor_name},", "", f"{baslik}: {para}", _ders_metni(d, kisi="student"), "", metin_link),
        [
            c.heading(baslik),
            c.paragraph(f"Merhaba {d.tutor_name},", space=12),
            kutu,
            c.info_rows([("kisi", "Öğrenci", d.student_name), ("takvim", "Ders", d.zaman), satir]),
            dugme,
        ],
    )


def yeni_degerlendirme(
    *, to: str, tutor_name: str, puan: int, yorum: str | None, ogrenci_adi: str | None
) -> EmailMessage:
    """Öğretmen tamamlanan bir ders için değerlendirme aldı.

    Olay: ``review_service.create_review``. ``ogrenci_adi=None``: anonim yorum.
    """
    kim = ogrenci_adi or "Bir öğrencin"
    subject = f"Yeni bir değerlendirme aldın {'⭐' * max(1, min(5, puan))}"
    blocks = [
        c.heading("Yeni bir değerlendirme aldın"),
        c.paragraph(f"Merhaba {tutor_name},", space=12),
        c.paragraph(f"{kim} dersini değerlendirdi."),
        c.info_rows([("deneyim", "Puan", c.fmt("{s} {p}/5", s=c.stars(puan), p=puan))]),
    ]
    if yorum:
        blocks.append(c.quote(kim, yorum))
    blocks += [
        c.button("Değerlendirmeyi gör", c.site_url(yol.DEGERLENDIRMELER), space=0),
    ]
    return _mail(
        to,
        subject,
        f"{kim}: {puan}/5" + (f" · {yorum[:80]}" if yorum else ""),
        _metin(
            f"Merhaba {tutor_name},",
            "",
            f"{kim} dersini değerlendirdi: {puan}/5",
            *( [f"Yorum: {yorum}"] if yorum else [] ),
            "",
            f"Değerlendirmeler: {c.site_url(yol.DEGERLENDIRMELER)}",
        ),
        blocks,
    )


def ilan_inceleniyor(*, to: str, tutor_name: str) -> EmailMessage:
    """Öğretmen ilanını onaya gönderdi.

    Olay: ``tutor_service.submit_for_approval``. Şu an öğretmene hiçbir şey
    gitmiyor. Preply karşılığı: "profilini inceliyoruz ✨".
    """
    govde = (
        "İlanının öğrenciler için hazır ve kurallarımıza uygun olduğundan emin olmak için "
        "ekibimiz ilanını inceliyor. Bir gelişme olduğunda sana hemen haber vereceğiz."
    )
    return _mail(
        to,
        "İlanını inceliyoruz ✨",
        "Ekibimiz ilanını inceliyor; sonucu sana e-postayla bildireceğiz.",
        _metin(f"Merhaba {tutor_name},", "", govde),
        [
            c.heading("Sana yakında dönüş yapacağız"),
            c.paragraph(f"Merhaba {tutor_name},", space=12),
            c.paragraph(govde, space=0),
        ],
    )


def ilan_onaylandi(*, to: str, tutor_name: str) -> EmailMessage:
    """Öğretmenin ilanı onaylandı ve yayına girdi.

    Olay: ``tutor_service.approve`` (onay ve yayın aynı adım). Preply
    karşılığı: "Onaylandın! 🥳" + "Profilin görünür durumda! 🙌".
    """
    return _mail(
        to,
        "İlanın onaylandı ve yayında! 🥳",
        "Öğrenciler artık seni Adana Özel Ders'te bulabilir.",
        _metin(
            f"Merhaba {tutor_name},",
            "",
            "Tebrikler, ilanın onaylandı ve artık yayında! Öğrenciler seni Adana Özel Ders'te bulabilir.",
            "",
            f"Takvimini güncel tut: {c.site_url(yol.TAKVIM)}",
            f"İlanını gör: {c.site_url(yol.ILANIM)}",
        ),
        [
            c.heading("Hadi ders vermeye hazırlanalım!"),
            c.callout(
                f"Tebrikler {tutor_name}, ilanın onaylandı ve artık yayında! Öğrenciler "
                "seni Adana Özel Ders'te bulabilir.",
                tone="success",
            ),
            c.button("İlanımı gör", c.site_url(yol.ILANIM), space=0),
        ],
        more_cards=[
            [
                c.heading("İlk öğrencine hazır ol"),
                c.steps(
                    [
                        (
                            "Takvimini güncel tut",
                            "Müsait saatlerini güncel tut ki öğrenciler sana uygun saatlerde ders talep etsin.",
                        ),
                        (
                            "Mesajlarına hızlı dön",
                            "Hızlı yanıt, öğrencinle ilk dersi ayarlamanın en kolay yolu.",
                        ),
                        (
                            "Tanıtım videosu ekle",
                            "Kısa bir video, öğrencilerin seni tanımasını ve güvenmesini kolaylaştırır.",
                        ),
                    ],
                    space=24,
                ),
                c.button("Takvimimi aç", c.site_url(yol.TAKVIM), variant="secondary", space=0),
            ]
        ],
    )


def ilan_onaylanmadi(*, to: str, tutor_name: str, not_: str | None = None) -> EmailMessage:
    """Öğretmenin ilanı onaylanmadı; düzenleyip yeniden gönderebilir.

    Olay: ``tutor_service.reject``. Kod şu an gerekçe iletmiyor; ``not_``
    verilirse gösterilir. Preply karşılığı: "profilin neredeyse hazır!".
    """
    blocks = [
        c.heading("İlanın neredeyse hazır"),
        c.paragraph(f"Merhaba {tutor_name},", space=12),
        c.paragraph(
            "İlanını inceledik. Yayına alabilmemiz için bazı bölümlerini güncellemen "
            "gerekiyor. Değişiklikleri yapıp ilanını yeniden onaya gönderdiğinde en kısa "
            "sürede tekrar inceleyeceğiz."
        ),
    ]
    if not_:
        blocks.append(c.quote("İnceleme notu", not_))
    blocks += [
        c.button("İlanımı düzenle", c.site_url(yol.ILANIM)),
        c.fine_print(
            c.fmt(
                "Neyin eksik olduğundan emin değil misin? {link}",
                link=c.link("Bize ulaş", c.site_url(yol.ILETISIM)),
            )
        ),
    ]
    return _mail(
        to,
        "İlanın için birkaç düzenleme gerekiyor",
        "İlanını güncelleyip yeniden onaya gönderebilirsin.",
        _metin(
            f"Merhaba {tutor_name},",
            "",
            "İlanını inceledik. Yayına alabilmemiz için bazı bölümlerini güncellemen gerekiyor.",
            *( [f"İnceleme notu: {not_}"] if not_ else [] ),
            "",
            f"İlanını düzenle: {c.site_url(yol.ILANIM)}",
        ),
        blocks,
    )


def tanitim_videosu_incelendi(
    *, to: str, tutor_name: str, onaylandi: bool, not_: str | None = None
) -> EmailMessage:
    """Tanıtım videosu incelendi. Olay: ``tutor_video_service`` (onay / red)."""
    video_url = c.site_url(f"{yol.ILANIM}?bolum=video")
    if onaylandi:
        subject = "Tanıtım videon yayında 🎬"
        blocks = [
            c.heading("Tanıtım videon yayında"),
            c.paragraph(f"Merhaba {tutor_name},", space=12),
            c.callout("Tanıtım videon onaylandı ve artık profilinde görünüyor.", tone="success"),
            c.button("İlanımı gör", c.site_url(yol.ILANIM), space=0),
        ]
        metin = "Tanıtım videon onaylandı ve profilinde yayında."
    else:
        subject = "Tanıtım videon onaylanmadı"
        blocks = [
            c.heading("Tanıtım videon onaylanmadı"),
            c.paragraph(f"Merhaba {tutor_name},", space=12),
            c.paragraph("Yüklediğin tanıtım videosunu yayına alamadık. Yeni bir video yükleyebilirsin."),
        ]
        if not_:
            blocks.append(c.quote("İnceleme notu", not_))
        blocks.append(c.button("Yeni video yükle", video_url, space=0))
        metin = "Tanıtım videon onaylanmadı." + (f" Not: {not_}" if not_ else "")
    return _mail(
        to,
        subject,
        metin,
        _metin(f"Merhaba {tutor_name},", "", metin, "", f"İlanım: {video_url}"),
        blocks,
    )


def para_cekme_odendi(
    *, to: str, tutor_name: str, tutar: str, iban_masked: str | None = None
) -> EmailMessage:
    """Öğretmenin para çekme talebi ödendi. Olay: ``api/routers/payouts.py`` (PAID)."""
    para = c.tl(tutar)
    rows: list[tuple[str | None, object, object]] = [("tutar", "Tutar", para)]
    if iban_masked:
        rows.append(("kart", "Hesap", iban_masked))
    return _mail(
        to,
        f"Para çekme talebin ödendi: {para} 💸",
        f"{para} hesabına gönderildi.",
        _metin(
            f"Merhaba {tutor_name},",
            "",
            f"Para çekme talebin ödendi: {para}.",
            "Tutarın hesabına yansıma süresi bankana göre değişebilir.",
            "",
            f"Bakiyem: {c.site_url(yol.BAKIYEM)}",
        ),
        [
            c.heading("Ödemen hesabına gönderildi"),
            c.paragraph(f"Merhaba {tutor_name},", space=12),
            c.paragraph("Para çekme talebin ödendi."),
            c.info_rows(rows),
            c.callout("Tutarın hesabına yansıma süresi bankana göre değişebilir.", tone="note"),
            c.button("Bakiyemi gör", c.site_url(yol.BAKIYEM), space=0),
        ],
    )


# ─────────────────────────── İki tarafa ───────────────────────────


def yeni_mesajlar(
    *,
    to: str,
    alici_adi: str,
    gonderen_adi: str,
    mesajlar: Sequence[str],
    gonderen_foto_url: str | None = None,
) -> EmailMessage:
    """Okunmamış yeni mesaj(lar) — öğrenciye ya da öğretmene.

    Kullanıcı kararı (28 Eyl 2026): mesaj 15 dakika içinde okunmazsa TEK e-posta
    gider; aynı sohbette art arda gelen mesajlar bu e-postada toplanır.
    ``mesajlar``: okunmamış mesajların metni, eskiden yeniye. Son üçü gösterilir.
    Olay: ``messaging_service.send_message`` (şu an e-posta ve bildirim yok).
    Preply karşılığı: "Emre bir mesaj gönderdi!" / "New message from … ✉️".
    """
    n = len(mesajlar)
    son = list(mesajlar)[-3:]
    baslik = (
        f"{gonderen_adi} sana bir mesaj gönderdi"
        if n == 1
        else f"{gonderen_adi} sana {n} mesaj gönderdi"
    )
    blocks = [c.heading(baslik), c.paragraph(f"Merhaba {alici_adi},", space=16)]
    if n > len(son):
        # Gösterilmeyenler en ESKİ mesajlar; not bu yüzden kartın üstünde durur.
        blocks.append(c.fine_print(f"Önceki {n - len(son)} mesaj daha var", space=8))
    blocks.append(
        c.quote(
            gonderen_adi,
            "\n\n".join(m[:400] + ("…" if len(m) > 400 else "") for m in son),
            avatar_url=gonderen_foto_url,
            with_avatar=True,
        )
    )
    blocks.append(c.button("Mesajı görüntüle ve yanıtla", c.site_url(yol.MESAJLAR), space=0))
    return _mail(
        to,
        f"{baslik} ✉️",
        son[-1][:120],
        _metin(
            f"Merhaba {alici_adi},",
            "",
            f"{baslik}:",
            *[f"> {m}" for m in son],
            "",
            f"Yanıtla: {c.site_url(yol.MESAJLAR)}",
        ),
        blocks,
    )
