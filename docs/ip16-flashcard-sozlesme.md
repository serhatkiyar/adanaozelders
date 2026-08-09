# İP-16 · Aralıklı Tekrar Sistemi — Sözleşme

Tarih: 2026-08-08 · Dal: `ip16-flashcard` · Taban: `1fa89ba`

Bu doküman İP-16 paketinin bağlayıcı sözleşmesidir: FSRS-5 algoritma
referansı, şema, uç sözleşmesi, kuyruk/limit/gün-sınırı kuralları, K-6
gizlilik sınırı, kart tipi üretim kuralları ve mutasyon kataloğu.

> **Bilimsel iddia beyanı:** Buradaki algoritma, yayımlanmış **FSRS-5**
> referansının (py-fsrs v5.1.3) birebir uygulamasıdır; tüm parametreler o
> kaynaktan gelir. Kendi öğrenme bilimi iddiamız yoktur.

Mevcut SM-2 tabanlı `flashcards` paketi (**`/ogren/kelime-kartlari`**,
`flashcard_decks`/`flashcards` tabloları) bu paketin KAPSAMI DIŞINDADIR ve
hiçbir dosyasına dokunulmaz. Yeni sistem tamamen bağımsızdır: tablo öneki
`srs_`, API öneki `/srs`, sayfa kökü `/ogren/tekrar`.

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

- Retrievability: `R(t,S) = (1 + FACTOR·t/S)^DECAY`; `t = max(0, (now - last_review).days)` — **tam gün truncation** (timedelta.days), kesirli gün değil.
- İlk tekrar: `S0(G) = max(w[G-1], 0.1)`; `D0(G) = clamp(w4 − e^(w5·(G−1)) + 1, 1, 10)`.
- Başarılı tekrar: `S′ = S·(1 + e^{w8}·(11−D)·S^{−w9}·(e^{(1−R)·w10}−1)·hard_penalty·easy_bonus)`; `hard_penalty = w15` (yalnız Hard), `easy_bonus = w16` (yalnız Easy).
- Lapse: `S′ = min(w11·D^{−w12}·((S+1)^{w13}−1)·e^{(1−R)·w14},  S/e^{w17·w18})`.
- Aynı gün (elapsed < 1 gün): `S′ = S·e^{w17·(G−3+w18)}` (her rating'de bu formül; Again dahil).
- Zorluk: `ΔD = −w6·(G−3)`; `D′ = D + ΔD·(10−D)/9` (linear damping); `D″ = w7·D0(4) + (1−w7)·D′`; sonra `clamp(D″, 1, 10)`. Mean-reversion hedefi `D0(4)` clamp'li hesaplanır.
- Aralık: `I(S) = (S/FACTOR)·(r_d^{1/DECAY} − 1)`, `I = clamp(round(I), 1, maximum_interval)`; `round` Python banker's rounding. `r_d = 0.9` iken `I(S) = S`.
- Formül seçimi: `last_review` yoksa initial; `elapsed < 1 gün` ise same-day; değilse rating=Again → lapse, diğerleri → başarılı tekrar. S/D **her cevapta** güncellenir; adım mantığı yalnız due/interval'ı belirler.

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
Birim testi `tests/test_srs_scheduler.py::test_f15_referans_tablosu` bizim
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

- **DB bilmez, IO yapmaz, `now()` çağırmaz** — şimdiki zaman her fonksiyona
  parametre olarak enjekte edilir. Modülde `datetime.now`, `random`,
  `sqlalchemy`, `fastapi`, `redis` import'u YASAKTIR (birim test nöbetçisi
  vardır: F-14 determinizm + kaynak taraması).
- Deterministik: aynı girdi → aynı çıktı. Fuzz yok.

Dosyalar:

- `params.py` — §1.1'deki tüm sabitler + `leech_threshold = 8`,
  `default_new_per_day = 20`, `default_reviews_per_day = 200`,
  `ROLLOVER_HOUR = 4`, TZ adı `Europe/Istanbul`.
- `engine.py` — `SrsCardState` (frozen dataclass: state, step, stability,
  difficulty, due, last_review, reps, lapses) + `review(state, rating, now)
  → ReviewResult(state', interval_minutes)` + `preview_intervals(state, now)`
  (4 rating için sonraki aralık — çalışma ekranı önizlemesi).
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
`ip16_araliklitekrar` (şema, `down_revision = "ip5_siparis_vergi_kirilimi"`) →
`ip16_srs_izinleri` (izin katalogu). Bu dalda **tek head**; boş DB'de
`upgrade head → downgrade -1 ×2 → upgrade head` doğrulandı (downgrade sonrası
`srs_*` tablo sayısı 0, yeniden upgrade'de 8 tablo + 2 izin) ve
`alembic check` "No new upgrade operations detected" verir.

⚠️ **Bayat ortam tuzağı (merge önkoşulu):** izin kodları geliştirme sırasında
`srs.platform.*` → `srs_platform.*` olarak yeniden adlandırıldı ama migration
**revizyon kimliği değişmedi**. Alembic aynı revizyonu tekrar koşmadığı için,
yeniden adlandırmadan ÖNCE `ip16_srs_izinleri` uygulanmış bir veritabanında
eski kodlar kalır ve admin platform uçları herkese 403 döner. Bu durum
geliştirme sırasında bir kez gözlendi (tek kullanımlık bir test DB'sinde; tam
suite orada 6 kırmızı verdi, taze DB'de 0). Dal push/merge edilmediği ve
geliştirme veritabanına (`ceyhandb`, revizyon `ip12_urun_arama_vektoru`,
`srs_*` tablosu 0) hiç uygulanmadığı için başka ortam etkilenmemiştir.
**Merge eden:** bu revizyonu daha önce uygulamış bir ortam varsa
`admin_permissions`'taki `srs.platform.%` satırlarını elle düzeltmelidir.

⚠️ **Merge anında head çatalı (beklenen, bkz. görev tanımı):** İP-12 bu arada
main'e girdi ve onun `ip12_urun_arama_vektoru` revizyonu da
`ip5_siparis_vergi_kirilimi`'ye bağlı. İP-16 main'e alınırken iki head
oluşacaktır; birleştirme sırasında bir **merge revision**
(`alembic merge -m "ip12+ip16" ip12_urun_arama_vektoru ip16_srs_izinleri`)
üretilmelidir. Bu dal içinde yapılacak bir şey yoktur.

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
- Vade karşılaştırması **ana göre** (`due_at <= now`): kaçırılan günler
  birikir, kart kaybolmaz (G-4); `due_at` gelecekte ise bugünün kuyruğunda
  yoktur (G-5). Limit sayaçları `study_day` üzerinden döner (L-5).

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
| `GET /srs/cards` | C/T | tarayıcı: `deck_id, state, tag, q, suspended, page, page_size` — sunucu sayfalama + `total`; geçersiz enum → 422 |
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

## 9. Ekran haritası (frontend)

Rotalar (`lib/routes.ts` PATHS+ROUTES; nav: Öğren hub kartı "Aralıklı Tekrar"):

- `/ogren/tekrar` — deste ağacı + due sayaçları + platform galerisi + kopya.
- `/ogren/tekrar/deste/:id` — deste detay: not ekleme (tip seçici, cloze
  editörü), limit ayarları, (tutor) atama yönetimi.
- `/ogren/tekrar/calis/:deckId` — çalışma: boşluk=çevir, 1/2/3/4=cevap,
  u=undo; dört butonda aralık önizleme; cloze render; yazarak cevap + diff
  (T-7); oturum ilerleme çubuğu (yeni/öğrenme/tekrar kalan); mobil uyumlu.
- `/ogren/tekrar/tarayici` — DataTable, sunucu filtre/sayfalama, toplu işlem.
- `/ogren/tekrar/istatistik` — tutma oranı, gelecek yük, boş durum.

Hata `ErrorState`, boşluk `EmptyState` (ikisi ayrışır). Mevcut tasarım dili;
dark-mode paritesi; sakin düzen (kart enflasyonu yok).

## 10. Mutasyon kataloğu (20 prova) — **20/20 YAKALANDI**

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

## 11. Kalan P2'ler (bilinçli kapsam dışı)

- Sibling bury (ters/cloze kardeş gömme) — §4.1.
- "İlerlemeyle kopyala" seçeneği — §7.4.
- FSRS parametre optimizasyonu (kişisel eğitim) ve FSRS-6 geçişi.
- Medya, .apkg içe/dışa aktarma, senkron protokolü, filtreli deste — v2
  (görev tanımında kapsam dışı).
- Kuyrukta yeni/review karışım seçenekleri (sabit AfterReviews) — §4.1.
- **B-6 iki katmanlı**: geçersiz filtre değeri hem Pydantic şemasında hem
  `browse_cards` içinde 422 üretir. Şema katmanını tek başına söken bir
  mutasyon testi kırmaz (yalnız `deck_id="abc"` gerçekten tipli query
  parametresine bağlıdır). Davranış sözleşmesi korunuyor, ama B-6'nın
  nöbetçiliği bu noktada zayıf — katman ayrımı istenirse ayrı test gerekir.
- **Gerçek tarayıcı kabulü yapılmadı**: frontend Vitest + `tsc` + lint ile
  doğrulandı; klavye kısayolları, cloze/diff render'ı, mobil yerleşim ve
  dark-mode paritesi gerçek tarayıcıda sınanmadı (kök CLAUDE.md §F). Tasarım
  denetimi kod okuması + üretim CSS'inde sınıf sırası ölçümüyle yapıldı.
- **Öğrenci atama typeahead'i 100 rezervasyonla sınırlı**: aday kümesi
  eğitmenin kendi rezervasyonlarından üretilir (`GET /bookings?limit=100`);
  `/clients/search` eğitmene kapalıdır (`users.view` ister). 100'den fazla
  rezervasyonu olan eğitmende çok eski bir öğrenci listede çıkmayabilir —
  kalıcı çözüm eğitmene açık bir "öğrencilerim" ucudur.
- **Frontend ekranlarının kendi test kapsamı dar**: saf yardımcılar
  (`srsTypeAnswer`, `srsCloze`) Vitest'li ama sayfa bileşenleri için RTL
  davranış testi yazılmadı; ekranlar tip denetimi ve derleme ile sınırlı
  güvence altındadır.

## 12. Doğrulama kapıları

`POSTGRES_DB=adana_ip16_test` (adında "test" — db_guard). Komşu paketler:
ip1a=63, ip3=115, ip2a=49, integration=1222+yeni, acceptance=197, ruff,
vitest/tsc/lint (uyarı artmaz). S-1/S-2 5'er tur.
