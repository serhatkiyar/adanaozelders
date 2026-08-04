# Adana Özel Ders — Ürün, Operasyon ve Mimari Denetim Raporu

**Tarih:** 31 Temmuz 2026
**Denetlenen commit:** `253f0db` (local `main`)
**Yöntem:** 10 paralel salt-okunur alt-ajan taraması + ana ajanın bağımsız kod doğrulaması
**Kapsam:** 86.562 satır backend Python, 78.153 satır frontend TS/TSX, 311 commit (30 May – 31 Tem 2026)
**Kod değişikliği yapılmadı.** Commit, merge, push yok. Çalışma izole worktree'de (`adana-project-audit`, detached HEAD).

---

## 0. Yönetici özeti

Bu kod tabanı **iyi bir mühendislik ürünü**. Escrow claim disiplini, append-only stok defteri, GiST çakışma kısıtı, kanonik kilit sırası, transactional outbox, üretim guard'ı, imzalı özel dosya katmanı ve gerçek PostgreSQL'de koşan yarış testleri — bunlar çoğu ticari projede bulunmayan olgunluktadır.

Sorun mimaride değil, **kapsama asimetrisinde**. Kalite standardı hangi paket üzerinde çalışıldıysa oraya uygulanmış; bir önceki paketin yüzeyi ise kimse bakmadığı için sessizce çürümüş. Bu denetimin en keskin bulgusu tam olarak budur:

> **Eğitmen onay/red arayüzü ölü.** `AdminHome` route'lara bölünürken onay kuyruğu erişilemez bir dala düşmüş; `POST /admin/tutors/{id}/approve` ucunun UI'da hiçbir çağıranı kalmamış. Yani platformun **arz tarafı panelden hiç işletilemiyor** ve bunu ne testler ne de ekspertiz raporu yakalamış.

Aynı sınıf, para tarafında dokuz kez tekrar ediyor: bir akış sertleştirilirken kardeş akış geride kalmış (booking iptalinde iade var, admin iptalinde yok; mağaza callback'i idempotent, exam/study `pay()`'i değil; kısmi iade kargoyu tutuyor ama "tam iade" tanımı yanlış).

**Rakamla:** 9 adet P0, 22 adet P1, ~40 adet P2/P3 bulgu. Bunların **hiçbiri** mimari yeniden yazım gerektirmiyor; hepsi mevcut desenlerin eksik uygulandığı noktalar.

**Lansman yargısı:** Mağaza kolu, P0-5 (kısmi iade) ve P1-7 (KDV) kapatılırsa açılabilir. **Pazaryeri kolu (ders + kütüphane) mevcut hâliyle açılmamalı** — dört P0'ı da orada, üstelik kütüphane kolunda kontenjan hiçbir katmanda zorlanmıyor (P1-20).

**Operasyonel uyarı (kod dışı, ama en acil madde):** `origin/main` 28 Temmuz'da kalmış; yerel `main` **114 commit ileride**. Stok defteri, F26, F29 envanter ve PK-1 ödeme kapılarının tamamı yalnızca bu diskte duruyor ve **CI'dan hiç geçmemiş**.

---

## 1. Sistemin mevcut modül haritası

### 1.1 Katmanlar

| Katman | Dizin | Hacim |
|---|---|---|
| Backend API | `backend/` | 86.5k satır · 35 router · 71 servis · 48 model · 150 test dosyası |
| Frontend SPA | `frontend/src/` | 78.2k satır · 113 rota · 96 sayfa · 135 bileşen · 46 hook · 63 test dosyası |
| Altyapı | `docker-compose*.yml`, `devops/`, `scripts/` | Postgres · Redis · MinIO · MailHog · VROOM+OSRM |

### 1.2 Ürün kolları

```
┌─ PAZARYERİ (arz: eğitmen) ──────────────────────────────────┐
│  tutor onboarding FSM → ilan/arama → rezervasyon (GiST)      │
│  → escrow (accept→PENDING, pay→HELD, complete→RELEASED)      │
│  → review · QA kotası · demand · mesajlaşma (maskeli)        │
└──────────────────────────────────────────────────────────────┘
┌─ PAZARYERİ (arz: kütüphane) ────────────────────────────────┐
│  katalog+harita → deneme bileti (escrow, QR yoklama)         │
│  → çalışma alanı rezervasyonu (escrow, birleşik QR)          │
│  → LIBRARY_OPERATOR paneli · self-servis onboarding          │
└──────────────────────────────────────────────────────────────┘
┌─ MAĞAZA (doğrudan satış) ───────────────────────────────────┐
│  katalog+CSV → SKU/stok defteri (append-only) → sepet/kupon  │
│  → sipariş FSM → hazırlama → kendi-filo teslimat             │
│  → iade/RMA · F29 sayım+hasarlı stok                         │
└──────────────────────────────────────────────────────────────┘
┌─ ÇALIŞMA DİSİPLİNİ (para dışı) ─────────────────────────────┐
│  Görevler · Flashcard (SM-2) · Alışkanlık · Deneme takibi    │
│  · Pomodoro · Liderlik tablosu                               │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 Yatay kesen altyapı

| Bileşen | Dosya | Not |
|---|---|---|
| Escrow çekirdeği | `services/escrow.py` | 5 spec, koşullu-UPDATE claim, iki fazlı iade |
| Ödeme sağlayıcısı | `core/payments/` | Fake / iyzico CF (3DS + sunucu doğrulamalı callback) |
| Ödeme kapıları | `services/payment_gates.py` | 3 ürün kolu × (işletme bayrağı ∧ sağlayıcı yeteneği), fail-closed |
| Stok defteri | `services/stock_ledger.py` | Tek yazıcı, append-only trigger, kova bazlı |
| Rota | `core/routing/` | VROOM+OSRM, devre kesici, haversine fallback |
| Outbox | `core/outbox.py` | `FOR UPDATE SKIP LOCKED`, backoff, DLQ |
| Yetki | `api/deps.py` + `core/admin_permissions.py` | 5 rol + görev izni kataloğu (DB) |
| Denetim | `services/audit_service.py` | Redaction'lı, request-id korelasyonlu |
| Özel dosya | `core/storage.py` + `core/private_urls.py` | Önek bazlı erişim sınıfı + ASGI imzalama |

---

## 2. Tamamlanmış ve güçlü alanlar

Bunlar denetim sırasında **gerçek kanıtla** doğrulanmış, olduğu gibi bırakılması gereken alanlardır.

1. **Escrow claim disiplini.** Her para geçişi koşullu UPDATE ile (`escrow.py:157-193`). Çift release imkânsız. `released_at` dolu satır iadeye claim edilemiyor (`:227-230`). Gerçek PG'de kanıtlı: `tests/integration/test_money_pg.py:37,67` (release↔refund yarışı, `refund_gate` ile deterministik pencere).

2. **Mağaza ödeme callback'i.** Idempotency, token uyuşmazlığı, `paidPrice` uyuşmazlığı, ölü sipariş, oversell — beşi de otomatik iadeyle sonuçlanıyor (`order_service.py:518-745`). `asyncio.gather`'lı çift callback testi gerçek PG'de (`tests/verify/test_verify_order_payment.py:70,126,153,187,259`).

3. **Stok hareket defteri (F29 dahil).** Append-only DB trigger'ı, kova bazlı zincir, kanonik kilit sırası, deterministik idempotency, kısmi uygulama yasağı, `STALE` satırda tam ret. Deadlock testi ters başlangıç + `lock_timeout` ile **askıda kalmak yerine kırılarak** yapılıyor (`tests/integration/test_stock_lock_order_pg.py`).

4. **Oturum mimarisi.** Opaque refresh + SHA-256 hash + tek kullanımlık rotasyon + httpOnly çerez + gövde yolunun kapatılması + şifre değişiminde toplu iptal. Gerçek HTTP + gerçek PG ile kanıtlı (`tests/verify/test_verify_session_cookie.py:57-156`) — denetimdeki en güçlü test dosyası.

5. **Admin izin katmanı.** 37/37 admin ucu izin duvarlı; yetki yükseltmeye karşı iki kapı (`assert_can_grant`, `assert_can_assign`), son SUPER_ADMIN koruması `FOR UPDATE` ile serileştirilmiş.

6. **Teslimat invariant'ları.** `uq_delivery_stop_open`, `uq_delivery_run_planned`, `uq_delivery_run_active_courier` — kural DB'de, servis kontrolü yalnız UX. Sabit kilit sırası (Order→Stop), watchdog, ETA drift'i, kurye hesap kapatma zinciri.

7. **Rota katmanının sessiz bozulma savunması.** Devre kesici + `/health` raporu + üretimde ERROR log + `ROUTING_PROVIDER=haversine` üretim reddi. Bu, "çalışmaya devam ama yanlış cevap veren" sınıfına karşı nadir görülen bir olgunluk.

8. **Üretim guard'ı.** Zayıf JWT anahtarı, console mail/SMS, fake ödeme sağlayıcısı, `minioadmin`, localhost CORS, boş `TRUSTED_PROXY_IPS`, `http://` URL — hepsi açılışta fail-fast, eksiklerin tamamı tek hatada.

9. **Test izolasyonu.** `db_guard` allowlist'i (+ `ceyhandb`'nin bilinçli çıkarılması), `_hijyen_nobetcisi` satır sayısı karşılaştırması, `purge_products` ile trigger'ı geçici kapatan fiziksel silme, `tests/verify`'ın skip yerine `pytest.fail` etmesi.

10. **Mutasyon sürücüsü.** `scripts/mutation_drill.py` kirli ağaçta reddediyor, `git checkout --` kullanmıyor (bayt yedeği), her mutasyondan sonra HEAD+worktree eşitliğini doğruluyor. CLAUDE.md §D'yi gerçekten karşılıyor.

11. **Frontend rota mimarisi.** `lib/routes.ts` gerçekten tek kaynak — `to="/..."` ham string taramasında **sıfır** sonuç. 91 `lazy()`, iki katmanlı error boundary, WS invalidate coalescing, FOUC çözümü.

12. **Şema hijyeni.** `extra="allow"` sıfır kullanım; ORM nesnesi dönen uç yok; `hashed_password`/`token_hash`/`auth_version`/`sub_merchant_key` şemalarda hiç geçmiyor; teslimat timeline'ı çift katmanlı whitelist (SQL kolonları bile seçilmiyor).

---

## 3. Yarım veya yüzeysel alanlar

| Alan | Durum | Kanıt |
|---|---|---|
| **Eğitmen onboarding operasyonu** | Backend tam, **UI ölü** | `AdminHome.tsx:791-793` ölü dal |
| **İhtilaf (dispute)** | Yalnız admin bayrağı; öğrencinin açma yolu yok | `models/report.py:30-32`'de `BOOKING` yok |
| **Destek talepleri** | Bilinçli olarak yok — tek yönlü form → e-posta | `support_service.py:8-11` |
| **KDV / fatura** | Model + saf hesap var, **yazıcı yok** | `ProductCreate`'te `tax_rate` yok; her ürün 0 |
| **Mal kabul (goods receipt)** | Hiç yok | Giriş yalnız `INITIAL` + `ADMIN_ADJUSTMENT('TEDARIK')` |
| **Paketleme/toplama (F30)** | Tek boolean | `mark_prepared`; raf/bin/konum kolonu yok, `prepared_by` sabit `"admin"` |
| **Görev ayrılığı (SoD)** | İzler var, **zorlama yok** | `INVENTORY_REQUIRE_SEPARATE_APPROVER` yalnız docstring'de yaşıyor |
| **Hata çözme ekranları** | Yok | `REFUNDING` ve `OutboxEvent` hiçbir uçta geçmiyor |
| **Ders gerçekleşme kanıtı** | Yok | `complete()` zaman kontrolü içermiyor |
| **Eğitmen ödemesi (payout)** | Defter + elle havale; otomatik yok | PK-2 iyzico alt üyesine bağlı |
| **Kurye ekonomisi** | Yok | Ücret/prim/vardiya tablosu yok |
| **Offline saha** | Yok | `DeliveryDriver.tsx`'te `navigator.onLine`/kuyruk/SW yok |
| **Frontend test piramidi** | Neredeyse tamamen tabanda | 63 dosyanın 57'si UI'ye hiç dokunmuyor |

---

## 4. Bulgu listesi

Güven seviyeleri: **[KESİN]** = ana ajan kodu okuyup doğruladı · **[TEST]** = mevcut testten doğrulanmış · **[ÇIKARIM]** = kod yolu kesin, çalıştırılmadı · **[İNCELE]** = doğrulanması gerekiyor.

### 4.1 P0 — para, stok, yetki, kişisel veri, kalıcı veri kaybı

**P0-1 · Reschedule→reject zinciri emanetteki parayı kalıcı kilitliyor** [KESİN]
`booking_service.py:492` reschedule FSM'i atlayıp `status = PENDING` yazıyor. Süre değişmemişse `payment_service.sync_amount_with_booking:95-96` erken dönüyor, yani **HELD ödeme korunuyor**. Ardından eğitmen `reject` (`:432`) — iade çağrısı yok, REJECTED terminal (`_TRANSITIONS:59`), sonradan cancel edilemiyor. `escrow_reconciler` yalnız `REFUNDING` ve `PENDING/FAILED` tarıyor (`:73-82,168-178`), **HELD'i hiç görmüyor**.
→ Öğrencinin parası ne eğitmene ne öğrenciye gider, hiçbir alarm çalmaz, admin görmez.

**P0-2 · Admin booking iptali iade etmiyor ve FSM'i atlıyor** [KESİN]
`admin_service.cancel_booking:397-404`: doğrudan `booking.status = CANCELLED`. `payment_service.refund` yok, geçiş kontrolü yok, bildirim yok. **Parası RELEASED olmuş COMPLETED bir ders bile CANCELLED yapılabiliyor.** Kullanıcı iptali doğru yapıyor (`booking_service.py:609-642`: claim + refund + bildirim) — asimetri.
→ Adminin ihtilaf çözmek için elindeki tek araç, parayı emanette bırakıyor.

**P0-3 · Ders gerçekleşme kanıtı yok; eğitmen ders başlamadan emaneti boşaltabiliyor** [KESİN]
`booking_service.complete:446` yalnız FSM claim'i yapıyor; `start_at` kontrolü yok. `bookings.py:140-148` yalnız sahiplik doğruluyor. Öğrencinin şikâyet edebileceği hedef türü yok (`models/report.py:30-32`'de `BOOKING` yok). UI'da onay diyaloğu bile yok.
→ Eğitmen kabul → öğrenci öder (HELD) → eğitmen "Tamamla" → RELEASED. Karşı taraf hiçbir şey yapamaz.

**P0-4 · İhtilaflı ders otomatik olarak serbest bırakılıyor** [KESİN]
`auto_complete_past_bookings:571-580` sorgusunda `is_disputed` filtresi yok. Admin ihtilaf bayrağını açmış olsa bile `AUTO_COMPLETE_GRACE_HOURS` sonrası ders COMPLETED olur ve para akar.

**P0-5 · Kısmi iade "tam iade" sayılıyor: kargo geri veriliyor + kupon serbest bırakılıyor** [KESİN]
`returns.is_full_return:108` yalnız **seçilen** satırlara bakıyor ("her satırın tüm adedi seçilmiş mi"), siparişin tüm kalemlerinin seçilip seçilmediğine bakmıyor. `_build_return:1655` `lines`'ı yalnız seçimden kuruyor. `order_service.py:1704` → `is_partial = not is_full`.
→ 3 kalemlik siparişten 1 kalemi tam iade eden müşteri kargo bedelini geri alıyor (`returns.py:102`) ve kuponu serbest bırakıyor (`:1871`); diğer 2 kitap elinde kalıyor.

**P0-6 · Onaysız kütüphane hesabıyla platformdaki herkese sınırsız DM** [KESİN]
Zincir dört halkalı: (a) `POST /libraries/register` public ve **anında geçerli LIBRARY_OPERATOR token'ı** döndürüyor (`libraries.py:145-172`), kütüphane `PENDING`; (b) `messaging_service._can_message:129-137` → `if "LIBRARY" in {a[0], b[0]}: return True` — ilişki kontrolü yok; (c) `messages.py:129-131` operatörü telefon doğrulamasından muaf tutuyor, yorumu *"operatör admin-oluşturmalı, muaf"* diyor — bu varsayım self-servis onboarding eklendiğinde geçersizleşmiş; (d) `_validate_target` yalnız hedefin var olduğunu doğruluyor.
→ Saldırgan `counterparty_id`'yi 1'den tarayarak her öğrenciye ve eğitmene DM açar. Hedef kitlenin bir kısmı reşit değil (kodun kendi yorumu bunu kabul ediyor: `clients.py:26`). Hem anti-disintermediation rezervasyon kapısı hem telefon kapısı aşılıyor.

**P0-7 · Sınav cevap anahtarı kütüphane operatörüne sızıyor** [KESİN — ajan doğruladı]
`library_exam_service._session_out:105-107` cevap anahtarını **yalnız `results_published_at`** koşuluna bağlıyor, rol kontrolü yok. Bu çıktı `GET /exam-sessions/manage` ile operatöre liste hâlinde dönüyor (`library_exams.py:108-116`) ve sonuç yayınlama yetkisi de operatörde (`:258-266`). `core/private_urls.py:39-51` middleware'i gövdedeki her `private/` adresini rol bakmadan imzaladığı için dönen bağlantı **çalışıyor**. Katalog tarafı doğru yapıyor (`library_exam_catalogs.py:69`, `include_answer_key=isinstance(user, Admin)`) — sapma oturum tarafında.
→ Operatör kendi oturumunu yayınlayıp ülke geneli katalog anahtarını indirebiliyor. `private_urls.py:16`'daki *"cevap anahtarı operatöre hiç dönmez"* yorumu artık doğru değil.
İkincil: `list_public_sessions:294-314` aynı yardımcıyı kullanıyor ve **kimlik doğrulamasız**.

**P0-8 · TB-3 GEÇERLİ: reconciler devraldığında stok geri yüklenmiyor, kupon serbest kalmıyor** [KESİN — iki ajan bağımsız doğruladı]
`escrow_reconciler.reconcile_refunding:100,132` doğrudan `escrow.perform_refund`/`finalize_refund` çağırıyor; `_refund_payment`'a hiç uğramıyor. `services/escrow.py:250-301`'de `_restock`, `stock_ledger`, `coupon_service` referansı **yok**. Aynı boşluk `OrderReturn` hedefi için de var (`_restock_items` hiç koşmaz).
→ Sağlayıcı ilk denemede reddettiğinde para döner, **stok hiç geri yüklenmez**, kupon tüketilmiş kalır. `verify_ledger` bunu sapma olarak bile göremez (defter ile `products.stock` uyumlu kalır, yalnız fiziksel raf fazla verir).
Ağırlaştırıcı: `order_service.py:1364-1366` yorumu boşluğu **aktif olarak gizliyor** ("reconciler bu fonksiyonu tekrar çağırdığında…" — çağırmıyor).

**P0-9 · Eğitmen hesabını silemiyor (500) ve TCKN/diploma hiç silinmiyor** [KESİN]
`account_deletion_service.py:91` `payout_status`'a `None` atıyor; alan `mixins.py:133-135`'te `nullable=False` ve `Tutor` `PayoutMixin` alıyor (`models/tutor.py:49-57`) → commit'te NOT NULL ihlali → 500.
Ayrıca aynı satırdaki `tckn_encrypted` **kod tabanında yalnız orada geçiyor** → `hasattr` hep False → ölü temizlik. Gerçek alan `TutorEducation.verification_tckn` ve `anonymize_account` o tabloya hiç dokunmuyor; `identity_last4` ve diploma dosyası (`private/`) da kalıyor.
→ KVKK m.7 silme hakkı eğitmen için fiilen kullanılamıyor; kullanılabilseydi bile PII kalırdı.
Neden yakalanmadı: `anonymize_account`'ın dört testi de **CLIENT** ile (`tests/verify/test_verify_privacy_and_config.py:47,83,133,204`); `Client` `PayoutMixin` almıyor.

### 4.2 P1 — ana akış tamamlanamıyor veya ciddi yanlış işlem

**P1-1 · Eğitmen onay/red arayüzde ulaşılamaz — onboarding panelden yürütülemiyor** [KESİN]
`AdminSectionPage.tsx:3` prop tipi `Exclude<Tab,"overview">`; `App.tsx:422,423,448` yalnız `"listings"|"diplomas"|"names"` geçiyor; `AdminHome.tsx:791-793` `<PendingTutorsSection/>` **yalnız** `section === "overview"` dalında. `useApproveTutor`/`useRejectTutor` tüm kod tabanında tek yerde kullanılıyor: `AdminHome.tsx:102-103` — o ölü dalın içinde.
`ListingRow` aksiyonları (`:336-368`) `PENDING_APPROVAL` için **yalnız "Sil"** sunuyor. Sidebar etiketi de "Eğitmen İlanları" — onay kuyruğu bilgi mimarisinden düşmüş.
→ Admin ya SQL'e iniyor (ve `tutor_service.approve`'un yan etkilerini atlıyor) ya da eğitmeni siliyor.

**P1-2 · Talebe yanıt verme %100 çöküyor (TypeError → 500)** [KESİN]
`demand_service.py:253-255` `send_message(db, sender=tutor, counterparty_id=..., body=...)`; imza `messaging_service.py:239-247` `counterparty_role`'u varsayılansız keyword-only istiyor. Regresyon: çağrı `2885f8b`'de yazıldı, imza `30a963d`'de (kütüphane 3-yuvalı sohbet) değişti, çağıran güncellenmedi.
→ `POST /demands/{id}/respond` tek yanıt yolu; demand özelliği tamamen ölü. Testlerde "respond" araması sıfır sonuç.

**P1-3 · CI son 114 commit'in hiçbirinde çalışmamış; ilk push'ta da kırılacak** [KESİN]
(a) `origin/main` = `3a2f552` (28 Tem 14:46); yerel `main` **114 commit ileride, 0 geride**. Stok defteri, F26, F29, PK-1 ve `tests/verify` paketinin tamamı CI'dan geçmemiş ve **uzak yedeği yok**.
(b) `ci.yml:77` `pytest -q --ignore=tests/integration` → `pytest.ini`'de `testpaths=tests`, hiçbir yerde `collect_ignore`/`norecursedirs` yok → `tests/verify` toplanıyor → `tests/verify/conftest.py:43-56` session-autouse guard `POSTGRES_DB != "adana_verify"` görüp `pytest.exit(returncode=1)`. Aynı commit (`dbef9f1`) coverage adımına `--ignore=tests/verify` eklemiş, 77. satıra eklemeyi atlamış.
→ İlk push'ta backend job'ı bu adımda kırılır; ardındaki integration ve verify adımları hiç çalışmaz.

**P1-4 · Sıkışmış para ve ölü iş için hiçbir yönetici yüzeyi yok** [KESİN]
`escrow_reconciler.py:108-114` deneme sınırı dolan iadeyi `logger.error("MANUEL müdahale gerekli")` ile bırakıyor. `grep REFUNDING backend/api/ frontend/src/pages/admin/` → **sıfır**. `grep OutboxEvent backend/api/` → **sıfır**.
→ Sarkan iade, kayıp callback, ölü SMS/e-posta işi yalnız sunucu logundan görülebilir; düzeltme yalnız SQL'den yapılabilir.

**P1-5 · Onaysız tek-tık tam iade** [KESİN]
`AdminStore.tsx:735-738` `refund.mutate(o.id)` doğrudan; `ConfirmDialog` yok, `disabled={isPending}` yok, `onError` yok. Aynı dosyada kupon silmenin (`:1064`) ve RMA onayının (`:881-890`) diyaloğu var.
→ Yanlış satıra tıklama geri alınamaz gerçek sağlayıcı iadesi tetikliyor.

**P1-6 · "Yalancı boş durum": hata → "kayıt yok"** [KESİN]
`isError` okunmayan para/iş yüzeyleri: `AdminPayoutsPage.tsx:168-176` ("Henüz ödeme kaydı yok."), `AdminStore.tsx:678` sipariş / `:780` iade ("Bekleyen iade talebi yok."), `AdminHome.tsx:601` diploma ("Teyit bekleyen belge yok 🎉"). Tüketici tarafında 75 sayfa `isLoading` kullanıyor, 46'sı `isError` → **29 sayfa açıkta**. `lib/queryClient.ts:20-24` 403/404'ü bildirimden muaf tuttuğu için 403 tamamen sessiz.
→ 500/ağ hatası operatöre "iş yok, her şey yolunda" diye okunuyor; bekleyen iadeler ve ödemeler sessizce atlanıyor.

**P1-7 · KDV boru hattının yazıcısı yok — her siparişin vergisi 0** [KESİN]
`tax_rate` üretim kodunda yalnız model tanımı + okuma yerlerinde geçiyor. `ProductCreate`/`ProductUpdate` şemalarında **alan yok**, CSV başlığı yok, frontend'de geçmiyor. Migration `1207ea669b49:60` bir kereliğine mevcut DIGITAL ürünlere %20 yazmış; o tarihten sonraki her ürün `server_default 0`. `totals_by_rate` hiçbir üretim kodundan çağrılmıyor; backend'de fatura ucu yok.
→ Karışık sepette matrah/vergi ayrıştırılamıyor, e-Arşiv faturası kesilemiyor.

**P1-8 · Şifre sıfırlama access token'ı iptal etmiyor + rol 4/5'te sessizce çalışmıyor** [KESİN]
(a) `auth_service.reset_password:206-210` ve `change_password:167-174` yalnız refresh'leri iptal ediyor; access token denylist'e girmiyor ve `auth_version` yalnız KURYE'de kontrol ediliyor (`deps.py:68`). `ACCESS_TOKEN_EXPIRE_MINUTES=60` → hesabı ele geçiren saldırganın oturumu şifre sıfırlandıktan sonra **60 dakika daha** yetkili.
(b) `verification_service._MODEL_BY_ROLE:25-29` yalnız ADMIN/TUTOR/CLIENT içeriyor; `find_by_email` LibraryOperator ve CourierAccount'u da buluyor → token üretilip mail gidiyor, `consume_token` `None` dönüyor → kullanıcı **her zaman** "bağlantı geçersiz" alıyor.

**P1-9 · Doğrulanmış diploma, okul adı değiştirilerek sahteleştirilebiliyor** [KESİN]
`education_service.update:107-114` yalnız `verification_code` gerçekten değişirse `_sync_review_state` çağırıyor; `school_name`/`degree`/`field_of_study` düzenlemesi `VERIFIED` durumunu koruyor. `EducationOut` üçünü `verification_status` ile birlikte public dönüyor.
→ Lise barkodu doğrulatıp okulu "Boğaziçi Üniversitesi" yapmak mümkün.

**P1-10 · Süresiz rezervasyonla eğitmen takvimi kilitlenebiliyor** [ÇIKARIM]
`schemas/booking.py:89-95` azami süre doğrulaması içermiyor; `_assert_within_availability:116` eğitmen hiç müsaitlik tanımlamamışsa **kısıtsız** dönüyor; GiST exclusion PENDING'i de kapsıyor.
→ Müsaitliksiz bir eğitmene tek istekle 1 yıllık PENDING talep = takvim tamamen bloke. Rate-limit (10/pencere) engellemiyor.

**P1-11 · Gizlenmiş yorumun düzenlenmesi/silinmesi puanı ikinci kez bozuyor** [KESİN]
`content_moderation.hide:95-103` gizlerken toplamdan düşüyor; `review_service.update_review:180-184` ve `delete_review:191-194` `hidden_at` kontrolü yapmıyor, `get_review:105-109` yalnız `deleted_at` bakıyor.
→ `rating_count`/`rating_sum` bozulur, negatife düşebilir, Bayesian sıralama kalıcı olarak yanlışlanır.

**P1-12 · 401'de react-query önbelleği temizlenmiyor** [KESİN]
`api/axios.ts:76-78` yalnız `logout()`; `hooks/useLogout.ts:20-23` ise `logout()` + `queryClient.clear()` + `favoritesStore.clear()` yapıyor ve yorumu *"sonraki kullanıcıya sızmasın"* diyor.
→ Refresh başarısız olup oturum düşerse önceki kullanıcının `bookings`/`conversations`/`orders`/`addresses` verisi bellekte kalıyor; aynı sekmede başka hesapla girişte `staleTime: 30s` yüzünden **önce bayat veri gösteriliyor**. Paylaşılan cihazda (kütüphane operatörü, kurye telefonu) gerçekçi.

**P1-13 · `ix_tutors_name_trgm` ölü — eğitmen ad araması her istekte tam tablo taraması** [KESİN — ajan doğruladı]
İndeks `tr_normalize(first_name || ' ' || last_name)` ifadesiyle yaratılmış (`dd737c387ff5:93-96`); sorgu ise `mixins.py:33-36`'daki `func.concat(...)` hybrid'inden geliyor. Postgres ifade indekslerini parse-ağacı eşitliğiyle eşler — `concat()` ile `||` farklı düğümler, üstelik `concat()` `STABLE`, indeks `IMMUTABLE` gerektiriyor.
→ `search_service.py:181,187,194,198` satır başına `tr_normalize(concat(...))` hesaplayan seq scan yapıyor. Migration'ın kendi docstring'i indeksi tam bu taramayı önlemek için eklediğini yazıyor. Kütüphane muadili doğru (düz kolon).

**P1-14 · Yetki kapılarının router'a kablolandığı hiçbir yerde test edilmiyor** [KESİN]
Yetki yükseltme engeli yalnız servis fonksiyonu doğrudan çağrılarak kanıtlanmış (`test_privilege_escalation_pg.py:105,159`); `admin.py:176,193,210` silinse suite tamamen yeşil kalır. Teslimat tarafında daha ağır: `api/routers/delivery.py` (~40 uç) hiçbir testte import edilmiyor, **gerçek HTTP testi sıfır**, `ensure_stop_access` `tests/` ağacında hiç geçmiyor.
→ Proje bu tuzağı ödeme tarafında `test_payment_gate_wiring.py` ile çözmüş; yetki ve teslimat tarafında çözmemiş.

**P1-15 · Kurye saha ekranında yazma tarafı dayanıklılığı yok** [KESİN]
`DeliveryDriver.tsx`'te `navigator.onLine`, offline kuyruk, mutation retry: hiçbiri yok. `lib/queryClient.ts:70-74` mutation'lara retry vermiyor.
→ Mobil şebekede tek kopma `verify`, `sendOtp` ve foto yüklemeyi sessizce düşürüyor; tekrar denemek kuryenin insafında. Okuma tarafı iyi ele alınmış (`:452-460` ağ hatası ile 404'ü ayırıyor) — eksik olan yazma.

**P1-16 · `accept`/`reject` kayıp-güncelleme yarışına açık** [ÇIKARIM]
`accept:414`/`reject:433` bellekteki `_transition`'ı kullanıyor; `cancel`/`complete` ise `_claim_transition`. `_get_booking_or_404` `FOR UPDATE` almıyor.
→ Öğrenci iptal ederken eğitmen kabul ederse accept'in UPDATE'i CANCELLED'ı ezer ve iptal edilmiş derse PENDING ödeme kurulur.

**P1-17 · Anti-disintermediation maskesinde dört delik** [KESİN — ajan doğruladı]
Maskesiz kalan yüzeyler: **`Review.tutor_reply`** (`review_service.py:93` ham atama, public çıktı — maskenin var olma gerekçesiyle birebir aynı yüzey), **`Booking.notes`** (`booking_service.py:237`, ilk temas metni), **`BookingResource.file_name`** (`:726` — aynı satırdaki title maskesini dosya adıyla baypas ediyor), **`Booking.cancel_reason`** (`:615`). Ayrıca bildirim gövdeleri ham `title`/`file_name` taşıyor (DB maskeli, bildirim değil).

**P1-18 · Onaylı eğitmen tüm öğrenci tabanını sayfalayabiliyor** [KESİN]
`clients.py:36-87`; kapı `_approved_viewer:18-33` yalnız "onaylı eğitmen mi" diye soruyor, **ilişki aramıyor**. Dönen alanlar: ad, kullanıcı adı, doğum tarihi, cinsiyet, hakkında, son görülme, eğitim geçmişi. `client_id` ardışık tamsayı. Kodun kendi yorumu (`:26`) kitlenin bir kısmının reşit olmadığını yazıyor.
→ P0-6 ile birleşince: doğrulanmamış bir hesap hem listeyi çıkarabiliyor hem DM açabiliyor.

**P1-19 · `GET /reviews/booking/{id}` sahiplik kontrolü yok** [KESİN]
`reviews.py:82-88` yalnız `get_current_active_user`; servis yalnız `booking_id` ile filtreliyor ve yanıta `client_name` + `client_avatar_url` ekliyor. Aynı router'ın PATCH/DELETE uçları sahiplik istiyor — tutarsızlık.
→ Herhangi bir oturumlu kullanıcı `booking_id` tarayarak "hangi öğrenci kime kaç puan verdi" eşlemesini çıkarabilir.

**P1-20 · Kütüphane kolunda kontenjan hiçbir katmanda zorlanmıyor** [KESİN — iki ajan bağımsız doğruladı]
`library_exam_service.register:474` ve `study_reservation_service.reserve:244` kontenjanı **kilitsiz** okuyup karşılaştırıyor (check-then-act). Daha ağırı: `ACTIVE_REGISTRATION_STATUSES = (PAID, ATTENDED)` (`models/library_exam.py:49-52`) — yani `PENDING_PAYMENT` **koltuk tutmuyor**. Ve `pay()` (`:497-547`) ile `complete_checkout()` (`:549-640`) kontenjanı hiç kontrol etmiyor (`capacity` kelimesi o aralıkta geçmiyor). Aynı desen çalışma rezervasyonunda: `_overlap_count` yalnız `reserve()`'de.
Ders tarafı bunu **DB'de** çözmüş (`models/booking.py:103-110` GiST exclusion); kütüphane tarafında ne kısıt ne kilit var; `study_reservations`'ta tekillik kısıtı da yok.
→ 20 kişilik oturuma 100 kişi kaydolup 100'ü de ödeyebilir. Emanete alınan fazla para, `REFUND_WINDOW_HOURS` dolmuşsa iade edilemiyor (`:676` → 409).
Test durumu: `capacity` hiçbir testte assert edilmiyor.

**P1-21 · Soft-delete edilmiş kütüphanenin deneme oturumları satılmaya devam ediyor** [KESİN]
`library_service.delete_library:707-712` yalnız `deleted_at` damgalıyor; `status` `ACTIVE`, oturumlar `SCHEDULED` kalıyor. `register()` kütüphaneyi `:478`'de alıyor ama **yalnız komisyon oranı için** — `deleted_at` kontrolü yok. `list_public_sessions:300` `status != ACTIVE` bakıyor, `deleted_at`'e bakmıyor. `library_exam_service.py` ve `study_reservation_service.py`'de `Library.deleted_at` **hiç geçmiyor**.
Kardeş yüzey doğru yapıyor (`study_reservation_service.py:234`: `if library is None or library.deleted_at is not None: 404`) — tasarım kararı değil, unutma.
→ Silinmiş kütüphaneye ödeme alınıyor; `auto_release_no_shows:778-784` komisyon düşüp o kütüphaneye serbest bırakıyor.

**P1-22 · `delete_tutor` / `delete_library` açık emanet kontrolü yapmıyor** [KESİN]
`admin_service.py:323-326` gövdesi iki satır: `deleted_at = now()` + `flush()`. ACCEPTED booking, HELD payment, `payout_status='ACTIVE'` alt üye kaydı sorgulanmıyor. Aynısı kütüphane için.
→ Yetim emanet. `payout_ledger._tutor_earned:84-99` `Payment.deleted_at`'e bakıyor ama `Booking`/`Tutor`'a bakmıyor — para defterde "hak edilmiş" kalıyor, hesap yok.

### 4.3 P2 — operasyon yavaş, hataya açık veya yönetilemez

| # | Bulgu | Yer |
|---|---|---|
| P2-1 | **TB-5 GEÇERLİ**: `SALE_CANCEL` `ref_type="order_item"` ama `ref_id=order.id`; filtre iptal satırını getirmiyor, düzeltme migration'sız yapılamaz (tavan sorgusu bu çifte bağımlı) | `order_service.py:1294`, `stock_ledger.py:385` |
| P2-2 | **TB-2 GEÇERLİ**: iade akışında ürün satırları sağlayıcı HTTP çağrısı (20 sn timeout) boyunca `FOR UPDATE` kilitli | `order_service.py:1354,1846` |
| P2-3 | **TB-4 GEÇERLİ**: aynı callback ucunda dört dal dört farklı transaction sahipliği gösteriyor; `escrow.begin_refund:234` servis içinde istek-ortası commit yapıyor | `payments.py:179-203`, `core/database.py:56` |
| P2-4 | **TB-6 GEÇERLİ**: `audit_logs` DB seviyesinde değişmez değil; kanıt — `db_guard.py:141` onu trigger kapatmadan siliyor, `:146` `stock_movements` için kapatmak zorunda | `f29_sayim_hasarli_stok.py:589-596` |
| P2-5 | Checkout'ta idempotency anahtarı yok; tek koruma fail-open Redis limiti. Projenin kendi kanıtlanmış deseni (ref kilidi + kararlı anahtar) envanterde var, checkout'ta yok | `store.py:638-655`, krş. `CountSessionDetailPage.tsx:328` |
| P2-6 | Karışık siparişte dijital kalem de tam iadeye giriyor; m.15 istisnası `returns.py:6-7`'de yazılı ama kodda uygulanmamış | `order_service.py:1500,1655` |
| P2-7 | Eşzamanlı kısmi iade talepleri kümülatif tavanı aşabiliyor (tavan yalnız talep oluşturulurken uygulanıyor, `_settle_return` yeniden kırpmıyor) | `order_service.py:1688,1805` |
| P2-8 | Exam/study `pay()` atomik claim kullanmıyor (düz ORM ataması, check-then-act); booking doğru yapıyor | `library_exam_service.py:539`, `study_reservation_service.py:345` |
| P2-9 | Deneme oturumu kontenjanı ödeme sonrası doğrulanmıyor → kapasite üstü PAID bilet mümkün, otomatik iade yolu yok | `library_exam_service.py:473,629` |
| P2-10 | Kayıp-callback kurtarma penceresi kapanıyor: reconciler 48 saatten uzun durursa kayıtlar kalıcı olarak taranmaz hâle geliyor, alarm yok | `escrow_reconciler.py:174`, `config.py:269` |
| P2-11 | iyzico callback ucu kimliksiz **ve** rate-limit'siz; her POST dışa HTTP isteği yapıyor (para güvenli, kota/havuz değil) | `payments.py:156-171` |
| P2-12 | Görev ayrılığı zorunlu değil; `INVENTORY_REQUIRE_SEPARATE_APPROVER` **yalnız docstring'de yaşıyor**, ayar hiç tanımlanmamış. `COMMERCE_MANAGER` rolü dört ticari izni birden alıyor | `inventory_service.py:975`, `7121d6785a32:60` |
| P2-13 | **Mal kabul sistemi yok**; tedarikçi/satın alma/irsaliye modeli yok | `models/` |
| P2-14 | **F30 paketleme/konum ayrımı yok**; `mark_prepared` tek boolean, raf/bin kolonu yok, `prepared_by` sabit `"admin"` (router `actor` geçmiyor) | `delivery_service.py:743` |
| P2-15 | `cancel_run` söz borcunu ve deneme sayacını işlemiyor — watchdog aynı senaryoda işliyor (asimetri) | `delivery_service.py:412` vs `:561` |
| P2-16 | `mark_delivered` açık durağı kapatmıyor → tur kalıcı olarak kapanamıyor, `fail_stop` 409 veriyor | `order_service.py:1217`, `order_fsm.py:91` |
| P2-17 | `add_stops` bölge kontrolü yapmıyor → bölge-dışı sipariş doğrudan API çağrısıyla tura girebiliyor | `delivery_service.py:991-1014` |
| P2-18 | `dispatch_day` kısmi başarısızlık bırakıyor (tur commit edilmiş, `add_stops` düşmüş) | `delivery_service.py:1200-1242` |
| P2-19 | Sessiz saat kuralı zaman-kritik SMS'leri de erteliyor → müşteri ertesi sabah "kuryen yaklaşıyor" alıyor | `core/outbox.py:172-181` |
| P2-20 | QR paket doğrulaması tavsiye niteliğinde; yanlış paket yalnız toast, backend tarama izi aramıyor. "İki katmanlı kanıt" iddiası fiilen tek katman (OTP) | `DeliveryDriver.tsx:486-503`, `delivery_service.py:1663` |
| P2-21 | Brute-force koruması yalnız IP bazlı; hesap bazlı sayaç/kilit yok. Redis düşerse hem limit hem logout iptali fail-open | `ratelimit.py:112`, `token_denylist.py:48` |
| P2-22 | Yükleme uçlarının 11'i gövdeyi RAM'e alıp boyutu **sonra** kontrol ediyor; ASGI/proxy seviyesinde gövde limiti repoda yok. `/auth/me/avatar` içerik tipi doğrulamıyor | `auth.py:489`, `delivery.py:493`, +9 |
| P2-23 | `core/crypto.py` KDF'siz (`sha256(raw)`, salt/iterasyon yok), anahtar ayrımı yok (`FIELD_ENCRYPTION_KEY` yoksa **JWT_SECRET_KEY**), rotasyon yolu yok → JWT anahtarını döndürmek tüm şifreli IBAN/TCKN'yi çözülemez yapar | `crypto.py:27-30` |
| P2-24 | E-posta tablolar arası tekil değil (`_email_taken` yalnız kendi modelinde bakıyor, `_username_taken` dördünü birden tarıyor) → hesap kurtarma DoS'u | `auth_service.py:29,38` |
| P2-25 | Sayfalama/tavan boşlukları: `/tutors/price-histogram` (public, sınırsız), `/admin/tutors`, `/messages/conversations`, `/tasks`, `/payouts/pending`, `/leaderboard`, `qa/rights`, `store/admin/coupons` — hiçbirinde `limit` yok; tüm `offset` parametreleri `le=` tavansız | `tutors.py:68`, `admin.py:379`, +6 |
| P2-26 | Her mağaza/eğitmen aramasında Bayesian global ortalama için tam tablo agregasyonu (önbelleksiz) | `store_service.py:116`, `ranking.py:23` |
| P2-27 | N+1'ler: `admin_access_service.py:79` rol başına 2 sorgu · `order_service.py:747` kalem başına `db.get(Tutor)` · `delivery_service.py:991` durak başına `db.get(Order)` + döngü içinde `flush()` · `task_service.py:736` ata zinciri | — |
| P2-28 | Ölçek paketi CI'da yok ve hiçbir şey doğrulamıyor: `probe.py:329` koşulsuz `0` dönüyor, eşikler yalnız ekrana basıyor, "medyan" **sıralanmamış** listeden alınıyor (`:295`), varsayılan hacim indeks migration'ının ölçtüğünden 10× küçük | `scripts/scale/` |
| P2-29 | Docker HEALTHCHECK ağır `/health` ucuna bağlı; `main.py:396` yalnız DB düşünce 503 dönüyor → DB kesintisinde konteyner sürekli yeniden başlıyor. `backend/CLAUDE.md` bunun için `/health/live`'ı şart koşuyor | `backend/Dockerfile:33` |
| P2-30 | Üretim imajı kirli: `.dockerignore` yalnız `__pycache__`/`.venv`/`.env` hariç tutuyor; `COPY . .` ile `fix_tutors.py`, `cleanup_tutors.py`, `seed_test.py`, `add_books.py` ve tüm `tests/` konteynere giriyor | `backend/Dockerfile:20` |
| P2-31 | Hijyen nöbetçisi para ve teslimat tablolarını izlemiyor (`payments`, `bookings`, `tutors`, `delivery_runs`, `delivery_stops`, `couriers`, `outbox_events`, `notifications` listede yok) | `tests/integration/conftest.py:317-338` |
| P2-32 | `tests/verify/conftest.py:275` kapsamsız `DELETE FROM outbox_events` — kendi satırları değil tüm tabloyu siliyor | — |
| P2-33 | Şikâyet kararı metin görülmeden veriliyor (`description` kolonlarda yok, karar diyaloğunda da yok); hedef tıklanabilir link değil | `AdminReportsPage.tsx:98-135,189` |
| P2-34 | İki çelişen frontend yetki sözleşmesi: `lib/adminAccess.ts:17` fail-**open**, satır içi kontroller fail-**closed** → aynı oturumda Mağaza düzenlenebilir, Rezervasyonlar sebepsiz salt-okunur | — |
| P2-35 | Modal a11y hook'u yazılmış, 31 dosyanın 4'ünde kullanılıyor; **bir ödeme yüzeyi** (`LibraryReservationModal.tsx:32`) `role="dialog"`/ESC/odak tuzağı/scroll lock içermiyor | `hooks/useModalA11y.ts` |
| P2-36 | Kaynak sözleşme testlerinde yalancı yeşil: `assert "set" in src and "len" in src` (`src` bir `ast.dump` yığını), `assert "payment_gates" in src` (yorum satırı bile geçirir), sabit karakter penceresi kullanımı | `test_stock_ledger_contract.py:413,627`, `test_payment_gate_wiring.py:157` |
| P2-38 | **IBAN şifreleme migration'ı anahtarı `"dev"`e düşürebiliyor.** Migration `os.getenv(...)` okuyor (`3fe0fd1ed73b:51`), çalışma zamanı `settings.*` okuyor (`crypto.py:27`); pydantic `env_file=".env"` **`os.environ`'a yazmaz** (`config.py:9`). Sırlar `.env` dosyasından geliyorsa migration `SHA256("dev")` ile şifreler, uygulama gerçek anahtarla çözemez → **IBAN'lar sessizce kalıcı okunamaz** (`decrypt` fail-safe `None` döner). Compose yolu güvenli (`env_file:` gerçek env yapar); risk çıplak `alembic upgrade head` koşan operatörde | `3fe0fd1ed73b:51` |
| P2-39 | Arka plan işlerinde WebSocket push sessizce düşüyor: `ws_outbox.flush` yalnız `core/database.py:66`'da (`get_db` yolunda); `main.py:84-92` `AsyncSessionLocal()` ile açtığı için hatırlatma ve auto-complete bildirimleri DB'ye yazılıyor ama push gönderilmiyor | `main.py:92` |
| P2-40 | Bilet `qr_token`/`short_code` DB'de tekil değil (`index=True`, `unique` yok); `_unique_short_code` oku-sonra-yaz döngüsü, arkasında kısıt yok. Teslimat tarafı doğru yapmış (`delivery.py:207-209` `unique=True`) | `models/library_exam.py:167,169` |
| P2-41 | Kargo ücreti hem frontend hem backend'de hesaplanıyor: `lib/shipping.ts:4-5` sabit `500`/`49.9` ↔ `config.py:164-165` env'le değişebilir → `.env` değişirse sepet ve checkout farklı toplam gösterir. (Komisyon/KDV/kupon/ders ücreti duplike **değil**) | — |
| P2-37 | Fikstür sabitliğinden doğan yalancı yeşil: `test_verify_returns.py:37` `_paid_order` **her zaman tek kalemli** → P0-5 hiç görünmedi. `test_verify_coupon_stock.py:174` `count("PAID") <= 1` (iki sipariş de düşerse yeşil). `test_verify_cancel_and_reconcile.py:160` yalnız küme üyeliği iddia ediyor → TB-3'ün görünmez kalmasının doğrudan sebebi | — |

### 4.4 P3 — kalite, konfor, ölçek

Metin araması ve sınav boost'u fiilen ölü (`search_service.py:238` — Bayesian float birincil anahtar olduğu için `relevance` asla devreye girmiyor) · "Kimliği Doğrulanmış" rozeti hiç görünmüyor (`identity_verified` şemada var, servis doldurmuyor) · 8+ bildirim `link="/tutor"` üretiyor, o rota ana sayfaya yönleniyor · `revoke(jti, exp)` mutlak timestamp'i TTL sanıyor → Redis anahtarı ~54 yıl yaşıyor (`auth.py:573`) · `decode_access_token` `type=="access"` doğrulamıyor · WS token'ı query string'de, denylist/`auth_ver` kontrolsüz · `get_current_active_operator` ölü kod, aynı mantık elle kopyalanmış · `library_exam_service.register` kütüphanenin ACTIVE olduğunu kontrol etmiyor (kardeş akış ediyor) · 403↔404 tutarsızlığı 12 yerde → ID numaralandırmayla iş hacmi sızıntısı · `POST /store/products/{id}/notify-me` kimliksiz, keyfi e-postaya abonelik açıyor · speedtest konum doğrulaması yok · audit boşlukları (hesap silme, kullanıcı kaynaklı iptal+iade, CAYMA iadesi, kütüphane görsel işlemleri) · `before_values` neredeyse hiç doldurulmuyor, `ip_address` hiç doldurulmuyor · `seed_holidays` yalnız 2026, uç 2030'a kadar kabul ediyor · `list_closed_days` sunucu saat diliminde `date.today()` · `OtpVerifyIn.code` `min_length=4` ama OTP 6 hane · `remove_stop` hard delete · PoD 12 ay saklama kuralı kodda yok · süresi dolan token/OTP satırlarını silen iş yok · `pages/Learn.tsx` tasarım barını ihlal ediyor (8 gradyan, 2 `dark:`) · sekme durumu URL'de değil, "Biletlerim" denilen yere ulaşılamıyor · 504 satır yetim bileşen + kullanılmayan `@cloudflare/speedtest` bağımlılığı · `ImageCropModal`/`MapPicker` sayfa chunk'ında eager · para biçimlendirme sözleşmesi 3 yerde deliniyor · Google Fonts dış kaynak (KVKK sayfası olan sitede) · 378 input / 32 `htmlFor`.

---

## 5. Eksik kullanıcı ve admin akışları

### Kullanıcı tarafı
1. Öğrencinin **ihtilaf açma** yolu yok (uç, model hedefi, ekran — hiçbiri).
2. **Ders gerçekleşme onayı** yok; escrow tek taraflı boşaltılıyor.
3. Ders iptalinde **pencere ve yaptırım** yok (bilet/rezervasyonda 24 saat var, derste yok).
4. **Fatura** indirilemiyor (backend ucu yok; `OrderInvoiceModal` istemci tarafı HTML sürrogatı olduğunu kendisi yazıyor).
5. Reschedule UI **yeni ücreti göstermiyor**.
6. Eğitmen **red gerekçesini göremiyor** (admin de girmiyor).
7. Ödeme sonrası "Biletlerim'de" deniyor ama o isimde rota/nav yok.

### Admin tarafı
8. **Eğitmen onay/red** (P1-1) — en kritiği.
9. **Sıkışmış escrow / REFUNDING / FAILED outbox** ekranı (P1-4).
10. **Admin sipariş iptali** ucu yok (yalnız müşteri iptal edebiliyor).
11. **Sipariş adresi/kalemi düzeltme** yok — müşteri ulaşılamıyorsa tek çıkış iptal+iade.
12. **Kullanıcı şifre sıfırlama** ucu yazılmış ama UI'da çağıranı yok; **aktif/pasif** toggle yok; **KVKK silme talebi** admin tarafından tetiklenemiyor.
13. **Gizlenmiş içeriği geri getirme** (`unhide`) ucu var, çağıranı yok — üstelik ekran "Karar geri alınabilir" yazıyor.
14. **Elle stok düzeltme** (`ADMIN_ADJUSTMENT`) HTTP ucu yok.
15. **Kütüphane bileti/rezervasyonu iadesi** için 24 saat kuralına takılan öğrenciye admin override yok.
16. **Destek bileti** sistemi yok (bilinçli).
17. **Eğitmen/satıcı kırılımlı performans raporu** yok.
18. **Kayıp/hasarlı paket** akışı yok (`PAKET_SORUNU` neden kodu var, zincir yok).
19. **İade edilen ürünün fiziksel kabulü** yok (`RETURN_RECEIVED` etkisi tanımlı, akış yok).
20. Kurye **kendi turunu başlatamıyor** (`start` admin router'ında).

---

## 6. Güvenlik ve veri bütünlüğü riskleri

**En yüksek üç risk, sırasıyla:**

1. **P0-6 (onaysız operatör DM'i) + P1-18 (öğrenci listesi) birleşimi.** Doğrulanmamış bir hesap hem tüm öğrenci tabanını sayfalayabiliyor hem her birine DM açabiliyor; kitlenin bir kısmı reşit değil ve platformda **veli rolü, yaş alt sınırı veya veli görünürlüğü yok**. Bu teknik bir açıktan fazlası — itibar ve hukuk riski.

2. **P0-9 (KVKK silme).** Eğitmen silme akışı hem patlıyor hem TCKN/`identity_last4`/diploma dosyasını bırakıyor. Ayrıca hiçbir saklama süresi kodda tanımlı değil; süresi dolmuş `verification_tokens`/`phone_otps`/`refresh_tokens` satırları kalıcı birikiyor ve PoD 12 ay taahhüdünün kodda karşılığı yok.

3. **P0-7 (cevap anahtarı).** Yetki kararının rol yerine iş durumuna bağlanması + imzalama middleware'inin rol bakmaması, sızıntıyı **çalışır bir indirme bağlantısına** dönüştürüyor.

**Veri bütünlüğü:**
- Para alanlarının tamamı `Numeric` — float yok. Komisyon `Decimal` + `ROUND_HALF_UP`. Conservation DB CHECK'leriyle korunuyor. **Bu taraf sağlam.**
- Kritik boşluk **P0-8 (TB-3)**: defter ile `products.stock` uyumlu kalırken fiziksel raf sapıyor; `verify_ledger` bunu sapma olarak göremiyor. F29 sayımı "fazla" olarak yakalar ama sebebini söyleyemez.
- `audit_logs` DB seviyesinde değişmez değil (P2-4) — koruduğu tablolardan zayıf.
- `core/crypto.py`'nin anahtar türetmesi (P2-23) olay müdahalesinde rutin bir işlemi (JWT anahtar rotasyonu) **veri kaybına** çeviriyor.

---

## 7. Test kalitesi ve kapsama boşlukları

### 7.1 Dürüst envanter (CLAUDE.md §H)

| Sınıf | Dosya | Test |
|---|---|---|
| Gerçek PostgreSQL entegrasyon | 50 | ~405 |
| Gerçek PG + gerçek servis (`tests/verify`) | 17 | ~115 |
| Gerçek HTTP (ASGI/TestClient) | 11 | — |
| Saf birim (DB'siz) | 73 | ~508 |
| Kaynak/AST sözleşmesi (**düşük güçlü**) | 7 | ~62 |
| Frontend gerçek DOM + etkileşim + gözlenen istek | **1** | 61 |
| Frontend gerçek DOM, sınırlı etkileşim | 1 | 3 |
| Frontend gerçek DOM, etkileşimsiz | 4 | — |
| Frontend saf yardımcı (`lib/`) | 54 | — |
| **Gerçek tarayıcı / E2E / baskı çıktısı** | **0** | **0** |

### 7.2 Yapısal boşluklar

- **Frontend fiilen test edilmemiş.** 63 dosyanın 57'si UI'ye hiç dokunmuyor. 96 sayfanın 5'inde DOM testi var. MSW yok, `vi.mock` sıfır, Playwright yok, coverage eşiği yok. Test edilmemiş kritik yüzeyler: `CheckoutPage` (725 satır, ödeme), `DeliveryDriver` (675, OTP + foto kanıt), `Tickets` (917, QR), `Messages` (1098). **Bu denetimin üç P0/P1'i (P1-1 ölü onay dalı, P1-5 onaysız iade butonu, P1-6 yalancı boş durum) tam olarak bu boşlukta oluştu.**
- **Testsiz backend modüller (sıfır referans):** `messaging_service` (716 satır), `qa_service` (274), `library_onboarding_service` (159), `library_exam_catalog_service` (192), `geocode_service` (381), `phone_service` (166), `name_change_service` (254), `notification_service` (82), +14. Router tarafında: `tasks` (22 uç), `flashcards` (10), `messages` (9), `reviews` (8), `qa` (7), `library_exam_catalogs` (6), +11.
- **`core/token_denylist` sıfır test** — logout'un access token'ı öldürdüğü hiç kanıtlanmamış. `deps.py:68` `auth_ver` için de sıfır HTTP testi.
- **Tahsilat (charge) yolu hiçbir gerçek-DB testinden geçmiyor** — `tests/verify/conftest.py:348` `charge` çağrılırsa `AssertionError`. 124 doğrulama senaryosunun tamamı **iade/release** tarafını kanıtlıyor.
- **CI boşlukları:** E2E adımı yok, coverage eşiği yok (ve ölçüm en güçlü iki paketi dışlıyor), Redis/MinIO service container yok (dosya erişim sınıfları CI'da hiç doğrulanmıyor), VROOM/OSRM yok (16 test kalıcı SKIP), mutasyon provası CI'da koşmuyor, `pip-audit`/`npm audit` `continue-on-error`.
- **Mutasyon kataloğu dar:** 8 mutasyonun 6'sı `stock_ledger`. Ödeme kapıları, auth/refresh, teslimat kilitleri ve yetki için tek mutasyon yok — CLAUDE.md §J-2 bu paketler için karşılanmamış.
- **`tests/integration/conftest.py:92` PG yoksa SKIP** — PG'siz koşuda tüm para entegrasyon testleri sessizce atlanır ve suite yeşil raporlanır. `tests/verify` bunu doğru çözmüş (`pytest.fail`); iki paket tutarsız.

### 7.3 Somut yalancı yeşil örnekleri

| Test | Neden zayıf |
|---|---|
| `test_verify_returns.py:37` | `_paid_order` her zaman **tek kalemli** → P0-5 asla görünmedi |
| `test_verify_cancel_and_reconcile.py:160` | Docstring "süreç ölürse…" diyor, tek iddiası küme üyeliği → TB-3 görünmez kaldı |
| `test_return_escrow_spec.py` | 3 iddia, hepsi introspektif (dataclass alanı, `not hasattr`, tuple üyeliği) |
| `test_verify_coupon_stock.py:174` | `count("PAID") <= 1` — iki sipariş de düşerse yeşil |
| `test_stock_ledger_contract.py:413` | `assert "set" in src and "len" in src` — `src` bir `ast.dump` yığını |
| `test_payment_gate_wiring.py:157` | `assert "payment_gates" in src` — yorum satırı bile geçirir |
| `test_verify_library_money.py:277` | Pencere sabiti kendi sembolüyle test ediliyor (24 → 1 yapılsa yeşil kalır) |
| `test_delivery_metrics.py:32` | Beklenen değer uygulamanın kendi `rate()`'inden üretiliyor |
| `test_inventory_rules_pure.py:7` | Güvenlik ağı olarak gösterdiği test **repoda yok** |
| `test_education_verification.py:8` | `SimpleNamespace` stub'ı; gerçek model kısıtlarını görmüyor |

---

## 8. Production readiness değerlendirmesi

| Boyut | Durum | Not |
|---|---|---|
| Transaction sahipliği | ⚠️ | TB-4 geçerli; `get_db` otomatik commit + servis içi commit karışık |
| Concurrency | ✅ | Claim deseni, kanonik kilit sırası, kısmi unique index'ler, gerçek PG yarış testleri |
| Idempotency | ⚠️ | Callback ve defterde örnek; **checkout'ta ve exam/study `pay()`'de yok** |
| Outbox / job queue | ⚠️ | Transactional outbox gerçek; ama **in-process asyncio döngüsü** — çoklu replikada çift çalışma riski |
| E-posta / SMS | ⚠️ | Soyutlama doğru, outbox'a bağlı; üretim sağlayıcısı hesabı bekliyor |
| Loglama | ✅ | request-id korelasyonu, merkezî format |
| Hata izleme | ⚠️ | Sentry kablolu, **DSN girilmemiş** |
| Metrics | ❌ | Prometheus/metrics yok |
| Health check | ⚠️ | `/health` + `/health/live` doğru ayrılmış, **ama Dockerfile yanlış olanı yokluyor** (P2-29) |
| Backup / restore | ⚠️ | Script var, cron kurulmamış, **restore provası hiç yapılmamış** |
| Migration güvenliği | ✅ | Tek baseline, `upgrade head` + `alembic check` CI'da, gerçek DB migration testleri |
| Secrets | ✅ | Üretim guard'ı fail-fast; kodda gömülü sır bulunmadı |
| CI/CD | ❌ | **114 commit CI'dan geçmemiş**; ilk push'ta unit adımı kırılacak (P1-3) |
| Staging | ❌ | Yok |
| Performans | ⚠️ | Ölü trigram indeksi (P1-13), önbelleksiz global agregasyon, tavansız uçlar; ölçek paketi hiçbir şeyi doğrulamıyor |
| Cache | ⚠️ | Feature flag TTL önbelleği var; Bayesian ortalama ve liderlik tablosu önbelleksiz |
| Rate limit | ⚠️ | IP + kullanıcı bazlı var; **hesap bazlı kilit yok**, Redis'te fail-open |
| Dosya depolama | ✅ | İki erişim sınıfı + ASGI imzalama; **ama P0-7 yetki kararını uca bırakıyor ve uç yanlış karar veriyor** |
| KVKK / saklama | ❌ | Silme akışı kırık (P0-9), saklama süresi kodda yok, temizlik işi yok |

**Genel yargı:** Altyapı kalitesi lansmana **yakın**, ama üç madde bloklayıcı: (1) CI'nın hiç çalışmaması ve uzak yedeğin olmaması, (2) KVKK silme akışının kırık olması, (3) para yolundaki dört P0.

---

## 9. Önerilen iş paketleri

Her paket bağımsız commit'lenebilir, tek konuya odaklı ve CLAUDE.md §J ölçütlerine (mutasyon provası + gerçek altyapı + kapanış raporu) tabidir.

---

### **İP-0 · Zemin: CI'yı çalışır hâle getir ve 114 commit'i uzağa al**
**Neden ilk:** Bundan sonraki her paketin doğrulama zemini bu. Şu an hiçbir değişikliğin regresyon üretmediğini kanıtlayan mekanizma yok ve iki aylık iş tek diskte.
**Kapsam:** `ci.yml:77`'ye `--ignore=tests/verify` · `--cov-fail-under` eşiği (mevcut orandan başla) · Redis + MinIO service container · `origin/main`'e push (branch olarak, review sonrası merge) · `pip-audit` `continue-on-error` kaldırma kararı.
**Dokunulan dosyalar:** `.github/workflows/ci.yml`
**Kabul:** Push sonrası CI **yeşil**; integration + verify adımlarının gerçekten koştuğu Actions çıktısıyla kanıtlanır.

---

### **İP-1 · Pazaryeri para yolu P0'ları (ders + kütüphane)**
**Kapsam:** P0-1 (reschedule→reject kilidi), P0-2 (admin iptali iade etmiyor), P0-3 (kanıtsız complete), P0-4 (ihtilaflı ders auto-release), P1-20 (kütüphane kontenjanı), P1-21 (silinmiş kütüphane satış yapıyor), P1-22 (silme öncesi emanet kontrolü), P2-8 (exam/study `pay()` claim'siz), P2-40 (bilet kodu tekil değil).
**Yaklaşım:**
- `reject` ve `admin_service.cancel_booking`'i `_claim_transition` + `payment_service.refund` üzerinden geçir; admin iptalini `booking_service.cancel`'a delege et (ayrı kod yolu bırakma).
- `complete()`'e `start_at` kontrolü ekle (ders başlamadan tamamlanamaz).
- `auto_complete_past_bookings` sorgusuna `is_disputed == False` ekle.
- `escrow_reconciler`'a **HELD + terminal booking** taraması ekle (sarkan emanet alarmı).
- Kontenjanı DB'ye taşı: oturum satırını `FOR UPDATE` ile kilitle **veya** `study_reservations` için kısmi exclusion kısıtı; `PENDING_PAYMENT`'ı koltuk tutar say (veya TTL ile serbest bırak). `pay()`/`complete_checkout()` yollarına da kontrol koy.
- `register`/`pay` yollarına kütüphane canlılık kontrolü (`deleted_at` + `status`); `delete_*` öncesi açık emanet guard'ı.
- `qr_token`/`short_code`'a UNIQUE kısıt (teslimat tarafındaki deseni kopyala).
**Dokunulan:** `services/booking_service.py`, `services/admin_service.py`, `services/escrow_reconciler.py`, `services/payment_service.py`, `services/library_exam_service.py`, `services/study_reservation_service.py`, `services/library_service.py`, migration (UNIQUE + kısıt)
**Kabul:** Gerçek PG'de yedi senaryo, kontenjan için `asyncio.gather`'lı eşzamanlı kayıt+ödeme testi; her biri için mutasyon provası (guard'ı kaldır → test kırılsın).
**Not:** Paket büyüdüyse ikiye bölünebilir — İP-1a (ders), İP-1b (kütüphane). Bağımlılık yok, paralel de çalışılabilir; ortak dosya yalnız `escrow_reconciler.py`.

---

### **İP-2 · Mağaza iade hesabı ve TB-3**
**Kapsam:** P0-5 (kısmi iade tam sayılıyor), P0-8/TB-3 (reconciler telafileri), P2-6 (dijital kalem iadesi), P2-7 (eşzamanlı tavan aşımı).
**Yaklaşım:**
- `is_full_return`'e sipariş kalemi kümesini de ver (imza değişikliği); `_build_return` çağrısını güncelle.
- Telafileri (`_restock` + kupon serbest) `escrow.finalize_refund` sonrasına **ortak bir kancaya** taşı; `order_service.py:1364-1366`'daki yanıltıcı yorumu sil.
- `_settle_return`'de tavarı yeniden kırp.
- Dijital kalemleri `_build_return` seçiminden çıkar (m.15).
**Dokunulan:** `services/returns.py`, `services/order_service.py`, `services/escrow.py`, `services/escrow_reconciler.py`
**Kabul:** **Çok kalemli** fikstürle gerçek PG testi (mevcut `_paid_order` tek kalemli — önce fikstür düzeltilir); reconciler yolunun stok+kupon telafisi gerçek PG'de kanıtlanır.

---

### **İP-3 · Yetki ve kişisel veri P0'ları**
**Kapsam:** P0-6 (operatör DM'i), P0-7 (cevap anahtarı), P0-9 (KVKK silme), P1-18 (öğrenci listesi), P1-19 (review sahipliği), P1-8 (şifre sıfırlama).
**Yaklaşım:**
- `_can_message`'a kütüphane için **ACTIVE + ilişki** koşulu (rezervasyon/bilet/çalışma rez.); operatörün telefon muafiyetini kaldır veya ACTIVE'e bağla.
- `_session_out`'a `include_answer_key` parametresi (katalog tarafındaki doğru deseni kopyala); `list_public_sessions` için de kapat.
- `anonymize_account`: `payout_status`'u `"NONE"`'a çek, `tckn_encrypted` ölü satırını sil, `TutorEducation.verification_tckn` + `identity_last4` + diploma dosyasını temizle; **TUTOR ve LIBRARY_OPERATOR ve COURIER** için ayrı testler.
- `clients` listesine ilişki kapısı; `reviews/booking/{id}`'ye sahiplik.
- Şifre sıfırlama/değişiminde `auth_version`'ı tüm rollerde kontrol et (`deps.py:68` genelleştir); `_MODEL_BY_ROLE`'ü `_LOGIN_PRECEDENCE` ile aynı kaynaktan türet (drift'i yapısal olarak imkânsızlaştır).
**Dokunulan:** `services/messaging_service.py`, `api/routers/messages.py`, `services/library_exam_service.py`, `services/account_deletion_service.py`, `api/routers/clients.py`, `api/routers/reviews.py`, `services/verification_service.py`, `api/deps.py`, `services/auth_service.py`
**Kabul:** Her biri **gerçek HTTP** testiyle (bu paketin ana çıktısı zaten yetki testlerini HTTP katmanına taşımak).

---

### **İP-4 · Admin operasyon yüzeyi**
**Kapsam:** P1-1 (eğitmen onay ekranı), P1-4 (REFUNDING/outbox ekranı), P1-5 (iade onayı), P1-6 (yalancı boş durum), P2-33 (şikâyet metni), P2-34 (yetki sözleşmesi birleştirme) + eksik akışlar 10-14.
**Yaklaşım:**
- Onay kuyruğunu `/yonetim/egitmenler`'e taşı (ölü `overview` dalını sil, red gerekçesi ekle).
- `GET /admin/escrow/stuck` + `GET /admin/outbox/failed` + retry ucu; ekranı "Hata Çözme" sekmesi olarak aç.
- Tüm admin sorgularına `isError` + `ErrorState` (mevcut `PageState.tsx` bileşenlerini kullan).
- Yıkıcı mutasyonlara `ConfirmDialog` + `isPending` + `onError`.
- `lib/adminAccess.ts:17` fail-open'ı fail-closed'a çevir, satır içi kontrolleri ona bağla.
**Dokunulan:** `frontend/src/pages/dashboards/AdminHome.tsx`, `AdminStore.tsx`, `pages/admin/*`, `lib/adminAccess.ts`, `api/routers/admin.py`, `services/escrow_reconciler.py`
**Kabul:** Admin ekranları için **ilk DOM testleri** (`inventoryScreens.acceptance.test.tsx` şablonu); onay akışı gerçek tıklamayla kanıtlanır.

---

### **İP-5 · KDV ve fatura boru hattı**
**Kapsam:** P1-7 + eksik akış 4.
**Yaklaşım:** `ProductCreate`/`ProductUpdate`/CSV'ye `tax_rate` · admin ürün formuna alan · `totals_by_rate`'i sipariş oluşturmaya bağla · `Order`'da matrah/vergi kırılımı sakla · `GET /store/orders/{id}/invoice` (sunucu tarafı, e-Arşiv formatına hazır).
**Dokunulan:** `schemas/store.py`, `services/store_service.py`, `services/order_service.py`, `services/tax.py`, `api/routers/store.py`, `AdminStore.tsx`, `OrderInvoiceModal.tsx`
**Kabul:** Karışık sepette (%0 kitap + %20 kırtasiye) matrah/vergi toplamlarının tuttuğu gerçek PG testi.
**Dış bağımlılık:** e-Arşiv entegratörü seçimi (Nilvera/Paraşüt) — kod bu paketten sonra bağlanır.

---

### **İP-6 · Teslimat operasyon boşlukları**
**Kapsam:** P2-15 (`cancel_run` söz borcu), P2-16 (`mark_delivered` durak kapatmıyor), P2-17 (bölge kontrolü), P2-18 (kısmi dispatch), P2-19 (sessiz saat), P2-20 (QR zorunluluğu), P1-15 (offline saha), eksik akış 18-20.
**Dokunulan:** `services/delivery_service.py`, `services/order_service.py`, `services/order_fsm.py`, `core/outbox.py`, `frontend/src/pages/DeliveryDriver.tsx`
**Kabul:** `api/routers/delivery.py` için **ilk gerçek HTTP testleri** (yetki + IDOR); OTP limit/süre testleri; teslimat mutasyon kataloğu.

---

### **İP-7 · Performans ve ölçek dürüstlüğü**
**Kapsam:** P1-13 (ölü indeks), P2-25 (tavansız uçlar), P2-26 (önbelleksiz agregasyon), P2-27 (N+1), P2-28 (probe yalan söylüyor).
**Yaklaşım:** `mixins.py:36`'daki `func.concat`'i `||`'a çevir **veya** indeksi gerçek ifadeye göre yeniden yarat, `EXPLAIN` ile kanıtla · global ortalamaya süreç-içi TTL önbelleği (`core/flags.py` deseni) · tavansız uçlara `limit`/`offset le=` · `probe.py`'ye eşik ihlalinde sıfır-dışı çıkış + nightly CI job.
**Dokunulan:** `models/mixins.py`, migration (indeks), `services/ranking.py`, `services/store_service.py`, `api/routers/*`, `scripts/scale/probe.py`, `.github/workflows/`

---

### **İP-8 · Test borcunun yapısal kapatılması**
**Kapsam:** P1-14 (kablolama testleri), P2-31/32 (hijyen nöbetçisi + genel silme), P2-36/37 (yalancı yeşiller), frontend DOM testleri, mutasyon kataloğunun genişletilmesi.
**Yaklaşım:** Yetki için `test_payment_gate_wiring.py` muadili + gerçek HTTP testleri · hijyen nöbetçisine para/teslimat tabloları · zayıf assert'lerin düzeltilmesi (`<= 1` → `== 1`, sembolle test edilen sabitler → literal) · `tests/integration` skip'ini `fail`e çevirme kararı · frontend'de checkout + kurye + bilet için `inventoryScreens` şablonu.
**Not:** Bu paket **diğerlerine dağıtılabilir** — her paket kendi test borcunu kapatırsa ayrı pakete gerek kalmaz. Ayrı tutulmasının sebebi, dağıtılmayan artığın burada toplanması.

---

### **İP-9 · Üretim sertleştirmesi**
**Kapsam:** P2-29 (`HEALTHCHECK` → `/health/live`), P2-30 (`.dockerignore` — kök script'ler ve `tests/` imajdan çıksın; `cleanup_tutors.py:9` sert `DELETE` içeriyor), P2-38 (**IBAN migration anahtar sapması — bu paketin en acil maddesi**), P2-21 (hesap bazlı brute-force), P2-22 (gövde limiti + içerik tipi), P2-23 (`crypto.py` KDF + anahtar ayrımı + rotasyon), P2-39 (`ws_outbox.flush` arka plan işlerine), P2-11 (callback rate-limit), P2-41 (kargo ücreti tek kaynağa), metrics, Sentry DSN, backup cron + **ilk restore provası**.
**P2-38 için yaklaşım:** Migration'ı `os.getenv` yerine `core.config.settings`'ten okuyacak biçimde düzelt (tek kaynak) **ve** üretime çıkmadan önce mevcut şifreli satırların gerçekten çözülebildiğini doğrulayan bir kontrol koş. Bu, sessiz veri kaybı sınıfı olduğu için diğer maddelerden önce gelir.
**Dokunulan:** `backend/Dockerfile`, `.dockerignore`, `core/crypto.py`, `migrations/versions/3fe0fd1ed73b_*.py`, `core/ratelimit.py`, `main.py`, `docker-compose.prod.yml`, `devops/`

---

### **İP-10 · Mal kabul + F30 paketleme + görev ayrılığı**
**Kapsam:** P2-12, P2-13, P2-14 + eksik akış 14, 19.
**Yaklaşım:** `GoodsReceipt` modeli (tedarikçi, irsaliye no, birim maliyet) + `RECEIPT` hareket türü · `mark_prepared`'a kalem bazlı toplama + raf/bin + gerçek `prepared_by` · `INVENTORY_REQUIRE_SEPARATE_APPROVER` ayarını gerçekten tanımla ve `submit_session`/`approve_return`'de zorla.
**Not:** Bu paket **yeni özellik** içerir; diğerleri gibi "eksik kablolama" değil. Sıralamada sonda olmasının sebebi budur.

---

### **İP-11 · Pazaryeri ürün kararları** *(ayrı onay gerektirir)*
İhtilaf mekanizması (`REPORT_TARGET_TYPES`'a `BOOKING`, öğrenci itiraz ekranı, admin çözüm akışı) · ders iptal penceresi ve yaptırımı · maskeleme delikleri (P1-17) · diploma düzenleme kilidi (P1-9) · rezervasyon süre tavanı (P1-10).
**Neden ayrı:** Bunlar teknik düzeltme değil **ürün politikası**; yasal metinlerle (`legalContent.ts`) hizalanması gerekiyor ve CLAUDE.md'de zaten kayıtlı bir çelişki var (iade kuralı).

---

## 10. Paketler arasındaki bağımlılıklar

```
İP-0 (CI) ────────────────────────────────► HEPSİNİN ÖNKOŞULU
   │
   ├─► İP-1 (pazaryeri para) ──┐
   │                            ├─► İP-4 (admin yüzeyi)
   ├─► İP-2 (mağaza iade) ─────┘        │
   │        │                            │
   │        └─► İP-5 (KDV/fatura)        │
   │                                     │
   ├─► İP-3 (yetki/KVKK) ────────────────┤
   │        │                            │
   │        └─► İP-8 (test borcu) ◄──────┘
   │
   ├─► İP-6 (teslimat) ──► İP-10 (mal kabul/F30)
   ├─► İP-7 (performans)
   └─► İP-9 (üretim sertleştirme)

İP-11 (ürün kararları) ──► kullanıcı onayı bekler, İP-1'den sonra
```

**Sert bağımlılıklar:**
- **İP-0 → hepsi.** CI çalışmadan hiçbir paketin "kırmadım" iddiası doğrulanamaz.
- **İP-2 → İP-5.** KDV kırılımı iade tutarını etkiler; iade hesabı düzelmeden vergi eklemek iki hatayı birbirine karıştırır.
- **İP-1 + İP-2 → İP-4.** Admin "Hata Çözme" ekranı, `escrow_reconciler`'ın yeni taramalarını (sarkan HELD, telafi kancası) gösterecek; servis tarafı önce olmalı.
- **İP-3 → İP-8.** Yetki paketinin ana çıktısı zaten HTTP katmanı testleri; test paketi onun üzerine kurulur.
- **İP-6 → İP-10.** Paketleme/konum ayrımı, `mark_prepared`'ın düzeltilmiş hâlinin üstüne gelir.

**Yumuşak bağımlılıklar:** İP-7 (performans) ve İP-9 (üretim) diğerlerinden bağımsız; istenirse en başa da alınabilir.

---

## 11. Paralel çalışabilecek paketler

| Grup | Paketler | Gerekçe |
|---|---|---|
| **A** | İP-1 · İP-3 · İP-7 | Dosya kesişimi yok: İP-1 booking/admin servisleri, İP-3 messaging/auth/library, İP-7 ranking/index/router imzaları |
| **B** | İP-2 · İP-6 | İP-2 `order_service` iade bölümü (1300-1900), İP-6 `delivery_service` + `order_fsm`; `order_service`'te **dar kesişim var** (P2-16 `mark_delivered`) — koordinasyon gerekir |
| **C** | İP-9 | Tamamen bağımsız (Dockerfile, compose, crypto, ratelimit) — her an paralel |
| **D** | İP-5 · İP-10 | İkisi de yeni alan açıyor; birbirine değmiyor |

**Paralel çalıştırılMAmalı:**
- İP-1 ile İP-4 (admin yüzeyi servis imzalarını takip ediyor)
- İP-2 ile İP-5 (`order_service` toplamları)
- İP-8 tek başına — diğer paketlerin testlerini beklemesi gerekir

---

## 12. Çakışacak dosya ve modüller

| Dosya | Paketler | Risk | Azaltma |
|---|---|---|---|
| `services/order_service.py` (~1900 satır) | İP-2, İP-5, İP-6 | **YÜKSEK** | İP-2 yalnız 1300-1900 (iade), İP-5 yalnız 200-500 (toplamlar), İP-6 yalnız 1000-1250 (teslimat). Bölge sınırları commit mesajında yazılır |
| `services/escrow_reconciler.py` | İP-1, İP-2, İP-4 | **YÜKSEK** | İP-1 yeni tarama ekler, İP-2 telafi kancası ekler, İP-4 yalnız okur. Sıra: İP-1 → İP-2 → İP-4 |
| `services/booking_service.py` | İP-1, İP-11 | ORTA | İP-11 ürün kararı bekliyor; İP-1 bittikten sonra |
| `api/deps.py` | İP-3, İP-8 | ORTA | İP-3 `auth_version` genelleştirmesi; İP-8 yalnız test yazar |
| `frontend/src/pages/dashboards/AdminStore.tsx` (1076 satır) | İP-4, İP-5 | ORTA | İP-4 hata/onay durumları, İP-5 vergi alanları — farklı bölümler |
| `frontend/src/pages/dashboards/AdminHome.tsx` (805 satır) | İP-4 | DÜŞÜK | Tek paket; ölü dal silinirken dosya küçülecek |
| `services/delivery_service.py` (~1700 satır) | İP-6, İP-10 | ORTA | İP-10 İP-6'dan sonra |
| `.github/workflows/ci.yml` | İP-0, İP-7, İP-8 | DÜŞÜK | İP-0 temeli kurar; sonrakiler yalnız adım ekler |
| `services/messaging_service.py` | İP-3, İP-11 | DÜŞÜK | İP-3 gating, İP-11 maskeleme — farklı fonksiyonlar |
| `tests/integration/conftest.py` | İP-8 + herkes | ORTA | Hijyen nöbetçisi listesi büyüyecek; her paket kendi tablosunu ekler, İP-8 konsolide eder |

---

## 13. Her paket için tahmini commit yapısı

Proje kuralı: **test matrisi koddan önce ayrı commit** (kırmızı), sonra uygulama, sonra kapanış denetimi.

| Paket | Commit yapısı |
|---|---|
| **İP-0** | 1. `ci(zemin): unit adimi verify paketini topluyordu` · 2. `ci(zemin): redis+minio servis konteynerleri` · 3. `ci(zemin): kapsama esigi` — **3 commit** |
| **İP-1** | 1. `test(odeme): pazaryeri para P0 kabul matrisi (KIRMIZI)` · 2. `fix(odeme): reschedule->reject emanet kilidi` · 3. `fix(odeme): admin iptali booking_service'e delege edildi` · 4. `fix(odeme): ders baslamadan tamamlama engellendi` · 5. `fix(odeme): ihtilafli ders otomatik serbest birakilmiyor` · 6. `feat(odeme): sarkan HELD taramasi reconciler'a eklendi` · 7. `fix(odeme): kapanis denetimi + mutasyon provasi` — **7 commit** |
| **İP-2** | 1. `test(iade): cok kalemli fikstur + kabul matrisi (KIRMIZI)` · 2. `fix(iade): is_full_return siparis kalemi kumesine bakiyor` · 3. `refactor(iade): telafiler finalize_refund kancasina tasindi` · 4. `fix(iade): kumulatif tavan settle aninda yeniden kirpiliyor` · 5. `fix(iade): dijital kalem cayma istisnasi` · 6. `fix(iade): kapanis denetimi` — **6 commit** |
| **İP-3** | 1. `test(guvenlik): yetki ve KVKK kabul matrisi - gercek HTTP (KIRMIZI)` · 2. `fix(guvenlik): kutuphane mesajlasmasi ACTIVE+iliski kapisi` · 3. `fix(guvenlik): cevap anahtari rol bazli donuyor` · 4. `fix(kvkk): hesap silme tum rollerde calisiyor + TCKN/diploma temizligi` · 5. `fix(guvenlik): ogrenci listesi iliski kapisi + review sahipligi` · 6. `fix(guvenlik): sifre sifirlama auth_version'i tum rollerde iptal ediyor` · 7. `fix(guvenlik): kapanis denetimi + mutasyon provasi` — **7 commit** |
| **İP-4** | 1. `feat(yonetim): sarkan escrow ve olu outbox uclari` · 2. `test(yonetim): admin DOM kabul matrisi (KIRMIZI)` · 3. `fix(yonetim): egitmen onay kuyrugu olu daldan cikarildi` · 4. `feat(yonetim): hata cozme sekmesi` · 5. `fix(yonetim): sessiz hatalar - isError + ErrorState` · 6. `fix(yonetim): yikici aksiyonlara onay diyalogu` · 7. `refactor(yonetim): tek yetki sozlesmesi (fail-closed)` — **7 commit** |
| **İP-5** | 1. `test(vergi): karisik sepet matrahi (KIRMIZI)` · 2. `feat(vergi): tax_rate urun/CSV/form boru hattina baglandi` · 3. `feat(vergi): siparis matrah kirilimi saklaniyor` · 4. `feat(fatura): sunucu tarafi fatura ucu` — **4 commit** |
| **İP-6** | 1. `test(dagitim): gercek HTTP yetki + OTP limit matrisi (KIRMIZI)` · 2. `fix(dagitim): cancel_run soz borcunu isliyor` · 3. `fix(dagitim): mark_delivered acik duragi kapatiyor` · 4. `fix(dagitim): add_stops bolge kontrolu` · 5. `fix(dagitim): dispatch_day atomikligi` · 6. `fix(dagitim): zaman-kritik SMS sessiz saatten muaf` · 7. `feat(saha): cevrimdisi kuyruk + yeniden deneme` — **7 commit** |
| **İP-7** | 1. `test(olcek): probe esik ihlalinde kiriliyor` · 2. `fix(olcek): olu trigram indeksi (EXPLAIN kanitli)` · 3. `perf(olcek): global ortalama TTL onbellegi` · 4. `fix(olcek): tavansiz uclara sayfalama` · 5. `perf(olcek): N+1 duzeltmeleri` — **5 commit** |
| **İP-8** | 1. `test(kalite): yetki kablolama sozlesmesi` · 2. `test(kalite): hijyen nobetcisi para+teslimat tablolari` · 3. `fix(kalite): yalanci yesil assert'ler` · 4. `test(kalite): checkout+saha+bilet DOM testleri` · 5. `test(kalite): mutasyon katalogu genisletildi` — **5 commit** |
| **İP-9** | 1. `fix(uretim): HEALTHCHECK /health/live'a alindi` · 2. `fix(uretim): .dockerignore - tek seferlik scriptler imaja girmiyor` · 3. `feat(guvenlik): hesap bazli brute-force kilidi` · 4. `fix(guvenlik): govde boyutu ve icerik tipi dogrulamasi` · 5. `refactor(guvenlik): crypto KDF + anahtar ayrimi + rotasyon` — **5 commit** |
| **İP-10** | 1. `docs(envanter): mal kabul uygulama plani` · 2. `test(envanter): mal kabul + gorev ayriligi matrisi (KIRMIZI)` · 3. `feat(envanter): GoodsReceipt modeli + migration` · 4. `feat(envanter): RECEIPT hareket turu ve HTTP uclari` · 5. `feat(dagitim): kalem bazli toplama + raf/konum` · 6. `feat(envanter): gorev ayriligi zorlamasi` — **6 commit** |

**Toplam:** ~62 commit.

---

## 14. Önerilen uygulama sırası (10 paket)

| # | Paket | Neden bu sırada | Süre tahmini |
|---|---|---|---|
| **1** | **İP-0 · CI zemini** | Doğrulama mekanizması olmadan hiçbir düzeltme "kanıtlanmış" sayılamaz; ayrıca 114 commit'lik iş tek diskte duruyor | Yarım gün |
| **2** | **İP-3 · Yetki ve kişisel veri** | Üç P0 (operatör DM'i, cevap anahtarı, KVKK silme) burada; ikisi reşit olmayan kullanıcıya dokunuyor. Para bulguları geri alınabilir, sızmış veri geri alınamaz | 2-3 gün |
| **3** | **İP-1 · Pazaryeri para yolu** | Dört P0; pazaryeri kolunun açılmasının önkoşulu | 2-3 gün |
| **4** | **İP-2 · Mağaza iade + TB-3** | İki P0 (kısmi iade, reconciler telafisi); mağaza kolu zaten canlıya en yakın olan | 2-3 gün |
| **5** | **İP-4 · Admin operasyon yüzeyi** | 1-4'ün ürettiği yetenekleri operatöre görünür kılar; P1-1 olmadan eğitmen kabul edilemiyor — yani 3. maddeyi düzeltmek tek başına yetmiyor | 3-4 gün |
| **6** | **İP-9 · Üretim sertleştirme** | Lansman altyapısı; diğerlerinden bağımsız olduğu için buraya konabilir — daha erken de olabilir | 2 gün |
| **7** | **İP-7 · Performans ve ölçek** | Ölü indeks ilk gerçek trafik dalgasında arama ucunu 500'e düşürür; lansmandan önce ama P0'lardan sonra | 1-2 gün |
| **8** | **İP-6 · Teslimat boşlukları** | Operasyonel; mağaza hacmi düşükken tolere edilebilir, ama `mark_delivered` durak kapatmaması ilk haftada karşımıza çıkar | 2-3 gün |
| **9** | **İP-5 · KDV ve fatura** | Yasal zorunluluk ama **dış bağımlılığı var** (entegratör seçimi); kod tarafı hazır beklerken portal üzerinden elle kesilebilir | 2 gün + dış süreç |
| **10** | **İP-8 · Test borcu konsolidasyonu** | Her paket kendi borcunu kapatırsa burada artık kalmaz; kalan artık burada toplanır | 2-3 gün |

**Sonraya bırakılanlar:** İP-10 (mal kabul/F30 — yeni özellik, lansmanı bloklamıyor), İP-11 (ürün kararları — kullanıcı onayı bekliyor).

**Lansman kapısı önerisi:**
- **Mağaza kolu:** 1, 2, 4, 6 tamamlandığında açılabilir (İP-5 elle fatura ile geçici çözülür).
- **Pazaryeri kolu (ders):** 1, 2, 3, 5 tamamlanmadan **açılmamalı**.
- **Kütüphane kolu:** 1, 2 (özellikle P0-7) tamamlanmadan **açılmamalı**.

---

## 15. İlk üç paket için başlangıç promptları

### Paket 1 — İP-0 · CI zemini

```
CI zeminini onar. Bağlam: denetim raporu DENETIM-RAPORU-2026-07-31.md, bulgu P1-3.

İki gerçek sorun var:
1. .github/workflows/ci.yml:77 "pytest -q --ignore=tests/integration" çalıştırıyor.
   pytest.ini'de testpaths=tests ve hiçbir yerde collect_ignore/norecursedirs yok,
   dolayısıyla tests/verify de toplanıyor. tests/verify/conftest.py:43-56'daki
   session-autouse guard POSTGRES_DB != "adana_verify" görünce pytest.exit(returncode=1)
   yapıyor; o adımın env'i POSTGRES_DB=test. Aynı commit (dbef9f1) coverage adımına
   --ignore=tests/verify eklemiş ama 77. satıra eklemeyi atlamış.
2. CI'da Redis ve MinIO service container'ı yok; core/ratelimit, core/token_denylist,
   core/presence, core/courier_position ve tests/verify/test_verify_storage_access.py
   ya fail-open davranıyor ya skip oluyor. Yani dosya erişim sınıfları (private/ vs
   public önek) CI'da hiç doğrulanmıyor.

Yap:
- 77. satıra --ignore=tests/verify ekle.
- postgres'in yanına redis:7 ve minio service container'ı ekle, ilgili env'leri ver.
- Kapsama adımına mevcut orandan başlayan bir --cov-fail-under eşiği koy (önce ölç,
  sonra eşiği o değerin hemen altına yaz; amaç düşüşü yakalamak).

Kural: kod değiştirme, yalnız CI yapılandırması. Değişiklikten sonra hangi adımın
neyi kanıtladığını tek tek yaz. Push etme; commit'i hazırla ve bana göster.
```

### Paket 2 — İP-3 · Yetki ve kişisel veri

```
Yetki ve kişisel veri P0'larını kapat. Bağlam: DENETIM-RAPORU-2026-07-31.md, bulgular
P0-6, P0-7, P0-9, P1-18, P1-19, P1-8.

Bu paket TEST MATRİSİYLE BAŞLAR (kırmızı commit), sonra uygulama gelir. Testler
GERÇEK HTTP katmanında olacak — servis fonksiyonunu doğrudan çağıran test bu
paket için kanıt sayılmaz (rapor §7.2: yetki kapılarının router'a kablolandığı
hiçbir yerde test edilmiyor).

Kapatılacaklar:
1. P0-6: messaging_service.py:129-137 "_can_message" kütüphane içeren her çifti
   açıyor. libraries.py:145-172 "POST /libraries/register" public ve anında geçerli
   LIBRARY_OPERATOR token'ı döndürüyor (kütüphane PENDING). messages.py:129-131
   operatörü telefon doğrulamasından muaf tutuyor — yorumu "operatör admin-oluşturmalı"
   diyor, self-servis onboarding bu varsayımı geçersizleştirmiş.
   → Kütüphane için ACTIVE + gerçek ilişki (bilet/rezervasyon) koşulu koy.
2. P0-7: library_exam_service.py:105-107 cevap anahtarını yalnız results_published_at'e
   bağlıyor, rol kontrolü yok; çıktı GET /exam-sessions/manage ile operatöre liste
   hâlinde dönüyor ve core/private_urls.py middleware'i bağlantıyı imzalayıp çalışır
   hâle getiriyor. Doğru desen aynı projede var: library_exam_catalogs.py:69.
   list_public_sessions:294-314 de aynı yardımcıyı kullanıyor ve kimlik doğrulamasız.
3. P0-9: account_deletion_service.py:91 payout_status'a None atıyor; alan
   mixins.py:133-135'te nullable=False ve Tutor PayoutMixin alıyor → 500. Aynı satırdaki
   "tckn_encrypted" kod tabanında başka hiçbir yerde yok (ölü temizlik); gerçek alan
   TutorEducation.verification_tckn ve hiç silinmiyor, identity_last4 ve diploma
   dosyası da kalıyor. Mevcut dört test de CLIENT ile koşuyor, o yüzden görünmedi.
4. P1-18: clients.py:18-33 "_approved_viewer" yalnız rol soruyor, ilişki aramıyor;
   onaylı her eğitmen tüm öğrenci tabanını (doğum tarihi dahil) sayfalayabiliyor.
5. P1-19: reviews.py:82-88 sahiplik kontrolü yok.
6. P1-8: reset_password/change_password yalnız refresh'leri iptal ediyor; auth_version
   yalnız KURYE'de kontrol ediliyor (deps.py:68). verification_service.py:25-29
   _MODEL_BY_ROLE rol 4-5'i içermiyor → o rollerde şifre sıfırlama sessizce çalışmıyor,
   oysa find_by_email onları buluyor.

Her düzeltme için mutasyon provası yap: guard'ı geçici kaldır, testin gerçekten
kırıldığını göster, geri al. Sürücü: backend/scripts/mutation_drill.py.
Kapanış raporunda "neyin kanıtlandığını" yaz, "kaç test geçti"yi değil.
```

### Paket 3 — İP-1 · Pazaryeri para yolu

```
Pazaryeri para yolu P0'larını kapat. Bağlam: DENETIM-RAPORU-2026-07-31.md,
bulgular P0-1, P0-2, P0-3, P0-4.

Önce kabul matrisi (kırmızı commit), sonra uygulama. Testler gerçek PostgreSQL'de.

1. P0-1: booking_service.py:492 reschedule FSM'i atlayıp status=PENDING yazıyor.
   Süre değişmemişse payment_service.sync_amount_with_booking:95-96 erken dönüyor,
   HELD ödeme korunuyor. Sonra reject (:432) iade çağırmıyor ve REJECTED terminal.
   escrow_reconciler yalnız REFUNDING ve PENDING/FAILED tarıyor (:73-82,168-178),
   HELD'i hiç görmüyor → para kalıcı kilitli, alarm yok.
2. P0-2: admin_service.cancel_booking:397-404 doğrudan status=CANCELLED yazıyor;
   refund yok, FSM kontrolü yok, bildirim yok. COMPLETED (parası RELEASED) ders bile
   iptal edilebiliyor. Doğru yol aynı projede var: booking_service.cancel:609-642
   (claim + refund + bildirim). Admin iptalini ayrı kod yolu olarak bırakma, delege et.
3. P0-3: booking_service.complete:446 zaman kontrolü içermiyor; eğitmen ders
   başlamadan "Tamamla" diyip emaneti boşaltabiliyor. Öğrencinin itiraz kanalı da yok
   (models/report.py:30-32'de BOOKING hedefi yok) — itiraz mekanizması ayrı bir pakete
   (İP-11, ürün kararı) ait; burada yalnız zaman kapısını koy.
4. P0-4: auto_complete_past_bookings:571-580 sorgusunda is_disputed filtresi yok;
   admin ihtilaf bayrağını açmış olsa bile ders tamamlanıp para akıyor.

Ayrıca escrow_reconciler'a "terminal durumdaki booking'te HELD ödeme" taraması ekle —
P0-1 gibi durumlar bir daha sessiz kalmasın.

Kütüphane kolu (aynı paket, istenirse ayrı commit grubu — bkz. P1-20, P1-21, P1-22):
5. library_exam_service.register:474 ve study_reservation_service.reserve:244 kontenjanı
   kilitsiz okuyup karşılaştırıyor. ACTIVE_REGISTRATION_STATUSES=(PAID, ATTENDED) olduğu
   için PENDING_PAYMENT koltuk tutmuyor; pay() ve complete_checkout() kontenjanı hiç
   kontrol etmiyor. Ders tarafı bunu DB'de çözmüş (models/booking.py:103-110 GiST).
   → Kontenjanı DB'ye taşı; eşzamanlı kayıt+ödeme testini asyncio.gather ile yaz.
6. library_service.delete_library:707 yalnız deleted_at damgalıyor; register() kütüphaneyi
   :478'de alıyor ama yalnız komisyon oranı için — deleted_at kontrolü yok. Kardeş yüzey
   doğru yapıyor: study_reservation_service.py:234.
7. admin_service.py:323-326 delete_tutor açık HELD ödeme / ACCEPTED booking / aktif alt
   üye kaydı kontrolü yapmıyor → yetim emanet.

Her düzeltme için mutasyon provası zorunlu. Kabul kriterlerini gerçek DB davranışıyla
doğrula; "test geçti" yerine hangi senaryonun kanıtlandığını yaz.
```

---

## Ek A — Teknik borç doğrulama sonuçları

| Borç | İddia | Sonuç | Kanıt |
|---|---|---|---|
| **TB-2** | Ödeme sağlayıcısı çağrısında ürün kilidi | **GEÇERLİ** — belgedeki tanım birebir doğru | `order_service.py:1354,1846` `_lock_order_products` → HTTP (20 sn timeout) → commit |
| **TB-3** | Reconciler sonrası stok/kupon geri yükleme boşluğu | **GEÇERLİ** — ayrıca `OrderReturn` hedefi için de | `escrow_reconciler.py:100,132`; `escrow.py:250-301`'de restock/kupon referansı yok |
| **TB-4** | Transaction ownership ambiguity | **GEÇERLİ** — aynı callback ucunda dört dal dört farklı sahiplik | `payments.py:179-203`; `escrow.begin_refund:234` istek-ortası commit |
| **TB-5** | `SALE_CANCEL` `ref_type` etiketi | **GEÇERLİ** — migration'sız düzeltilemez | `order_service.py:1294`; tavan sorgusu `stock_ledger.py:385` bu çifte bağımlı |
| **TB-6** | `audit_logs` append-only değil | **GEÇERLİ** — bağımsız doğrulandı | `db_guard.py:141` trigger kapatmadan siliyor, `:146` `stock_movements` için kapatmak zorunda |
| **Mal kabul yok** | — | **GEÇERLİ (hiç yok)** | Tedarikçi/satın alma/irsaliye modeli yok; giriş yalnız `INITIAL` + `ADMIN_ADJUSTMENT('TEDARIK')` |
| **F30 paketleme/konum** | — | **GEÇERLİ** | `delivery_service.py:743` tek boolean; raf/bin kolonu yok; `prepared_by` sabit `"admin"` |
| **Görev ayrılığı zorunlu değil** | — | **GEÇERLİ + belge hatası** | `INVENTORY_REQUIRE_SEPARATE_APPROVER` yalnız docstring'de; `core/config.py`'de tanımlı değil |
| **PK-2 iyzico Pazaryeri** | — | **KOD HAZIR, ENTEGRASYON YOK** | Soyutlama tam (`base.py:73-98`, `payout_service.submit:30`); `iyzico.py:327-340` `success=False`, `supports_marketplace=False` → kollar otomatik kapalı. Eksik olan kod dışı: `SettlementSource` seçimi, Pazaryeri ürün başvurusu, 6493 avukat görüşü. Kısmi iadede `subMerchantPrice` sırası (soru 5) **kısmi iade koduna dokunacak** — İP-2 ile koordine edilmeli |

---

## Ek B — Ekspertiz raporuyla (29 Tem) fark

`docs/ekspertiz-raporu-2026-07.md` §7b "kod tarafında açık P0/P1 kalmadı" diyor. Bu denetim **9 P0 ve 19 P1** buldu. Fark üç sebepten:

1. **Kapsam.** Ekspertiz ağırlıklı olarak para yolunun *iade/release* tarafına, teslimata ve altyapıya bakmış. Bu denetim pazaryeri iş kurallarına, admin arayüzünün *ulaşılabilirliğine* ve KVKK akışına baktı — P1-1 (ölü onay dalı) ve P0-9 (silme 500'ü) tam olarak oralarda.
2. **Zaman.** Ekspertizden sonra F29 envanter paketi (14 commit) girdi; P2-12 (görev ayrılığı belge hatası) o pakette doğdu.
3. **Yöntem.** Ekspertiz belgeye güvenmiş; bu denetim her iddiayı koddan doğruladı. `private_urls.py:16`'daki *"cevap anahtarı operatöre hiç dönmez"* yorumu buna örnek — yorum doğru yazılmış, kod sonradan sapmış, kimse yorumu tekrar okumamış.

**Ortak ders:** Bu kod tabanında hatalar gürültüyle değil sessizce oluyor — ekspertizin kendi kapanış cümlesi de bunu söylüyor. Bu denetimin eklediği nokta: **sessizliğin en verimli saklandığı yer, bir zamanlar doğru olan yorum satırıdır.**
