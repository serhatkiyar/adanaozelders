# Transactional E-posta Araştırması

**Tarih:** 8 Ağustos 2026
**Kapsam:** Mevcut durum envanteri + yerleşik iyi uygulamalar + Türkiye mevzuatı (KVKK/ETK/İYS) + boşluk analizi
**Not:** Bu bir araştırma raporudur. Kod değiştirilmedi, uygulama yapılmadı.
**Hukuki uyarı:** §4'teki mevzuat aktarımları bilgilendirme amaçlıdır, **hukuki görüş değildir**. Lansman öncesi avukat/uzman onayı gerekir.

---

## 1. Mevcut Durum Envanteri

### 1.1 Altyapı

| Katman | Dosya | Not |
|--------|-------|-----|
| Soyutlama | `backend/core/mail/base.py` | `EmailMessage(to, subject, html, text)` dataclass + `EmailSender(ABC)` |
| Sağlayıcı seçimi | `backend/core/mail/sender.py:16` | `EMAIL_PROVIDER=console\|smtp` → `ConsoleEmailSender` / `SMTPEmailSender` |
| SMTP gönderim | `backend/core/mail/smtp.py:21` | `aiosmtplib`, çoklu-parça (text + html alternatifi) |
| Şablonlar | `backend/core/mail/templates.py` | **Kod içi f-string** — dosya tabanlı şablon yok, şablon motoru yok |
| Kuyruk | `backend/core/outbox.py` | Transactional outbox: `email:order_status`, `email:contact` kind'ları; üstel backoff, `OUTBOX_MAX_ATTEMPTS` tavanında dead-letter |
| Hata politikası | `sender.py:24` `_safe_send` | **Best-effort**: gönderim hatası tetikleyen akışı (kayıt, sipariş) bozmaz, yalnız `logging.warning` |
| Test | `backend/tests/test_mail_templates.py` | Yalnız "şablon üretilebiliyor mu" + `_plain_html` kaçış testi. İçerik/teslimat denetlenmiyor |

**Yapılandırma** (`backend/core/config.py:130-148`):

```
EMAIL_PROVIDER  = "console"                        # üretim guard'ı console'u reddeder (config.py:410)
EMAIL_FROM      = "no-reply@adanaozelders.com.tr"
EMAIL_FROM_NAME = "Adana Özel Ders"
SUPPORT_EMAIL   = None                             # boşsa EMAIL_FROM kullanılır
EMAIL_VERIFY_TOKEN_TTL_HOURS   = 24
PASSWORD_RESET_TOKEN_TTL_HOURS = 2
```

### 1.2 Gönderilen e-postalar (tam liste — 7 şablon, 10 tetikleyici)

| # | Tetikleyici olay | Alıcı rolü | Konu satırı | Gövde içeriği | Şablon durumu | Kaynak |
|---|---|---|---|---|---|---|
| 1 | Kayıt + `verify-email/resend` | Tüm giriş rolleri | `Adana Özel Ders · E-posta adresini doğrula` | Ad, doğrulama butonu, 24 sa TTL, "sen yapmadıysan yok say" | Kod içi (`_layout`) | `templates.py:59`, `verification_service.py:94` |
| 2 | `password-reset/request` | Tüm giriş rolleri | `Adana Özel Ders · Şifre sıfırlama` | Ad, sıfırlama butonu, 2 sa TTL, "talebi sen yapmadıysan şifren değişmez" | Kod içi (`_layout`) | `templates.py:78`, `verification_service.py:103` |
| 3 | Sipariş ödendi (`PAID`) | CLIENT | `… · Siparişin alındı (#12)` | Sipariş no, tutar+para birimi, "Siparişlerimi gör" | Kod içi (`_layout` + `_ORDER_COPY`) | `templates.py:102`, `order_service.py:902` |
| 4 | Kargoya verildi (`SHIPPED`) | CLIENT | `… · Siparişin kargoya verildi (#12)` | Aynı gövde şablonu | Kod içi | `order_service.py:1428` |
| 5 | Teslim edildi (`DELIVERED`) | CLIENT | `… · Siparişin teslim edildi (#12)` | Aynı gövde şablonu | Kod içi | `order_service.py:1498`, `delivery_service.py:1951` |
| 6 | İade tamamlandı (`REFUNDED`) | CLIENT | `… · Ödemen iade edildi (#12)` | Aynı gövde şablonu | Kod içi | `order_service.py:1011,1964,2029` |
| 7 | Ürün yeniden stokta | Stok bildirimi abonesi (oturumsuz olabilir) | `… · 'X' yeniden stokta` | Ürün adı, ürüne git butonu | Kod içi (`_layout`) | `templates.py:134`, `store_service.py:794` |
| 8 | İletişim formu → işletme | Destek kutusu (`SUPPORT_EMAIL`) | `[İletişim] <konu>` | Gönderen ad/e-posta, hesap referansı, mesaj | Kod içi (düz metin + `_plain_html`) | `templates.py:152`, `support_service.py:50` |
| 9 | İletişim formu teyidi | Gönderen (herkes) | `Mesajını aldık` | "En kısa sürede dönüş yapacağız" | Kod içi (düz metin) | `templates.py:187` |
| 10 | IBAN/ödeme hesabı değişti | TUTOR / kütüphane sahibi | `… · Ödeme hesabın güncellendi` | Maskeli IBAN, "sen yapmadıysan hemen şifreni değiştir" | Kod içi (düz metin) | `templates.py:200`, `payout_service.py:80` |

**3-6 numaralı satırlar tek şablondur** (`order_status_email`), durum koduna göre metin değişir.

### 1.3 E-posta dışı bildirim kanalları (karşılaştırma için)

Platformun bildirim yükünün büyük kısmı e-postada değil:

- **Uygulama içi bildirim** (`notifications` tablosu + WebSocket push): ~40 ayrı tetikleyici. Rezervasyon oluştur/kabul/red/tamamla/iptal/reschedule, ders hatırlatma, yorum, kaynak, QA, talep, deneme oturumu iptali/sonuç yayını, çalışma rezervasyonu, escrow mutabakatı, isim değişikliği onayı, teslimat durakları, admin alarmları. Örnek: `booking_service.py:309,507,533,591,649,675,701,754,799,861,903,968,1005`.
- **SMS** (`core/sms/`, `SMS_PROVIDER=console|netgsm`): telefon OTP, teslimat OTP, takip linki, "kuryen yaklaşıyor", teslim edilemedi, erteleme onayı (`core/sms/sender.py`). Outbox'ta `sms:*` kind'ları **sessiz saat** kuralına tabi (21:00–08:30 ertelenir, `outbox.py:41-80`); `email:*` bilinçli olarak ertelenmez.

### 1.4 Rıza altyapısı (mevcut)

- `models/consent.py`: `ConsentDoc.KVKK / TERMS / PRIVACY` (kayıtta zorunlu) + `MARKETING_EMAIL / MARKETING_SMS` (ayarlardan).
- `services/consent_service.py`: append-only rıza kaydı, `is_granted()` "pazarlama gönderimi öncesi kontrol" için hazır, `purge_for_user()` anonimleştirmede IP/UA temizler.
- `core/flags.py:55` `marketing_messages_enabled` bayrağı var ama **`enforced=False`** — katalog notu: "İYS kaydı ve onay senkronizasyonu yapılmadan pazarlama iletisi … bayraktan etkilenmez."

Yani: **rıza defteri var, pazarlama gönderimi henüz yok.** Bu iyi bir başlangıç noktasıdır.

---

## 2. Eksikler — bildirim gitmesi gereken ama e-posta gitmeyen olaylar

Aşağıdaki olayların hepsinde *uygulama içi* bildirim var (bazılarında o da yok); **e-posta yok**. Kullanıcı siteye girmezse hiçbir şey öğrenmiyor.

### 2.1 Güvenlik olayları (en kritik boşluk)

| Olay | Şu an ne oluyor | Neden sorun |
|---|---|---|
| **Şifre değiştirildi** | `auth_service.change_password:165` — tüm oturumlar iptal, `auth_version++`; **hiçbir bildirim yok** | OWASP açıkça "kullanıcıya şifresinin sıfırlandığını bildiren e-posta gönder" der. Hesap ele geçirilirse kurbanın haberi olmaz |
| **Şifre sıfırlandı (token ile)** | `auth_service.reset_password:211` — aynı; bildirim yok | Aynı |
| **E-posta adresi değiştirildi** | `/auth/me` PATCH; ayrı bir "eski adrese uyarı" akışı bulunamadı | Hesap devralmanın klasik yolu: saldırgan e-postayı değiştirir, kurban tüm kurtarma yollarını kaybeder |
| **Yeni cihaz/konumdan giriş** | Yok | Düşük öncelik; oturum kaydı (`refresh_tokens`) var ama cihaz parmak izi yok |

**Karşı örnek (doğru yapılmış):** IBAN değişikliğinde e-posta gidiyor ve gerekçesi kodda yazılı (`payout_service.py:88` — "hesabı ele geçiren kişi uygulama içi bildirimi görüp okundu işaretleyebilir, gerçek sahibin posta kutusuna erişemez"). **Aynı akıl yürütme şifre değişikliği için uygulanmamış.**

### 2.2 Para ve rezervasyon olayları

| Olay | Şu an | Boşluk |
|---|---|---|
| **Ders rezervasyonu kabul edildi** (ödeme gerekiyor) | In-app + WS | Öğrenci ödemezse ders düşer; e-posta hatırlatması yok |
| **Ders rezervasyonu reddedildi/iptal edildi** | In-app | Para iadesi bilgisi e-postayla teyit edilmiyor |
| **Ders ödemesi alındı (escrow HELD)** | In-app | **Ödeme makbuzu e-postası hiç yok** — mağaza siparişinde var, derste yok |
| **Ders hatırlatma** (`booking_service.py:754`, `reminder_sent`) | In-app | Ders saatinden önce e-posta/SMS yok |
| **Deneme sınavı bileti alındı** (`library_exam_service`) | In-app + `/biletlerim` | Bilet/QR e-postası yok — öğrenci sınav günü telefonla siteye girmek zorunda |
| **Deneme oturumu iptal edildi + iade** | In-app | E-posta yok |
| **Çalışma alanı rezervasyonu onayı** | In-app | E-posta yok |
| **Ödeme başarısız** (iyzico callback) | Yalnız `?odeme=basarisiz` yönlendirmesi (`core/payments/iyzico.py:223` log) | **Hiçbir bildirim yok** — kullanıcı sekmeyi kapatırsa siparişin ödenmediğini bilmez |
| **İade talebi alındı** (mağaza) | In-app (`order_service.py:2391` civarı) | Talep alındı teyidi e-postayla gitmiyor; müşteri "kayboldu mu" diye destek yazıyor |

### 2.3 Rol/onay olayları

| Olay | Şu an | Boşluk |
|---|---|---|
| **Eğitmen başvurusu onaylandı/reddedildi/askıya alındı** | In-app | Onay bekleyen eğitmen günlerce panele girmeyebilir; ilanı yayına girdiğini öğrenmez |
| **Kütüphane self-servis kaydı onaylandı** (`library_onboarding_service.py:92`) | In-app | Aynı |
| **Hoş geldiniz maili** | Yok — yalnız doğrulama maili var | Doğrulama maili "hoş geldiniz" işini görmüyor: rol bazlı ilk adımlar (eğitmen → profilini tamamla; öğrenci → eğitmen ara) anlatılmıyor |

### 2.4 KVKK süreç olayları

| Olay | Şu an | Boşluk |
|---|---|---|
| **Hesap silme / anonimleştirme tamamlandı** | `account_deletion_service.py` — e-posta **anonimleştirilir** (`anonymized_email`), bildirim yok | Silme sonrası adres geçersizleştiği için e-posta **silmeden ÖNCE** gönderilmeli. Şu an hiç yok |
| **Veri indirme (erişim talebi) hazır** | `account_deletion_service.py:173` veri dışa aktarımı üretiyor; e-posta yok | Talep-cevap süreci belgelenmiyor |
| **KVKK başvurusuna cevap** | Yalnız iletişim formu üzerinden manuel | İlgili kişi başvurusuna 30 gün içinde cevap yükümlülüğü (KVKK m.13) için iz yok |

### 2.5 Mevcut şablonlardaki teknik eksikler

| Eksik | Kanıt | Etki |
|---|---|---|
| **Preheader (ön izleme metni) yok** | `templates.py:11-39` — `<body>` doğrudan tabloyla başlıyor | Gelen kutusunda konu satırının yanında rastgele metin ("Merhaba Ahmet, Adana Özel Ders hesabını…") görünür |
| **`Reply-To` başlığı yok** | `smtp.py:24-30` — yalnız `From`, `To`, `Subject` | Kullanıcı yanıtlarsa `no-reply@` adresine gider; kaybolur |
| **Gönderen adresi `no-reply@`** | `config.py:134` | Sağlayıcı rehberleri bunu açıkça eleştiriyor (§3.4) |
| **HTML kaçışı yapılmıyor** | `templates.py:70` → `intro=f"Merhaba <b>{name}</b>, …"`; `templates.py:144` → `<b>{product_title}</b>` | `_plain_html()` kaçış yapıyor (`templates.py:49`) ama `_layout()` **yapmıyor**. `full_name` kullanıcı girdisidir → HTML/link enjeksiyonu ve biçim bozulması mümkün. Test (`test_mail_templates.py:71`) yalnız `_plain_html`'i denetliyor, `_layout`'u denetlemiyor |
| **`List-Unsubscribe` başlığı yok** | `smtp.py` | İşlemsel iletide zorunlu değil (§3.7), ama stok bildirimi (#7) için tartışmalı — bkz. §4.3 |
| **Karanlık mod desteği yok** | `templates.py:14` sabit `background:#f1f5f9`, `color:#0f172a`; `color-scheme` meta yok | Gmail/Outlook otomatik inversiyonda kart beyaz kalır veya metin okunmaz hâle gelebilir |
| **`alt` metni / görselsiz tasarım** | Şablonda hiç `<img>` yok | **Bu aslında iyi** — görsel engellendiğinde hiçbir şey kaybolmuyor |
| **Tek şablon, tüm durumlar** | `_layout()` tek imza: heading + intro + tek buton | Sipariş kalemleri, tutar dökümü, KDV, ders tarihi/saati gibi tablo içerik taşınamıyor |
| **Bounce/şikâyet yönetimi yok** | Kod tabanında bounce/suppression izi yok | Geçersiz adrese tekrar tekrar gönderim → gönderen itibarı düşer |

---

## 3. Araştırma Bulguları

### 3.1 İçerik ve yapı

**Konu satırı.** Postmark rehberi: *"Fifty characters or fewer is a good guideline for length"* ve *"Simple and direct wins over cute and catchy"*. Ürün adını konunun başına koymak yer israfıdır — bunu **From** alanının taşıması beklenir; zorunluysa sona konur ([Postmark](https://postmarkapp.com/guides/transactional-email-best-practices/)). Ayrıca aynı görünen konu satırları (Amazon örneği) kullanıcıyı her maili açmaya zorlar; **benzersiz ve ayırt edici** konu tercih edilir.

> Bizde: `Adana Özel Ders · Siparişin alındı (#12)` — marka **önde** (rehbere aykırı), ama sipariş numarası benzersizliği sağlıyor. Uzunluk 40 karakter civarı, sınırın altında.

**Preheader (ön izleme metni).** Konu satırından sonra gelen kutusunda görünen özet. Konuya sığmayan bilgiyi taşımak için kullanılır; yoksa istemci gövdenin ilk metnini alır. Postmark'ın Amazon eleştirisi tam da bu: preheader olmadığı için "bütün sipariş e-postaları aynı görünüyor".

**Gövde hiyerarşisi ve tek birincil eylem.** Rehber tek amaçlı eylem vurgular; ikincil bağlantılar CTA'dan sonra ve daha sönük verilir.

**Mutlak tarih/saat.** Postmark: *"absolute dates and times"* kullan, "bugün"/"az önce" gibi göreli ifadelerden kaçın — e-posta saatler sonra okunabilir.

> Bizde: sipariş e-postalarında **tarih hiç yok** (yalnız sipariş no + tutar). Ders/rezervasyon e-postası zaten yok.

**Zorunlu bilgi vs gürültü.** İşlemsel e-postada olması beklenenler: işlem kimliği (sipariş/rezervasyon no), tutar ve para birimi, tarih/saat, tarafların kim olduğu, bir sonraki adım, destek yolu. Gürültü: kampanya blokları, çapraz satış, sosyal medya duvarı — ve bunlar Türkiye'de ayrıca hukuki risk yaratır (§4.2).

**Düz metin alternatifi.** Postmark: düz metin sürümü *"good for both accessibility and delivery"*. Bağlantılar kısa ve kendi satırında olmalı (satır kaydırma URL'yi bozar).

> Bizde: **doğru yapılmış.** `EmailMessage` çoklu-parçadır (`base.py:8`), `smtp.py:29-30` `set_content(text)` + `add_alternative(html)` ile RFC uyumlu `multipart/alternative` üretir; düz metin sürümü elle yazılmış, otomatik strip değil.

### 3.2 Kategoriye göre desenler

| Kategori | Sektör standardı yapı | Bizdeki durum |
|---|---|---|
| **Şifre sıfırlama** | Tek kullanımlık token, **kısa ömür (15–60 dk yaygın aralık; OWASP "uygun bir süre" der, kesin sayı vermez — bazı rehberler ≤20 dk önerir)**, tek birincil buton, "bu talebi siz yapmadıysanız hesabınız güvende / bir şey yapmanıza gerek yok" cümlesi, şifre **asla** gövdede olmaz, sıfırlama sonrası tüm oturumlar kapanır, kullanıcıya "şifreniz sıfırlandı" bilgilendirmesi gider ([OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)) | Token hash'li + tek kullanımlık + **2 saat** TTL; oturum iptali var; **"şifreniz değişti" bildirimi YOK** |
| **E-posta doğrulama** | Tek buton, uzun TTL kabul edilebilir (saatler–gün), yeniden gönderme yolu, doğrulanmazsa ne olacağının söylenmesi | 24 sa TTL, resend ucu var; "doğrulamazsan ne olur" söylenmiyor (soft enforcement olduğu için düşük risk) |
| **Hoş geldiniz** | İlk değerli eylemi tek CTA yap; hesap özeti; destek yolu | **Yok** |
| **Sipariş onayı** | Sipariş no, tarih, kalem dökümü, ara toplam/kargo/vergi/toplam, teslimat adresi (maskeli), tahmini teslim, iptal/iade yolu | Yalnız no + toplam tutar; **kalem dökümü, tarih, teslim sözü yok** |
| **Kargo/teslimat** | Taşıyıcı + takip no + takip linki + tahmini pencere; teslim edildiğinde kanıt/imza referansı | E-posta yalnız "kargoya verildi" diyor; **takip linki SMS'te var, e-postada yok** (`sms/sender.py:61`) |
| **İade talebi alındı / tamamlandı** | Talep no, hangi kalemler, beklenen süre, para hangi karta/hesaba dönecek | "Tamamlandı" var; **"talep alındı" yok** |
| **Rezervasyon onayı + hatırlatma** | Tarih/saat + saat dilimi, konum veya bağlantı, iptal politikası, takvime ekle (.ics); hatırlatma T-24s/T-1s | **İkisi de yok** (in-app hatırlatma var) |
| **Ödeme başarısız** | Neden (genel, kart detayı vermeden), ne yapılmalı, tekrar deneme linki, son tarih | **Yok** |
| **Hesap güvenlik uyarısı** | Ne değişti, ne zaman, "siz değilseniz" acil eylem yolu; işlemi geri alma linki değil, destek/şifre değiştirme yolu | Yalnız IBAN değişikliğinde var |
| **KVKK veri silme/indirme** | Talep alındı teyidi + tamamlandı bildirimi; indirme bağlantısı kısa ömürlü ve kimlik doğrulamalı | **Yok** |

### 3.3 Güvenlik ve gizlilik

- **Token ömrü.** OWASP kesin süre vermez: *"single use and expire after an appropriate period"*. Sektör rehberleri 15–60 dk aralığını yaygın gösterir. Bizim **2 saat** değerimiz bu aralığın üst sınırının üstünde ama makul; asıl fark, tokenın DB'de hash'li ve tek kullanımlık olması — bu iki koşulu sağlıyoruz (`verification_service.py:35-91`).
- **E-postada asla yer almaması gerekenler:** şifrenin kendisi (OWASP: *"do not send the password in the email!"*), tam kart numarası/banka hesap numarası, TC kimlik numarası, doğum tarihi, tam adres ve telefon ([Kiteworks](https://www.kiteworks.com/secure-email/send-pii-over-email/) — genel PII rehberi). Kural: e-posta transit şifreli olabilir ama **depoda düz metindir**; posta kutusuna erişen her şeyi okur.
- **Enumeration.** OWASP: *"return a consistent message for both existent and non-existent accounts"* ve yanıt sürelerinin de tutarlı olması. "Bu e-posta kayıtlı değil" demek, saldırgana kayıtlı kullanıcı listesi çıkarma imkânı verir.
  > Bizde: `password-reset/request` her durumda aynı yanıtı veriyor (`backend/CLAUDE.md` ve `verification_service` akışı). **Zamanlama tutarlılığı doğrulanmadı** — kayıtlı kullanıcıda token üretimi + mail gönderimi yapıldığı için yanıt süresi ölçülebilir biçimde farklı olabilir (bkz. §8).
- **Rate limit.** OWASP sıfırlama ucunda hesap bazlı sınır ister (saldırgan kurbanı mail bombardımanına tutmasın). Bizde `RATE_LIMIT_EMAIL=5` IP bazlı (`config.py:312`) — **hesap bazlı değil**.
- **Maskeleme.** IBAN maskeleme var (`payout_service.mask_iban`). Sipariş e-postasında adres/telefon zaten yok. Teslimat takip sayfasında "maskeli alıcı" deseni uygulanmış (kök `CLAUDE.md` Faz E) — e-posta tarafına taşınabilir bir desen.

### 3.4 Teknik teslimat

- **SPF → DKIM → DMARC sırası.** Önce gönderim yapan tüm sistemleri envanterle, SPF TXT kaydını yayımla, DKIM anahtar çiftini kur (özel anahtar sağlayıcıda, açık anahtar DNS'te), sonra DMARC'ı `p=none` ile başlat, raporları izle, `quarantine` → `reject` diye sıkılaştır. DMARC, SPF ve DKIM'in **üstüne** kurulur ([Woodpecker](https://woodpecker.co/blog/spf-dkim/), [EasyDMARC](https://easydmarc.com/blog/dmarc-best-practices/)).
- **2024+ zorunlulukları.** Google/Yahoo/Microsoft toplu gönderenler için kimlik doğrulamayı zorunlu kıldı; spam şikâyet oranı **%0,3'ün altında** tutulmalı; pazarlama/abonelik e-postalarında **RFC 8058 tek-tık abonelikten çıkma** (`List-Unsubscribe` + `List-Unsubscribe-Post`) gerekir. **İşlemsel e-postalar bu abonelikten-çıkma zorunluluğundan muaftır** — örnek olarak şifre sıfırlama ve rezervasyon onayı sayılır ([Gmail sender guidelines](https://support.google.com/a/answer/14229414?hl=en), [PowerDMARC](https://powerdmarc.com/bulk-email-sender-requirements/)).
- **Gönderen adı/adresi.** Postmark: *"noreply email address is a quick way to signal to customers that you don't want to hear from them."* Önerilen: izlenen bir kutuya giden `Reply-To`.
  > Bizde: `EMAIL_FROM=no-reply@…`, `Reply-To` hiç yok. `SUPPORT_EMAIL` ayarı zaten var — `Reply-To` için hazır hedef.
- **Bounce ve şikâyet yönetimi.** Kalıcı (hard) bounce ve şikâyetler **anında suppression listesine** girmeli ve orada kalmalı; gönderim öncesi bu listeye karşı kontrol yapılmalı; bounce oranı ve şikâyet için izleme/eşik uyarısı kurulmalı ([Mailgun Suppressions](https://help.mailgun.com/hc/en-us/articles/360012287493-Suppressions-Bounces-Complaints-Unsubscribes-Allowlists)). Sağlayıcı değiştirilirken suppression listesi taşınmazsa ilk gönderimde itibar çöker.
- **HTML kısıtları ve tablo düzeni.** Outlook 2016/2019/2021 Word render motorunu kullanır: Flexbox, Grid ve modern düzen özelliklerinin çoğu **yok**. Bu yüzden `<table>` düzeni hâlâ standarttır; stiller inline olmalıdır ([markaplugin](https://markaplugin.com/blog/html-email-best-practices-2026)).
  > Bizde: `templates.py:15` `role="presentation"` tablo düzeni + inline stil — **doğru yapılmış**.
- **Karanlık mod.** Apple Mail `prefers-color-scheme` CSS'ini uygular; Gmail uygulamaları CSS'i büyük ölçüde yok sayıp **otomatik renk inversiyonu** yapar; Outlook sürümleri değişkendir. `<meta name="color-scheme" content="light dark">` ve `@media (prefers-color-scheme: dark)` bloğu, destekleyen istemcilerde kontrolü geri verir ([Campaign Monitor](https://www.campaignmonitor.com/resources/guides/dark-mode-in-email/), [MailMode matrisi](https://www.mailmode.app/learn/email-client-dark-mode-support-matrix)). Kaynaklara göre e-posta açılışlarının **%25'inden fazlası** karanlık modda gerçekleşiyor (Litmus, Mayıs 2026 aktarımı).
- **Görsel engelliyken okunabilirlik.** Birçok istemci görselleri varsayılan olarak engeller. Kural: metin görsele gömülmez, her `<img>` anlamlı `alt` taşır, logo bile metin olarak yazılabiliyorsa yazılır.
  > Bizde şablonda hiç görsel yok — bu riskten baştan muafız. Marka başlığı metin olarak render ediliyor (`templates.py:19`).

### 3.5 Türkçe karakter ve kodlama

Python'un `email.message.EmailMessage`'ı `set_content()` ile gövdeyi UTF-8'e kodlar ve başlıkları gerektiğinde RFC 2047 (`=?utf-8?…?=`) ile kodlar. Konu satırlarımız Türkçe karakter içeriyor (`Şifre sıfırlama`, `E-posta adresini doğrula`) ve bu yol standart. **Gerçek istemcide görsel doğrulama yapılmadı** (bkz. §8) — MailHog/Mailpit ile bakılması gereken tipik kırılma noktası budur.

> Not: SMS tarafında durum farklıdır — Türkçe karakter GSM-7 dışına çıkıp mesajı Unicode'a düşürür ve karakter başına maliyeti değiştirir. Bu rapor e-posta odaklı olduğu için ayrıntıya girilmedi; `core/sms/netgsm.py` hata kodları arasında İYS kaynaklı ret kodları (50/51) zaten tanımlı.

---

## 4. Türkiye: KVKK / ETK / İYS

> **Bu bölüm hukuki görüş değildir.** Mevzuat metinlerine ve resmî kaynaklara işaret eder; uygulama kararı için avukat/uzman onayı gerekir.

### 4.1 İşlemsel ileti mi, ticari elektronik ileti mi?

**6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun** m.6/1: *"Ticari elektronik iletiler, alıcılara ancak önceden onayları alınmak kaydıyla gönderilebilir."* (RG 5/11/2014 — [resmigazete.gov.tr](https://www.resmigazete.gov.tr/eskiler/2014/11/20141105-1.htm))

**Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik** (RG 15/7/2015, 29417 — [resmigazete.gov.tr](https://www.resmigazete.gov.tr/eskiler/2015/07/20150715-4.htm)) m.6, önceden onay **gerekmeyen** halleri sayar. Bizim için doğrudan ilgili iki bent:

- Alıcının iletişim bilgilerini kendisiyle iletişime geçilmesi amacıyla vermesi hâlinde, **"temin edilen mal veya hizmetlere ilişkin değişiklik, kullanım ve bakıma yönelik"** iletiler;
- **"Devam eden abonelik, üyelik veya ortaklık durumu ile tahsilat, borç hatırlatma, bilgi güncelleme, satın alma ve teslimat veya benzeri durumlara ilişkin bildirimleri içeren iletiler"** — **ancak bu iletilerde herhangi bir ürün veya hizmetin tanıtımı yapılamaz.**

Pratik sonuç (yorum): sipariş onayı, kargo/teslimat bildirimi, iade bildirimi, rezervasyon onayı, şifre sıfırlama, e-posta doğrulama gibi iletiler bu istisnaların kapsamına giriyor görünmektedir — **tanıtım içermedikleri sürece**. Bir ürün önerisi, kampanya bloğu veya "şunu da inceleyin" kutusu eklendiği anda bu koruma tartışmalı hâle gelir.

### 4.2 İYS transactional maili kapsıyor mu?

İYS (İleti Yönetim Sistemi), **ticari elektronik ileti onaylarının** tutulduğu merkezî sistemdir. Onay gerekmeyen bildirim iletilerinin İYS'ye kaydı beklenmez — ikincil kaynaklar (hukuk büroları, İYS hizmet sağlayıcıları) fatura, kargo bildirimi, üyelik hatırlatması gibi bilgilendirme iletilerinin İYS'ye bildirilmediğini aktarıyor ([Mysoft/İleti Yönetimi](https://iletiyonetimi.com/iysde-izinsiz-gonderilebilen-iletiler-ve-yasal-duzenlemeler), [Kılınç Hukuk](https://kilinclaw.com.tr/en/commercial-electronic-communication-management-system/)).

**Uyarı:** Bunlar ikincil kaynaklardır ve İYS'nin resmî SSS metnine doğrudan erişilemedi (bkz. §8). İkincil kaynaklarda tekrarlanan bir uyarı da şudur: **belgeleme eksikliği**, bir iletinin sonradan "izinsiz ticari ileti" sayılmasına yol açabilir. Yani "bu işlemsel" demek yetmez, **hangi işlem/sözleşme ilişkisine dayandığı gösterilebilmelidir**.

### 4.3 Bizim için sınırda olan tek mail: "yeniden stokta" bildirimi

Şablon #7 (`back_in_stock_email`) durumu ayrıştırır:

- **Lehte:** kullanıcı o ürün için **açıkça** bildirim istedi (`StockNotification` kaydı, `store_service.py:765`), tek seferlik ve talebe cevap niteliğinde.
- **Aleyhte:** içeriği bir **ürünün satın alınmaya davetidir** — m.6'nın "tanıtım yapılamaz" sınırına en yakın maildir. Ayrıca abone **oturumsuz** olabiliyor (yalnız e-posta adresi), yani rıza kaydı `user_consents` tablosuna düşmüyor.
- **Ek risk:** gönderimde `List-Unsubscribe` başlığı yok ve gövdede vazgeçme bağlantısı yok. Ticari ileti sayılırsa Yönetmelik m.9 uyarınca **ret imkânı sunulması ve ret talebinin üç iş günü içinde uygulanması** gerekir.

Bu, uzman görüşü alınması gereken somut ve dar bir sorudur.

### 4.4 KVKK aydınlatma yükümlülüğü

KVKK m.10 ve [Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ](https://kvkk.gov.tr/Icerik/5443/AYDINLATMA-YUKUMLULUGUNUN-YERINE-GETIRILMESINDE-UYULACAK-USUL-VE-ESASLAR-HAKKINDA-TEBLIG): aydınlatma, **veri işleme sırasında** ve açık rızadan bağımsız olarak yerine getirilmesi gereken bir yükümlülüktür; asgari içerik veri sorumlusunun kimliği, işleme amacı, aktarım, toplama yöntemi ve hukuki sebeptir.

Uygulamada bu yükümlülük **veri toplandığı noktada** (kayıt formu, sipariş formu) yerine getirilir — bizde `ConsentCheckbox` + `/kvkk-aydinlatma` sayfası ile karşılanıyor. **Her işlemsel e-postanın gövdesine aydınlatma metni gömülmesi gerektiğine dair bir kural bulunamadı** (bkz. §8). Yaygın pratik, e-posta altbilgisinde gizlilik politikasına **bağlantı** vermektir.

> Bizde altbilgi yalnız `© Adana Özel Ders` (`templates.py:33`) — işletme kimliği ve gizlilik politikası bağlantısı yok. Yönetmelik m.7 ticari iletiler için hizmet sağlayıcının tanınmasını sağlayan bilgileri (tacir için MERSİS no ve ticaret unvanı; esnaf için ad-soyad ve TCKN) ve erişilebilir bir iletişim bilgisini şart koşar. **Şahıs şirketiyiz ve unvan/VKN kodda mevcut** (`INVOICE_SELLER_*` ayarları) — altbilgiye taşımak ucuz.

---

## 5. Boşluk Analizi (bizim durumumuz ↔ iyi uygulama)

| Konu | İyi uygulama | Bizde | Fark |
|---|---|---|---|
| Çoklu-parça (text+html) | Zorunlu | ✅ Var, elle yazılmış | Yok |
| Tablo düzeni + inline CSS | Zorunlu | ✅ Var | Yok |
| Görselsiz okunabilirlik | Önemli | ✅ Görsel hiç yok | Yok |
| Outbox + retry | İyi | ✅ Var (sipariş+iletişim); doğrulama/sıfırlama **doğrudan** gönderiliyor | Kısmi |
| Token hash + tek kullanım | Zorunlu | ✅ Var | Yok |
| Enumeration'a karşı sabit yanıt | Zorunlu | ✅ Var (zamanlama doğrulanmadı) | Kısmi |
| Şifre değişti bildirimi | OWASP önerir | ❌ Yok | **Büyük** |
| Preheader | Standart | ❌ Yok | Orta |
| Reply-To / izlenen kutu | Standart | ❌ Yok (`no-reply@`) | Orta |
| HTML kaçışı | Zorunlu | ❌ `_layout` kaçış yapmıyor | **Güvenlik/kalite** |
| SPF/DKIM/DMARC | Zorunlu | ❓ Kodda izlenemez (DNS işi) | Doğrulanmadı |
| Bounce/suppression | Zorunlu | ❌ Yok | Orta (ölçek küçük) |
| Karanlık mod | Yaygın | ❌ Yok | Küçük |
| Rezervasyon/ödeme e-postaları | Standart | ❌ Yok (yalnız in-app) | **Büyük** |
| Sipariş kalem dökümü | Standart | ❌ Yalnız toplam | Orta |
| İşletme kimliği + gizlilik linki altbilgide | Mevzuat + güven | ❌ Yok | Orta |
| Stok bildirimi için ret imkânı | Sınırda mevzuat | ❌ Yok | **Hukuki risk** |
| Rıza defteri | Pazarlama için ön koşul | ✅ Var, pazarlama kapalı | Yok |

---

## 6. Öneriler

### 6.1 Ucuz ve önemli (mevcut altyapıyla, yeni bağımlılık yok)

| # | Öneri | Etkilenen mail | Büyüklük | Çözdüğü somut sorun |
|---|---|---|---|---|
| U1 | `_layout()`'ta kullanıcı girdisini HTML-kaçışla (`_plain_html`'deki kaçışı ortak yardımcıya çıkar) + `_layout` için kaçış testi | Tümü (1,2,3-6,7) | XS (~20 satır + test) | `full_name`/`product_title` üzerinden HTML/link enjeksiyonu ve bozuk render |
| U2 | "Şifren değiştirildi" / "Şifren sıfırlandı" güvenlik e-postası | Yeni şablon | S (şablon + 2 çağrı) | OWASP'ın açık önerisi; hesap devralmanın sessiz kalması. IBAN maili için yazılan gerekçenin aynısı |
| U3 | `Reply-To: SUPPORT_EMAIL` başlığı ekle; `EMAIL_FROM_NAME` korunur | Tümü | XS (`smtp.py`'de 1 satır + config) | Kullanıcı yanıtı kaybolmuyor; `no-reply` sinyali yumuşuyor |
| U4 | Preheader desteği: `_layout(preheader=...)` — gizli `<div>` + her şablona bir cümle | Tümü | S | Gelen kutusunda anlamsız önizleme; sipariş maillerinin birbirinden ayrılamaması |
| U5 | Altbilgiye işletme kimliği (unvan/VKN) + gizlilik politikası + iletişim bağlantısı | Tümü | XS | Güven + Yönetmelik m.7 beklentisine yaklaşma |
| U6 | Sipariş e-postasına **tarih**, **kalem dökümü** ve (varsa) **teslim sözü tarihi**; teslimat mailine **takip linki** (SMS'te zaten üretiliyor) | 3,4,5 | M (`_layout` tek-buton kalıbını aşan içerik gerekir) | "Ne aldım, ne zaman gelecek" sorusunun destek trafiğine dönüşmesi |
| U7 | Ders/rezervasyon e-postaları: kabul edildi (ödeme bekliyor), ödendi (makbuz), ders hatırlatma (T-24s) | Yeni şablon(lar) | M | Kullanıcı siteye girmedikçe hiçbir şey öğrenemiyor; ödenmeyen ders sessizce düşüyor |
| U8 | Deneme bileti / çalışma rezervasyonu onay e-postası (QR **linki**, gömülü QR görseli değil) | Yeni şablon | S–M | Sınav günü öğrencinin bileti bulamaması |
| U9 | "İade talebin alındı" ve "ödeme başarısız" e-postaları | Yeni şablon ×2 | S | Sessiz kalan iki para akışı |
| U10 | Doğrulama/sıfırlama e-postalarını da **outbox**'a taşı (şu an doğrudan, best-effort) | 1,2 | S | SMTP anlık düşükse kullanıcı kayıt sonrası maili hiç alamıyor; retry yok |
| U11 | Şifre sıfırlama isteğine **hesap bazlı** rate-limit ekle (IP'ye ek) | 2 | S | Kurbanı mail bombardımanına tutma |
| U12 | Karanlık mod: `<meta name="color-scheme">` + `@media (prefers-color-scheme: dark)` blok | Tümü | S | Açılışların %25+'ında bozuk kontrast |
| U13 | Stok bildirimi (#7) için gövdede "bu bildirimden çık" bağlantısı + `List-Unsubscribe` başlığı | 7 | S | §4.3'teki sınırda hukuki durum; ETK m.9 ret hakkı beklentisi |

### 6.2 Yeni altyapı gerektiren

| # | Öneri | Etkilenen mail | Büyüklük | Çözdüğü somut sorun |
|---|---|---|---|---|
| A1 | **SPF + DKIM + DMARC** kurulumu (DNS) ve `p=none` → `quarantine` yürüyüşü | Tümü | M (kod değil, altyapı) | Gmail/Yahoo/Microsoft'un kimlik doğrulama şartı; spam klasörü |
| A2 | Gerçek gönderim sağlayıcısı (Postmark/Resend/SES/Mailgun) — **SMTP arayüzüyle** bağlanırsa `SMTPEmailSender` aynen çalışır | Tümü | S–M | `EMAIL_PROVIDER=console` üretim guard'ı zaten bunu şart koşuyor (`config.py:410`) |
| A3 | Bounce + şikâyet webhook'u → `suppressions` tablosu → gönderim öncesi kontrol | Tümü | M | Ölü adrese tekrar gönderim, itibar kaybı |
| A4 | Şablonları **Jinja2 dosyalarına** taşı (bkz. §7) | Tümü | M | Kod içi f-string ile kalem dökümü/tablo/koşullu içerik yazılamıyor |
| A5 | KVKK süreç e-postaları: silme talebi alındı / tamamlandı (silmeden **önce**), veri indirme hazır | Yeni şablon ×3 | M | KVKK m.13 başvuru-cevap sürecinde iz yok |
| A6 | E-posta gönderim logu (`email_log` veya outbox'ın genişletilmesi) — kime/ne zaman/hangi şablon | Tümü | S–M | "Mail gitti mi?" sorusuna bugün yalnız `logging.warning` cevap veriyor; destek ve ispat için yetersiz |

### 6.3 Bizim ölçeğimizde gereksiz

| Konu | Neden gereksiz |
|---|---|
| MJML / react-email build zinciri | Node.js build adımı + iki dilli şablon bakımı; günde onlarca mail ve 10-15 şablon için maliyeti getirisinden büyük (§7) |
| A/B testi, açılma/tıklanma izleme | İşlemsel e-postada optimize edilecek dönüşüm yok; izleme pikseli KVKK yüzeyini genişletir |
| Ayrı gönderim alt alan adı (`mail.` / `t.`) ve IP ısıtma | Adanmış IP ve ısıtma günde on binlerce mail için anlamlı; paylaşımlı havuz bizim hacmimizde daha iyi teslim eder |
| Çoklu dil (i18n) altyapısı | Tek pazar, tek dil. Jinja2'ye geçilirse dizin bazlı dil ayrımı sonradan **ucuz** olur; şimdi yapmak boşuna |
| Kurumsal e-posta tasarım sistemi / Litmus render test aboneliği | MailHog + 3-4 gerçek istemcide elle bakmak yeterli |
| BIMI | DMARC `p=reject` + doğrulanmış marka sertifikası (VMC) gerektirir; şu aşamada erken |

---

## 7. Şablon Altyapısı Değerlendirmesi

**Bugün:** `core/mail/templates.py` — Python f-string'leri. Tek `_layout()` fonksiyonu: başlık + paragraf + **tek buton**. Kalem listesi, tutar dökümü, koşullu blok yazılamıyor; her yeni mail bu kalıba zorlanıyor (bu yüzden sipariş maili yalnız toplam tutar gösteriyor).

**Seçenekler:**

| Seçenek | Yığına uyum | Maliyet | Değerlendirme |
|---|---|---|---|
| **Jinja2 dosya şablonları** | Doğal — FastAPI ekosisteminde standart; `fastapi-mail` gibi paketler Jinja2 üzerine kurulu ([fastapi-mail](https://sabuhish.github.io/fastapi-mail/)) | Jinja2 zaten dolaylı bağımlılık olabilir; olmasa da saf-Python, tek paket | **Önerilen.** Döngü/koşul/miras (`base.html`) gelir, gönderim katmanı değişmez. Düz metin sürümü ayrı `.txt` şablonu olarak yazılır (otomatik strip'ten daha iyi) |
| **MJML** | Node.js derleyicisi gerekir; Jinja2 ile birlikte kullanmak "önce Jinja render et, sonra MJML CLI'ya ver" gibi iki aşamalı bir zincir doğurur ([mjml#1457](https://github.com/mjmlio/mjml/issues/1457)) | Yeni runtime + build adımı + CI değişikliği | Cross-client uyumluluğu otomatikleştirmesi değerli ama bizim şablonlarımız zaten görselsiz ve basit; kazanç maliyeti karşılamıyor |
| **react-email** | Frontend TS yığınına uyar, backend'e uymaz; mailleri backend gönderiyor | Build-time HTML üretip backend'e kopyalamak veya ayrı bir render servisi | Frontend'de e-posta şablonu tutup backend'in göndermesi iki kaynak yaratır. **Hayır** |
| **Maizzle** | Tailwind tabanlı; yine Node build | MJML ile aynı sorun | Hayır |

**Yerelleştirme notu:** Jinja2'ye geçilirse çoklu dil, `templates/mail/<lang>/…` dizin ayrımı + gönderim çağrısına `lang` parametresi ile eklenir; bugünkü f-string yapısında aynı şey her fonksiyonun ikiye katlanması demektir. Yani Jinja2 kararı, ileride dil eklenirse **geriye dönük maliyeti düşüren** karardır — ama şimdi dil eklemek için sebep yok.

---

## 8. Doğrulanamayanlar

Aşağıdakiler bu araştırmada **kanıtlanmadı**; iddia olarak kullanılmamalıdır.

1. **SPF/DKIM/DMARC durumu.** DNS kayıtları kod tabanında görünmez; `adanaozelders.com.tr` için mevcut kayıtlar sorgulanmadı.
2. **Gerçek istemci render'ı.** Hiçbir şablon Gmail/Outlook/Apple Mail'de açılıp görsel olarak doğrulanmadı. Türkçe karakterlerin konu satırında doğru göründüğü **varsayım**dır (Python'un RFC 2047 kodlaması standarttır, ama gözle görülmedi).
3. **Enumeration zamanlama sızıntısı.** `password-reset/request` yanıt gövdesi sabit; **yanıt süresi** ölçülmedi. Kayıtlı kullanıcıda token üretimi + SMTP çağrısı yapıldığı için ölçülebilir fark olabilir. Ölçüm gerektirir.
4. **E-posta başlığı enjeksiyonu.** `mime["To"] = message.to` yolunda CR/LF içeren bir adresin ne olacağı test edilmedi. Adresler Pydantic üzerinden geliyor olabilir ama uçtan uca doğrulanmadı.
5. **İYS'nin resmî muafiyet metni.** iys.org.tr'nin resmî SSS/rehber sayfasına doğrudan erişilemedi; §4.2'deki aktarım **ikincil kaynaklara** (hukuk büroları, İYS hizmet sağlayıcıları) dayanır.
6. **Yönetmeliğin konsolide (güncel) metni.** Aktarılan m.6/m.9 metni **15/7/2015 tarihli ilk yayım** metnindendir; 2020 ve sonrasında değişiklikler yapılmıştır. Güncel konsolide metin doğrulanmalıdır.
7. **"Her e-postada aydınlatma metni gerekir mi?"** KVKK Tebliği'nde bu soruya doğrudan cevap veren bir hüküm bulunamadı. §4.4'teki değerlendirme yorumdur.
8. **Stok bildiriminin hukuki niteliği.** Ticari elektronik ileti sayılıp sayılmadığı **açık bir sorudur**; uzman görüşü gerektirir.
9. **OWASP'ın kesin token ömrü.** OWASP cheat sheet **sayı vermiyor**; "15–60 dakika" aralığı ikincil rehberlerden derlenmiştir.
10. **`_layout` HTML kaçış açığının gerçek istismar edilebilirliği.** Modern e-posta istemcileri `<script>`'i temizler; asıl risk biçim bozulması ve gövdeye sahte bağlantı sokulmasıdır. Somut bir istismar senaryosu üretilip denenmedi.
11. **Litmus'un "%25+ karanlık mod" verisi.** İkincil kaynaktan aktarıldı; Litmus'un kendi raporu okunmadı.

---

## Kaynaklar

**İyi uygulama / teslimat**
- [Postmark — Transactional email best practices](https://postmarkapp.com/guides/transactional-email-best-practices/)
- [Postmark — Email design guides](https://postmarkapp.com/guides/email-design)
- [OWASP — Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [Google — Email sender guidelines FAQ](https://support.google.com/a/answer/14229414?hl=en)
- [PowerDMARC — Bulk email sender requirements](https://powerdmarc.com/bulk-email-sender-requirements/)
- [Woodpecker — How to set up SPF, DKIM & DMARC](https://woodpecker.co/blog/spf-dkim/)
- [EasyDMARC — DMARC best practices](https://easydmarc.com/blog/dmarc-best-practices/)
- [Mailgun — Suppressions (bounces, complaints, unsubscribes)](https://help.mailgun.com/hc/en-us/articles/360012287493-Suppressions-Bounces-Complaints-Unsubscribes-Allowlists)
- [Campaign Monitor — Developer's guide to dark mode in email](https://www.campaignmonitor.com/resources/guides/dark-mode-in-email/)
- [MailMode — Email client dark mode support matrix](https://www.mailmode.app/learn/email-client-dark-mode-support-matrix)
- [markaplugin — HTML email best practices 2026](https://markaplugin.com/blog/html-email-best-practices-2026)
- [Kiteworks — Sending PII over email](https://www.kiteworks.com/secure-email/send-pii-over-email/)

**Şablon altyapısı**
- [fastapi-mail belgeleri (Jinja2)](https://sabuhish.github.io/fastapi-mail/)
- [MJML belgeleri](https://documentation.mjml.io/)
- [mjml#1457 — Jinja2 ile birlikte kullanım sorunu](https://github.com/mjmlio/mjml/issues/1457)

**Mevzuat (birincil)**
- [6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun — RG 5/11/2014](https://www.resmigazete.gov.tr/eskiler/2014/11/20141105-1.htm)
- [Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik — RG 15/7/2015, 29417](https://www.resmigazete.gov.tr/eskiler/2015/07/20150715-4.htm)
- [KVKK — Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ](https://kvkk.gov.tr/Icerik/5443/AYDINLATMA-YUKUMLULUGUNUN-YERINE-GETIRILMESINDE-UYULACAK-USUL-VE-ESASLAR-HAKKINDA-TEBLIG)

**Mevzuat (ikincil — yorum içerir)**
- [Mysoft / İleti Yönetimi — İYS'de izinsiz gönderilebilen iletiler](https://iletiyonetimi.com/iysde-izinsiz-gonderilebilen-iletiler-ve-yasal-duzenlemeler)
- [Kılınç Hukuk — Ticari elektronik iletiler ve İYS](https://kilinclaw.com.tr/en/commercial-electronic-communication-management-system/)
- [Aksan — Ticari elektronik ileti onayı ve reddetme hakkı](https://aksan.av.tr/en/blog/ticari-elektronik-ileti-onayi-ve-reddetme-hakki)

**Kod referansları:** `backend/core/mail/{base,sender,smtp,templates}.py` · `backend/core/outbox.py` · `backend/core/sms/sender.py` · `backend/core/config.py:126-155` · `backend/services/{verification,order,store,payout,support,notification,auth,consent,account_deletion}_service.py` · `backend/tests/test_mail_templates.py`
