from __future__ import annotations

from core.config import settings
from core.mail.base import EmailMessage

_BRAND = "Adana Özel Ders"


def _layout(*, heading: str, intro: str, button_label: str, button_url: str, outro: str) -> str:
    """Inline-stilli basit, markalı HTML şablonu (e-posta istemcileri inline ister)."""
    return f"""\
<!DOCTYPE html>
<html lang="tr">
<body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="background:#4f46e5;padding:20px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;">{_BRAND}</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">{heading}</h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#475569;">{intro}</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#4f46e5;">
            <a href="{button_url}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">{button_label}</a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:12px;line-height:20px;color:#94a3b8;">{outro}</p>
          <p style="margin:16px 0 0;font-size:12px;line-height:20px;color:#94a3b8;word-break:break-all;">
            Buton çalışmazsa bu bağlantıyı tarayıcına yapıştır:<br>{button_url}
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
          <span style="font-size:11px;color:#cbd5e1;">© {_BRAND}</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _plain_html(text: str) -> str:
    """Düz metin gövdeyi asgari HTML'e sarar.

    `EmailMessage` çoklu-parçadır: hem `text` hem `html` ister. Butonlu markalı
    şablona ihtiyaç duymayan bildirimler (iletişim formu, güvenlik uyarısı)
    buradan geçer — alanı boş bırakmak yerine okunabilir bir karşılık üretir.
    """
    escaped = (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    return (
        '<div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
        'font-size:14px;line-height:22px;color:#0f172a;white-space:pre-wrap;">'
        f"{escaped}</div>"
    )


def verification_email(*, to: str, name: str, verify_url: str) -> EmailMessage:
    ttl = settings.EMAIL_VERIFY_TOKEN_TTL_HOURS
    subject = f"{_BRAND} · E-posta adresini doğrula"
    text = (
        f"Merhaba {name},\n\n"
        f"{_BRAND} hesabını etkinleştirmek için e-posta adresini doğrula:\n"
        f"{verify_url}\n\n"
        f"Bu bağlantı {ttl} saat geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı yok sayabilirsin."
    )
    html = _layout(
        heading="E-posta adresini doğrula",
        intro=f"Merhaba <b>{name}</b>, {_BRAND} hesabını etkinleştirmek için aşağıdaki butona tıkla.",
        button_label="E-postamı doğrula",
        button_url=verify_url,
        outro=f"Bağlantı {ttl} saat geçerlidir. Bu kaydı sen yapmadıysan bu e-postayı yok sayabilirsin.",
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
    )
    html = _layout(
        heading="Hesabını silmek istediğini onayla",
        intro=(
            f"Merhaba <b>{name}</b>, hesabını silme talebini aldık. "
            f"Onaylamak için aşağıdaki butona tıkla."
        ),
        button_label="Hesabımı sil",
        button_url=confirm_url,
        outro=(
            f"Bu işlem GERİ ALINAMAZ. Bağlantı {ttl} saat geçerlidir. "
            f"Bu talebi sen yapmadıysan hesabına hiçbir şey olmaz."
        ),
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
    )
    html = _layout(
        heading="Şifreni sıfırla",
        intro=f"Merhaba <b>{name}</b>, hesabının şifresini sıfırlamak için aşağıdaki butona tıkla.",
        button_label="Şifremi sıfırla",
        button_url=reset_url,
        outro=(
            f"Bağlantı {ttl} saat geçerlidir. Bu talebi sen yapmadıysan şifren değişmez; "
            f"bu e-postayı yok sayabilirsin."
        ),
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


# Mağaza sipariş durumu e-postaları. (başlık-eki, heading, intro-kuyruğu)
_ORDER_COPY: dict[str, tuple[str, str, str]] = {
    "PAID": ("Siparişin alındı", "Siparişin alındı", "ödemen onaylandı, siparişin hazırlanıyor."),
    "SHIPPED": ("Siparişin kargoya verildi", "Siparişin yolda", "siparişin kargoya verildi."),
    "DELIVERED": ("Siparişin teslim edildi", "Siparişin teslim edildi", "siparişin teslim edildi. Afiyet olsun!"),
    "REFUNDED": ("Ödemen iade edildi", "İaden tamamlandı", "siparişin için ödemen iade edildi."),
}


def order_status_email(
    *, to: str, name: str, order_id: int, status: str, total: str, currency: str, orders_url: str
) -> EmailMessage:
    subject_base, heading, intro_tail = _ORDER_COPY.get(
        status, ("Sipariş güncellemesi", "Sipariş güncellemesi", "siparişinde bir güncelleme var.")
    )
    subject = f"{_BRAND} · {subject_base} (#{order_id})"
    money = f"{total} {currency}"
    text = (
        f"Merhaba {name},\n\n"
        f"#{order_id} numaralı {intro_tail}\n"
        f"Tutar: {money}\n\n"
        f"Siparişlerini görüntüle: {orders_url}\n"
    )
    html = _layout(
        heading=heading,
        intro=f"Merhaba <b>{name}</b>, <b>#{order_id}</b> numaralı {intro_tail} Tutar: <b>{money}</b>.",
        button_label="Siparişlerimi gör",
        button_url=orders_url,
        outro="Bu e-postayı mağazadaki siparişinle ilgili aldın.",
    )
    return EmailMessage(to=to, subject=subject, html=html, text=text)


def back_in_stock_email(*, to: str, product_title: str, product_url: str) -> EmailMessage:
    subject = f"{_BRAND} · '{product_title}' yeniden stokta"
    text = (
        f"Merhaba,\n\n"
        f"İlgilendiğin '{product_title}' yeniden stokta!\n"
        f"{product_url}\n\n"
        f"Stoklar tükenmeden sipariş verebilirsin."
    )
    html = _layout(
        heading="Yeniden stokta!",
        intro=f"İlgilendiğin <b>{product_title}</b> yeniden stokta. Stoklar tükenmeden sipariş verebilirsin.",
        button_label="Ürüne git",
        button_url=product_url,
        outro="Bu e-postayı bu ürün için stok bildirimi istediğin için aldın.",
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
    return EmailMessage(
        to=to,
        subject=f"[İletişim] {subject}",
        text=body,
        html=_plain_html(body),
    )


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
    if email:
        lines.append(f"E-posta: {email}")
    if district:
        lines.append(f"İlçe: {district}")
    if experience:
        lines.append(f"Deneyim: {experience}")
    if document_count:
        lines.append(f"Belge: {document_count} dosya (panelden görüntülenir)")
    if has_photo:
        lines.append("Profil fotoğrafı: var (panelden görüntülenir)")
    if note:
        lines.append(f"\nNot:\n{note}")
    lines += ["", "-" * 40, "Kayıt, yönetim panelindeki Eğitmen Başvuruları listesinde."]
    body = "\n".join(lines)
    return EmailMessage(
        to=to,
        subject=f"[Ön Başvuru] {name}",
        text=body,
        html=_plain_html(body),
    )


def contact_ack_email(*, to: str, name: str, subject: str) -> EmailMessage:
    """Gönderene 'mesajını aldık' teyidi (kullanıcı boşluğa yazmasın)."""
    body = (
        f"Merhaba {name},\n\n"
        f"\"{subject}\" konulu mesajını aldık. En kısa sürede dönüş yapacağız.\n\n"
        f"Bu otomatik bir bilgilendirmedir; yanıtlaman gerekmiyor.\n\n"
        f"Adana Özel Ders"
    )
    return EmailMessage(
        to=to, subject="Mesajını aldık", text=body, html=_plain_html(body)
    )


def payout_changed_email(*, to: str, name: str, iban_masked: str) -> EmailMessage:
    """Ödeme hesabı (IBAN) değişti bildirimi — güvenlik uyarısıdır, pazarlama değil.

    Ele geçirilmiş bir hesapta saldırganın ilk yapacağı şey para hedefini kendi
    IBAN'ına çevirmektir. Uygulama içi bildirim burada yetmez (saldırgan onu görür
    ve okundu işaretler); asıl koruma, sahibinin e-posta kutusuna düşen bu mesajdır.
    """
    subject = f"{_BRAND} · Ödeme hesabın güncellendi"
    body = (
        f"Merhaba {name},\n\n"
        "Hesabındaki ödeme bilgisi (IBAN) güncellendi.\n"
        f"Yeni IBAN: {iban_masked}\n\n"
        "Bu işlemi sen yapmadıysan hesabın başkasının eline geçmiş olabilir: "
        "hemen şifreni değiştir ve bizimle iletişime geç.\n\n"
        f"{_BRAND}"
    )
    return EmailMessage(to=to, subject=subject, text=body, html=_plain_html(body))
