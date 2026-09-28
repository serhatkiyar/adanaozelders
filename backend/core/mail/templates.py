"""İşlemsel e-posta kataloğu.

Her fonksiyon tek bir ``EmailMessage`` (konu + düz metin + HTML) üretir.
Yerleşim ve bileşenler ``core.mail.components`` içindedir; burada yalnız
metin ve hangi bileşenin kullanılacağı durur. Figma referansı her şablonun
docstring'inde yazar (dosya: BRIX "120+ Email templates", sayfa
``🎨 Email Templates``).

Bütün şablonlar aynı sırayı izler: logo → başlık → gövde → (kart) → düğme →
not. Düzen standardı ``components`` modülünün başında yazar.
"""
from __future__ import annotations

from core.config import settings
from core.mail import components as c
from core.mail.base import EmailMessage

_BRAND = c.BRAND


def verification_email(*, to: str, name: str, verify_url: str) -> EmailMessage:
    """Figma: Email Verification 01 (18216:2888) — kod kutusu yerine düğme
    (akış bağlantı tabanlı), altta geçerlilik notu."""
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
            c.logo(),
            c.heading("E-posta adresini doğrula"),
            c.paragraph(
                f"Merhaba {name}, kaydın için teşekkürler! {_BRAND} hesabını "
                "etkinleştirmek için aşağıdaki düğmeye tıkla."
            ),
            c.button("E-postamı doğrula", verify_url),
            c.note(
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

    Figma: Password Reset 02 (18202:2021) düzeni + Security Alert 01 (18641:5987)
    bilgi kartı.
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
            c.logo(aside=c.now_tr()),
            c.heading("Hesabını silmek istediğini onayla"),
            c.paragraph(
                f"Merhaba {name}, hesabını silme talebini aldık. Bu işlem GERİ ALINAMAZ; "
                "onaylamak için aşağıdaki düğmeye tıkla."
            ),
            c.info_card(
                [
                    ("İşlem", "Hesap silme"),
                    ("Bağlantı geçerliliği", f"{ttl} saat"),
                ]
            ),
            c.button("Hesabımı sil", confirm_url),
            c.note(
                "Bu talebi sen yapmadıysan hesabına hiçbir şey olmaz; bu e-postayı yok "
                "sayabilirsin."
            ),
        ],
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


def password_reset_email(*, to: str, name: str, reset_url: str) -> EmailMessage:
    """Figma: Password Reset 02 (18202:2021) — solda logo + tarih şeridi, başlık,
    "talebi sen yaptıysan" yönlendirmesi, koyu düğme. Harita/cihaz kartı
    alınmadı: cihaz/konum verisi toplanmıyor."""
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
            c.logo(aside=c.now_tr()),
            c.heading("Şifreni sıfırla"),
            c.paragraph(
                f"Merhaba {name}, hesabının şifresini sıfırlamak için bir talep aldık. "
                "Bu talebi sen yaptıysan aşağıdan devam et."
            ),
            c.button("Şifremi sıfırla", reset_url),
            c.note(
                f"Bağlantı {ttl} saat geçerlidir. Bu talebi sen yapmadıysan şifren değişmez; "
                "bu e-postayı yok sayabilirsin."
            ),
        ],
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


# Mağaza sipariş durumu e-postaları. (başlık-eki, heading, intro-kuyruğu, preheader)
_ORDER_COPY: dict[str, tuple[str, str, str, str]] = {
    "PAID": (
        "Siparişin alındı",
        "Siparişin alındı",
        "ödemen onaylandı, siparişin hazırlanıyor.",
        "Ödemen onaylandı, siparişini hazırlamaya başladık.",
    ),
    "SHIPPED": (
        "Siparişin kargoya verildi",
        "Siparişin yolda",
        "siparişin kargoya verildi.",
        "Siparişin kargoya verildi, yakında kapında.",
    ),
    "DELIVERED": (
        "Siparişin teslim edildi",
        "Siparişin teslim edildi",
        "siparişin teslim edildi. Afiyet olsun!",
        "Siparişin teslim edildi. İyi çalışmalar!",
    ),
    "REFUNDED": (
        "Ödemen iade edildi",
        "İaden tamamlandı",
        "siparişin için ödemen iade edildi.",
        "Siparişin için ödemen iade edildi.",
    ),
}
_ORDER_FALLBACK = (
    "Sipariş güncellemesi",
    "Sipariş güncellemesi",
    "siparişinde bir güncelleme var.",
    "Siparişinde bir güncelleme var.",
)
# İlerleme çubuğundaki adım sırası; iade/bilinmeyen durum çubuk göstermez.
_ORDER_STEPS = ("Alındı", "Kargoda", "Teslim edildi")
_ORDER_STEP_INDEX = {"PAID": 0, "SHIPPED": 1, "DELIVERED": 2}


def order_status_email(
    *, to: str, name: str, order_id: int, status: str, total: str, currency: str, orders_url: str
) -> EmailMessage:
    """Figma: Order Confirmation 01 (18149:1826) sipariş kartı + Multi-step
    Progress 01 (18658:5123) adım çubuğu. İade durumu: Refund Processed 01
    (18703:2357) durum listesi."""
    subject_base, heading, intro_tail, preheader = _ORDER_COPY.get(status, _ORDER_FALLBACK)
    subject = f"{_BRAND} · {subject_base} (#{order_id})"
    money = f"{total} {currency}"
    text = (
        f"Merhaba {name},\n\n"
        f"#{order_id} numaralı {intro_tail}\n"
        f"Tutar: {money}\n\n"
        f"Siparişlerini görüntüle: {orders_url}"
        + c.text_footer()
    )
    blocks = [
        c.logo(),
        c.heading(heading),
        c.paragraph(f"Merhaba {name}, #{order_id} numaralı {intro_tail}"),
    ]
    step = _ORDER_STEP_INDEX.get(status)
    if step is not None:
        blocks.append(c.progress_steps(_ORDER_STEPS, step))
    if status == "REFUNDED":
        blocks.append(
            c.timeline(
                [
                    ("İade işlendi", f"#{order_id} numaralı siparişin için {money} iade edildi.", True),
                    (
                        "Hesabına yansıması",
                        "Tutarın hesabında görünme süresi bankana göre değişebilir.",
                        False,
                    ),
                ]
            )
        )
    else:
        blocks.append(c.info_card([("Sipariş no", f"#{order_id}"), ("Tutar", money)]))
    blocks += [
        c.button("Siparişlerimi gör", orders_url),
        c.note(
            c.fmt(
                "Bir sorun mu var? {link}",
                link=c.link("Bize ulaş", c.site_url("/iletisim")),
            )
        ),
    ]
    html = c.render(title=subject, preheader=preheader, blocks=blocks)
    return EmailMessage(to=to, subject=subject, html=html, text=text)


def back_in_stock_email(*, to: str, product_title: str, product_url: str) -> EmailMessage:
    """Figma: New Notification 01 (18580:3087) — başlık, içerik kartı, tam
    genişlik düğme. Avatar yerine ürün kartı (ürün görseli bu akışta taşınmıyor)."""
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
            c.logo(),
            c.heading("Yeniden stokta!"),
            c.paragraph(
                "Beklediğin ürün tekrar satışta. Stoklar tükenmeden sipariş verebilirsin."
            ),
            c.info_card([("Ürün", product_title)]),
            c.button("Ürüne git", product_url, space=0),
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

    İç e-posta: ortak düzen + bilgi kartı ve mesaj kartı.
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
    rows: list[tuple[object, object]] = [("Gönderen", from_name), ("E-posta", from_email)]
    if user_ref:
        rows.append(("Hesap", user_ref))
    html = c.render(
        title=f"[İletişim] {subject}",
        preheader=f"{from_name}: {message[:90]}",
        blocks=[
            c.logo(),
            c.tag("İletişim formu"),
            c.heading(subject),
            c.info_card(rows),
            c.message_card("Mesaj", message),
            c.note(
                c.fmt(
                    "Yanıtlamak için doğrudan {mail} adresine yazın.",
                    mail=c.link(from_email, f"mailto:{from_email}"),
                )
            ),
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

    İç e-posta: ortak düzen + bilgi kartı + not kartı.
    """
    lines = [
        "Yeni eğitmen ön başvurusu",
        "-" * 40,
        f"Ad Soyad: {name}",
        f"Telefon: {phone}",
        f"Dersler: {subjects}",
    ]
    rows: list[tuple[object, object]] = [
        ("Ad Soyad", name),
        ("Telefon", phone),
        ("Dersler", subjects),
    ]
    if email:
        lines.append(f"E-posta: {email}")
        rows.append(("E-posta", email))
    if district:
        lines.append(f"İlçe: {district}")
        rows.append(("İlçe", district))
    if experience:
        lines.append(f"Deneyim: {experience}")
        rows.append(("Deneyim", experience))
    if document_count:
        lines.append(f"Belge: {document_count} dosya (panelden görüntülenir)")
        rows.append(("Belge", f"{document_count} dosya (panelden görüntülenir)"))
    if has_photo:
        lines.append("Profil fotoğrafı: var (panelden görüntülenir)")
        rows.append(("Profil fotoğrafı", "var (panelden görüntülenir)"))
    if note:
        lines.append(f"\nNot:\n{note}")
    lines += ["", "-" * 40, "Kayıt, yönetim panelindeki Eğitmen Başvuruları listesinde."]
    body = "\n".join(lines)

    blocks = [
        c.logo(),
        c.tag("Eğitmen ön başvurusu"),
        c.heading(name),
        c.info_card(rows),
    ]
    if note:
        blocks.append(c.message_card("Not", note))
    blocks.append(c.note("Kayıt, yönetim panelindeki Eğitmen Başvuruları listesinde."))
    html = c.render(
        title=f"[Ön Başvuru] {name}",
        preheader=f"{name} · {subjects}",
        blocks=blocks,
    )
    return EmailMessage(to=to, subject=f"[Ön Başvuru] {name}", text=body, html=html)


def contact_ack_email(*, to: str, name: str, subject: str) -> EmailMessage:
    """Gönderene 'mesajını aldık' teyidi (kullanıcı boşluğa yazmasın).

    Figma: New Notification 01 (18580:3087) — başlık, içerik kartı; düğme yok
    (yapılacak bir eylem yok).
    """
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
            c.logo(),
            c.heading("Mesajını aldık"),
            c.paragraph(
                f"Merhaba {name}, bize yazdığın için teşekkürler. En kısa sürede "
                "dönüş yapacağız."
            ),
            c.info_card([("Konu", subject)], space=0),
        ],
    )
    return EmailMessage(to=to, subject=mail_subject, text=body, html=html)


def payout_changed_email(*, to: str, name: str, iban_masked: str) -> EmailMessage:
    """Ödeme hesabı (IBAN) değişti bildirimi — güvenlik uyarısıdır, pazarlama değil.

    Ele geçirilmiş bir hesapta saldırganın ilk yapacağı şey para hedefini kendi
    IBAN'ına çevirmektir. Uygulama içi bildirim burada yetmez (saldırgan onu görür
    ve okundu işaretler); asıl koruma, sahibinin e-posta kutusuna düşen bu mesajdır.

    Figma: Security Alert 01 (18641:5987) — bilgi kartı ve iki düğme
    ("şifremi sıfırla" / "bize ulaş"). Düğmeler oturum gerektirmeyen sayfalara
    gider: hesap ele geçirilmişse sahibi giriş yapamıyor olabilir.
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
            c.logo(aside=c.now_tr()),
            c.heading("Ödeme hesabın güncellendi"),
            c.paragraph(
                f"Merhaba {name}, hesabındaki ödeme bilgisi (IBAN) değiştirildi. "
                "Bu işlemi sen yapmadıysan hesabın başkasının eline geçmiş olabilir: "
                "hemen şifreni değiştir ve bizimle iletişime geç."
            ),
            c.info_card([("Yeni IBAN", iban_masked), ("Tarih", c.now_tr())]),
            c.button_pair(
                ("Şifremi sıfırla", c.site_url("/sifremi-unuttum")),
                ("Bize ulaş", c.site_url("/iletisim")),
                space=0,
            ),
        ],
    )
    return EmailMessage(to=to, subject=subject, text=body, html=html)
