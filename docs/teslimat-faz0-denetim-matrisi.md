# Teslimat Faz 0 — Denetim ve Boşluk Matrisi

**Tarih:** 17 Temmuz 2026 · **Yöntem:** `docs/delivery-experience-design.md` (PDS v2) + `docs/delivery-screens-wireframes.md` hedefleri, backend/frontend kod envanteriyle satır satır karşılaştırıldı. Her durum ifadesi dosya referanslıdır; "belgede var" hiçbir şey "kodda var" sayılmadı.
**Durum sözlüğü:** ✅ TAM (kod+koruma var) · 🟡 KISMİ (çekirdek var, eksik parça belirtilir) · ❌ YOK · ⛔ KAPSAM DIŞI (bilinçli erteleme: V2/V3 ya da dış bağımlılık).

---

## 1. Yönetici özeti

**Sağlam zemin** (önceki "teslimat sertleştirme P0+P1" işinin doğrulanmış mirası):
- Sipariş başına tek açık durak (`uq_delivery_stop_open`, `models/delivery.py:145-150`) ve gün+araç başına tek planlı tur (`uq_delivery_run_planned`, `:82-88`) **DB otoritesinde**.
- Tüm saha sonuçlandırma yolları (`verify/fail/override/drop`) Order→Stop sıralı `FOR UPDATE` kilidinden geçer (`delivery_service.py:1086-1107`); postpone/verify yarışının tek kazananı PG testiyle kanıtlı.
- Transactional outbox: yaklaşma SMS'i damga+olay aynı transaction'da (`:1170-1197`); watchdog stale turları kapatır; iptal/iade açık durakları `CANCELLED` koduyla kapatır (kurye metriğini kirletmez).
- Timeline whitelist projeksiyonu: `reason`/`changed_by` müşteriye sızmaz (`delivery_timeline.py:31`, testli).
- Kapasiteli söz çekirdeği: dolu güne söz verilmez (`first_day_with_capacity`, PG testi "dolu gün söz ileri").

**Faz 0'da kapatılacak doğrulanmış güvenlik bulguları:**

| # | Bulgu | Kanıt | PDS ihlali |
|---|---|---|---|
| G-1 | **PoD fotoğrafı public token'a sızıyor** — `order_tracking` DELIVERED'da `proof_photo_url`'ü her iki yolda döner; kapı önü fotoğrafı PII'dır | `delivery_service.py:1022-1026` (docstring: "her iki yolda aynıdır") | §3.11, M13, G7 |
| G-2 | **Public token'la teslim şekli yükseltilebiliyor** — `POST /orders/track/{token}/delivery-pref` KAPIYA_BIRAK/KOMSUYA_BIRAK dahil kabul eder; SMS linkini ele geçiren paketi kapıya yönlendirebilir | `store.py:592`, `order_service.py:713-730` (oturum/token ayrımı yok) | §3.2, G7, F2 |
| G-3 | **OTP SMS'inde sosyal mühendislik cümlesi yok** — "kuryemiz seni arayıp kod istemez" şablonda bulunmuyor | `core/sms/sender.py:42-49` | H5 |
| G-4 | **OTP yeniden gönderimi sayaç sıfırlıyor, süre kısıtı yok** — her `send-otp` çağrısı `otp_attempts=0` yapar; deneme limiti resend ile sonsuz tazelenebilir | `delivery_service.py:1110-1127` | H1 |

**En büyük yapısal boşluklar** (fazların varlık gerekçesi, bu belgeyle teyitli):
1. **Kapasite tek global sayı** (`DELIVERY_DAILY_CAPACITY=30`); araç/kurye/vardiya/retry-borcu kavramı ve **ödeme anında atomik rezervasyon yok** → eşzamanlı ödemede overbooking mümkün (Faz 1, P0).
2. **Retry önceliği yok**: FAILED sipariş "yarının kapasitesinde öncelikli" değil, kuyruğa eşit döner; **FAILED sayacı da yok** → sonsuz PAID↔FAILED döngüsü teorik olarak mümkün (Faz 1 + Faz 5).
3. **Hazırlama istasyonu yok**: PAID sipariş pick/pack/etiket doğrulaması olmadan tura eklenebilir (Faz 2).
4. **Offline outbox yok**: saha ekranında hata=toast; kanıt/sonuç işlemleri bağlantısızken kaybolur (Faz 3).
5. **İstisna kuyruğu yok** (Faz 5); **Netgsm gövde yanıtı doğrulanmıyor** (`netgsm.py:18 TODO`, Faz 4); **event/KPI kataloğu yok** (Faz 6).

---

## 2. State machine ve transaction sınırları (bugünkü gerçek)

| Akış | Geçişler | Kilit/atomiklik | Not |
|---|---|---|---|
| Sipariş FSM | PENDING→PAID→SHIPPED→DELIVERED; PAID↔(FAILED durak)→PAID; →CANCELLED/REFUNDED | `order_fsm.transition_order` + history satırı; iptal/iade `_close_open_stops` FOR UPDATE | FAILED sayacı yok (F1) |
| Söz | Ödeme anında `promised_delivery_date` snapshot (cutoff 16:00 + Pazar + kapasite) | **Rezervasyon kilidi YOK** — sayım `_first_capacity_day` okuma anında | Faz 1 hedefi |
| Tur FSM | PLANNED→ACTIVE→DONE; →CANCELLED; watchdog ACTIVE→DONE (stale) | `start_run` kilitsiz (guard'lı), `cancel_run`+watchdog kilitli | reorder↔start arası kolon-ayrışması var, satır kilidi yok |
| Durak FSM | PENDING→DELIVERED/FAILED/RESCHEDULED/CANCELLED | Saha yolları `_lock_field_stop` (FOR UPDATE) | `send_otp` kilitsiz (G-4 ile birlikte ele alınacak) |
| Bildirim | Outbox (`outbox_events`): takip linki/yaklaşıyor/başarısız/ertelendi; OTP bilinçli senkron | Damga+olay tek tx (`:1184-1197`) | Sessiz saat/tavan kavramı yok (Faz 4) |

## 3. Yarış denetimi

| Senaryo | Durum | Kanıt |
|---|---|---|
| Aynı sipariş iki tura | ✅ | `uq_delivery_stop_open` + IntegrityError→409 (`delivery_service.py:687-689`) |
| Aynı tura iki kez | ✅ | `uq_delivery_stop_run_order` (`delivery.py:141`) |
| Durak iki cihazdan sonuçlandırma | ✅ | `_lock_field_stop` + taze `PENDING` guard (`:1078-1107`) |
| Postpone ↔ verify | ✅ | Order kilidi + PG testi `test_postpone_verify_race_single_winner` |
| Yaklaşma SMS çift gönderim | ✅ | `approach_notified_at` damga + outbox tek tx (`:1170-1197`) |
| İptal/iade ↔ aktif tur | ✅ | `_close_open_stops` FOR UPDATE (`order_fsm.py:41-58`) |
| **Ödeme ↔ son kapasite slotu** | ❌ | Rezervasyonsuz okuma; overbooking mümkün → **Faz 1** |
| **Reorder ↔ start** | 🟡 | Satır kilidi yok; bugün kolon ayrışması koruyor (sequence vs status) → Faz 2'de kilitle |
| OTP tekrar kullanımı | 🟡 | Status guard tekrar teslimi engeller; resend throttle yok (**G-4**, Faz 0) |

---

## 4. Edge case matrisi (PDS §12 — 57 senaryo)

### A. Adres & Konum

| # | Durum | Kanıt / boşluk | Faz |
|---|---|---|---|
| A1 | ❌ | Pin-metin mesafe uyarısı yok; checkout'ta pin editörü de yok (M2 kısmi) | 2 |
| A2 | ❌ | "Adres sorunu" neden kodu + pin-doğrulama linki yok (fail serbest metin) | 2-3 |
| A3 | ❌ | Bölge kontrolü ikili (`in_delivery_zone`); sınır tolerans bandı yok | 2 |
| A4 | ✅ | 409 `OUT_OF_ZONE` + açık force (`store.py /ship-address`, `ShipAddressUpdate.tsx:46`) | — |
| A5 | 🟡 | `ClientAddress.directions` var (`client.py:119`); buluşma noktası/kalıcı operasyon notu yok | 2 |
| A6 | ❌ | Aynı binaya ardışık sıralama/"bu binada 2 teslimat" yok | 7 |
| A7 | ✅ | MapPicker elle pin; geolocation izinsiz tam çalışır | — |
| A8 | ✅ | Pin serbest (POI'ye bağlı değil); ters-geocode boşsa elle adres | — |
| A9 | 🟡 | Bölge-dışı akışı var; "varsayılan adresi güncelle" önerisi yok | 2 |

### B. Müşteriye Ulaşılamıyor

| # | Durum | Kanıt / boşluk | Faz |
|---|---|---|---|
| B1 | 🟡 | FAILED→PAID→ertesi tur var; "kuryen kapında" push, 2 dk sayaç, zorunlu kapı-önü foto yok | 3 |
| B2 | ❌ | Kurye "sona at" yok (saha listesi salt-okunur, `DeliveryDriver.tsx:493-528`) | 3 |
| B3 | 🟡 | `override_deliver` notlu teslim var (`:1285`); "güvenliğe teslim" kanıt tipi (görevli adı) yok | 3 |
| B4 | ❌ | Komşu-yok tercih zinciri kuralı yok | 3 |
| B5 | 🟡 | SMS `sent=false` dalı + override var (`DeliveryDriver.tsx:165-173`); istisna kuyruğu kaydı yok | 5 |
| B6 | ❌ | Yüksek-değer eşiği kavramı yok | 2 |
| B7 | 🟡 | Aynı gün dönüş yok (doğru); **ertesi gün kapasite önceliği yok** | 1 |
| B8 | 🟡 | Limit 2 + 409 "bizimle iletişime geç" (`order_service.py:739-743`); şubeden-al/askı akışı yok | 5 |

### C. Paket

| # | Durum | Kanıt / boşluk | Faz |
|---|---|---|---|
| C1 | 🟡 | `scan` yanlış paketi söyler; ama QR teslimi **kapılamıyor** (opsiyonel, `DeliveryDriver.tsx:413-423`) | 3 |
| C2 | ❌ | Araçta hasar akışı yok | 5 |
| C3 | ⛔ | Çoklu paket modeli yok (sipariş=paket varsayımı) — V2 | 7 |
| C4 | 🟡 | `QrScanner` fallback'te manuel giriş input'u render edilmiyor (`QrScanner.tsx:62-75`) | 3 |
| C5 | ❌ | "Bir sorun var" 24 saat akışı yok — V2 | 7 |
| C6 | ✅ | Hibrit sepette dijital anında, fiziksel akışı bloklamaz | — |

### D. Kurye & Araç

| # | Durum | Kanıt / boşluk | Faz |
|---|---|---|---|
| D1 | ❌ | "Turu devret" yok (elle cancel+yeni tur mümkün ama tasarımsız) | 3 |
| D2 | 🟡 | `age_seconds` + canlı marker var; >10 dk bayat alarmı yok | 5 |
| D3 | ❌ | Kaza acil protokolü yok | 5 |
| D4 | ❌ | Hareketsizlik anomalisi yok | 6 |
| D5 | ✅ | Durak tek aktif turda — DB index otoritesi (`delivery.py:145-150`) | — |
| D6 | 🟡 | Watchdog stale turu kapatır (FAILED+PAID+alarm); "bizden kaynaklı" kodu + telafi kuyruğu yok | 5 |
| D7 | 🟡 | State DB'de, yenilemede devam; offline yerel kuyruk yok | 3 |
| D8 | ❌ | "Güvenli değil" neden kodu/metrik ayrımı yok | 3 |

### E. Zaman, Söz & Kapasite

| # | Durum | Kanıt / boşluk | Faz |
|---|---|---|---|
| E1 | 🟡 | Sunucu saati otorite (testli); "son 15 dk" rozet uyarısı yok | 1 |
| E2 | 🟡 | Dolu güne söz verilmez (PG testli); **atomik rezervasyon yok** + operasyona erken-doldu sinyali yok | **1 (P0)** |
| E3 | ❌ | ETA-pencere taşma bildirimi yok | 4 |
| E4 | ❌ | Erken varış muhasebesi yok | 5-6 |
| E5 | 🟡 | Pazar (`[6]`) var; resmî tatil takvimi yok → KULLANICIYA SOR (Faz 1) | 1 |
| E6 | ⛔ | Saat-dilimi slot — V3 | 7 |
| E7 | ⛔ | Gün içi artımlı yerleştirme — V2/V3 | 7 |
| E8 | 🟡 | `stops_ahead` var; artış mesajı ("sıra güncellendi") yok | 4 |

### F. Ödeme & İade

| # | Durum | Kanıt / boşluk | Faz |
|---|---|---|---|
| F1 | ❌ | **FAILED sayacı yok** — 3-deneme kuralı ve askı/iade otomasyonu yok; sonsuz döngü mümkün | 5 |
| F2 | ⛔ | İade pickup — V3 | 7 |
| F3 | 🟡 | Manuel refund var; kontrol/nedenli red/itiraz akışı yok — V2 | 7 |
| F4 | 🟡 | Kanıt sipariş sahibine kalıcı görünür; ama şu an public'te de görünüyor (**G-1**); 24 saat vaka akışı yok | 0+5 |
| F5 | ❌ | İade bildirimi banka süresi metni yok — V2 | 7 |

### G. Teknik & Offline

| # | Durum | Kanıt / boşluk | Faz |
|---|---|---|---|
| G1 | ❌ | Takip sayfasında offline/stale şeridi yok | 4 |
| G2 | ✅ | `courier_position` fail-open; teslim akışı konumdan bağımsız (`courier_position.py:36-69`) | — |
| G3 | 🟡 | Haversine fallback var (`routing/__init__.py:36-53`); "yaklaşık" rozeti + pencere genişletme yok | 2+4 |
| G4 | 🟡 | OTP ulaşmazsa override yolu var; sağlık şeridi uyarısı yok | 4 |
| G5 | ❌ | Offline-first kuyruk yok; işlem-anı damgası yalnız çevrimiçi | 3 |
| G6 | ✅ | Son-yazan-kazanır + kurye 15 sn poll ile canlı talimat | — |
| G7 | 🟡 | Maske+whitelist+uuid token+IP limit TAM; **G-1** (foto sızıyor) ve **G-2** (tercih yükseltme) ihlal | **0** |

### H. Güvenlik & Suistimal

| # | Durum | Kanıt / boşluk | Faz |
|---|---|---|---|
| H1 | 🟡 | Max 5 deneme var; durak kilidi/operasyon onaylı yeni kod yok; **resend sayaç sıfırlıyor (G-4)** | 0+3 |
| H2 | 🟡 | KOMSUYA not zorunlu (422, PG testli) + drop foto zorunlu; adrese bırakma-kapatma kuralı yok | 5 |
| H3 | ❌ | Hasar örüntü sayacı yok | 6 |
| H4 | ✅ | `deliver_drop` foto zorunlu — sunucu tarafı | — |
| H5 | ❌ | OTP SMS güvenlik cümlesi yok (`sender.py:42-49`) → **G-3, Faz 0** | 0 |
| H6 | ❌ | Çekim kılavuzu/üçüncü kişi politikası yok | 3 |

**Sayım:** ✅ 10 · 🟡 22 · ❌ 19 · ⛔ 6 — cevapsız (izlenmeyen) senaryo yok.

---

## 5. Wireframe eşlemesi (28 ekran, özet)

| Grup | Uygulanmış | Kısmi | Yok |
|---|---|---|---|
| Müşteri (M1-M13) | M1, M5, M13 | M2, M6, M7, M8*, M9, M10, M11, M12* | M3, M4 |
| Kurye (K1-K7) | K2, K4 (çekirdek) | K3, K5, K7 | K1, K6* |
| Operasyon (O1-O8) | O2, O4 (çekirdek) | O7 | **O1, O3, O5, O8**, O6* |

\* V2/V3 etiketli. Ayrıntılı satırlar frontend envanter raporunda; kritik boşluklar: **O1 hazırlama istasyonu, O3 istisna kuyruğu, O8 raporlar/ayarlar tümüyle yok**; checkout'ta pin/tercih adımı yok (M2/M3); saha ekranı offline'sız ve dokunma hedefleri 40-48px (spec ≥56px); auth kullanıcı takibi public sayfaya devrediliyor (`useOrderTracking` yazılmış ama kullanılmamış).

---

## 6. Faz 0 güvenlik ağı — düzeltmeler (✅ 17 Tem 2026 uygulandı)

Dördü de uygulandı ve test kilidi altında: saf testler `tests/test_delivery_security.py`,
PG regresyonları `tests/integration/test_delivery_token_security_pg.py` (31/31 entegrasyon yeşil).
Ek olarak sahibin kanıt hakkı korunması için oturumlu sipariş detayına "Teslim Kanıtı"
bloğu eklendi (`OrderDetailPage.tsx` — `useOrderTracking` ilk kez gerçek kullanıcı buldu).

| # | Düzeltme | Dosya | Test |
|---|---|---|---|
| 1 | `proof_photo_url` (ve `proof` ayrıntısı) yalnız **oturumlu** yolda dönsün; public token yolunda `null` | `delivery_service.order_tracking` | PG: token yolu foto döndürmez, oturumlu yol döndürür |
| 2 | Public token yolunda tercih **yükseltme yasağı**: KAPIYA_BIRAK/KOMSUYA_BIRAK 403; ADRESIMDEYIM/BENI_ARA serbest; erteleme serbest kalır (PDS token yetkisi: izleme+erteleme+beni-ara) | `store.py` public pref ucu + `order_service.set_delivery_pref` (kaynak parametresi) | PG: token ile drop 403, oturumla 200 |
| 3 | OTP SMS'ine sabit güvenlik cümlesi: "Bu kodu yalnız kapındaki kuryeye söyle — kuryemiz seni arayıp kod istemez." | `core/sms/sender.py` | Saf: şablon içerik testi |
| 4 | `send_otp` resend throttle (≥60 sn) + `_lock_field_stop` kullanımı | `delivery_service.send_otp` | PG/saf: art arda çağrı 429/409 |

Sonraki fazların "KULLANICIYA SOR" kararları görev belgesindedir (`docs/teslimat-profesyonellestirme-gorev.md`); Faz 0 düzeltmeleri karar gerektirmez.

---

## 7. Faz 1 + Faz 2 ilerleme (✅ 17 Tem 2026)

**Faz 1 — kapasiteli söz (P0 çekirdek tamam):**
- Atomik rezervasyon: söz sayımı+ataması `pg_advisory_xact_lock` altında → eşzamanlı ödemede overbooking yok (PG testi: iki eşzamanlı rezervasyon aynı slotu alamaz).
- Söz borcu önceliği: kurye/sistem FAILED → söz ertesi güne kapasite-kontrolsüz yazılır, `orders.failed_delivery_count` artar (migration `b7c8d9e0f1a2`); dispatch kuyruğu aynı gün retry'ları öne dizer.
- Admin 14 günlük kapasite şeridi (`GET /delivery/capacity`); E1 "son 15 dk" rozet uyarısı (saf `isCutoffClosing`, Vitest'li).
- **Kalan (kullanıcı kararı bekler):** araç×durak×vardiya×mola kapasite modeli (başlangıç değerleri); resmî tatil takvimi kaynağı.

**Faz 2 — hazırlama istasyonu (O1, tamam):**
- `orders.prepared_at`/`prepared_by` (migration `c8d9e0f1a2b3`); yalnız hazırlanmış sipariş `eligible_orders`'a girer + `add_stops` 409 ile korur.
- FAILED/watchdog hazırlığı sıfırlar (paket depoya döner, yeniden toplanır); müşteri ertelemesi (RESCHEDULED) hazırlığı korur (paket paketli kalır).
- Uçlar: `GET /delivery/prep-queue`, `POST /delivery/orders/{id}/prepare|unprepare`; admin panelde "Hazırlama İstasyonu" bölümü.
- PG testleri: `test_delivery_prep_pg.py` (kuyruk ayrımı, add_stops gating, fail sıfırlama) + capacity/token testleri. Backend 280, frontend 273 yeşil.
- **Faz 2'de kalan:** ~~dispatch board istisna şeridi~~ (✅ eklendi — `runExceptions`: söz riski/pinsiz/retry/rotayı-bozan, saf+Vitest, RunDetail'de renk=aksiyon şeridi). Checkout harita pin editörü (A1) daha çok Faz 7 kapsamında büyük bir iş.

**Faz 3 — saha güvenilirliği (kısmi):**
- **FAILED neden kodları (tamam):** `FailReason` enum (9 kod) + `DeliveryStop.fail_reason` (migration `d9e0f1a2b3c4`); `fail_stop` yapısal kod alır, kurye ekranında seçici (serbest metin opsiyonel). Müşteriye sızmaz (timeline whitelist). KPI hariç-tutma seti `FAIL_REASONS_NOT_COURIER_FAULT` (ERKEN_DENEME/GUVENLIK/MUSTERI_TALEBI — E4/D8) Faz 6 için hazır. Saf testler backend+frontend.
- ~~Kullanıcı kararı: saha ekranı ADMIN'de mi kalsın yoksa ayrı COURIER rolü mü~~ → ✅ **COURIER rolü (role_id=5) açıldı** — bkz. §9.
- **Faz 3'te kalan (büyük, ATLANDI — "geç"):** offline-first outbox (kurye bağlantısızken QR/foto/OTP/FAILED yerelde kuyruklanır, idempotency key + replay); ≥56px dokunma hedefleri; check-in/vardiya/gün-sonu uzlaştırma.

**Faz 4 — müşteri güveni + bildirim (kısmi):**
- **Netgsm gövde doğrulaması (tamam):** `netgsm_response_ok`/`parse_netgsm_code` — HTTP 200 içindeki hata kodu (`30`/`40`/`50`…) artık yakalanıyor, başarısız SMS "gönderildi" sayılmıyor (fail-open yalanı kapandı). Saf test.
- **"Teslimat sırası güncellendi" (E8, tamam):** `stopsAheadIncreased`/`windowWidened` (saf+Vitest); takip sayfası sayaç artışında sessiz büyümek yerine amber mikro-metin gösterir.
- **Sessiz saat 21:00–08:30 (tamam):** `in_quiet_hours`/`next_allowed_send` (saf, gece yarısını sarar, pytest'li); outbox gece bekleyen müşteri SMS'ini göndermek yerine ertesi sabah 08:30'a erteler (deneme sayılmaz, hata değil — yalnız zaman kaydırma), e-posta ertelenmez. Config `DELIVERY_QUIET_START/END_HOUR/MINUTE` (0=kapalı). Saf + PG entegrasyon testi.
- **Kalan:** bildirim outbox'ında template sürümü/amaç kaydı, ETA penceresi "yalnız daralır" tam entegrasyonu, SMS tavanı (≤3/sipariş). KVKK saklama süreleri kullanıcı kararı.

**Faz 5 — istisna kuyruğu + retry disiplini (F1 açığı KAPANDI):**
- Üç-deneme tavanı (`DELIVERY_MAX_DELIVERY_ATTEMPTS=3`): başarısız sipariş sonsuza dek yuvarlanamaz; tavana ulaşınca otomatik kuyruklardan düşüp **İstisna Kuyruğu**'na girer (`attention_orders`), söz günü ilerlemez, müşteri+admin dürüst bildirim alır. Operatör "Yeniden Dene" ile bir tur daha hak tanır (`retry_exhausted_order`).
- `roll_promise_after_failed_attempt` artık bool döner (requeued/exhausted); fail_stop+watchdog ikisi de tavana tabi. Saf + 3 PG testi.
- **Kullanıcı kararı (bekliyor):** 3. denemede kesin çözüm (teslim-alma noktası mı, otomatik iade mi) — mekanizma hazır, otomatik iade bilinçli tetiklenmedi.

**Faz 6 — KPI + baseline (operasyonel/deneyim tarafı tamam):**
- `GET /delivery/kpi`: söz tutma, ilk denemede teslim, başarısızlık oranı, FAILED neden Pareto'su, kurye-kusuru-olmayan sayısı. Hedef disiplini: ham sayı + oran (payda 0 → null), **kırmızı/yeşil yargı yok** (PDS §14 baseline). Gerçek dev veriyle doğrulandı.
- Saf hesap `services/delivery_metrics.py` (rate/is_on_time/DeliveryKpi, pytest'li); admin panelde "Teslimat Göstergeleri" paneli (sakin istatistik döşemesi + neden dağılımı çubuğu).
- **Kalan:** unit economics (maliyet/durak, SMS/sipariş) — maliyet girdisi (yakıt/amortisman/kurye saati) kullanıcı kararı; girdi gelince eklenir. Immutable event kataloğu şu an durum-geçiş geçmişi (`OrderStatusHistory`) üzerinden; ayrı event tablosu gerekmedi.

## 8. Operasyon kararları uygulandı (✅ 18 Tem 2026)

Kullanıcı kararları ([[project_delivery_decisions]] hafızada):
- **Haftanın 7 günü açık** — `DELIVERY_NON_WORKING_WEEKDAYS=[]` (Pazar kapalılığı kaldırıldı).
- **Admin-yönetimli teslimat takvimi** (yeni, "Trendyol/Amazon kalitesi" isteğine karşılık): `delivery_closed_days` tablosu (migration `e0f1a2b3c4d5`) + `services/delivery_calendar.py`. Söz motorunun 4 saf fonksiyonu artık `closed_dates` alıyor; `order_service` söz veren her yolda kapalı günleri yükleyip geçiriyor (bölge-dışı hariç — dış kargo). 2026 resmî tatilleri **admin tıklamasıyla** yüklenir (`seed-holidays`, idempotent), admin istemediğini siler/ekler — otomatik değil, insan kontrolünde. Uçlar `GET/POST/DELETE /delivery/calendar` + `POST /delivery/calendar/seed-holidays`; admin panelde "Teslimat Takvimi" bölümü. Saf test (tatil/Pazar/blok) + canlı doğrulandı (23 Nisan→24 Nisan).
- **3. deneme = elle karar** (Faz 5 mevcut), **PoD 12 ay**, **maliyet girdileri ertelendi**.

**Bu fazlardan SONRAYA bırakıldı (kullanıcı onayıyla):** unit economics maliyet tarafı, offline outbox. ~~KURYE ROLÜ~~ → ✅ yapıldı (§9). ~~Hızlı teslimat (express)~~ → **düşüldü** (18 Tem): standart söz zaten cutoff öncesi = aynı gün (`DELIVERY_CUTOFF_HOUR`, ayarlanabilir) — ayrı hızlı katmana gerek yok.

## 9a. Faz 7 (V2/V3) — teslimat geri bildirimi ✅ 18 Tem 2026

Öncelik 1 kalemi bitti: **teslim sonrası 👍/👎 + yapısal sorun bildirimi.**
- Model `DeliveryFeedback` (migration `783b63fa54b6`): order_id partial-unique (sipariş başına TEK; yarışta index otorite), thumbs_up, `problem_codes` JSONB (FeedbackProblem: GEC_TESLIMAT/HASARLI_PAKET/YANLIS_EKSIK_URUN/KURYE_DAVRANISI/TESLIM_YERI/BILDIRIM_SORUNU/DIGER), comment, source CLIENT|PUBLIC. NOT: autogenerate `uq_delivery_run_active_courier`'ı silmeye çalıştı — drop migration'dan çıkarıldı + index modele deklare edildi.
- Kurallar (servis `delivery_feedback_service`): yalnız DELIVERED (409), 👎'de ≥1 sorun kodu (422), 👍'de kodlar taşınmaz, tekrar 409.
- Uçlar: POST/GET `/store/orders/{id}/feedback` (CLIENT), POST `/store/orders/track/{token}/feedback` (public, IP rate-limit — durum değiştirmez, yetki yükseltme değil), GET `/delivery/feedback` (ADMIN son değerlendirmeler). `OrderTrackingOut.can_feedback/feedback_given`; KPI'ya `feedback_up/down/satisfaction_rate/feedback_problems` (payda 0 → None, hedef yok).
- Frontend (Codex'e devredildi, yerelde doğrulandı): `lib/deliveryFeedback.ts` (+Vitest), `DeliveryFeedbackSection` (👍/👎 + chip'ler + not; 409→idempotent teşekkür), CargoTrackingPage (token) + OrderDetailPage (oturum) entegre, AdminDelivery KPI'da memnuniyet + sorun dağılımı + son değerlendirmeler.
- Test: backend 15 yeni (saf 5 + PG 4 + metrics) — tamamı yeşil; frontend typecheck temiz + 288 Vitest yeşil.
- **Faz 7'de kalan:** birleşik durak/çoklu paket, ETA sapma alarmı (açıklanabilir eşik). Yasak/bekleyen: AI-predictive + slot (90 gün baseline şart), iade+para timeline'ı (gerçek iade süreci yok), pickup/değişim.

## 9. Kurye rolü (role_id=5) — ✅ 18 Tem 2026

Saha ekranı admin girişinden ayrıldı; kurye kendi hesabıyla girer, yalnız kendi turunu görür.

**Kimlik modeli:** `CourierAccount` (ayrı tablo — unified users yok deseni korunur), `courier_id` FK→`couriers` CASCADE, `auth_version` (server_default 1). Migration `8590183c3cc1`: `ALTER TYPE role_type ADD VALUE 'COURIER'`, `courier_accounts` + 3 partial unique (email/username/courier_id, `deleted_at IS NULL`), `uq_delivery_run_active_courier` (kurye başına tek ACTIVE tur — DB seviyesi).

**Oturum öldürme kanıtı:** login/refresh JWT'ye `auth_ver` claim'i yazar; `get_current_user` CourierAccount'ta `auth_ver != user.auth_version` → anında 401. `close_account` tek transaction'da: soft-delete + `is_active=False` + `auth_version+=1` + tüm refresh token'ları bulk revoke + audit. PG testi: kapatma sonrası rotate → None.

**Endpoint yetki matrisi (`delivery.py`):**
| Yüzey | Yetki | Sahiplik |
|---|---|---|
| Tur planla/başlat/durak ekle/sırala/optimize/dispatch-day/etiket/takvim/KPI/kurye CRUD | ADMIN (`router`) | — |
| `override-deliver` (OTP bypass) | **yalnız ADMIN** — kuryede privilege escalation olur | — |
| run detay/complete/track/position, stop photo/scan/send-otp/verify/deliver-drop/fail | ADMIN+COURIER (`field_router`, `_field_user`) | kurye → yabancı run/stop **404** (403 değil; varlık sızdırmaz), `ensure_run/stop_access` |
| `GET /delivery/me` (workspace: hesap+profil+güncel tur) | COURIER | kendi hesabı |
| hesap oluştur/kapat/şifre sıfırla (`/couriers/{id}/account`, `/accounts/{id}/close|reset-password`) | ADMIN | audit'li |

**Senkron tutulan rol haritaları:** `deps._ROLE_MODELS` + `auth_service._LOGIN_PRECEDENCE` + `auth.py._MODEL_BY_ROLE_ID` — üçüne de COURIER eklendi; bu vesileyle **rol-4 (LIBRARY_OPERATOR) refresh bug'ı** da kapandı (`_MODEL_BY_ROLE_ID`'de eksikti → operatör refresh'i 401 dönüyordu).

**Frontend:** `ROLE_IDS.COURIER=5`, `roleHome(5)→/`; RootDispatcher → `CourierHome` (menüsüz: ACTIVE→saha ekranına yönlendirir, PLANNED→bekleme, yoksa boş durum; 20 sn poll). `/dagitim/:id` `ProtectedRoute allowedRoleIds=[ADMIN, COURIER]` (yeni çoklu-rol prop'u). Saha ekranında rol ayrımı: admin "← Panel" + override butonu; kurye "Çıkış" + "kod ulaşmıyorsa yöneticini ara". `CourierManager`'da satır altı hesap paneli (oluştur/kapat/şifre sıfırla). Design-reviewer denetimi geçti (4 minör bulgu uygulandı: focus-within, autoComplete=new-password, rose-600 dark paritesi, FAIL_REASONS[0]).

**Test durumu:** backend 311 + `test_courier_role_pg.py` 4 (oturum öldürme, IDOR 404, tek-aktif-hesap 409, güncel tur seçimi) yeşil; frontend typecheck temiz + Vitest 285 yeşil.
