# SM-2 Kelime Kartı Sistemi — Kaldırma Sözleşmesi

Tarih: 2026-08-13 · Dal: `sm2-kaldirma` · Taban: `ed4ff95` (main)

Bu doküman, `/ogren/kelime-kartlari` yüzeyini besleyen **SM-2 tabanlı eski
kelime kartı paketinin** kaldırılmasının bağlayıcı kaydıdır: karar ve
gerekçesi, yokluk matrisi, kaldırma sırası, migration kararı, doğrulama
kapıları ve yol boyunca bulunan iki gizli borç.

Yerine geçen sistem **FSRS-5** tabanlı `srs_*` paketidir
(`docs/ip16-aralikli-tekrar-sozlesme.md`). Bu paket o sisteme **dokunmaz**;
tersine, ölçümlerinin her birinde onun AYAKTA olduğunu ayrıca kanıtlar
(§3 "yalancı yeşil nöbetçileri").

---

## 1. Karar ve gerekçe

İki aralıklı tekrar sistemi yan yana duruyordu: SM-2 (`/ogren/kelime-kartlari`,
`flashcard_*` tabloları, `/flashcards` uçları) ve FSRS-5 (`/ogren/tekrar`,
`srs_*`). İkincisi birincinin yaptığı her şeyi yapıyor ve üstüne cloze,
yazarak cevaplama, kart tarayıcı, limit kalıtımı, undo, istatistik ve eğitmen
ataması getiriyor. Birincisinin **hiç testi yoktu**
(`docs/DENETIM-RAPORU-2026-07-31.md` bunu "testsiz router: `flashcards`
(10 uç)" olarak zaten kaydetmişti).

### 1.1 Ölçülen veri — taşıma yapılmama gerekçesi

Kaldırma öncesi geliştirme veritabanı (`ceyhandb`) ölçüldü:

| | |
|---|---|
| `flashcard_decks` | 2 satır (ikisi de canlı) |
| `flashcards` | 12 satır (hepsi canlı) |
| Sahip | **tek kişi**: `user_id=6, role_id=3` → `ogrenci@gmail.com`, geliştiricinin kendi test hesabı |
| İçerik | `apple/elma`, `pepperpepper/biberbiber`, `cucumbercucumber/salatalıksalatalık` — elle üretilmiş duman verisi |
| Seed mi | **hayır** — `core/seed.py` ve `backend/scripts/` altında tek referans yok |
| Olgunluk | 12 kartın hepsinde `last_reviewed_at` dolu ama `repetitions=0`, `interval_minutes=0`; damgalar 4 Haziran 04:17'de **6 saniye** içinde peş peşe — tek oturumda butonlara basılmış |

Gerçek kullanıcı verisi yoktu. **Veri taşıma yazılmadı**; taşıma kodu, iki
destelik duman verisi için kalıcı bakım yükü olurdu.

Yine de kaldırmadan **önce** yedek alındı (maliyeti sıfır, geri dönüşü yok):

```
C:\Users\kiyar\Documents\adana-veri-yedek\flashcards-ceyhandb-20260813.sql
7.015 bayt · md5 30b7919a78c04ff1d98b438a2c08fec1
pg_dump -t flashcards -t flashcard_decks --no-owner --no-privileges
COPY satırları doğrulandı: flashcard_decks=2, flashcards=12
```

Konum repo ağacının **dışındadır** ve TB-31'in `adana-env-yedek` konvansiyonunu
izler.

### 1.2 Eski URL'ler → 404 (yönlendirme YAZILMADI)

`/ogren/kelime-kartlari`, `/ogren/kelime-kartlari/:id` ve
`/panel/ogren/kelime-kartlari(/:id)` **404 döner**. Yönlendirme bilinçli olarak
yazılmadı: iki deste, tek kullanıcı (geliştiricinin kendi hesabı), yer imi yok,
dış link yok. Bu koşullarda yönlendirme kalıcı kod borcu üretir — `LegacyRedirect`
tablosuna ölümsüz bir satır ekler ve altı ay sonra "bu neden burada?" sorusuna
dönüşür.

**Bu bir üründür kararıdır, teknik zorunluluk değildir.** Koşullar değişirse
(ör. sistem canlıya çıkmış ve gerçek kullanıcı yer imleri varsa) doğru cevap
tersine döner.

---

## 2. Kaldırılanlar

**9 dosya silindi, −1490 satır.**

| Katman | Dosyalar |
|---|---|
| backend | `models/flashcard.py` · `schemas/flashcard.py` · `services/flashcard_service.py` (SM-2 algoritması: `_apply_sm2`) · `api/routers/flashcards.py` (10 uç) |
| frontend | `pages/Flashcards.tsx` · `pages/FlashcardDeck.tsx` · `api/flashcards.ts` · `hooks/useFlashcards.ts` · **`lib/srs.ts`** |

> ⚠️ **`lib/srs.ts` adı yeni sistemi çağrıştırıyordu ama eski sisteme aitti**:
> backend `_apply_sm2` ile birebir aynı istemci-tarafı aralık önizlemesiydi;
> tek tüketicisi `FlashcardDeck.tsx`'ti. Yeni sistemin lib'leri
> `srsCloze.ts` / `srsFormat.ts` / `srsTypeAnswer.ts`'tir. Adına bakıp
> "bu yeninin" diye bırakmak, kaldırmayı sessizce yarım bırakırdı.

Kayıt noktaları: `models/__init__.py` (import + `__all__`) · `api/router.py`
(import + `include_router`) · `lib/routes.ts` (PATHS + ROUTES) · `App.tsx`
(lazy import + `<Route>` + iki legacy girdi) · `pages/Learn.tsx` (hub kartı) ·
`types/index.ts` (`FlashcardDeck`, `Flashcard`, `ReviewRating`, `DeckCreate`,
`CardCreate`) · `lib/routes.test.ts` (eski sözleşmenin 5 assertion'ı).

### 2.1 Kaldırma sırası (bağlayıcı)

**frontend yüzeyi → backend kodu → migration EN SONDA.**

Ters sıra geliştirme ortamında 500 üretir: tablo düştüğü anda hâlâ onu okuyan
bir servis kalır. Aradaki her adımda sistem tutarlı olmalıdır — "kod var, tablo
yok" hâli hiçbir noktada oluşmaz.

---

## 3. Yokluk matrisi

Matris **üretim kodundan ÖNCE**, ayrı bir commit'te yazıldı (`0e37367`).

### 3.1 Neden bu sıra zorunluydu

Bir şeyin kaldırıldığını iddia eden test, o şey **hiç var olmamış olsa da**
geçer. Yeşil olması tek başına hiçbir şey kanıtlamaz; kanıt, testin kaldırmadan
önce gerçekten **kırmızı düştüğünün görülmesidir** (kök CLAUDE.md §E). Kırmızı
faz koşuldu ve çıktısı commit mesajına yazıldı: **21 düğüm kırmızı**.

Bu disiplin bir işe yaradı: matrisin kendi içinde bir **yalancı yeşil** buldu
(§5.1).

### 3.2 Düğümler

Bugünkü matris **25 düğümdür** (18 backend + 7 frontend). Kırmızı fazda 21'i
kırmızıydı; 3'ü tasarım gereği yeşil nöbetçidir, 1'i (R3b) Faz 3'te eklendi.

| Kod | Ne ölçer | Sınıf | Kırmızı fazda |
|---|---|---|---|
| **R1** (10) | Kaldırılan 10 ucun tamamı kimliksiz istekte **404** döner | gerçek HTTP | 🔴 401 |
| **R2** (1) | Route tablosunda `/api/v1/flashcards*` yol YOK + `flashcards` etiketi YOK | gerçek OpenAPI | 🔴 6 yol |
| **R4** (5) | 4 modül `ModuleNotFoundError` + `models.__all__` temiz | gerçek import | 🔴 import oluyordu |
| **R3** (1) | Taze tek kullanımlık PG: `upgrade head` sonrası tablolar yok | gerçek PostgreSQL | 🔴 kuruluyordu |
| **R3b** (1) | `downgrade -1` şemayı geri kurar, tablolar **0 satır**, `upgrade` yeniden düşürür | gerçek PostgreSQL | — (Faz 3) |
| **R5** (2+1) | `PATHS`/`ROUTES` anahtar YOK + hiçbir değer `kelime-kartlari` içermez | saf yapı | 🔴 |
| **R6** (2+2) | Öğren hub'ında "Kelime Kartları" DOM'da yok + `kelime-kartlari` linki yok | gerçek DOM (jsdom+RTL) | 🔴 |

**R6 ölü linkin tek otomatik nöbetçisidir**: route silinip hub kartı bırakılsa
kullanıcı tıklayınca boş ekrana düşer ve başka hiçbir test bunu görmez.

### 3.3 Yalancı yeşil nöbetçileri (kasıtlı olarak yeşil düğümler)

Yokluk iddiaları boş kümede kendiliğinden sağlanır. Bu yüzden her ölçümün
yanına **doluluk kanıtı** kondu:

| Nöbetçi | Neyi imkânsız kılar |
|---|---|
| R2: OpenAPI'de `/api/v1/srs` yolları VAR | Boş/kapalı şema (`ENVIRONMENT=production` şemayı kapatır) iki assert'i de geçirirdi |
| R3: `srs_*` sekiz tablo KURULDU | Migration hiç koşmasa "flashcard tablosu yok" boş veritabanında da sağlanırdı — yalancı yeşilin en olası kılığı |
| R3: `alembic check` temiz | Tabloyu düşürüp `models/flashcard.py`'yi bırakmak autogenerate'i "tabloyu geri ekle" der hâle getirirdi |
| R5: `PATHS.srs` ayakta | `routes.ts` boşalsa/import kırılsa düğümler kendiliğinden geçerdi |
| R6: hub gerçekten render oluyor (h1 "Öğren" + "Aralıklı Tekrar" başlığı) | Sayfa hiç render olmasa ya da patlasa "Kelime Kartları yok" iddiası geçerdi |
| R6: `/ogren/tekrar` linki VAR | Kartın yerine geçenin gerçekten çalıştığını gösterir |

### 3.4 Matrisin ömrü

Kaldırma bitince bu dosyaların işlevi değişir: artık kaldırmanın kanıtı değil,
**geri sızmanın nöbetçisidir**. Biri SM-2 modülünü, uçlarını, tablolarını veya
rotalarını geri getirirse matris kırmızı döner.

---

## 4. Migration

Yeni revizyon: **`sm2_flashcard_kaldirma`**, `down_revision =
ip16_srs_izin_kodu_hizalama`.

### 4.1 Baseline'a neden dokunulmadı

Tablolar baseline'da (`532b1fa8771d`) doğuyor. Kaldırmayı orada yapmak
çekicidir ve **yanlıştır**: o revizyon uygulanmış her ortamda (geliştirme
`ceyhandb` dahil) çoktan koştu ve alembic aynı revizyonu ikinci kez
çalıştırmaz. Geçmişi düzenlemek tabloları o veritabanlarında **sessizce yerinde
bırakırdı** — İP-16'nın B7 tuzağının aynısı (içerik değişti, kimlik değişmedi →
bayat veritabanı sessizce "zaten head"). Kaldırma bu yüzden **ileri yönlü** bir
revizyonla yapılır.

### 4.2 Ölçülen ayrıntılar

- **Enum temizliği YOK**: `ReviewRating` yalnız Pydantic tarafında yaşıyordu,
  veritabanında karşılığı hiç olmadı (kolonlar `float8`/`int4`/`text`/
  `timestamptz`). Veritabanındaki 11 PG enum türünün hiçbiri ilgili değil.
- **Dış FK YOK**: tek FK `flashcards.deck_id → flashcard_decks.id`. Drop sırası
  buna bağlıdır (önce çocuk).
- Düşen index'ler: `ix_flashcards_deck_due`, `ix_flashcards_deck_id`,
  `ix_flashcard_decks_owner`.

### 4.3 `downgrade` bir yedekleme mekanizması DEĞİLDİR

`downgrade` şemayı birebir geri kurar ama **veriyi geri getirmez**. Revizyon
docstring'i bunu söyler; **R3b bunu ölçer** — geri kurulan tablolarda satır
sayısının 0 olduğu gerçek PostgreSQL'de assert edilir. Yazıyla söylemek
yetmezdi: ileride biri "nasılsa downgrade var" diye veri kaybını göze alabilir.

R3b ayrıca `downgrade`'in **ölü kod olmadığını** kanıtlar. Kaldırma
revizyonlarında `downgrade` tipik olarak hiç koşulmaz ve ilk gerçek geri alma
denemesinde patlar (yanlış index adı, ters FK sırası, eksik kolon).

---

## 5. Yol boyunca bulunan iki gizli borç

### 5.1 `app.routes` tuzağı → **TB-46**

Matrisin R2 düğümünün ilk hâli route tablosunu `app.routes` üzerinden okuyordu
ve kırmızı fazın ilk koşusunda **16 kırmızının yanında tek yeşil** olarak
sırıttı.

Sebep: FastAPI `include_router`'da route'ları düzleştirmez, tembel bir
`_IncludedRouter` bırakır (`path == ""`); alt-router yolları ancak istek
çözümlenirken açılır. `app.routes` bu depoda **9 girdi** döner ve yüzlerce
gerçek uç orada görünmez.

**Yön kritiktir:**

- `assert yol in app.routes` → **yanlış kırmızı** (İP-16 commit 1'de yaşandı)
- `assert yol not in app.routes` → **yalancı yeşil** — ve bu tehlikelidir,
  çünkü kaldırma yapılmadan da geçer, yani "bu sistem kaldırıldı" iddiasının
  kanıtı diye sunulabilir.

Tuzak zaten **üç yerde** yorum olarak belgeliydi
(`test_ip16_privacy_pg.py` D-6c/D-7, `test_f30_packing_contract.py::_router_yollari`,
`test_ip3_operator_active_gate_pg.py`). Buna rağmen dördüncü kez aynı yere
düşüldü: **belge yetmiyor** — yorum, o dosyayı okuyanı korur, yeni dosya
yazanı korumaz. Bu yüzden ayrı borç kaydı açıldı.

**Kural:** route tablosu iddiaları **OpenAPI şemasından** okunur
(`app.openapi()["paths"]`); yokluk iddialarına ayrıca doluluk nöbetçisi konur.

### 5.2 İP-16'nın bıraktığı bayat fixture — `test_B1_TAZE_DB_UPGRADE_DOWNGRADE_UPGRADE`

Kaldırma sırasında bu düğüm kırıldı. **Kırılan üretim değil, fixture'ın
kendisiydi.**

`birlesik_agac` fixture'ı "main'in versions ağacı + **sabit bir İP-16 revizyon
çifti**" kuruyordu. İP-16 bir dalken doğruydu: amaç, dalın kendi ağacında
görünmeyen head çatalını (ip12 ↔ ip16) yakalamaktı. Ama İP-16 main'e girdikten
sonra fixture **bayatladı** ve kimse fark etmedi, çünkü ağaç tesadüfen hâlâ
doğru sonucu veriyordu.

Kaldırma paketi ağaca yeni bir revizyon ekleyince gerçek ortaya çıktı: o
revizyon sentetik ağacın **dışında** kaldı. Ağaç `flashcard_*` tablolarını hâlâ
kuruyor, ama modeller kaldırılmıştı → `alembic check` haklı olarak sapma
raporladı. Yani **fixture hiçbir yerde var olmayan bir ağacı ölçüyordu**: ne
main'in hâli, ne çalışma ağacının hâli.

Bu, İP-16'nın bıraktığı **gizli borçtu**: dala özgü bir ölçüm aracı merge
sonrası temizlenmemişti ve sessizce yanlışa dönüşmüştü. Ölçüm araçlarının da
son kullanma tarihi vardır.

İki düzeltme:

1. **Birleşik ağaç artık ölçülüyor, sabit liste değil**: main'in ağacı +
   çalışma ağacının fazlası. Fixture, dalın hangi revizyonları eklediğini
   bilmek zorunda kalmaz — sonraki her paket için kendiliğinden doğrudur.
2. **`downgrade -1` → hedef revizyon adı** (`downgrade ip16_araliklitekrar`,
   sonra `ip12_urun_arama_vektoru`). Göreli adım sayısı yalnız İP-16 zincirin
   en üstündeyken doğruydu. Araya "izin downgrade'i tabloları DÜŞÜRMEDİ"
   iddiası da eklendi — önce ölçülmüyordu.

Ek olarak `test_B1_BIRLESIK_AGACTA_TEK_HEAD` artık head'in **adını
çapalamıyor** ("head bir İP-16 revizyonudur" iddiası her yeni paketle
bayatlar); ölçtüğü şey çatal yokluğudur, İP-16'nın zincirde bulunduğu ayrıca
doğrulanır.

### 5.3 Ayrıca düzeltilen ortam eksiği — jsdom `matchMedia`

`themeStore` modül seviyesinde `window.matchMedia` çağırıyor; jsdom bu API'yi
hiç uygulamıyor. Bu yüzden `DashboardShell → DashboardHeader →
PersonalizeModal` zincirine bağlı **her panel sayfası** testte import
aşamasında patlıyordu. Sonuç "0 test" olur — bu, "test zayıf" ile
karıştırılmaması gereken **"test hiç koşmadı"** hâlidir ve yeşil bir toplamın
içinde sessizce kaybolabilir.

Stub `frontend/src/test-setup.ts`'e eklendi (zaten aynı sınıf ortam eksikleri
için var olan dosya). `matches: false` → "system" tercihi testlerde açık temaya
çözülür; karanlık mod paritesi ölçen bir test bunu kendi içinde ezmelidir.

> ⚠️ **MERGE NOTU:** Aynı tuzak `ip14-operator-panel` dalında **bağımsız
> olarak** bulundu ve orada da bir stub eklendi. O dal main'e girdiğinde bu
> dosyada çakışma çıkar: **ikisini birden tutmayın** — tek stub yeterlidir.
> Mükerrer tanımda ikinci `Object.defineProperty` birincisini sessizce ezer ve
> hangi davranışın geçerli olduğu okunamaz hâle gelir. Aynı not
> `docs/ip16-aralikli-tekrar-sozlesme.md` §0'da da durur.

---

## 6. Doküman ve adlandırma

- `docs/ip16-flashcard-sozlesme.md` → **`docs/ip16-aralikli-tekrar-sozlesme.md`**
  (`git mv`, geçmiş korundu). Gerekçe: "flashcard" artık **kaldırılan** sistemin
  adı; yaşayan sistemin sözleşmesinde kalması altı ay sonra karışıklık üretir.
  Dokuz atıf güncellendi.
- **Dokunulmayanlar (tarihsel kayıt):** `docs/teknik-borc.md` içindeki
  `ip16-flashcard` **dal adı** ve `docs/DENETIM-RAPORU-2026-07-31.md`. Geçmiş
  yeniden yazılmaz.
- `backend/CLAUDE.md`: `/flashcards/*` satırı silindi. **Yerine `/srs/*` satırı
  EKLENDİ** — İP-16 merge'inde uç haritasına hiç yazılmamıştı; flashcards
  satırını silmek Öğren aralıklı tekrar yüzeyini haritadan tamamen düşürüyordu.
  Satır OpenAPI ile **doğrulandı** (§7.3).
- `models/srs.py`, `models/habit.py`, `lib/nav.ts`, `frontend/CLAUDE.md`:
  silinen pakete atıf yapan yorum/metinler düzeltildi.

### 6.1 Açık dallarla çakışma uyarıları (MERGE ÖNCESİ OKU)

Bu paket iki dosyaya dokundu ve **başka dallar da aynı dosyalara bağımsız
olarak dokunmuş durumda**. İkisi de sessiz bozulma riski taşır:

| Çakışma | Ölçüm | Ne yapılmalı |
|---|---|---|
| **`docs/ip16-flashcard-sozlesme.md` → `…-aralikli-tekrar-sozlesme.md`** yeniden adlandırması | `git diff --stat main...ip17-vade-granulerligi` → o dal **aynı dosyada 326 satır** değişiklik taşıyor (§4.4/§10.2 vade granülerliği bölümleri) | Hangi dal önce merge edilirse edilsin, **yeniden adlandırma + İP-17'nin içerik değişikliği birlikte korunmalı**. Git rename tespiti bunu genelde çözer; çözemezse doğru sonuç: dosya YENİ adıyla durur ve İP-17'nin bölümlerini İÇERİR. İçerikten biri düşerse İP-17 sözleşmesiz kalır |
| **`frontend/src/test-setup.ts` `matchMedia` stub'ı** | `ip14-operator-panel` dalında aynı tuzak bağımsız bulunmuş ve orada da stub eklenmiş | **İkisini birden tutma** — tek stub yeterli. Mükerrer `Object.defineProperty` birincisini sessizce ezer ve hangi davranışın geçerli olduğu okunamaz hâle gelir (§5.3) |

`docs/teknik-borc.md`'ye üç dal birden dokunuyor. **Bu paketin kayıtları artık
numaralı DEĞİLDİR** — defterin dört maddelik yeni kuralı gereği dal içinde
geçici etiket taşırlar (`TB-47`, `TB-46`) ve numara **merge turunda** tahsis
edilir. Bu yüzden bu dosyanın `teknik-borc.md` ile numara çakışması artık
yapısal olarak mümkün değildir; merge turunda yapılacak iş §10.2'de listelidir.

### 6.2 "flashcard" tam kelime araması

Canlı üretim kodunda **sıfır**. Kalan hitler ve nedenleri:

| Yer | Neden |
|---|---|
| `migrations/versions/532b1fa8771d_baseline_schema.py` | Baseline'a dokunulmaz (§4.1) |
| `migrations/versions/sm2_flashcard_kaldirma.py` | Kaldırma revizyonunun kendisi |
| `tests/test_flashcards_kaldirildi.py`, `tests/integration/test_flashcards_migration_pg.py`, `frontend/src/flashcardsKaldirildi.test.tsx` | Nöbetçi testler — geri sızmayı yakalamak için adı taşımak zorundalar |
| `docs/teknik-borc.md` (dal adı), `docs/DENETIM-RAPORU-2026-07-31.md` | Tarihsel kayıt |
| `backend/CLAUDE.md` `/srs/*` satırı | "Yerini aldığı eski paket kaldırıldı" notu |

---

## 7. Doğrulama kapıları

### 7.1 Otomatik — **main merge'i sonrası** (İP-14 · İP-17 · İP-18 dahil)

Ölçüm `main = 63440f6` birleştirildikten sonra, **tek kullanımlık** bir
veritabanında yapıldı (`adana_sm2_test`). Geliştirme kataloğu `ceyhandb`'ye
KOŞULMADI ([[TB-35]]); `POSTGRES_USER`/`POSTGRES_PASSWORD` ve
`PAYMENT_PROVIDER=fake` elle verildi ([[TB-21]]: aksi hâlde entegrasyon
testleri `.env`'den iyzico alıp gerçek sandbox'a çıkıyor).

| Kapı | Taban (main, İP-17 sonrası) | Bu dal | Delta |
|---|---|---|---|
| `pytest tests/integration` | 1323 · 16 skip | **1325 passed · 16 skip** | **+2** |
| `pytest` (integration/verify hariç) | 946 | **962 passed** | **+16** |
| `pytest tests/verify` (CI deseni) | — | **132 passed** | — |
| `pytest tests/acceptance` | — | **197 passed** | — |
| `pytest -k "ip16 or ip17"` | — | **76 passed** | — |
| `pytest -k ip18` | — | **22 passed** | — |
| `pytest -k ip14` | — | **7 passed** | — |
| frontend `vitest run` | 890 · 85 dosya | **897 passed · 86 dosya** | **+7 · +1** |
| `eslint src` | 0 hata · 34 uyarı | **0 hata · 32 uyarı** | **−2 uyarı** |
| `ruff check backend/` | temiz | temiz | — |
| frontend `tsc -b` | temiz | temiz | — |

#### Delta neden NEGATİF değil — beklenti düzeltmesi

Merge turuna girerken beklenti "kaldırma paketi sayıları **düşürecek** (silinen
testler)" idi. **Düşürmedi; ölçüm bunun tersini gösteriyor** ve sebebi
kaldırılan sistemin kendisidir:

- **Backend tarafında silinen test YOKTUR** — eski SM-2 paketinin hiç testi
  yoktu. Bu, kaldırmadan önce de bilinen bir şeydi:
  `docs/DENETIM-RAPORU-2026-07-31.md` onu "testsiz backend router: `flashcards`
  (10 uç)" diye kaydetmişti. Yani 273 satırlık `_apply_sm2` algoritması ve 10
  uç, tek bir nöbetçi olmadan silindi.
- **Frontend tarafında da test dosyası silinmedi.** Eski sistemin kendi test
  dosyası yoktu; yalnız `lib/routes.test.ts` içinde 5 assertion vardı ve onlar
  **silinmedi, değiştirildi** (yerlerine yaşayan rotaların — `srsDeck` vb. —
  eşdeğer iddiaları kondu). Ölçüldü: `it(` düğüm sayısı **9 → 9**.
- Ölçüm: `git diff --name-status ed4ff95..HEAD -- backend/tests frontend/src`
  → silinen (`D`) test dosyası **yok**.

Dolayısıyla bütün delta **eklemedir**: +16 (R1/R2/R4) · +2 (R3/R3b) · +7
(frontend yokluk matrisi) · +1 dosya. Tek azalan sayı **eslint uyarısıdır**
(34 → 32): silinen `Flashcards.tsx`/`FlashcardDeck.tsx` iki uyarı taşıyordu.

Bu, kaldırmanın en dürüst özetidir: **çıkan kodun hiç nöbetçisi yoktu, giren
nöbetçilerin hepsi yeni.**

### 7.2 Gerçek tarayıcı duman turu (Chrome + DevTools Protocol)

Kök CLAUDE.md §F: "Vitest + typecheck + build'in geçmesi gerçek tarayıcı kabul
testinin yerine geçmez." Bu paket için gerçek tarayıcı turu **yapıldı**
(geliştirme yığını, `ceyhandb`):

| Yol | Sonuç |
|---|---|
| `/ogren/kelime-kartlari` | **404 sayfası** (`h1` = "Aradığınız sayfa bulunamadı"), iki turda doğrulandı |
| `/ogren/kelime-kartlari/1` | 404 sayfası |
| `/panel/ogren/kelime-kartlari` | 404 sayfası (legacy yönlendirme gerçekten kalktı) |
| `/ogren/tekrar` (anonim) | `/giris`'e yönlenir — yani rota VAR, korumalı |
| `/ogren` (oturumlu) | `h1` = "Öğren"; kartlar: Aralıklı Tekrar · Zamanlayıcı · Grafik Çizici · Alışkanlıklar · Görevlerim · Sorularım · Denemelerim · Takvim. "Kelime Kartları" **yok**, `kelime-kartlari` linki **yok** |
| "Aralıklı Tekrar" kartına **gerçek tıklama** | → `/ogren/tekrar`, `h1` = "Aralıklı Tekrar", 404 değil |

Canlı backend (`ceyhandb`): `/api/v1/flashcards/decks` → **404**,
`/api/v1/srs/decks` → **401** (var, kilitli).

> Ölçüm notu: ilk turda `/ogren/kelime-kartlari` boş gövde döndü. Bu bir bulgu
> değil, **soğuk başlangıç artefaktıydı** (lazy chunk henüz inmemişti); ısınma
> gezinmesi eklenip iki tur daha koşuldu, ikisi de 404 verdi. Boş bir okumayı
> "kanıt" diye kaydetmek, gerçek bir hatayı da aynı kılıkta gizlerdi.

### 7.3 `/srs/*` satırının OpenAPI ile doğrulanması

`backend/CLAUDE.md`'ye eklenen satır, uygulamanın gerçek OpenAPI şemasındaki
**19 `/api/v1/srs` yoluyla** karşılaştırıldı. **Doğrulama bir boşluk buldu:**
satırın ilk hâli `GET /srs/decks/platform` (platform galerisi) ve
`POST /srs/decks/{id}/copy` (kopyalama) yüzeylerini saymıyordu. Satır
düzeltildi; şimdi 19 yolun tamamı karşılanıyor.

### 7.4 Migration zinciri — taze tek kullanımlık DB (merge sonrası, elle)

R3/R3b düğümleri bunu zaten koşar; merge turunda zincir ayrıca **elle** ve
görünür çıktıyla doğrulandı (tek kullanımlık `adana_zincir_<hex>_test`):

| Adım | Ölçüm |
|---|---|
| `upgrade head` | SM-2 tabloları **(yok)** · `srs_*` **8** tablo |
| `downgrade -1` | `flashcard_decks, flashcards` **geri geldi** · satır sayısı **flashcards=0, decks=0** |
| `upgrade head` | SM-2 tabloları **(yok)** |
| `alembic check` | **"No new upgrade operations detected."** |

İkinci satır, revizyon docstring'indeki "downgrade şemayı geri kurar ama
**veriyi geri getirmez**" cümlesinin canlı ölçümüdür.

### 7.5 Geliştirme veritabanı

`ceyhandb` kaldırma turunda yükseltilmişti: damga `sm2_flashcard_kaldirma`,
kalan flashcard tablosu **0**, `srs_*` **8**. Merge turunda `ceyhandb`'ye
**dokunulmadı** ([[TB-35]]); ayrıca `adana_verify` üzerinde CI deseni koşarken
migration gerçekten uygulandı (`ip16_srs_izin_kodu_hizalama →
sm2_flashcard_kaldirma`) ve `tests/verify` 132 passed verdi.

---

## 8. Denetçinin ilk bakacağı yerler

Bu bölüm paketi yazanın kendi işaretlediği zayıf noktalardır. Amacı denetçinin
işini kolaylaştırmak değil, **nereye bakarsa bir şey bulacağını** söylemektir.
Aşağıdaki her iddia iddia değil **ölçümdür**: yedi mutasyon provası koşuldu
(sürücü kirli ağaçta başlamayı reddeder, dosyayı bayt yedeğinden geri yükler
ve geri yüklemeyi SHA-256 ile doğrular; `git checkout --` kullanmaz).

### 8.1 Düğümlerin sınıflandırması — 25 düğümün 21'i yokluk sözleşmesi

| Sınıf | Adet | Kırmızı kanıtı |
|---|---|---|
| **Yokluk sözleşmesi** (hiç var olmamış bir şey için de geçer) | **21** | Hepsinin Faz 1'de kırmızı düştüğü koşularak kaydedildi (`0e37367`) |
| Doluluk nöbetçisi (kasıtlı yeşil) | 3 | Tasarım gereği hiç kırmızı olmadı — mutasyonla sınandı (§8.2) |
| Davranış sözleşmesi (yokluk değil) | 1 (R3b) | **Kırmızı fazda YOKTU** — Faz 3'te eklendi, mutasyonla sınandı |

Simetri tesadüf değil: **21 yokluk düğümü = Faz 1'de kırmızı düşen 21 düğüm.**
Yani her yokluk iddiasının kayıtlı bir kırmızı kanıtı vardır; kanıtsız tek
düğüm R3b'ydi ve o da artık mutasyonla kapatıldı.

**Kırmızı kanıtın gücü düğüme göre değişir — en zayıfı R4:**

- **R1 (10) güçlü**: kırmızı fazda 401 ölçüldü ve assertion 401'i ADIYLA
  reddediyor. "Kilitleme kaldırma sanılamaz."
- **R2 (1) güçlü**: 6 yol adıyla listelendi; doluluk nöbetçisi D3'te ötüyor.
- **R3 (1) güçlü**: gerçek PG, tablolar adıyla listelendi.
- **R4 (5) ZAYIF SAYILMALI**: yalnız **adın** gittiğini kanıtlar. Kod başka bir
  modüle taşınmış olsaydı R4 yine yeşil olurdu. Kaldırmanın gerçekliğini
  taşıyan asıl düğümler R1/R2/R3'tür; R4 onların yanında ikincil kanıttır.
- **R5/R6 (4) güçlü**: R6 gerçek DOM; ölü-link düğümünün bağımsız değeri
  D5'te ölçüldü.

### 8.2 Mutasyon provaları — yedi prova, biri YAKALANMADI

| # | Mutasyon | Hedef nöbetçi | Sonuç |
|---|---|---|---|
| D1 | Migration zincirini çatalla (`down_revision` → ip12) | `test_B1_BIRLESIK_AGACTA_TEK_HEAD` | ⚠️ **Yakalandı ama YANLIŞ YERDE** — aşağıya bak |
| D2 | `downgrade`'i no-op yap (ölü kod) | R3b | ✅ Kendi assertion'ıyla: "downgrade şemayı geri kurmadı: []" |
| D3 | `srs` router'ını `include_router`'dan çıkar | R2 doluluk nöbetçisi | ✅ "OpenAPI şeması boş ya da router'lar kayıtlı değil" |
| D4 | Hub'daki "Aralıklı Tekrar" başlığını boz | R6 render nöbetçisi | ✅ `Unable to find … role "heading" … /aralıklı tekrar/i` |
| D5 | Başlık aynı kalsın, **link** eski yola dönsün | R6 ölü-link düğümü | ✅ 2 düğüm kırıldı; metin düğümü doğru şekilde YEŞİL kaldı |
| D7 | `PATHS.srs`'i kaldır | R5 doluluk nöbetçisi | ✅ 2 düğüm kırıldı |
| D6 | Bayat izin kodu **taşımasını** etkisizleştir (SQL geçerli kalır) | İP-16 B7 | ❌ **YAKALANMADI — 7 passed** |

#### D1: çatal yakalanıyor, ama B1 sayesinde değil

Zincir çatallandığında `tests/integration/conftest.py`'nin **session kapsamlı
autouse fixture'ı** patlıyor: `RuntimeError: test veritabani migrate edilemedi:
Multiple head revisions are present`. Yani çatal **gürültülü biçimde**
yakalanıyor — sızamaz. Ama `test_B1_BIRLESIK_AGACTA_TEK_HEAD`'in kendi
assertion'ı bu koşuda **hiç çalışmadı** (pytest `ERROR`, `FAILED` değil —
[[TB-29]]'un tam ayrımı).

Sonuç: **B1'in tek-head assertion'ı pratikte conftest tarafından gölgelenmiştir.**
B1'in benzersiz değeri yalnız şu senaryoda ortaya çıkar: çatal **yalnız
birleşik ağaçta** var, çalışma ağacında yok (yani main ile birleşince doğan bir
çatal). Bu senaryo yerelde kurulamadı, dolayısıyla **B1'in benzersiz değeri
ölçülmemiştir** — makul ama kanıtsızdır. Denetçi buraya bakmalı.

#### D6: yakalanmayan mutasyon — İP-16'nın açık boşluğu (BENİM DEĞİL)

`ip16_srs_izin_kodu_hizalama` iki iş yapar: (1) bayat izin kodlarını siler,
(2) bayat kodların **rol bağlarını güncel koda taşır**. Sözleşme bu ikisinin
"birlikte yapıldığını" söyler. Ölçüm: (2) sökülünce **hiçbir test kırılmıyor.**

Sebep ölçüldü: aynı migration'daki `ROLE_GRANTS` döngüsü doğru kodları
`SUPER_ADMIN`/`EDUCATION_MANAGER`'a **koşulsuz** veriyor
(`ip16_srs_izin_kodu_hizalama.py:122-141`), dolayısıyla B7'nin rol
assertion'ları taşıma çalışmasa da geçiyor. Taşımanın gerçek işlevi yalnız
**katalog dışı** rol bağları içindir (panelden elle verilmiş bir izin) — ve o
yol test edilmiyor.

**Kayıt açıldı: [[TB-47]]** (numara tahsis komutu yeniden koşuldu; ölçüm
aşağıda §8.7). **Bu boşluk bu paketten gelmiyor:** `git diff main...HEAD` ile ölçüldü — B7
test gövdelerinde **tek satır** değişiklik yok; değiştirdiğim yerler yalnız
fixture (satır 51, 124-128) ve iki B1 düğümü. Boşluk İP-16 merge edildiğinde de
oradaydı; bu paketin mutasyon provası onu **görünür kıldı**. Denetçiye not:
bu, kaldırma paketinin kusuru değil, komşu paketin kayıtlanmamış borcudur.

### 8.3 `test_B1` fixture düzeltmesi sessizce başka bir şeyi değiştirdi mi?

Değişiklik: fixture eskiden "main'in ağacı + **sabit iki İP-16 dosyası**"
kopyalıyordu; artık "main'in ağacı + **çalışma ağacının tamamı** (üzerine
yazarak)".

Sessiz yan etki adayı: main'de de bulunan bir migration dosyası artık **çalışma
ağacının sürümünden** okunuyor. Ölçüldü:

```
git diff --name-status main...HEAD -- backend/migrations/
  A  backend/migrations/versions/sm2_flashcard_kaldirma.py     ← tek değişiklik: EKLEME
main ile çalışma ağacı arasında farklı olan mevcut migration: YOK
```

Yani bu dalda üzerine-yazma **hiçbir dosyanın içeriğini değiştirmiyor**;
davranış farkı sıfırdır. **Ama gelecekte değildir**: bir dal mevcut bir
migration'ı düzenlerse fixture artık main'in değil dalın sürümünü ölçer. Bu
bilinçli bir seçimdir (dalın düzeltmeleri ölçüme girsin) ve kodda yorumla
yazılıdır — denetçi bu seçimi tartışmak isteyebilir.

İkinci değişiklik: `test_B1_BIRLESIK_AGACTA_TEK_HEAD` artık head'in **adını**
çapalamıyor. Eski assertion (`"ip16" in head`) her yeni paketle bayatlardı.
Yerine "İP-16 zincirde var" + "tek head" kondu. **Kayıp:** eskiden head'in
İP-16 olduğu (yani zincirin ucu) çapalıydı; artık değil. Bu bilinçli, çünkü o
iddia zaten yanlıştı — ama bir zayıflamadır ve denetçi başka bir şeyle
değiştirmek isteyebilir.

### 8.4 Downgrade nöbetli mi, tek atışlık mı?

**Nöbetli.** `test_R3b_*` kalıcı bir testtir, `tests/integration/` altındadır
ve CI `pytest tests/integration -q` ile koşar. D2 provası nöbetin gerçek
olduğunu gösterdi: `downgrade` no-op yapılınca düğüm **kendi assertion'ıyla**
kırıldı.

**Kalan zayıflık:** R3b'nin "0 satır" iddiası (downgrade veriyi getirmez) için
ayrı bir mutasyon **yapılamadı** — o iddiayı bozmanın yolu downgrade'e veri
yazmaktır, ki bu gerçekçi bir mutasyon değil. Yani o assertion doğru ama
**nöbetçiliği kanıtlanmamıştır**; şu an bir belgelendirme-testi gücündedir.

### 8.5 Doluluk nöbetçileri kendileri yalancı yeşil olabilir mi?

Üçü de mutasyonla sınandı ve ötüyor (D3, D4+D5, D7). Ama **yapısal bir delik
duruyor ve kapatılmadı**: nöbetçiler *komşunun varlığını* ölçer, *kaldırılanın
yokluğunu ölçen kodun sağlığını* değil. Somut senaryo:

> `Learn.tsx` bir stub'la değiştirilse ve stub `h1 "Öğren"` + `h2 "Aralıklı
> Tekrar"` + `/ogren/tekrar` linki içerse, **her iki R6 nöbetçisi de yeşil
> kalır** ve "Kelime Kartları yok" iddiası boş bir sayfada vakumda sağlanır.

Bu senaryo pratikte düşük olasılıklıdır (kimse hub'ı stub'lamaz) ama nöbetçinin
mantıksal sınırıdır: **doluluk nöbetçisi vakumu daraltır, kaldırmaz.** Aynı
sınır R2 (OpenAPI dolu ama yanlış router'larla dolu olabilir) ve R3 (srs 8
tablo var ama şema başka türlü bozuk olabilir) için de geçerlidir.

### 8.6 Denetçiye kısa liste

1. **D6'nın yakalanmayan mutasyonu** — İP-16'nın izin taşıma kodu nöbetsiz
   (§8.2). Kapsam dışı, **[[TB-47]] olarak kaydedildi**; kapatma önerisi
   (katalog dışı bir role bağlanan izin ile B7 düğümü) kayıtta duruyor.
2. **B1'in benzersiz değeri ölçülmedi** (§8.2 D1) — conftest gölgeliyor.
3. **R4 zayıf sınıf** (§8.1) — yalnız adın gittiğini kanıtlar.
4. **R3b'nin "0 satır" ayağı nöbetçilikten çok belgelendirme** (§8.4).
5. **Doluluk nöbetçilerinin yapısal sınırı** (§8.5) — vakumu daraltır, kaldırmaz.
6. **Fixture üzerine-yazma seçimi** (§8.3) — bugün etkisiz, gelecekte değil.
7. **Duman turu yalnız ADMIN oturumuyla** yapıldı (§9).

## 9. Bilinen sınırlar ve açık noktalar

- **Duman turu ADMIN hesabıyla yapıldı** (seed `ADMIN_EMAIL`). `/ogren` grubu
  rol kısıtı taşımadığı için hub aynı bileşendir; ancak CLIENT ve TUTOR
  oturumlarıyla ayrıca gezilmedi. Hub kartlarının rol bazlı farkı yoktur
  (`Learn.tsx` yalnız nav öğelerini role göre seçer), bu yüzden risk düşüktür —
  ama ölçülmemiştir.
- **Kaldırma sonrası performans/boyut ölçümü yapılmadı** (bundle küçülmesi vb.).
  Kapsam dışı.
- TB-46'nin kalıcı çözümü (`app.routes` üzerinde path araması yapan test
  kaynaklarını reddeden meta-test, ya da ortak `router_yollari()` yardımcısı)
  **yazılmadı**; borç defterinde "sonraki adım" olarak duruyor.
- Bu paket **bağımsız üretim audit'ine gidecektir**; merge kararı ayrıca
  verilecektir.

---

## 10. Ek: numara tahsisinin hikâyesi (ve kuralın neden değiştiği)

Bu bölüm tarihsel kayıttır: aşağıdaki numaralar **artık geçerli değildir**,
paketin kayıtları bugün `TB-47` ve `TB-46` geçici etiketlerini taşır (§10.2).

Eski kural gereği numara alınmadan önce tüm dallarda ölçülürdü; çıktı kayıt
commit'ine yazılırdı. `app.routes` kaydı (bugünkü `TB-46`) alınırken yapılan
ölçüm bu tur için tekrarlandı — ve **manzara değişmişti**:

| Dal | Numaralar (kuyruk) |
|---|---|
| `main` / `origin/main` | … 29 30 31 **32 33 35** |
| `ip14-operator-panel` | … 29 30 31 32 33 |
| `ip17-vade-granulerligi` | … 30 31 32 33 |
| `ip18-siparis-kilit` | … 32 33 **35** |
| `sm2-kaldirma` (bu dal) | … 29 30 31 **34** |

İki gözlem:

1. **main ilerledi** — İP-14 merge edilmiş (32, 33 artık main'de) ve main'de
   bir **TB-35** var. Ayrıca ölçüm yeni bir dal gösterdi: `ip18-siparis-kilit`.
   Bu paketin merge kuyruğu bu yüzden yeniden değerlendirilmelidir.
2. **TB-34 çakışmıyor** — main 33'ten 35'e atlamış, 34'e hiçbir dal
   dokunmamış. Yani bu paketin TB-34'ü hâlâ benzersizdir.

En yüksek numara **35** olduğundan kayıt **TB-36** olarak açıldı.

### 10.1 …ve TB-36 yine de çakıştı (14 Ağu 2026)

Ölçüm doğruydu ama **eşzamanlı bir dal aynı pencerede aynı numarayı aldı** ve
main'e önce girdi: main'in TB-36'sı "CI'da düştü, yerelde geçiyor — flaky
sayıldı" kaydıdır. Kural 3 gereği main kanoniktir; bu paketin kaydı
**TB-44**'e taşındı.

Yeniden ölçüm, önerilen `git fetch --all` adımı **koşularak** yapıldı:

| Dal | Numaralar (kuyruk) |
|---|---|
| `main` / `origin/main` (`30a1270`) | … 33 **35 36 37 38 39 40 41 42 43** |
| `ip18-siparis-kilit` | … 35 37 38 39 40 41 42 43 |
| `ip17-vade-granulerligi` | … 35 36 37 38 39 40 41 42 43 |
| `sm2-kaldirma` (bu dal) | … 31 **34** 36 |

En yüksek **43** → kayıt **TB-44**.

İki not:

- **TB-34 etkilenmedi.** main 33'ten 35'e atlamış, 34'e hiçbir dal dokunmamış
  (ölçüldü: `git show main:docs/teknik-borc.md | grep -c "^## TB-34"` → 0).
- main'de **TB-15 artık yok** — silinmedi, **kapatıldı** (İP-18, `517c251`;
  defterin kuralı: borcu kapatan commit satırı siler). Yani numara
  dizisindeki boşluk kayıp değil, kapanmış borçtur.

Bu, kuralın **yapısal** yetersizliğinin dördüncü kanıtıdır ve
`docs/teknik-borc.md` → "Kuralın YETMEDİĞİ hâl" bölümüne ölçüm + öneri olarak
yazıldı (karar bekliyor).

### 10.2 Merge turunda yapılacaklar (yeni kural, madde 3 ve 4)

Bu paketin iki borç kaydı **numarasızdır**. Merge turunda sırayla:

1. `git fetch --all` (madde 1 — bayat veriyi kapatır, yarışı çözmez).
2. Numara tahsis komutunu koş, çıktıyı **dal başına** oku.
3. İki etikete main'in **o anki** durumuna göre numara ver:

   | Etiket | Kayıt | Kimlik geçmişi |
   |---|---|---|
   | `TB-47` | `ip16_srs_izin_kodu_hizalama` rol bağı taşıması nöbetsiz | TB-36 → TB-44 → `TB-47` |
   | `TB-46` | `app.routes` üzerinden yol araması sessizce boş döner | TB-34 → `TB-46` |

4. Atıfları güncelle — **tam liste** (madde 4):

   | Dosya | Atıf |
   |---|---|
   | `docs/teknik-borc.md` | iki başlık + taşıma notu |
   | `docs/sm2-kaldirma-sozlesme.md` | §5.1 başlığı, §8.2, §8.6, §9 |
   | `backend/tests/test_flashcards_kaldirildi.py` | `test_R2_*` sınıflandırma satırındaki `[[TB-46]]` |

5. Merge commit'ine **etiket→numara eşlemesini** ve **ölçüm çıktısını** yaz.

Kontrol: merge sonrası `grep -rn "TB-47\|TB-46"` **sıfır** sonuç vermeli.

