# Presence Flush Yarışı — Merge Hazırlık Notu

**Dal:** `presence-yarisi` · **Taban:** `magaza-tasarim` ucu (`05e82c4`) · **Merge:** `main` (`63440f6`) → `71fba48`

Bu bir yeni özellik paketi değildir. 9 Ağustos 2026'da yazılmış, ölçülmüş ve
**merge edilmeden unutulmuş** iki üretim düzeltmesini merge edilebilir hâle
getirir. Kayıtları defterde zaten duruyor: [[TB-27]] ve [[TB-28]].

## 1. Neden ayrı dal

Düzeltmeler `magaza-tasarim` dalında duruyordu, ama o dalın worktree'sinde
(`Desktop/adana-magaza`) **commit edilmemiş tasarım işi** var: 14 değiştirilmiş
frontend dosyası (`Landing.tsx`, `PublicNavbar.tsx`, `HeroSearch.tsx`, …) ve 4
takip edilmeyen logo dosyası (`logo.svg`, `magaza-logo.svg`, …).

O ağaçta merge yapmak, kök `CLAUDE.md` §D'nin adıyla kaydettiği kaza sınıfını
davet ederdi ("sürücünün `git checkout --`'ı commit edilmemiş bir üretim
düzeltmesini sildi"). Bu yüzden presence işi dalın **ucundan** yeni bir dala
alındı; `magaza-tasarim` ve worktree'si **hiç dokunulmadan** duruyor.

> ⚠️ O commit edilmemiş tasarım işi hâlâ orada ve hâlâ korumasız. Bu paketin
> kapsamı değil, ama sahibinin bilmesi gereken bir risk.

## 2. Kapatılan iki üretim hatası

### 2.1 Flush yarışı — sessiz veri kaybı

`core/presence.py::flush_to_db` kuyruğu `HGETALL` ile okuyor, DB'ye yazıyor,
sonra **tüm hash'i `DEL`** ediyordu. Okuma ile silme arasında geçen sürede
(bir `UPDATE` + `COMMIT`) gelen her `touch` çağrısı sessizce kayboluyordu:
kullanıcı çevrimiçiydi, ama kaydı bir sonraki flush turuna kadar (varsayılan
5 dk) yoktu.

Düz `HDEL` de yetmezdi — aynı kullanıcı flush ortasında yeniden `touch`'lanırsa
alan adı aynı, değeri daha yenidir; düz `HDEL` o yeni damgayı da düşürürdü.
Çözüm **değer karşılaştırmalı silme**: yalnız okuduğumuz değer hâlâ oradaysa
silinir (`_CAD_SCRIPT`, Lua).

### 2.2 Tablo adı allowlist'i — SQL yüzeyi

Aynı fonksiyon tablo adını **Redis anahtarından** okuyup `f"UPDATE {table} …"`
ile SQL'e gömüyordu. `_FLUSHABLE_TABLES` allowlist'i eklendi.

Ayrıca: bozuk anahtar artık turu düşürmüyor, kuyruk `PRESENCE_DIRTY_MAX_ENTRIES`
(50k) üstünde kritik loglanıyor.

## 3. Merge sonrası ölçülen kapılar

Hepsi `71fba48` üzerinde, tek kullanımlık `adana_presence_test` DB'sinde ve
Redis `db11`'de koşuldu. Geliştirme kataloğu `ceyhandb`'ye dokunulmadı
([[TB-35]]).

| Kapı | Taban (main `63440f6`) | Bu dal | Delta |
|---|---|---|---|
| `pytest tests/integration` | 1323 · 16 skip | **1330 passed · 16 skip** | **+7** |
| `test_presence_flush_pg.py` (gerçek PG + gerçek Redis) | yok | **7 passed** | +7 |
| `ruff check backend/` | temiz | **temiz** | — |
| Mutasyon provası PR1–PR4 | — | **4/4 yakalandı** (her provada 7 test seçildi) | — |
| frontend `vitest` | 890 · 85 dosya | **etkilenmez** | — |

Delta'nın tamamı eklemedir ve tek kaynağı yeni test dosyasıdır: 1323 + 7 = 1330.

Frontend satırı ölçülerek atlandı, varsayılarak değil:
`git diff --stat main...presence-yarisi -- frontend/` **boş** — dal `frontend/`
altında tek satır değiştirmiyor.

### 3.1 Koşum komutu (env tuzağı — [[TB-21]] ve kök conftest)

Kök `conftest.py` CI için **sahte `POSTGRES_*` varsayılanları** koyar; gerçek
değerler pytest'ten ÖNCE env ile verilmezse suite `role "test" does not exist`
ile 7 hata verir (bu turda yaşandı). Kullanılan komut:

```
cd backend
POSTGRES_USER=postgres POSTGRES_PASSWORD=… POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 POSTGRES_DB=adana_presence_test \
REDIS_URL=redis://localhost:6379/11 PAYMENT_PROVIDER=fake \
python -m pytest tests/integration -q
```

`PAYMENT_PROVIDER=fake` elle verilir: `.env` `iyzico` taşıdığında entegrasyon
testleri gerçek sandbox'a çıkar ([[TB-21]], bu turda canlı doğrulandı).

## 4. Merge çakışması — ne oldu, nasıl çözüldü

Tek çakışma `docs/teknik-borc.md`'deydi ve **tamamen konumsaldı**: iki taraf da
defterin başına kayıt eklemiş. Defter azalan numara sırasında tutulur; main'in
blokları (TB-45…TB-30) üstte kaldı, bu dalın TB-28/TB-27 kayıtları TB-30 ile
TB-26 arasına yerleşti. Doğrulandı: çift numara **yok**, İP-17 numaralandırma
notu **duruyor**, içerikten hiçbir şey düşmedi.

**Numara çakışması yaşanmadı — ve bu tesadüf değil.** main'in numaralandırma
notu (İP-16 turu, 9 Ağu) TB-27/TB-28'i bu dala **rezerve bırakmış**, kendi iki
kaydını TB-29/TB-30'a taşımıştı. Defterin dört maddelik kuralının işe yaradığı
ilk ölçülmüş vaka.

## 5. Merge kararı verecek olanın bilmesi gerekenler

1. **Bu dal ORTAK mutasyon sürücüsünü değiştiriyor.** `_secilen_test_sayisi`
   ("sıfır test seçildi → BAŞARISIZLIK") nöbetçisi main'de yalnız üç paket
   sürücüsünde var (`mutation_drill_ip14/_ip16/_ip18.py`); bu dal onu ortak
   `mutation_drill.py`'ye taşıyor ve PR1–PR4'ü ortak kataloğa ekliyor.
   [[TB-45]] tam bu sınıfı uyarır: ortak sürücüyü değiştirmek yedi paketin
   ölçüm aracını değiştirir. **Yönü zararsızdır** — nöbetçi yalnız sıkılaştırır,
   yakalanmış bir mutasyonu yakalanmamışa çeviremez; olsa olsa daha önce
   sessizce boş koşan bir provayı açık hataya çevirir. Yine de bu, TB-45'in
   önerdiği `_yesil_taban` taşımasıyla **aynı sınıfta** bir değişikliktir ve
   birlikte değerlendirilmelidir.
2. **Sıra kısıtı:** `sm2-kaldirma` denetimde ve o paketin kapı tablosu
   `main = 63440f6` üstünde ölçüldü. Bu dal main'e önce inerse sm2'nin ölçümü
   bayatlar ve yeniden koşulması gerekir. **Doğru sıra: önce sm2-kaldirma,
   sonra bu dal.**
3. **Bu paket bağımsız denetimden geçmedi.** Kapılar geliştirici tarafından
   ölçüldü; kök `CLAUDE.md` §A uyarınca bu tek başına tamamlanma kanıtı
   değildir. Düzeltmelerin kendisi 9 Ağustos turunda ölçülmüştü, bu tur yalnız
   **merge sonrası hâlâ geçerli olduklarını** gösterir.

## 6. Kapsam dışı bırakılanlar

- [[TB-27]]'nin açık kalan üç maddesi (deps.py örtük yan etkisi · kuyruk
  şişmesinin yalnız log üretmesi · 30 May–9 Ağu arası geri doldurulamayan
  `last_seen_at` verisi) bu turda kapatılmadı.
- [[TB-28]] (entegrasyon testlerinin canlı Redis'e yazması) suite geneline
  yayılmadı; yalnız presence testleri kendi izolasyonunu çözüyor.
- `magaza-tasarim`'daki commit edilmemiş tasarım işi (§1).
