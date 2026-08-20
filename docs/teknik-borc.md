# Teknik Borç Defteri

Paket çalışmaları sırasında **fark edilen ama kapsam dışı olduğu için
dokunulmayan** sorunlar. Amaç: "sonra bakarız" demenin izini bırakmak. Her
kayıt bulunduğu yeri, gerçek etkisini ve neden ertelendiğini söyler.

Bir borcu kapatan commit, ilgili satırı **buradan siler** (kapatılmış borcun
notunu bırakmak, yapılmış bir işi yapılmamış gibi anlatır).

## Numara tahsis kuralı (ZORUNLU — çakışma iki kez yaşandı)

Paralel dallar aynı numarayı bağımsız olarak tahsis edip çakıştırdı — **üç
kez**: (1) main ↔ İP-3 (TB-7…TB-10, aşağıdaki not); (2) main ↔
`ip16-flashcard` ↔ `ip16-audit-kapanis`, üçü de **TB-24**'ü farklı konular
için kullandı (main: "İP-12 P2 listesi", audit dalı: "alembic damga-şema
nöbetçisi yok", İP-16 dalı: "mutasyon sürücüsü ERROR saymıyor"); (3) aynı gün
`magaza-tasarim` ↔ `ip16-flashcard`, **TB-27 ve TB-28** (mağaza dalı:
"entegrasyon testleri canlı Redis'e yazıyor" ve "`last_seen_at` iki yoldan
yazılıyor").

Yeni kayıt açan **numarayı almadan önce ölçer**, en yüksek numarayı bu
dosyanın kendi kopyasından okumaz:

```bash
# Hangi dalda hangi numaralar var — yeni kayıt en yüksekten SONRA başlar.
for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do
  n=$(git show "$r:docs/teknik-borc.md" 2>/dev/null \
      | grep -o '^## TB-[0-9]*' | grep -o '[0-9]*' | sort -n | tr '\n' ' ')
  [ -n "$n" ] && echo "$r → $n"
done
```

⚠️ **Komutu koşmak yetmez, çıktısını doğru okumak gerekir.** Bu tam olarak bir
kez yanlış gitti: İP-16 turu yalnız `… | tail -1` ile en büyük sayıyı (28)
okudu ve onu "benim yeni kaydım" sandı; oysa 28 zaten `magaza-tasarim`
dalındaydı ve yeni kayıtlar 29'dan başlamalıydı. Bu yüzden komut artık **dal
başına döküm** verir: çıktıda kendi dalınızı görürsünüz, en yüksek numaranın
kime ait olduğu belirsiz kalmaz.

**DÖRT KURAL (14 Ağu 2026'dan itibaren yürürlükte).** Numara artık dal içinde
kesinleşmez; merge turunda tahsis edilir.

**(1) Ölçümden önce `git fetch --all` koşulur.** Yukarıdaki komut yerel
`refs/remotes` kopyasını okur; fetch edilmemişse uzak dallarda çoktan alınmış
numaralar görünmez ve ölçüm bayat veriyle yapılır. ⚠️ **Bu tek başına
YETMEZ** — fetch yalnız bayat veri kaynaklı yanlış ölçümü kapatır, eşzamanlı
iki dalın aynı numarayı almasını ENGELLEMEZ. Kuralın yarışı çözen ayağı (3)'tür.

**(2) Dal içinde geçici etiket kullanılır: `TB-?A`, `TB-?B`, `TB-?C`…** Kayıt
normal biçimde ve tam olarak yazılır; yalnız kimliği geçicidir. Sözleşme
metinleri, kod yorumları ve test docstring'leri **bu etiketi taşır**
(`[[TB-?A]]`). Harf dal içinde benzersizdir, dallar arasında değil — iki dal
aynı anda `TB-?A` kullanabilir, çakışmazlar çünkü hiçbiri gerçek numara
değildir.

**(3) Numara merge turunda tahsis edilir**, main'in **o anki** durumuna
bakılarak. Merge commit'i iki şeyi taşır: **etiket→numara eşlemesi** ve
**ölçüm çıktısı**. Tahsis anı ile main'e yazma anı aynı turda olduğu için
araya başka bir dal giremez.

Gerekçe: numara **paylaşılan bir kaynaktır** ve paylaşılan kaynak ancak
paylaşılan noktada (main) çakışmasız dağıtılabilir. Bu, "ödeme kolu bayrağını
üretimde fail-closed oku" kararıyla aynı mantıktır: kararı, veriye en yakın ve
**tek** olan yerde ver.

**(4) Dal içi atıflar merge turunda güncellenir.** Bu bir maliyettir ve
saklanmaz — ama **bugünkü maliyetin aynısıdır**. Fark şu: iş artık çakışma
çıktıktan *sonra* değil, *önce* yapılır. Dört çakışmanın dördünde de aynı
yeniden numaralama işi yapıldı; tek değişen, ne zaman yapıldığı.

Merge sırasında çakışma yine de çıkarsa (ör. iki dal aynı turda merge
edilirse) **main kanoniktir**: gelen dalın kaydı yeniden numaralanır ve
eski→yeni eşlemesi buraya yorum olarak yazılır. **Hiçbir kayıt silinmez.**

### Kural neden değişti: dördüncü çakışma yapısaldı

Dört çakışma yaşandı ve **üçü okuma hatasıydı, dördüncüsü değildi**:

| # | Çakışma | Sınıf |
|---|---|---|
| 1 | main ↔ İP-3 (TB-7…TB-10) | Okuma hatası — ölçüm yapılmadı |
| 2 | main ↔ `ip16-flashcard` ↔ `ip16-audit-kapanis` (TB-24) | Okuma hatası — üç dal bağımsız tahsis etti |
| 3 | `magaza-tasarim` ↔ `ip16-flashcard` (TB-27/28) | Okuma hatası — komut koşuldu ama çıktı `tail -1` ile yanlış okundu |
| 4 | `sm2-kaldirma` ↔ eşzamanlı dal (TB-36) | **YAPISAL** |

İlk üçü, kurala daha sıkı uyularak önlenebilirdi — ve önlem olarak komut
"dal başına döküm" verecek şekilde değiştirildi. Dördüncüsü öyle değildir:
SM-2 kaldırma paketi kuralı **harfiyen** uyguladı (komutu koştu, çıktıyı dal
başına okudu, en yüksek numarayı — 35 — doğru tespit etti, TB-36'yı aldı,
ölçüm çıktısını commit mesajına yazdı) ve **yine çakıştı**, çünkü eşzamanlı
bir dal aynı pencerede aynı ölçümü yapıp aynı numarayı aldı ve main'e önce
girdi.

Kusur ölçümde değil kuralın yapısındaydı: "ölçüm anında en yüksek + 1", iki
dal aynı anda ölçtüğünde ikisine de aynı sonucu verir. Klasik bir yarış
durumudur (TOCTOU): ölçüm ile tahsis arasında hiçbir kilit yoktur ve dallar
birbirini göremez. **Kural değişikliğinin gerekçesi budur** — ilk üç çakışma
değil, dördüncüsü.

Değerlendirilip SEÇİLMEYEN alternatif: dallara peşin numara bloğu (her yeni dal
10'luk aralık alır). Çakışmayı kaldırır ama defterde kalıcı boşluklar bırakır
ve blok tükendiğinde aynı yarışa döner.

Karar verilene kadar yürürlükteki kural yukarıdaki **üç maddedir**; bu bölüm
yalnız ölçümü ve öneriyi kaydeder.

---

<!-- Numaralandırma notu (main ↔ İP-3 birleştirmesi): iki dal TB-6'nın üstüne
     BAĞIMSIZ olarak TB-7…TB-10 tahsis etti ve numaralar çakıştı. main
     kanoniktir (bkz. TB-8'in "Bulundu" satırı) ve F30/İP-2b sözleşmeleri
     main'in TB-8/TB-9'una atıf yapıyor; bu yüzden İP-3'ün dört kaydı
     TB-10…TB-13'e taşındı. Hiçbir kayıt silinmedi. Eski→yeni: İP-3 TB-7→TB-10,
     TB-8→TB-11, TB-9→TB-12, TB-10→TB-13 (`docs/ip3-yetki-kvkk-sozlesme.md`
     atıfları da güncellendi). -->

<!-- Numaralandırma notu (İP-16 düzeltme turu, 9 Ağu 2026 — İKİ AŞAMALI):

     (a) TB-24 ÜÇ ayrı konuya verilmişti — main "İP-12 P2 listesi",
     `ip16-audit-kapanis` "alembic damga-şema nöbetçisi yok",
     `ip16-flashcard` "mutasyon sürücüsü ERROR saymıyor". main kanonik kabul
     edildi ve İP-16 dalının kaydı TB-24'ten taşındı.

     (b) İlk taşıma TB-27/TB-28'e yapıldı ve ONLAR DA ÇAKIŞTI: `magaza-tasarim`
     aynı gün (11:08) TB-27 "`last_seen_at` iki yoldan yazılıyor" ve TB-28
     "entegrasyon testleri canlı Redis'e yazıyor" kayıtlarını açmıştı; İP-16
     turu ölçüm komutunu koştu ama çıktısını yanlış okudu (en büyük sayıyı
     kendi kaydı sandı). Nihai taşıma:
       İP-16 "mutasyon sürücüsü ERROR saymıyor"  TB-24 → TB-27 → **TB-29**
       İP-16 "ensure_schema uyumsuzluğu gizliyor"      TB-28 → **TB-30**
     (`docs/ip16-flashcard-sozlesme.md` atıfları da güncellendi.)

     Ölçüm (9 Ağu 2026, tüm yerel + uzak dallar): en yüksek numara 28
     (`magaza-tasarim`), bu yüzden yeni kayıtlar 29'dan başladı.

     `ip16-audit-kapanis`'in TB-24'ü, İP-16 dalında ölçülen `ensure_schema`
     bulgusuyla birlikte TB-30'da toplandı; o dal merge edilirken kayıt İKİYE
     bölünmemeli, TB-30 ile birleştirilmelidir. Hiçbir kayıt silinmedi. -->

<!-- Kapanma notu (İP-2a merge'i, `06d3868`): **TB-3** ("İade reconciler
     devraldığında stok geri yüklenmiyor") KAPANDI ve dosyanın kendi kuralı
     gereği SİLİNDİ. Kapatan kod: ortak telafi kancası
     `order_service.py::settle_refunded_order`; reconciler artık her iki sonuç
     dalından (`escrow_reconciler.py` ACTION_FINALIZE ve ACTION_RETRY) bu
     kancayı çağırıyor → stok geri yüklemesi + kupon serbest bırakma +
     `apply_refunded_amount` reconciler yolunda da koşuyor. RMA (`OrderReturn`)
     dalında stokun DÖNMEMESİ artık kusur değil sözleşmedir (PK-α: stok yalnız
     fiziksel kabulde, `receive_return`). Eski atıflar: `f29-envanter-
     sozlesmesi.md:229`, `ip1a-ders-para-sozlesme.md:676` (tarihsel, dokunulmadı).
     **TB-2** silinmedi ama YARIYA DARALDI — güncel gövdesine bakınız. -->

<!-- Kapanma notu (İP-17, vade granülerliği turu): **TB-29** ("Mutasyon sürücüsü
     `ERROR` ile düşen testleri kırılmadı sayıyor") KAPANDI ve dosyanın kendi
     kuralı gereği SİLİNDİ. Kapatan kod: `scripts/mutation_drill.py::_kirilanlar`
     artık `FAILED` satırlarının yanında `ERROR …::düğüm` satırlarını da
     topluyor ve onları "(KURULUM HATASI — test hiç koşmadı)" etiketiyle AYRI
     gösteriyor (kaydın istediği 3. adım); `mutation_drill_ip16`'daki yerel
     gölge silindi, modül üstteki fonksiyonu doğrudan import ediyor.
     Uçtan uca doğrulama: kaydın kendi ölçüm vakası `IP16-21` yeniden koşuldu →
     "YAKALANDI (7 test kırıldı)", yedisi de KURULUM HATASI etiketli.
     Kaydın 2. adımı (geçmiş "YAKALANMADI" kayıtlarını tara) da yapıldı:
     `docs/` altında üç kayıt var; `ip16-aralikli-tekrar-sozlesme.md`'deki IP16-21
     zaten bu kusurun kurbanı olarak işaretlenmişti, `IP16-27` ve
     `ip1a-…::A2` gerçekten zayıf testti ve ikisi de o turda düzeltildi.
     Geriye düzeltilmesi gereken yanlış kayıt KALMADI.
     ⚠️ Bu değişiklik yedi paketin ölçüm aracını değiştirir; ileride eski bir
     kapanış raporundaki "YAKALANMADI" satırı okunurken tarihine bakılmalıdır. -->

<!-- Kapanma notu (İP-5, `bda2edf`): **TB-21** ("Entegrasyon testleri
     `.env`'den `PAYMENT_PROVIDER` alıyor") KAPANDI ve dosyanın kendi kuralı
     gereği SİLİNDİ. Kapatan kod iki katmanlıdır: kök `conftest.py`
     `os.environ.setdefault("PAYMENT_PROVIDER", "fake")` (değişken YOKKEN
     korur) ve `tests/integration/db_guard.py::assert_fake_payment_provider`
     (açıkça `iyzico` verilmiş koşumu REDDEDER; session kapsamlı autouse
     fixture'da çağrıldığı için tüm entegrasyon suite'ini kapsar). Mutasyon
     provası P9 conftest satırını sökünce T-1a kırılıyor. Detay:
     `docs/ip5-kdv-fatura-sozlesme.md` §8. -->

<!-- Kapanma notu (İP-12 FAZ 0): **TB-23** ("Vitest 5000 ms varsayılan
     timeout'unun marjı yok") KAPANDI ve dosyanın kendi kuralı gereği SİLİNDİ.
     Onunla birlikte **TB-19/9** (`PackageLabel` flake'i) de silindi.
     **DÜZELTME (İP-12 audit'i):** `inventoryScreens` flake'i de aynı turda
     "kapandı" diye silinmişti ama bu ERKEN bir karardı — audit 7 koşumun
     1'inde düşüşü tekrar gördü. Kayıt [[TB-14]]/8 olarak GERİ KONDU ve
     "kapandı" yerine "azaldı ama sürüyor" olarak yazıldı.
     Kapatan değişiklik: `frontend/vitest.config.ts` → `testTimeout: 9000`.
     Değer ölçümle seçildi: boşta makinede `--testTimeout=60000` ile koşulan
     tam suite her testin GERÇEK süresini verdi (en yavaş 2409 ms), ardından
     yeni ayarla beş tam koşum yapıldı — **5/5 kez 74 dosya / 756 test** ve
     en yavaş testin tepe değeri 2959 ms (her koşumda aynı test: TB-19/9'un
     kaydettiği `PackageLabel` print CSS testi). 9000 ms o tepenin 3.04 katı.
     TB-23'ün önerdiği 15000-20000 ms bilerek ALINMADI: 20000, en yavaş testin
     8.3 katı olurdu ve 2.4 s'lik bir testin 15 s'ye çıkmasını — gerçek bir
     performans regresyonunu — sessizce yutardı. Dört dosyanın da yeni bütçede
     kullandığı pay: PackageLabel %33, packingScreens %25, inventoryScreens
     %20, packingLabel %20 (eski 5000 ms'de bu %44-59'du; TB-23'ün "bütçenin
     yarısını yiyor" tespiti). Bu paylar İP-12'nin 5 koşumunda ölçüldü;
     `inventoryScreens` için yetersiz kaldığı audit turunda görüldü (bkz.
     [[TB-14]]/8). Ölçüm boşta makinede yapıldı — ölçümden önce
     çalışan scraper/uvicorn/vite süreçleri durduruldu, çünkü yüklü makinede
     ölçülen "en yavaş test" testi değil makine durumunu ölçer. Not: TB-23'ün
     (2) numaralı sonraki adımı — "bu testlerin neden saniyeler sürdüğünü
     ayrıca incelemek" — YAPILMADI ve kapsam dışıdır; bütçe gerçeğe
     yaklaştırıldı, testler hızlandırılmadı. Eski atıflar:
     `ip5-kdv-fatura-sozlesme.md:504` ve `:594` hâlâ [[TB-14]]/8'e işaret
     ediyor (tarihsel kayıt, dokunulmadı — TB-3 kapanışındaki desenin aynısı;
     o belge İP-5 turunun ölçümünü anlatıyor ve o tur bu düzeltmeden önceydi).
     -->

<!-- Numaralandırma notu (İP-17 merge turu, 14 Ağu 2026): aşağıdaki iki kayıt
     İP-17'nin bağımsız denetiminde açıldı ve dal içinde geçici etiketle
     (TB-?A / TB-?B) durdu; numara kuralın gereğince merge turunda ölçülerek
     verildi — tüm yerel + uzak dallarda en yüksek `^## TB-<n>` başlığı 43'tü
     (`ip17=43 ip18=43 main=43 origin/main=43`, geri kalanı daha düşük).
       TB-?A → **TB-45**   TB-?B → **TB-44**
     Numaraların etiket sırasına ters düşmesi bilinçlidir: bu dosya azalan
     numara sırasında tutulur, iki kayıt da aynı turda açıldı ve blokları
     yerinden oynatmamak için üstteki daha yüksek numarayı aldı.
     UYARI (sm2-kaldirma dalını merge edecek olana): o dalın numaralandırma
     notu TB-44'ü **terk edilmiş bir kimlik geçmişi** olarak anıyor
     (`TB-36 → TB-44 → TB-?A`). O TB-44 hiçbir zaman başlık olarak
     tahsis edilmemişti; buradaki TB-44 ile ilgisi yoktur. -->

<!-- Numaralandırma notu (SM-2 kaldırma paketi, merge turu — 14 Ağu 2026):

     Bu iki kayıt dal içinde geçici etiketle (TB-?A / TB-?B) durdu; numara
     kuralın dördüncü maddesi gereği MERGE TURUNDA ölçülerek verildi.

     Ölçüm (`git fetch --all` sonrası, tüm yerel + uzak dallar): en yüksek
     `^## TB-<n>` başlığı **45** (`main=45 origin/main=45`; sonraki
     `research/focus-study-rooms=36`, `sm2-kaldirma=31` — kendi kayıtları
     etiket olduğu için numaraya girmiyor, kuralın beklenen davranışı).

       TB-?A  (`ip16_srs_izin_kodu_hizalama` rol bağı taşıması) → **TB-47**
       TB-?B  (`app.routes` yol araması sessizce boş döner)      → **TB-46**

     Numaraların etiket sırasına ters düşmesi bilinçlidir ve İP-17 merge
     turundaki gerekçenin aynısıdır: bu dosya AZALAN numara sırasında tutulur,
     iki kayıt da aynı turda açıldı, blokları yerinden oynatmamak için üstteki
     daha yüksek numarayı aldı.

     ⚠️ TB-44 KARIŞIKLIĞI (İP-17 merge notunun uyardığı nokta — teyit edildi):
     bu dalın önceki notu TB-44'ü bir kimlik geçmişi olarak anıyordu
     (`TB-36 → TB-44 → TB-?A`). O TB-44 hiçbir zaman başlık olarak tahsis
     EDİLMEDİ; yalnız bu dal içinde geçici olarak kullanıldı ve kural
     değişince etikete döndü. Bugün defterdeki **TB-44 İP-17'nindir**
     ("Yeni kart sıralaması (`_order_id`) nöbetsiz") ve bu paketle ilgisi
     yoktur. Kimlik geçmişi kaydı bu yüzden buradan kaldırılmadı, ama
     numarayla değil ETİKETLE anılıyor: bu paketin kayıtları TB-46 ve TB-47'dir.

     Kimlik geçmişleri (tam):
       TB-47 : TB-36 (çakıştı) → TB-44 (dal içi, terk edildi) → TB-?A → TB-47
       TB-46 : TB-34 (dal içi, terk edildi) → TB-?B → TB-46
-->

<!-- Numaralandırma notu (İP-19, merge turu — 15 Ağu 2026): altı kayıt dal
     içinde geçici etiketle durdu ve numaralar defterin kuralı gereği MERGE
     TURUNDA tahsis edildi. Ölçüm (`git fetch --all` sonrası, tüm yerel VE
     uzak dallar): en yüksek `^## TB-<n>` başlığı **47** (main, origin/main,
     magaza-tasarim, sm2-kaldirma) → numaralar 48'den başladı.

     Etiket→numara eşlemesi:
       TB-?A → **TB-48**   teslimat sözü m.16 bağlayıcılığı      (araştırma turu)
       TB-?B → **TB-49**   kurye ekranı hız baskısı / muvazaa     (araştırma turu)
       TB-?C → **TB-50**   yetki belgesi P1* varsayımı            (araştırma turu)
       TB-?D → **TB-51**   ratelimit `_client` event loop tuzağı  (denetim turu)
       TB-?E → **TB-52**   tahtada tek sürükleme kipi             (denetim turu)
       TB-?F → **TB-53**   delete_vehicle 409 yarışı              (denetim turu)

     48-50 İP-19'un araştırma turunda bulundu ve o paketin KAPSAMI DIŞINDADIR
     (hukuk/mevzuat kararı ister, kod kusuru değil). 51-53 bağımsız denetim
     düzeltme turunda bulundu. Sözleşme: docs/ip19-dagitim-operasyon-sozlesme.md
     §9 ve §10.6. -->

<!-- Varyant paketi merge turu (19 Ağu 2026) — kural (3) gereği tahsis:
     ölçüm tüm yerel+uzak dallarda en yüksek TB-54 (fetch sonrası) →
       TB-?A → **TB-55**   kategori parent_id kitap-kuralı kaçağı  (denetim P2-1)
       TB-?B → **TB-56**   asılı (üyesiz) varyant grubu            (denetim P2-3)
       TB-?C → **TB-57**   grup kartı temsilcisi tükenik olabilir  (denetim P2-5)
       TB-?D → **TB-58**   varyant testleri izolasyon sınırları    (denetim P2-8)
     Dördü bağımsız denetimin merge-sonrasına ertelediği bulgulardır. -->

## TB-55 · Kategori `parent_id` taşıması varyant kitap kuralını kapısız deliyor (denetim P2-1)

| | |
|---|---|
| **Bulundu** | Varyant paketi bağımsız denetimi (18 Ağu 2026, P2-1 — merge sonrasına ertelendi) |
| **Nerede** | `store_service.update_category` — `parent_id` serbestçe atanır |
| **Sorun** | Kitap-dışı bir kategori (altındaki GRUPLU ürünlerle birlikte) admin ucundan bir kitap kökünün ALTINA taşınabilir; `ensure_variants_allowed` yalnız ÜRÜN yazma yolunda çalıştığı için taşıma anında hiçbir kapı yok. Sonuç: kural dışı kalmış gruplu ürünler (P2-2 düzeltmesi bunların BAKIMINI serbest bıraktı ama oluşmasını engellemiyor). Ayrıca `parent_id` için döngü kontrolü de yok |
| **Neden ertelendi** | Denetim kararı: merge engeli değil; taşıma nadir bir admin aksiyonu ve ürün-yolu kapısı + `BOOK_ROOT_SLUGS` nöbetçileri ayakta |
| **Sonraki adım** | `update_category` parent değişiminde: yeni zincir kitap köküne çıkıyorsa ve alt ağaçta gruplu ürün varsa 409; döngü kontrolü |

## TB-56 · Son üyesi çıkarılan varyant grubu asılı kalıyor (denetim P2-3)

| | |
|---|---|
| **Bulundu** | Varyant paketi bağımsız denetimi (18 Ağu 2026, P2-3 — merge sonrasına ertelendi) |
| **Nerede** | `store_service.update_product` (gruptan çıkış) / `delete_product` |
| **Sorun** | Üyeler tek tek gruptan çıkarılınca (ya da soft-delete edilince) grup 0 aktif üyeyle yaşamaya devam eder; admin grup listesinde ve seçicide artık hiçbir şeyi temsil etmeyen "hayalet" gruplar birikir. `delete_group` elle çağrılmadıkça temizlik yok |
| **Neden ertelendi** | Veri bozmaz; yalnız yönetim yüzeyi kirliliği. Otomatik silme ayrı karar ister (soft-delete'li üye geri gelebilir — FK sayımı silinmişleri de sayıyor) |
| **Sonraki adım** | Admin grup listesinde "üyesiz" rozeti + boş grubu tek tıkla silme; otomatik temizlik yapılacaksa yalnız hiç referanssız gruplar |

## TB-57 · Grup kartının temsilcisi tükenik üye olabiliyor (denetim P2-5)

| | |
|---|---|
| **Bulundu** | Varyant paketi bağımsız denetimi (18 Ağu 2026, P2-5 — merge sonrasına ertelendi) |
| **Nerede** | `store_service.search_products` — temsilci sırası (`temsilci_sirasi`) stok durumuna bakmaz |
| **Sorun** | `in_stock` grup semantiği doğru (kart görünür, `in_stock_override` grubu söyler) ama skor kipinde temsilci en yüksek puanlı üyedir — o üye tükenikse kartın başlığı/fiyatı/linki tükenik varyanta gider; müşteri tıklayınca "Tükendi" sayfasına iner (seçiciden stoklu kardeşe geçebilir, ama ilk izlenim yanlış) |
| **Neden ertelendi** | Davranış yanlış veri göstermiyor, alt-optimal yönlendiriyor; temsilci sırasına `stokta DESC` eklemek sıralama kiplerinin tamamında yeniden test ister |
| **Sonraki adım** | `temsilci_sirasi`'nın başına `stokta.desc()` ekle + altı kip testine "tükenik temsilci adayı varken stoklu üye temsil eder" senaryosu |

## TB-59 · `MutationObserver` sözleşmesinin sıralama garantisi yalnız test ortamında doğrulandı

| | |
|---|---|
| **Bulundu** | İP-A8'in bağımsız doğrulama turu (21 Ağu 2026 · D-3) |
| **Nerede** | `frontend/src/components/admin/ui/Dialog.tsx` — panel içeriğini izleyen gözlemci efekti |
| **Sorun** | Dedektörün yanlış-pozitif emniyeti şu varsayıma dayanıyor: *"çocuğun bekçi kaydı bir `useEffect`tir ve commit sonrası senkron akar; gözlemci geri çağrısı bir mikrogörevdir ve ondan SONRA koşar."* Bu, RTL/`act()` altında doğru (doğrulama turunda gerçek `AdminLibraries` penceresiyle ölçüldü: geç doğan **korumalı** form dedektörü patlatmıyor). Gerçek tarayıcıda ise React 18 pasif efektleri `scheduleCallback` (MessageChannel = makrogörev) ile planlar; `MutationObserver` geri çağrısı mikrogörevdir ve **önce** koşabilir — o anda `korumaVar` hâlâ `false`tur |
| **Etki** | **Yalnız geliştirme.** Üretim derlemesinde dedektör gövdesi tamamen eleniyor (doğrulama turu `dist/`te ölçtü: `function pc({kok,korumaVar,korumasiz,baslik}){}`, `attributeFilter` dizesi bundle'da yok). Riskin üretim tarafı yoktur; olası zarar, DOĞRU yazılmış bir pencerenin geliştirmede yanlışlıkla uygulamayı düşürmesidir |
| **Neden ertelendi** | Doğrulaması gerçek tarayıcı turu ister; doğrulama turu zaman kutusu gereği tam tarayıcı turu yapmadı |
| **Sonraki adım** | Bir sonraki tarayıcı turunda: dev derlemesinde pencere açıkken **sonradan doğan, bekçisi olan** bir form açılsın ve patlamadığı görülsün. Patlıyorsa çözüm gözlemci geri çağrısını `queueMicrotask` yerine bir sonraki makrogörev turuna ertelemektir |

## TB-60 · `KONTROLSUZ_EKRANLAR`'ın 64 gerekçesi doğrulanmadı

| | |
|---|---|
| **Bulundu** | İP-A8 (kendi risk notu #3) + bağımsız doğrulama turu (21 Ağu 2026 · D-4) |
| **Nerede** | `frontend/src/__guards__/calismaZamaniKapisi.test.tsx` → `KONTROLSUZ_EKRANLAR` |
| **Sorun** | Kayıt kimlikle dondurulmuş ve iki yönlü korunuyor (bir ekran kontrol basmaya başlarsa da, susarsa da kırmızı) — ama **listenin kendisi ölçümden türetildi**: "bugün kontrol basmayan ekran". Gerekçe kodları elle verildi ve 40'tan fazla ekran `kosullu` yazıyor; hiçbiri bir dal testiyle doğrulanmadı. Liste yazıldığı anda zaten sessizce boşalmış bir ekran sonsuza dek `kosullu` kalır ve fark edilmez |
| **Neden bu B-5'in tekrarı DEĞİL** | B-5'te eşik (`toplamKontrol >= 39`) çökmüş ölçüme kalibreydi ve hiçbir şey ayırt etmiyordu. Burada liste 24 ekranda gerçek bir iddia taşıyor ve iki yönlü. Aynı ailenin daha zayıf üyesi, aynı kusur değil |
| **Neden ertelendi** | Doğrusu her `kosullu` ekranın bir dal testinde kontrol bastığını sınamaktı; 40+ ekran için kabul testi yazmak İP-A8'in kapsamının katbekat üstünde |
| **Sonraki adım** | `kosullu` yazan her ekran için ya bir dal testi (ekranın kontrol bastığı hâli) ya da gerekçenin daraltılması (`sunum`/`kabuk`/`pencere-kabugu` gibi ölçülebilir sınıflara) |

## TB-61 · Duvar saatine bağlı bekleyiş 56 test dosyasında ayakta (B-4'ün sınıfı)

| | |
|---|---|
| **Bulundu** | Bağımsız doğrulama turu (21 Ağu 2026 · D-5) |
| **Nerede** | `frontend/src` altında `findBy*`/`waitFor` kullanan **56** test dosyası |
| **Sorun** | Denetim #3'ün B-4'ü (karışık tohumda zaman aşımı) İP-A8'de **örnek bazında** kapatıldı: A8 reçeteyi (`act` ile makrogörev akıtması + iddiayı eşzamanlı `getBy*` yapmak) yalnız dokunduğu iki dosyada uyguladı. Sınıf kapanmadı — `findBy*`'ın 1000 ms'lik bütçesi hâlâ makine hızına bağlı bir iddiadır |
| **Ölçüm** | Doğrulama turunda `src/` altına tek bir ağır sonda dosyası eklendiğinde `adminKataloglarGoc.acceptance` (17 `findBy*`/`waitFor` içeriyor) bir tohumda kırmızı düştü. Temiz ağaçta 6/6 tohum yeşil, yani bugün CI'da canlı değil |
| **Etki** | Yalancı kırmızı riski. Yükü artan bir CI makinesi bu 56 dosyanın herhangi birinde aynı düşüşü üretebilir ve [[TB-36]] gereği "yerelde geçiyor" bir kez daha flaky tanısı olarak okunmamalı |
| **Neden ertelendi** | İP-A8 denetim #3'ün bulgularını kapatmak için kuruldu; 56 dosyayı dönüştürmek ayrı bir pakettir |
| **Sonraki adım** | Reçeteyi kalan dosyalara yaymak ve nöbetçisini `beklemeButcesi` envanterine bağlamak (dosya başına `waitFor` sayısı dondurulur, yenisi gerekçesiz doğamaz) |

## TB-62 · B-16'nın (iki `useUrlDurumu` örneği) nöbetçisi yok

| | |
|---|---|
| **Bulundu** | Bağımsız denetim #3 (B-16) + doğrulama turu (21 Ağu 2026 · D-6) |
| **Nerede** | `frontend/src/hooks/useUrlDurumu.ts` |
| **Sorun** | Aynı sayfada iki `useUrlDurumu` örneği aynı olayda yazarsa birincinin yazdığı **sessizce kayboluyor** (A6c·BULGU-4'ün çözümü hook örneği başına). Bugün canlı değil: doğrulama turu yedi tüketicinin **hepsinde tek örnek** ölçtü (`AdminAuditLogsPage`, `AdminBookingsPage`, `AdminPayoutsPage`, `CountSessionsPage`, `DamageEventsPage`, `PackagesPage`, `AdminHome`) |
| **Asıl eksik** | Borç yazıldı, **kapısı yazılmadı**. İkinci bir örnek sessizce doğabilir — kapısız borç, canlıya dönebilen borçtur |
| **Neden ertelendi** | Kusurun kendisinin düzeltilmesi `bekleyenRef`i hook örneğinden modül düzeyine taşımak, yani A6c·BULGU-4'ün çözümünü yeniden tasarlamak demek; ayrı paket |
| **Sonraki adım** | **Ucuz olan önce:** "bir dosyada tek `useUrlDurumu` çağrısı" kaynak nöbetçisi (tek `it`). Asıl düzeltme ondan sonra, kendi paketinde |

## TB-63 · `ExamSessionsManager` `!dirty`: sınıflandırma ile kod yorumu çelişiyor

| | |
|---|---|
| **Bulundu** | Bağımsız doğrulama turu (21 Ağu 2026 · D-2'nin ikinci ayağı) |
| **Nerede** | `frontend/src/components/ExamSessionsManager.tsx:684-690` ↔ `frontend/src/__guards__/gonderDugmesi.test.ts` → `KAYIT` |
| **Sorun** | Düğme nöbetçide `gecerlilik-borc` (kilitli kararın ihlali) sınıfına yazılı; oysa kodda yanı başında *"'Kaydet' DEĞİŞİKLİK YOKKEN kapalıdır ve bu bir geçerlilik kapısı DEĞİLDİR"* yorumu duruyor. İkisi aynı anda doğru olamaz: ya sınıf `onkosul`/`secim` olmalı, ya yorum yanlış |
| **Bugün hangi taraf** | Sınıf **bilinçli olarak `gecerlilik-borc`ta bırakıldı** — güvenli taraf borç saymaktır; aklamak, kilitli kararın gerçek bir ihlalini envanterden düşürme riski taşır |
| **Neden ertelendi** | Cevabı bir ürün kararı: "kaydedilecek bir şey yokken Kaydet kapalı olmalı mı" sorusu kilitli kararın kapsamına girip girmediğiyle ilgili ve bu, göç kararlarının sahibiyle konuşulmalı |
| **Sonraki adım** | Karar verilsin ve **ikisi birlikte** düzeltilsin: ya sınıf değişir ve kod yorumu kaynak gösterilir, ya yorum silinir ve düğme hata slotuna bağlanır |

## TB-58 · Varyant testlerinin izolasyon sınırları (denetim P2-8)

| | |
|---|---|
| **Bulundu** | Varyant paketi bağımsız denetimi (18 Ağu 2026, P2-8 — merge sonrasına ertelendi) |
| **Nerede** | `tests/integration/test_variant_*_pg.py` fixture'ları |
| **Sorun** | Denetim raporundaki tanımıyla test izolasyonu bulgusu (rapor metni repoda değil; buradaki özet denetim çıktısının başlığından). Bilinen zayıf noktalar: q'suz kipler kategori-daraltmasıyla izole ediliyor ama `test_facet_eksen_adina_gore_gruplanir` facet ucunu KATALOG GENELİ sorguluyor (işaretli değerlerle ayrışıyor, yine de paralel koşumda sayım varsayımları kırılgan); duman verisi/`adana_verify` provası gibi elle kurulan veriler nöbetçi dışı |
| **Neden ertelendi** | Suite bugün deterministik geçiyor; sertleştirme davranış değiştirmez |
| **Sonraki adım** | Denetim raporunun tam metniyle karşılaştırıp facet testlerini kendi kategorisine daraltmak; varyant fabrikalarının teardown'larını `_hijyen_nobetcisi` tablolarıyla hizalamak |

## TB-54 · Vitest suite'inde tanımlanamayan tek seferlik kırılma

| | |
|---|---|
| **Bulundu** | İP-21 kapanış kapıları (15 Ağu 2026) |
| **Ne oldu** | `npx vitest run` bir koşumda `1 failed \| 916 passed` verdi; **ardından dört koşumda da 917/917 geçti** ve kırılan düğümün adı yakalanamadı (çıktı filtrelenirken kayboldu) |
| **Neden kayda geçiyor** | Bu depoda "yerelde geçiyor" bir kez daha flaky tanısı konmasın diye ([[TB-36]]): tek seferlik kırılma **kanıt yokluğu değildir**. Ad bilinmediği için sınıfı da bilinmiyor — gerçek bir yarış mı, `act()` uyarısı üreten bir asenkron güncelleme mi, [[TB-23]]'ün timeout kökü mü |
| **Sonraki adım** | Kırılma tekrarlanırsa **ad kaybedilmeden** yakalansın: `npx vitest run --reporter=json --outputFile=vitest.json` ile koşulup `vitest.json` saklanır. CI için de aynısı düşünülmeli — bugün CI çıktısı da yalnız insan-okur biçimde |
| **Etki** | Bilinmiyor. Yön belirsiz: gerçek bir yarışsa üretim davranışını da etkileyebilir, test-tarafı asenkron kurulum sorunuysa yalnız gürültüdür |

## TB-53 · `delete_vehicle`'ın 409 kontrolü kontrol-sonra-yaz yarışına açık

`services/delivery_service.py::delete_vehicle` açık tur sayısını okur, sonra
soft-delete yazar; arada kilit yoktur. Teorik olarak "araç silinirken aynı anda
o araca tur açılması" hem 409'u atlatabilir hem `fk_delivery_runs_vehicle_id`
RESTRICT'ini devre dışı bırakabilir (soft-delete FK'yi tetiklemez).

Bağımsız denetim de (M-7) kaybeden sıralamayı üretmeyi denedi ve **üretemedi**;
yapısal boşluk yine de duruyor. Çözüm `SELECT … FOR UPDATE` ile aracı kilitlemek
ya da kısmi unique index benzeri bir DB kısıtı. Kapsam dışı: gerçek zarar için
aynı saniyede iki admin gerekir ve sonucu geri alınabilirdir (araç yeniden
aktifleştirilir).

---

---

## TB-52 · Gün tahtasında üç sürükleme kipinden yalnız biri var

İP-19 sözleşmesi §4.2 üç kip vaat ediyordu: **havuzdan araca**, **araçtan
araca**, **araç içinde sıra değiştirme**. Yazılan yalnız birincisidir
(`DeliveryBoardPage.tsx::handleDrop`); ikincisi ve üçüncüsü yok. Bağımsız
denetim (B-11) bunu ölçtü ve sözleşme metni düzeltildi.

Etki sınırlı: sıra değiştirme uçtan (`PUT /delivery/runs/{id}/reorder`) zaten
mümkün ve tur detay ekranından yapılabiliyor; araçtan araca taşıma için durak
silinip diğerine eklenmesi gerekiyor (iki ayrı çağrı, atomik değil). Kapsam
dışı bırakıldı çünkü yarım bir sürükleme yüzeyi, hiç olmayanından kötüdür:
atomik olmayan taşıma yarıda kalırsa durak hiçbir turda kalmayabilir.

---

---

## TB-50 · Yetki belgesi varsayımı doğrulanmadı — K2 değil muhtemelen P1*

| | |
|---|---|
| **Bulundu** | İP-19 araştırma turu, 15 Ağu 2026 |
| **Yer** | Kod değil — operasyonun yasal zemini. Dolaylı: `docs/pk1-deployment-checklist.md` (lansman kontrol listesi) |
| **Durum** | Kendi aracıyla şehir içi teslimat için gereken belge, araştırmada varsayıldığı gibi K1/K2 ekseninde **değil**: Karayolu Taşıma Yönetmeliği kurye/dağıtım faaliyetini **P türü** belgeye bağlıyor. **P1\*** = il içi kurye taşımacılığı, sınırlı taşıt sayısı, otomobil+motosiklet+kamyonet kaydedilebiliyor. K2 ("kendi esas iştigal konusu") savunması **pazaryeri modelinde çökebilir**: eğitmenin fiziksel ürünü taşınıyorsa mal bize ait değildir; hangi belgenin gerektiği **faturayı kimin kestiğine** bağlıdır |
| **Ölçülmedi** | ⚠️ P1\*'ın taşıt sayısı sınırı ve ücreti **belge aracısı sitelerinden** alındı; resmî KTY metninden **teyit edilemedi**. Ayrıca internette dolaşan "3,5 ton altı şehir içi muafiyeti" iddiası **muhtemelen 2008'de sona ermiş** — eşya taşımacılığı için geçerli değil |
| **Etki** | Belgesiz ticari taşıma idari para cezası ve faaliyet durdurma riski taşır. Lansmanla birlikte teslimat başlayacağı için bu, **lansman öncesi kapanması gereken** bir kalemdir |
| **Neden şimdi düzeltilmedi** | Kod işi değil; başvuru ve mali müşavir/mevzuat işi |
| **Sonraki adım** | (1) **e-Devlet U-NET** veya Adana Ulaştırma Bölge Müdürlüğü'nden **yazılı teyit** al — belge aracısı sitelerine güvenme; (2) fatura akışını mali müşavire göstererek K2/P1\* ayrımını netleştir; (3) sonucu `pk1-deployment-checklist.md`'ye madde olarak yaz |

---

## TB-49 · Kurye ekranı hız baskısı üretiyor olabilir — hem mevzuat hem muvazaa riski

| | |
|---|---|
| **Bulundu** | İP-19 araştırma turu, 15 Ağu 2026 |
| **Yer** | `frontend/src/pages/courier/` saha ekranı · `DeliveryRun` ETA alanları · teslimat söz zinciri |
| **Durum** | İki ayrı risk aynı ekranda buluşuyor. **(a) Mevzuat:** kurye düzenlemelerinde platformların sürücü üzerinde **hız baskısı** kurması ve **makul olmayan teslimat süresi taahhüdü** dayatması yasaklanmıştır. **(b) Muvazaa:** Yargıtay/BAM içtihadı, alt işveren veya "esnaf kurye" üzerinden çalıştırılan kuryelerde **platformu asıl işveren** sayabiliyor; *"platform yalnızca teknoloji şirketi olduğunu ileri sürerek sorumluluktan kurtulamaz"*. Bu davada **ekranın kontrol sıkılığı delil** olur: kim rotayı belirliyor, kim sırayı dayatıyor, kim süre ölçüyor |
| **Ölçülmedi** | ⚠️ Hız baskısı yasağının **tam metni ve yaptırımı birincil kaynaktan doğrulanamadı** (yönetmelik PDF'i makine-okunur değil). İddia ikincil kaynaklardan; teyit edilmeli |
| **Etki** | Şahıs şirketi ölçeğinde tek bir muvazaa davası (kıdem + ihbar + fazla mesai + geriye dönük SGK) ağırdır. Mevzuat tarafı ise idari yaptırım riski |
| **Neden şimdi düzeltilmedi** | Kurye istihdam biçimi henüz kararlaşmadı (kurucu mu taşıyacak, ücretli kurye mi). Ekran tasarımı bu karara bağlı; karar verilmeden tasarım değiştirmek erken |
| **Sonraki adım** | (1) Yasağın tam metnini Resmî Gazete'den teyit et; (2) kurye ekranında **geri sayım/süre sayacı yerine rota sırası** göster — süre sözü müşteriye verilir, kuryeye dayatılmaz; (3) ücretli kurye alınacaksa **SGK'lı** tercih et, esnaf-kurye modelinden uzak dur |

---

## TB-48 · Teslimat sözü BAĞLAYICI bir taahhüttür ve 30 gün kalkanını kaldırır

> **Öncelik: yüksek — LANSMAN ÖNCESİ ürün+hukuk kararı.** Bu bir kod kusuru
> değil; çalışan ve amaçlandığı gibi davranan bir özelliğin **hukuki
> pozisyonunun** ölçülmemiş olması.

| | |
|---|---|
| **Bulundu** | İP-19 araştırma turu, 15 Ağu 2026 — Türkiye teslimat mevzuatı taraması |
| **Yer** | `backend/services/delivery_promise.py` (16:00 cutoff → `Order.promised_delivery_date`) · `GET /store/delivery-info` · `frontend/src/components/DeliveryPromiseBadge.tsx` (geri sayımlı söz rozeti; ürün/sepet/checkout) · `frontend/src/lib/legalContent.ts` (ön bilgilendirme metni) |
| **Durum** | Mesafeli Sözleşmeler Yönetmeliği (RG 27.11.2014/29188) **m.16/1**: satıcı "**taahhüt ettiği süre içinde**" ifa etmek zorundadır; otuz gün **her hâlükârda üst sınırdır**, taahhüt edilen süre **alt sınırı** belirler. **m.16/2**: yükümlülük yerine getirilmezse tüketici **sözleşmeyi feshedebilir**. **m.16/3**: fesihten itibaren **14 gün içinde** tüm ödemeler **yasal faiziyle** iade edilir. **m.5/1-f**: ön bilgilendirmedeki teslim süresi, **ticari reklamda taahhüt edilen süreyle uyumlu** olmalıdır |
| **Etki** | Platform "aynı/ertesi gün" sözünü **sisteme yazmış** durumda (rozet geri sayım gösteriyor, `promised_delivery_date` sipariş satırında yaşıyor). Bu, pazarlama vaadi değil bağlayıcı taahhüttür: tutulmadığı her siparişte tüketici **30 günü beklemeden** fesih + faizli iade hakkı kazanır. Kendi filoyla teslimatta gecikme sebepleri (araç arızası, kurye hastalığı, hava) tamamen bizim riskimizdedir |
| **Neden şimdi düzeltilmedi** | İP-19'un konusu **kaynak modelidir** (araç/vardiya/planlama). Metin değişikliği ayrı bir karar ve **avukat onayı** ister; yasal metinler zaten toplu onay bekliyor. Ayrıca teknik düzeltme değil ürün kararı: "aynı gün" vitrinde kalacak mı, kalacaksa hangi istisnalarla |
| **Sonraki adım** | (1) Ön bilgilendirme formundaki **bağlayıcı süreyi** pazarlama vaadinden AYIR — vitrinde "aynı gün", sözleşmede "en geç X iş günü"; (2) `DeliveryPromiseBadge`'in dilini buna hizala; (3) mevcut ürün/hava/trafik istisnalarını metne yaz; (4) avukat onayına gönder |

---

## TB-40 · Kilit sırası nöbetçisi (D9) kandırılabilir — `FOR UPDATE OF o` deseni hem davranış hem kaynak sözleşmesini geçiyor

| | |
|---|---|
| **Bulundu** | İP-18 bağımsız audit'i (14 Ağu 2026); denetçi çalışan bir kaçış üretti ("mutasyon G") |
| **Yer** | `backend/tests/integration/test_ip18_siparis_kilit_pg.py::test_yesil_checkout_yolu_order_kilidini_urunden_once_almaz` + `backend/tests/acceptance/test_stock_lock_contract.py` |
| **Kaçış** | Order kilidi `SELECT … FROM <başka tablo> JOIN orders … FOR UPDATE OF o` biçiminde alınırsa: D9'un eşleştiricisi `"for update" in s and "from orders" in s` arar — JOIN'de `orders` **ikinci** tablodur, `from orders` geçmez → **görülmez**. Kaynak sözleşmesi de `_lock_order`/`_siparis_para_claimi` adlarını arar, ham `select()` çağrısını tanımaz → **görülmez**. Yani kilit sırası ters çevrilebilir ve iki nöbetçi de sessiz kalır |
| **Kurgusal değil** | `select(Order).join(OrderItem).with_for_update(of=Order)` tam bu SQL'i üretir; kod tabanında benzer desen zaten var (`delivery_service.handover_scan` → `.with_for_update(of=Order)`) |
| **Etki** | Bugün gerçek bir ihlal YOK; bu bir **nöbetçi kapsamı** boşluğudur. Ama İP-18 sözleşmesi §8/1 "D9 tek nöbetçidir" diyor ve o tek nöbetçinin kör noktası şimdi ölçülmüş durumda |
| **Neden ertelendi** | Doğru çözüm dizgi eşleştirmesini bırakıp kilitlenen **tabloyu** SQL'den ayrıştırmak ya da PostgreSQL tarafından gözlemektir (`pg_locks` anlık görüntüsü: hangi ilişki, hangi sırada `RowExclusiveLock`/`RowShareLock` aldı). İkisi de İP-18'in kapsamından büyük ve ayrı bir doğrulama aracı ister |
| **Sonraki adım** | (1) Kısa vade: D9'un eşleştiricisini `for update` + (`from orders` **veya** `join orders` **veya** ` of o`/`of orders`) olarak genişlet ve **pozitif kontrol** ekle (bilinen kaçış SQL'i verildiğinde eşleştirici onu görmeli); (2) uzun vade: `pg_locks` tabanlı gerçek kilit-sırası gözlemcisi — dizgiden bağımsız tek yöntem budur |

## TB-39 · İP-2b'nin "iade edildi **YA DA** görünür hata" ayrık iddiası bir P0'ı 11 gün boyunca maskeledi

| | |
|---|---|
| **Bulundu** | İP-18 Faz 5 (14 Ağu 2026), D11 düğümü yazılırken — gerçek PG'de ölçüldü |
| **Yer** | `backend/tests/integration/test_ip2b_cancel_callback_pg.py::test_kirmizi_reconciler_partisi_zehirlenmez` (~`:255-266`) |
| **İddia** | `assert iade_edildi or gorunur` — "ölü siparişin tahsilatı ya otomatik iade edilir YA DA görünür bir ERROR kaydı bırakır" |
| **Ne oldu** | Reconciler yolu `InvalidRequestError` fırlatıyor, `logger.exception` yazılıyor → `gorunur` **True** → test yeşil. Oysa oluşan durum iddianın **iki şıkkından da değildi**: satır `payment_status='REFUNDED'` yazıyor ama sağlayıcıya iade **hiç gitmemiş**. Yani "iade edildi" diyen ama parayı döndürmemiş kayıt. Kusur `2e4fefc` (3 Ağu) ile geldi, 14 Ağu'da bulundu |
| **Ders** | Ayrık (`A or B`) kabul iddiası, ölçmediği bir **üçüncü** durumu sessizce kabul eder. "Görünür hata bıraktı" bir başarı ölçütü değildir; o hatanın **hangi hata** olduğu ölçülmelidir |
| **Bugünkü durum** | Üretim kusuru **KAPANDI** (İP-18 `42aed0e`, savepoint kaldırıldı). Komşu paketin kabul iddiasına **DOKUNULMADI** — "kabul testleri sessizce değişmez" (`feedback_delivery_gates`); daha dar nöbetçi kendi paketinde açıldı (`test_ip18_siparis_kilit_pg::test_yesil_reconciler_taramasi_olu_siparisi_de_kapsar`: `REFUNDED` **ve** tam bir sağlayıcı çağrısı) |
| **Açık kalan** | (1) İP-2b'nin ayrık iddiası hâlâ orada ve hâlâ aynı sınıf durumu kabul edebilir — daraltılması İP-2b sahibinin bilinçli kararıdır; (2) kod tabanında `assert X or Y` biçimli başka kabul iddiaları var mı, taranmadı |
| **Sonraki adım** | (a) İP-2b iddiasını "iade edildi **VEYA** `MANUAL_REVIEW` durumu yazıldı" gibi **ölçülebilir** iki şıkka daralt (serbest metin log'u şık sayma); (b) `tests/` altında ayrık kabul iddialarını tara ve her birinin üçüncü durumu kabul edip etmediğini sor |

## TB-38 · Kaynak sözleşmesi testleri **ada duyarlı, davranışa kör** — yeniden adlandırma onları sessizce körleştiriyor

| | |
|---|---|
| **Bulundu** | İP-18 Faz 3 + Faz 4 (13-14 Ağu 2026); iddia **mutasyon provasıyla ÖLÇÜLDÜ**, örnekle değil |
| **Yer** | `backend/tests/acceptance/test_stock_lock_contract.py` (temsilci vaka) + aynı aileden iki kayıt daha (aşağıda) |

**Kanıt (İP-18, iki mutasyon, aynı test):**

| Mutasyon | Ne yapıldı | Davranış bozuldu mu | `test_finalize_paid_urun_kilidini_claimden_ONCE_aliyor` |
|---|---|---|---|
| IP18-5 | `_finalize_paid`'e `_lock_order` eklendi → **Order kilidi Product'tan ÖNCE** (testin koruduğunu iddia ettiği ihlalin ta kendisi) | **EVET** | **KIRILMADI** |
| IP18-2 | Claim çağrısı `_siparis_para_claimi` → `escrow.claim` olarak **yeniden adlandırıldı** (davranış aynı) | HAYIR | **KIRILDI** |

Yani sözleşme, korumakla görevli olduğu ihlale kör; zararsız bir yeniden
adlandırmaya duyarlı. **Tam tersi olmalıydı.** Sebep yapısal: iddia iki çağrı
adının satır numaralarını karşılaştırıyor; araya sokulan **üçüncü** bir kilit
çağrısı onun görüş alanında değil. İhlali yalnız davranış nöbetçisi yakaladı —
`test_ip18_siparis_kilit_pg::test_yesil_checkout_yolu_order_kilidini_urunden_once_almaz`
(gerçek `before_cursor_execute` gözlemi: gönderilen SQL'de `FOR UPDATE …
products` ile `UPDATE orders` sırası).

**Aynı aileden üç vaka:**

| # | Vaka | Nasıl körleşir |
|---|---|---|
| 1 | **İP-18 / bu tur** — `test_stock_lock_contract` kilit sırası matrisi | Aradaki üçüncü kilit çağrısını görmez; ad değişince "bulunamadı" der |
| 2 | **İP-16** — D-6c öncesi **elle yazılmış uç listesi** | Liste elle tutuluyor; yeni bir uç eklendiğinde listeye girmezse sözleşme onu hiç denetlemez ve sessizce geçer |
| 3 | **İP-14** — `SAYFALAR` listesi ([[TB-32]]/9) | Nav kapsamı elle listeye çivili; listeye eklenmeyen sayfa denetim dışı kalır |

**Kural (iki maddeli, yeni kaynak sözleşmesi yazan herkes için):**

- **(a) Yanında davranış nöbetçisi durmalı.** Kaynak/AST sözleşmesi tek başına
  "özellik tamamlandı" kanıtı değildir (kök `CLAUDE.md` §C zaten böyle diyor);
  İP-18 ölçümü bunu somutlaştırdı — kaynak sözleşmesi **yanlış şeye duyarlı**
  olabilir, yani yalnız zayıf değil **yanıltıcı** olabilir.
- **(b) "Bulunamadı" BAŞARISIZLIK sayılmalı**, "yok, o yüzden geçti"
  olmamalıdır. `test_stock_lock_contract` bunu doğru yapıyor (`eksik` listesi
  boş değilse `assert` düşüyor) ve İP-18'de tam da bu sayede görüldü. Aynı
  disiplin elle tutulan listelerde YOK: liste boşalırsa/ küçülürse hiçbir şey
  kırılmıyor (bkz. [[TB-12]]/(b) — `_admin_rota_kimlikleri()` boş dönerse 29
  düğüm sessizce kaybolur; aynı sınıf).

| | |
|---|---|
| **Neden ertelendi** | Üç vakanın düzeltmesi üç ayrı pakete ait; İP-18 kendi vakasını davranış nöbetçisiyle kapattı (D9) ama kuralı tüm kaynak sözleşmelerine uygulamak ayrı bir tarama turu ister |
| **Sonraki adım** | (1) `tests/acceptance` ve `tests/*_contract*` altındaki her kaynak sözleşmesi için "yanında davranış nöbetçisi var mı" envanteri; (2) elle tutulan her liste için "liste boş/küçüldü ise kır" nöbetçisi; (3) kural kök `CLAUDE.md` §C'ye eklensin (bugün §C "düşük güçlü" diyor, "yanıltıcı olabilir" demiyor) |

## TB-37 · `_out_of_stock_refund` bayat yaşam döngüsü okuyor — çift `CANCELLED` geçmişi + çift müşteri bildirimi (I11)

| | |
|---|---|
| **Bulundu** | İP-18 Faz 3 (14 Ağu 2026), düzeltme sonrası kalan bulgu olarak — kod okumasıyla, koşularak ÜRETİLMEDİ |
| **Yer** | `backend/services/order_service.py::_out_of_stock_refund` (`_finalize_paid`'in stok yetersizliği dalından çağrılır) |
| **Durum** | İP-18, PAID claim'ini yaşam döngüsü koşuluna bağladı. Ama stok yetersizliği dalı claim'den **ÖNCE** koşar ve `order` nesnesinin **bayat** `status` alanını taşır. Sipariş bu arada iptal edilmişse: `escrow.begin_refund(from_statuses=["PENDING","FAILED"])` yaşam döngüsüne bakmadan geçer, `settle_refunded_order` bayat `order.status == "PENDING"` görüp `transition_order(…, "CANCELLED")` çağırır |
| **Etki** | **Para etkisi YOK** — tahsilat zaten iade edilmeli ve ediliyor. Zarar kayıt kalitesinde: `order_status_history`'ye **ikinci** bir `CANCELLED` satırı ve müşteriye **ikinci** bir iptal bildirimi (İP-2b I11 "bildirim tam bir kez" ihlali). Satır durumu doğru kalır (`CANCELLED` üstüne `CANCELLED`) |
| **Neden ertelendi** | İP-18'in kabul edilmiş kırmızı matrisinde bu senaryonun düğümü YOK. Kırmızı test olmadan üretim kodu değiştirmek paketin kendi disiplinini bozar (`feedback_delivery_gates`: test matrisi koddan ÖNCE, ayrı commit). Matrisi tek taraflı büyütmek de kabul sözleşmesini sessizce kaydırırdı |
| **Sonraki adım** | (1) Deterministik düğüm: stok yetersizliği + eşzamanlı iptal → geçmişte tek `CANCELLED`, bildirim tek; (2) düzeltme muhtemelen `_out_of_stock_refund` girişinde taze durum okuması (`_taze_siparis_durumu`) + `begin_refund`'a `extra_where` — yani İP-18'in kurduğu boğaz noktasının aynısı |

## TB-36 · "CI'da düştü, yerelde geçiyor" bir kez daha flaky sayıldı — bu tanı iki kez gerçek bir üretim yarışını geciktirdi

| | |
|---|---|
| **Bulundu** | İP-18 açılış turu, 13 Ağu 2026 — `test_ip2b_cancel_callback_pg::test_yesil_iptal_callback_yarisinda_cift_durum_yok` CI'da düşüp yerelde geçince "flaky" denip geçildi. Test deterministik hâle getirilince (pencere kapıyla açıldı) altından **gerçek bir üretim yarışı** çıktı: iptal ↔ callback eşzamanlılığında para kaybı. İkinci kez aynı yanlış tanı — bu yüzden kayıt tek bir teste değil, **tanıya** açılıyor |
| **Yer** | Yarışı `asyncio.gather` ile kuran testler — bugün en az iki tanesi: `backend/tests/integration/test_ip2b_cancel_races_pg.py:47` (`test_yesil_cift_musteri_iptali_tek_kazanan`, `gather(_iptal, _iptal)`) ve `test_ip2b_cancel_callback_pg.py:346` (`test_yesil_iptal_callback_yarisinda_cift_durum_yok`, `gather(_cb, _cancel)`). Desen aynı: iki görev aynı anda salınır, kaybedenin kilidi **hangi anda** aldığı planlayıcıya bırakılır |
| **Ölçüm — neden "20 kez koştum geçti" kanıt değil** | Sayı zaten kendi commit mesajımızda yazılı: `59afdac` (3 Ağu) mutasyon provasında **kusurlu kodda gather testi 10 koşumda yalnız 2 kez kırıldı** (%20 yakalama); aynı turda eklenen deterministik nöbetçi `races::test_yesil_iade_penceresinde_ikinci_iptal_409` **1/1** yakaladı. Yani olasılıksal bir yarış testinin yerelde 20 kez geçmesi, hatanın yokluğunu değil pencerenin dar olduğunu ölçer. CI runner'ı daha yavaş ve daha yüklü olduğu için pencere **orada** açılır |
| **Ölçüm — iki vakanın gerçek seyri** | (a) 3 Ağu, `races::test_yesil_cift_musteri_iptali_tek_kazanan`: düşüş İP-2b merge koşumundaydı (merge `9b2123b`) ve **kovalandı** — `59afdac` merge'den SONRA gelip `_cancel_order`'daki `payment_status == "PAID"` sınıflamasını düzeltti (`REFUNDING` "ödenmemiş sipariş" dalına düşüyor, iki kazanan + ikinci "iptal edildi" bildirimi üretiyordu). O commit'in mesajı tanıyı zaten yazmış: *"kusurlu kod bu yüzden yerelde yeşil, CI'da kırmızı görünüyordu"*. **Ama testin kendisi dokunulmadan bırakıldı** — hâlâ olasılıksal `gather`, yanına deterministik nöbetçi kondu. (b) 13 Ağu, `callback::test_yesil_iptal_callback_yarisinda_cift_durum_yok`: dosyaya son commit `cd592ea` (1 Ağu); düşüşten sonra ne teste ne kapsadığı üretim yoluna commit geldi, düşüş flaky sayıldı → İP-18'in konusu olan yarış açıkta kaldı |
| **Etki** | Yanlış tanının maliyeti doğrudan para: eşzamanlı iptal/callback yolunda çift durum, çift bildirim ve iade ↔ tahsilat çakışması. Daha kalıcı zarar ise **suite'in güvenilirliği**: "bu dosya zaten arada düşer" etiketi bir kez yapıştıktan sonra aynı testin sonraki düşüşleri de okunmadan kapatılır. İki vaka bunu kanıtlıyor |
| **Kural (asıl borç bu)** | **CI'da düşen bir test yerelde geçiyorsa, önce zamanlama penceresini KODDA ara.** "N kez koştum geçti" bir kanıt değildir — negatif sonucun gücü pencerenin genişliğine bağlıdır ve o genişliği makine belirler. Bir yarış testi ancak pencereyi **deterministik olarak açtıktan** sonra (kapı/`asyncio.Event`, sağlayıcıda askıya alma; `sleep` DEĞİL) "geçti" diyebilir. `59afdac`'ın nöbetçisi bu desenin kanonik örneğidir: `provider.refund_gate` + `provider.refund_entered` ile pencere açık tutulur, kaybeden tam o anda kilidi alır |
| **Neden şimdi düzeltilmedi** | Kural yazıldı, **kodda karşılığı henüz yok**: iki `gather` testi olasılıksal hâlleriyle duruyor. Bunları deterministik nöbetçiye çevirmek İP-18'in konusudur (callback yarışının üretim düzeltmesiyle birlikte); races tarafındaki eşi ise ayrı bir tur — üretim kusuru zaten kapandığı için acil değil, ama test olasılıksal kaldığı sürece bir sonraki regresyonu yine %20 olasılıkla yakalar |
| **Sonraki adım** | (1) İP-18 kapanışında callback yarışını kapı desenine çevirmek; (2) `asyncio.gather` ile kurulan **tüm** yarış testlerini taramak ve her birinin yanına deterministik bir nöbetçi koymak (ya da kendisini çevirmek); (3) kuralı `CLAUDE.md` §D/§F ailesine yazmak — **"CI kırmızı + yerel yeşil" flaky etiketi için gerekçe değil, zamanlama penceresi kanıtıdır** (aynı aile: [[TB-14]]/8'in "azaldı ama sürüyor" kaydı gerçek flaky'yi anlatır — ikisi karıştırılmamalı: orada kanıt ÖLÇÜLDÜ, burada varsayıldı) |

## TB-35 · ~~Geliştirme veritabanı `ceyhandb`, merge EDİLMEMİŞ bir dalın migration'ıyla damgalı — main'de alembic hiç çalışmıyor~~ **KAPANDI**

> ✅ **KAPANDI (14 Ağu 2026, `sm2-kaldirma` merge'i).** Kayıt bir kod kusuru
> değil, bir **durum** kaydıydı: damga geçerliydi ama gösterdiği revizyon
> yalnız açık bir dalda yaşıyordu. O dal main'e indi ve damga
> kendiliğinden geçerli hâle geldi — hiçbir müdahale yapılmadı, hiçbir
> `stamp` zorlanmadı (kayıt bunun **yanlış** olacağını söylüyordu ve haklıydı).
>
> Merge sonrası ölçüm (`ceyhandb`, salt okunur):
> `alembic current` = `sm2_flashcard_kaldirma (head)` = `alembic heads`.
>
> **Kaydın kalıcı dersi geçerliliğini korur** ve silinmedi: bir feature
> dalının migration'ını doğrudan geliştirme veritabanına uygulamak, o
> veritabanını dala **kilitler**. Hata migration'da değil, *nerede
> koşulduğundadır*. Bu tur şanslı bitti (dal merge edildi); dal terk
> edilseydi `ceyhandb` çözümlenemeyen bir damgayla kalacaktı ve [[TB-30]]
> zincirine düşecekti.


| | |
|---|---|
| **Bulundu** | İP-14 merge turu, 13 Ağu 2026 — merge sonrası "dev DB head'de mi" damga kontrolünde. Kod incelemesiyle değil, rutin bir doğrulama adımı beklenmedik biçimde patlayınca |
| **Yer** | `ceyhandb` (5432 yerel Postgres, **asıl dev verisi**) → `alembic_version.version_num = 'sm2_flashcard_kaldirma'` ↔ `backend/migrations/versions/sm2_flashcard_kaldirma.py` **yalnız `sm2-kaldirma` dalında** var |
| **Ölçüm** | `alembic current` (main'de, `POSTGRES_DB=ceyhandb`) → `FAILED: Can't locate revision identified by 'sm2_flashcard_kaldirma'`. Revizyon dosyası tüm yerel+uzak dallarda arandı: **yalnız `sm2-kaldirma`**; main'de eşleşme 0. Main'in head'i `ip16_srs_izin_kodu_hizalama` |
| **Etki** | Main'de çalışan **hiçbir oturum** ceyhandb'ye karşı alembic komutu koşamaz — `current`, `upgrade`, `check`, `stamp`, hepsi aynı hatayla düşer. Damga bilinmeyen bir revizyona işaret ettiği için Alembic zinciri çözemez. Uygulama açılışı da etkilenir: `AUTO_CREATE_DB=true` iken `ensure_schema` `upgrade head`'i subprocess olarak koşar ve aynı hatayı alır. **Veri kaybı riski yok**, ama dev ortamının şema aracı fiilen kilitli |
| **Kök sebep** | Bir **feature dalının migration'ı doğrudan dev veritabanına uygulandı**. O an mantıklıydı — dal içi duman turu için şema gerekiyordu — ama uygulama ceyhandb'yi o dala **kilitledi**: damga artık yalnız o dalda anlamı olan bir revizyonu gösteriyor. Yani hata migration'da değil, **nerede koşulduğunda** |
| **Neden şimdi düzeltilmedi** | Damgayı zorla değiştirmek (`stamp head`, downgrade denemesi) **yanlış olurdu**: `sm2_flashcard_kaldirma`'nın şema değişikliği ceyhandb'ye **fiilen uygulanmış** durumda. Damgayı ezmek, şemayı yanlış anlatan bir kayıt üretir ([[TB-30]] ile birebir aynı sınıf: "damga şemayı doğru anlatmıyor") ve `sm2-kaldirma`'nın devam eden işini bozar. Ayrıca o dal kullanıcının **açık işi**; başkasının yarım işine dokunmak ayrı bir karar |
| **Ne zaman kendiliğinden düzelir** | `sm2-kaldirma` main'e merge edildiğinde revizyon main'de de var olur ve damga çözülebilir hâle gelir. Yani bu kayıt bir **kilit**, kalıcı bir bozukluk değil — ama o merge'e kadar dev ortamında alembic yok |
| **Kural önerisi (asıl borç bu)** | **Dev veritabanına yalnız main'de var olan migration'lar uygulanır.** Dal içi duman turu **tek kullanımlık** bir DB'de koşulur (`POSTGRES_DB=<paket>_smoke_test`, suite zaten oluşturup `upgrade head` ile hazırlıyor — bkz. `tests/integration/conftest.py`), ceyhandb'de değil. İP-14 merge kapısı tam olarak böyle koşuldu (`ip14_merge_smoke_test`, sonra düşürüldü) ve hiçbir iz bırakmadı; bu kaydın konusu olan damga ise ondan **önce**, dal içi bir turda oluşmuş. Sonraki adım: (1) kuralı `backend/CLAUDE.md`'ye yazmak; (2) uzun vadede nöbetçi — dev DB'nin damgasının main'de çözülebildiğini söyleyen tek satırlık bir kontrol (aynı aile: [[TB-30]]'un "damga-şema nöbetçisi yok" maddesi, ikisi tek turda ele alınabilir) |

## TB-33 · Üç ayrı "gün sınırı" kavramı yan yana duruyor — hiçbir yerde topluca belgelenmemiş

| | |
|---|---|
| **Bulundu** | İP-14 ↔ main adaptasyon turu, 13 Ağu 2026 — merge kesişimi ölçülürken. Çakışma **değil**, birikme: üç kavram üç ayrı turda bağımsız doğdu ve hiçbiri diğerini bilmiyor |
| **Yer** | (1) `backend/core/config.py:372` `APP_UTC_OFFSET_HOURS: int = 3` — **sabit ofset**; `services/delivery_promise.py`, `delivery_service.py`, `order_service.py`, `booking_service.py`, `courier_account_service.py`, `core/outbox.py`, `api/routers/store.py` kullanıyor. (2) `backend/services/spaced_repetition/dayboundary.py::study_day` — **IANA `Europe/Istanbul` + 04:00 devrilmesi** (`params.ROLLOVER_HOUR = 4`), yalnız SRS kuyruğu. (3) `frontend/src/lib/operatorAgenda.ts::istanbulGunAnahtari` + `lib/datetime.ts::istanbulNow` — **IANA `Europe/Istanbul`, devrilme yok**, operatör ajandası ve kütüphane "şu an açık mı" |
| **Düzeltme (bağımsız denetim, 13 Ağu 2026)** | Yukarıdaki (3) frontend'i **tek kalem** sayıyor; gerçekte **iki ayrı üretici** var: `operatorAgenda.ts::istanbulGunAnahtari` (operatör ajandası) ve `datetime.ts::istanbulNow().dateStr` (`BookingModal.tsx:127`). İkisi de aynı bölgeyi ve aynı `en-CA` biçimini kullanır, bugün **aynı değeri** döner — ama iki ayrı fonksiyondur, biri değişirse diğeri sessizce ayrışır. Yani "üç kavram" aslında **dört üreticide** yaşıyor (backend sabit ofset · SRS 04:00 devrilmesi · frontend'in bu ikisi). Aynı dosyada üçüncü bir frontend sabiti daha var ama o gün anahtarı üretmez: `datetime.ts::istanbulInputToIso` **sabit `+03:00`** ile çalışır (backend'in `APP_UTC_OFFSET_HOURS`'uyla hizalı olsun diye) — birleştirme turunda o da haritaya konmalı. Kaynak: `docs/ip14-operator-panel-sozlesme.md` §2 (denetim düzeltmesi, `fab94ac`) |
| **Durum** | Üçü de **kendi bağlamında doğru** ve üçünün de gerekçesi kendi dosyasında yazılı: teslimat sözü sabit ofseti bilinçli seçiyor (`delivery_promise.py:7` "yerel gün `APP_UTC_OFFSET_HOURS` sabit ofsetiyle bulunur"); SRS'in 04:00 devrilmesi "gece 02:00'de çalışan öğrenci hâlâ dünkü kuyrukta" ürün kararı; operatör ajandasında devrilme **olmamalı** (kütüphanenin 23:30 rezervasyonu bugüne aittir). Yani bu kayıt bir hata bildirimi değil |
| **Etki** | Risk **birleştirme anında** doğuyor, bugün değil: yeni bir yüzey "bugün" hesaplarken hangisini alacağını bilmiyor ve dördüncü bir kopya yazma eğilimi yüksek. İki somut kırılganlık: (a) sabit `+3` DST'siz doğru — Türkiye 2016'dan beri kalıcı UTC+3, ama karar **mevzuata bağlı**, değişirse yedi dosyada yedi yerde aranır; (b) operatör ajandası ile SRS aynı ekranda buluşursa (öğrenci hem kütüphanede hem SRS kuyruğunda) iki farklı "bugün" aynı sayfada görünür ve hangisinin doğru olduğu **kullanıcıya** açıklanamaz |
| **Neden ertelendi** | Birleştirme kendi başına bir refaktör turu: yedi backend dosyası + iki frontend modülü + `params.ROLLOVER_HOUR`'un SRS'e özel kalması gerektiği kararı. İP-14 adaptasyon turunun kapsamı merge doğrulamasıydı; kapsam dışı üretim koduna dokunmak denetimden geçmiş kırmızı matrisi kaydırırdı |
| **Sonraki adım** | (1) Tek bir belgede (ya da `docs/`'ta kısa bir "zaman kararları" notunda) **üç kavramın da hangi yüzeye ait olduğunu** yazmak — kod birleştirmeden önce yalnız haritayı çıkarmak bile dördüncü kopyayı engeller; (2) sabit ofseti IANA'ya çevirmenin maliyetini ölçmek (`zoneinfo` zaten `dayboundary.py`'de var, tzdata bağımlılığı kabul edilmiş); (3) yeni "bugün" hesabı yazan her paketin üçünden **hangisini** kullandığını sözleşmesinde belirtmesini kural hâline getirmek |

## TB-32 · İP-14 P2 listesi (kütüphane operatörü paneli — on bir açık kayıt, öncelik sırasıyla)

| | |
|---|---|
| **Bulundu** | İP-14 (operatör paneli: bugün bloğu + gün grubu + ErrorState + operatör audit) dalında, 8 Ağu 2026 (`0449ee7`). Kayıtlar sözleşmede duruyordu (`docs/ip14-operator-panel-sozlesme.md` §10) ama **borç defterine hiç işlenmemişti**; bu satırlar 13 Ağu 2026 adaptasyon turunda eklendi |
| **Merge sonrası doğrulandı** | `7d0e7d6` (main → İP-14, `--no-ff`). Entegrasyon **1300 passed / 16 skipped / 0 failed** (598 s, `ip14_merge_test` izole DB'sinde); toplanan test main'de 1309 → birleşmişte **1316**, fark **tam +7** (İP-14'ün tek dosyası, başka test eklenmedi/kaybolmadı). Vitest main 81 dosya/837 test → birleşmiş **84/885**, fark **+3/+48** (sözleşmenin iddia ettiği rakam). `tsc -b` temiz · `ruff check` temiz · `npm run lint` 0 hata/34 uyarı (taban ile aynı) · tek Alembic head `ip16_srs_izin_kodu_hizalama` · migration üretilmedi |
| **Bağımsız denetim eki (13 Ağu 2026)** | Merge öncesi bağımsız denetim "merge edilebilir" verdi (**P0/P1 yok**) ve beş ek P2 bıraktı: **P2-A** → 9. kayıt (nav kapsamı + D-6c nöbetçisi), **P2-C** → 10, **P2-D** → 11. Kalan ikisi (**P2-B**, **P2-E/F**) doküman hatasıydı, aynı turda `fab94ac` ile düzeltildi ve defterin kuralı gereği listeye değil **kapanma notuna** yazıldı (bu tablonun altında); P2-E/F'nin açık kalan tarafı [[TB-33]]'e taşındı. Denetçi beş madde yazdı, altı etiket kullandı: E ve F tek maddede birleşik (`P2-E/F`). Denetimin ayrıca bulduğu üç doküman hatası kod değiştirmeden düzeltildi (`13146c1`, `e50ae75`, `fab94ac`) |
| **Neden ertelendi** | Hiçbiri para kaybı, yetki açığı ya da ölü akış değil. §6.2'nin çekirdeği (yoklama geri alma, tek rezervasyon iadesi) **ürün kararı** bekliyor ve `released_at` geri alınamaz bir damga olduğu için saf UI işi değil. Denetimden gelen ikisi (10, 11) **test/kurulum borcudur**: üretim davranışını değiştirmezler, ama ikisi de "yeşil ama nöbetsiz" sınıfındandır — CLAUDE.md §A'nın tam konusu |

| # | Kayıt | Yer | Etki / sonraki adım |
|---|---|---|---|
| 1 | **Yoklama geri alma ve tek rezervasyon iptali/iadesi YOK** | `docs/ip14-operator-panel-sozlesme.md` §6.2 ↔ `backend/services/library_exam_service.py`, `study_reservation_service.py` | Operatör yanlış kişinin QR'ını okuttuğunda geri dönüşü yok: `released_at` dolunca emanet kütüphaneye geçmiş sayılır ve [[TB-20]] hattındaki "serbest bırakılmış emanet iade edilemez" kuralı devreye girer. Bugünkü telafi yolu **yalnız admin** üzerinden ve elle. Sonraki adım: ürün kararı (geri alma penceresi var mı, kaç dakika, kim yetkili) → sonra para güvenliği paketi; UI işi olarak planlanamaz |
| 2 | **İşlem dökümünde sayfalama yok — 200 satır tavanı yalnız *dürüst* kılındı** | `frontend/src/pages/Balance.tsx` (K-1 uyarısı) ↔ `backend/api/routers/library_exams.py` (uç `limit` alıyor, router geçirmiyor) | İP-14 sessiz kesilmeyi kaldırdı ("son 200 işlem" uyarısı görünüyor) ama uyarıyı gören operatörün yapabileceği bir şey yok: 200'den eski işlemlere panelden erişim yolu **yok**. Bu, [[TB-24]]/1 ile birebir aynı sınıf. Sonraki adım: sayfalama (ya da tarih aralığı filtresi) + son sayfanın gerçekten son olduğunu ölçen DOM testi |
| 3 | **Kabuk sorgularında (`useOperatorMe`, `useLibraryAdminDetail`) hata durumu yok** | `frontend/src/pages/dashboards/OperatorHome.tsx`, `OperatorSessions.tsx` | Bu paket dört ekranın **içerik** sorgularına ErrorState bağladı; sayfayı çevreleyen **kabuk** sorguları hâlâ hatayı boş/yarım ekran olarak gösteriyor. Sayfa düzeyinde tek hata kabuğu ister — ekran mimarisi kararı. Sonraki adım: `DashboardShell` düzeyinde hata dalı + kabuk patladığında içerik sorgularının hiç koşmadığını ölçen test |
| 4 | **Operatör ekranlarında arama/filtre/URL state yok** | `OperatorSessions.tsx` ↔ §6.2/7 | Oturum sayısı arttıkça operatör listede gözle arıyor; filtre durumu URL'e yazılmadığı için paylaşılabilir/geri-dönülebilir değil. [[TB-24]]/10 ile aynı aile (panelin geri kalanıyla tutarsızlık). Sonraki adım: DataTable + URL state kararıyla **birlikte** alınmalı, tek başına değil |
| 5 | **Kütüphanem ve Ayarlar sayfalarının kendi bölüm sorgularında hata durumu yok** | `frontend/src/pages/Settings.tsx`, operatör "Kütüphanem" ekranı | Paket dört ekrana dokundu; bu ikisinin **bölüm** sorguları kapsam dışıydı. Aynı kusurun kalan yüzeyi. Sonraki adım: 3. kayıtla birlikte tek turda kapatmak |
| 6 | **`Balance` ödeme açıklaması eğitmen kolunda da değişti** | `frontend/src/pages/Balance.tsx` | Metin artık "banka havalesi" diyor ve mekanizma ikisinde de gerçekten aynı (elle havale), o yüzden bugün yanlış değil. Ama **iyzico Pazaryeri alt üye işyerine** geçildiğinde ([[TB-20]] hattı) mekanizma eğitmen ve kütüphane kollarında ayrışabilir ve tek metin ikisini birden yanlış anlatır. `legalContent.ts` bu konuda bir vaat içermiyor — bugün çelişki yok. Sonraki adım: alt üye geçişinde metni kol bazında ayırmak |
| 7 | **§6.2'nin kalan dört maddesi hiç başlanmadı** | `docs/ip14-operator-panel-sozlesme.md` §6.2/1,2,5,6 | Hakediş görünürlüğü, kayıt ara/bilet sorgula, anlık doluluk, operatör bildirimleri — dördü de **verilmemiş karar**, eksik iş değil. Kayıt burada duruyor ki "yapıldı sanılan ama hiç başlanmamış" iş olmasın ([[TB-24]]/12 ile aynı gerekçe). Sonraki adım: bir sonraki operatör turunda kapsama alınıp alınmayacağına karar vermek |
| 8 | **Dosya düzeyi `testTimeout` ezmesi main'in yeni global kuralıyla çelişiyor** | `frontend/src/pages/dashboards/operatorPanel.acceptance.test.tsx:44` ve `operatorBalance.acceptance.test.tsx:38` (`vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })`) ↔ `frontend/vitest.config.ts:40-42` | **Merge sırasında doğdu, İP-14'ün kusuru değil**: İP-14 ezmeyi yazarken global bütçe 5000 ms'ti ve `vitest.config.ts`'e dokunmamayı bilinçli seçmişti (İP-12'nin işi, TB-23 — o sırada hâlâ açıktı, sonra kapandı ve silindi; bkz. bu dosyanın başındaki kapanma notu). Main o sırada bütçeyi ölçerek 9000 ms'e çıkardı ve config'e **"dosya başına `testTimeout` ezmesi YAPILMAZ"** kuralını yazdı. Şimdi repodaki **tek** iki `vi.setConfig` bu dosyalarda ve kuralı deliyor. Ölçüldü: ezme **ölü değil, aktif** — bu iki dosya 9000 değil 20000 bütçesinde koşuyor. Ama **taşıyıcı da değil**: ezme geçici kaldırılıp tam suite iki kez koşuldu → **885/885 geçti** (tepe 5776 ms ve 6738 ms). Asıl bulgu şu: İP-14'ün `B-1` testi artık **bütün suite'in en yavaş testi** (tam paralel yükte 6401 ms; izole koşuda 784 ms — fark modül transform'unun ilk teste yazılması). Main bütçeyi 9000 seçerken kendi tepesini 2410–2959 ms ölçmüş ve "tepenin 3,04 katı" gerekçesini yazmıştı; İP-14 ile tepe ~6,4–6,7 s'ye çıkıyor ve o oran **1,34–1,56 kat**'a düşüyor. Yani main'in "regresyonu gizlemeyecek kadar dar" marjı bu merge'le fiilen kalkıyor. Sonraki adım: (a) iki ezmeyi kaldırıp kuralı tek yerde tutmak (ölçüldü, geçiyor) **ve** (b) `B-1`'in neden 6,4 s sürdüğünü incelemek — main'in kendi config yorumunun dediği gibi "çözüm bütçeyi büyütmek değil, testi incelemektir"; (c) hangisi seçilirse seçilsin `vitest.config.ts` yorumundaki ölçüm satırları **ve** TB-23'ün kapanma notundaki dosya başına bütçe payları (`PackageLabel %33, packingScreens %25, inventoryScreens %20, packingLabel %20`) güncellenmeli — ikisi de bu merge'den önceki suite'i anlatıyor, bugün **bayat**; (d) aynı turda iki dosyanın **süre bütçesi yorumu** da düzeltilmeli: hâlâ "projenin 5 sn'lik varsayılan test bütçesi" diyorlar, merge sonrası varsayılan **9 sn** (bağımsız denetim, 13 Ağu 2026 — aşağıdaki "bayat yorum" notu; kaydın maddesi hâline getirildi ki 8 kapatılırken gözden kaçmasın) |

| 9 | **Operatör nav'ı role-agnostik on sayfada hâlâ yok — ve N grubu bunu göremiyor (elle yazılı listeye çivili)** | `frontend/src/pages/DeepWork.tsx:34`, `Grapher.tsx:63`, `Habits.tsx:376`, `srs/SrsDecks.tsx:244`, `srs/SrsDeckDetail.tsx:433`, `srs/SrsStudy.tsx:190`, `srs/SrsBrowser.tsx:56`, `srs/SrsStats.tsx:19` ↔ nöbetçi: `frontend/src/pages/dashboards/operatorPanel.acceptance.test.tsx:725` (`SAYFALAR`) | **Bağımsız denetimde bulundu (13 Ağu 2026); sözleşme "7 yerde kopyalanmış, hepsi düzeltildi" diyordu; ölçüm role-agnostik kopyanın 7 değil **17** olduğunu gösterdi (7 düzeltildi + 10 kaldı). **GÜNCELLEME (14 Ağu 2026, SM-2 kaldırma denetimi bulgusu F3):** kalan onun **ikisi** (`Flashcards.tsx:159`, `FlashcardDeck.tsx:289`) SM-2 kaldırma paketinde **silindi**; borç kendiliğinden kapanmadı, sayfalar ortadan kalktı. Güncel sayı **8**; toplam 15. Deseni kullanan iki sayfa daha var ama onlar rol-kapsamlı: `LessonDetail.tsx:58` (rezervasyonun iki tarafı) ve `LibraryDetail.tsx:100` (public sayfa; operatöre `undefined` nav verir, öğrenci menüsü basmaz) — bu kayda dahil değiller.** İP-14 yedisini `navForRole`'a çevirdi (`Notifications`, `Leaderboard`, `Settings`, `Profile`, `Tasks`, `Learn`, `Calendar`); kalan sekizi — hepsi **Öğren hub'ının altındaki araçlar** — hâlâ `role_id === TUTOR ? TUTOR_NAV : STUDENT_NAV` kullanıyor. Kullanıcıya etkisi: operatör panelden hub'a doğru nav'la gider, hub'ın içinde bir araca tıklayınca **öğrenci menüsünü** görür (Favorilerim/Rezervasyonlar) ve kendi paneline dönüş linki kalmaz — İP-14'ün kapattığı kusurun aynısı, başka yüzeyde. Rol kısıtı olmadığı için (`ProtectedRoute`) sayfalar operatöre gerçekten açılır. **Asıl borç ikinci yarıda:** N grubu (`operatorPanel.acceptance.test.tsx`) **elle yazılmış beş girdilik** bir `SAYFALAR` listesini gezer; düzeltilen yedinin ikisi (`Profile`, `Tasks`) bile listede yok. Liste bayatlayınca test **sessizce eksik tarar** — yeşil kalır, sayfa hiç sınanmamıştır. Sonraki adım: (a) sekiz sayfayı `navForRole`'a çevirmek (mekanik, tek tur) **ve** (b) İP-16'nın `D-6c` desenini kurmak — nöbetçi elle liste tutmaz, **kaynak taramasıyla küme türetir**: `DashboardShell`/`navItems` basan role-agnostik sayfaların kümesi ile N grubunun taradığı kümenin **aynı** olduğunu ölçer (sayı değil küme; biri eklenip başkası silinseydi sayı eşit kalırdı). Karşılaştırma AST/kaynak taramasıyla türetildiği için CLAUDE.md §C uyarınca **düşük güçlüdür** ve yanında davranış testi (N grubu) durmaya devam etmelidir |

| 10 | **Sıralamanın `id DESC` deterministik bağlayıcısı NÖBETSİZ** (denetçi etiketi **P2-C**) | `backend/services/library_exam_service.py:418` (`list_library_sessions_admin` sıralamasının 4. kademesi) ↔ nöbetçi olması gereken düğümler: S-1/S-2 | **Denetçi kendi mutasyonuyla kanıtladı:** `LibraryExamSession.id.desc()` bağlayıcısı kaldırıldı → **7/7 test yine geçti**. Yani sözleşmenin §4'te "deterministik bağlayıcı" diye yazdığı kademe bugün korumasız: kaldıran/yönünü çeviren bir değişiklik hiçbir kırmızı üretmez. Sebep fixture: S-1/S-2 **ayrı zamanlı** oturumlar kuruyor, yani beraberlik hiç doğmuyor ve 4. kademeye hiç sıra gelmiyor (CLAUDE.md §E'nin "fixture sabit olduğu için bozuk davranış gözlenmeden kalıyor" maddesi). Gerçek etki bugün küçük ama sınıfı belli: aynı ana denk gelen iki oturumda sayfa sınırında **kayıt tekrarı/kayması**. Sonraki adım: `starts_at`'i **eşit** iki oturumla bir düğüm eklemek ve bağlayıcı kaldırıldığında kırıldığını mutasyonla göstermek. **Aynı sınıf İP-17'de de bulundu** (Q-9 tie-breaker'ın yönünü korumuyordu, gene fixture beraberlik üretmediği için) — desen tekrar ediyor, tek tek değil **kural olarak** ele alınmalı: "deterministik bağlayıcı iddiası, beraberlik üreten fixture olmadan kanıtlanmış sayılmaz" |
| 11 | **`IntersectionObserver` / `ResizeObserver` jsdom shim'leri eksik — henüz uyanmamış gizli boşluk** (denetçi etiketi **P2-D**) | `frontend/src/test-setup.ts` (yalnız `matchMedia` shim'i var, satır 60-75) ↔ kullanım: `frontend/src/pages/Notifications.tsx:81` (`new IntersectionObserver`), `frontend/src/pages/Grapher.tsx:263` (`new ResizeObserver`) | Vitest jsdom ortamında iki API de `undefined`. **Bugün hiçbir test takılmıyor** ve bu bir şans: `/notifications` fixture'ı **boş liste** döndüğü için sonsuz-kaydırma sentinel dalı hiç render edilmiyor; denetçi bunu şema-doğru **dolu** bir fixture'la prob edip patlamayı gösterdi. Sınıfı §9/5'te belgelenen `matchMedia` boşluğunun aynısı: "repoda bu ekranı gerçek DOM'da render eden test olmamasının sebebi buydu". Dolu fixture yazan **ilk** test sessizce patlayacak ve — N grubunun `Settings` vakasında olduğu gibi — assert'ler zaten geçmişse test **yeşil** kalıp suite raporuna "1 error" olarak düşecek. Sonraki adım: iki shim'i `test-setup.ts`'e eklemek (kurulum işi, üretim kodu değişmez) ve `Notifications`'ı **dolu** bir fixture'la render eden bir düğümle nöbetlemek |
<!-- Kapanma notu (İP-14 bağımsız denetimi, 13 Ağu 2026): denetimin bıraktığı
     beş P2'den **ikisi doküman hatasıydı ve aynı turda düzeltildi**, bu yüzden
     defterin kuralı gereği satırları SİLİNDİ (kısa süre "12 · DÜZELTİLDİ" ve
     "13 · DÜZELTİLDİ" olarak açık listede durdular; istisna kaldırıldı,
     numaralar yeniden kullanılmayacak).

     (a) **P2-B** — sözleşme §5'in "0/14 → 10/14" oranı tutarsızdı. Ölçüm:
     ErrorState 6 render noktasında, 8 sorgu örneğinde bağlı (`OperatorHome`
     ×2, `OperatorSessions` ×1, `ExamSessionsManager` ×3, `Balance` ×2 kol).
     §5'in 9–10. maddeleri sorgu DEĞİL, boş≠hata metin ayrımıydı (node E-5);
     1–2. maddeler ise 14'lük envanterde olmayan yeni sorgulardı — 14 katalog
     satırından ErrorState alan gerçek sayı 5. İşin kendisi gerçekti ve
     davranışla kanıtlıydı (E-1…E-6 kırmızı→yeşil, M-E1/M-E5 mutasyonları
     yakalandı); yanlış olan yalnız orandı. Kapatan commit: `fab94ac`.

     (b) **P2-E/F** — sözleşme §2'nin iki cümlesi paketin kapsamında doğru,
     repo genelinde yanlıştı: "`new Date().getDate()` hiçbir yerde çağrılmaz"
     (ölçüm: `frontend/src` içinde 17 dosyada 38 çağrı; denetçi "35+" saymıştı,
     fark yorum satırlarının elenmesi) ve "gün anahtarı tek yerde üretilir"
     (ikinci üretici `lib/datetime.ts::istanbulNow().dateStr`,
     `BookingModal.tsx:127`). Kapatan commit: `fab94ac`. Bu bulgunun kalıcı
     tarafı [[TB-33]]'e taşındı: o kayıt frontend'i tek kalem sayıyordu,
     "iki üreticili" düzeltmesi oraya eklendi — yani silinen satırın açık
     kalan mirası TB-33'tedir, burada değil. -->

**Not (bayat yorum):** iki test dosyasının süre bütçesi açıklaması hâlâ "projenin 5 sn'lik varsayılan test bütçesi" diyor; merge'den sonra varsayılan **9 sn**. Yukarıdaki 8. kayıt kapatılırken bu iki yorum da düzeltilmeli (8. kaydın **(d)** maddesi).

## TB-31 · `backend/.env` sürümsüz ve yedeksiz — tek koruma iki klasörde birden durması

> **Lansman öncesi çözülmeli.** Bu bir kod kusuru değil, bir **operasyon
> kusuru**: projenin bütün sırları tek bir sürümlenmemiş dosyada yaşıyor ve o
> dosyanın kaybı ortamı yeniden kurulamaz hâle getirir.

| | |
|---|---|
| **Bulundu** | İP-16 merge sonrası operasyon turu, 9 Ağu 2026. Worktree kaldırma isteği sırasında "silinirse ne kaybederiz" sorusu sorulunca ölçüldü — kod incelemesiyle değil, bir kaza ihtimali sorgulanırken |
| **Yer** | `adana-ozel-ders/backend/.env` (5.807 bayt) · kardeş kopya `adana-magaza/backend/.env` |
| **Yedek (kısmen kapatıldı, 9 Ağu 2026)** | Worktree yerleşimi düzeltilirken `adana-main` kaldırıldı; kopya sayısının düşmemesi için repo ağacının **tamamen dışına** tarih damgalı bir kopya alındı: `C:\Users\kiyar\Documents\adana-env-yedek\backend.env.20260809-1905` (`md5 9b4793af8173049cf1063554f921286a`, kaynakla birebir). ⚠️ Bu **asgari** koruma bile değil: aynı fiziksel diskte (`C:`) ve **şifresiz** duruyor — yalnız "yanlış `rm`/`worktree remove`" senaryosunu kapatır, disk arızasını KAPATMAZ. Aşağıdaki (1)-(3) seçenekleri hâlâ geçerli; bu satır onların yerine geçmez |
| **Durum** | Dosya `.gitignore:4` ile izlenmiyor ve **git geçmişinde hiç yer almamış** (`git log --all -- backend/.env` boş — bu iyi, sızıntı yok). Ama bunun bedeli: hiçbir sürüm, hiçbir yedek, hiçbir kurtarma noktası yok. İçeriği: Postgres parolası, `JWT_SECRET_KEY`, iyzico API/secret anahtarları, MinIO erişim anahtarları, Google Maps anahtarı |
| **Ölçüm** | İki kopya **birebir aynı** (`md5 9b4793af8173049cf1063554f921286a`, ikisi de 5.807 bayt), ama değişim zamanları 12 gün farklı (`adana-main` 9 Ağu 17:50 · `adana-ozel-ders` 28 Tem 14:40). Yani bu bir yedek değil, **tesadüfen hâlâ eşleşen kardeş kopya**: biri düzenlendiğinde ikisi sessizce ayrışır ve hangisinin doğru olduğunu söyleyen hiçbir şey kalmaz. Ek risk: ikisi de aynı fiziksel diskte (`C:`) ve **disk %97 dolu** (629 GB'nin 20 GB'si boş) |
| **Etki** | Disk arızası, yanlış `git worktree remove`, yanlış `rm -rf` ya da klasör taşıma → tüm geliştirme ortamı yeniden kurulamaz. Postgres parolası ve MinIO anahtarları yeniden üretilebilir; **iyzico sandbox/üretim anahtarları panelden yeniden alınmak zorunda kalır** ve üretim anahtarları söz konusu olduğunda bu, kesinti demektir. `JWT_SECRET_KEY` kaybı tüm oturumları düşürür (geliştirmede zararsız, üretimde değil) |
| **Neden şimdi düzeltilmedi** | Doğru çözüm bir sır yönetimi kararıdır (aşağıdaki seçenekler), operasyon turunun kapsamı değildi. Ayrıca `.env` bilinçli olarak `protect-env.mjs` hook'uyla korunuyor — yani dosyaya dokunmak tek başına serbest bir iş değil, ayrı bir karar ister |
| **Sonraki adım** | Seçenekler, artan güçte: (1) **asgari** — şifreli yedek (`age`/`gpg`) ayrı bir fiziksel ortama, `.env.example` ile alan alan eşleştiği doğrulanmış olarak; (2) **orta** — parola yöneticisinde (1Password/Bitwarden) sır kaydı, `.env` ondan türetilir; (3) **hedef** — üretim sırları hiçbir zaman dosyada durmaz, dağıtım ortamının sır deposundan (systemd credentials / Docker secrets / bulut KMS) gelir. Üretim için (3) zaten `docs/pk1-deployment-checklist.md`'nin konusu; bu kayıt **geliştirme ortamının** kurtarılabilirliğini kapsar. Ayrıca: `.env.example` ile gerçek `.env` arasındaki alan farkını CI'da rapor eden bir kontrol, kaybolan/eskiyen anahtarı erken gösterir |

## TB-30 · `ensure_schema` şema/damga uyumsuzluğunu AKTİF OLARAK GİZLİYOR — üretimde kapalı olmalı

> **Öncelik: yüksek.** Bu bir "nöbetçi eksikliği" değil; uygulamanın açılışta
> uyumsuzluğu **düzeltmeden susturması**. Diğer kayıtların çoğu bir şeyin
> ölçülmediğini söyler, bu kayıt ölçülen bir şeyin örtüldüğünü söyler.

| | |
|---|---|
| **Bulundu** | İP-16 bağımsız denetimi + düzeltme turu, 9 Ağu 2026. Elle tarama ile bulundu, hiçbir test yakalamadı |
| **Yer** | `backend/core/migrations.py::ensure_schema` (açılış, `AUTO_CREATE_DB=true`) · dolaylı: CI (`.github/workflows/ci.yml`), `tests/integration/conftest.py` |
| **Durum** | `ensure_schema`, çözümlenemeyen bir damga gördüğünde **`stamp head --purge`** uygular (squash öncesi DB'ler için konmuş bir geçiş guard'ı). Sonuç zinciri ölçüldü: (1) DB eski/terk edilmiş bir revizyon kimliğine damgalı → `upgrade head` "Can't locate revision" verir; (2) guard damgayı sessizce `head`'e taşır; (3) sonraki `upgrade head` yapacak iş bulamaz ve **başarıyla döner**; (4) izin hizalama migration'ı **hiç koşmaz**, `srs.platform.*` bayat kodları DB'de kalır; (5) admin platform uçları SUPER_ADMIN'e dahi 403 döner ve menü öğesi gizlendiği için hata **görünmez**. Yani guard, tam da kendisini uyarması gereken durumu örtüyor |
| **Neden ayrı kayıt** | Aynı boşluktan geçen üç arıza sınıfı var — (a) bayat damga, (b) kimlik aynı kalıp içeriğin değişmesi, (c) `down_revision` doğrusallaştırması sonrası "head damgalı ama araya giren DDL hiç koşmamış" DB. (a) gürültülü patlar; **(b) ve (c) tamamen sessizdir** ve `ensure_schema` (a)'yı da sessizleştirerek üçünü aynı sınıfa indiriyor |
| **Ölçüm** | Denetim turunda makinedeki `adana*`/`ceyhandb` veritabanları tarandı: bayat damga taşıyan DB'ler ve "ip16 damgalı ama `ix_products_isbn` yok" (İP-12 boşluklu) DB'ler bulundu. Düzeltme turunda aynı zincir canlı görüldü: `adana_verify` bayat damgayla `alembic upgrade head`'i kırdı — orada `AUTO_CREATE_DB=false` olduğu için guard devreye girmedi ve hata GÖRÜNDÜ; guard açık olsaydı sessizce head'e taşınacaktı |
| **YAŞANMIŞ VAKA — `ceyhandb`, 9 Ağu 2026 (merge sonrası)** | Artık teorik değil: arıza **asıl geliştirme veritabanında** (4.694 aktif ürün) ölçüldü. Durum — `alembic_version` = `ip12_urun_arama_vektoru`, ama 8 `srs_*` tablosunun **hepsi mevcut**; yani şema İP-16'da, damga İP-12'de. `alembic upgrade head` → `DuplicateTableError: relation "srs_decks" already exists` (migration düz `op.create_table` kullanır, `IF NOT EXISTS` yok). Bu, kaydın (c) sınıfının aynadaki hâli: guard damgayı GERİ sardı, DDL yerinde kaldı. Zincir: İP-16 dalı ceyhandb'ye şemayı yazdı → eski dalın `ensure_schema`'sı `ip16_*` damgasını çözemeyip `stamp head --purge` ile ip12'ye çekti → tablolar öksüz kaldı. **Kritik ayrıntı:** guard burada sessiz kalmadı, çünkü hata bir sonraki `upgrade`'de patladı — ama patlamayı sağlayan şey tabloların ZATEN var olmasıydı, guard'ın kendisi değil. Tablolar boş olmasa veri kaybı tartışması açılırdı |
| **Vakanın çözümü ve ölçülen sapma** | Tablolar boştu (8 tabloda 0 satır), dışarıdan FK/view bağımlılığı yoktu → `stamp` yerine **drop + `upgrade head`** seçildi (stamp, mevcut DDL'in migration'la aynı olduğunu *varsayar*). Düşürmeden önce tam DDL kaydedildi: `docs/data/tb30-ceyhandb-srs-ddl-2026-08-09.sql`. **Karşılaştırma sonucu: FARK YOK** — 655 satır birebir aynı (kolon tipi, index, constraint, sequence, FK dahil); tek fark `pg_dump` 17'nin çağrı başına ürettiği `\restrict` nonce'ları. Yani `ensure_schema` bu vakada **şemayı bozmadı, yalnız damgayı bozdu**. Bu, kaydın önerdiği düzeltmeyi ucuzlatır (damga-repo doğrulaması tek başına bu vakayı yakalardı) ama sorunu küçültmez: "damga yanlışken tablolar da doğru mu" sorusunun cevabı **önden bilinemez**, ancak ölçülerek öğrenilir — burada iyi çıktı, garantisi yok. Upgrade sonrası: `alembic current` = `ip16_srs_izin_kodu_hizalama`, `alembic check` temiz, ürün 4694/4758 değişmedi |
| **Ölçüm — vaka sonrası ilk açılış (9 Ağu, 19:08)** | Vaka çözüldükten SONRA sunucu `AUTO_CREATE_DB=true` ile yeniden başlatıldı ve `ensure_schema`'nın ne yaptığı ölçüldü: **hiçbir şey**. Logun tamamında yalnız iki satır var — `Schema: alembic upgrade head (migration tek kaynak)` ve 1,85 sn sonra `Schema: ready (head)`. `Running upgrade … -> …` satırı **yok** (tek migration koşmadı), `stamp head --purge` uyarısı **yok** (guard tetiklenmedi). Kodda çalışan dal `_provision_schema`'nın ilk dalı: `upgrade head` sıfır dönünce fonksiyon hemen `return` ediyor. Sonuç durumu: `alembic current` = `heads` = `ip16_srs_izin_kodu_hizalama`, `alembic check` temiz, 8 `srs_*` tablo. **`ensure_schema` açılışta hiç çalışmasaydı tek fark 1,85 sn olurdu.** Kaydın açısından önemi: `ready (head)` mesajı "kurdum" ile "zaten güncel"i **ayırt etmiyor** — yani bu satır, guard'ın sessizliğine ek olarak, normal işleyişte de hiçbir bilgi taşımıyor |
| **DÜZELTME — yanlış nedensellik** | Aynı turda "`/health` 503 → 200 dönüşünü `ensure_schema` şemayı geri kurarak sağladı" diye raporlandı; bu **yanlıştı** ve yukarıdaki ölçümle çürütüldü (şema zaten elle koşulan `upgrade head` ile kuruluydu, `ensure_schema` no-op geçti). 503'ün gerçek sebebi **ölçülemedi**: 503'ü veren süreç, şema düşürülmüşken ayakta olan eski uvicorn'du (`adana-main`'den, port 8016), logu tutulmamıştı ve süreç sonlandırıldı. Olası açıklama, `DROP`/`upgrade` sırasında bağlantı havuzunun bozulması ve yeniden başlatmanın bunu temizlemesidir — **doğrulanmadı**. Kayda geçme sebebi: "yeniden başlatınca düzeldi" bir gözlemdir, açıklama değildir; TB-30'un konusu tam da böyle sessiz düzelmelerin nedeninin bilinmemesidir |
| **Yan bulgu (DDL kilidi)** | `DROP TABLE` 2 dakika asılı kaldı: çalışan geliştirme backend'i 11 dakikadır `idle in transaction` bekliyordu ve DDL onun kilidini bekliyordu (`pg_blocking_pids` ile doğrulandı). Bu, üretimde `alembic upgrade`'in de aynı şekilde asılabileceğini gösterir — lansman kontrol listesine "migration öncesi uzun `idle in transaction` bağlantı taraması + `lock_timeout`" maddesi düşer |
| **Etki** | Bugün test/geliştirme ortamlarını vurdu, ama arıza sınıfı ortama duyarsız. Üretimde (b) sessizce yanlış yetki verisi, (c) sessizce eksik index/kolon bırakır — ikisi de "migration'lar geçti" raporuyla birlikte yaşar |
| **LANSMAN KONTROL LİSTESİ** | **`AUTO_CREATE_DB=false` üretimde ZORUNLU** — dolayısıyla `ensure_schema` ve `stamp head --purge` guard'ı üretimde hiç çalışmaz. Üretim guard'ı (`Settings._guard_production`) `AUTO_CREATE_DB` açıkken zaten uygulamayı açtırmıyor; bu kayıt onu **kontrol listesine yazılı bir madde** hâline getirir, örtük bir davranış olarak bırakmaz. Şema üretimde yalnız açık, denetlenen bir `alembic upgrade head` adımıyla ilerler. Bkz. `docs/pk1-deployment-checklist.md` |
| **Neden ertelendi** | Doğru çözümün iki parçası var: (1) damganın repoda karşılığı olduğunu doğrulamak (ucuz: `alembic_version.version_num` ∈ `versions/*.py` revision kimlikleri; bilinmeyen damgada fail-fast + beklenen revizyonu söyle — guard bunun YANINA, sonrasına değil); (2) şemanın damgayla uyuştuğunu CI'da **kapı** yapmak (`alembic check`). İkincisi bugün çapraz-dal sapması yüzünden kırmızı verir, yani dal durumu temizlenmeden kapıya çevrilemez. İP-16'nın kapsamı aralıklı tekrardır |
| **Sonraki adım** | (1) `ensure_schema`'ya damga-repo doğrulaması + bilinmeyen damgada fail-fast; `--purge` guard'ını yalnız **bilinen** squash-öncesi revizyon listesine daralt; (2) taze DB'de `alembic upgrade head && alembic check` CI kapısı; (3) `down_revision` değiştiren her commit'in "eski zincirle kurulmuş DB'ler yeniden kurulmalı" notunu taşıması sözleşme kuralı olsun; (4) `AUTO_CREATE_DB=false` maddesini lansman kontrol listesine ekle |
| **AYRI İŞ PAKETİ — "doğrula modu" (9 Ağu 2026'da önerildi, BİLİNÇLİ OLARAK ERTELENDİ)** | Yukarıdaki (1)-(4) hâlâ geçerli; bu satır onları **sıraya** koyar ve bir madde ekler. **(A) `ensure_schema` "kur" modundan "doğrula" moduna geçsin:** açılışta `alembic current` ile `heads` karşılaştırılsın, eşit değilse uygulama **açılmasın** ve `alembic upgrade head` koşulması söylensin. Maliyeti tek sorgu. Kritik tasarım kararı: bu doğrulama **`AUTO_CREATE_DB`'den BAĞIMSIZ, her zaman** koşmalı — bugün bayrak kapalıyken hiçbir kontrol yok, yani şema kayması *sessizce* değil *hiç* fark edilmiyor. **(B) `--purge` guard'ını bilinen revizyon listesine daralt** (= mevcut (1)'in ikinci yarısı). **(C) `AUTO_CREATE_DB=false` dev varsayılanı olsun**, temiz kurulum `docker-compose`'da backend'den ÖNCE koşan ayrı bir `migrate` adımına bağlansın. **SIRA ÖNEMLİ: (A) → (C).** (C)'yi (A)'sız uygulamak durumu BUGÜNKÜNDEN KÖTÜLEŞTİRİR: bu depoda sekiz worktree ve farklı migration head'li dallar var; otomatik hizalama kalkar ama yerine hiçbir uyarı gelmez, dal değiştirip `upgrade head` koşmayı unutan geliştiricinin uygulaması sessizce eski şemayla açılır. (A) tek başına da anlamlı bir ilk adımdır; (C) onsuz yapılmamalıdır. Bu paket İP-16 veya operasyon turunun kapsamı değildi, ayrı bir tur ister |

## TB-27 · `last_seen_at` iki ayrı yoldan yazılıyor; presence yolunun izlenmesi yalnız log

| | |
|---|---|
| **Bulundu** | presence flush düzeltmesinin kapanış turu, 9 Ağu 2026 |
| **Yer** | `backend/api/deps.py::get_current_active_user:81-87` ↔ `backend/core/presence.py::flush_to_db` ↔ `backend/api/routers/auth.py:203` |
| **Durum** | Üç yazma yolu var ve yalnız biri kasıtlı: (a) login `auth.py:203`'te doğrudan atar ve commit eder; (b) `deps.py` ORM nesnesine `user.last_seen_at = now` yazar — yorum "DO NOT commit to DB synchronously" der, **ama** aynı istek yazan bir uçsa `get_db`/servis commit'i bu alanı da **yan etkiyle kalıcı yapar**; (c) asıl yol, Redis kuyruğundan toplu flush |
| **Etki** | `last_seen_at`'in anlamı uca göre değişiyor: yazan uçlara giden kullanıcıda anlık, salt-okunur gezinen kullanıcıda flush aralığı kadar gecikmeli. Daha önemlisi bu yan etki, **presence yolu 71 gün boyunca hiç çalışmazken bile** verinin "makul" görünmesini sağladı — bozukluğu maskeledi (bkz. bu turun bulgusu: 30 May–9 Ağu arası flush SQL'i her turda `integer = text` ile patlıyordu) |
| **Bu turda kapananlar** | Flush SQL'i düzeldi (CAST), tablo adı allowlist'e alındı, `HGETALL`+`DEL` yarışı değer karşılaştırmalı silmeyle kapandı, bozuk anahtar artık turu düşürmüyor, kuyruk `PRESENCE_DIRTY_MAX_ENTRIES` (50k) üstünde kritik loglanıyor. Kanıt: `tests/integration/test_presence_flush_pg.py` (7 test, gerçek PG + gerçek Redis) + mutasyon provaları PR1–PR4 |
| **Açık kalan** | (1) `deps.py`'deki örtük yan etki — sözleşme netleştirilmeli (ya bilinçli "yazan uçta anlık" diye belgelensin, ya da nesneye hiç yazılmasın); (2) kuyruk şişmesi yalnız **log** üretiyor — `/health` teşhis ucunda ya da bir alarmda görünmüyor, yani nöbetçi hâlâ birinin logu okumasına bağlı; (3) 30 May–9 Ağu arası `last_seen_at` verisi **geri doldurulamaz** (Redis kuyruğu düşürüldü, o dönemin gezinme izi yok) — bu tarih aralığındaki "son görülme" değerleri yalnız login/yazma anlarını yansıtır |
| **Sonraki adım** | (a) `deps.py` sözleşmesini seç ve testle sabitle; (b) `presence:dirty` boyutunu `/health` çıktısına (üretimde ayrıntısız) ekle; (c) `last_seen_at` okuyan yüzeylerin listesi bu kayıtta: `clients.py::ClientPublicOut`, `admin_service.py:318` (kullanıcı dizini + `/yonetim` kullanıcı detayında "Son görülme"), `search_service.py:64` (`TutorOut`, frontend'de **tüketilmiyor**), `client_service.py:61` (öğrenci listesi **sıralama anahtarı** — flush ölüyken sıra login zamanına göre oluşuyordu), frontend `StudentProfile.tsx` (`/ogrenciler/:id` — eğitmen panelinden, mesajlardan ve soru listesinden link alır; "Çevrimiçi" rozeti + "son görülme", 120 sn eşiği). `ClientCard.tsx` aynı rozeti taşır ama **hiçbir yerden import edilmiyor** (ölü bileşen; `useClientSearch` hook'u da tüketilmiyor) |


## TB-26 · Ürün kapak görselleri `library-photos/` önekini kütüphane fotoğraflarıyla paylaşıyor

| | |
|---|---|
| **Bulundu** | kitapsec kapak backfill turu, 8 Ağu 2026 |
| **Yer** | `backend/scripts/backfill_kitapsec_covers.py` (ve öncesinde `store_service.set_cover`/`add_images`) — ikisi de `storage.upload_library_photo`'yu çağırıp nesneleri `library-photos/` önekine yazıyor. Ürün kapağı için ayrı bir önek/bucket yok |
| **Ölçüm** | 4.681 ürün kapağı yüklendi; MinIO'da `library-photos/` önekinde toplam **4.744 nesne** (129,1 MB) — aradaki ~63 nesne platformun gerçek kütüphane fotoğrafları. Bugün karışma **zararsız**: her nesne kendi UUID adını taşıyor, çakışma riski yok, silme/liste sorguları her iki tür veriyi de aynı anda döndürmüyor (referans DB'den geliyor) |
| **Etki** | İleride ürün görsellerini kütüphane fotoğraflarından ayrı yönetmek gerekirse (toplu temizlik, farklı yaşam döngüsü/saklama politikası, CDN önbellek kuralı, ayrı bucket lifecycle) bu ayrıştırma bugünden yapılmadığı için sonradan **taşıma maliyeti** doğar (`scripts/migrate_storage_visibility.py`'deki gibi bir geçiş betiği gerekir) |
| **Sonraki adım** | Ürün kapakları için `products/` öneki (ya da ayrı bucket) — hem yeni yüklemeler hem geriye dönük 4.681 nesne için taşıma betiği. Şimdilik ürün kararı bekliyor, aciliyeti yok |

## TB-25 · `storage.upload_library_photo` her çağrıda yeni aioboto3 Session/istemci kuruyor

| | |
|---|---|
| **Bulundu** | kitapsec kapak backfill turu, 8 Ağu 2026 (ölçümlü) |
| **Yer** | `backend/core/storage.py::_s3_client` ↔ `upload_library_photo`/`_put_webp` — her çağrı `aioboto3.Session().client(...)` ile YENİ bir istemci kurup kapatıyor |
| **Ölçüm** | `scripts/backfill_kitapsec_covers.py`: her görsel kendi `upload_library_photo` çağrısını yaptığı ilk sürümde 200 görsellik parti **225 saniye**; script içinde tur boyunca TEK paylaşılan istemciye geçilince (`_upload_via_shared_client`) aynı parti **28 saniye** — **8x**. Suçlu ne Pillow'daki yeniden boyutlandırma ne yerel ağ: `aioboto3.Session()` her kurulumda botocore'un servis modellerini (JSON) diskten yeniden okuyor |
| **Etki** | Tek tek admin yüklemelerinde (bir kapak, bir avatar) gecikme tek istekte gizli kalıyor, fark edilmiyor. Admin toplu kapak/görsel yüklerse ya da çoklu görsel işleyen başka bir akış eklenirse aynı yavaşlık sessizce geri gelir. Üretim kodu (`core/storage.py`) bu turda DÜZELTİLMEDİ — çözüm yalnız `scripts/backfill_kitapsec_covers.py` içinde, script'e özel bir yardımcıyla geçici olarak uygulandı |
| **Sonraki adım** | `core/storage.py`'da modül düzeyinde paylaşılan bir istemci/bağlantı havuzu (ya da `aioboto3.Session()`'ı bir kez kurup yeniden kullanan bir singleton) — tüm `upload_*`/`_put_webp` çağrıları oradan geçmeli. Ölçüm bu turun script'i referans alınarak tekrarlanabilir |

## TB-24 · İP-12 P2 listesi (mağaza panel yüzeyi — on iki kayıt, öncelik sırasıyla)

| | |
|---|---|
| **Bulundu** | İP-12 (mağaza panel yüzeyi: ürün listesi/arama/stok kovaları + sipariş listesi + `ProductPicker`) bağımsız audit'i, 8 Ağu 2026 — audit YEŞİL (`167dffd` üzerinde dar teyitle), merge `92bc1c1` |
| **Merge sonrası doğrulandı** | Sıfırdan izole DB'de (`adana_post_ip12_merge_test`) `alembic upgrade head` + `alembic check` → `No new upgrade operations detected.`; tek head `ip12_urun_arama_vektoru` |
| **Neden ertelendi** | Hiçbiri para kaybı, yetki açığı ya da ölü akış değil. Audit turunda kapsam dışı üretim koduna dokunmak, denetimden geçmiş kırmızı matrisi ve kabul sözleşmesini kaydırırdı (`feedback_delivery_gates`: kabul testleri sessizce değişmez) |

| # | Kayıt | Yer | Etki / sonraki adım |
|---|---|---|---|
| 1 | **Sipariş listesinde sayfalama YOK** | `frontend/src/pages/dashboards/AdminStore.tsx:1065-1076` (`kesilmisOlabilir`) ↔ `backend/api/routers/store.py:443` (`list_orders_admin`, `limit` tavanı 200) | İP-12 listenin kesildiğini **söyleyen** bir uyarı ekledi (sessiz kesilme kalktı), ama uyarıyı gören yöneticinin yapabileceği bir şey yok: 100'den sonraki siparişlere panelden **erişim yolu yok**. Uç `offset` alıyor, yüzey kullanmıyor. Sonraki adım: sayfalama (ya da "daha fazla yükle") + son sayfanın gerçekten son olduğunu ölçen DOM testi |
| 2 | **`?stok=var` sınır kör noktası — fixture'da `stock == 5` ürün yok** | `backend/tests/integration/ip12_factory.py` ↔ `core/stock_policy.py:82-89` | `var` kovası `stock > LOW_STOCK_THRESHOLD` diyor; eşiğin **tam üstündeki** değer (5) hiçbir senaryoda üretilmiyor. Yüklem yanlışlıkla `>=` yapılsa testler yine yeşil kalır — off-by-one görünmez. Eşiğin kendisi bilinçli bir ürün kararı (`stock_policy` docstring'i: "5 kaldı" uyarısı alınmalı) ve tam o karar test edilmiyor. Sonraki adım: fixture'a `stock=5` ürün + üç kovanın sınırdaki davranışını ayrı ayrı ölçen senaryo |
| 3 | **`?stok=kritik` açıldığında 0 stoklular üstte değil** | `frontend/src/pages/admin/AdminDashboardPage.tsx:113` (link `?stok=kritik`, `sirala` taşımıyor) | Kart ile listenin **kümesi** artık aynı (P1-1 kapandı), ama **sırası** anlamlı değil: yeniden sipariş alarmından gelen yönetici önce tükenmişleri görmeli. Bugün varsayılan sıra geliyor, tükenmişler listenin ortasına dağılıyor. Sonraki adım: linke `sirala=stock` (artan) eklemek + gerçekten gönderilen query parametresini ölçen test (DOM'da sıra değil, **istekte** parametre) |
| 4 | **Public uçta `sku`/`stock` liste düzeyinde anonim dönüyor** | `backend/schemas/store.py::ProductSearchOut:55-73` | `in_stock` bayrağı zaten var ve müşteri için yeterli; kalan adet ile stok kodu iç operasyon verisidir. Sızıntı bugün "yalnız" rekabet istihbaratı (rakip katalog derinliğini ve ikmal ritmini ölçebilir) — yetki açığı değil, o yüzden P2. Sonraki adım: public projeksiyondan `sku`/`stock` çıkarmak (admin şeması ayrı kalır) + anonim çağrının alanları DÖNMEDİĞİNİ ölçen HTTP testi |
| 5 | **Kısmi ISBN öneki index kullanmıyor** | `backend/models/store.py:362` (`ix_products_isbn`, düz btree) ↔ arama dalı `services/store_service.py` | Tam eşleşme index'ten yararlanıyor, kısmi/önek araması (yöneticinin fiilen yaptığı şey — barkodun son hanelerini yazmak) sequential scan'e düşüyor. Katalog küçükken görünmez; büyüdüğünde arama kutusu yavaşlar. Sonraki adım: `text_pattern_ops` önek index'i ya da mevcut trigram yoluna ISBN'i katmak — hangisinin kazandığı **ölçülerek** seçilmeli (`EXPLAIN` + gerçek satır sayısı) |
| 6 | **`test_a3b` flake — teşhis EDİLMEDİ** | `backend/tests/integration/test_ip12_urun_listesi_pg.py::test_a3b` | Hipotez "tsquery belirsizliği" idi ve audit bunu **çürüttü**: 8 SKU genişliği + 3 ISBN ile senaryonun deterministik olduğu ölçüldü. Geriye altyapı/yük hipotezi kaldı ve o **kanıtlanmadı** — yani bugün kök neden bilinmiyor. Kayıt bu yüzden "flaky test" değil "**teşhis edilmemiş** flaky test" olarak duruyor; [[TB-14]]/8 ile aynı sınıfa girip girmediği belli değil. Sonraki adım: düşüşü yakalayan koşumda tam çıktı + o anki makine yükü kaydı; hipotez kanıtlanana kadar test **susturulmamalı** |
| 7 | **Model ↔ migration `Computed` ifadesi iki kopya; `alembic check` karşılaştırmıyor** | `backend/models/store.py` (`search_vector` `Computed`) ↔ `migrations/versions/ip12_urun_arama_vektoru.py` | Aynı uzun `to_tsvector(... isbn ... sku ...)` ifadesi iki dosyada elle yazılı. Autogenerate generated-kolon **ifadesini** diff'lemediği için biri değişip diğeri kalırsa `alembic check` YEŞİL kalır ve sapma yalnız arama sonuçlarında (sessizce) görünür. Bu turda ikisinin aynı olduğu canlı DB'den `pg_get_expr` ile doğrulandı — ama bu bir **elle** kontroldü. Sonraki adım: ifadeyi tek bir Python sabitinden üretip her iki tarafın oradan okuduğunu ölçen yapısal nöbetçi |
| 8 | **`ix_products_title_trgm` sapması `env.py` `_trgm` muafiyetiyle gizleniyor** | `backend/migrations/env.py:42-50` (`_EXPRESSION_INDEX_SUFFIXES = ("_trgm",)`) | Muafiyet meşru bir sebeple var (ifade-tabanlı indeksleri autogenerate zaten üretemiyor), ama yan etkisi şu: adı `_trgm` ile biten bir indeks **tamamen** kaybolsa ya da ifadesi değişse `alembic check` bunu göremez. Yani bu indeks sınıfı için migration↔model sözleşmesi denetimsiz. Sonraki adım: muafiyeti "diff'ten çıkar" yerine "**varlığını** ayrıca doğrula" hâline getirmek (canlı DB'de beklenen `_trgm` indekslerini listeleyen PG testi) |
| 9 | **`offset` üst sınırsız; `publisher`/`author` filtreleri uzunluk sınırsız** | `backend/api/routers/store.py:183-184, 224-225, 446-447, 556-557` | `limit` her yerde `le=` ile tavanlı, `offset` yalnız `ge=0`. Çok büyük offset Postgres'e "satırları say ve at" dedirtir (derin sayfalama maliyeti); serbest metin filtrelerinde uzunluk sınırı olmaması da aynı sınıftan ucuz bir kötüye kullanım yüzeyi. Kimlik doğrulamalı uçlar olduğu için P2. Sonraki adım: `offset` tavanı (ya da keyset sayfalama) + filtre alanlarına `max_length` |
| 10 | **`CountSessionsPage` URL güncellemesi `replace: true`** | `frontend/src/pages/admin/inventory/CountSessionsPage.tsx:243` | Filtre değişimi geçmişe kayıt bırakmıyor; kullanıcı geri tuşuyla önceki filtreye dönemez, doğrudan sayfadan çıkar. Panelin başka yerlerindeki filtre davranışıyla tutarsız. Küçük ama gerçek bir gezinme kusuru. Sonraki adım: `replace`'i yalnız ilk normalize etmede kullanmak, kullanıcı kaynaklı değişimde `push` |
| 11 | **`ProductPicker` hatayı "sonuç yok" gösteriyor; boş terimde de istek atıyor** | `frontend/src/components/admin/ProductPicker.tsx:52-58` ve `:85-92` | İki ayrı kusur, aynı bileşende: (a) `isLoading` değilse ve liste boşsa "Eşleşen ürün bulunamadı." yazılıyor — **istek patladığında da** aynı metin çıkıyor, yani ağ/yetki hatası "böyle bir ürün yok" gibi okunuyor (kök `CLAUDE.md`: hata ≠ boş ekran). (b) `useAdminProducts(gecikmeli ? {...} : { limit: 10 })` — terim boşken de sorgu koşuyor; sonuç hiç gösterilmiyor (`adaylar` boş dizi) ama ağ turu gerçek. Sonraki adım: `isError` dalı + boş terimde `enabled: false` |
| 12 | **A8 ve B1–B5 kapsam dışı bırakıldı** | `docs/ip12-magaza-panel-sozlesme.md` | A8 (sipariş listesi **tarih ön ayarları**) ve B1–B5 bilinçli olarak paketin dışında tutuldu — eksik iş değil, **verilmemiş karar**. Kayıt burada duruyor ki "yapıldı sanılan ama hiç başlanmamış" iş olmasın. Sonraki adım: bir sonraki mağaza turunda kapsama alınıp alınmayacağına karar vermek |

### İP-9'a devredilen not (bu paketin borcu değil, altyapı)

| # | Kayıt | Yer | Etki / sonraki adım |
|---|---|---|---|
| 13 | **Redis düştüğünde entegrasyon suite'i pratikte kullanılamaz hâle geliyor** | `backend/core/ratelimit.py` (fail-open) ↔ `tests/integration/` | Rate-limit katmanı tasarım gereği **fail-open**'dır ve bu doğrudur — ama fail-open yalnız *sonucu* kurtarıyor, *maliyeti* kurtarmıyor: Redis kapalıyken her çağrı yeniden bağlantı deniyor ve suite sürünüyor. İP-12 audit'inde ölçüldü: `adana-ozel-ders-redis-1` 10 saat düşük kaldı ve suite **~60 dakika ilerlemedi** — testler kırmızı da vermedi, yalnız asıldı; teşhis o yüzden geç oldu. Bu bir üretim hatası değil, **geliştirici verimliliği ve yanlış teşhis** riski. Sonraki adım (İP-9): bağlantı hatasından sonra kısa devre kesici (`core/routing`'deki desenin aynısı) + suite başında Redis erişilebilirliğini söyleyen tek satırlık uyarı |

## TB-22 · İP-5 P2 listesi (KDV boru hattı + fatura ucu — sekiz kayıt, öncelik sırasıyla)

| | |
|---|---|
| **Bulundu** | İP-5 (KDV kırılımı + fatura ucu) bağımsız audit'i, 7 Ağu 2026 — audit YEŞİL (`9529265` üzerinde dar teyitle), merge `6b67381` |
| **Audit'in tek P1'i KAPANDI** | "Model ↔ migration sapması" — `aa404fe` (`fix(ip5): tax-health kismi indexini order modeline hizala`) ile giderildi. Merge sonrası **sıfırdan izole DB'de** doğrulandı: `alembic check` → `No new upgrade operations detected.` |
| **Neden ertelendi** | Hiçbiri para kaybı, yetki açığı ya da ölü akış değil. Audit turunda kapsam dışı üretim koduna dokunmak, denetimden geçmiş kırmızı matrisi ve kabul sözleşmesini kaydırırdı |

| # | Kayıt | Yer | Etki / sonraki adım |
|---|---|---|---|
| 1 | **TAM iade sonrası fatura HTTP'den ALINAMIYOR** | `backend/services/invoice_service.py:209` ↔ `:291` "refund" bloğu | Kapı `payment_status != "PAID"` ise 409 veriyor; tam iadede durum `REFUNDED` olduğu için uç faturayı hiç döndürmüyor. Sonuç: `:291`'deki iade bloğu **yalnız kısmi iadede** görülebiliyor. İade aritmetiği **doğru** (T-11 geçti) — yani kusur hesapta değil, erişimde. Müşteri tam iade almış bir siparişin belgesini indiremiyor. **Ürün kararı**: iade edilmiş siparişin faturası gösterilsin mi (muhasebe açısından genelde evet, iade satırıyla birlikte)? Karar verilirse kapıya `REFUNDED` eklenir |
| 2 | **`reserve_refund` başarısızlığında sipariş SARKIYOR** | `backend/services/order_service.py:956-961` (`_out_of_stock_refund`) | Tavan rezerve edilemezse fonksiyon `logger.error` yazıp `return` ediyor: iade yok, iptal yok, müşteriye bildirim yok. `payment_status` `REFUNDING`'e geçmediği için **reconciler de devralmıyor** — sipariş hiçbir otomatik yolun görmediği bir boşlukta kalıyor ve tek iz bir log satırı. [[TB-20]]/4'ün (İP-4 kuyruğunda görünmeyen emanetler) mağaza tarafındaki kardeşi. **Testi yok**. Sonraki adım: ya siparişi `MANUAL_REVIEW`'a alıp operasyon kuyruğuna düşürmek, ya da bu dalın gerçekten ulaşılamaz olduğunu kanıtlamak |
| 3 | **`products.tax_rate` hâlâ `server_default=text("0")`** | `backend/models/store.py:228` | P1-7'nin **kök nedeni** duruyor: Pydantic katmanını atlayan her yazıcı (betik, elle SQL, gelecekteki toplu içe aktarım) sessizce **%0 KDV** alır ve bu "hesaplandı, sıfır çıktı"dan ayırt edilemez. İP-5 aynı hatayı `orders` tarafında **tekrarlamamayı** bilinçli karar olarak yazdı (migration docstring'i) — ama ürün tarafındaki kaynağı temizlemedi. Sonraki adım: `server_default`'ı kaldırıp `nullable=True` yapmak (`0` ile "girilmedi" ayrılsın) + mevcut satırların oranını elle girmek (aşağıdaki ayar kaydına bakınız) |
| 4 | **`useOrderInvoice`'ta `meta: { silentError: true }` yok** | `frontend/src/hooks/useStore.ts:112-119` ↔ `frontend/src/lib/queryClient.ts:19-25` | Hook'un **kendi docstring'i** 404 ve 409'u "BEKLENEN" ilan ediyor ve `retry: false` yapıyor; ama global yakalayıcının `IGNORED_STATUSES` kümesi `{401, 403, 404}` — **409 listede yok**. Sonuç: kırılımı olmayan bir siparişin faturasını açmak kullanıcıya hata toast'ı gösteriyor **ve Sentry'ye raporlanıyor** (gürültü). Konvansiyon zaten mevcut ve iki yerde kullanılıyor (`useDelivery.ts:215`, `useFeatureFlags.ts:25`). Sonraki adım: tek satır `meta: { silentError: true }` + toast'ın çıkmadığını gösteren DOM testi |
| 5 | **`tax-health` sayacı kapının TÜM reddetme koşullarını kapsamıyor** | `backend/services/invoice_service.py:322-333` ↔ kapı `:214` | Sayaç SQL'i yalnız `tax_breakdown IS NULL` sayıyor; kapı ayrıca `tax_total is None` **veya** `net_total is None` ise de 409 veriyor (ve `not order.tax_breakdown` olduğu için **boş JSONB `{}`** de reddediliyor, ama `IS NULL` onu saymıyor). Yani "kaç siparişte fatura kesilemez" sorusunun cevabı **eksik sayılıyor**; sayaç sıfır görünürken uç reddetmeye devam edebilir. Bu, ayarların girilip girilmediğini izlemek için var olan bir sayaç — güven vermesi tam olarak yanlış yer. Sonraki adım: SQL'i kapının üç koşuluna birebir hizalamak + ikisinin aynı kümeyi verdiğini ölçen PG testi |
| 6 | **Altı argümansız `quantize` — yuvarlama modu bağlam varsayılanına düşüyor** | `order_service.py:269, 286, 288, 370, 440` · `invoice_service.py:259` | Üsler veriliyor (`Decimal("0.01")`) ama `rounding=` verilmiyor → Decimal bağlamının varsayılanı **`ROUND_HALF_EVEN`** geçerli oluyor. Paket "tek standart HALF_UP" ilan ediyor; bu ilan **koda değil belgeye** yazılı kalıyor. **Bugün etkisiz** ve bu ölçüldü: `Numeric(10,2)` girdileri zaten iki basamaklı olduğu için 69.120 senaryoda sapma çıkmadı; çağrıların çoğu da `ac35055`'ten miras. Risk gelecekte: iki basamaktan uzun bir ara değer (ör. yeni bir indirim/oran hesabı) bu yollara girerse bankacı yuvarlaması sessizce devreye girer. Sonraki adım: altısına da açık `rounding=ROUND_HALF_UP` + "argümansız quantize yok" yapısal nöbetçisi |
| 7 | **Sabit "iyzico ile ödeme" metni iki ekranda duruyor** | `frontend/src/pages/store/OrderDetailPage.tsx:199` · `frontend/src/pages/store/CheckoutPage.tsx:360` | `ac35055`'ten miras. İP-5 aynı sabit metni **fatura belgesinden** temizledi (`OrderInvoiceModal.tsx:17` gerekçeyi anlatıyor: fake sağlayıcıyla ödenmiş sipariş de "iyzico ile ödendi" diyordu) ama bu iki ekranda bırakıldı. Geliştirmede yanlış bilgi; ileride ikinci bir sağlayıcı eklenirse üretimde de yanlış olur. Sonraki adım: ödeme sağlayıcısını sunucudan gelen veriden yazmak (fatura belgesinde kurulan desen) |
| 8 | **Sözleşme §7'deki bir ifade fazla geniş** | `docs/ip5-kdv-fatura-sozlesme.md:389` | "hiçbir tarihsel veriye bakmıyor" deniyor; oysa `order_status_history` **okunuyor** (kendi izi). Aynı paragraf doğrusunu da söylüyor, yani çelişki değil **ifade abartısı** — ama sözleşme sonraki turların dayanağı olduğu için düzeltilmeli. Kod doğru, **belge** gevşek. Sonraki adım: ifadeyi "sipariş kalemlerinin tarihsel vergi oranlarına bakmıyor" gibi dar ve doğru bir hâle getirmek |

### İP-5'in bıraktığı ÜRÜN KARARI / OPERASYON kayıtları (kod borcu değil)

Bunlar eksik iş değil, **bilinçli olarak insana bırakılmış** üç karardır. Kod
her üçünü de güvenli tarafta bekletiyor (fatura uydurmuyor, uç kapalı).

| Ayar | Bugünkü durum | Neden bekliyor / ne gerekiyor |
|---|---|---|
| `SHIPPING_TAX_RATE` | **Boş** | Kargo bedeline uygulanacak KDV oranı **mali müşavir onayı** bekliyor. Boş kaldığı sürece `shipping_fee > 0` olan siparişler `ix_orders_tax_breakdown_missing` kuyruğunda birikir ve fatura ucu onları 409 ile reddeder (uydurma belge üretmez). `GET /store/admin/tax-health` → `shipping_rate_undefined` sayacı bu kümeyi gösterir |
| `INVOICE_ENABLED` | **Kapalı** | Fatura **baskı çıktısı gerçek tarayıcıda doğrulanmadan** açılmamalı (kök `CLAUDE.md` §F: "gerçek baskı/PDF çıktısı" mock'la sınanamaz; F30 etiket baskısında aynı sınıf hata bir kez yaşandı). Açılmadan önce: gerçek Chrome'da yazdırma önizlemesi + taşma/sayfa kırılımı kontrolü |
| Mevcut 6 ürünün `tax_rate`'i | **Elle girilmeli** | `server_default=text("0")` (yukarıda #3) yüzünden katalogdaki ürünler %0 görünüyor. Yeni siparişlerin kırılımı bu orandan hesaplandığı için ayar girilene dek yeni siparişler de "vergisiz" kaydedilir. **Bu üçünün sırası önemli**: önce ürün oranları, sonra `SHIPPING_TAX_RATE`, en son `INVOICE_ENABLED` |

## TB-20 · İP-1b P2 listesi (kütüphane kontenjan + para güvenliği — on iki kayıt, öncelik sırasıyla)

| | |
|---|---|
| **Bulundu** | İP-1b bağımsız audit'i (`aa16724` üzerinde, YEŞİL) + `38faf62` üzerine adaptasyon turu; merge `6121639`, 7 Ağu 2026 |
| **Neden ertelendi** | Hiçbiri para kaybı, yetki açığı ya da ölü akış değil; paketin P0/P1'leri üretim koduyla kapatıldı. Audit turunda kapsam dışı üretim koduna dokunmak, denetimden geçmiş kırmızı matrisi ve kabul sözleşmesini kaydırırdı (`feedback_delivery_gates`: kabul testleri sessizce değişmez) |
| **Etiket notu** | TB-A/TB-B/TB-D/TB-F, `docs/ip1b-kutuphane-kontenjan-sozlesme.md`'nin **kendi iç etiketleridir**; merkezi defterdeki karşılıkları aşağıdaki satırlardır. Sözleşmedeki atıflar bozulmasın diye etiketler korundu |

| # | Kayıt | Yer | Etki / sonraki adım |
|---|---|---|---|
| 1 | **TB-F · `uq_study_res_short_code` nöbetçisiz** | `migrations/versions/ip1b_bilet_kodu_tekilligi.py` ↔ `scripts/ip1b_ddl_drill.py` | Kısıt DDL'de **gerçekten koruyor** (merge duman testinde varlığı doğrulandı) ama onu hedefleyen ne davranış testi ne DDL mutasyon provası var. Sözleşmenin **"12/12 mutasyon"** ifadesi bu boşluğu görünmez kılıyordu — audit buldu. Kök `CLAUDE.md` §A'nın tam örneği: sayı, kapsamın kanıtı değil. Sonraki adım: dört kısıttan bu birine de DDL provası + çakışan kısa kodda 409 bekleyen PG testi |
| 2 | **`escrow.claim` `from_statuses` koşulunun bağımsız nöbetçisi yok** | `backend/services/escrow.py` | D-11 mutasyonu (koşulu kaldır) **kaçtı**: dış katmanlar (M46 + P-1b) durumu kendileri de doğruladığı için testler yeşil kaldı. Yani bu koşul bugün ölçülmemiş bir güven noktası — dış kontrollerden biri gevşerse claim yanlış durumdan devralabilir ve kimse görmez. Sonraki adım: `claim`'i doğrudan çağıran, yanlış `from_statuses` ile satırın devralınmadığını gösteren birim/PG testi |
| 3 | **TB-A · `pay()` kilidi sağlayıcı çağrısı boyunca tutuyor** | `backend/services/library_exam_service.py` / `study_reservation_service.py` — "tutma sona ermiş" dalı | Nadir yol: koltuk tutması dolmuşken ödeme gelirse, dış ödeme sağlayıcısına yapılan ağ çağrısı **kilit altında** kalıyor. [[TB-2]] ile aynı sınıf (orada mağaza iadesi). Sağlayıcı yavaşlarsa kontenjan kararları o süre boyunca seri kalır. Sonraki adım: kilidi sağlayıcı çağrısından önce bırakıp sonucu ayrı transaction'da uygulamak |
| 4 | **Görünürlük boşluğu · `auto_release_no_shows`'un atladığı emanetler hiçbir ekranda yok** | `library_exam_service.py::auto_release_no_shows` ↔ `services/admin_operations_service.py::list_stuck_escrow` | **İP-4 ↔ İP-1b kesişiminden doğdu.** Atlanan kayıtlar `PAID` + `released_at IS NULL` durumunda kalıyor, `REFUNDING` DEĞİL — İP-4'ün sıkışmış para kuyruğu ise `REFUNDING` eksenli tarıyor, bu yüzden **görünmüyorlar**. Para kaybı değil (silme guard'ı eğitmeni/kütüphaneyi sildirmiyor, para emanette duruyor) ama operatör bu kayıtları hiçbir ekranda göremez → sessizce birikir. Düzeltme İP-4 sözleşmesini genişletmeyi gerektirir (yeni bir `StuckEntity` ekseni), o yüzden ayrı paket işi |
| 5 | **TB-D · `quote()` ONAYSIZ kütüphanede fiyat dönüyor** | `backend/services/study_reservation_service.py::quote` | Audit E-9 ile ölçtü: `PENDING` (admin onayı beklemede) kütüphane için `quote` fiyat + uygunluk döndürüyor. **Sipariş başlatmıyor** — asıl rezervasyon yolu onayı kontrol ediyor — ama fiyat sızdırmak, henüz yayında olmayan bir mekânın verisini public uca taşımak demek. Sonraki adım: `quote`'a `Library.status == ACTIVE` koşulu + PENDING kütüphanede 404 bekleyen test |
| 6 | **`IntegrityError` → 409 mesajı YANLIŞ varlığı adlandırıyor** | `backend/core/exceptions.py` global handler ↔ `ex_study_res_client_no_overlap` | Çalışma rezervasyonu çakışmasında kullanıcı **"existing booking for this tutor"** görüyor — hem yanlış varlık (eğitmen dersi değil, kütüphane koltuğu) hem **İngilizce** (ürünün geri kalanı Türkçe). Mesaj ders tarafındaki `ex_bookings_no_overlap` için yazılmıştı; yeni exclusion kısıtı aynı handler'a düştü. Sonraki adım: kısıt adına göre mesaj eşlemesi + her kısıt için doğru Türkçe metni doğrulayan test |
| 7 | **Karışık saat kaynağı: `holds_seat` DB saati, `hold_is_live` Python saati** | `backend/services/library_capacity.py:79` (`func.now()`) ↔ `:96` (`_now()`) | `holds_seat`'in `func.now()` seçimi **bilinçli ve gerekçeli** (saati kaymış tek sunucu kontenjanı kendine göre yorumlamasın). Ama aynı "tutma canlı mı" sorusunu Python saatiyle cevaplayan ikinci bir fonksiyon var ve iki yol farklı cevap verebilir. **Ölçülen zarar yok**, teorik sapma penceresi var (uygulama saati DB'den ileri/geriyse tutma bir yolda canlı, diğerinde ölü görünür). Sonraki adım: `hold_is_live`'ı da DB saatine bağlamak ya da farkı gerekçesiyle sözleşmeye yazmak |
| 8 | **`auto_release_no_shows` ve `complete_checkout` `Library.status` filtresi taşımıyor** | `library_exam_service.py` | İkisi de `deleted_at` filtresi uyguluyor ama kütüphanenin **durumunu** (PENDING/SUSPENDED) sorgulamıyor. Askıya alınmış bir kütüphanenin oturumu için para serbest bırakılabilir. Bugün dar bir yol (askıya alma nadir) ama para hareketi yönü **kütüphaneye doğru**. Sonraki adım: iki sorguya da `Library.status == ACTIVE` koşulu + askıdaki kütüphanede serbest bırakmanın durduğunu gösteren PG testi |
| 9 | **`delete_tutor` guard'ı mağaza kolunu sorgulamıyor** | `backend/services/admin_service.py::delete_tutor` | İP-1b guard'ı eğitmenin açık emanetli DERS/kütüphane kaydını kontrol ediyor; **`OrderItem.tutor_id` + `tutor_earning`** (eğitmenin dijital ürün satışından doğan hakedişi) sorgulanmıyor. Yani ödenmemiş mağaza hakedişi olan eğitmen silinebilir. Ayrı paket işi: mağaza kolu hakediş defteriyle (`payout_records`) birlikte ele alınmalı |
| 10 | **`ip1b_ddl_drill._tanim` hedefi yalnız ADA göre buluyor** | `backend/scripts/ip1b_ddl_drill.py` ↔ `backend/scripts/mutation_drill.py` | İmza/tablo eşleştirmesi yok — aynı adı taşıyan başka bir kısıt/fonksiyon varsa yanlış hedefi mutasyona uğratıp "yakalandı" diyebilir. [[TB-14]]/7(c) ile aynı kusur, bu kez DDL sürücüsünde. Ayrıca **her iki sürücüde de** pytest alt-süreçlerine **timeout yok**: takılan bir test provayı süresiz askıda bırakır. Kök `CLAUDE.md` §D bu sürücüleri resmî araç sayıyor — güvenilirlikleri doğrudan test kalitesi iddiasını taşıyor |
| 11 | **TB-B · Çapraz tablo kod tekilliği yalnız ÜRETİCİDE** | `backend/core/codes.py` ↔ `backend/services/library_capacity.py` | DB kısıtları tablo başına tekillik veriyor (`uq_exam_reg_*`, `uq_study_res_*`); **iki tablo arasında** aynı `short_code`'un doğmasını engelleyen tek şey üretici taraftaki kontrol. Birleşik QR ucu (`/exam-attendance/verify`) token'ı önce denemede, sonra çalışma rezervasyonunda aradığı için çakışma belirsizlik üretir. Sonraki adım: ya çapraz tablo kontrolünü DB'ye taşımak (ortak kod tablosu / kısmi index) ya da kodları tür önekiyle ayırmak |
| 12 | **`ruff.toml` per-file-ignore merkezi defterde kayıtlı değildi** | `backend/ruff.toml:63` — `"scripts/ip1b_ddl_drill.py" = ["T201"]` | İstisna **doğru gerekçeli ve dar** (CLI aracı, konsol çıktısı provanın kanıtı; dosya + kural bazında, `scripts/` dizinine toplu muafiyet YOK) ve sözleşmede yazılıydı — ama merkezi borç defterinde değildi. Lint istisnalarının tek yerden görülebilmesi için kayda geçiyor. Sonraki adım yok; bu satır kaydın kendisidir |

## TB-19 · İP-4 nihai bağımsız audit'inin P2 listesi (on kaydın DOKUZU — öncelik sırasıyla)

| | |
|---|---|
| **Bulundu** | İP-4 (admin operasyon yüzeyi) **nihai bağımsız audit'i**, 7 Ağu 2026 — audit YEŞİL, merge `9a91e37` |
| **[[TB-17]] ile ilişkisi** | TB-17, paketin kendi kapanış turunda açık bırakılan altı kaydı taşır; audit o altısının **tamamını geçerli buldu**, hiçbiri silinmedi. Buradaki on kayıt audit'in AYRICA bulduklarıdır |
| **Neden ertelendi** | Hiçbiri para kaybı, yetki açığı ya da ölü akış değil. Audit turunda üretim koduna kapsam dışı dokunmak, denetimden geçmiş kırmızı matrisi ve kabul sözleşmesini kaydırırdı (`feedback_delivery_gates`: kabul testleri sessizce değişmez) |
| **Sonradan eklenen komşu** | Sıkışmış para kuyruğunu genişletecek olan, [[TB-20]]/4'ü de okumalı: `auto_release_no_shows`'un atladığı emanetler `PAID`/`released_at IS NULL` durumunda kaldığı için bu kuyruğun `REFUNDING` ekseninde **hiç görünmüyorlar** |

Öncelik sırası — 1 en yüksek.

| # | Kayıt | Yer | Etki / sonraki adım |
|---|---|---|---|
| 1 | **12 uçta filtre parametresi enum'a bağlanmamış** | en çarpıcısı `backend/api/routers/store.py::list_orders_admin` (`:386-395`) | [[TB-14]]/1'in aynı sınıf kardeşleri. `status_filter: str \| None = Query(alias="status")` — `OrderStatus` enum'u aynı modülde HAZIR ve düzeltilen ucun yalnız 94 satır aşağısında. Yazım hatalı bir filtre 422 yerine **sessizce boş liste** döndürür; admin "hiç sipariş yok" sanır. Hiçbir borç kaydında yoktu. Sonraki adım: 12 ucun hepsinde `Query` tipini ilgili enum'a çevirmek + geçersiz değerde 422 bekleyen gerçek HTTP testi |
| 2 | **23 admin `isError` çağrı noktası ele alınmamış** | `frontend/src/pages/admin/*` · `frontend/src/pages/dashboards/*` | İkisi öne çıkıyor: (a) `dashboards/AdminExamCatalogs.tsx:44` yalnız `{ data, isLoading }` çözüyor → istek düşünce `catalogs` `undefined` kalır ve ekran **yalancı boş katalog kuyruğu** gösterir; (b) `admin/AdminDashboardPage.tsx:63` + `:90` — `revenue` sorgusunun hatası hiç okunmuyor, `{revenue.data && <MoneySection …/>}` yüzünden **gelir bölümü hatada sessizce kaybolur**. Bu bir **para yüzeyi**: "gelir yok" ile "gelir yüklenemedi" ayırt edilemiyor. Sonraki adım: `getErrorMessage` + `ErrorState` desenini (aynı dosyanın ana sorgusunda zaten var) bu çağrı noktalarına yaymak |
| 3 | **9 admin sayfasında `canView` duvarı yok** | `AdminAccessPage` · `AdminAuditLogsPage` · `AdminBookingsPage` · `AdminDashboardPage` · `AdminDemandsPage` · **`AdminPayoutsPage`** · `AdminReportsPage` · `AdminSettingsPage` · `AdminUsersPage`/`AdminUserDetailPage` | Koruma bugün yalnız iki katmanda: menüde gizleme (`adminNavigation`) + backend 403. URL'yi elle yazan yetkisiz admin sayfayı **açar**, boş/hatalı kabuk görür. Aralarında `AdminPayoutsPage` de var — **hakediş, yani para ekranı**. Kıyas: `AdminExamCatalogs` doğru deseni uyguluyor (`if (!canView) return <AccessDenied …/>`). Sonraki adım: aynı deseni dokuzuna yaymak + her biri için "izinsiz kullanıcı `AccessDenied` görür" DOM testi |
| 4 | **`packingAccess` ve `inventoryAccess` hâlâ fail-open — üstelik yorumları artık YANLIŞ BİLGİ veriyor** | `frontend/src/lib/packing.ts:65` (yorum `:58-64`) · `frontend/src/lib/inventory.ts:43` (yorum `:36-42`) | İP-4 `lib/adminAccess.ts`'i **fail-closed** yaptı (`fa7f825`). Bu iki yardımcı `permissions === undefined` iken hâlâ `{ canView: true, canPack/canCount: true, canManage/canApply: true }` dönüyor **ve** gerekçe yorumları "`lib/adminAccess.ts` ile AYNI sözleşme" diyor — artık aynı değil. Yanlış yorum, yanlış koddan kötüdür: sonraki okuyucuyu "burası zaten hizalı" diye yanıltır. Sonraki adım: ikisini de fail-closed'a çevirmek (ya da bilinçli farkı gerekçesiyle yeniden yazmak) + üç yardımcının aynı sözleşmede olduğunu ölçen ortak test |
| 5 | **`AdminStore`'da üç korunmamış yıkıcı mutasyon** | `frontend/src/pages/dashboards/AdminStore.tsx` — kargoya ver (`:726`, `:792`), ürün Gizle/Yayınla toggle, kupon güncelle | Mutasyon 403 dönerse arayüz **sessiz**: kullanıcıya hata gösterilmiyor, iyimser durum geri alınmıyor. Admin işin olduğunu sanır. #2 ile aynı kök (hata dalı yok) ama burada **yazma** yolunda. Sonraki adım: `onError` → `getErrorDetail` + görünür uyarı; nöbetçi olarak "403'te uyarı görünür" DOM testi |
| 6 | **`/admin/escrow/stuck` sayfalanmıyor — [[TB-17]]/2'nin ölçülmüş hâli** | `backend/services/admin_operations_service.py::list_stuck_escrow` | TB-17/2 boşluğu adlandırmıştı; audit ayrıntıyı ölçtü: beş escrow modeli **tavansız** taranıyor, deneme (attempt) süzgeci **Python tarafında** uygulanıyor (yani DB'den dönen satır sayısı süzgeçten bağımsız) ve sorguyu destekleyen **index yok**. Kuyruk büyüdüğünde maliyet doğrusal değil bileşik artar. Sonraki adım: `limit/offset` + süzgeci SQL'e taşımak + kısmi index; TB-17/2 bu kayıtla birlikte kapanır |
| 7 | **`_ENTITY_ADI` ↔ `StuckEntity` elle senkron tutuluyor** | `backend/services/admin_operations_service.py` ↔ `backend/schemas/admin_operations.py` | Yeni bir escrow varlığı eklendiğinde iki yeri birlikte güncellemek gerekiyor; unutulursa etiket eksik kalır. İP-4 bunun için fail-loud davranış ekledi (`5bf327b`) — yani hata artık görünür — ama **eşleşmeyi ölçen koruyucu test yok**. Sonraki adım: enum üyelerinin tamamının haritada karşılığı olduğunu doğrulayan birim testi |
| 8 | **`COMMERCE_MANAGER` grant'ını koruyan nöbetçi test yok** | `backend/migrations/versions/ip4_operasyon_izinleri.py` ↔ `backend/core/admin_permissions.py` | Migration görev ayrılığını kuruyor: `operations.view` → SUPER_ADMIN + COMMERCE_MANAGER, `operations.manage` → yalnız SUPER_ADMIN (retry geri alınamaz dış yan etki tetikler). Bu dağılımı **hiçbir test doğrulamıyor**; ileride biri `manage`'i de ticaret yöneticisine verirse sessizce geçer. Sonraki adım: gerçek PG'de rol→izin matrisini doğrulayan entegrasyon testi (merge duman testinde elle doğrulandı: 3 satır, doğru) |
| 10 | **Sözleşme belgesinde iki küçük doğruluk kusuru** | `docs/ip4-admin-operasyon-sozlesme.md` | (a) B-1c / B-2b etiketleri gövdedeki maddelerle birebir örtüşmüyor; (b) "`waitFor` yalnız bir yerde kullanıldı" ifadesi kod tabanında doğrulanmıyor. Kod doğru, **belge** yanlış — ve bu belge kabul sözleşmesi olduğu için sonraki turların dayanağı. Sonraki adım: iki ifadeyi kodla eşitlemek |

## TB-18 · `test_production_guard` ortam değişkeninden yalancı kırmızı veriyor

| | |
|---|---|
| **Bulundu** | İP-4 kapanış regresyonu, 7 Ağu 2026 (ölçümlü, tek testte izole edildi) |
| **Bağımsız doğrulama** | İP-4 nihai bağımsız audit'i (7 Ağu 2026) kaydı **doğruladı**: test yalnız `ADMIN_PASSWORD` kabukta export'luyken düşüyor, kırmızı **ortam kaynaklı**, üretim guard'ının kendisinde kusur yok. Dosya İP-4 paketinde 0 satır değişti — yani kırmızı bu paketten gelmiyor. Kayıt aşağıdaki hâliyle geçerli kalır |
| **Yer** | `backend/tests/test_production_guard.py::_settings` (~`:42-44`) ↔ `test_guvenli_uretim_yapilandirmasi_gecer` |
| **Durum** | `_settings()` `Settings(_env_file=None, **_SAFE)` kuruyor. `_env_file=None` **yalnız `.env` dosyasını** devre dışı bırakır; pydantic-settings ortam değişkenlerini okumaya devam eder. Kabukta `ADMIN_PASSWORD=change-this-admin-password` (zayıf varsayılan) export'luysa ayar ortamdan gelir ve üretim guard'ı onu **doğru biçimde** reddeder → "güvenli üretim yapılandırması geçer" testi düşer |
| **Kanıt** | Yalnız `ADMIN_PASSWORD=change-this-admin-password` ile: FAILED. Başka bir değerle: passed. Hiç ayarlı değilken: passed (birim suite 685 passed). Aynı değer dosyanın `:78` satırında zaten guard tetikleyicisi olarak parametrize |
| **Etki** | Entegrasyon testlerini `tests/integration/conftest.py`'nin **belgelediği** biçimde (env değişkenlerini komut satırında vererek) koşan geliştirici, aynı kabukta birim suite'i koşunca bu yalancı kırmızıyı görür. Gerçek bir regresyonla karıştırılabilir; tersi daha kötü: "yine o test" diye geçiştirilirse gerçek bir guard kırılması kaybolur |
| **`ADMIN_PASSWORD` dışında hangi değişkenler?** | Ölçülmedi. `_SAFE` sözlüğündeki her anahtar aynı yoldan sızabilir (`JWT_SECRET_KEY`, `PAYMENT_PROVIDER`, `EMAIL_PROVIDER`, `AWS_*`…) — yani sorun tek bir değişkene özgü değil, fixture'ın izolasyonuna |
| **Neden ertelendi** | İP-4'ün kapsamı admin operasyon yüzeyi; dosya bu pakette **hiç değişmedi** (0 satır). Üretim guard'ının sözleşme testine kapsam dışı dokunmak, `feedback_delivery_gates`'in "kabul testleri sessizce değişmez" kuralını ihlal ederdi |
| **Sonraki adım** | `_settings()` ortamdan yalıtılmalı: ya `monkeypatch.delenv` ile `_SAFE`'in tüm anahtarları temizlenmeli, ya da `Settings` çağrısına `_env_ignore_empty`/özel bir `SettingsConfigDict` verilmeli. Nöbetçi: aynı testin, ilgili değişkenler ortamda **varken de** geçtiğini gösteren bir koşum |

## TB-17 · İP-4 P2 listesi (admin operasyon yüzeyi — açık bırakılan altı kayıt)

| | |
|---|---|
| **Bulundu** | İP-4 (admin operasyon yüzeyi) üretim uygulaması kapanışı, 7 Ağu 2026 |
| **Neden ertelendi** | Hiçbiri para kaybı, yetki açığı ya da ölü akış değil; paketin P1'leri (P1-1/P1-4/P1-5/P1-6 + TB-14/1) üretim koduyla kapatıldı. Bu altısını aynı turda çözmek, denetimden geçmiş kırmızı matrisi ve kabul sözleşmesini kaydırırdı |

| # | Kayıt | Yer | Etki / sonraki adım |
|---|---|---|---|
| 1 | **Red gerekçesi eğitmene GÖSTERİLMİYOR** | `models/tutor.py` ↔ eğitmen paneli | İP-4 gerekçeyi ZORUNLU kıldı ve `audit_logs.reason`'a yazıyor; ama eğitmen hâlâ neden reddedildiğini göremiyor. Denetim raporu "eksik akış 6"nın ikinci yarısı. Kalıcı bir alan (`Tutor.rejection_reason` ya da durum-geçmişi tablosu) + eğitmen ekranı gerekir |
| 2 | **Sıkışmış para kuyruğu sayfalanmıyor** | `services/admin_operations_service.py::list_stuck_escrow` | Beş escrow modeli tavansız taranıyor. Bugün gerçekçi (kuyruk tanım gereği küçük: otomatiğin çözemediği kayıtlar) ama `limit/offset` eklenmeli; kuyruk büyürse ekran da yavaşlar. **Ayrıntısı ölçüldü ve [[TB-19]]/6'ya taşındı** (süzgeç Python tarafında, destekleyici index yok); ikisi birlikte kapanır |
| 3 | **`AdminHome` hâlâ üç ekranı taşıyor** | `frontend/src/pages/dashboards/AdminHome.tsx` | Ölü "overview" dalı silinince 805 → ~660 satır. İlan/diploma/ad-değişikliği modern `pages/admin/*` desenine bölünmeli |
| 4 | **Hijyen nöbetçisi paralel oturumda yanıltıyor** | `backend/tests/integration/conftest.py::_hijyen_nobetcisi` | İP-4 ölçümü sırasında canlı örneği yaşandı: aynı test DB'sine ikinci bir pytest oturumu bağlıyken nöbetçi `clients: 1→2, libraries: 1→0` bildirdi — gerçek sızıntı değil, iki oturumun birbirinin sayaçlarını görmesi. Ya advisory-lock ile ikinci oturum reddedilmeli ya da karar mesajında bu olasılık anılmalı. [[TB-9]]'un akrabası ama ondan farklı |
| 5 | **`ADMIN_NAV_ITEMS` dizi sırası grup sırasıyla aynı değil** | `frontend/src/components/admin/layout/adminNavigation.ts` | Yeni menü öğesinin doğru yere konması elle; yapısal nöbetçi yok. Mevcut hâli doğru, kırılganlık kayda geçiyor |
| 6 | **`getErrorDetail` birim testi yok** | `frontend/src/lib/errors.ts` | İP-4'te eklenen saf yardımcı (sunucunun `detail` metnini korur). Davranışı üç DOM testinde dolaylı ölçülüyor; kendi testi yok |

## TB-16 · `react-router` GHSA-qwww-vcr4-c8h2 yamalanamıyor — yama React 19 istiyor

| | |
|---|---|
| **Bulundu** | 7 Ağu 2026, CI'daki `npm audit` uyarısını kapatma denemesi sırasında (ölçümlü) |
| **Yer** | `frontend/package.json` (`react-router-dom: ^7.18.1`) ↔ `.github/workflows/ci.yml` frontend "Dependency audit (npm)" adımı |
| **Açık** | GHSA-qwww-vcr4-c8h2 — "React Router: RSC Mode CSRF Bypass Allows Action Execution Before 400 Response", **high**, etkilenen aralık `react-router` **7.12.0 – 8.2.0** |
| **Neden yükseltilemiyor** | Yama yalnız `react-router@8.3.0`'da. (1) `react-router-dom`'un 8.x'i **hiç yayınlanmadı** — `latest` = 7.18.2 ve bağımlılığı `react-router: 7.18.2` olarak **tam sabitlenmiş**, yani aralığın içinde. (2) `react-router@8.3.0` **`react >= 19.2.7` / `react-dom >= 19.2.7`** peer'i ve **`node >= 22.22.0`** engine'i istiyor; proje React **18.3.1**, CI Node **20** |
| **Ölçüldü (override denemesi)** | `overrides: { "react-router": "8.3.0" }` ile gerçekten kuruldu. Sonuç: `npm audit --omit=dev --audit-level=high` → **0 açık**, `tsc -b` → **temiz**, ama `npm run test` → **5 suite çöktü**: `SyntaxError: The requested module 'react' does not provide an export named 'useOptimistic'` (v8, React 19 hook'unu çağırıyor). 697 testin yalnız 576'sı koşabildi; 5 dosya hiç yüklenemedi. Değişiklik geri alındı, temiz hâlde 70 dosya / 697 test yeşil |
| **Kök `CLAUDE.md` §B/§F açısından** | Bu, "audit + tsc yeşil ≠ çalışıyor"un canlı örneği: paket yöneticisi ve tip denetleyici sorunu **göremedi**, kırmızıyı yalnız gerçek DOM (RTL/`MemoryRouter`) testleri verdi |
| **Geri inmek neden yanlış yön** | `npm audit fix --force` `react-router-dom@7.11.0`'a düşürüyor. Bağımsız ölçüldü (izole `--package-lock-only` denemesi): 7.11.0'da **14 açık** var — `<Link>`/`useNavigate` open redirect, SSR/ScrollRestoration XSS, turbo-stream üzerinden **kimliksiz RCE**, `__manifest` DoS. Yani "audit temiz görünsün" diye inmek güvenliği ölçülebilir biçimde **azaltır** |
| **Bugünkü gerçek risk** | Düşük. Açık RSC (React Server Components) moduna ve server action işlemeye özgü; bu uygulama declarative SPA — `BrowserRouter` + `Routes`, kullanılan API yüzeyi `Link/NavLink/Navigate/Outlet/Route/Routes/useLocation/useNavigate/useParams/useSearchParams` + `MemoryRouter`. `react-router/rsc` girişi hiç import edilmiyor, server action yok |
| **Neden ertelendi** | Düzeltmenin tek yolu **React 18 → 19 major yükseltmesi** (+ CI Node 20 → 22). Bu, react-dom, `@testing-library/react`, `react-leaflet@4`, `react-cropper`, `@types/react` dahil tüm ekosistemi ilgilendiren ayrı bir pakettir; tek bir CVE uyarısını susturmak için yapılacak iş değil |
| **CI'nin bugünkü duruşu** | Audit adımı `continue-on-error: true` ile koşuyor ve gerekçesi adımın üstünde yorum olarak duruyor (job kırmızıya düşmüyor, uyarı görünür kalıyor). Bu bilinçli bir istisnadır, genel bir susturma değil: adım kaldırılmadı, çıktısı `|| true` ile yutulmuyor, yeni açıklar raporda görünmeye devam ediyor |
| **Sonraki adım** | (1) Ayrı bir paket olarak React 19 + `react-router` 8 yükseltmesi (CI `node-version` 22'ye çekilerek); (2) o pakete kadar `npm audit` çıktısının **her turda okunması** — bu istisnanın altında yeni bir açık birikirse fark edilmeli; (3) yükseltme yapıldığında CI'daki istisna yorumu ve bu kayıt birlikte silinir |

<!-- Kapanma notu (İP-18, `517c251`): **TB-15** ("Mağaza para sözleşmesinin
     kaçağı") KAPANDI ve dosyanın kendi kuralı gereği SİLİNDİ. (a) ayağı zaten
     İP-5'te kapanmıştı; kalan (b) ayağını İP-18 kapattı. Ölü-varlık dalı artık
     `refunded_amount`'a **mutlak atama yapmıyor**: rezervasyon niyetle AYNI
     atomik UPDATE'e biniyor (`refund_reserved = refund_reserved + tutar`),
     tavan claim'in kendi koşulunda (`refund_reserved + tutar <= total`) ve
     tutar tek yazıcıdan geçiyor (`apply_refunded_amount`, M6 — artırımlı +
     `LEAST(..., total)`). İkisi de `commit`'ten ÖNCE, aynı transaction'da;
     çökme semantiği değişmedi. Detay: `docs/ip18-siparis-kilit-sozlesme.md`
     §4. **Açık kalan tek parça** ("kod tabanında `refunded_amount`'a yazan tek
     yer" yapısal nöbetçisi) yazılmadı — İP-18 kendi alanında eşdeğerini kurdu
     (`payment_status='PAID'` yazan tek yer nöbetçisi,
     `tests/test_ip18_odeme_kosulu.py`); `refunded_amount` için aynı nöbetçi
     hâlâ yok ve [[TB-38]]'in (a) maddesi kapsamındadır. -->

## TB-14 · İP-2a P2 listesi (audit'te açık bırakılan sekiz kaydın YEDİSİ — öncelik sırasıyla)

| | |
|---|---|
| **Bulundu** | İP-2a (mağaza iade / refund para güvenliği) nihai bağımsız audit'i, 4 Ağu 2026 — paket YEŞİL kapandı, aşağıdakiler bilinçli olarak P2'ye bırakıldı |
| **Neden ertelendi** | Hiçbiri para kaybı veya yetki açığı değil; audit'in P0/P1 listesi üretim koduyla kapatıldı. Bu sekizi merge turunda çözmek, denetimden geçmiş kırmızı matrisi ve kabul sözleşmesini kaydırırdı (`feedback_delivery_gates`: kabul testleri sessizce değişmez) |

Öncelik sırası — 1 en yüksek. **#1 (admin `refund_status` filtresi) İP-4'te
KAPANDI ve dosyanın kendi kuralı gereği SİLİNDİ** (filtre `ReturnRefundStatus`
enum'una bağlandı, geçersiz değerde 422; aynı çağrının `status` filtresi de
birlikte bağlandı — bkz. `docs/ip4-admin-operasyon-sozlesme.md` §1/E).
Kalan kayıtların numaraları KORUNDU: `#2`, `#7`, `#8` gibi atıflar başka
belgelerde geçiyor ve kaydırmak onları sessizce yanlış kayda bağlardı.

| # | Kayıt | Yer | Etki / sonraki adım |
|---|---|---|---|
| 2 | **`_settle_return` kilit-sırası yapısal nöbetçisi kayboldu** | `backend/tests/acceptance/test_stock_lock_contract.py:237-250` | Sıra matrisinden **gerekçeli olarak** çıkarıldı (PK-α ile bu fonksiyonda ürün kilidi kalmadı, sözleşme `receive_return`'e taşındı). Kalan boşluk: birisi `_settle_return`'e yeniden `_lock_order_products` eklerse (TB-2'nin kapanan ayağı geri gelirse) bunu yakalayan **negatif** test yok; `test_urun_kilidini_alan_tek_yer_lock_products` yalnız ham `with_for_update`'i yasaklıyor, yardımcının çağrılmasını değil |
| 3 | **`refunded_amount <= refund_reserved <= total` için DB CHECK yok** | `orders` tablosu (Alembic) | Değişmez bugün yalnız uygulama katmanında (`apply_refunded_amount` + `reserve_refund`). DB'ye doğrudan yazan bir betik ya da TB-15(b) gibi ikinci bir yazıcı sözleşmeyi sessizce bozabilir. Düzeltme: CHECK constraint migration'ı + ihlali kırmızıya çeviren PG testi |
| 4 | **`OrderReturnReceiveIn.note` sessizce yutuluyor** | fiziksel kabul ucu (`store.py` → `order_service.py::receive_return`) | Şema alanı kabul ediyor, servis hiçbir yere yazmıyor. Operatörün "kutu hasarlı geldi" notu kaybolur — kullanıcı gözünde veri kaybı. Düzeltme: notu iade kaydına/olay geçmişine yaz ya da şemadan kaldır (sessiz yutma iki hâlde de yanlış) |
| 5 | **`notifications` / `outbox_events` test hijyen boşluğu** | `tests/integration/conftest.py::_KRITIK_TABLOLAR` | İP-2a'nın kendi deltası ölçülmedi; genel boşluk zaten [[TB-8]] altında açık. Burada yalnız İP-2a paketinin de aynı iki tabloda delta bırakıp bırakmadığının ölçülmemiş olması kayda geçiyor |
| 6 | **`f30_factory` sabit `auth_version=1`** | `backend/tests/integration/f30_factory.py` | İP-3 `auth_version` sözleşmesinden sonra fabrika değeri sabit; hesabın gerçek `auth_version`'ı 1 değilse token sözleşmesi testte yanlış tarafından doğrulanır (bugün geçiyor çünkü fabrika hesapları hep 1'de). Kırılganlık: sürüm artıran bir davranış eklenince sessizce yalancı yeşil |
| 7 | **`mutation_drill.py` üç eksik** | `backend/scripts/mutation_drill.py` | (a) mutasyon geri alındıktan sonra dosyanın **SHA-256 ile** eski hâline döndüğü doğrulanmıyor; (b) mutasyondan önce **yeşil taban çizgisi** alınmıyor (zaten kırmızı bir testi "mutasyonu yakaladı" sayabilir); (c) hedef AST node'unun **beklenen düğümle eşleştiği** doğrulanmıyor (yanlış yeri mutasyona uğratıp "yakalandı" diyebilir). Kök `CLAUDE.md` §D bu sürücüyü resmî araç olarak anıyor — güvenilirliği doğrudan test kalitesi iddiasını taşıyor |
| 8 | **frontend `inventoryScreens` flake'i — AZALDI ama SÜRÜYOR** | `frontend/src/pages/admin/inventory/inventoryScreens.acceptance.test.tsx` | **Kayıt bir kez erken kapatıldı ve geri kondu.** İP-12 FAZ 0 `testTimeout`'u 5000 → 9000 ms'ye çekti ve 5 koşumun 5'inde yeşil gördüğü için kaydı "kapandı" sayıp sildi. İP-12 audit'i **7 koşumun 1'inde** düşüşü tekrar gördü: ağır yük altında `ProductPicker`'ın debounce + istek zinciri `findBy` penceresine yetişemiyor (A12 ile eklenen seçici, bu dosyadaki hasar akışlarında artık bir ağ turu daha ekliyor). Yani kök neden TB-23'ün ölçtüğü "bütçe dar" sınıfından; bütçe genişledi, olasılık düştü ama SIFIRLANMADI. Ölçüm: 9000 ms bütçede bu dosyanın en ağır testi ~1786 ms (payı %20) — boşta. Sonraki adım: seçicinin bekleme zincirini testte deterministik hâle getirmek (sahte zamanlayıcı ya da debounce'u test ortamında kısaltmak); bütçeyi daha da büyütmek ÇÖZÜM DEĞİL, gerçek yavaşlama regresyonunu gizler |

## TB-13 · KVKK silme: kurye PROFİLİ (vesikalık/plaka/telefon) ve silme audit kaydı — ürün kararı bekliyor

| | |
|---|---|
| **Bulundu** | İP-3 üretim uygulaması (Commit D — hesap silme/KVKK) |
| **Yer** | `backend/services/account_deletion_service.py::anonymize_account` ↔ `backend/models/courier.py` (`name`/`phone`/`photo_url`/`vehicle_plate`) |
| **Durum** | Kurye kendi GİRİŞ hesabını (`courier_accounts`) sildiğinde hesap anonimleşiyor ve token'lar ölüyor; ama `courier_id` ile bağlı **Courier profili** (isim, telefon, `private/` vesikalık foto, plaka) admin-yönetimli işletme kaydı olduğu için DOKUNULMUYOR. Benzer şekilde `LibraryOperator.library_id` bağı anonimleştirmede kalıyor (tek başına tanımlayıcı değil, re-identification vektörü düşük). Ayrıca kullanıcı tetikli hesap silme `audit_logs`'a satır YAZMIYOR (yalnız PII'siz `logger.info`); bu yüzden İP-3'ün "silme audit kaydı PII sızdırmaz" testi bugün boş küme üzerinde geçiyor |
| **Neden ertelendi** | İP-3 sözleşmesi bu iki noktada karar içermiyor; sözleşme talimatı açık: "keyfî yeni ürün politikası uydurma; belirsizliği raporla". Kurye profili çalışan/işletme kaydı mı (saklama meşru) yoksa kişisel veri talebiyle silinmeli mi — ürün + hukuk kararı. Silme audit kaydı yazmak ise hijyen nöbetçisi ve test teardown kapsamını da değiştirir |
| **Sonraki adım** | (1) Kurye ayrılınca `Courier` profilinin anonimleştirilme/saklama süresi kararı (PoD 12 ay kararıyla birlikte düşünülmeli); (2) hesap silmeye actor'ü kendisi olan bir audit satırı + testte "kayıt VAR ve PII yok" biçimine geçiş |

## TB-12 · İP-3 P2 nöbetçi eksikleri (test tarafı — kapanış denetiminden sonra eklenmeli)

| | |
|---|---|
| **Bulundu** | İP-3 üretim uygulaması kapanışı (P2 listesi) |
| **Yer** | `backend/tests/integration/test_ip3_*.py` + `tests/integration/conftest.py::_KRITIK_TABLOLAR` |
| **Durum** | Üretim davranışı kapatıldı ama şu nöbetçiler YOK: (a) ADMIN 404 beklentileri yalnız durum kodunu ölçüyor, Not Found gövdesini değil; (b) `_admin_rota_kimlikleri()` boş dönerse 29 ADMIN node'u sessizce kaybolur (parametrize boş küme — modül seviyesi sert assert yok); (c) TUTOR→LIBRARY mesaj yönü kodda kapalı (`_can_message` iki yönü de reddeder) ama bu yönün davranış testi yok; (d) `GET /reviews/booking/{id}` admin erişimi `reports.view` iznine bağlandı — admin nöbetçi testi yok; (e) rol→model eşlemesi tek kaynağa indirildi (`auth_service.MODEL_BY_ROLE_ID`) ve `auth_version` mixin'e taşındı, ama "yeni rol eklenince kataloglar/mixin unutulursa kır" diyen yapısal drift nöbetçisi yok; (f) İP-3 hijyen tablosu kapsamı: `_KRITIK_TABLOLAR` `tutors`/`library_operators`/`courier_accounts`/`libraries` saymıyor |
| **Neden ertelendi** | İP-3 kırmızı matrisi bağımsız denetimden geçmiş test dosyalarıdır; üretim turu sırasında bu dosyalara davranış ekleyip denetimin onayladığı sözleşmeyi kaydırmamak bilinçli tercih. Kapsam da kontrolsüz büyümesin (İP-3 talimatı) |
| **Sonraki adım** | Ayrı, küçük bir test-güçlendirme commit'i: (a)+(b) gate dosyasına, (c) mesajlaşma dosyasına, (d) review dosyasına birer nöbetçi; (e) için `_LOGIN_PRECEDENCE`×`AuthVersionMixin` yapısal testi; (f) için hijyen tablosuna 4 tablo |

## TB-11 · CI entegrasyon adımı seed admin'siz koşuyor (`seed_admin` sessizce no-op)

| | |
|---|---|
| **Bulundu** | İP-3 (yetki/KVKK) kırmızı test matrisi — temiz bir test veritabanında ölçüldü |
| **Yer** | `backend/core/seed.py::seed_admin` (ilk iki satır) ↔ `.github/workflows/ci.yml` (`env:` bloğu) |
| **Durum** | `seed_admin` `ADMIN_EMAIL` **ve** `ADMIN_PASSWORD` ayarlı değilse hiçbir şey yapmadan döner — hata da log da yok. CI iş akışının `env:` bloğunda ikisi de tanımlı değil. Stok/envanter entegrasyon testleri ise `admins.id = 1`'i (seed admin) varsayıyor: `actor_id=1`, `created_by_admin_id=1` |
| **Etki** | Temiz bir veritabanında entegrasyon suite'inin **157 testi** `products_created_by_admin_id_fkey` ihlaliyle kırılıyor (yerelde ölçüldü: seed admin'siz 157 failed / 364 passed → seed admin'le 522 passed / 0 failed). CI'ın bu adımı ya kırmızı ya da hiç koşmuyor; her iki hâlde en riskli kod yolları korumasız |
| **İkinci kusur** | Sessiz no-op'un kendisi: "admin seed edilemedi" hiçbir yerde raporlanmıyor. Üretimde `AUTO_CREATE_DB` açılışında da aynı sessizlik geçerli |
| **Neden ertelendi** | İP-3'ün konusu yetki/kişisel veri sözleşmesi; CI zemini ayrı bir iş kolunun (İP-0) kapsamında. Düzeltme iki yerde: CI env'ine seed değişkenleri + `seed_admin`'in atlama kararını loglaması. Ayrıca testlerin `admins.id = 1` sabitine bağlılığı ayrıca gözden geçirilmeli (kırılgan varsayım) |
| **Sonraki adım** | CI `env:` bloğuna `ADMIN_EMAIL`/`ADMIN_PASSWORD` eklemek · `seed_admin`'e uyarı logu · testlerdeki sabit `1` yerine gerçek seed admin id'sini fixture'dan almak |

## TB-10 · `test_stock_migration_pg` flaky

| | |
|---|---|
| **Bulundu** | İP-3 regresyon koşuları (3 tam suite koşumu) |
| **Yer** | `backend/tests/integration/test_stock_migration_pg.py::test_bos_veritabaninda_upgrade_head_calisir` |
| **Durum** | Tam suite'in bir koşumunda kırıldı; aynı suite'in ikinci koşumunda ve test tek başına koşarken geçti (3 koşumda 1 kırılma) |
| **Etki** | Yeşil/kırmızı sinyali güvenilmez hale getirir: gerçek bir migration regresyonu "yine o flaky test" diye geçiştirilebilir |
| **Olası sebep** | Test kendi tek kullanımlık veritabanını `DROP`/`CREATE` edip `alembic`'i **subprocess** olarak koşuyor; en olası kaynak bu subprocess/DB yaşam döngüsündeki yarış (önceki koşumdan kalan bağlantı `DROP DATABASE`'i engelleyebilir) |
| **Neden ertelendi** | İP-3 yalnız test ekliyor, bu testin koduna dokunmuyor; teşhis için birkaç kez tekrarlı koşum + `pg_stat_activity` gözlemi gerekiyor |
| **Sonraki adım** | Kırılmayı yakalamak için `-p no:randomly` ile tekrarlı koşum; `DROP DATABASE ... WITH (FORCE)` kullanımı ve subprocess sonrası bağlantı kapanışının doğrulanması |
## TB-9 · `tests/acceptance` ile `tests/integration` aynı süreçte koşunca 808 sahte hata

| | |
|---|---|
| **Bulundu** | F30 commit 6 frontend dilimi kapanış doğrulaması — `pytest tests/acceptance tests/integration` tek süreçte koşturulurken |
| **Yer** | `backend/tests/acceptance/test_payment_availability_endpoint.py::client` fixture'ı (modül kapsamlı `TestClient(app)`, hiç kapatılmıyor) ↔ `core.database.engine` havuzu ↔ `backend/tests/integration/conftest.py` |
| **Durum** | Ölçüldü ve tek dosyaya kadar daraltıldı: `pytest tests/acceptance tests/integration` → **181 passed, 808 errors**; aynı testler ayrı süreçlerde **181 + 808 passed**. On kabul dosyası tek tek entegrasyonla eşleştirildi; yalnız `test_payment_availability_endpoint.py` zehirliyor (`... + test_f30_guards_pg.py` → 2 passed, 46 errors; diğer dokuzu → hepsi yeşil). Hata metni her seferinde `RuntimeError: Event loop is closed` + `AttributeError: 'NoneType' object has no attribute 'send'` (asyncpg) |
| **Sebep** | `TestClient` isteği kendi blocking-portal event loop'unda çalıştırır; uç `get_db`'yi kullandığı için **süreç geneli `core.database.engine`** havuzunda o loop'a bağlı bir asyncpg bağlantısı doğar. Portal kapanınca loop ölür, bağlantı havuzda kalır; sonraki entegrasyon testi onu havuzdan çekince ölü loop üzerinde `send` çağırır. Fixture modül kapsamlı ve `close()`/`engine.dispose()` çağrılmıyor |
| **Etki** | Suite'i **tam olarak koşturmanın** yolu kapalı: `pytest tests/` (alfabetik: acceptance → integration) 808 sahte hata verir. CI'da görünmez çünkü orada PG test veritabanı yoktur, entegrasyon testleri skip olur — yani hata yalnız *gerçek* doğrulama yapan geliştiricinin karşısına çıkar ve "suite kırık" izlenimi verir. Ters yönde daha tehlikelisi: birileri bu hataları "flaky" sayıp koşumu bölerse, gerçek bir kırmızı da o gürültünün içinde kaybolabilir |
| **F30'un doğrulaması nasıl yapıldı** | İki dizin **ayrı süreçlerde** koşturuldu (`tests/acceptance` → 181 passed · `tests/integration` → 808 passed). F30 dosyalarının bu kusurla ilgisi yok; kusur PK-1 ödeme kapıları paketinden (`0e96274`) beri var |
| **Neden ertelendi** | Düzeltme `tests/acceptance/` altındadır ve `backend/CLAUDE.md` bu dizin için "**bilinçli karar olmadan düzenlenmez**" der; ayrıca doğru düzeltme fixture'ı kapatmakla bitmez — `TestClient`'ın hangi bağlantıyı havuza bıraktığına göre `engine.dispose()` de gerekir ve bu, ödeme kabul testlerinin izolasyon sözleşmesini değiştirmek demektir. F30 commit 6'nın kapsamı paketleme istasyonudur |
| **Sonraki adım** | Fixture'ı `yield`'li yapıp `client.close()` + `await engine.dispose()` (ya da ucu `httpx.ASGITransport` ile `get_db` override'ı altında çağırmak) ve ardından bir nöbetçi: `pytest tests/acceptance tests/integration/test_f30_guards_pg.py` tek süreçte yeşil kalmalı |

## TB-8 · Hijyen nöbetçisi `notifications` ve `outbox_events`'i izlemiyor — satırlar sızıyor

| | |
|---|---|
| **Bulundu** | İKİ BAĞIMSIZ PAKETTE, ayrı ortamlarda, birbirinden habersiz ölçüldü: (a) F30 commit 2 (paket şeması) kapanış ölçümü — test veritabanında kalıntı aranırken, (b) İP-2b bağımsız denetim düzeltmesi (1 Ağu 2026) — checkpoint sonrası test DB hijyen kontrolünde. İki bulgu aynı borcu gösterdiği için **tek kayıtta** birleştirildi (İP-2b tarafındaki ayrı "TB-7" kaydı bilinçli olarak kaldırıldı; numaralandırmada main kanoniktir) |
| **Yer** | `backend/tests/integration/conftest.py::_KRITIK_TABLOLAR` ↔ teslimat/stok entegrasyon testlerinin teardown'ları |
| **Sorun** | Hijyen nöbetçisi (`_KRITIK_TABLOLAR`) `notifications` ve `outbox_events` tablolarını **kontrol etmiyor**. Suite bu iki tabloda kalıcı satır bıraksa bile "temiz" raporluyor — yani §G'nin izolasyon sözü bu tablolarda ölçülmüyor |
| **Ölçüm — F30 ortamı (`adana_f30_test`)** | Nöbetçi 19 tabloyu sayıyor; `notifications` ve `outbox_events` listede **yok**. Ölçüldü: **36 yetim bildirim** (sahibi olan `clients` satırı silinmiş, 31 Tem–1 Ağu koşumlarından) ve daha önce **90 `outbox_events`** satırı birikmişti. Hiçbiri paketlemeden değil — metinleri "kuryemiz yola çıktı" / "stok kalmadı", yani teslimat ve stok testlerinden |
| **Ölçüm — İP-2b ortamı (`adana_ip2b_test`)** | Tam `pytest tests/integration` koşumu **tur başına +10 `outbox_events`** ve **+4 `notifications`** satırı kalıcı bırakıyor (`email:order_status`, `sms:tracking_link`, `sms:failed`); suite yine de "temiz" raporluyor. Kalıntının bir kısmı **önceki oturumlardan devralınmış** (en eski satırların `created_at`'i o günkü koşumdan öncesine ait) — yani birikim turlar boyunca kalıcıdır |
| **Kapsam ayrımı** | Hedefli paketlerin **hiçbiri** yeni kalıntı bırakmıyor: **F30** — `PaketFabrikasi.temizle()` ürettiği outbox + bildirim satırlarını kimlik listesine göre siler; paket öncesi/sonrası her iki sayaç da değişmiyor. **İP-2b** — `pytest tests/integration -k ip2b` için iki tabloda da **delta 0** ölçüldü; `ip2b_factory.temizle` outbox'ı `payload->>'order_id'`, bildirimleri `(user_id, role_id)` ile daraltarak siler. Sızıntı **diğer entegrasyon paketlerinden** (teslimat/stok/verify yolları) geliyor → bu borç ne F30'a ne İP-2b'ye bir üretim kusuru olarak yüklenmemelidir |
| **Etki** | Kök `CLAUDE.md` §G'nin sözü ("bir testin ürettiği veri başka teste kalmaz") bu iki tabloda **kanıtsız**. Biriken bildirim gerçek bir kullanıcının bildirim listesini şişirmez (test DB'si ayrı) ama sızıntıyı gizler: yarın bir teslimat testi bildirim SAYISINA bakan bir iddia yazarsa, önceki koşumun bıraktığı satırlar yüzünden sırayla-geçen/tek-başına-kalan bir flaky test doğar |
| **Risk** | (1) **Yanlış yeşil izolasyon raporu** — nöbetçi "temiz" derken suite kalıcı satır bırakıyor; (2) **tekrar koşumlarda birikme** — tur başına sabit delta, turlar boyunca sınırsız büyür; (3) **sıraya ve eski kalıntıya bağımlılık** — sayaç okuyan bir iddia yazıldığı anda test sonucu, o veritabanında daha önce hangi paketin koştuğuna bağlı hâle gelir |
| **Neden ertelendi** | İki tabloyu nöbetçiye eklemek suite'i **hemen kırar** — ama kıran testler ne F30'un ne İP-2b'nin; teslimat/stok paketlerinin testleridir. Sızdıran teardown'ları bulup düzeltmek o paketlerin kapsamındadır; F30 commit 2 şema commit'idir, İP-2b turu ise parti-izolasyonu nöbetçisiydi — ikisinde de kapsamı genişletmek paketi (ve İP-2b'de kırmızı checkpoint sayımını) bulanıklaştırırdı |
| **Sonraki adım** | (1) Sızdıran teardown'ları **isim bazında** bul (`outbox_events` yazan teslimat testleri + `notifications` yazan stok/teslimat testleri), (2) her test/fabrika teardown'ında temizliği sipariş/müşteri kimliğine göre kapsamla (ip2b/F30 fabrikalarındaki daraltılmış DELETE deseni örnek), (3) iki tabloyu `_KRITIK_TABLOLAR`'a ekle, (4) mevcut kalıntıyı tek seferlik temizle |
| **Kabul ölçütü** | (a) Temiz bir test veritabanında tam `tests/integration` koşumu sonrası `notifications` ve `outbox_events`'te **beklenmeyen delta olmaması** (sıfır ya da açıkça belgelenmiş bir delta); (b) hedefli `-k f30` ve `-k ip2b` koşumlarının kendi deltalarının **sıfır kalması**; (c) nöbetçinin gerçek bir sızıntıyı **kırmızıya çevirdiğinin** gösterilmesi (kasten sızdıran bir teardown ile prova) |
| **3 Ağu 2026 doğrulaması** | (c) maddesi ARTIK KANITLI: `clients` tablosuna kasıtlı tek satır bırakan geçici bir test, alt pytest sürecini **çıkış kodu 1** ile düşürdü ve `TEST İZOLASYONU BOZUK — suite kalıcı satır bıraktı: clients: 0→1` mesajını bastı. (b) maddesi de ölçüldü: `-k ip2b` ve `-k f30` deltaları **0**. (a) hâlâ AÇIK: temiz DB'de tam koşum `outbox_events +10`, `notifications +4` bırakıyor — bu iki tablo hâlâ nöbetçide değil, sızıntı hâlâ teslimat/stok paketlerinden |
| **Nöbetçinin görünürlüğü düzeltildi** | Nöbetçi kararı `pytest.fail` ile veriyordu; bir testin KENDİ teardown'ı da patladığında pytest bunu `BaseExceptionGroup` içine sarıyor ve `-q` özet satırında yalnız *"errors during test teardown (2 sub-exceptions)"* görünüyordu. Karar gövdede duruyordu ama özete bakan gözden kaçtı ve bir denetim turunda **"nöbetçi sızıntıyı kaçırdı" diye YANLIŞ raporlandı** (oysa doğru çalışıyordu). Karar artık ayrıca ham `stderr`'e `[HİJYEN NÖBETÇİSİ] …` satırı olarak basılıyor (`conftest.py::_nobetci_duyur`); sarmalanmış hâlde de göründüğü provayla doğrulandı |

## TB-6 · `audit_logs` DB seviyesinde değişmez değil

| | |
|---|---|
| **Bulundu** | F29 commit 9 bütünsel güvenlik denetimi |
| **Yer** | `backend/migrations/versions/532b1fa8771d_baseline_schema.py` (audit_logs tanımı) ↔ `f29_sayim_hasarli_stok.py:581-596` (`inventory_append_only()`) |
| **Durum** | F29 üç iz tablosunu DB trigger'ıyla kilitledi: `stock_movements`, `stock_damage_events`, `stock_count_line_events` — UPDATE ve DELETE reddediliyor. **`audit_logs` için böyle bir trigger yok.** |
| **Etki** | Denetim kaydının kendisi, koruduğu tablolardan daha zayıf. Uygulama katmanında koruma var (`audit_service` yalnız INSERT + okuma yapıyor; `api/`+`services/` taramasında `AuditLog` UPDATE/DELETE eden tek satır yok), ama DB'ye doğrudan erişen bir betik ya da ileride eklenecek bir "denetim temizliği" ucu izi sessizce değiştirebilir |
| **Neden ertelendi** | `audit_logs` F29'un tablosu değil; bütün admin aksiyonlarının ortak tablosu. Trigger eklemek migration + testlerin temizlik yollarının gözden geçirilmesini gerektirir (test teardown'ları bugün `DELETE FROM audit_logs` kullanıyor — trigger onları kırar ve `db_guard` desenine taşınmaları gerekir). F29 bir **regresyon getirmiyor**, mevcut asimetriyi belgeliyor |
| **Sonraki adım** | `inventory_append_only()` fonksiyonunu `audit_logs`'a da bağlayan migration + test teardown'larını trigger'ı geçici kapatan `db_guard` yardımcısına taşımak |

## TB-5 · `SALE_CANCEL` hareketinin `ref_type` etiketi yanlış tabloyu adlandırıyor

| | |
|---|---|
| **Bulundu** | F29 commit 9 defter call-site denetimi |
| **Yer** | `backend/services/order_service.py:1294-1296` |
| **Durum** | `ref_type="order_item"` yazılıyor ama `ref_id=order.id` (yani `orders.id`) veriliyor. Defterin geri kalanında `ref_type`, `ref_id`'nin **tablosunu** adlandırır: `SALE` → `("order", order.id, item.id)`, `RETURN` → `("order_return", ret.id, ri.id)`, hasar → `("damage_event", olay.id)` |
| **Etki** | (1) Yönetici ekranı iptal satırını "Sipariş kalemi #57" diye basar, hemen üstündeki satış satırı "Sipariş #57" der — aynı sipariş, iki farklı etiket. (2) `ref_type=order&ref_id=57` filtresi `SALE`'i getirir, `SALE_CANCEL`'ı **getirmez**; iptal edilmiş siparişin stok geçmişi eksik görünür |
| **Neden ertelendi** | F29 öncesinden gelen bir etiketleme hatası; F29 güvenliğini bozmuyor. Üstelik **veri migration'ı olmadan düzeltilemez**: fazla-geri-yükleme tavanı `stock_ledger.py:384-386` tam olarak `movement_type='SALE_CANCEL' AND ref_type='order_item'` çiftini sorguluyor. `ref_type`'ı tek başına düzeltmek bu sorguyu sessizce 0 döndürür, tavan kalkar ve kısmi iade + tam iptal senaryosunda stok satılandan fazla artar |
| **Sonraki adım** | Tek commit'te: mevcut satırları `ref_type='order'`'a çeviren migration + `restored_quantity_by_order_item` sorgusunun güncellenmesi + kısmi iade ⟂ tam iptal yarışının yeniden koşulması |

## TB-4 · Transaction sahipliği belirsiz: uçtaki açık `commit` ile `get_db`'nin otomatik commit'i çakışıyor

| | |
|---|---|
| **Bulundu** | F29 commit 7 mutasyon provası (M9a: açık `commit()` satırının kaldırılması hiçbir testi kırmadı) |
| **Yer** | `backend/core/database.py::get_db` (`yield session` sonrası `await session.commit()`) ↔ yazan bütün router uçları (ör. `backend/api/routers/inventory.py`) |
| **Durum** | `get_db` başarılı istekte oturumu **kendisi** commit ediyor. Uçlardaki açık `await db.commit()` bu yüzden kalıcılık için gerekli değil; transaction sınırını yalnız **okunabilir** kılıyor |
| **Etki** | Sahiplik iki yerde: bir uç commit'i unutursa hata SESSİZ kalır (yine de kalıcı olur) ve kod okuyan "burada commit yok, demek ki yazmıyor" diye yanılır. Ters yönde de: uç commit ettikten SONRA yanıt kurarken hata alırsa `get_db` rollback'i artık bir şeyi geri almaz — kısmi başarı ortaya çıkar (ör. sayım oturumu oluşur, yanıt 500 döner) |
| **Neden ertelendi** | Doğrusu tek sahip seçmektir: ya `get_db` commit etmez ve her yazan uç açıkça commit eder, ya da uçlar hiç commit etmez. Her iki yön de ~35 router ve yüzlerce ucu ilgilendiren proje geneli bir refactor'dır; F29 commit 7/8'in kapsamı envanterdir |
| **Şimdilik hangi taraf** | Envanter uçları **açık commit** yazıyor (sınır görünür olsun diye). Kalıcılığın gerçek sözleşmesi davranış testiyle korunuyor: `test_HASAR_TRANSFERI_iki_kovayi_ATOMIK_degistirir` (commit→rollback mutasyonu M9b ile kırıldığı kanıtlandı) |
| **Sonraki adım** | `get_db`'nin commit'ini kaldırıp yazan uçları açık commit'e geçirmek (fail-loud yön) ve bir kabul testiyle "yazan uç commit etmezse veri kalıcı olmaz" sözleşmesini sabitlemek |

## TB-2 · İade akışında sağlayıcı çağrısı boyunca ürün satırı kilitli kalıyor (yalnız `_refund_payment`)

| | |
|---|---|
| **Bulundu** | Stok hareket defteri paketi, commit 5 (iki fazlı iadenin telafi sırası değiştirilirken) |
| **Yer** | `backend/services/order_service.py::_refund_payment` — `_lock_order_products` (~`:1732`) → `escrow.perform_refund` (~`:1740`) |
| **4 Ağu 2026 daraltması (İP-2a merge'i)** | Kaydın `_settle_return` ayağı **KAPANDI**: PK-α ile o yolda stok hiç değişmiyor, `_lock_order_products` çağrısı kalmadı ve `escrow.begin_refund`'ın commit'i Order kilidini sağlayıcı çağrısından ÖNCE bırakıyor. Ürün kilidi sözleşmesi `receive_return`'e (fiziksel kabul) taşındı. Geriye yalnız `_refund_payment` ayağı kalıyor — aşağıdakiler onun içindir |
| **Durum** | Ürün satırları `FOR UPDATE` ile kilitleniyor, **sonra** ödeme sağlayıcısına HTTP isteği gidiyor, telafiler dönüşte uygulanıyor. Yani kilitler bir dış ağ çağrısı boyunca tutuluyor. Kod bunu artık açıkça kabul ediyor (`order_service.py:1727-1731` yorumu) |
| **Neden böyle** | Telafiler artık yalnız sağlayıcı **başarılı** olduktan sonra uygulanıyor (para dönmeden mal geri gelmiş sayılmasın). Ama `perform_refund` içindeki `finalize_refund` sipariş satırını UPDATE ediyor, yani **Order kilidi** alıyor. Ürün kilidini o noktadan sonra almak bu yolu `Order → Product` yapar ve `_finalize_paid`'in `Product → Order` sırasıyla **gerçek bir deadlock döngüsü** kurar (plan §4e) |
| **Etki** | Sağlayıcı yavaşsa (iyzico HTTP, saniyeler) o siparişteki ürünlerin satırları kilitli kalır; aynı ürünü almaya çalışan eşzamanlı ödemeler bekler. İade **nadir ve yönetici tetikli** olduğu için pratikte dar bir pencere |
| **Değerlendirilen alternatifler** | (a) Telafiyi Faz 2 commit'inden sonraya almak → süreç orada ölürse sipariş REFUNDED olduğu için reconciler devralmaz ve **stok geri yüklemesi kalıcı olarak kaybolur**. (b) Kilit sırasını global olarak `Order → Product` yapmak → `_finalize_paid` ürünleri PAID claim'inden ÖNCE kilitlemek zorunda (oversell ön kontrolü), yani mümkün değil. (c) Savepoint'li iyimser geri yükleme → kilitler yine sağlayıcı çağrısı boyunca tutulur, üstüne karmaşıklık ekler |
| **Neden ertelendi** | Doğru çözüm, sağlayıcı çağrısını transaction dışına alan bir **outbox / iş kuyruğu** desenidir (mevcut `core/outbox` altyapısı buna uygun). Bu, ödeme/iade mimarisinin yeniden tasarımıdır ve stok paketinin kapsamı dışındadır |
| **İzleme** | Kilit bekleme süresi üretimde gözlenmeli: `pg_stat_activity` üzerinde `wait_event_type = 'Lock'` + `products` birleşimi bir uyarıya bağlanabilir |
| **Koruma** | Kanonik sıra `tests/acceptance/test_stock_lock_contract.py`, deadlock yokluğu `tests/integration/test_stock_lock_order_pg.py` (5 çift × ters sıra × 3 tur, `lock_timeout`'lu) ile sabitlendi. Sıra bozulursa testler kırılır. Matris İP-2a ile güncellendi (`_settle_return` çıktı, `settle_refunded_order` ve `receive_return` girdi); kalan nöbetçi boşluğu [[TB-14]] #2 |
