# Ekspertiz Raporu — Adana Özel Ders

**Tarih:** 28 Temmuz 2026 · **Kapsam:** Tüm kod tabanı (backend + frontend + altyapı + ürün olgunluğu)
**Yöntem:** 5 paralel derin inceleme + doğrudan ölçüm (test çalıştırma, coverage, canlı DB sorgusu, build).
Bu rapordaki her bulgu kod okunarak doğrulanmıştır; ölçümler gerçek komut çıktılarıdır.

---

## 1. Genel Yargı

**Bu kod tabanı zayıf değil — dengesiz.** Motor iyi, şasi eksik.

Mühendislik kalitesi birçok yerde referans seviyesinde: `services/escrow.py` (koşullu UPDATE ile
compare-and-swap claim, iki fazlı iade intent'i), `core/outbox.py` (`FOR UPDATE SKIP LOCKED`
transactional outbox), booking için GiST exclusion constraint, kurye rolünde IDOR'a karşı 404
disiplini, audit redaction, `Decimal` ile tutarlı para aritmetiği, sunucu-otoriteli fiyatlandırma.
200 satırı geçen tek bir fonksiyon yok. 1739 fonksiyonda 15 TODO var.

Sorun **kapsam tutarsızlığı**: doğru desenler yazılmış ama bazı yüzeylere hiç uygulanmamış.
Ders, deneme bileti ve çalışma rezervasyonu para yolları titizlikle sertleştirilmiş;
**mağaza siparişi yolu bu korumaların hiçbirine sahip değil** — ve en yüksek hacimli, geri
alınamaz yan etkileri (stok, kupon) olan tek yüzey o.

İkinci sorun: **uygulama olgun, işletme katmanı yok.** Üretim dağıtım hattı, TLS, yedekleme,
hata izleme, ortam ayrımı — hiçbiri mevcut değil. Eylül lansmanına kadar yazılacak koddan çok
**kurulacak altyapı** var.

Üçüncü sorun: **ölçek körlüğü.** Sistem hiçbir zaman gerçekçi veri hacmiyle çalışmadı.

---

## 2. Ölçümler

| Metrik | Değer | Not |
|---|---|---|
| Backend | 46.577 satır Python · 336 dosya · 38 servis · 33 router | |
| Frontend | 66.255 satır TS/TSX · 396 dosya | |
| Şema | 79 tablo · 132 FK · 91 index · 46 migration | |
| Birim testleri | **282/282 geçiyor** (7,5 sn) → *29 Tem: **483/483*** | Yeşil |
| Entegrasyon testleri | **62 test — CI'da hiç koşmuyor** (SKIP) → *Hafta 3'te CI'ya bağlandı* | Postgres servisi yok |
| Doğrulama paketi (gerçek DB + depo + HTTP) | *29 Tem: **92 test*** | Mock'suz, izole DB |
| **Test kapsaması** | **%19** → *29 Tem: **%22*** | 🔴 |
| `tsc --noEmit` | **0 hata** (strict açık) | Güçlü |
| Frontend build | 613 KB JS (gzip 188 KB) + 144 KB CSS · `dist/` 18 MB | |
| `npm audit --omit=dev` | **9 açık** (1 kritik, 3 yüksek, 5 orta) | axios + react-router prod'da |
| Canlı DB | 14 eğitmen · 27 rezervasyon · 8 sipariş · 89 mesaj | Hiç ANALYZE görmemiş |
| İndekssiz FK | **24 adet** | `booking_comments.booking_id` dahil |
| *29 Tem — ölçek provası* | *10× hacimde 36 uç ölçüldü; 12 FK + 5 sıralama indeksi eklendi* | *Bkz. Hafta 5* |

### Kapsama detayı — testler yanlış yerde

Saf yardımcı fonksiyonlar test edilmiş (`delivery_metrics` %100, `delivery_promise` %98,
`delivery_timeline` %98), **para ve ticaret motoru edilmemiş**:

| Servis | Satır | Kapsama |
|---|---|---|
| `store_service.py` | 436 | **%0** |
| `auth_service.py` | 83 | **%0** |
| `search_service.py` | 157 | **%0** |
| `escrow_reconciler.py` | 94 | **%0** |
| `qa_service.py` / `review_service.py` / `tutor_service.py` / `demand_service.py` | — | **%0** |
| `payment_service.py` | 171 | %17 |
| `delivery_service.py` | 667 | %18 |
| `order_service.py` | 488 | %19 |

---

## 3. P0 — Lansmanı Bloklar

### 3.1 Para yolu

**P0-1 · Mağaza siparişinde sessiz çift tahsilat.**
`api/routers/payments.py:145-150` — callback'te booking/examreg/studyres dallarının üçü de
`token=token, paid_price=result.paid_price` geçiriyor. **Sipariş dalı geçirmiyor**; çünkü
`order_service.complete_checkout` (`:472`) imzasında bu parametreler yok. Booking yolunda
(`payment_service.py:228-253`) token uyuşmazlığı ve `paidPrice` uyuşmazlığı
`escrow.refund_unexpected_charge` ile otomatik iade ediliyor — sipariş yolunda hiçbir kontrol yok.
*Sömürü:* Müşteri `/pay`'i iki kez çağırır, iki CF oturumu açılır, ikisini de öder. İlk callback
siparişi PAID yapar, ikinci callback `if order.payment_status == "PAID": return` ile sessizce
yutulur. İkinci tahsilat ne emanete alınır ne iade edilir, hiçbir kayıt tutulmaz.

**P0-2 · Kaybolan callback'te sipariş sonsuza dek PENDING.**
`grep -c "Order" services/escrow_reconciler.py` → **0**. Reconciler `Payment`, `ExamRegistration`
ve `StudyReservation`'ı tarıyor; `Order`'ı taramıyor. Müşteri iyzico'da öder, tarayıcıyı kapatır →
para çekilmiştir, sipariş PENDING kalır, kitap gönderilmez, kimse fark etmez.

**P0-3 · Sipariş PENDING→PAID atomik claim edilmiyor.**
`order_service.py:480-486` klasik check-then-act; satır kilidi ve koşullu UPDATE yok. Eşzamanlı iki
callback ikisi de kontrolden geçer → `p.stock = max(0, p.stock - qty)` (`:559`) **iki kez** uygulanır,
`coupon_service.redeem` (`:550`) `used_count`'u iki kez artırır. Proje kendi çözümüne sahip:
`escrow.claim(...)`.

**P0-4 · Sipariş iadesi tek fazlı — çökmede iz kalmıyor.**
`order_service.py:1047-1053` önce sağlayıcıyı çağırıp sonra durumu yazıyor. `Order`'da `REFUNDING`
durumu, `refund_attempts`, `refund_requested_at` **yok**. Commit düşerse: para iade edilmiş, sipariş
PAID, stok geri yüklenmemiş, yönetici tekrar denerse ikinci iade gider. `escrow.py`'deki iki fazlı
intent deseni bu yüzeye uygulanmamış.

**P0-5 · Kupon limitinde TOCTOU.**
`coupon_service.py:74` limitleri sipariş **oluşturulurken** kontrol ediyor; `CouponRedemption`
satırı ancak PAID'de yazılıyor ve `redeem` (`:96-107`) `FOR UPDATE` alıyor ama limiti **yeniden
kontrol etmiyor**. *Sömürü:* `per_user_limit=1` kuponla 10 sipariş oluştur (hepsi PENDING, hiç
redemption yok → `evaluate` her seferinde geçer), sonra 10'unu da öde.

> **Ortak düzeltme:** Bu beşi ayrı ayrı yamalanmamalı. `escrow.py` zaten `EscrowSpec` dataclass'ına
> sahip — `ORDER_SPEC` ekleyip sipariş yüzeyini aynı soyutlamanın (`claim` + `refund_escrow` +
> `refund_unexpected_charge`) arkasına al, reconciler hedeflerine dahil et. Yeni kod yazmak değil,
> mevcut doğru kodu bağlamak. **Tahmini: 2-3 gün.**

**P0-6 · Para çıkışı hiç kodlanmamış.**
`core/payments/iyzico.py:323` — `create_submerchant` bilinçli olarak `success=False` dönüyor;
charge payload'ında `subMerchantKey` yok; `main.py`'de payout job yok. Escrow "RELEASED" yalnızca
**defter kaydı** — eğitmen ve kütüphanelerin kazandığı para hiçbir otomatik yolla ödenmiyor.
*Karar gerekli:* ya (a) lansmanda marketplace dikeylerini kıs (yalnız platform kendi satar), ya da
(b) admin panelde "Bu hafta ödenecekler" raporu (IBAN + net tutar + dönem + ödeme damgası) ile
**bilinçli** manuel operasyon. Sessizce canlıya çıkmamalı.

### 3.2 Güvenlik

**P0-7 · Tek header ile tüm anonim koruma iptal.**
`core/ratelimit.py:34-39` `X-Forwarded-For`'u doğrulamasız kabul ediyor; `Dockerfile:18`'de
`--proxy-headers`/`--forwarded-allow-ips` yok, ters proxy de yok. Her istekte rastgele XFF gönderen
biri şunları sıfırlar: login brute-force koruması (10/dk), kayıt spam'i, şifre sıfırlama /
doğrulama maili maliyeti (5/dk), sipariş takip token'ı (60/dk). *Anonim yüzeydeki tek koruma bu.*

**P0-8 · Üretimde sessizce "sahte ödeme" moduna düşülebilir.**
`core/config.py:114` → `PAYMENT_PROVIDER: str = "fake"`; `payments/factory.py:17` → `iyzico`
değilse **sessizce** `FakePaymentProvider` (her zaman başarı döner, para tahsil etmez).
`config.py`'de `ENVIRONMENT` alanı **yok**. Aynı sorun `EMAIL_PROVIDER=console` (`:88`) ve
`SMS_PROVIDER=console` (`:104`) için de geçerli — üretimde OTP'ler müşteriye gitmez, **log'a**
yazılır. `.env`'de tek satır unutulursa platform para tahsil etmeden satış yapar.

**P0-9 · Public kütüphane kaydı → deneme sınavı cevap anahtarları.**
`api/routers/libraries.py:143` — auth'suz `POST /libraries/register`, anında access+refresh token
dönüyor. `api/routers/library_exam_catalogs.py:38` `/usable` yalnız **rol** kontrolü yapıyor,
kütüphanenin `status`'una bakmıyor; `schemas/library_exam_catalog.py:45` `answer_key_url`
dönüyor; dosya public-read bucket'ta. **Zincir:** kayıt ol → token al → tüm cevap anahtarlarını
indir. Aynı alanın oturum çıktısında yayın kapısına bağlı olması (`library_exam_service.py:107`)
bunun kasıtlı olmadığını gösteriyor.
*Ek not:* `CLAUDE.md` "self-servis onboarding yok" diyor — **doküman ile kod çelişiyor.**

**P0-10 · Depolanmış XSS + localStorage'da refresh token.** — ✅ *XSS Hafta 1, CSP Hafta 11,
token çereze taşındı Hafta 12*
`schemas/library.py:105` → `website` alanında yalnız `max_length`, URL şeması doğrulaması yok
(karşı örnek aynı repoda: `schemas/booking.py:18` `^https?://` zorunlu). `LibraryMapPanel.tsx:147`
ham `href={detail.website}`. `authStore.ts:72-75` **refresh token'ı** localStorage'da tutuyor.
`nginx.conf`'ta CSP yok. Zincir: `javascript:` URL'i → token hırsızlığı → 30 günlük kalıcı hesap devri.

**P0-11 · `Tutor1234!` şifreli sahte eğitmenler canlıda.**
`main.py:92` her açılışta `seed_tutors` çağırıyor; `core/seed.py:80` `_SEED_TUTOR_PASSWORD =
"Tutor1234!"` repoda açık; `:216` `status=APPROVED`. Canlı DB ilk açılışta arama sonuçlarında
görünen, şifresi herkesçe bilinen sahte eğitmenlerle dolar. `AUTO_CREATE_DB` da varsayılan `True`
(`config.py:240`).

**P0-12 · Compose'da varsayılan sırlar.**
`docker-compose.yml:125` `JWT_SECRET_KEY:-change-this-...`, `:128` `ADMIN_PASSWORD:-change-this-...`,
`:11` `POSTGRES_PASSWORD:-postgres`, `:48` `minioadmin/minioadmin`. Olduğu gibi sunucuya alınırsa
JWT forge edilebilir → herkes admin.

**P0-13 · `/docs` ve `/redoc` ortamdan bağımsız açık** (`main.py:110`) — tüm admin/kurye/ödeme
uç haritası anonim ziyaretçiye sunuluyor. Güvenlik başlıkları (CSP/HSTS/X-Frame-Options) hiç yok.

**P0-14 · Onaysız TUTOR tüm öğrenci tabanını çekebiliyor.**
`api/routers/clients.py:26` yalnız `role_id`'ye bakıyor, `Tutor.status` kontrolü yok (proje
`get_current_approved_tutor`'a sahip, kullanılmamış). Kayıt ol → login → `/clients/search`
döngüsü → tüm öğrencilerin adı, **doğum tarihi**, cinsiyeti. Kitlenin çoğu reşit olmayabilir.

**P0-15 · Şifre sıfırlama mevcut oturumları iptal etmiyor.**
`auth_service.py:190` yalnız hash'i değiştiriyor. Hesabı ele geçiren saldırganın 30 günlük refresh
token'ı, kurban şifresini değiştirdikten **sonra da** çalışır.

**P0-16 · Tek public-read bucket.** — ✅ *29 Tem, commit `a3561b9`; bkz. Hafta 10*
`core/storage.py:29-34` her açılışta tüm bucket'a `s3:GetObject` for `*` uyguluyor; kodda hiç
presigned URL üretimi yok. Aynı bucket'ta: eğitmen diploması, öğrenci karne/optik belgesi, sınav
cevap anahtarları, **teslimat kapı fotoğrafları**, kurye vesikalığı, ücretli dijital ürünler.
(Hafifletici: `ListBucket` kapalı, anahtarlar `uuid4` — risk URL sızıntısıyla gerçekleşir.)

### 3.3 Yasal (Türkiye)

| # | Konu | Kanıt | Etki |
|---|---|---|---|
| P0-17 | **KDV alanı hiç yok** | `models/store.py`'de `tax_rate` yok | Kitap %0, kırtasiye/dijital %20 — doğru fatura kesilemez |
| P0-18 | **Fatura üretimi yok** | `invoice\|fatura` grep'i boş; `OrderInvoiceModal.tsx:142` "resmi belge değildir" | Her B2C satışta vergi ihlali |
| P0-19 | **Rıza kaydı saklanmıyor** | `LegalConsent.tsx:12` "state gerekmez"; modellerde `consent` kolonu yok | KVKK'da ispat yükü veri sorumlusunda |
| P0-20 | **Hesap silme ucu yok** | `/auth/me/delete` yok; tek silme `DELETE /me/avatar` | `legalContent.ts:133` bunu taahhüt ediyor — kod çelişiyor |
| P0-21 | **Cayma hakkı reddedilebiliyor** | `order_service.py:1193` admin `reject_return` | 14 günlük cayma **koşulsuzdur**, satıcının ret yetkisi yok |
| P0-22 | **Kısmi iade imkânsız** | `order_service.py:1037` daima `order.total` | 3 kitaptan 1'i iade edilince tümü geri ödeniyor |
| P0-23 | **Fiyat geçmişi yok** | `compare_at_price` serbest düzenlenebiliyor | İndirimde son 30 günün en düşük fiyatı gösterilmeli |
| P0-24 | **ETBİS kaydı yok** | Repoda 0 iz | E-ticaret için zorunlu; süreç işi, **şimdi başlatın** |
| P0-25 | **Destek kanalı yok** | `/iletisim`, `/sss` rotası yok; `Tickets.tsx` = biletlerim | Mesafeli satışta erişilebilir iletişim zorunlu |

### 3.4 Canlı hata ve körlük

**P0-26 · Kategori filtresi kırık.** `store_service.py:276` tam eşitlik (`category_id == X`), alt
kategoriye genişletme yok; frontend yalnız **üst** kategorileri chip yapıyor
(`StorePage.tsx:60-63`), seed ürünleri **yaprak** kategorilere atıyor (`seed_kitapsec.py:87`).
Sonuç: mağazanın birincil gezinme yolu 0 ürün gösteriyor. *Bu bir boşluk değil, canlı hata.*
**~2 saat.**

**P0-27 · Hiçbir hata izleme ve analitik bağlı değil.** — ✅ *hata izleme Hafta 3, analitik Hafta 11*
Backend Sentry opt-in ve DSN boş; frontend'de
`@sentry/react` yok, `ErrorBoundary` yalnız `console.error` yapıyor. Analitik (GA/Plausible/PostHog)
grep'i **0**. Canlıda ödeme ekranında beyaz ekran görülse haberiniz olmaz; lansman gününün verisi
geri dönülmez şekilde kaybolur. **~1,5 saat toplam.**

**P0-28 · Yedekleme stratejisi yok.** Repoda hiç `pg_dump`/backup script'i, cron'u veya compose
servisi yok. Escrow para kayıtları, audit log ve KVKK kapsamındaki veri tek diskte, kopyasız.

**P0-29 · TLS ve üretim dağıtım hattı yok.** `nginx.conf` yalnız `listen 80`, sertifika yok;
`.github/workflows/` içinde deploy job'u yok; prod compose yok. iyzico üretim başvurusu da HTTPS
olmadan geçmez.

### 3.5 SEO — pazaryeri için varoluşsal

**P0-30 · Derin envanter arama motoruna görünmez.**
Monorepo'da **sitemap yok** (`robots.txt` özenle yazılmış ama `Sitemap:` satırı yok). Üç public
liste sayfası da buton tabanlı: `PublicMarketplace.tsx:289`, `Libraries.tsx:357`,
`StorePage.tsx:268` → crawler yalnız **ilk sayfayı** görüyor. İkinci sayfadan sonraki her eğitmen,
kütüphane ve ürün organik olarak erişilemez. Bir pazaryerinin değeri uzun kuyruk sorgularındadır
("adana matematik özel ders") — bu tek kusur o kanalı kapatıyor.

**P0-31 · SSR/prerender yok.** `dist/index.html` her rota için aynı jenerik başlık; `Seo.tsx`
meta'ları yalnız runtime enjekte ediyor. WhatsApp/Twitter/Facebook botları JS çalıştırmaz →
paylaşılan eğitmen/ürün linki **jenerik önizleme** olarak çıkar.

---

## 4. P1 — Lansmandan Hemen Sonra

**Dayanıklılık**
- `main.py:38-60` tek `try` bloğu: `dispatch_task_reminders` patlarsa escrow mutabakatı ve teslimat
  watchdog'u o turda hiç çalışmaz → emanetteki para kilitlenir. *(Session'lar ayrılmış, `try` ayrılmamış.)*
- Arka plan döngüleri her replikada koşuyor, lider seçimi yok (`main.py:96-98`). `send_due_reminders`
  ve `dispatch_task_reminders` atomik claim etmiyor → 2 worker = 2 kat bildirim. Proje
  `pg_advisory_xact_lock`'u zaten kullanıyor (`order_service.py:118`).
- bcrypt (`core/security.py:14`) ve Pillow (`core/storage.py:95`) event loop'u blokluyor;
  sağlayıcı HTTP çağrıları açık transaction + satır kilidi altında (`order_service.py:423`, `:1047`).
  Üçü birlikte ilk trafik dalgasında havuz tükenmesi üretir.
- S3/MinIO'da timeout/retry yapılandırması yok (`storage.py`, 5 client) → erişilemez MinIO'da tek
  istek ~240 sn DB session tutar.
- DB'de `pool_recycle`, `pool_timeout`, `statement_timeout` yok (`core/database.py:12`).
- 24 indekssiz FK; `booking_comments/resources/private_notes.booking_id` her ders detayında sorgulanıyor.

**Frontend**
- **4,21 MB ikon ana sayfada**: `CategoryBar.tsx:63` beş adet 1024×1024 PNG'yi 48×48'e çiziyor.
  `public/` 16 MB, WebP/AVIF **hiç yok**, 57 `<img>`'nin 16'sında lazy, 1'inde width.
- ✅ ~~Leaflet (144 KB) entry chunk'ta~~ — *29 Tem, commit `0dead97`*: `DistrictMapModal` lazy
  yüklenir; harita açılmadıkça hiçbir harita kodu inmez. **Giriş paketi 613 → 504 KB
  (gzip 188 → 158 KB).**
- `index.html:19` `@tabler/icons@latest` — 150 KB render-blocking, pinlenmemiş, SRI'siz CDN CSS;
  karşılığında **3 kullanım** ve üçü de ölü prototip dosyalarında.
- `nginx.conf`'ta **gzip yok** — 613 KB JS sıkıştırılmadan gidiyor (gzip'lense 188 KB).
- Test prototipleri prod'da açık ve indekslenebilir: `App.tsx:300-302` (`/test-bilet`,
  `/test-canli-ders`, `/test-kutuphane-karti`), `DEV` koruması yok.
- `tile.openstreetmap.org` 6 dosyada — OSMF politikası ticari kullanımı yasaklar. Engellendiği an
  kütüphane haritası, **checkout adres pin'i** ve **canlı kurye takibi** aynı anda çöker.
- ✅ ~~Global sorgu hata yönetimi yok~~ — *29 Tem, commit `0dead97`*: `QueryCache`/`MutationCache`
  `onError` → tek bildirim + Sentry. 401/403/404 ve iptal edilen istekler bilinçli olarak sessiz;
  aynı mesaj 4 sn içinde tekrarlanmaz; bileşen `meta: { silentError: true }` ile devre dışı bırakabilir.
- ✅ ~~ErrorBoundary router'ın dışında~~ — ikinci sınır (`RouteErrorBoundary`) router'ın içinde ve
  rota değişince sıfırlanır; kullanıcı gezinerek toparlanır, tam sayfa yenileme gerekmez.

**Erişilebilirlik** — ✅ *29 Tem, commit `0dead97`*
- ✅ ~~`htmlFor` kullanımı 0~~ → `components/ui/Field` (useId + `aria-describedby` + `role="alert"`)
  ve 60+ alan bağlandı. Düğme gruplarını etiketleyen `<label>`'lar **yanlış elemandı** (bir
  kontrole bağlanamadıkları için ekran okuyucuda hiçbir şey yapmıyorlardı) → `role="group"` +
  `aria-label`. **eslint-plugin-jsx-a11y CI'da**: 69 ihlal → **0 hata**.
- ✅ ~~18 modalda focus trap yok~~ → ortak `useModalA11y` (admin `Dialog` da artık onu kullanır)
  + tüketici `components/ui/Modal` (portal, `aria-modal`, Esc, odak iadesi, kaydırma kilidi).
  ⚠️ *Yolda bulunan hata:* `panelClassName` verilince panel `relative`'i kaybediyor, arka planın
  altında kalıp **tıklanamaz** hale geliyordu — regresyon testi yazıldı.
- ✅ ~~`HeroSearch` focus göstergesi yok~~ → `focus-within` halkası + `aria-label`.

**Ürün**
- ✅ ~~Türkçe arama kör~~ — *29 Tem, commit `ef9a9c5`*: `tr_normalize()` hem yazma (generated
  tsvector + trigram indeksleri) hem sorgu tarafında. `unaccent` **bilinçli olarak kullanılmadı**
  (IMMUTABLE olmadığı için generated kolonda çalışmaz; Türkçe harf kümesi kapalı olduğundan
  `translate()` yeterli ve bağımsız).
  ⚠️ *Asıl sorun diakritik değil EKTİ:* `simple` sözlüğü kök bulmaz, "ogretmen" ≠ "ogretmeni".
  Sorgu artık **önek eşleşmeli** (`ogretmen:*`) — arama kutusunda yazarken de doğru davranış.
  *Üçüncü bulgu:* eğitmen ad-soyad trigram indeksi **hiç yoktu**, her arama tam tablo taraması
  yapıyordu.
- ✅ ~~`publisher`/`author`/`cover_type` filtre olarak açılmamış~~ — çoklu seçim + normalize
  karşılaştırma + `/store/book-facets` (seçenekler ve sayılar) + sayaçlı panel.
- ✅ ~~Admin panelde para metriği yok~~ — *29 Tem, commit `5db0208`*: `GET /admin/revenue` +
  panelde "Para" bölümü. Üç ayrım açıkça yapıldı: **emanet gelir değildir**, **komisyon ile
  doğrudan satış ayrıdır** (fiziksel üründe mal maliyeti var), **iade oranı tutar bazındadır**.
- ✅ ~~Yorum moderasyonu yok~~ — *29 Tem, commit `6a8a49b`*: `ModeratableMixin`
  (`hidden_at`/`hidden_by`/`hidden_reason`) üç yorum tablosunda, `content_moderation` servisi,
  admin uçları + şikayet çözümüne `hide_target` bayrağı. **Gizlenen yorum puan ortalamasından da
  düşülür** — aksi halde ekrandan kalkan 1 yıldızlı yorum eğitmenin puanını düşürmeye devam ederdi.
- ✅ ~~Anti-disintermediation maskesi 4 yüzeyde~~ — *29 Tem, commit `ddd757a`*: 9 yüzeye çıktı
  (eğitmen profili, QA, eğitmen/ürün/kütüphane yorumu, öğrenci talebi).
  ⚠️ *Yolda bulunan sorun:* mevcut regex **"2020 - 2024 arası lisans"** ifadesini de gizliyordu;
  maskeyi profil metinlerine olduğu gibi yaymak ürünü sessizce bozardı. Karar iki aşamalı hale
  getirildi (aday yakalama → `_looks_like_phone` saf fonksiyonu); yıl aralığı, soru numarası,
  saat ve fiyat korunur, boşluksuz numara ve `wa.me`/`t.me` kısayolları yakalanır.
- ✅ ~~IBAN düz metin~~ — *29 Tem, commit `ddd757a`*: üç kolon şifrelendi (`tutors.iban`,
  `libraries.iban`, `payout_records.iban_snapshot`; migration `3fe0fd1ed73b` mevcut veriyi taşır).
  Değişiklik artık **sahibine güvenlik e-postası** + uygulama içi bildirim + audit üretiyor
  (audit kütüphane yolunda vardı, eğitmen yolunda yoktu).

---

## 5. P2 — İlk 90 Gün

Sunucu tarafı sepet + terk hatırlatması · PWA (`vite-plugin-pwa`) · kupon kapsamı
(`category_id`/`first_order_only`/`free_shipping`) · pazarlama izni + İYS kaydı · bildirim
kategorileri · mağaza içeriği raporlama (`PRODUCT`/`PRODUCT_REVIEW` whitelist'e) · doğrulanmış
satın alma rozeti (kapı zaten var, rozet yok) · dış kargo manuel takip-no akışı · yapısal JSON log ·
WebSocket Redis pub/sub · bundle vendor bölme.

**Bilinçli olarak yapılmayacaklar:** A/B test altyapısı, öneri motoru (ML), ürün karşılaştırma,
satıcı performans skoru, sahte yorum tespiti, sadakat/puan programı, native mobil uygulama,
Kubernetes/Terraform, Elasticsearch, Prometheus/Grafana. Bu ölçekte hepsi net zarar.

---

## 6. Tekerleği İcat Etme — Hazır Çözümler

| İhtiyaç | Çözüm | Maliyet |
|---|---|---|
| Hata izleme | **Sentry** ücretsiz katman (5k olay/ay), backend + `@sentry/react` | 0 ₺ · 30 dk |
| Analitik | **Plausible** veya **Umami** self-host (çerezsiz → banner gerekmez) | 0 ₺ · 1 sa |
| Uptime + alarm | **UptimeRobot** ücretsiz (`/ready` üzerinden) | 0 ₺ · 30 dk |
| Deploy + TLS | **Caddy** (otomatik Let's Encrypt) veya **Coolify** (git push → deploy) | ~5 €/ay VPS |
| Yedekleme | Yönetilen Postgres (**Neon**/**Supabase**, PITR dahil) *veya* `pg_dump` + **restic** → Backblaze B2 | ~1 $/ay |
| Modal + focus trap | **Radix UI** `@radix-ui/react-dialog` (headless) | 0 ₺ |
| Tasarım primitifleri | **shadcn/ui** (kopyala-sahiplen; Radix + CVA + Tailwind) | 0 ₺ |
| Tip senkronu | **openapi-typescript** — FastAPI `/openapi.json`'dan üretim + CI drift kontrolü | 0 ₺ |
| E2E test | **Playwright** (5 kritik akış smoke) + **msw** (bileşen testi) | 0 ₺ |
| Görsel pipeline | **sharp** tek seferlik toplu WebP + **vite-imagetools** | 0 ₺ |
| Harita tile | **Protomaps** self-host (Adana bbox zaten `setup-osrm-adana.ps1`'de) veya MapTiler | 0-düşük |
| a11y denetimi | **eslint-plugin-jsx-a11y** CI'da | 0 ₺ |
| Fatura | Lansmanda **GİB e-Arşiv Portal** (elle), 90 günde **Nilvera**/**Paraşüt** API | düşük |
| Çerez onayı | Çerezsiz analitik seçilirse **gerekmez** | 0 ₺ |

---

## 7. Uygulama Sırası

**Hafta 1 — Kanamayı durdur (güvenlik) — ✅ TAMAMLANDI** *(commit `757c009`, 28 Tem 2026)*
1. ✅ `ENVIRONMENT` ayarı + `Settings._guard_production` — production'da 13 kontrol, ihlalde
   uygulama açılmaz ve eksiklerin **tamamını tek hatada** listeler
2. ✅ `seed_tutors` → `SEED_DEMO_DATA` bayrağı arkasında
3. ✅ XFF spoofing kapatıldı — `TRUSTED_PROXY_IPS` (adres/CIDR/`*`); uvicorn `--proxy-headers`
   ile de, onsuz da doğru çalışır *(uygulama katmanında çözüldü; Dockerfile bayrağı gerekmiyor)*
4. ✅ `/exam-catalogs/usable` → kütüphane `ACTIVE` şartı + `answer_key_url` operatöre hiç dönmüyor
   (yerine `has_answer_key`). *Not: `/libraries/register` bilinçli bir özellikmiş — kaldırılmadı,
   CLAUDE.md gerçeğe uyduruldu.*
5. ✅ `core/urls.ensure_http_url` → `website`/`cover_url`/`logo_url` şema whitelist'inde
6. ✅ `/clients/*` onaysız eğitmene kapalı; `change_password`/`reset_password` → `revoke_all_for_user`
   *(davranış değişikliği: `POST /auth/me/password` artık `Token` döner)*
7. ✅ `/docs`,`/redoc`,OpenAPI prod'da kapalı; `npm audit fix` → prod açık 3 → 2

*Sonuç: +47 test (329 backend / 308 frontend geçiyor), tsc temiz, build başarılı.*

**Hafta 1'den devreden iki madde** *(bilinçli olarak ertelendi, kaybolmasın)*
- **`react-router` v6 → v7** — kalan tek prod açığı (orta şiddet, `<Link>` open redirect).
  Major yükseltme; routing davranışı değişebilir → **Hafta 4'te**, SEO/sayfalama işiyle
  (madde 24: `?sayfa=N` linkleri) **birlikte** yapılmalı; ikisi de router'a dokunuyor.
- **`docker-compose.yml` varsayılan sırları** (`change-this-*`, `minioadmin`, `postgres`) —
  guard artık üretimde bunları yakalıyor, yani akut risk kapandı. Fallback'lerin kaldırılması
  prod compose dosyasının yazılmasıyla aynı iş → **Hafta 3, madde 14**.

**Hafta 2 — Sipariş para yolunu escrow'a bağla — ✅ TAMAMLANDI**
*(commit'ler `9f62464`, `91b53de`; 28 Tem 2026)*
8. ✅ `ORDER_SPEC` + `escrow.claim` ile atomik PAID geçişi — `claim()` artık
   `status_attr` alıyor (Order'da para durumu `payment_status` kolonunda)
9. ✅ `complete_checkout`'a `token`/`paid_price` + `refund_unexpected_charge`;
   replay'ler token kontrolünden önce düşüyor
10. ✅ `Order` reconciler'da — hem kayıp callback taraması hem sarkan REFUNDING
11. ✅ `Order.REFUNDING` + iki fazlı iade (migration `700ea951dfff`) ·
    ⏭️ **kısmi/kalem bazlı iade Hafta 4'e taşındı** (madde 22 ile aynı modele
    dokunuyor — tek migration, tek UI değişikliği)
12. ✅ `coupon.redeem` limitleri kilit altında yeniden doğruluyor, bool dönüyor
13. ✅ Her madde için test — 29 yeni test; `order_service` %19 → %23,
    `coupon_service` %32 → %45, `escrow` %52 → %54

*Sonuç: backend 352 / frontend 314 test geçiyor. Dört ödeme yüzeyi de artık aynı
escrow disiplininde: atomik claim, token binding, paidPrice doğrulaması, iki
fazlı iade, reconciler kapsamı.*

**Hafta 3 — İşletme katmanı — ✅ TAMAMLANDI (kod tarafı)**
*(commit'ler `c8b5cdf`, `2f1054f`; 28 Tem 2026)*
14. ✅ `devops/Caddyfile` (otomatik Let's Encrypt, HSTS + güvenlik başlıkları) ·
    `docker-compose.prod.yml` (fallback YOK — eksik env'de compose hata verir; hiçbir
    servis portu host'a yayılmaz) · backend imajı non-root + healthcheck ·
    nginx gzip + `index.html` no-cache · `.env.prod.example`
15. ✅ `scripts/backup-postgres.sh` (pg_dump + MinIO mirror + restic/B2, bozuk dump
    doğrulaması) · `scripts/restore-drill.sh` (geçici DB'ye geri yükleme provası)
16. ✅ Sentry frontend'e bağlandı (opt-in; URL'lerdeki token/OTP parametreleri
    maskeleniyor — hata paneli oturum anahtarı deposuna dönmesin). Backend zaten hazırdı.
17. ✅ CI: **postgres:16 servisi** (62 entegrasyon testi artık koşuyor) + boş DB'ye
    `alembic upgrade head` + `alembic check` + `ruff` + `pip-audit`/`npm audit`
    ⚠️ **`alembic check` gerçek bir bug ortaya çıkardı:** `migrations/env.py` `models`
    paketini import etmiyordu → `Base.metadata` şemanın yarısını görmüyor, autogenerate
    eksik/yanlış migration üretebiliyordu. Düzeltildi.
    ✅ `ruff.toml`: 1421 uyarı → 0 (dar kural seti; ignore'lar gerekçeli)

**Hafta 3'ten devreden**
- ✅ **Bağımlılık kilitleme** (`pip-compile`) + dev/prod Python sürümü eşitlendi —
  *commit `0caddcb`*. `requirements.in` (17 doğrudan bağımlılık) → `requirements.txt`
  (61 paket, transitive dahil tam kilitli). Yön **ileriye** hizalandı (fastapi 0.137.2,
  pydantic 2.13.4, SQLAlchemy 2.0.47): testler zaten bu sürümlerle geçiyordu, pin'ler
  hiç doğrulanmamıştı. Docker 3.11 → 3.12, CI 3.11 → 3.12. Temiz sanal ortamda yalnız
  `requirements.txt`'ten kurulumla 436 test doğrulandı.
  *Yan bulgu:* `requirements.txt`'te Türkçe yorum Windows'ta `pip install`'ı kırıyor
  (cp1254) — iki dosya da ASCII'ye çevrildi.
  ⏭️ CI'daki `pip-audit` `continue-on-error` **hâlâ açık** — sertleştirilmeli.
- **Uygulama adımları** (kod değil, operasyon): sunucu kurulumu, DNS, `.env.prod`
  doldurma, Sentry DSN alma, UptimeRobot'a `/health` ekleme, `backup-postgres.sh`
  cron'u, ilk `restore-drill.sh` provası.

**Hafta 4 — Yasal + SEO + canlı hata**
18. ✅ Kategori filtresi düzeltildi (recursive CTE + sayaç toplama) — *commit `c29bf48`*
19. ✅ `Product.tax_rate` + `OrderItem` KDV snapshot'ı · fiyat geçmişi — *commit `c9beb26`*
20. ✅ `user_consents` tablosu + `currentConsentVersion()` — *commit `c9beb26`*
21. ✅ Hesap silme/anonimleştirme + veri indirme — *commit `c9beb26`*
22. ✅ **`OrderReturn` bloğu — TAMAMLANDI** *(commit `e008cba`)* (Hafta 2 madde 11'den devreden kısmi iade
    burada birleşti; ikisi de aynı modele ve aynı admin ekranına dokunuyor):
    (a) cayma hakkını ret'siz akışa ayır (`OrderReturn.type`: `CAYMA` otomatik onaylı
    — 14 gün koşulsuzdur, satıcının ret yetkisi yok — vs. `AYIPLI/DIGER` onay akışı);
    (b) kalem bazlı kısmi iade (`OrderReturn.items` + `refund_amount`,
    `_refund_payment`'a tutar parametresi, admin onayında kalem seçimi).
    *Not: `escrow.refund_escrow` idempotency'si "sağlayıcı ikinci tam iadeyi reddeder"
    varsayımına yaslanıyor — kısmi iade bunu kırar, `refund_attempts` kaydı şart
    (kolon Hafta 2'de eklendi).*
23. ✅ `/iletisim` + `/sss` — *commit `43981f3`*. Canlı sohbet widget'ı **bilinçli olarak
    eklenmedi**: üçüncü taraf script çerez kullanır ve çerezsiz analitik tercihini bozup
    çerez onay bandını zorunlu hale getirir (bkz. madde 20). Ayrı bir karar olarak ele alınmalı.
24. ✅ Dinamik `/sitemap.xml` (96 URL) + `robots.txt`'e `Sitemap:` + `?sayfa=N` +
    `react-router` v7.18.1 — *commit `5f71d29`*.
    ⚠️ **react-router açığı kapanmadı, bilinçli:** `npm audit fix --force` 7.11.0'a düşürüyor ve
    o sürümde bizi gerçekten etkileyen 10 açık var (`<Link>` open redirect, XSS). 7.18.1'de
    raporlanan tek açık **RSC Mode**'a özgü; bu proje RSC kullanmıyor. Geri inmek güvenliği
    azaltırdı — gerekçe `ci.yml`'a yazıldı.
25. ✅ Sosyal paylaşım önizlemesi — *commit `d91ff5b`*. **Tam SSR/prerender kurulmadı**
    (mimari değişiklik + sürekli bakım); sorun "bot'a doğru meta'yı vermek" olduğundan Caddy
    yalnız sosyal önizleme botlarını `/__meta`'ya yönlendiriyor, gerçek kullanıcılar SPA'yı alıyor.
    *Googlebot bilinçli olarak listede yok — JS render ediyor, ona farklı içerik sunmak cloaking'dir.*
26. ✅ İkonlar WebP (4,21 MB→19 KB) · Tabler CDN→tree-shakeable npm · test rotaları `DEV` arkasında — *commit `c29bf48`*
27. ✅ **Hakediş — (b) şıkkı seçildi: "ödenecekler" defteri** *(commit `9c24e0f`)*.
    Otomatik para çıkışı **bilinçli olarak yazılmadı**: iyzico alt üye işyeri kapalı
    (`create_submerchant` → `success=False`) ve banka sanal POS'larında bu özellik zaten
    yok — para tek hesaba gelir. Yerine defter: `payout_records` tablosu (migration
    `1327cbb29263`, **IBAN snapshot'lı**), `services/payout_ledger.py`, `GET /payouts/pending`
    · `GET /payouts` · `POST /payouts` (audit'li), Admin > Hakedişler ekranı.
    **Borç = hak edilmiş − ödenen**; hak ediş kaynağa göre: ders `RELEASED`, dijital ürün
    `PAID`, kütüphane `released_at`. **Emanetteki para borç sayılmaz** (ders yapılmadı,
    iade edilebilir) — arayüzde ayrı sütunda bilgi olarak durur. Kısmi ödeme meşru,
    borçtan fazlası reddedilir. 8 doğrulama testi (gerçek DB).
    *Kalan operasyon: havaleler elle yapılır; ödeme günü listesi admin panelden alınır.*
28. ETBİS başvurusu + e-Arşiv (paralel süreç — şirket tesciline bağlı)

**Hafta 4'ten sonra eklenen — doğrulama katmanı** *(commit'ler `a11d3cd`, `7eaaeaa`, `7918ca8`)*
- **Gerçek servis katmanıyla, izole DB'de doğrulama paketi (44 test).** Mock'suz: sipariş
  para yolu (A1-A6), KVKK/rıza, sitemap, üretim guard'ı (F/G/H) senaryoları uçtan uca koşuyor.
- ⚠️ **Bu paket gerçek bir üretim bug'ı yakaladı:** iade/iptal yollarında 6 noktada
  async lazy-load 500'ü (`MissingGreenlet`) — birim testler mock'la geçtiği için görünmüyordu.
  *Ders: para yollarında mock'lu test yeterli değil.*

**Hafta 5 — Ölçek provası + dayanıklılık (29 Tem 2026)**

Raporun "en büyük risk" dediği **ölçek körlüğü** kapatıldı: sistem ilk kez gerçekçi hacimde
çalıştırıldı ve ölçüldü.

**Araçlar** (`backend/scripts/scale/`, izole `adana_scale` veritabanı — geliştirme verisine
dokunmaz, `tests/verify` ile aynı guard deseni):
- `seed_scale.py` — deterministik, gerçekçi veri üretici. 1× hacim 15 sn'de, 10× hacim
  166 sn'de kurulur (`--scale` ile ölçeklenir).
- `probe.py` — uygulamayı ASGI üzerinden çağırır (lifespan yok → arka plan döngüleri ölçümü
  kirletmez) ve her istekte çalışan **her sorguyu sayar + süresini toplar**. Sorgu sayısı
  ayrı raporlanır çünkü yavaşlığın iki sebebi vardır ve tedavileri farklıdır: tek sorgu
  yavaşsa indeks eksiktir, sorgu sayısı listeyle birlikte artıyorsa N+1 vardır.
  `--explain` yavaş bulunan senaryonun gerçek `EXPLAIN ANALYZE` planını basar.

**Ölçüm — 10× hacim** (2.000 eğitmen · 30.000 öğrenci · 20.000 ürün · **50.000 sipariş** ·
60.000 ders · 50.000 ödeme · 200.000 mesaj · 200.000 bildirim). 36 uç ölçüldü:

| Senaryo | Önce | Sonra | Neden |
|---|---|---|---|
| Admin ders listesi | 333 ms | **74 ms** | 60.000 satır tam taranıp sıralanıyordu → `ix_bookings_created_desc` |
| Mağaza metin araması | 245 ms | **45 ms** | `title` trigram indeksi yoktu; OR'un ikinci kolu her ürünü tarıyordu |
| Admin sipariş listesi | 149 ms | **~40 ms** | `ix_orders_created_desc` |
| Admin istatistik | 80 ms · **11 sorgu** | 57 ms · **3 sorgu** | 9 ayrı `COUNT` → tek sorgu (`get_dashboard` deseni) |
| Hakediş defteri | 170 ms | **129 ms** | defter yalnız RELEASED/HELD tarıyor (PENDING/REFUNDED gereksizdi) |

*Sonuç: 10× hacimde 150 ms eşiğini aşan uç kalmadı. **N+1 bulunamadı** — `selectin`
disiplini tutmuş.*

29. ✅ **Ölçek provası + indeksler** — 17 indeks (migration `fe604508a162`): 12 eksik FK
    (ders detayının yorum/kaynak/not tabloları, kupon iadesi, ürün/kütüphane yorumu…) +
    5 sıralama/arama indeksi. `*.role_id` ve `*_by_admin_id` **bilinçli olarak
    eklenmedi** (roles 5 satır ve hiç silinmez; admin silme yok denecek kadar nadir →
    yazma maliyeti getirir, okuma faydası yoktur).
30. ✅ **P1 dayanıklılık**:
    (a) arka plan döngüsündeki tek `try` bloğu **ayrıldı** — hatırlatma servisi patlasa da
    escrow mutabakatı ve teslimat watchdog'u koşar (eskiden ilgisiz bir bildirim hatası
    emanetteki paranın çözülmesini erteliyordu);
    (b) **lider seçimi**: periyodik işler `pg_try_advisory_lock` ile tek replikada koşar —
    iki worker artık iki kat bildirim göndermez;
    (c) `pool_recycle` / `pool_timeout` / sunucu tarafı `statement_timeout`;
    (d) S3/MinIO'ya **timeout + deneme sınırı** (varsayılan ~60 sn × 5 deneme, erişilemez
    MinIO'da tek isteğin DB session'ını dakikalarca tutmasına yol açıyordu);
    (e) Pillow görsel işleme **iş parçacığına** taşındı (event loop'u bloklamıyordu artık).
    5 yeni test (hata izolasyonu, kilit alınamazsa atlama, kilidin daima bırakılması).
31. ⚠️ **Ölçek provası bir P0 bug ortaya çıkardı** — *madde 27'nin (hakediş defteri) kendisi
    erişilemezdi.* `payouts` router'ı `payments.view`/`payments.manage` izinlerini istiyor ama
    bu izinler **izin kataloğuna hiç eklenmemişti**; yetki role bağlı izin satırından
    okunduğu için **SUPER_ADMIN dahil herkes 403 alıyordu** ve menü öğesi de gizlendiğinden
    hata görünmüyordu. Düzeltildi (migration `266eeeac2a47`) ve **tekrarı iki testle
    kapatıldı**: izin kataloğu artık tek kaynakta (`core/admin_permissions.py`), statik test
    router'ların istediği her iznin katalogda olduğunu, doğrulama testi de katalogdakilerin
    DB'de ve SUPER_ADMIN'de olduğunu denetliyor.

**Ölçek provasından çıkan, kapatılmayanlar** *(kabul edilen borç — hepsi ölçülmüş)*
- **Liderlik tablosu 132 ms**: "tamamlanan derse göre sırala" agregasyonu 36.000 satırı
  gruplar; COMPLETED oranı %60 olduğundan indeks işe yaramaz. Doğru çözüm önbellek
  (5 dk TTL, Redis zaten var) — gerçek zamanlı olması gerekmeyen tek yüzey.
- **Hakediş defteri 129 ms / 286 KB**: 2.000 borçlu tek yanıtta, sayfalama yok ve toplam
  her açılışta baştan hesaplanıyor. Doğrusal büyür; kalıcı bakiye tablosu gerekecek.
- **Mağaza listeleme ~70 ms**: varsayılan sıralama Bayesian skoru, çalışma anında hesaplanan
  global ortalamayı içerdiği için indekslenemez. 20.000 üründe kabul edilebilir; 200.000'de
  kalıcı `rating_score` kolonu gerekir.

**Hafta 6 — Gelir kaçağı + içerik güvenliği (29 Tem 2026)**
*(commit'ler `ddd757a`, `6a8a49b`)*
32. ✅ **Anti-disintermediation maskesi 4 → 9 yüzey** · maske mantığı yanlış pozitiflere karşı
    yeniden yazıldı (bkz. P1/Ürün). Eğitmen biyografisine numara yazarak komisyon atlatma yolu
    kapandı.
33. ✅ **IBAN at-rest şifrelendi** + değişikliğinde güvenlik e-postası, bildirim ve audit.
34. ✅ **Yorum moderasyonu** — gizleme (silme değil), puan ortalamasından düşme, geri alma,
    şikayet çözümüne bağlı aksiyon, admin panel seçeneği.
35. ⚠️ **Yolda bulunan ikinci sessiz hata:** `/iletisim` formu **hiç e-posta göndermiyordu.**
    `contact_message_email` ve `contact_ack_email` `EmailMessage(body=...)` çağırıyordu ama
    dataclass `text`/`html` bekliyor → `TypeError`. Gönderim bilinçli olarak best-effort olduğu
    için (`_safe_send` istisnayı yutar, akışı bozmaz) hata görünmüyordu: kullanıcı "mesajın
    alındı" ekranını görüyor, mesaj kimseye ulaşmıyordu. Düzeltildi + tüm şablonları üreten
    regresyon testi eklendi.

**Hafta 7 — Erişilebilirlik + hata görünürlüğü (29 Tem 2026)**
*(commit `0dead97`)*
36. ✅ **Sessiz sorgu hataları bitti** — global `QueryCache`/`MutationCache` yakalayıcı.
    ~39 bileşen backend 500'de hiçbir şey söylemeden boş kalıyordu.
37. ✅ **ErrorBoundary router'ın içine** alındı (ikinci sınır; rota değişince sıfırlanır).
38. ✅ **Odak tuzağı** — `useModalA11y` + `components/ui/Modal`; 12 modal taşındı, kendi kabuğunu
    çizenlere `useModalPanel`. Admin `Dialog` da aynı hook'u kullanıyor (kod tekrarı kalktı).
39. ✅ **Etiket bağlama** — `components/ui/Field` + 60'tan fazla alan; düğme gruplarında
    `role="group"`. **eslint-plugin-jsx-a11y CI adımı**: 69 ihlal → 0 hata.
40. ✅ **Leaflet lazy** (giriş paketi 613 → 504 KB) + ana sayfa arama kutusunda focus göstergesi.

**Hafta 7'den kalanlar** *(ölçülmüş, bilinçli)*
- **31 a11y uyarısı**: 24'ü `autoFocus` (modal açılışında alana odaklanma — kullanışlı ama ekran
  okuyucu kullanıcısını bağlamdan koparabilir), 7'si tıklanabilir `<div>`. Hata değil, uyarı.
- **`tile.openstreetmap.org` 6 dosyada** — OSMF politikası ticari kullanımı yasaklar. Engellendiği
  an kütüphane haritası, checkout adres pin'i ve canlı kurye takibi aynı anda çöker. Sağlayıcı
  kararı gerektirir (Protomaps self-host / MapTiler), kod işi değil.
- **Giriş paketi hâlâ 504 KB**: vendor bölme (`manualChunks`) P2'de.

**Hafta 8 — Türkçe arama + keşfedilebilirlik (29 Tem 2026)** *(commit `ef9a9c5`)*
41. ✅ **Diakritik-duyarsız arama** (`tr_normalize`, migration `dd737c387ff5`) — eğitmen, kütüphane
    ve mağaza aramasının üçünde de; iki taraf (indeks + sorgu) aynı fonksiyondan geçer.
42. ✅ **Önek eşleşmeli tsquery** — çekim ekleri artık aramayı kırmıyor.
43. ✅ **Eksik trigram indeksleri** (eğitmen ad-soyad, kütüphane adı) + mevcutlar normalize ifadeye.
44. ✅ **Kitap künyesi filtreleri** — yayınevi / yazar / kapak, sayaçlı seçenek listesiyle.
45. ⚠️ **Ölçüm bir regresyonu yakaladı:** yazar/yayınevi'ni `ILIKE` ile aramak 20.000 üründe
    mağaza aramasını **45 ms → 516 ms** yaptı (o kolonlarda indeks yok). İki alan tsvector'e
    dahil edildi, `ILIKE` kaldırıldı → 47 ms. *Ölçüm aracı olmasa bu canlıda fark edilirdi.*

**Hafta 9 — Yönetim para metrikleri (29 Tem 2026)** *(commit `5db0208`)*
46. ✅ **GMV / platform geliri / emanet / sepet ortalaması** — dört para yüzeyi tek raporda,
    dönem + önceki dönem karşılaştırmalı, dikey kırılımıyla.
47. ⚠️ **Ölçüm üç kademeli optimizasyon gerektirdi** (10× hacimde): 457 ms → dönem indeksleri
    304 ms → iki dönem tek sorguda (`FILTER`) 228 ms → **WHERE'e alt sınır 97 ms**. Son adımın
    dersi: `FILTER` yalnız *topladığını* seçer, **taramayı daraltmaz** — alt sınır olmadan
    sorgular tüm geçmişi okuyup sonra filtreliyordu.

**Hafta 10 — Dosya erişim kontrolü (29 Tem 2026)** *(commit `a3561b9`)*

Raporun kalan son P0'ı (P0-16) kapatıldı. Bulgu şuydu: tek bucket'a "her şey herkese açık"
politikası uygulanıyor ve kodda hiç imzalı adres üretimi yok. Sömürü zinciri en net dijital
üründe görünüyordu — `order_service.py:758` ödeme sonrası **ham adresi** döndürüyordu; o
bağlantıyı paylaşan herkes ücretli ürünü indirebiliyordu (doğrudan gelir kaçağı). Aynı bucket'ta
diploma, öğrenci karnesi, sınav cevap anahtarı, kurye vesikalığı ve **müşterinin kapı fotoğrafı**
duruyordu.

48. ✅ **İki erişim sınıfı** — anonim okuma bucket policy'sinde yalnız `avatars/` ve
    `library-photos/` öneklerine verilir; **listelenmeyen her önek kapalıdır**. `upload_file`
    çıktısının tamamı ve iki fotoğraf yüzeyi `private/` altına taşındı.
    *Karar notu:* koruma `private/*` üzerine **Deny** yazarak değil, **Allow'u daraltarak**
    kuruldu. `Principal: *` ile yazılan bir Deny, imzalı (kimlikli) isteği de kapsayıp her
    presigned adresi sessizce kırabilir; whitelist aynı sonucu sürpriz etkileşim olmadan verir.
49. ✅ **İmzalama tek noktada** (`core/private_urls.py`, ASGI katmanı). Veritabanında kalıcı
    adres durur, istemciye giderken imzalanır. Uç uç imzalama **bilinçli olarak seçilmedi**:
    adresler iç içe yapılarda taşınıyor (sipariş kalemleri, yoklama listesi, durak listesi) ve
    bir yüzey unutulduğunda hata sessiz oluyor. Katman yalnız JSON gövdesine dokunur, akış
    yanıtlarını tamponlamaz ve `content-length`'i yeniden yazar.
    *Bu bir yetki katmanı değildir* — adresin yanıta konup konmayacağı kararı uçta kalır
    (cevap anahtarı operatöre hiç dönmez, kanıt fotoğrafı public takip token'ına dönmez).
50. ⚠️ **Yolda bulunan performans tuzağı:** imza her yanıtta yeniden üretilseydi aynı fotoğrafın
    adresi her istekte değişecekti. Canlı takip sayfası 15 sn'de bir yenilendiğinden tarayıcı
    kurye vesikalığını ve kanıt fotoğrafını **her turda baştan indirir**, görsel gözle görülür
    biçimde titrerdi. İmzalar anahtar başına önbelleğe alındı (ömrünün yarısında yenilenir).
51. ⚠️ **Yolda bulunan ikinci üretim boşluğu — dosyalar canlıda hiç açılmayacaktı.**
    `docker-compose.prod.yml` hiçbir servis portunu host'a yayınlamıyor ve `devops/Caddyfile`'da
    MinIO'ya giden bir yol **yoktu**: üretimde yüklenen hiçbir görsel/belge tarayıcıdan
    erişilemezdi. Caddy'ye `depo.<alan-adı>` bloğu eklendi. *Alt alan adı seçimi zorunluydu:*
    imza hem host'u hem yolu kapsadığından `/depo/*` gibi bir yol önekini strip ederek
    proxy'lemek **her imzalı adresi reddettirirdi**. Üretim guard'ı da `S3_PUBLIC_ENDPOINT_URL`
    eksikse/`https://` değilse açılışı durduruyor — aksi halde hata sessizdi (API 200 döner,
    yalnız dosyalar açılmaz).
52. ✅ **Mevcut veri taşındı** — `scripts/migrate_storage_visibility.py` (idempotent, dry-run
    varsayılan; kopyala → adresi güncelle → sil sırasıyla, arada kesilirse kayıp olmaz).
    Geliştirme verisinde 6 nesne taşındı. Avatarlar da bucket **kökünden** `avatars/` önekine
    alındı: yeni politikada kök hiçbir Allow kapsamında değil, oldukları yerde kalsalardı
    profil fotoğrafları 403 olurdu.
53. ✅ **Gerçek depoya karşı doğrulandı** (`tests/verify/test_verify_storage_access.py`, 6 test).
    Ölçüm: private nesne anonim **403**, aynı nesne imzalı adresle **200**, public önek **açık**,
    kök **listelenemez**. *Birim testi policy JSON'unun metnini doğrular, uygulanıp
    uygulanmadığını değil — bu ayrım P0-16'nın ilk etapta gözden kaçma sebebiydi.*

**Hafta 11 — CSP + lansman görünürlüğü (29 Tem 2026)** *(commit `d9f8004`)*

54. ✅ **İçerik Güvenlik Politikası** (`frontend/nginx-security-headers.conf`). `script-src 'self'`:
    satır içi script ve dış CDN yok. P0-10'un XSS ayağı Hafta 1'de kapatılmıştı (URL şeması
    whitelist'i); CSP ikinci savunma hattı — bir enjeksiyon yolu bulunsa bile tarayıcı kodu
    çalıştırmaz.
    ⚠️ **Yolda bulunan nginx tuzağı — CSP tam da uygulanacağı yerde düşüyordu.** nginx'te
    `add_header` kalıtımı "hepsi ya da hiçbiri"dir: bir alt `location` kendi başlığını
    tanımladığı anda üst bağlamdaki başlıkların TAMAMI o location için kaybolur.
    `location = /index.html` yalnızca `Cache-Control` eklemek için bir `add_header` içerdiğinden,
    server seviyesine yazılmış bir CSP **HTML belgesinde** — yani tek anlamlı yerde — hiç
    dönmeyecekti. Başlıklar tek dosyaya alınıp her bloğa `include` edildi.
    *Ölçüldü (gerçek nginx konteyneri):* CSP dört yolda da dönüyor (`/`, `/index.html`,
    `/assets/*`, rastgele SPA yolu). *Aynı sebeple `Referrer-Policy` ve `Permissions-Policy`
    de `/index.html` ve `/assets/` yollarında eksikmiş — o da kapandı.*
    *İkinci karar:* CSP **yalnız nginx'te** tanımlı, Caddy'ye eklenmedi (dosyaya uyarı yazıldı).
    Tarayıcı birden çok CSP başlığı gördüğünde hepsinin **kesişimini** uygular; iki liste
    zamanla ayrıştığında yüzeyler açıklaması zor biçimde kırılır.
    *Kabul edilen genişlikler:* `style-src 'unsafe-inline'` (Tailwind ve Leaflet çalışma anında
    style özniteliği yazar; stil enjeksiyonu script çalıştıramaz), `img-src`/`connect-src https:`
    (bu adresler deploy'a göre değişir — MinIO alan adı, tile sunucusu, Sentry, Open-Meteo).
    `frame-src` ise **sabit liste**: Jitsi, YouTube, Vimeo, OpenStreetMap, Street View.
55. ✅ **Çerezsiz ziyaretçi analitiği** (`lib/analytics.ts` + `AnalyticsTracker`).
    `VITE_ANALYTICS_SCRIPT_URL` yoksa **tam no-op** — `monitoring.ts` ve backend'deki
    `core/mail`/`core/payments` ile aynı sağlayıcı-bağımsız desen.
    *Üç karar:* (a) **çerezsiz** sağlayıcı (Umami) — çerezli analitik açık rıza gerektirir ve
    siteye çerez onay bandı eklemek zorunda kalırdık (§6'daki tercihle tutarlı);
    (b) **first-party proxy** (`Caddy /istatistik/*`) — üçüncü taraf host'a izin vermek
    `script-src 'self'`'i delerdi, ayrıca reklam engelleyiciler bilinen analitik alan adlarını
    engeller, kendi yolumuz engellenmez; (c) **otomatik takip kapalı**, sayfa görüntülemesini
    SPA rota değişiminde biz bildiriyoruz.
    ⚠️ **Adres sorgu dizesi olmadan gönderilir:** takip, e-posta doğrulama ve şifre sıfırlama
    token'ları URL'de taşınıyor; bunların analitik sunucusunda birikmesi tek başına bir güvenlik
    olayı olurdu. Bu davranış teste bağlandı (7 test).
    `docker compose --profile analytics up -d umami` ile yerelde de çalışır.

**Hafta 12 — Refresh token çereze taşındı (29 Tem 2026)** *(commit `HAFTA12`)*

P0-10'un son parçası. Refresh token 30 gün geçerlidir ve tek başına yeni access token üretir —
yani hesabın kendisi kadar değerlidir. `localStorage`'da durduğu sürece tek bir XSS onu dışarı
sızdırabilir; `httpOnly` çerez JavaScript'e görünmez, aynı XSS o oturumda istek yapabilir ama
**token'ı çıkaramaz**.

56. ✅ **Token gövdeden tamamen kalktı** — `Token` şemasında `refresh_token` alanı yok
    (regresyon testi var) ve `/auth/refresh` **gövdeden token kabul etmiyor**. İkincisi kritik:
    gövde yolu açık bırakılsaydı, çereze geçmenin sağladığı koruma çalınmış bir token elle
    gönderilerek atlatılabilirdi. Beş yüzey birden geçirildi: login, refresh, logout,
    şifre değişimi ve kütüphane self-servis kaydı.
57. ✅ **CSRF için ayrı token gerekmedi** — `SameSite=Lax` + POST: Lax çerezler site-dışı POST'ta
    gönderilmez. `Strict` bilinçli olarak seçilmedi (e-postadaki linkten gelen kullanıcı oturumu
    düşmüş görürdü). Çerez dar `path`'li (`/api/v1/auth`) ve üretimde `Secure`.
58. ⚠️ **"Beni hatırla" sunucuya taşınmak zorunda kaldı** (`refresh_tokens.persistent`,
    migration `91fde114b0c4`). Sebep ilk tasarımda gözden kaçtı: rotasyonda yeni çerezin ömrünü
    seçmek gerekiyor, ama **gelen çerezin kalıcı mı oturumluk mu olduğu HTTP'de görünmez**.
    İsteğe bakarak seçmek imkânsız; tercih token zincirinde devredilmeli. Aksi halde
    "beni hatırla"yı işaretlemeyen kullanıcının oturumu ilk yenilemede kalıcı hale gelirdi.
59. ⚠️ **Doğrulama testi gerçek bir kusur yakaladı:** bir uç `HTTPException` fırlattığında,
    imzasındaki `Response` nesnesine yazılmış başlıklar yanıta **gitmez** — hata yanıtını
    exception handler sıfırdan üretir. Yani "geçersiz çerezi temizle" niyeti tam da
    temizlenmesi gereken durumda (401) sessizce kayboluyordu. Silme başlığı artık exception
    üzerinden gidiyor (`clear_refresh_cookie_headers`).
60. ✅ **Uçtan uca doğrulandı** (`tests/verify/test_verify_session_cookie.py`, 10 test) — bu
    paketteki ilk **HTTP seviyesi** testler: doğrulanan şey HTTP'nin kendisinde yaşıyor (çerezin
    yazılması, tarayıcının geri göndermesi, rotasyon, silinme). Kapsanan: gövdede token dönmüyor,
    çerez `httpOnly`, rotasyon çalışıyor, **eski token ikinci kez kabul edilmiyor**, gövdeden
    token reddediliyor, logout kopyayı da geçersiz kılıyor, pasif hesap yenileyemiyor,
    "beni hatırla" tercihi rotasyonda korunuyor.

**Sürekli**
- Yeni yazılan her para/auth kodu testsiz merge edilmesin.

**Sürekli**
- Yeni yazılan her para/auth kodu testsiz merge edilmesin. Kapsama hedefi %22 → %60;
  `--cov-fail-under=60` CI'da. *(29 Tem sonu: 480 birim + 92 doğrulama + 360 frontend testi.)*
- ✅ Gerçekçi hacimde seed **yapıldı ve araca dönüştürüldü** — şema değişince ölçüm
  tekrarlanabilir: `python scripts/scale/run.py --create && ... seed && ... probe`.

---

## 8. Kapanış

Bu proje "yeniden yazılmalı" kategorisinde **değil**. Mimari kararlar sağlam, desenler doğru,
disiplin yüksek. Yapılacak iş üç başlıkta toplanıyor:

1. **Mağaza/sipariş yüzeyini, diğer üç para yüzeyinin zaten kullandığı escrow altyapısına bağlamak.**
   Yeni mimari değil, mevcut mimarinin eksik kablolaması.
2. **İşletme katmanını kurmak** — TLS, deploy, yedek, izleme, ortam guard'ı. Kod değil, altyapı.
3. **Yasal yüzeyi kapatmak** — KDV, fatura, rıza kaydı, hesap silme, cayma hakkı, ETBİS.

En büyük tek risk teknik değil, **bilgi riski**: sistem hiç gerçek veri hacminde çalışmadı, canlıda
hiçbir hata izleme yok ve para çıkışı hiç kodlanmadı. Lansmandan önce en azından bu üçünün
görünür hale gelmesi gerekiyor.

**29 Temmuz 2026 — bilgi riski üzerine güncelleme.** Üçü de kapandı: para çıkışı **defter olarak**
kodlandı (madde 27), hata izleme **bağlandı** (Hafta 3; kalan iş DSN girmek), sistem ilk kez
**10× hacimde ölçüldü** (Hafta 5) — ve o ölçüm iki şey gösterdi. İyi haber: mimari sağlam, N+1 yok,
tek eksik indekslerdi. Kötü haber: **dün yazılan hakediş ekranı hiçbir admin tarafından
açılamıyordu** ve bunu ne testler ne de gözle bakmak yakalamıştı — çünkü yetkisiz menü öğesi
gizleniyor, uç ise sessizce 403 dönüyordu.

Buradaki asıl ders, ölçek değil **görünürlük**: bu kod tabanında hatalar gürültüyle değil,
sessizce oluyor. Kalan riskin merkezi de orada — canlıda ne olduğunu gösterecek şey artık
yazılacak kod değil, açılması gereken hesaplar (Sentry DSN, UptimeRobot, yedek cron'u) ve
lansman öncesi bir kez daha koşturulacak `probe`.
