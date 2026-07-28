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
| Birim testleri | **282/282 geçiyor** (7,5 sn) | Yeşil |
| Entegrasyon testleri | **62 test — CI'da hiç koşmuyor** (SKIP) | Postgres servisi yok |
| **Test kapsaması** | **%19** | 🔴 |
| `tsc --noEmit` | **0 hata** (strict açık) | Güçlü |
| Frontend build | 613 KB JS (gzip 188 KB) + 144 KB CSS · `dist/` 18 MB | |
| `npm audit --omit=dev` | **9 açık** (1 kritik, 3 yüksek, 5 orta) | axios + react-router prod'da |
| Canlı DB | 14 eğitmen · 27 rezervasyon · 8 sipariş · 89 mesaj | Hiç ANALYZE görmemiş |
| İndekssiz FK | **24 adet** | `booking_comments.booking_id` dahil |

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

**P0-10 · Depolanmış XSS + localStorage'da refresh token.**
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

**P0-16 · Tek public-read bucket.**
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

**P0-27 · Hiçbir hata izleme ve analitik bağlı değil.** Backend Sentry opt-in ve DSN boş; frontend'de
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
- Leaflet (144 KB) entry chunk'ta — `Landing.tsx:18` → `HeroSearch` → `DistrictSelect` →
  `DistrictMapModal` zinciri yüzünden harita görmeyen herkes indiriyor. `vite.config.ts`'te
  `build:` bloğu hiç yok.
- `index.html:19` `@tabler/icons@latest` — 150 KB render-blocking, pinlenmemiş, SRI'siz CDN CSS;
  karşılığında **3 kullanım** ve üçü de ölü prototip dosyalarında.
- `nginx.conf`'ta **gzip yok** — 613 KB JS sıkıştırılmadan gidiyor (gzip'lense 188 KB).
- Test prototipleri prod'da açık ve indekslenebilir: `App.tsx:300-302` (`/test-bilet`,
  `/test-canli-ders`, `/test-kutuphane-karti`), `DEV` koruması yok.
- `tile.openstreetmap.org` 6 dosyada — OSMF politikası ticari kullanımı yasaklar. Engellendiği an
  kütüphane haritası, **checkout adres pin'i** ve **canlı kurye takibi** aynı anda çöker.
- Global sorgu hata yönetimi yok: `isLoading` 76 dosyada, `isError` 37'de → ~39 bileşen backend 500
  verdiğinde sessizce boş kalıyor. `queryClient.ts`'te `QueryCache.onError` yok.
- ErrorBoundary router'ın **dışında** → çökünce client-side toparlanma imkânsız, tam sayfa yenileme.

**Erişilebilirlik**
- `htmlFor` kullanımı tüm kod tabanında **0** (165 `<label>`, 248 `<input>` var). Ekran okuyucu
  hiçbir form alanının adını okuyamıyor.
- 18 tüketici modalının **0'ında** focus trap, 2'sinde portal. Doğru uygulama aynı repoda:
  `components/admin/ui/Dialog.tsx:22-57` — ama yalnız admin kullanıyor.
- `HeroSearch.tsx:64` — ana sayfanın birincil arama kutusunda focus göstergesi yok.

**Ürün**
- Türkçe arama kör: TSVECTOR `'simple'` ile üretiliyor, `unaccent` yok, `products.title` üzerinde
  trigram indeksi **yok** → "kitab", "matematık" sonuç getirmiyor.
- `publisher`/`author`/`cover_type` kolonları var ama filtre olarak açılmamış.
- Admin panelde para metriği yok — tümü `COUNT` tabanlı; GMV/AOV/iptal oranı görünmüyor.
- Yorum moderasyonu yok: `Review`'da `is_hidden` yok, admin ucu yok; rapor çözümüne içerik aksiyonu
  bağlı değil.
- Anti-disintermediation maskesi 4 yüzeyde var; QA mesajları, ürün yorumları, eğitmen yorumları,
  biyografi, talep açıklaması **maskesiz** — eğitmen biyografisine telefon yazarak komisyon atlanır.
- IBAN düz metin (`models/mixins.py:98`, TCKN şifreliyken), değişikliği audit'siz ve bildirimsiz
  (`payout_service.py:62`) → ele geçirilen hesapta para hedefi sessizce değiştirilir.

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

**Hafta 3 — İşletme katmanı** ← *sıradaki*
14. Caddy + TLS + güvenlik başlıkları + gzip · **prod compose: `:-change-this-*` / `minioadmin` /
    `postgres` fallback'lerini kaldır** (env eksikse compose hata versin) · non-root
    konteyner + healthcheck + `restart: unless-stopped`
15. Yedekleme + **geri yükleme provası** (provası yapılmamış yedek yedek değildir)
16. Sentry (backend + frontend) · Plausible · UptimeRobot
17. CI'ya Postgres servisi (62 entegrasyon testi koşsun) + boş DB'ye `alembic upgrade head` +
    `ruff` + `pip-audit`; bağımlılıkları `pip-compile` ile kilitle, Python sürümünü eşitle

**Hafta 4 — Yasal + SEO + canlı hata**
18. Kategori filtresi düzeltmesi (recursive CTE) — *2 saat, en ucuz kazanç*
19. `Product.tax_rate` + `OrderItem` KDV snapshot'ı · fiyat geçmişi tablosu
20. `user_consents` tablosu + `legalContent.ts`'e `version`
21. Hesap silme/anonimleştirme + veri indirme
22. **`OrderReturn` bloğu — tek seferde** (Hafta 2 madde 11'den devreden kısmi iade
    burada birleşti; ikisi de aynı modele ve aynı admin ekranına dokunuyor):
    (a) cayma hakkını ret'siz akışa ayır (`OrderReturn.type`: `CAYMA` otomatik onaylı
    — 14 gün koşulsuzdur, satıcının ret yetkisi yok — vs. `AYIPLI/DIGER` onay akışı);
    (b) kalem bazlı kısmi iade (`OrderReturn.items` + `refund_amount`,
    `_refund_payment`'a tutar parametresi, admin onayında kalem seçimi).
    *Not: `escrow.refund_escrow` idempotency'si "sağlayıcı ikinci tam iadeyi reddeder"
    varsayımına yaslanıyor — kısmi iade bunu kırar, `refund_attempts` kaydı şart
    (kolon Hafta 2'de eklendi).*
23. `/iletisim` + `/sss` + canlı sohbet widget'ı
24. Dinamik `GET /sitemap.xml` + `robots.txt`'e `Sitemap:` + liste sayfalarına `?sayfa=N` linkleri
    — **`react-router` v6→v7 yükseltmesiyle birlikte** (Hafta 1'den devreden madde; ikisi de
    router'a dokunuyor, tek seferde test edilmeli)
25. Public rotalar için prerender
26. 5 ikonu WebP'ye indir · Tabler CDN'i sil · test rotalarını `DEV` arkasına al
27. Hakediş kararı: marketplace'i kıs **veya** "ödenecekler" raporu
28. ETBİS başvurusu + e-Arşiv (paralel süreç — şirket tesciline bağlı)

**Sürekli**
- Yeni yazılan her para/auth kodu testsiz merge edilmesin. Kapsama hedefi %19 → %60;
  `--cov-fail-under=60` CI'da.
- Lansmandan önce **gerçekçi hacimde seed** (2000 ürün, 5000 sipariş, 200 eğitmen) üretip
  `pg_stat_statements` ile yavaş sorgu avı yap. Şu anki 8 siparişlik veride hiçbir N+1 görünmüyor.

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
