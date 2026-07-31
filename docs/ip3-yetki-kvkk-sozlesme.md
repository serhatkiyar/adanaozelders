# İP-3 — Yetki, kişisel veri ve hesap güvenliği sözleşmesi

Bu belge **kırmızı test matrisiyle birlikte** yazıldı; üretim kodu henüz
değişmedi. Amacı, düzeltme yazılmadan önce "doğru davranış nedir" sorusunu
tek bir yerde sabitlemek ve her maddenin karşılığında gerçek HTTP + gerçek
PostgreSQL testi bulunduğunu göstermek.

Kaynak denetim raporu (`adana-project-audit/DENETIM-RAPORU-2026-07-31.md`)
**kanıt sayılmadı**: her bulgu koddan ve çağrı yerlerinden bağımsız doğrulandı.
İki iddia düzeltildi (§7).

---

## 1. Kütüphane operatörü mesajlaşması

**Doğrulanan durum.** `services/messaging_service.py::_can_message`:

```python
if "LIBRARY" in {a[0], b[0]}:
    return True
```

Kütüphane içeren her çift koşulsuz açık. `_validate_target` yalnız *hedef*
kütüphaneyken `status == ACTIVE` arar; operatör **gönderen** olduğunda kendi
kütüphanesinin durumuna hiç bakılmaz. `POST /libraries/register` (public,
`api/routers/libraries.py:147`) anında geçerli bir LIBRARY_OPERATOR access +
refresh token'ı üretir. `api/routers/messages.py:130` operatörü telefon
doğrulama kapısından da muaf tutar ("operatör admin-oluşturmalı" gerekçesiyle —
self-servis kayıt bu varsayımı geçersiz kılmıştır).

**Sözleşme.**

| # | Kural | Kod |
|---|-------|-----|
| 1.1 | Kütüphanesi ACTIVE olmayan (PENDING/REJECTED/HIDDEN/silinmiş) operatör mesaj gönderemez | 403 |
| 1.2 | ACTIVE operatör yalnız gerçek iş ilişkisi olan öğrenciye yazabilir | 403/404 |
| 1.3 | İlişki kaynakları: o kütüphanenin oturumuna yapılmış deneme kaydı · o kütüphanede çalışma rezervasyonu · öğrencinin kendi açtığı sohbet | — |
| 1.4 | İlişki **kütüphane bazlıdır**: A'daki kayıt B operatörünü yetkilendirmez | 403/404 |
| 1.5 | LIBRARY↔TUTOR için tanımlı bir iş ilişkisi modeli yoktur → kapalı | 403/404 |
| 1.6 | Öğrenci → ACTIVE kütüphane yönü açık kalır (public işletmeye destek talebi); bu talep ilişkiyi doğurur | 201 |
| 1.7 | İlişkisiz hedefte var olan kullanıcı ile var olmayan id **aynı** yanıtı verir; gövdede kimlik geçmez | — |

**Telefon muafiyeti.** Muafiyetin dayandığı "admin oluşturur" varsayımı artık
doğru değil. Muafiyet ancak kütüphane ACTIVE ise (yani admin onayından geçmişse)
savunulabilir; onaysız operatör her hâlde 1.1'e takılır.

## 2. Deneme sınavı cevap anahtarı

**Doğrulanan durum.** `library_exam_service._session_out` anahtarı role göre
değil yalnız `results_published_at` doluluğuna göre ekler. Aynı yardımcı
`GET /exam-sessions` (**anonim**), `GET /exam-sessions/manage` (operatör) ve
`GET /exam-registrations/mine` (öğrenci) yüzeylerini besler. `core/private_urls.py`
gövdedeki `private/` adreslerini imzaladığından sızıntı indirilebilir bir URL'ye
dönüşür.

**Sözleşme.**

1. `answer_key_url` yalnız `libraries.manage` izinli ADMIN yanıtında bulunur.
2. Operatör, öğrenci ve anonim kullanıcı hiçbir koşulda anahtar URL'si veya
   dosya anahtarı görmez. **Sonuçların yayınlanmış olması yetki değildir.**
3. `results_published` bayrağı herkese açık kalır.
4. Karar tek kaynakta verilir — `library_exam_catalog_service._to_out`'taki
   `include_answer_key` deseni `_session_out`'a da taşınır; iki desen ayrık
   kalırsa drift eder.
5. `private_urls` katmanı yetki otoritesi değildir; hassas alan yanıta hiç
   girmez.

## 3. KVKK hesap silme

**Doğrulanan durum.** `account_deletion_service.anonymize_account`:

```python
for field in ("iban", "payout_status", "tckn_encrypted"):
```

- `payout_status` `PayoutMixin`'de **NOT NULL** → eğitmen silmede
  `IntegrityError`. Global handler bunu **409**'a çevirir (denetim raporunun
  "500" iddiası yanlış — sonuç yine de: hesap silinemiyor).
- `tckn_encrypted` hiçbir modelde yok (ölü ad). Gerçek alanlar
  `PayoutMixin.identity_last4` ve `TutorEducation.verification_tckn`.
- `TutorEducation.document_url` (diploma, `private/`), `verification_code`
  (e-Devlet barkodu) ve `sub_merchant_key` de kalır.

**Sözleşme.**

1. CLIENT, TUTOR, LIBRARY_OPERATOR ve COURIER için silme 204 döner.
2. NOT NULL alanlar geçerli anonim/pasif değerine çekilir (`payout_status`
   → `'NONE'`, `None` değil).
3. Temizlenen PII: TCKN, kimlik son dördü, e-Devlet doğrulama kodu, diploma
   dosya referansı, IBAN, alt üye işyeri anahtarı.
4. Saklanan (mevzuat gereği): sipariş/ödeme/escrow satırları ve tutarları,
   `client_id` referansları. Ayrım bilinçlidir.
5. İşlem idempotenttir: ikinci çağrı 500 üretmez (401/403/404/409).
6. Denetim kaydı ve hata gövdesi PII'yi yeniden sızdırmaz; ham SQL, traceback,
   iç alan adı ve dosya yolu hata mesajına girmez.

**Açık karar (uygulama aşamasında verilecek).** Dosyanın fiziksel silinmesi
(MinIO) transaction dışıdır. Sözleşme: **önce DB referansı temizlenir ve commit
edilir, sonra depo silme best-effort denenir**; depo silme başarısız olursa
işlem geri alınmaz (referans zaten yok; yetim nesne için ayrı bir temizlik
görevi gerekir). Bunun tersi — önce dosyayı silip sonra DB'de patlamak —
kurtarılamaz durum üretir.

## 4. Öğrenci dizini

**Doğrulanan durum.** `api/routers/clients.py::_approved_viewer` yalnız
"ADMIN ya da onaylı eğitmen" der. Onaydan sonra `GET /clients/search` bütün
öğrenci tabanını sayfalar (ad-soyad, kullanıcı adı, **doğum tarihi**, cinsiyet,
hakkında) ve `GET /clients/{id}` ardışık id taramasıyla okunur (üstüne
`educations`). İlişki kontrolü yok. Frontend `useClientSearch` hook'unu hiçbir
sayfada çağırmıyor — toplu dizinin ürün karşılığı yok; kullanılan tek yüzey
ders/soru/mesaj bağlamından açılan `StudentProfile`.

**Sözleşme.**

1. Toplu öğrenci dizini eğitmene kapalıdır.
2. Eğitmen yalnız meşru rezervasyon ilişkisi olan öğrencinin profilini görür
   (PENDING talep dahil; geçmiş dersler ilişkiyi düşürmez).
3. İlişkisiz öğrenci ile var olmayan id aynı yanıtı verir (404).
4. Reşit olmayan kitle için daha dar sözleşme: tam `birth_date` dönmez,
   ders seviyesi için gereken `age` döner.
5. ADMIN erişimi `users.view` iznine bağlıdır; ADMIN olmak tek başına yetmez.

## 5. Review booking sahipliği

**Doğrulanan durum.** `GET /reviews/booking/{id}` yalnız
`get_current_active_user` ister. Aynı kaynağın üç kontrolü ayrık: GET
(kontrolsüz), PATCH/DELETE (`_assert_owner`), reply (tutor eşleşmesi).

**Sözleşme.**

1. `GET /reviews/booking/{id}` yalnız o booking'in öğrencisi, eğitmeni veya
   yetkili admin tarafından okunabilir.
2. Yorumlu / yorumsuz / hiç olmayan booking id'si **aynı** yanıtı verir.
3. Sahiplik kararı tek ortak yardımcıda verilir; router'da kopyalanmaz.

## 6. Şifre değişimi/sıfırlaması sonrası oturum iptali

**Doğrulanan durum.**

- `auth_service.change_password` / `reset_password` yalnız refresh token'ları
  iptal eder. `ACCESS_TOKEN_EXPIRE_MINUTES = 60` → eski access token bir saate
  kadar yaşar. **Beş rolün hepsinde.**
- `auth_version` claim denetimi `api/deps.py:68`'de yalnız `CourierAccount`
  için yapılır; kuryede bile `change_password` sürümü artırmaz.
- İki rol kataloğu drift etmiş: `auth_service._LOGIN_PRECEDENCE` 5 rol içerir
  (sıfırlama maili operatöre/kuryeye **gider**), `verification_service.
  _MODEL_BY_ROLE` 3 rol içerir (`consume_token` None döner → operatör ve kurye
  "şifremi unuttum" akışını **tamamlayamaz**).

**Sözleşme.**

1. Şifre değişimi ve sıfırlaması bütün rollerde mevcut access + refresh
   oturumlarını geçersizleştirir; eski access token anında 401 alır.
2. Oturum sürümü bütün kullanıcı tiplerinde gerçek auth dependency'sinde
   denetlenir (tek yerde, rol istisnası olmadan).
3. Rol→model eşlemesi tek kaynaktan türetilir; ikinci katalog tutulmaz.
4. İşlemi yapan cihaz atılmaz: yanıttaki yeni token çalışır.
5. Sıfırlama akışı ADMIN, TUTOR, CLIENT, LIBRARY_OPERATOR ve COURIER için
   uçtan uca tamamlanır ve yeni parolayla giriş çalışır.

---

## 7. Denetim raporundan sapmalar

| Rapor iddiası | Gerçek | Sonuç |
|---|---|---|
| Tutor hesap silme **500** üretiyor | **409** üretiyor (`IntegrityError` global handler'ı `core/exceptions.py`'de 409'a çeviriyor) | Bulgu geçerli (hesap silinemiyor), şiddet/tanı düzeltildi |
| `/exam-sessions` public listesi anahtar sızdırıyor | Doğru, ama yalnız `starts_at >= now` **ve** `results_published_at` dolu oturumlarda (erteleme senaryosu). Operatör ve öğrenci yüzeylerinde tarih filtresi yok → oradaki sızıntı koşulsuz | Test bunu ayrı ayrı ölçüyor |

## 8. Kapsam dışı kalan, bu iş sırasında görülenler

- `GET /exam-sessions/manage` ve kardeşleri operatörü `require_roles_or_admin_permission`
  ile geçiriyor; `get_current_active_operator` (ACTIVE kapısı) **kullanılmıyor**.
  Yani PENDING kütüphanenin operatörü kendi oturum yönetim yüzeylerine
  erişebiliyor. İP-3 kapsamındaki mesajlaşma kapısıyla aynı kök sebep; ayrı
  paket olarak ele alınmalı.
- `ruff check .` bu dalda **56 hata** ile geliyor (İP-3 dosyaları temiz);
  CI'nın lint adımı bu hâliyle kırmızı olmalı. İP-0 (CI zemini) dalının işi.
- **CI entegrasyon adımı büyük olasılıkla kırmızı.** `core/seed.py::seed_admin`
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` yoksa **sessizce no-op** olur;
  `.github/workflows/ci.yml`'nin `env:` bloğunda ikisi de yok. Stok/envanter
  entegrasyon testleri `admins.id = 1` varsaydığı için temiz bir test
  veritabanında **157 test** FK ihlaliyle kırılıyor (yerelde ölçüldü: seed
  admin'siz 157 failed / 364 passed, seed admin'le kırılma bu sebepten
  kaynaklanmıyor). Sessiz no-op'un kendisi de bir kusur: seed edilemeyen admin
  hiçbir yerde raporlanmıyor. İP-0'ın işi.
- **Flaky test:** `test_stock_migration_pg.py::test_bos_veritabaninda_upgrade_head_calisir`
  tam suite'in bir koşumunda kırıldı, aynı suite'in ikinci koşumunda ve tek
  başına koşarken geçti (3 koşumda 1 kırılma). Test kendi tek kullanımlık
  veritabanını `DROP`/`CREATE` edip `alembic`'i subprocess olarak koşuyor; en
  olası sebep bu subprocess/DB yaşam döngüsündeki yarış. İP-3 değişikliğiyle
  ilgisi yok (İP-3 yalnız test ekliyor), ama kaydedilmeden geçilmemeli.
- `pydantic.EmailStr` `.test` TLD'sini reddediyor: `@…test` adresli bir hesap
  `/auth/password-reset/request` çağıramaz (422). Gerçek kullanıcıda görülmez;
  test fabrikasında bir tur kaybettirdi (bkz. `ip3_factory.py` başındaki not).
