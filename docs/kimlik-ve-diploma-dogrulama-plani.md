# Kimlik & Diploma Doğrulama — Uygulama Planı

> Durum: tasarım/planlama. Kod yazılmadı. Lansman hedefi Eylül 2026 (şahıs şirketi
> Temmuz, iyzico pazaryeri başvurusu Ağustos).

## 0. Temel kararlar (çerçeve)

1. **Kimlik doğrulama = iyzico'nun düzenleyici sorumluluğu.** Para alan taraf
   (eğitmen/kütüphane) iyzico'ya **alt üye işyeri (sub-merchant, PERSONAL)** olarak
   tanıtılır; MERNIS/IBAN/MASAK kontrolünü **iyzico** yapar, onaylar/reddeder.
   Onaylanmadan payout yok. → **Kendi KYC/MERNIS sistemimizi kurmuyoruz.**
2. **Biz veri toplayıcı + iletici + durum saklayıcıyız.** TCKN'yi kalıcı saklamayız;
   iyzico'ya iletip yalnız **son 4 hane + sub-merchant durumu** tutarız (KVKK yükü düşük).
3. **Ücretli 3. parti KYC (Sumsub/Veriff) YOK** — şimdilik gereksiz.
4. **Diploma doğrulama bizde, manuel + ücretsiz**: e-Devlet barkodlu belge + admin teyidi.
5. **Trust rozetleri durumdan türetilir**: "Kimliği Doğrulanmış" = sub-merchant ACTIVE;
   "Diploması Doğrulanmış" = en az bir eğitim VERIFIED.
6. **İsim/kimlik tutarlılığı zorunlu** (bkz. A6): hesap adı == iyzico'ya girilen ad ==
   MERNIS (TCKN sahibi) == diploma adı. Doğrulama sonrası yasal ad hesaba yazılır ve kilitlenir.

---

## Komisyon politikası (karar — 2026-06-17)

- **Oran: %10 brüt** (`PLATFORM_COMMISSION_RATE`, mevcut). %15 değerlendirildi, **reddedildi**
  (talep oturmadan yüksek oran arzı kaçırır).
- **iyzico işlem ücretini (~%1.95 tek çekim) PLATFORM yutar** → eğitmen/kütüphane net
  rakamı görür; gerçek platform marjı ~%8. (Net %10 isteseydik brüt ~%12 olurdu — şimdilik
  hayır.)
- **Komisyon LANSMANDAN İTİBAREN alınır** — "önce bedava sonra ekle" YOK (sonradan eklemek
  = zam = arzı küstürür). Mekanizma zaten kurulu (escrow + komisyon).
- **Lansman taktiği: zaman-kutulu açık promosyon** ("ilk 3 ay / ilk N ders %0/%5"),
  kalıcı bedava değil indirim → arzı çeker, oran zaten tanımlı, ileride zam şoku yok.
- **Gelecekte zam PLANLAMA.** Gerekirse erken tedarikçileri grandfather'la / kademeleri
  önceden duyur.
- **Mühendislik gereği:** komisyon tek global sabit kalmamalı → **promosyon override**
  (global/tedarikçi-bazlı, **bitiş tarihli**). Öneri: `Tutor`/`Library`'ye
  `commission_rate_override` + `override_until`; yoksa varsayılana düşer. Lansmanda tek
  oran, ileride taraf-bazlı.

## 1. İş parçası A — iyzico alt üye işyeri (sub-merchant) entegrasyonu  [ASIL İŞ]

Kimlik onayının gerçekleştiği yer burası. Mevcut `core/payments` (iyzico, IYZWSv2,
httpx, SDK'sız) deseninin üstüne kurulur.

### A1. Sözleşme/başvuru ön koşulu
- iyzico başvurusunda **Pazaryeri (Marketplace)** ürününün aktif edilmesi istenir.
- Şahıs şirketi kurulduktan sonra (Temmuz) ana üye işyeri açılır.

### A2. Veri modeli (Tutor + Library ortak ihtiyaç)
`Tutor` ve `Library` (operatöre değil, para alan tüzel/şahıs varlığına) eklenecek:
- `iban: str | None`
- `sub_merchant_key: str | None`        # iyzico döner, payout split'te kullanılır
- `sub_merchant_external_id: str`        # bizim stabil referansımız (ör. "tutor:{id}")
- `payout_status: enum(NONE, PENDING, ACTIVE, REJECTED)`
- `identity_last4: str | None`           # TCKN son 4 (maskeli gösterim)
- `payout_updated_at: datetime | None`
- (TCKN tam metni **saklanmaz**; onboarding sırasında iyzico'ya iletilir.)

Alembic: yeni migration (autogenerate + elle gözden geçir). `_ADDED_COLUMNS_DDL` yok.

### A3. Onboarding akışı (eğitmen "ödeme almak için")
1. Eğitmen paneline "Ödeme Bilgileri / Hesap Doğrulama" adımı.
2. Form: TCKN, ad/soyad (kimlikten), IBAN, adres, GSM + **KVKK açık rıza**
   ("TCKN/IBAN iyzico'ya ödeme aracılığı için aktarılır").
3. Backend: `core/payments` adaptörüne eklenecek metotlar (IYZWSv2 imzalı):
   - `create_submerchant(...)`  → `subMerchantType=PERSONAL`, alanlar: name, email,
     gsmNumber, address, **iban**, **identityNumber (TCKN)**, contactName/Surname,
     currency, subMerchantExternalId.
   - `update_submerchant(...)`  → IBAN/adres güncelleme.
   - `retrieve_submerchant(...)` → durum sorgulama.
4. Başarıda `sub_merchant_key` saklanır, `payout_status` iyzico sonucuna göre
   PENDING/ACTIVE. TCKN'den yalnız `identity_last4` tutulur, gerisi bırakılır.
5. **fake sağlayıcı**: dev'de anında ACTIVE (dış çağrı yok) — mevcut fake deseni.

### A4. Para akışının pazaryerine taşınması (escrow → iyzico marketplace)
Bugün escrow bizim DB'mizde (Payment HELD/RELEASED, ExamRegistration/StudyReservation
gömülü). Gerçek pazaryerinde **escrow iyzico'da**:
- Ödeme isteğinde `basketItems[].subMerchantKey` + `subMerchantPrice` gönderilir
  (komisyon = toplam − subMerchantPrice; `PLATFORM_COMMISSION_RATE`).
- Bizim `release` → iyzico **approval** (alt üyeye serbest bırakma) çağrısına bağlanır.
- Bizim `refund` → iyzico **disapproval/refund**.
- Bağlanacak mevcut hook'lar: booking complete `release`, `auto_release_no_shows`
  (deneme+çalışma no-show), iptal/iade `refund`.
- **Not:** Bu, kimlik doğrulamayla aynı entegrasyonun parçası — sub-merchant ACTIVE
  olmadan o esnafa split/approval yapılamaz.

### A5. iyzico'ya başvuruda netleşecek AÇIK SORULAR
- Pazaryeri onay süreci + sub-merchant onay süresi (anında mı, manuel mi?).
- Sub-merchant için iyzico **ek belge** ister mi (kimlik fotokopisi vb.)? İsterse
  onboarding'e belge yükleme + iyzico'ya iletim eklenir.
- Şahıs (PERSONAL) için iyzico'nun MERNIS kontrol derinliği ve red sebepleri.
- Payout/valör zamanlaması ve komisyon kesinti mekaniği (marketplace approval sonrası).
- IBAN sahiplik kontrolü iyzico'da mı (büyük olasılıkla evet)?

### A6. İsim/kimlik tutarlılığı kuralı  [KRİTİK — impersonation'ı kapatır]

**Problem:** Hesaplarda ad serbestçe düzenlenebilen `first_name`+`last_name`. Biri "X"
diye kayıt olup ödeme adımında "Y"nin (akraba vb.) TCKN+adıyla sub-merchant açarsa,
iyzico MERNIS'te Y+TCKN tutarlı olduğu için **onaylar** → profil "X" der ama gerçek
payee/doğrulanan kimlik "Y" olur. Bu boşluk kapatılmalı.

**Kural — 4 yönlü ad hizalaması:**
`hesap (first/last)` == `iyzico contactName/Surname` == `MERNIS (TCKN sahibi)` == `diploma adı`.

**Uygulama:**
1. Payout onboarding'inde iyzico'ya gidecek ad/soyad, hesabın `first_name`/`last_name`'inden
   **otomatik doldurulur** (serbest, ayrışık yazım yok).
2. iyzico/MERNIS, ad+soyad+TCKN'yi doğrular. Uyuşmazsa **REJECTED** →
   "Hesap adınız kimlik bilgilerinizle uyuşmuyor; düzeltin." (Kendi MERNIS'imiz yok;
   doğrulayıcı iyzico.)
3. ACTIVE olunca doğrulanmış **yasal ad hesaba yazılır ve kilitlenir**. Sonradan
   first/last değişikliği yeniden doğrulama gerektirir ve `payout_status`'u PENDING'e
   düşürür (kilit kalkana dek ödeme almaz).
4. **Public profil doğrulanmış yasal adı gösterir.** İstenirse ayrı "görünen ad" alanı
   olabilir ama kimlik iddiası taşımaz; "Kimliği Doğrulanmış" rozeti **yasal ada** bağlanır.
5. **IBAN sahibi de aynı kişi olmalı** (iyzico IBAN-kimlik kontrolü); başkasının IBAN'ı reddedilir.

**Edge:** Türkçe karakter/normalize (İ/I, ç/c) farkları MERNIS tam eşleşmeyi bozabilir →
trim + Türkçe-duyarlı normalize, ama gönderilen ad kullanıcının yazdığı/MERNIS'teki olmalı.
Evlilik/soyad değişikliği → MERNIS güncelse hesap adı da güncellenir.

---

## 2. İş parçası B — Trust rozeti (kimlik)

- "Kimliği Doğrulanmış" rozeti = `payout_status == ACTIVE`'den türetilir
  (`TutorTrust.tsx`'e `IdentityVerifiedBadge`, mevcut `VerifiedTutorBadge` kardeşi).
- Ödeme almayan ama rozet isteyen eğitmen senaryosu → **Faz 2**: opsiyonel kendi
  MERNIS ön-kontrolü (NVI KPSPublic SOAP, ücretsiz). Şimdilik YAPILMIYOR.

---

## 3. İş parçası C — Diploma doğrulama (manuel, ücretsiz)

İki problem ayrı: **aitlik** (bu kişinin mi) + **sahihlik** (gerçek mi).
Çözüm: **e-Devlet barkodlu belge** + admin teyidi + kimlikle ad eşleşmesi.

### C1. Veri modeli (`TutorEducation` genişletme)
- `document_type: enum(DIPLOMA, DENKLIK, OGRENCI_BELGESI)`
- `verification_status: enum(NONE, PENDING, VERIFIED, REJECTED)`
- `verification_code: str | None`        # e-Devlet barkod/doğrulama kodu
- `verified_at`, `verified_by` (admin id), `verification_method` (`edevlet_barcode`)

### C2. Akış
- Eğitmen onaya gönderirken **kağıt fotoğrafı değil**, e-Devlet barkodlu
  "Mezun Belgesi" (veya öğrenci/denklik belgesi) yükler + barkod girer.
- Admin onay ekranı: belge + barkod + `turkiye.gov.tr/belge-dogrulama` linki →
  elle teyit → onayla/reddet (audit log'a yazılır).
- **Ad eşleşmesi**: belgedeki ad, sub-merchant/kimlik adıyla aynı olmalı (aitlik bağı).

### C3. Rozet
- `hasDocumentedEducation` → `hasVerifiedEducation` (yalnız `VERIFIED`).
- Sadece dosya yüklü (doğrulanmamış) → rozet gösterilmez.

### C4. Faz 2 (hacim büyürse)
- YÖKSİS/e-Devlet entegrasyonu (YÖK protokolü) veya YÖK erişimli 3. parti firma.
  Otomatik; çünkü resmî doğrulama sayfasında CAPTCHA var, public API yok.

---

## 4. İş parçası D — KVKK / hukuk

- TCKN/IBAN işleme + **iyzico'ya aktarım** için açık rıza (onboarding'de ayrı onay).
- `legalContent.ts` KVKK aydınlatma metnine: işleme amacı (kimlik doğrulama + ödeme
  aracılığı), aktarılan taraf (iyzico), saklama (yalnız son4 + durum), süre.
- Avukat onayı (zaten bekleyen kalemlerle birlikte).

---

## 5. Sıra / zaman çizelgesi

| Ne zaman | Adım |
|----------|------|
| Şimdi → Temmuz | Bu plan onayı; veri modeli + migration tasarımı; KVKK metin taslağı; iyzico'ya sorulacaklar listesi hazır. |
| Temmuz | Şahıs şirketi kuruluşu → iyzico ana üye işyeri açılışı. |
| Ağustos | iyzico **pazaryeri** başvurusu; A5'teki açık soruların yanıtı; sandbox'ta sub-merchant create/approval akışı (fake → gerçek). |
| Ağustos–Eylül | A4 para akışının pazaryerine taşınması; rozet (B); diploma akışı (C); KVKK metni (D). |
| Eylül | Lansman: sub-merchant onboarding + diploma doğrulama canlı. |

---

## 6. Net "yapılacaklar" özeti (checklist)

- [ ] iyzico başvurusunda Pazaryeri ürününü iste; A5 sorularını sor.
- [ ] Tutor/Library'ye payout alanları + migration.
- [ ] `core/payments`'a `create/update/retrieve_submerchant` (fake + iyzico).
- [ ] Onboarding "Ödeme Bilgileri" adımı (TCKN/IBAN/adres + KVKK rıza) + api/hook/types.
- [ ] İsim hizalaması: iyzico'ya hesap adını gönder; ACTIVE'de yasal adı hesaba yaz + kilitle;
      sonradan ad değişimi → yeniden doğrulama + payout PENDING (A6).
- [ ] Ödeme isteğine subMerchant split + `release`→approval, `refund`→disapproval bağla.
- [ ] `IdentityVerifiedBadge` (payout ACTIVE'den).
- [x] `TutorEducation` doğrulama alanları + migration (`a1b2c3d4e5f6`).  ✅ 2026-06-17
- [x] Eğitmen formu: e-Devlet belge türü + barkod + durum rozeti (PENDING/VERIFIED/REJECTED).  ✅
- [x] Admin "Diploma Doğrulama" sekmesi: belge + barkod + e-Devlet teyit linki + doğrula/reddet + audit.  ✅
- [x] Rozet mantığı `hasVerifiedEducation` ("Diploması Doğrulandı" yalnız VERIFIED).  ✅
- [ ] KVKK metni güncelle (TCKN/IBAN + iyzico aktarımı).

---

## 7. Bilinçli KAPSAM DIŞI (şimdilik)

- Kendi MERNIS/KYC sistemimiz (iyzico zaten yapıyor).
- Ücretli 3. parti kimlik/diploma doğrulama.
- TCKN'nin kalıcı/şifreli saklanması (yalnız son4 tutulur).
- e-Devlet/YÖKSİS otomatik diploma sorgu entegrasyonu (Faz 2).
