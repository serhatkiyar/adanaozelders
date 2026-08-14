# İP-16 · Aralıklı Tekrar Sistemi — Sözleşme

Tarih: 2026-08-08 · Dal: `ip16-flashcard` · Taban: `1fa89ba`
Ek tur: **İP-17 vade granülerliği**, 2026-08-13 · Dal
`ip17-vade-granulerligi` · Taban `ed4ff95` — §4.4, §10.2, §11 ve §12.

Bu doküman aralıklı tekrar sisteminin bağlayıcı sözleşmesidir: FSRS-5
algoritma referansı, şema, uç sözleşmesi, kuyruk/limit/gün-sınırı kuralları,
K-6 gizlilik sınırı, kart tipi üretim kuralları ve mutasyon kataloğu. Adı
İP-16'dır çünkü sistem o pakette doğdu; sonraki turlar (İP-17…) aynı yüzeyi
değiştirdikleri için ayrı belge açmak yerine buraya eklenir.

> **Bilimsel iddia beyanı:** Buradaki algoritma, yayımlanmış **FSRS-5**
> referansının (py-fsrs v5.1.3) birebir uygulamasıdır; tüm parametreler o
> kaynaktan gelir. Kendi öğrenme bilimi iddiamız yoktur.

Yeni sistem tamamen bağımsızdır: tablo öneki `srs_`, API öneki `/srs`, sayfa
kökü `/ogren/tekrar`.

> **§0 GÜNCELLEME (13 Ağu 2026) — kapsam dışı bırakılan sistem KALDIRILDI.**
> Bu paket geliştirilirken SM-2 tabanlı eski kelime kartı sistemi
> (`/ogren/kelime-kartlari`, `flashcard_decks`/`flashcards` tabloları,
> `/flashcards` uçları) kapsam dışı tutulmuş ve hiçbir dosyasına
> dokunulmamıştı. O sistem ayrı bir pakette (`sm2-kaldirma` dalı) tamamen
> kaldırıldı: 9 dosya silindi, iki tablo `sm2_flashcard_kaldirma`
> revizyonuyla düşürüldü. **Eski URL'ler için yönlendirme YAZILMADI** —
> `/ogren/kelime-kartlari` ve `/panel/ogren/kelime-kartlari` 404 döner
> (ürün kararı: iki deste / tek kullanıcı / dış link yok; yönlendirme kod
> borcu üretirdi). Bugün platformda **tek** aralıklı tekrar sistemi budur.
> Nöbetçiler: `backend/tests/test_flashcards_kaldirildi.py`,
> `backend/tests/integration/test_flashcards_migration_pg.py`,
> `frontend/src/flashcardsKaldirildi.test.tsx`.
>
> ⚠️ **MERGE NOTU — `frontend/src/test-setup.ts` `matchMedia` stub'ı.**
> Kaldırma paketi, panel sayfalarını jsdom'da render edebilmek için
> `test-setup.ts`'e bir `window.matchMedia` stub'ı ekledi (`themeStore` modül
> seviyesinde çağırdığı için `DashboardShell → DashboardHeader →
> PersonalizeModal` zincirine bağlı her sayfa import aşamasında patlıyordu).
> **Aynı tuzak `ip14-operator-panel` dalında bağımsız olarak bulundu ve orada
> da bir stub eklendi.** O dal main'e girdiğinde bu dosyada çakışma çıkar:
> **ikisini birden tutmayın** — tek stub yeterlidir, mükerrer tanım ikinci
> `Object.defineProperty` çağrısıyla birincisini sessizce ezer ve hangi
> davranışın geçerli olduğu okunamaz hâle gelir. Çakışmayı çözerken tek bir
> stub bırakın ve `matches` varsayılanının hangi temaya çözüldüğünü
> (bu daldaki sürümde `false` = açık tema) koruyun.

---

## 1. FSRS-5 algoritma referansı

Kaynaklar (birincil):

- py-fsrs v5.1.3 (son FSRS-5 sürümü; `main` dalı FSRS-6'dır):
  https://raw.githubusercontent.com/open-spaced-repetition/py-fsrs/v5.1.3/fsrs/fsrs.py
- Resmi algoritma wiki'si:
  https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
- Çapraz doğrulama (ts-fsrs v4.7.1, FSRS-5):
  https://raw.githubusercontent.com/open-spaced-repetition/ts-fsrs/v4.7.1/src/fsrs/default.ts
- Altın test değerleri:
  https://raw.githubusercontent.com/open-spaced-repetition/py-fsrs/v5.1.3/tests/test_basic.py

### 1.1 Parametreler (19 adet, FSRS-5 varsayılanı)

```
w = (0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
     1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
     2.9898, 0.51655, 0.6621)
DECAY  = -0.5
FACTOR = 0.9 ** (1/DECAY) - 1        # = 19/81
desired_retention = 0.9
maximum_interval  = 36500 gün
learning_steps    = (1 dk, 10 dk)
relearning_steps  = (10 dk,)
```

Parametreler **tek yerde** durur: `backend/services/spaced_repetition/params.py`.
Fuzz KAPALIDIR (deterministik zamanlama; py-fsrs `enable_fuzzing=False` eşdeğeri).

### 1.2 Formüller (py-fsrs v5.1.3 birebir)

- Retrievability: `R(t,S) = (1 + FACTOR·t/S)^DECAY`; `t = max(0, elapsed_days)` — **tam gün**, kesirli gün değil. `elapsed_days` motora dışarıdan verilir ve **çalışma günü** farkıdır (`dayboundary.study_day`), takvim farkı DEĞİL — sebebi §2.1 (H3).
- İlk tekrar: `S0(G) = max(w[G-1], 0.1)`; `D0(G) = clamp(w4 − e^(w5·(G−1)) + 1, 1, 10)`.
- Başarılı tekrar: `S′ = S·(1 + e^{w8}·(11−D)·S^{−w9}·(e^{(1−R)·w10}−1)·hard_penalty·easy_bonus)`; `hard_penalty = w15` (yalnız Hard), `easy_bonus = w16` (yalnız Easy).
- Lapse: `S′ = min(w11·D^{−w12}·((S+1)^{w13}−1)·e^{(1−R)·w14},  S/e^{w17·w18})`.
- Aynı gün (elapsed < 1 gün): `S′ = S·e^{w17·(G−3+w18)}` (her rating'de bu formül; Again dahil).
- Zorluk: `ΔD = −w6·(G−3)`; `D′ = D + ΔD·(10−D)/9` (linear damping); `D″ = w7·D0(4) + (1−w7)·D′`; sonra `clamp(D″, 1, 10)`. Mean-reversion hedefi `D0(4)` clamp'li hesaplanır.
- Aralık: `I(S) = (S/FACTOR)·(r_d^{1/DECAY} − 1)`, `I = clamp(round(I), 1, maximum_interval)`; `round` Python banker's rounding. `r_d = 0.9` iken `I(S) = S`.
- Formül seçimi: kartın `S`'si yoksa (hiç tekrar edilmemiş) initial; `elapsed_days < 1` ise same-day; değilse rating=Again → lapse, diğerleri → başarılı tekrar. S/D **her cevapta** güncellenir; adım mantığı yalnız interval'ı belirler (vade damgasını çağıran koyar, §2.1).

### 1.3 Öğrenme/yeniden-öğrenme adım makinesi (py-fsrs birebir)

Durumlar: `NEW → LEARNING → REVIEW ⇄ RELEARNING`.

Learning/Relearning'de rating → adım:

- **Again** → `step = 0`, aralık = `steps[0]`.
- **Hard** → `step==0 ∧ tek adım` → `steps[0]·1.5`; `step==0 ∧ ≥2 adım` → `(steps[0]+steps[1])/2`; diğer adımlarda `steps[step]` (adım ilerlemez).
- **Good** → son adımsa REVIEW'a mezun, aralık = `I(S)` gün; değilse `step += 1`, aralık = `steps[step]`.
- **Easy** → anında REVIEW, aralık = `I(S)`.

REVIEW'da **Again** → RELEARNING (`step = 0`, aralık = `relearning_steps[0]`), `lapses += 1`. RELEARNING bitince (Good son adımda / Easy) REVIEW'a döner.

### 1.4 F-15 referans tablosu

Altın değerler gerçek py-fsrs v5.1.3 ile üretilmiştir (fuzz kapalı):
üretici `backend/tests/data/ip16_fsrs_ref_generator.py`, çıktı
`backend/tests/data/ip16_fsrs_ref.json` — **14 senaryo grubu, 70 adım**
(her adım: rating, state, step, stability, difficulty, interval_days).
Birim testi `tests/unit/test_fsrs_scheduler.py::test_f15_referans_tablosu` bizim
motorumuzu bu dosyadaki TÜM adımlarla karşılaştırır (S/D tolerans 1e-6,
interval birebir).

Çapa değerler (upstream test_basic.py ile birebir doğrulanmış):

| Senaryo | Beklenen |
|---|---|
| `altin_zincir` (G×6, A×2, G×5; due-anında) | interval geçmişi `[0,4,14,44,125,328,0,0,7,16,34,71,142]` |
| `memo_state_upstream` (A,G,G,G,G,G,G; ofsetler 0,0,1,3,8,21,21 — ofset tekrardan sonra) | `round(S)=49`, `round(D,4)=7.0866` |
| `yeni_A/H/G/E` | `S0 = 0.40255 / 1.18385 / 3.173 / 15.69105` |

Diğer gruplar: `hard_zinciri`, `easy_zinciri`, `ardisik_lapse`, `karisik`,
`gec_tekrar` (30/400/1000 gün gecikme), `ayni_gun` (short-term formül),
`memo_state`, `memo_state_final`.

---

## 2. Saf planlayıcı modülü — `backend/services/spaced_repetition/`

Sınır sözleşmesi:

- **DB bilmez, IO yapmaz, `now()` çağırmaz** — zaman/geçen gün her fonksiyona
  parametre olarak enjekte edilir. Modülde `random`, `secrets`, `time`,
  `sqlalchemy`, `fastapi`, `redis`, `httpx`, `requests` import'u ve
  `datetime.now()`/`date.today()` çağrısı YASAKTIR.
  **Nöbetçi gerçekten bu listeyi taşır** (denetçi B4): önceki nöbetçinin yasak
  listesinde `random` YOKTU — sözleşme "random yasaktır, nöbetçisi vardır"
  diyor ama nöbetçi onu aramıyordu. Liste artık tek kaynakta
  (`tests/unit/test_fsrs_scheduler.py::YASAK_MODULLER` / `YASAK_CAGRILAR`) ve
  F-14b düğümü sözleşmenin saydığı her yasağın listede olduğunu ayrıca
  doğrular. Tarama **AST üzerinden** yapılır: metin araması, bu maddeyi yazan
  yorumun kendisini ihlal sanıyordu (kök CLAUDE.md §C).
- Deterministik: aynı girdi → aynı çıktı. Fuzz yok.

### 2.1 Zaman motorda değil, çağıranda (H3 kararı)

Motor **takvim aritmetiği yapmaz**: `datetime`/`timedelta` görmez, `due`
üretmez. Girdisi geçen **çalışma günü** sayısı (`elapsed_days`), çıktısı bir
sonraki aralıktır (`interval_minutes`); vade damgasını çağıran koyar
(`srs_service._gecen_calisma_gunu` + `due_at = now + interval`).

Sebebi ölçülmüş bir hatadır. Motor `(now - last_review).days` kullanıyordu,
kuyruk ise gün sınırını `Europe/Istanbul − 4 saat` ile çözüyordu — **iki ayrı
taban**. Pazartesi 20:00'de cevaplanan bir kart Salı 09:00'da tekrar
cevaplandığında motor "aynı gün" (13 saat < 1 gün) sayıyor ve Pazartesi
23:00'teki cevapla **birebir aynı** `S = 14.077712147375411` üretiyordu; oysa
kuyruk onu ertesi günün kartı olarak gösteriyordu. **"Geçen gün" ölçüsünün
tabanı artık tektir**: `dayboundary.study_day` farkı. F-15 referans tablosu bu
değişiklikten sonra yeniden koşuldu: **sapma yok** (70 adım, 14 senaryo).

✅ **Bu asimetri İP-17'de kapandı** (§4.4). İP-16 sürerken burada bir uyarı
duruyordu: `elapsed_days` çalışma GÜNÜ ölçüyor ama `due_at` AN tutuyordu ve
G-5 karşılaştırması an üzerindendi — iki granülarite bir aradaydı. Artık gün
ölçekli aralıklarda (`state == "REVIEW"`) damga da hedef çalışma gününün
başına konur; karşılaştırma `due_at <= now` olarak KALIR ama iki taraf da
aynı ölçeğe oturur. Intraday öğrenme adımları bilinçli olarak an tabanındadır
ve orada asimetri yoktur (aralık zaten dakika ölçeğinde). Motor her iki
dönemde de asimetrinin dışındaydı (an görmez).

Nöbetçiler: `F-17` (davranış — iki senaryonun ayrıştığı ölçülür),
`test_f17_motorda_takvim_aritmetigi_kalmadi` (AST ile motor sınırı) ve
`S-7` (servisin motora ne verdiği; gerçek PG + HTTP). S-7 bir mutasyon provası
sonucu eklendi: servis tabanını takvim farkına çeviren mutasyon, İP-16'nın 60
entegrasyon testinin hiçbirini kırmıyordu.

Dosyalar:

- `params.py` — §1.1'deki tüm sabitler + `leech_threshold = 8`,
  `default_new_per_day = 20`, `default_reviews_per_day = 200`,
  `ROLLOVER_HOUR = 4`, TZ adı `Europe/Istanbul`.
- `engine.py` — `SrsCardState` (frozen dataclass: state, step, stability,
  difficulty, reps, lapses — `due`/`last_review` **yok**, §2.1) +
  `review(state, rating, *, elapsed_days, …) → ReviewResult(state',
  interval_minutes)` + `preview_intervals(state, *, elapsed_days)` +
  `retrievability(state, *, elapsed_days)`.
- `dayboundary.py` — `study_day(now_utc) → date` (Europe/Istanbul'a çevir,
  4 saat çıkar, tarihi al), `day_start(study_day) → datetime` (o çalışma
  gününün başlangıç anı, UTC), `next_day_start(now_utc)`.
- `queuerules.py` — saf kuyruk/limit kuralları: `effective_limits(deck_chain)`
  (kalıtım: üstten aşağı **min**), sıralama anahtarları, sayaç hesabı.

## 3. Şema

Tüm tablolarda `created_at/updated_at` (TimestampMixin) + `deleted_at`
(SoftDeleteMixin). Sahiplik her yerde `(owner_user_id, owner_role_id)`
çiftidir (ayrı kullanıcı tabloları nedeniyle).

| Tablo | Alanlar (özet) |
|---|---|
| `srs_decks` | owner_user_id, owner_role_id, parent_id FK(srs_decks, SET NULL değil — alt deste sahibiyle aynı, CASCADE yok, soft-delete), name, description, visibility `PRIVATE\|PLATFORM`, new_per_day int NULL, reviews_per_day int NULL (NULL = kalıt/varsayılan), copied_from_id FK(srs_decks) **ON DELETE SET NULL** (yalnız bilgi; bağımlılık YOK) |
| `srs_notes` | deck_id FK, note_type `BASIC\|BASIC_REVERSED\|CLOZE\|TYPE_IN`, front text, back text |
| `srs_cards` | note_id FK, deck_id FK (denorm), template_ord int (BASIC/TYPE_IN: 0; REVERSED: 0=ön→arka, 1=arka→ön; CLOZE: cN−1), UNIQUE(note_id, template_ord) — kart kimliği Anki'deki (note, ordinal) modelidir |
| `srs_progress` | card_id FK, user_id, role_id, state `NEW\|LEARNING\|REVIEW\|RELEARNING`, step int NULL, stability float NULL, difficulty float NULL, due_at tstz NULL, last_review_at tstz NULL, reps int, lapses int, suspended_at tstz NULL, buried_until tstz NULL, is_leech bool, UNIQUE(card_id, user_id, role_id). Satır **tembel** oluşturulur (ilk cevap/suspend/bury'de); satırı olmayan kart NEW sayılır. |
| `srs_review_logs` | progress_id FK, user_id, role_id, rating 1..4, reviewed_at, study_day date, client_token uuid, introduced_new bool, undone_at tstz NULL, prev_* anlık görüntüsü (state, step, stability, difficulty, due_at, last_review_at, reps, lapses, is_leech, suspended_at) — undo + istatistik + idempotency. **UNIQUE(user_id, role_id, client_token)** |
| `srs_deck_assignments` | deck_id FK, client_id FK(clients), assigned_by_tutor_id FK(tutors), UNIQUE(deck_id, client_id) |
| `srs_tags` | owner_user_id, owner_role_id, name; UNIQUE(owner_user_id, owner_role_id, lower(name)) |
| `srs_note_tags` | note_id FK **CASCADE**, tag_id FK **CASCADE**, UNIQUE(note_id, tag_id) |

Index'ler (modele DE yazılır): `ix_srs_cards_deck`, `ix_srs_progress_user_due
(user_id, role_id, due_at)`, `ix_srs_review_logs_user_day (user_id, role_id,
study_day)`, `ix_srs_decks_owner`, kısmi `uq_srs_review_logs_client_token
(user_id, role_id, client_token) WHERE client_token IS NOT NULL`.

Migration: iki revizyon —
`ip16_araliklitekrar` (şema, `down_revision = "ip12_urun_arama_vektoru"`) →
`ip16_srs_izin_kodu_hizalama` (izin katalogu).

**Head çatalı kapatıldı (denetçi B1).** İP-12 bu dal açıldıktan sonra main'e
girdi ve onun `ip12_urun_arama_vektoru` revizyonu da
`ip5_siparis_vergi_kirilimi`'ye bağlıydı; iki kardeş revizyon merge sonrası
ağaçta **iki head** üretiyor ve `alembic upgrade head` "Multiple head
revisions" ile duruyordu. Merge revision üretilmedi — bu revizyonlar hiçbir
ortama uygulanmadığı için geçmiş **doğrusal** tutuldu: İP-16 şeması ip12'nin
üstüne alındı. İP-12'nin migration'ı ve ona bağlı model değişikliği
(`models/store.py` → `products.search_vector` + `ix_products_isbn`) main'den
birebir bu dala alındı; onsuz dalın kendi `alembic upgrade head`'i kırık
kalırdı ve `alembic check` model–şema sapması raporlardı.

**Önceki ölçümün neden anlamsız olduğu:** "bu dalda tek head" doğrulaması dalın
kendi `versions/` ağacında yapılmıştı — orada ip12 zaten yoktu, dolayısıyla
çatal görünemezdi. Ölçüm artık `tests/integration/test_ip16_migration_pg.py`
içinde **main'in versions ağacı + dalın İP-16 revizyonları aynı geçici
dizine** konarak yapılır; fixture ip12'nin gerçekten geldiğini ayrıca assert
eder. Aynı dosya taze bir tek kullanımlık veritabanında
`upgrade head → downgrade -1 ×2 → upgrade head → alembic check` zincirini
koşar (downgrade sonrası `srs_*` tablo sayısı 0, yeniden upgrade'de 8 tablo +
2 izin; check "No new upgrade operations detected").

⚠️ **Bayat ortam tuzağı (denetçi B7 — kapatıldı):** izin kodları geliştirme
sırasında `srs.platform.*` → `srs_platform.*` olarak yeniden adlandırıldı ama
migration **revizyon kimliği değişmemişti**. Alembic aynı revizyonu ikinci kez
koşmaz: yeniden adlandırmadan ÖNCE `ip16_srs_izinleri` uygulanmış bir
veritabanında eski kodlar kalıyor, `upgrade head` **sessizce başarılı** dönüyor
ve admin platform uçları SUPER_ADMIN'e dahi 403 veriyordu (menü öğesi de
gizlendiğinden hata görünmüyordu). İki düzeltme birlikte yapıldı:

1. Revizyon kimliği `ip16_srs_izin_kodu_hizalama` oldu, böylece o
   veritabanlarında migration yeniden koşar.
2. `upgrade` bayat kodların **rol bağlarını güncel koda taşır**, sonra eski
   satırları siler — yalnız kimliği değiştirmek, yeniden koşan migration'ın
   doğru kodu eklerken eskisini bırakmasına yol açardı.

⚠️ **Yeni kimlik neden ikisinden de farklı olmak zorundaydı.** Bu revizyonun
vaktiyle taşıdığı ve terk edilen İKİ kimlik vardır: `ip16_srs_izin_kodlari`
(daha eski) ve `ip16_srs_izinleri`. Düzeltmenin ilk denemesi birincisine geri
döndü; bu yanlıştı. Makinede o damgayı taşıyan veritabanları vardı ve terk
edilmiş bir kimliği **geri diriltmek** onları "zaten head" konumuna sokar,
migration sessizce atlanır — düzeltilmek istenen tuzağın aynısı, ters yönde.
Yeni kimliğin benzersizliği iki ölçümle doğrulandı (varsayılmadı):
`git log --all -S "<kimlik>"` → 0 commit, ve makinedeki tüm
`adana*`/`ceyhandb` veritabanlarının `alembic_version` damgaları → 0 eşleşme.
Bu revizyon bir daha yeniden adlandırılırsa aynı iki ölçüm tekrarlanmalıdır.

Nöbetçiler: `test_B7_BAYAT_IZIN_KODLARI_UPGRADE_ILE_DUZELIR` (bayat kodlu DB
düzelir), `test_B7_ESKI_KIMLIGE_STAMPLI_DB_SESSIZCE_BAYAT_KALMAZ`
(**iki terk edilmiş kimlik için ayrı ayrı** parametrize: damgalı DB ya düzelir
ya GÜRÜLTÜLÜ hata verir; sessiz başarı + bayat kod yasak) ve
`test_B7_YENI_KIMLIK_TERK_EDILMISLERDEN_FARKLI` (yapısal).

**Merge/geliştirme ortamı notu:** kimlik değiştiği için eski kimliklerden
birine damgalanmış tek kullanımlık test veritabanları `alembic upgrade head`'de
"Can't locate revision" verir. Bu bilinçlidir (gürültülü hata > sessiz
bayatlık); o veritabanları düşürülüp yeniden kurulur. Geliştirme
veritabanı (`ceyhandb`, damga `ip12_urun_arama_vektoru`) bu dala hiç maruz
kalmadı.

## 4. Kuyruk, limit, leech, gün sınırı sözleşmesi

### 4.1 Kuyruk kuralları (Anki v3 modeli; kaynak: docs.ankiweb.net + rslib)

- **Sıra (Q-9, deterministik):** (1) vadesi gelmiş intraday learning
  (`due_at` artan, eşitlikte `card_id`), (2) review (`due_at` artan,
  `card_id`), (3) yeni kartlar (`card_id` artan = ekleniş sırası).
  Karışım YOK (yeni kartlar sona) — Anki'nin `BeforeReviews/After/Mix`
  seçeneklerinden sabit **AfterReviews** seçilmiştir (basitlik; sözleşme kararı).
- Learning kartı vadesi gelmemişse ve başka kart yoksa **learn-ahead 20 dk**
  içinde erken gösterilir (Anki varsayılanı).
- **Bury:** `buried_until = bir sonraki çalışma gününün başlangıcı` (04:00 TR).
  Kuyruk `buried_until > now` kartları dışlar; süre geçince kart kendiliğinden
  görünür (ayrı bir unbury job'u YOK — zaman karşılaştırması yeter). Elle
  "gömmeyi geri al" `buried_until = NULL` yapar.
- **Suspend:** `suspended_at` doluysa kart hiçbir kuyruğa ve sayaca girmez;
  yalnız elle unsuspend ile döner.
- **Leech (Q-8):** REVIEW'daki kart Again alıp `lapses` **8**'e ulaşınca
  `is_leech = true` + otomatik **suspend** (Anki manuel varsayılanı; rslib'in
  yeni TagOnly varsayılanı bilinçli SEÇİLMEDİ — küçük havuzda leech'in
  kuyruğu işgal etmesi daha maliyetli). Sonraki eşikler: her `threshold/2 = 4`
  lapse'te bir yeniden tetiklenir (12, 16, …).
- **Sibling bury YOK** (v1 kapsam kararı; ters/cloze kardeşler aynı gün
  gelebilir). P2 olarak kayıtlı.
- **Q-10 kardeş ayırma (denetçi B5):** kardeşler aynı gün gelebilir ama aynı
  oturumda **peş peşe gelmez**. Sıralamanın ilk anahtarı "bu kart, son
  cevaplanan notun kardeşi mi" sorusudur (`_kardes_ayirma`; son cevap
  `srs_review_logs`'un geri alınmamış en son satırından okunur). Ölçülen eski
  davranış: sıra kart id'siyle verildiği için `BASIC_REVERSED` bir notun iki
  kartı bitişik düşüyor, öğrenci cevabı kartın öğrettiğinden değil üç saniye
  önceki ekrandan hatırlıyordu. Başka aday yoksa kardeş yine gelir — kuyruğu
  boşaltmak daha kötü olurdu. Nöbetçi: `Q-10`.

### 4.2 Limitler

- Deste başına `new_per_day` (varsayılan 20) ve `reviews_per_day`
  (varsayılan 200). NULL = üstten kalıt; kökte de NULL ise varsayılan.
- **Kalıtım (L-3):** efektif limit = seçili desteden köke kadar zincirdeki
  tanımlı limitlerin **minimumu**. (Anki v3'ün "seçili desteden başla"
  kuralının tek-kullanıcılı sadeleştirmesi; sözleşme kararı.)
- Sayım çalışma gününe göre: bugün `introduced_new=true ∧ undone_at IS NULL`
  log sayısı yeni-kart limitini; bugünkü toplam geçerli log sayısı
  (intraday learning adımları HARİÇ — yalnız state'i REVIEW/RELEARNING'den
  gelen ve LEARNING'e ilk girişteki cevaplar ayrımı yerine BASİT kural:
  `prev_state ∈ {REVIEW, RELEARNING}` olan loglar) review limitini doldurur.
  Yeni kart tanıtımı ve öğrenme adımları review limitine sayılmaz
  (Anki'den bilinçli sapma — basitlik; sözleşmede sabit).
- Limit dolunca kuyruk **boş döner** (hata değil, L-4). Alt deste kartları üst
  destenin kuyruğunda/sayacında da görünür (D-11); hiyerarşi `parent_id`
  zinciriyle çözülür.

### 4.3 Gün sınırı (K-9)

- `study_day(now) = (now → Europe/Istanbul) − 4 saat` sonucun tarihi.
  03:30 TR → önceki gün, 04:30 TR → yeni gün (G-3).
- **Vade damgasının granülerliği fazın ölçeğini izler (İP-17, §4.4):** gün
  ölçekli aralıklarda (`state == "REVIEW"`; aralık her zaman tam gün × 1440)
  `due_at = day_start(study_day(now) + gün)`, yani hedef çalışma gününün
  başı (04:00 TR). Intraday öğrenme/yeniden-öğrenme adımlarında damga
  `now + interval` olarak kalır.
- Karşılaştırma yine **ana göre** yapılır (`due_at <= now`) — SQL değişmedi:
  kaçırılan günler birikir, kart kaybolmaz (G-4); `due_at` gelecekte ise
  bugünün kuyruğunda yoktur (G-5). Değişen, karşılaştırmanın iki tarafının
  artık aynı ölçekte olmasıdır: gün ölçekli bir kart, ait olduğu çalışma
  gününün İLK anından itibaren kuyrukta görünür. Limit sayaçları `study_day`
  üzerinden döner (L-5).

### 4.4 Vade granülerliği — V matrisi (İP-17)

İP-16 denetiminde P2 olarak kaydedilen "iki granülarite bir arada" borcunu
kapatan tur. **Ürün kararı: Anki yolu** — gün ölçekli aralıklar hedef çalışma
gününün başına yuvarlanır, intraday adımlar dokunulmadan kalır.

#### Kapatılan zarar (İP-16'da ölçülmüş, İP-17'de yeniden ölçüldü)

| Ölçüm | Önce | Sonra |
|---|---|---|
| Pzt 20:00'de verilen 1 günlük aralığın vadesi | Salı **20:00** TR | Salı **04:00** TR |
| Aynı kart Salı 09:00'da kuyrukta mı | **Hayır** | **Evet** |
| Vadeden 2 saat geç cevaplanan 5 tekrarın damga saatleri | `[20, 22, 0, 2, 4]` | `[4, 4, 4, 4, 4]` |
| Aynı zincirde cevap çalışma günü farkları | `[1, 1, 1, 2]` — bir gün atlanmış | `[1, 1, 1, 1]` |

İkinci satır asıl üründür: kart o çalışma gününe aitken akşam saatine
damgalıydı, sabah çalışan öğrenci "bugün tekrarım yok" görüyordu. Dördüncü
satır sinsi olanıdır: damga her turda ileri sürüklendiği için dördüncü
tekrarda 04:00 devrilmesini aşıyor ve kartın bir çalışma günü boyunca
görünür olduğu pencere gecenin 02:00–04:00'üne sıkışıyordu.

#### Uygulama ve ayrım kuralı

Tek yazma noktası `srs_service.answer()`; motor hâlâ takvim görmez (H3).

```
state == "REVIEW"  → due_at = day_start(study_day(now) + gün)
aksi hâlde         → due_at = now + interval_minutes
```

**Ayrım neden `state`, neden `interval_minutes >= 1440` değil.** İkisi bugün
aynı kümeyi seçiyor ve bu ölçüldü: çıkış fazı REVIEW ⟺ aralık tam gün × 1440
(`_next_interval_days` sonucu `[1, MAXIMUM_INTERVAL_DAYS]`'e clamp'li; öğrenme
adımları `(1, 10)` ve `(10,)` dakika, asla ≥1440 olamaz). Ama **eşdeğerlik
rastlantıdır, sözleşme değildir**: öğrenme adımları deste ayarından gelseydi
(Anki'de gelir) "3 günlük" bir learning adımı mümkün olur ve sayısal eşik onu
sessizce yuvarlardı. Faz, kartın hangi ölçekte yaşadığını söyler; dakika
sayısı yalnız o ölçeğin bugünkü değerini. Gerekçe kodun içinde de durur.

#### V matrisi (10 düğüm)

| Kod | İddia | Sınıf |
|---|---|---|
| V-1 | gün ölçekli vade hedef çalışma gününün başına konur | gerçek PG + HTTP |
| V-2 | sabah çalışan öğrenci kartı kuyrukta görür | gerçek PG + HTTP |
| V-3 | 5 ardışık geç tekrarda damga saati kaymaz, gün atlanmaz | gerçek PG + HTTP |
| V-4 | intraday öğrenme/relearning adımları yuvarlanMAZ | gerçek PG + HTTP |
| V-5 | yuvarlama tabanı çalışma günüdür (rollover), takvim/UTC tarihi değil | gerçek PG + HTTP |
| V-6 | motora giden `elapsed_days` değişmedi (S = 12.52798994372677) | gerçek PG + HTTP |
| V-7 | 03:59 kenarı: vade +1 dk sonra, geçmişe düşmez, 04:01'de geri gelir | gerçek PG + HTTP |
| V-8 | eşit vadede sıra `card_id`'ye iner (Q-9 tie-breaker) | gerçek PG + HTTP |
| V-9 | `undo` damgayı yeniden hesaplamaz, öncekini birebir geri yükler | gerçek PG + HTTP |
| V-10 | REVIEW'da saat gösterilmez, intraday adımda gösterilir | gerçek DOM (RTL) |

**V-4 ve V-6 bilinçli olarak YEŞİL başladı** ve bu bir kusur değil, kayıt
altına alınmış bir sınırdır: korudukları davranış zaten doğruydu (biri aşırı
uygulamaya, öteki regresyona karşı nöbetçi), dolayısıyla "bugün kırmızı düşer"
kanıtı yapısal olarak üretilemezdi. Nöbetçilikleri kırmızıyla değil mutasyonla
kanıtlandı (IP17-2 → V-4). Uydurma bir kırmızı üretmek yerine sınır yazıldı.
**V-9 da 3a'dan sonra yazıldı** (undo yolu İP-17 sırasında yeniden incelendi);
kırmızısı açık bir ters provayla gösterildi.

**V-10'un gösterilebilir bir kırmızı anı YOKTUR** (bağımsız denetim düzeltmesi,
14 Ağu 2026). Sözleşmenin önceki hâli "diğer sekiz düğümün kırmızısı üretim
kodundan önce koşularak kanıtlandı" diyordu ve bu **fazla cömertti**: V-10'un
testi (`SrsDueLabel.test.tsx`) ile koruduğu üretim kodu (`lib/srsDue.ts`,
`components/srs/SrsDueLabel.tsx`) **aynı commit'te** doğdu (`43ad59f`), yani
kırmızı faz hiç yaşanmadı. Nöbetçiliği **iki yönlü mutasyonla** kanıtlıdır
(IP17-6 "hep tarih" ve IP17-7 "hep saat" — §10.2) ve bu yeterli bir kanıttır;
eksik olan **süreç kaydıdır**, güvence değil. Kayıt bu yüzden düzeltildi:
kırmızı-önce disiplini frontend düğümünde uygulanmadı.

Kalan **altı backend düğümünün** (V-1, V-2, V-3, V-5, V-7, V-8) kırmızısı
üretim kodundan ÖNCE, ayrı bir commit'te (`c8cd6c7`) koşularak kanıtlandı.
Bunun gerekli olduğu ölçümle biliniyordu: önerilen
yuvarlama geçici uygulandığında **mevcut 67 İP-16 entegrasyon düğümünün
hiçbiri kırılmıyordu** — suite bu davranış üzerinde hiç nöbet tutmuyordu, yani
bozuk kod da düzeltilmiş kod da aynı testleri geçiyordu (kök CLAUDE.md §E).
Bu yüzden tek bir mevcut düğüm yeniden kullanılmadı.

**Bağımsız kâhin:** `test_ip17_vade_pg.py` zaman yardımcılarını (`_TR`,
`_calisma_gunu`, `_gun_basi`) kendisi yazar, `dayboundary`'yi import ETMEZ.
Üretimin yardımcısına yapılan bir mutasyon (TZ'yi UTC'ye çevir, rollover
ofsetini sil) testi de aynı yöne kaydırıp görünmez kılardı.

#### Kabul edilen sonuçlar (kaza değil, karar)

- **03:59 kenarı (V-7).** 03:59 TR'de cevaplanan 1 günlük kart 04:00'te, yani
  bir dakika sonra vadeli olur ve aynı oturumda geri gelir. Anki'nin
  davranışıdır. Vade asla geçmişe düşmez: `gün ≥ 1` ve `now` her zaman
  `[day_start(D), day_start(D+1))` aralığında olduğu için hedef kesinlikle
  ileridedir (1440 dakikalık tarama: **0 ihlal**, en kısa mesafe 1 dk).
- **Sıralama beraberliği (V-8).** Aynı güne yuvarlanan review kartlarının
  damgası birebir eşitlenir; sıra Q-9 tie-breaker'ına (`card_id` artan) düşer,
  yani cevaplama sırası yerine ekleniş sırası olur. Yuvarlamanın kaçınılmaz
  sonucudur ve kabul edilmiştir.
- **Geri doldurma YOK.** Yuvarlamadan önce damgalanmış REVIEW satırları eski
  akşam damgasını bir tekrar boyunca korur, sonra kendiliğinden düzelir.
  Ölçüm: geliştirme kataloğunda etkilenen satır sayısı **1**. Tek satır için
  veri migration'ı yazmanın riski faydasını aşıyor; migration bilinçli olarak
  yazılmadı.
- **Frontend:** yuvarlamadan sonra her review kartının saati aynı ("04:00") ve
  bilgi taşımıyor, bu yüzden `SrsBrowser`'ın iki render noktasında REVIEW için
  yalnız tarih gösterilir; learning/relearning'de saat korunur (V-10). Vade
  DAMGASI gösteren başka yüzey yoktur: `SrsDecks`'teki `due` bir sayaç,
  `SrsStats`'ın `future_load`'u zaten gün kovalıdır, `SrsStudy`/`SrsDeckDetail`
  `due_at`'i hiç render etmez. ⚠️ Bu etiketin **tarayıcı saat dilimine bağlı**
  olduğu merge turunda ölçüldü — §11'deki açık kayda bakınız.

#### İP-16 denetiminin kaçırdığı boşluk: Q-9 tie-breaker'ı nöbetsizdi

İP-17'nin mutasyon provası (IP17-5, `_order_due`'daki `SrsCard.id.asc()`
tersine çevrildi) **26 test seçti ve yalnız 1'ini kırdı: V-8.** Yani İP-16'nın
Q-9 kuyruk sırası testi tie-breaker'ın YÖNÜNÜ hiç korumuyordu. Sebebi ölçüldü:
Q-9 kartlara SQL ile **farklı** `due_at` verdiği için beraberlik hiç oluşmuyor,
`card_id` dalı çalışmıyordu. Sözleşme "eşitlikte card_id" diyordu ama
eşitliğin kendisi test kurulumunda hiç üretilmemişti. Yuvarlamadan sonra
beraberlik normal durum hâline geldi ve dalın tek nöbetçisi V-8'dir.

**Genel ders (bu paketin dışına da geçerli):** "26 test seçildi, 1 kırıldı"
tek başına iyi bir sonuç DEĞİLDİR. Seçilen testlerin kaçının o davranışa
gerçekten dokunduğu ayrı bir sorudur ve mutasyon provası tam olarak bunu
ölçer. Geniş bir seçim, kapsamın geniş olduğunu değil, çoğunun ilgisiz
olduğunu gösteriyor olabilir; sayıya değil **hangi düğümün** kırıldığına
bakılır. Aynı disiplin girdi tarafında zaten var ("seçilen test = 0 →
BAŞARISIZLIK"); bu, çıktı tarafındaki karşılığıdır.

Ayrıca IP17-5 tie-breaker'ı **silmek yerine ters çevirerek** kuruldu: silmek
sırayı Postgres'in insafına bırakır ve provayı flaky yapardı — testin suçu
olmadan "yakalanmadı" diyebilirdi.

## 5. Oturum: idempotency, undo, eşzamanlılık

- **Cevap ucu idempotent (S-1/S-2):** istemci her cevaba `client_token`
  (UUID) üretir. Sunucu İP-1a claim desenini kullanır: log satırı
  `INSERT ... ON CONFLICT (user, role, client_token) DO NOTHING`;
  satır eklenemediyse cevap DAHA ÖNCE işlenmiştir → mevcut sonuç döner,
  ilerleme İKİNCİ KEZ yazılmaz. Progress güncellemesi log insert'iyle aynı
  transaction'dadır (atomik).
- **Yarış:** aynı progress satırına eşzamanlı iki farklı cevap, satır
  kilidiyle serileşir; ikinci cevap `prev_*` görüntüsünü güncel durumdan alır.
  Aynı token'lı iki eşzamanlı istek tek log üretir (unique index).
- **Undo (S-4/S-5):** yalnız kullanıcının **en son** (en büyük id'li,
  `undone_at IS NULL`) log'u geri alınabilir; koşullu UPDATE (claim) ile
  `undone_at` damgalanır ve progress `prev_*` görüntüsünden geri yüklenir.
  En son log zaten undone ise **409** — zincirleme undo yok. Yeni bir cevap
  geldikten sonra ondan öncekiler kalıcıdır.
- Oturum sunucu-durumsuzdur: her cevap anında kalıcıdır; kesinti ilerlemeyi
  kaybettirmez (S-3). Sayaçlar (S-6) her kuyruk çağrısında DB'den hesaplanır.

## 6. Kart tipleri sözleşmesi

Üretim kuralları (not kaydedilirken/güncellenirken senkron):

| note_type | Kart(lar) |
|---|---|
| BASIC | 1 kart (ord 0: front→back) |
| BASIC_REVERSED | 2 kart (ord 0: front→back, ord 1: back→front). Her kartın **ilerlemesi bağımsızdır** (T-2; Anki modeli). |
| CLOZE | `front` içindeki `{{cN::metin}}` / `{{cN::metin::ipucu}}` desenlerinden her **farklı N** için 1 kart (ord N−1). Kart N gösterilirken cN boşlukları `[...]` (ipucu varsa `[ipucu]`), diğer cloze'lar açık metin. Aynı N'in çoklu geçişi aynı kartta birlikte gizlenir. İç içe cloze v1'de DESTEKLENMEZ (doğrulama 422). `back` alanı "ekstra" bilgidir, arka yüzde gösterilir. |
| TYPE_IN | 1 kart (ord 0); cevap `back` alanıyla karşılaştırılır. |

- **T-4 kararı (cloze boşluğu silme):** not güncellenince kart kümesi yeniden
  türetilir; artık var olmayan N'lerin kartları ve ilerlemeleri **soft-delete**
  edilir. Aynı N sonradan geri eklenirse kart ve ilerleme **geri canlanır**
  (soft-delete kaldırılır) — Anki'nin "empty cards elle silinene dek durur"
  yaklaşımının, boş-kart UI'sı olmayan sistemdeki karşılığı. Yeni N'ler NEW
  kart olarak doğar. Not silinirse kartları ve ilerlemeleri soft-delete edilir.
- **T-6 kararı (yazarak cevaplama karşılaştırması):** iki taraf da şu
  normalizasyondan geçer: (1) trim + ardışık boşlukları teke indir,
  (2) Unicode **NFC**, (3) **Türkçe locale-aware küçük harf** (İ→i, I→ı;
  `tr` casefold), (4) noktalama KORUNUR. Eşitlik bu normalize formda aranır.
  (Anki varsayılanı case-duyarlıdır; Türkçe hedef kitle için duyarsızlık +
  doğru İ/ı katlaması bilinçli sapmadır.) Kural seti tek yerde:
  frontend `lib/srsTypeAnswer.ts` + backend eşleniği YOK (karşılaştırma yalnız
  istemcide görsel geri bildirimdir; **puanlamayı kullanıcı verir**, Anki gibi).
- **T-7:** yanlışta karakter-düzeyi diff (LCS): doğru=yeşil `typeGood`,
  yanlış/fazla=kırmızı `typeBad`, eksik=gri `typeMissed` (Anki sınıf modeli).

## 7. Sahiplik, atama, kopya, GİZLİLİK (K-6)

### 7.1 Roller ve yetkiler

- **CLIENT:** kendi destesi CRUD; platform destelerini listeler/kopyalar;
  kendisine atanan desteleri listeler/çalışır/kopyalar; yalnız KENDİ
  ilerlemesi/istatistiği.
- **TUTOR:** kendi destesi CRUD; destesini **aralarında en az bir
  iptal-edilmemiş rezervasyon bulunan** öğrenciye atayabilir/atamayı
  kaldırabilir; atadığı destenin İÇERİĞİNİ yönetir. İlerleme göremez (K-6).
- **ADMIN:** platform destesi CRUD — izin kataloğu üzerinden:
  `srs_platform.view` / `srs_platform.manage` (`core/admin_permissions.py`
  + migration; D-12). Admin hiçbir kullanıcının ilerlemesini GÖREMEZ (D-7 —
  izinli destek yolu AÇILMADI; ihtiyaç doğarsa audit'li ayrı paket).

### 7.2 GİZLİLİK SÖZLEŞMESİ — K-6 (güvenlik sınırı)

**İlerleme verisi** (`srs_progress`, `srs_review_logs`, bunlardan türetilen
her istatistik/sayaç/yüzde) YALNIZ verinin sahibi `(user_id, role_id)`
tarafından okunabilir.

- Hiçbir uç `student_id`/`client_id` parametresiyle başkasının ilerlemesini
  döndürmez; böyle bir parametre hiçbir uçta YOKTUR.
- Deste/kart/istatistik uçlarındaki tüm progress alt-sorguları
  `WHERE user_id = :current ∧ role_id = :current_role` filtresiyle yazılır.
- Eğitmenin görebildiği tek şey: atamanın VARLIĞI (hangi öğrenciye atadığı).
  Öğrencinin çalışıp çalışmadığı, yüzdesi, tutma oranı, kart bazlı durumu —
  hiçbiri hiçbir yanıt gövdesine girmez.
- Nöbetçi testler: D-5 (eğitmen atadığı destenin öğrenci ilerlemesine
  erişemez), D-6 (tüm `/srs` uçlarının yanıt gövdeleri taranır — eğitmen
  token'ıyla hiçbir yanıtta öğrenci progress alanı yoktur), I-4 (istatistik
  yalnız kendi verisi). Mutasyon #16 bu duvarı bilerek deler ve testlerin
  kırıldığı kanıtlanır.

### 7.3 Erişim kuralları (IDOR)

- Sahiplik kontrolü İP-3 deseni: yabancı kaynağa erişim **404** (403 değil;
  varlık sızdırmaz). Öğrenci, atanmamış ve platform-olmayan yabancı desteye
  404 alır (D-4).
- Çalışma/cevap uçları: deste sahibi VEYA atanmış öğrenci VEYA platform
  destesi kopyalanmadan doğrudan çalışılamaz — **karar:** platform destesi
  ve atanan deste DOĞRUDAN çalışılabilir (kopya zorunlu değil; kopya bir
  bağımsızlaşma aracıdır). İlerleme her durumda çalışanın kendi
  `srs_progress` satırlarındadır.

### 7.4 Kopya bağımsızlığı (K-7)

`POST /srs/decks/{id}/copy` (CLIENT; kaynak: platform destesi ya da
kendisine atanmış deste ya da kendi destesi):

- Deste + notlar + kartlar **derin kopyalanır**; yeni sahiplik = öğrenci.
- Kopyaya İLERLEME TAŞINMAZ (kartlar NEW başlar) — v1 kararı; "ilerlemeyle
  kopyala" P2.
- `copied_from_id` yalnız bilgidir; kaynak deste değişse/silinse kopya ve
  ilerlemesi ETKİLENMEZ (D-9/D-10). Alt desteler kopyaya dahildir.

## 8. Uç sözleşmesi (`/api/v1/srs`)

Hepsi `get_current_active_user`; yazma uçlarında kullanıcı bazlı rate-limit
(`user_rate_limit(key="srs", ...)`, `RATE_LIMIT_TASK` sınıfı limit).

| Uç | Kim | Not |
|---|---|---|
| `GET /srs/decks` | C/T | Kendi ağaç + (C) atananlar; kendi due sayaçları |
| `POST /srs/decks` | C/T | parent_id opsiyonel (kendi destesi olmalı) |
| `PATCH /srs/decks/{id}` | sahip | ad/açıklama/limitler/parent |
| `DELETE /srs/decks/{id}` | sahip | soft; alt desteler + notlar dahil |
| `GET /srs/decks/platform` | C/T | ACTIVE platform desteleri |
| `POST /srs/decks/{id}/copy` | C | §7.4 |
| `POST /srs/decks/{id}/assign` | T | gövde `{client_id}`; rezervasyon kapısı |
| `DELETE /srs/decks/{id}/assign/{client_id}` | T | |
| `GET /srs/decks/{id}/assignments` | T (sahip) | yalnız atama varlığı — ilerleme YOK |
| `POST /srs/decks/{id}/notes` | sahip/admin(platform) | kart türetimi senkron |
| `PATCH /srs/notes/{id}` | sahip | kart kümesi yeniden türetilir (§6 T-4) |
| `DELETE /srs/notes/{id}` | sahip | soft (kartlar dahil) |
| `GET /srs/cards` | C/T | tarayıcı: `deck_id, state, tag, q, suspended, page, page_size` — sunucu sayfalama + `total` + `suspended_total`/`leech_total`; kart başına `is_leech`; geçersiz enum → 422 |
| `POST /srs/cards/bulk` | sahip | `{ids, action: suspend/unsuspend/bury/unbury/move_deck/add_tag/remove_tag, ...}` |
| `GET /srs/study/queue?deck_id=` | C/T (erişimli) | sayaçlar + sıradaki kart(lar) + 4 rating aralık önizlemesi |
| `POST /srs/study/answer` | C/T | `{card_id, rating, client_token}`; idempotent (§5) |
| `POST /srs/study/undo` | C/T | son cevap; 409 kuralı (§5) |
| `GET /srs/tags` | C/T | kendi etiketleri |
| `GET /srs/stats?deck_id=` | C/T | YALNIZ kendi verisi (K-6); tutma oranı + 30 günlük yük tahmini + sayımlar |
| `GET/POST/PATCH/DELETE /srs/admin/platform-decks*` | ADMIN | `require_admin_method_permission("srs_platform.view", "srs_platform.manage")`; içerik için `POST /srs/admin/platform-decks/{id}/notes` |

**İzin kodu adlandırma notu:** kod `srs_platform.*` (iki parçalı), `srs.platform.*`
DEĞİL. Sebebi mevcut platform konvansiyonudur: `tests/test_admin_permission_catalog.py`
router kaynağını `[a-z_]+\.[a-z_]+` kalıbıyla tarar; üç parçalı bir kod bu
taramadan **sessizce** kaçar ve "router'ın istediği izin katalogda var mı"
denetimi o uç için hiç çalışmaz. Katalog kalıbını genişletmek yerine kod bu
konvansiyona uyduruldu (denetim zayıflatılmadı).

Cevap yanıtı: `{card_id, state, step, due_at, introduced_new, counts}` —
çalışma ekranı ikinci istek atmadan akar; `introduced_new` günlük yeni-kart
sayacının log'daki karşılığıdır.

**Leech görünürlüğü (denetçi B6).** `is_leech` daha önce **hiçbir yanıt
şemasında yoktu**: kart 8. lapse'te sessizce askıya alınıyor, kullanıcı neden
kaybolduğunu göremiyordu. Kart tarayıcı yanıtı artık kart başına `is_leech`
taşır ve kapsam genelinde `suspended_total` / `leech_total` sayaçlarını döner.
Sayaçlar **uygulanan filtreden bağımsızdır** — `suspended=false` ile bakan
kullanıcıya "askıda 0 kart" demek göstergeyi işe yaramaz kılardı. Ekranda
satır rozeti ("askıda" · "takıldın") ve başlık altında "Askıda N kart · bunlardan
M tanesinde takıldın" şeridi vardır; şeritteki bağlantı askı filtresini açar
(`components/srs/SrsCardFlags.tsx`, RTL testli).

⚠️ K-6 açısından kritik nokta: **alanın olmaması, sınırın sağlam olması demek
değildi.** Önceki tarama `is_leech` için yeşil çıkıyordu çünkü alan hiçbir
yanıtta dönmüyordu. Alan eklendikten SONRA tarama eğitmen **ve admin**
token'ıyla dokuz GET ucunun tamamında yeniden yapıldı (`D-6b`); sayaçların
başkasının satırlarını saymadığı ayrıca ölçülür (mutasyon IP16-31).

## 9. Ekran haritası (frontend)

Rotalar (`lib/routes.ts` PATHS+ROUTES; nav: Öğren hub kartı "Aralıklı Tekrar"):

- `/ogren/tekrar` — deste ağacı + due sayaçları + platform galerisi + kopya.
- `/ogren/tekrar/deste/:id` — deste detay: not ekleme (tip seçici, cloze
  editörü), limit ayarları, (tutor) atama yönetimi.
- `/ogren/tekrar/calis/:deckId` — çalışma: boşluk=çevir, 1/2/3/4=cevap,
  u=undo; dört butonda aralık önizleme; cloze render; yazarak cevap + diff
  (T-7); oturum ilerleme çubuğu (yeni/öğrenme/tekrar kalan); mobil uyumlu.
- `/ogren/tekrar/tarayici` — DataTable, sunucu filtre/sayfalama, toplu işlem.
  Başlık altında "Askıda N kart · bunlardan M tanesinde takıldın" şeridi
  (bağlantı askı filtresini açar); satırda "askıda" ve "takıldın" rozetleri
  (`components/srs/SrsCardFlags.tsx` — RTL testli, §8 leech görünürlüğü).
- `/ogren/tekrar/istatistik` — tutma oranı, gelecek yük, boş durum.

Hata `ErrorState`, boşluk `EmptyState` (ikisi ayrışır). Mevcut tasarım dili;
dark-mode paritesi; sakin düzen (kart enflasyonu yok).

## 10. Mutasyon kataloğu (36 prova) — **36/36 YAKALANDI**

Aşağıdaki ilk tablo paketin kendi turudur (20 prova); §10.1 denetim düzeltme
turunun 16 ek provasını listeler (13'ü denetim bulgularının, 3'ü paralel
`ip16-audit-kapanis` turundan elle alınan nöbetçilerin). Katalogda 35 tanım
vardır; IP16-23 taze veritabanı istediği için elle koşulur (gerekçe aşağıda).

Sürücü: `backend/scripts/mutation_drill_ip16.py` — `scripts/mutation_drill`'in
güvenlik makinesini (bayt yedeği + SHA-256 doğrulamalı geri alma, kirli ağaç
reddi, HEAD/status karşılaştırması) yeniden kullanır. **Ek nöbetçi:** her prova
mutasyondan ÖNCE `--collect-only` ile seçilen test sayısını ölçer; **0 ise
BAŞARISIZLIKTIR** (exit 0'a güvenilmez) — "test zayıf" ile "test hiç koşmadı"
aynı şey değildir.

| # | Mutasyon | Hedef | Seçilen test | Sonuç (kırılan) |
|---|---|---|---|---|
| IP16-1 | Kararlılık artışını kaldır | F-9 | 31 | ✅ 10 |
| IP16-2 | Zorluk 1..10 sınırını kaldır | F-10 | 31 | ✅ 2 |
| IP16-3 | Desired retention'ı yok say | F-12 | 31 | ✅ 1 |
| IP16-4 | Maksimum aralık tavanını kaldır | F-13 | 31 | ✅ 2 |
| IP16-5 | Öğrenme adımlarını atla | Q-1 | 47 | ✅ 18 |
| IP16-6 | Lapse'te relearning'e düşürmeyi kaldır | Q-4 | 47 | ✅ 5 |
| IP16-7 | Bury/suspend filtresini kaldır | Q-6/Q-7 | 16 | ✅ 2 |
| IP16-8 | Leech eşiğini yok say | Q-8 | 16 | ✅ 1 |
| IP16-9 | Günlük limitleri yok say | L-1/L-2 | 16 | ✅ 5 |
| IP16-10 | Alt deste limit kalıtımını kaldır | L-3 | 16 | ✅ 1 |
| IP16-11 | TZ dönüşümünü UTC'ye çevir | G-1/G-3 | 16 | ✅ 1 |
| IP16-12 | Rollover ofsetini kaldır | G-2 | 16 | ✅ 1 |
| IP16-13 | Cevap claim'ini koşulsuzlaştır | S-1 | 6 | ✅ 2 |
| IP16-14 | Undo'yu zincirlenebilir yap | S-5 | 6 | ✅ 1 |
| IP16-15 | Deste sahiplik kontrolünü kaldır | D-4 | 13 | ✅ 2 |
| IP16-16 | **Eğitmene ilerleme aç** | D-5/D-6 | 13 | ✅ 2 |
| IP16-17 | Kopyayı kaynağa bağla | D-9 | 13 | ✅ 3 |
| IP16-18 | Sunucu sayfalamasını istemciye al | B-3 | 14 | ✅ 1 |
| IP16-19 | Ters kart ilerlemesini paylaştır | T-2 | 6 | ✅ 1 |
| IP16-20 | Yazarak cevaplamayı gevşet | T-6 | 13 | ✅ 5 |

Koşu sırasında sürücünün ağaç nöbetçisi bir kez devreye girdi (prova sürerken
`ruff.toml` düzenlenmişti) ve provayı durdurdu — mutasyon sızıntısı olmadan.

### 10.1 Denetim düzeltme turu (16 ek prova)

| # | Mutasyon | Hedef | Seçilen test | Sonuç (kırılan) |
|---|---|---|---|---|
| IP16-21 | ip16 zincirini ip12'den kopar | B1 | 5 | ✅ 5 (suite kurulamadı) |
| IP16-22 | Bayat izin kodu taşıma/silmeyi sök | B7 | 5 | ✅ 1 |
| IP16-23 | Kimliği terk edilmiş bir kimliğe geri dirilt | B7 | 7 | ✅ 2 (elle, taze DB) |
| IP16-24 | Çift katlamanın invariant dalını sök | B2 | 23 | ✅ 4 |
| IP16-25 | Çift katlamanın Türkçe dalını sök | B2 | 23 | ✅ 5 |
| IP16-26 | Motorda geçen günü yok say | H3 | 34 | ✅ 12 |
| IP16-27 | Servis motora takvim farkı versin | H3 | 7 | ✅ 1 |
| IP16-28 | Saf pakete `import random` sız | B4 | 34 | ✅ 2 |
| IP16-29 | Kardeş ayırmayı sök | B5 | 17 | ✅ 1 |
| IP16-30 | `is_leech`'i yanıtta hep false yap | B6 | 15 | ✅ 1 |
| IP16-31 | Askı sayacından K-6 filtresini sök | B6/K-6 | 14 | ✅ 1 |
| IP16-32 | Askı sayacını uygulanan filtreye bağla | B6 | 15 | ✅ 1 |
| IP16-33 | Leech rozetini UI'dan sök | B6 (UI) | 7 | ✅ 1 |
| IP16-34 | Taramaya konmamış yeni GET ucu ekle | D-6c | 15 | ✅ 1 |
| IP16-35 | 04:00 devrilmesini kaldır (`ROLLOVER_HOUR=0`) | K-9 / F-17 | 36 | ✅ 3 |
| IP16-36 | `retrievability` geçen günü yok saysın | F-17 | 36 | ✅ 2 |

Son üçü, paralel `ip16-audit-kapanis` turunda yazılmış nöbetçilerin bu dala
**elle** taşınmış hâlini korur. O dalın H3 çözümü **alınmadı**: orada
`engine.py` `dayboundary`'yi import edip gün farkını kendisi hesaplıyor, bu da
§2'nin saflık kararıyla (motor takvim görmez) çelişirdi.

**IP16-21 ilk koşuda "YAKALANMADI" raporlandı** — sebebi testin zayıflığı
değil, ortak mutasyon sürücüsünün pytest `ERROR` satırlarını (hiç koşamayan
test) saymamasıydı. Bu İP-16'ya özgü değildir, yedi paketin sürücüsünü de
etkiler: ayrı borç kaydı [[TB-29]] (numara iki kez taşındı: TB-24 → TB-27 →
TB-29; TB-27/TB-28'i `magaza-tasarim` daha önce almıştı, bkz.
`docs/teknik-borc.md` numaralandırma notu). İP-16'da yerel olarak gölgelenerek
düzeltilmişti; **İP-17'de ortak sürücüde kapatıldı ve yerel gölge silindi**
(§10.2) — borç kaydı da kapandığı için `teknik-borc.md`'den kaldırıldı, orada
yalnız kapanma notu duruyor. Testin **gövdesinin** de kırıldığı ayrıca ölçülmüştür: kırmızı
fazda (ip12 dalın ağacına alınmadan önce) aynı beş düğüm
`Multiple head revisions` assert'iyle `FAILED` düşmüştü.

**IP16-27 ilk turda YAKALANMADI** (60 seçilen testin hiçbiri kırılmadı) ve kök
CLAUDE.md §D'nin gerektirdiği yol izlendi: mutasyon geri alındı, önce
`S-7` regresyon testi yazıldı (gerçek PG + HTTP; servisin motora verdiği geçen
gün sayısını ölçer), sonra mutasyon tekrar uygulandı ve kırıldığı gösterildi.
Motorun tabanını birim testi koruyordu ama **çağıranın** motora ne verdiğini
kimse ölçmüyordu — motoru düzeltip servisi bozmak sessizce mümkündü.

IP16-23 katalogda değildir: prova, tek kullanımlık test veritabanının TAZE
olmasını ister (eski kimlikli bir DB'de alembic zaten "Can't locate revision"
verir ve prova kendi ölçmek istediği şeyi ölçemez). Elle yapıldı; kırılan iki
düğüm `test_B7_ESKI_KIMLIGE_STAMPLI_DB_SESSIZCE_BAYAT_KALMAZ`
(`[ip16_srs_izin_kodlari]` parametresi — mesajı "upgrade sessizce başarılı
oldu ama bayat kodlar duruyor") ve `test_B7_YENI_KIMLIK_TERK_EDILMISLERDEN_FARKLI`.

**Bulunup KAPATILAN flake (kök CLAUDE.md §I).** Düzeltme turunun son
doğrulamasında `test_ip16_migration_pg.py` iki düğümü tam suite içinde bir kez
kırıldı; izole koşumda ve sonraki turlarda geçti — dört tur ölçüldü, biri
kırık. Hata gövdesi yakalanınca kök neden çıktı:
`asyncpg.InvalidCatalogNameError: database "adana_ip16_migration_test" does
not exist`. Dosyadaki dört düğüm **aynı sabit adlı** tek kullanımlık
veritabanını sırayla kurup düşürüyordu ve bir turda bir düğümün teardown'ı
diğerinin setup'ıyla yarıştı. Düzeltme: ad artık test başına benzersiz
(`adana_ip16_mig_<8 hex>_test`), alembic alt sürecine `db=` ile taşınıyor.
Düzeltme sonrası üç tam tur art arda yeşil. Bunu "bilinen flake" diye
geçiştirmek, aynı kılıkta gerçek bir migration regresyonunu gizlerdi.

**Mutasyon provalarının veritabanında iz bırakması.** Sürücü çalışma ağacını
bayt bayt geri alır ama **veritabanını geri almaz**. IP16-23 provası
`adana_ip16_test`'i mutasyonlu kimliğe damgalı bıraktı ve sonraki koşu
"Can't locate revision" verdi. Bu, sistemin tasarlandığı gibi davranmasıdır
(gürültülü hata), ama prova sonrası test veritabanının düşürülmesi gerektiği
akılda tutulmalıdır — özellikle migration kimliğine dokunan provalarda.

### 10.2 İP-17 vade granülerliği (7 ek prova) — **7/7 YAKALANDI**

Katalog aynı modülde (`scripts/mutation_drill_ip16.py`) yaşar: sürücü makinesi
(0-test nöbetçisi, bayt yedeği, SHA-256 geri alma) oradadır ve İP-17 aynı
yüzeyi bozar. Üçüncü bir SRS paketi gelirse modül `mutation_drill_srs.py`
olarak yeniden adlandırılmalıdır.

| No | Mutasyon | Seçilen test | Kırılan |
|---|---|---|---|
| IP17-1 | yuvarlama tamamen söküldü (an tabanlı damgaya dönüş) | 9 | 7 (V-1,2,3,5,7,8,9) |
| IP17-2 | faz ayrımı söküldü — intraday adımlar da yuvarlanıyor | 9 | 1 (**V-4**) |
| IP17-3 | yuvarlama tabanı çalışma günü yerine UTC takvim tarihi | 9 | 2 (V-5, V-7) |
| IP17-4 | `day_start` → `next_day_start` (gün başı ama BİR GÜN İLERİ) | 9 | 7 |
| IP17-5 | eşit vadede tie-breaker TERS çevrildi | 26 | 1 (**V-8**) |
| IP17-6 | frontend: state ayrımı söküldü (learning'de de saat gizli) | 5 | 2 |
| IP17-7 | frontend: TERS YÖN — REVIEW'da da saat gösteriliyor | 5 | 1 |

İki prova bilinçli olarak "yeterlilik" değil **ayırt edicilik** ölçer:

- **IP17-4** çıktısı tastamam bir gün başıdır (04:00 TR), yalnız bir gün
  ileridedir. "Damga gün başına düştü mü?" diye bakan gevşek bir matris bunu
  kaçırırdı; V-1 beklenen GÜNÜ karşılaştırdığı için kırıldı. Yuvarlanmış olmak
  yetmez, doğru güne yuvarlanmış olmak gerekir.
- **IP17-6 ↔ IP17-7** birbirinin tersidir. Tek yön koşulsaydı V-10'un yalnız
  bir yönde nöbet tuttuğu görülmezdi: IP17-6'yı yalnız "LEARNING/RELEARNING'de
  saat var" düğümleri, IP17-7'yi yalnız "REVIEW'da saat yok" düğümü kırıyor.

**Ortak sürücü değişti ([[TB-29]] kapandı).** `mutation_drill.py::_kirilanlar`
artık `FAILED` satırlarının yanında `ERROR …::düğüm` satırlarını da toplar ve
onları "(KURULUM HATASI — test hiç koşmadı)" etiketiyle ayrı gösterir; İP-16'nın
yerel gölgesi silindi. ⚠️ **Bu, yedi paketin ölçüm aracını değiştirir**: eski bir
kapanış raporundaki "YAKALANMADI" satırı, kurulum hatası yüzünden öyle
görünüyor olabilir — tarihine bakarak okunmalıdır. Uçtan uca doğrulama, kaydın
kendi ölçüm vakası `IP16-21` ile yapıldı: eskiden "YAKALANMADI", şimdi
"YAKALANDI (7 test kırıldı)", yedisi de KURULUM HATASI etiketli.

**Değişikliğin bedeli İP-18 merge'inde çıktı ve ödendi.** İP-18 kendi
sürücüsünü, ortak fonksiyon henüz `ERROR` saymazken yazmıştı ve (İP-16'nın o
günkü deseniyle) üst fonksiyonu gölgeliyordu. Merge'den sonra üst fonksiyon
`ERROR …::düğüm` satırlarını zaten döndürdüğü için gölge onları **ikinci kez**
ekliyordu — ölçüldü: bir `FAILED` + bir `ERROR` içeren çıktıda ortak sürücü 2,
gölge **3** satır veriyordu, yani aynı düğüm iki kez sayılıyordu. "Kırılan test
sayısı" kapanış raporlarına giren bir ölçüdür; şişmesine izin verilmez. Gölge
silindi, `mutation_drill_ip18` de ortak fonksiyonu doğrudan kullanıyor ve üç
sürücü artık aynı girdiye aynı yanıtı veriyor. Ayrıca modülün "TB-29 bu dalda
AÇIK" diyen docstring'i bayatlamıştı, düzeltildi. Ders: **ortak bir ölçüm
aracını düzeltmek, o aracı gölgeleyen paketleri de gözden geçirmeyi
gerektirir** — düzeltme onların varsayımını geçersiz kılar.

## 11. Kalan P2'ler (bilinçli kapsam dışı)

- ~~Vade damgası AN tabanında, elapsed ise ÇALIŞMA GÜNÜ tabanında~~ →
  **KAPANDI (İP-17, §4.4).** Damga artık gün ölçekli aralıklarda hedef çalışma
  gününün başına yuvarlanıyor; karşılaştırma `due_at <= now` olarak kaldı ama
  iki taraf aynı ölçeğe oturdu. Kaydın "aynı anda gözden geçirilmeli" dediği üç
  yüzey de ölçüldü: kuyruk sıralaması (beraberlik artık normal — V-8 ve §4.4'ün
  Q-9 boşluğu notu), learn-ahead penceresi (yalnız LEARNING/RELEARNING'e
  bakar, gün ölçekli vadeye dokunmaz) ve `future_load` (zaten
  `study_day(due_at)` ile kovalıyordu, yuvarlamayla tam tutarlı hâle geldi).
- **Vade etiketi tarayıcı saat dilimine bağlı — yuvarlama bunu KÖTÜLEŞTİRDİ
  (P2, İP-14 merge turunda ölçüldü).** `lib/srsDue.ts` `formatDate`/
  `formatDateTime` kullanır; ikisi de `Intl` çağrısını `timeZone` VERMEDEN
  yapar, yani tarayıcının yerel saat dilimine göre biçimlendirir. İP-17'den
  sonra her REVIEW vadesi 04:00 TR = **01:00 UTC**'de, yani UTC gün sınırının
  bir saat ötesinde duruyor. Ölçüm (aynı damga, `2026-08-11T01:00:00Z`):

  | Tarayıcı saat dilimi | Gösterilen tarih |
  |---|---|
  | Europe/Istanbul · UTC · Europe/London | 11 Ağustos 2026 ✅ |
  | America/Sao_Paulo · America/New_York · America/Los_Angeles · Pacific/Honolulu | **10 Ağustos 2026** ❌ |

  Yuvarlamadan önce de biçimlendirici yerel saat dilimindeydi, ama vadeler gün
  içine yayıldığı için hata **bazen** oluşuyordu; artık bütün review vadeleri
  UTC gün sınırına yapıştığı için UTC−2'nin batısındaki her cihazda **her
  zaman** bir gün geri gösteriliyor. Kart doğru çalışma gününde kuyruğa girer
  (sunucu tarafı doğru), yalnız ETİKET yanlıştır.

  **V-10 bunu yakalamıyor.** Düğüm literal "04:00" yerine saat DESENİ arıyor;
  gerekçe (literal beklemek testi koşan makinenin saat dilimine bağlar ve CI'da
  yalancı kırmızı üretir) **V-10'un kendi iddiası için doğrudur** — o düğüm
  "REVIEW'da saat gösterilmez"i ölçüyor ve bunu saat diliminden bağımsız
  ölçmesi doğru tasarımdır.

  ⚠️ Ama bu gerekçe **buradaki boşluğu örtmez** (bağımsız denetim ayrımı,
  14 Ağu 2026): saat dilimini SABİTLEYEN ayrı bir düğüm pekâlâ yazılabilirdi.
  `TZ`'i açıkça `America/New_York`'a çivileyip "11 Ağustos" beklemek testi
  makineye BAĞLAMAZ, tersine makineden KURTARIR — hangi makinede koşarsa
  koşsun aynı sonucu verir. Yani doğru kayıt "yazılamazdı" değil,
  **"yazılmadı"**dır. Bir sonraki turda kapatılmalıdır ve iki düğüm birlikte
  durmalıdır: biri saat diliminden bağımsız (V-10, mevcut), öteki saat dilimini
  sabitleyip TARİHİN doğruluğunu ölçen yeni düğüm.

  Bugünkü ürün etkisi düşük (kullanıcılar Adana'da, tarayıcıları TR); lansman
  engeli değildir. Düzeltmenin şekli belli: main aynı hata sınıfını İP-14'te
  operatör yüzeyleri için `datetime.ts::formatIstanbulTime` ile kapattı
  ("tz'i UTC olan bir cihazda 14:00'lık rezervasyon 11:00 görünürse operatör
  kapıda yanlış saati söyler") — SRS etiketi de aynı desene geçmeli, yanına
  saat dilimini sabitleyen bir V-10 düğümü eklenmelidir. Bu, [[TB-33]]'ün
  ("üç ayrı gün sınırı kavramı, dört üreticide") öngördüğü riskin ölçülmüş
  bir örneğidir; birleştirme turunda o kayıtla birlikte ele alınmalıdır.
- Sibling bury (ters/cloze kardeş **gömme**) — §4.1. Denetim turunda kapsam
  daraldı: kardeşlerin aynı oturumda peş peşe gelmesi Q-10 ile çözüldü; kalan
  P2 yalnız "kardeşi ertesi güne ötele" davranışıdır.
- "İlerlemeyle kopyala" seçeneği — §7.4.
- FSRS parametre optimizasyonu (kişisel eğitim) ve FSRS-6 geçişi.
- Medya, .apkg içe/dışa aktarma, senkron protokolü, filtreli deste — v2
  (görev tanımında kapsam dışı).
- Kuyrukta yeni/review karışım seçenekleri (sabit AfterReviews) — §4.1.
- **B-6 iki katmanlı ve İKİ KATMAN DA tek başına nöbette değil** (denetçi B3):
  geçersiz filtre değeri hem Pydantic şemasında hem `browse_cards` içinde 422
  üretir. Katmanlardan **hangisini sökerseniz sökün** test kırılmaz; yalnız
  ikisi birden sökülünce kırılır (`deck_id="abc"` dışında, o gerçekten tipli
  query parametresine bağlıdır). Yani davranış sözleşmesi korunuyor ama
  "servis katmanı doğrulaması var" iddiasının bağımsız kanıtı YOK. Katman
  ayrımı istenirse iki ayrı düğüm gerekir: (a) şema devre dışıyken servis 422
  veriyor mu, (b) servis kontrolü yokken şema 422 veriyor mu. Sözleşmenin
  önceki hâli yalnız şema katmanı için "nöbetçilik zayıf" diyordu; ölçüm
  simetriktir.
- **Gerçek tarayıcı kabulü yapılmadı**: frontend Vitest + `tsc` + lint ile
  doğrulandı; klavye kısayolları, cloze/diff render'ı, mobil yerleşim ve
  dark-mode paritesi gerçek tarayıcıda sınanmadı (kök CLAUDE.md §F). Tasarım
  denetimi kod okuması + üretim CSS'inde sınıf sırası ölçümüyle yapıldı.
  Düzeltme turunda eklenen leech göstergeleri **jsdom + RTL** ile sınandı
  (`SrsCardFlags.test.tsx`, 7 düğüm) — gerçek tarayıcı değil, ama "tip geçti"
  seviyesinin üstünde: DOM'da rozetin varlığı, açıklaması ve filtre
  bağlantısının tıklaması ölçülür.
- **Öğrenci atama typeahead'i 100 rezervasyonla sınırlı**: aday kümesi
  eğitmenin kendi rezervasyonlarından üretilir (`GET /bookings?limit=100`);
  `/clients/search` eğitmene kapalıdır (`users.view` ister). 100'den fazla
  rezervasyonu olan eğitmende çok eski bir öğrenci listede çıkmayabilir —
  kalıcı çözüm eğitmene açık bir "öğrencilerim" ucudur.
- **Frontend ekranlarının kendi test kapsamı dar**: saf yardımcılar
  (`srsTypeAnswer`, `srsCloze`) Vitest'li; RTL davranış testi yalnız
  `SrsCardFlags`/`SrsSuspendedSummary` için var. `SrsStudy`, `SrsBrowser`,
  `SrsDecks`, `SrsDeckDetail`, `SrsStats` sayfaları hâlâ tip denetimi ve
  derleme ile sınırlı güvence altındadır.

## 12. Doğrulama kapıları

`POSTGRES_DB=adana_ip16_test` (adında "test" — db_guard). Komşu paketler:
ip1a=63, ip3=115, ip2a=49, integration=1222+yeni, acceptance=197, ruff,
vitest/tsc/lint (uyarı artmaz). S-1/S-2 5'er tur.

**Denetim düzeltme turunun kapıları** (9 Ağu 2026):

| Kapı | Sonuç |
|---|---|
| `pytest tests/integration` (tam) | **1266 passed · 0 failed · 16 skipped** (taban 1253/1/16; +13 yeni düğüm, bilinen F30 flake'i bu turda geçti) |
| `pytest tests/verify` (CI deseni: önce `alembic upgrade head`) | **132 passed** (tabanla birebir). DB **taze kuruldu** — zincir boş veritabanında `ip5 → ip12 → ip16_araliklitekrar → ip16_srs_izin_kodu_hizalama` sırasıyla koştu |
| `pytest tests/unit/test_fsrs_scheduler.py` | **36 passed** (F-15'in 70 adımı dahil, sapma yok) |
| `pytest tests/integration -k ip16` — **tekrarlanabilirlik** | 3 tam tur art arda yeşil (flake düzeltmesinden sonra; öncesinde 4 turda 1 kırık) |
| `ruff check backend/` | temiz |
| frontend `tsc -b` + `vitest run` | temiz · **791 passed** (77 dosya) |

**İP-17 vade granülerliği turunun kapıları.** Aşağıdaki tablo **İP-18 merge'i
sonrasına** aittir (merge `3350433`, main tabanı `30a1270`; ondan önce İP-14
merge'i `9374157`). Her iki merge'de de **kod çatışması çıkmadı** — İP-14
operatör paneli ve İP-18 sipariş/ödeme, İP-17 SRS ile ayrı dosya alanlarında;
`docs/teknik-borc.md` iki turda da metinsel olarak temiz birleşti (main'in
TB-35…TB-43'ü ile İP-17'nin TB-29 silmesi + kapanma notu yan yana durdu).
Tek kullanımlık DB: `adana_ip17_ip18_test` (+ `adana_verify`).

| Kapı | Sonuç | main tabanı |
|---|---|---|
| `pytest tests/integration` (tam) | **1323 passed · 0 failed · 16 skipped** | 1314 / 16 → +9 V düğümü |
| `pytest tests -q --ignore=integration --ignore=verify` (DB'siz) | **946 passed** | 946 (değişmedi — V matrisi tümüyle entegrasyonda) |
| `pytest tests/verify` (CI deseni: taze DB + `alembic upgrade head`) | **132 passed** | 132 |
| `pytest tests/acceptance` | **197 passed** | 197 |
| `pytest tests/unit` | **36 passed** | 36 |
| `pytest tests/integration -k "ip16 or ip17"` | **76 passed** — 67 İP-16 düğümünün hiçbiri kırılmadı | — |
| `-k ip18` (komşu paket) | **22 passed** | — |
| `-k ip14` (komşu paket) | **7 passed** | — |
| `pytest tests/unit/test_fsrs_scheduler.py -k f15` | **15 passed** — F-15 referans tablosunda **sapma YOK** (14 senaryo, 70 adım). Beklenen: motor değişmedi, damga çağırandadır | — |
| `alembic heads` | tek head: `ip16_srs_izin_kodu_hizalama` (İP-14 de İP-18 de migration getirmedi) | — |
| İP-17 mutasyon provası (`IP17-1..7`) | **7/7 yakalandı**, iki merge öncesiyle de birebir aynı (§10.2) | — |
| `IP16-21` — TB-29 regresyon vakası | YAKALANDI (7), hepsi "KURULUM HATASI" etiketli | — |
| `mutation_drill_ip18 IP18-1` (değiştirilen sürücünün dumanı) | yeşil taban EVET · **YAKALANDI (6)** | — |
| `ruff check backend/` | temiz | temiz |
| frontend `tsc -b` · `eslint src` · `vitest run` | temiz · 0 error / 34 warning (**taban değişmedi**, yeni dosyalarda 0) · **890 passed / 85 dosya** | 885 / 84 → +5 düğüm, +1 dosya (V-10) |

⚠️ **Ölçüm hijyeni uyarısı (bu turda yaşandı).** Entegrasyon suite'i bir kez
yanlışlıkla **aynı veritabanına karşı iki kez birden** koşuldu (biri arka
planda sürerken ikincisi başlatıldı). İki koşum da kırık verdi ama **farklı**
testlerde — hepsi stok/kilit/eşzamanlılık düğümleri (`test_stock_writers_pg`,
`test_inventory_lock_order_pg`, `test_ip2a_restock_pg`, `test_ip2b_cancel_*`).
Tek başına koşulduğunda **1309/0** çıktı. Çarpışan koşumun çıktısı gerçek bir
regresyon gibi okunabilirdi; `tests/integration` **tek seferde bir koşum**
kuralı, tek kullanımlık DB kuralı kadar bağlayıcıdır.

⚠️ Frontend tam suite'i **yük altında** bir kez `PackageLabel` timeout'u verdi
(arka planda 1266 testlik entegrasyon koşarken); izole ve boştaki makinede
geçti. Bu İP-16 değil, kayıtlı [[TB-23]] (Vitest 5000 ms bütçesi) — yeni bir
bulgu değil, doğrulaması.

### 12.1 İP-16 test yüzeyi — SAYI DEĞİL, SAYMA KOMUTU

Bu bölüm bilinçli olarak sabit sayı vermez. Sebep: aynı yüzey üç turda üç
farklı biçimde sayıldı (**104** · **68 düğüm / 87 fonksiyon** · **74 / 82 /
98**) ve hiçbiri yanlış değildi — farklı şeyler sayılıyordu (matris düğümü mü,
test fonksiyonu mu, parametrize genişlemesi dahil pytest düğümü mü). Sayı
yazmak tartışmayı bitirmiyor; **sayma kuralı** bitirir.

Sonraki denetçi aşağıdaki komutları `backend/` içinden koşar ve kendi sayısını
üretir. Sayılar bu belgede güncel tutulmaz; kaynağı komuttur.

#### Dosya seçme kuralı — İÇERİKTEN, dosya adından DEĞİL

Komutların ilk hâli dosyaları `tests/integration/test_ip16_*.py` glob'uyla
seçiyordu ve **İP-17 gelir gelmez bozuldu**: `test_ip17_vade_pg.py` sayıma
girmiyordu, yani yüzey büyümüşken sayı sabit kalıyor ve bu hiçbir yerde hata
vermiyordu. `test_ip1[6-9]_*` gibi bir düzeltme aynı kusurun ertelenmiş
hâlidir — o da bir paket-numarası bağımlılığıdır ve İP-20'de tekrar kırılır.

**Kural: SRS testi, kaynağında SRS yüzeyine değen bir iz taşıyan test
dosyasıdır** — saf planlayıcı modülü (`spaced_repetition`), servis
(`srs_service`), HTTP yüzeyi (`/api/v1/srs`) veya şema adları (`srs_*`,
`SrsCard`/`SrsProgress`/`SrsDeck`). Kural paket numarası bilmez; yeni bir
paket dosyasını nasıl adlandırırsa adlandırsın, o dosya SRS'e dokunuyorsa
sayıma girer, dokunmuyorsa girmez.

Ölçüldü (İP-17): kural `tests/` altındaki **216** test dosyasını tarayıp
**8**'ini seçiyor — altı İP-16 entegrasyon dosyası, `test_ip17_vade_pg.py` ve
`tests/unit/test_fsrs_scheduler.py`. `test_ip16_migration_pg.py` yalnız `srs_*`
tablo/revizyon izleriyle yakalanır (HTTP çağırmaz), bu yüzden desende şema
adları da vardır.

Komutlar `backend/` içinden, **Git Bash**'te koşulur ve bu makinede koşularak
doğrulanmıştır. Seçici bir kabuk değişkenidir; yardımcı dosya YAZILMAZ (ilk
taslak `/tmp`'ye bir modül yazıyordu — Git Bash'in `/tmp`'si Windows Python'ın
`sys.path`'inde görünmediği için komut belgede doğru, makinede kırıktı).

```bash
# (0) Ortak seçici — aşağıdaki komutların hepsi bunu kullanır.
SEC='import pathlib,re,ast
D=re.compile(r"spaced_repetition|srs_service|/api/v1/srs|srs_[a-z_]+|SrsCard|SrsProgress|SrsDeck",re.I)
F=sorted(f for f in pathlib.Path("tests").rglob("test_*.py") if D.search(f.read_text(encoding="utf-8")))'

# (1) Test fonksiyonu — AST ile, parametrize genişlemesi HARİÇ.
#     `grep "def test"` KULLANILMAZ: yorum ve iç fonksiyon yanlış sayar.
python -c "$SEC
t=0
for f in F:
    n=[x for x in ast.parse(f.read_text(encoding='utf-8')).body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef)) and x.name.startswith('test')]
    t+=len(n)
    print(f'{len(n):4d}  {f}')
print(f'toplam {t} fonksiyon / {len(F)} dosya')"

# (2) Ayrı matris düğümü kodu (F-*/Q-*/L-*/G-*/S-*/D-*/T-*/E-*/B-*/I-*/V-*).
#     Aynı düğümün birden çok testi varsa TEK sayılır.
#     DİKKAT: yalnız BACKEND'i sayar. Frontend düğümleri (ör. V-10) vitest
#     dosyalarında yaşar ve adlarında kod taşımaz — sözleşmeden okunur.
python -c "$SEC
kod=set()
for f in F:
    for x in ast.parse(f.read_text(encoding='utf-8')).body:
        if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef)):
            m=re.match(r'test_([a-zA-Z]\d+[a-zA-Z]?)_',x.name)
            if m: kod.add(m.group(1).upper())
print(len(kod),sorted(kod))"

# (3) Koşulan pytest düğümü (parametrize DAHİL) — gerçek koşu sayısı.
YOLLAR=$(python -c "$SEC
print(' '.join(str(f).replace(chr(92),'/') for f in F))")
python -m pytest $YOLLAR --collect-only -q | tail -1

# (4) Frontend (frontend/ içinden)
npx vitest list src/lib/srsTypeAnswer.test.ts src/lib/srsCloze.test.ts src/components/srs | grep -c " > "

# (5) Mutasyon provası tanımı
python -m scripts.mutation_drill_ip16 --list | wc -l   # + katalog dışı elle provalar
```

İP-17 turunda (İP-18 merge'i sonrası) bu komutların verdiği sayılar — denetçi
kendi sayısını üretmeli, buradakiler yalnız kuralın çalıştığını gösterir:
(1) **95 fonksiyon / 8 dosya**, (2) **84 kod**, (3) **112 pytest düğümü**,
(4) **40 vitest düğümü**, (5) **42 mutasyon** (İP-16 + İP-17 katalogu;
`mutation_drill_ip18 --list` ayrıca 11).

Kuralın işe yaradığı **iki merge'de** ölçüldü: İP-14 bir test dosyası, İP-18
iki test dosyası daha ekledi (taranan dosya sayısı 216 → 217 → **219**);
hiçbiri SRS'e dokunmadığı için seçim her seferinde **8'de kaldı** ve yukarıdaki
beş sayının hiçbiri değişmedi. Dosya adı glob'u olsaydı bu kontrol hiç
yapılamazdı — yüzey büyürken sayı sessizce sabit kalır, sabit kalması gerektiği
durumla ayırt edilemezdi.

Sınıflandırma (kök CLAUDE.md §H) — hangi dosyanın hangi sınıfa girdiği:

| Sınıf | Kaynak |
|---|---|
| Gerçek PostgreSQL + gerçek HTTP | `tests/integration/test_ip16_*.py` (tümü) |
| Saf birim (DB'siz, IO'suz) | `tests/unit/test_fsrs_scheduler.py` |
| AST/kaynak sözleşmesi (DÜŞÜK GÜÇLÜ) | `F-14`, `F-14b`, `test_f17_motorda_takvim_aritmetigi_kalmadi`, `test_B7_YENI_KIMLIK_TERK_EDILMISLERDEN_FARKLI` — dördünün de yanında bir davranış testi vardır |
| Yapısal/şema sözleşmesi (DB'siz ama gerçek OpenAPI) | `D-6c` — tarama listesinin router'la aynı kümeyi kapsadığını ölçer; yanında D-6/D-6b davranış taraması durur |
| Gerçek DOM (jsdom + RTL) | `frontend/src/components/srs/SrsCardFlags.test.tsx` · `SrsDueLabel.test.tsx` (V-10) |
| Gerçek tarayıcı / E2E | **yok** (§11) |
| Gerçek baskı/dosya çıktısı | **yok** (bu pakette baskı yüzeyi yok) |
