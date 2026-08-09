# PK-1 — Merge / Migration Sırası ve Üretim Dağıtım Kontrol Listesi

> Kapsam: **ürün kolu bazlı ödeme kapıları** (PK-1). PK-2 (iyzico Pazaryeri
> entegrasyonu) **başlamadı**; bu belge onu kapsamaz.

---

## 1. Merge sırası

PK-1 dalı (`odeme-kapilari-pk1`) `main`'in **soyundan** gelir: `main`'de olup
PK-1'de olmayan hiçbir commit yoktur. Bu yüzden rebase gereksizdir ve iki
adımlı **fast-forward** en temiz yoldur (merge commit yok, lineer tarih):

```bash
# 1) Taban dalı (dağıtım paneli) açıkça merge edilir — ff
git checkout main
git merge --ff-only dagitim-paneli-yeniden-tasarim

# 2) PK-1 merge edilir — ff
git merge --ff-only odeme-kapilari-pk1
```

`--ff-only` bilinçlidir: fast-forward mümkün değilse komut **durur**. Sessiz bir
merge commit'i yerine durup bakmak doğrudur.

---

## 2. Migration sırası

PK-1 iki migration getirir; sıra **zorunludur** (ikinci birincinin ardılıdır):

| Sıra | Revizyon | Ne yapar | Geri alma |
|---|---|---|---|
| 1 | `195ffdb6fb1b` | `feature_flags` tablosu + `settings.view`/`settings.manage` izinleri (+ SUPER_ADMIN grant) | Tabloyu ve izinleri düşürür. Operatör kararları kaybolur ama yeniden `upgrade` **katalog varsayılanlarına** döner → pazaryeri kolları **kapalı** (güvenli yön). |
| 2 | `2df064134f6c` | `tutors.iban`, `libraries.iban`, `payout_records.iban_snapshot`: `VARCHAR(34)` → `EncryptedString(255)` | **Bilinçli no-op.** 34'e daraltmak kaydedilmiş şifreli değerleri keser. |

`head` bu paketten sonra: **`2df064134f6c`**

**Bayrak satırı seed edilmez.** Varsayılanlar kodda tek kaynakta
(`core/flags.py::FLAG_SPECS`); satırı olmayan bayrak katalog varsayılanıyla
çalışır. Bu yüzden migration sonrası `feature_flags` tablosunun **boş olması
normaldir ve doğru durumdur**.

---

## 3. Üretim dağıtım kontrol listesi

Sırayla; her adım bir sonrakinin ön koşuludur.

### 3.1 Ortam
- [ ] `ENVIRONMENT=production`
- [ ] Açılış `Settings._guard_production` denetiminden geçiyor (geçmezse uygulama
      açılmaz ve eksiklerin **tamamını** tek hatada listeler)
- [ ] `TRUSTED_PROXY_IPS` dolu, `FRONTEND_BASE_URL`/`BACKEND_BASE_URL` `https://`
- [ ] `AUTO_CREATE_DB=false` — migration deploy adımıdır, açılışta çalışmaz.
      **Gerekçe yalnız "deploy disiplini" değil (TB-28, ölçüldü):** açıkken
      `core/migrations.ensure_schema` çözümlenemeyen bir damgayı
      `stamp head --purge` ile SESSİZCE `head`'e taşır; sonraki
      `upgrade head` yapacak iş bulamaz ve **başarıyla döner**. Araya giren
      migration hiç koşmamış olur (İP-16'da izin kodları bayat kaldı ve admin
      uçları SUPER_ADMIN'e dahi 403 döndü — hata görünmedi). Yani bayrak
      açıkken uygulama şema/damga uyumsuzluğunu **düzeltmeden örter**. Guard
      bunu zaten reddeder; madde onu örtük davranış olmaktan çıkarır

### 3.2 Gerçek sağlayıcılar
- [ ] `PAYMENT_PROVIDER=iyzico` (guard zorunlu kılar; `fake` **para tahsil
      etmeden** başarı döner)
- [ ] `IYZICO_API_KEY` / `IYZICO_SECRET_KEY` dolu
- [ ] `EMAIL_PROVIDER` ve `SMS_PROVIDER` `console` **değil**
- [ ] `ROUTING_PROVIDER` `vroom` veya `auto`; `VROOM_URL` servis adı

> **Not:** `PAYMENT_PROVIDER=iyzico` verildiği sürece pazaryeri kolları
> **kendiliğinden kapalıdır** (`supports_marketplace=False`, PK-2'ye kadar).
> Kalan risk: canlıyı `ENVIRONMENT=development` + `fake` ile koşturmak — o
> senaryoda `_guard_production` hiç çalışmaz ve ödeme kapısı zincirin en zayıf
> halkası değildir (SMS/e-posta konsola gider, JWT zayıf kalabilir). Dağıtım
> disiplini işidir, kod guard'ı değil.

### 3.3 Migration
- [ ] `alembic upgrade head` çalıştırıldı
- [ ] `alembic current` → **`2df064134f6c`**
- [ ] Kolon genişlikleri doğrulandı (şifreli IBAN artık 255):

```sql
SELECT table_name, column_name, character_maximum_length
FROM information_schema.columns
WHERE (table_name='tutors' AND column_name='iban')
   OR (table_name='libraries' AND column_name='iban')
   OR (table_name='payout_records' AND column_name='iban_snapshot');
-- üçü de 255 dönmeli
```

> Migration koşulmazsa uygulama **açılmaz**: `flags.probe()` `feature_flags`'i
> okuyamaz ve üretimde bu sert hatadır. "Kapalı" ile "okuyamıyorum" bilinçli
> olarak ayrılmıştır.

### 3.4 Bayrak doğrulaması
- [ ] `feature_flags` tablosu var (boş olması normal)
- [ ] `settings.view` / `settings.manage` izinleri katalogda ve SUPER_ADMIN'de:

```sql
SELECT p.code, r.code AS role
FROM admin_permissions p
LEFT JOIN admin_role_permissions rp ON rp.permission_id = p.id AND rp.deleted_at IS NULL
LEFT JOIN admin_roles r ON r.id = rp.admin_role_id
WHERE p.code LIKE 'settings.%';
-- iki izin, ikisi de SUPER_ADMIN'e bağlı olmalı
```

- [ ] `manual_payout_enabled` **kapalı** (satır yoksa varsayılan kapalı).
      Açık bırakılmışsa uygulama açılışta hata verir — bilinçli.

### 3.5 `/health` hazırlık raporu
- [ ] `GET /health/live` → `{"status":"alive"}` (liveness probe **bunu** kullanır)
- [ ] `GET /health` → `status: ok`, `database: connected`
- [ ] `payment_branches` bloğu üç kolu raporluyor
- [ ] **Üretimde `blockers` alanları GÖRÜNMEZ** (public uç; teşhis adları iç bilgi)

Tek bir global "hazır mı" boolean'ı **bilinçli olarak yoktur**: kolların tek
sayıya indirilmesi bir kolun eksiğinin diğerini kapatmasına yol açar.

### 3.6 Kabul kontrolü — varsayılan kapı durumları

Üretimde beklenen tablo:

| Kol | Beklenen | Sebep |
|---|---|---|
| `store` | **AÇIK** | Platformun kendi kitabı = doğrudan satış, kendi cirosu. Alt üye işyeri gerekmez; 6493 sorusu doğmaz. |
| `tutor_marketplace` | **KAPALI** | Eğitmen adına tahsilat. Bayrak varsayılan kapalı **ve** `supports_marketplace=False`. |
| `library_marketplace` | **KAPALI** | Kütüphane adına tahsilat. Aynı koşullar + 5580 görüşü bekliyor. |
| `manual_payout_enabled` | **KAPALI (kilitli)** | Üretimde bayrağa bakılmaksızın 403; panelden açılamaz (409). |

Duman testi (anonim):

```bash
curl -s https://<alan>/api/v1/payments/availability
# store.open = true ; iki pazaryeri kolu open = false
# blockers / flag_enabled alanları BULUNMAMALI

curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://<alan>/api/v1/payments/booking/1/pay -H "Authorization: Bearer <client>"
# 503  (code: PAYMENT_BRANCH_CLOSED)
```

- [ ] Mağazadan gerçek bir kitap siparişi uçtan uca tamamlanıyor
- [ ] Ders ödemesi **503** dönüyor ve kullanıcı arayüzünde ödeme butonu yerine
      nötr şerit görünüyor
- [ ] `POST /payouts` **403** (`MANUAL_PAYOUT_DISABLED`)

### 3.7 Dağıtım sonrası
- [ ] Log'da `Ödeme kolu KAPALI: tutor_marketplace / library_marketplace` uyarıları
      görünüyor (beklenen)
- [ ] `KAPALI kolda tahsilat tamamlandı` ERROR'u **görünmüyor** (görünürse
      kapatma kararının artçı penceresi drenaj ediyor demektir — 48 saate kadar
      sürebilir, izlenmeli)

---

## 4. Açık engelleyiciler (PK-1 ile kapanmadı)

| Engelleyici | Sahip | Not |
|---|---|---|
| **`legalDebt.ts::escrow-tum-odemeler`** — "Platformdaki tüm ödemeler önce emanete alınır" cümlesi hiçbir kol için doğru değil | **PK-7** | Metin **avukat onayı olmadan değiştirilmedi**. Kütük + `legalDebt.acceptance.test.ts` sessizce eskimesini engelliyor. **Lansman engelleyicisi — çözülmüş değil.** |
| iyzico Pazaryeri başvurusu + **settlement kanalı** (API / panel CSV / SFTP) | kullanıcı | PK-2'nin `SettlementSource` seçimi buna bağlı; **varsayım yapılmadı** |
| Ödeme hukuku avukatı yazılı görüşü (6493) | kullanıcı | Pazaryeri kollarının açılma ön koşulu |
| SMMM / GİB muktezası (mükellef olmayan eğitmene stopaj) | kullanıcı | `invoicing_live` ön koşulu |
| MEB İl MEM görüşü (5580 etüt merkezi) | kullanıcı | `library_marketplace` ön koşulu |
| ETBİS kaydı (MERSİS + KEP) | kullanıcı | Faaliyete başlamadan önce zorunlu |

---

## 5. Geri alma (rollback)

1. Uygulama sürümünü önceki imaja döndür.
2. **Migration'ı geri almak gerekmez**: `feature_flags` tablosunun varlığı eski
   sürümü etkilemez, IBAN kolonlarının geniş olması da zararsızdır (yalnız
   ileri yönde güvenli tasarlandı).
3. Bir kolu acilen kapatmak için migration'a dokunmaya gerek yok: **Ayarlar →
   Ödeme Kapıları** ekranından bayrağı kapat (gerekçe zorunlu, denetime yazılır).
   Değişiklik tüm süreçlerde en fazla **10 saniye** içinde etkilidir.
