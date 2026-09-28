"""İşlemsel e-posta kataloğu.

Her fonksiyon tek bir ``EmailMessage`` (konu + düz metin + HTML) üretir.
Yerleşim ve bileşenler ``core.mail.components`` içindedir; burada yalnız
metin ve hangi bileşenin kullanılacağı durur.

Bütün şablonlar aynı sırayı izler (Preply düzeni): ortalı başlık →
selamlama → gövde → bilgi satırları / durum kutusu → düğme → küçük not.
Logo ve footer ``render`` tarafından eklenir.
"""
from __future__ import annotations

from core.config import settings
from core.mail import components as c
from core.mail.base import EmailMessage

_BRAND = c.BRAND


def verification_email(*, to: str, name: str, verify_url: str) -> EmailMessage:
    ttl = settings.EMAIL_VERIFY_TOKEN_TTL_HOURS
    subject = f"{_BRAND} · E-posta adresini doğrula"
    text = (
        f"Merhaba {name},\n\n"
        f"{_BRAND} hesabını etkinleştirmek için e-posta adresini doğrula:\n"
        f"{verify_url}\n\n"
        f"Bu bağlantı {ttl} saat geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı yok sayabilirsin."
        + c.text_footer()
    )
    html = c.render(
        title=subject,
        preheader=f"Hesabını etkinleştirmek için tek adım kaldı. Bağlantı {ttl} saat geçerli.",
        blocks=[
            c.heading(f"Aramıza hoş geldin, {name}!"),
            c.paragraph(
                f"{_BRAND} hesabını etkinleştirmek için e-posta adresini doğrula.",
                space=24,
            ),
            c.button("E-posta adresimi doğrula", verify_url),
            c.fine_print(
                f"Bağlantı {ttl} saat geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı "
                "yok sayabilirsin."
            ),
        ],
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


def account_delete_email(*, to: str, name: str, confirm_url: str) -> EmailMessage:
    """Hesap silme onayı — parolası olmayan (Google ile açılmış) hesaplar için.

    Metin bilerek uyarıcı: silme geri alınamaz ve mali kayıtlar mevzuat gereği
    kalır. Talebi yapmayan biri için de açık bir "hiçbir şey olmadı" cümlesi var.
    """
    ttl = settings.PASSWORD_RESET_TOKEN_TTL_HOURS
    subject = f"{_BRAND} · Hesap silme onayı"
    text = (
        f"Merhaba {name},\n\n"
        f"Hesabını silme talebini onaylamak için aşağıdaki bağlantıya tıkla:\n"
        f"{confirm_url}\n\n"
        f"Bu işlem GERİ ALINAMAZ. Bağlantı {ttl} saat geçerlidir. "
        f"Bu talebi sen yapmadıysan hesabına hiçbir şey olmaz; bu e-postayı yok sayabilirsin."
        + c.text_footer()
    )
    html = c.render(
        title=subject,
        preheader="Hesabını silme talebini aldık. Onaylamadan hiçbir şey silinmez.",
        blocks=[
            c.heading("Hesabını silmek istediğini onayla"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph("Hesabını silme talebini aldık. Onaylamak için aşağıdaki düğmeye tıkla."),
            c.callout(
                "Bu işlem GERİ ALINAMAZ. Hesabın silindikten sonra geri getirilemez.",
                tone="warning",
            ),
            c.button("Hesabımı sil", confirm_url),
            c.fine_print(
                f"Bağlantı {ttl} saat geçerlidir. Bu talebi sen yapmadıysan hesabına hiçbir "
                "şey olmaz; bu e-postayı yok sayabilirsin."
            ),
        ],
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


def password_reset_email(*, to: str, name: str, reset_url: str) -> EmailMessage:
    ttl = settings.PASSWORD_RESET_TOKEN_TTL_HOURS
    subject = f"{_BRAND} · Şifre sıfırlama"
    text = (
        f"Merhaba {name},\n\n"
        f"Şifreni sıfırlamak için aşağıdaki bağlantıya tıkla:\n"
        f"{reset_url}\n\n"
        f"Bu bağlantı {ttl} saat geçerlidir. Bu talebi sen yapmadıysan şifren değişmez; "
        f"bu e-postayı yok sayabilirsin."
        + c.text_footer()
    )
    html = c.render(
        title=subject,
        preheader=f"Şifreni sıfırlama bağlantın hazır. {ttl} saat geçerli.",
        blocks=[
            c.heading("Şifreni sıfırla"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph(
                "Hesabının şifresini sıfırlamak için bir talep aldık. Bu talebi sen "
                "yaptıysan aşağıdaki düğmeyle yeni şifreni belirleyebilirsin.",
                space=24,
            ),
            c.button("Şifremi sıfırla", reset_url),
            c.fine_print(
                f"Bağlantı {ttl} saat geçerlidir. Bu talebi sen yapmadıysan şifren değişmez; "
                "bu e-postayı yok sayabilirsin."
            ),
        ],
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


# Mağaza sipariş durumu e-postaları.
# (konu eki, başlık, gövde kuyruğu, preheader, durum kutusu)
_ORDER_COPY: dict[str, tuple[str, str, str, str, str]] = {
    "PAID": (
        "Siparişin alındı",
        "Siparişin alındı",
        "ödemen onaylandı, siparişin hazırlanıyor.",
        "Ödemen onaylandı, siparişini hazırlamaya başladık.",
        "Ödemen onaylandı. Siparişini hazırlamaya başladık.",
    ),
    "SHIPPED": (
        "Siparişin kargoya verildi",
        "Siparişin yolda",
        "siparişin kargoya verildi.",
        "Siparişin kargoya verildi, yakında kapında.",
        "Siparişin kargoya verildi. Yakında kapında!",
    ),
    "DELIVERED": (
        "Siparişin teslim edildi",
        "Siparişin teslim edildi",
        "siparişin teslim edildi. Afiyet olsun!",
        "Siparişin teslim edildi. İyi çalışmalar!",
        "Siparişin teslim edildi. İyi çalışmalar!",
    ),
    "REFUNDED": (
        "Ödemen iade edildi",
        "İaden tamamlandı",
        "siparişin için ödemen iade edildi.",
        "Siparişin için ödemen iade edildi.",
        "",
    ),
}
_ORDER_FALLBACK = (
    "Sipariş güncellemesi",
    "Sipariş güncellemesi",
    "siparişinde bir güncelleme var.",
    "Siparişinde bir güncelleme var.",
    "",
)


def order_status_email(
    *, to: str, name: str, order_id: int, status: str, total: str, currency: str, orders_url: str
) -> EmailMessage:
    subject_base, heading, intro_tail, preheader, success = _ORDER_COPY.get(
        status, _ORDER_FALLBACK
    )
    subject = f"{_BRAND} · {subject_base} (#{order_id})"
    money = f"{total} {currency}"
    text = (
        f"Merhaba {name},\n\n"
        f"#{order_id} numaralı {intro_tail}\n"
        f"Tutar: {money}\n\n"
        f"Siparişlerini görüntüle: {orders_url}"
        + c.text_footer()
    )
    blocks = [c.heading(heading), c.paragraph(f"Merhaba {name},", space=12)]
    if status == "REFUNDED":
        blocks += [
            c.paragraph(
                f"#{order_id} numaralı siparişin için {money} tutarındaki ödemen iade edildi."
            ),
            c.info_rows([("siparis", "Sipariş no", f"#{order_id}"), ("tutar", "İade tutarı", money)]),
            c.callout("Tutarın hesabında görünme süresi bankana göre değişebilir.", tone="note"),
        ]
    else:
        # Durum kutusu varsa gövde cümlesinin yerini alır (aynı bilgi iki kez yazılmaz).
        if success:
            blocks.append(c.callout(success, tone="success"))
        else:
            blocks.append(c.paragraph(f"#{order_id} numaralı {intro_tail}"))
        blocks.append(
            c.info_rows([("siparis", "Sipariş no", f"#{order_id}"), ("tutar", "Tutar", money)])
        )
    blocks += [
        c.button("Siparişlerimi gör", orders_url),
        c.fine_print(
            c.fmt("Bir sorun mu var? {link}", link=c.link("Bize ulaş", c.site_url("/iletisim")))
        ),
    ]
    html = c.render(title=subject, preheader=preheader, blocks=blocks)
    return EmailMessage(to=to, subject=subject, html=html, text=text)


def back_in_stock_email(*, to: str, product_title: str, product_url: str) -> EmailMessage:
    subject = f"{_BRAND} · '{product_title}' yeniden stokta"
    text = (
        f"Merhaba,\n\n"
        f"İlgilendiğin '{product_title}' yeniden stokta!\n"
        f"{product_url}\n\n"
        f"Stoklar tükenmeden sipariş verebilirsin."
        + c.text_footer()
    )
    html = c.render(
        title=subject,
        preheader=f"{product_title} yeniden stokta. Stoklar tükenmeden sipariş verebilirsin.",
        blocks=[
            c.heading("Beklediğin ürün yeniden stokta!"),
            c.paragraph("Stok bildirimi istediğin ürün tekrar satışta."),
            c.info_rows([("urun", "Ürün", product_title)]),
            c.button("Ürüne git", product_url),
            c.fine_print("Stoklar tükenmeden sipariş verebilirsin."),
        ],
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


def contact_message_email(
    *,
    to: str,
    from_name: str,
    from_email: str,
    subject: str,
    message: str,
    user_ref: str | None = None,
) -> EmailMessage:
    """İletişim formundan gelen mesajı işletmeye iletir.

    ``to`` platformun destek adresidir; gönderen alanı DEĞİŞTİRİLMEZ (SPF/DKIM
    kırılmasın) — kullanıcının adresi gövdede ve Reply-To semantiğiyle metinde
    verilir.
    """
    who = f"{from_name} <{from_email}>"
    if user_ref:
        who += f" (hesap: {user_ref})"
    body = (
        f"Yeni iletişim formu mesajı\n"
        f"{'-' * 40}\n"
        f"Gönderen: {who}\n"
        f"Konu: {subject}\n\n"
        f"{message}\n\n"
        f"{'-' * 40}\n"
        f"Yanıtlamak için doğrudan {from_email} adresine yazın."
    )
    rows: list[tuple[str | None, object, object]] = [
        ("eposta", "E-posta", from_email),
        ("mesaj", "Konu", subject),
    ]
    if user_ref:
        rows.append(("kisi", "Hesap", user_ref))
    html = c.render(
        title=f"[İletişim] {subject}",
        preheader=f"{from_name}: {message[:90]}",
        blocks=[
            c.tag("İletişim formu"),
            c.heading(f"{from_name} bir mesaj gönderdi"),
            c.quote(from_name, message),
            c.info_rows(rows),
            c.button("Yanıtla", f"mailto:{from_email}"),
            c.fine_print(f"Yanıtlamak için doğrudan {from_email} adresine yazın."),
        ],
    )
    return EmailMessage(to=to, subject=f"[İletişim] {subject}", text=body, html=html)


def tutor_lead_email(
    *,
    to: str,
    name: str,
    phone: str,
    subjects: str,
    email: str | None = None,
    district: str | None = None,
    experience: str | None = None,
    note: str | None = None,
    document_count: int = 0,
    has_photo: bool = False,
) -> EmailMessage:
    """Eğitmen ön başvurusunu işletme kutusuna iletir.

    Dönüş kanalı telefondur; teyit maili bu yüzden yoktur. Belgelerin kendisi
    maile EKLENMEZ (private/ altında dururlar) — panel linkinden açılır.
    """
    lines = [
        "Yeni eğitmen ön başvurusu",
        "-" * 40,
        f"Ad Soyad: {name}",
        f"Telefon: {phone}",
        f"Dersler: {subjects}",
    ]
    rows: list[tuple[str | None, object, object]] = [
        ("telefon", "Telefon", phone),
        ("kitap", "Dersler", subjects),
    ]
    if email:
        lines.append(f"E-posta: {email}")
        rows.append(("eposta", "E-posta", email))
    if district:
        lines.append(f"İlçe: {district}")
        rows.append(("konum", "İlçe", district))
    if experience:
        lines.append(f"Deneyim: {experience}")
        rows.append(("deneyim", "Deneyim", experience))
    if document_count:
        lines.append(f"Belge: {document_count} dosya (panelden görüntülenir)")
        rows.append(("belge", "Belge", f"{document_count} dosya"))
    if has_photo:
        lines.append("Profil fotoğrafı: var (panelden görüntülenir)")
        rows.append(("foto", "Profil fotoğrafı", "var"))
    if note:
        lines.append(f"\nNot:\n{note}")
    lines += ["", "-" * 40, "Kayıt, yönetim panelindeki Eğitmen Başvuruları listesinde."]
    body = "\n".join(lines)

    blocks = [
        c.tag("Eğitmen ön başvurusu"),
        c.heading(f"{name} eğitmen olmak istiyor"),
        c.info_rows(rows),
    ]
    if note:
        blocks.append(c.quote(name, note))
    blocks.append(
        c.fine_print(
            "Belge ve fotoğraflar yönetim panelindeki Eğitmen Başvuruları listesinde görüntülenir."
        )
    )
    html = c.render(
        title=f"[Ön Başvuru] {name}",
        preheader=f"{name} · {subjects}",
        blocks=blocks,
    )
    return EmailMessage(to=to, subject=f"[Ön Başvuru] {name}", text=body, html=html)


def contact_ack_email(*, to: str, name: str, subject: str) -> EmailMessage:
    """Gönderene 'mesajını aldık' teyidi (kullanıcı boşluğa yazmasın)."""
    body = (
        f"Merhaba {name},\n\n"
        f"\"{subject}\" konulu mesajını aldık. En kısa sürede dönüş yapacağız.\n\n"
        f"Bu otomatik bir bilgilendirmedir; yanıtlaman gerekmiyor.\n\n"
        f"Adana Özel Ders"
    )
    mail_subject = f"{_BRAND} · Mesajını aldık"
    html = c.render(
        title=mail_subject,
        preheader=f"\"{subject}\" konulu mesajını aldık. En kısa sürede dönüş yapacağız.",
        blocks=[
            c.heading("Mesajını aldık"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph("Bize yazdığın için teşekkürler. En kısa sürede dönüş yapacağız."),
            c.info_rows([("mesaj", "Konu", subject)], space=0),
        ],
    )
    return EmailMessage(to=to, subject=mail_subject, text=body, html=html)


def payout_changed_email(*, to: str, name: str, iban_masked: str) -> EmailMessage:
    """Ödeme hesabı (IBAN) değişti bildirimi — güvenlik uyarısıdır, pazarlama değil.

    Ele geçirilmiş bir hesapta saldırganın ilk yapacağı şey para hedefini kendi
    IBAN'ına çevirmektir. Uygulama içi bildirim burada yetmez (saldırgan onu görür
    ve okundu işaretler); asıl koruma, sahibinin e-posta kutusuna düşen bu mesajdır.

    Düğmeler oturum gerektirmeyen sayfalara gider: hesap ele geçirilmişse sahibi
    giriş yapamıyor olabilir.
    """
    subject = f"{_BRAND} · Ödeme hesabın güncellendi"
    body = (
        f"Merhaba {name},\n\n"
        "Hesabındaki ödeme bilgisi (IBAN) güncellendi.\n"
        f"Yeni IBAN: {iban_masked}\n\n"
        "Bu işlemi sen yapmadıysan hesabın başkasının eline geçmiş olabilir: "
        "hemen şifreni değiştir ve bizimle iletişime geç.\n"
        f"Şifreni sıfırla: {c.site_url('/sifremi-unuttum')}\n"
        f"Bize ulaş: {c.site_url('/iletisim')}\n\n"
        f"{_BRAND}"
    )
    html = c.render(
        title=subject,
        preheader="Hesabındaki ödeme bilgisi (IBAN) güncellendi. Sen yapmadıysan hemen bize ulaş.",
        blocks=[
            c.heading("Ödeme hesabın güncellendi"),
            c.paragraph(f"Merhaba {name},", space=12),
            c.paragraph("Hesabındaki ödeme bilgisi (IBAN) değiştirildi."),
            c.info_rows([("kart", "Yeni IBAN", iban_masked), ("saat", "Tarih", c.now_tr())]),
            c.callout(
                "Bu işlemi sen yapmadıysan hesabın başkasının eline geçmiş olabilir: hemen "
                "şifreni değiştir ve bizimle iletişime geç.",
                tone="warning",
            ),
            c.button("Şifremi sıfırla", c.site_url("/sifremi-unuttum"), space=12),
            c.button("Bize ulaş", c.site_url("/iletisim"), variant="secondary", space=0),
        ],
    )
    return EmailMessage(to=to, subject=subject, text=body, html=html)
