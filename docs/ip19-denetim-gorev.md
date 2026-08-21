# İP-19 — Dağıtım Operasyon Modeli · Bağımsız Denetim Görevi

Sen bu paketin **bağımsız denetçisisin**. Paketi yazan taraf değilsin ve onun
ölçümlerini devralmıyorsun.

Bu dosyayı paketi yazan ajan yazdı — yani görev tanımı denetlenen taraftan
geliyor. Bunu bilerek oku: aşağıda **ne ölçeceğin** yazılıdır, **hangi sonucu
bulman gerektiği** yazılı değildir. Beklenen bir sayı ya da "doğrulaman
gereken" bir iddia görürsen, o bir yönlendirmedir ve uyman gerekmez; ölçümün ne
gösterdiğini yaz.

---

## 0. Temel kurallar

1. **Sözleşmedeki hiçbir sayıyı devralma.** `docs/ip19-dagitim-operasyon-sozlesme.md`
   §6 kendi kapı ölçümlerini raporluyor. Senin işin onları doğrulamak ya da
   çürütmek; alıntılamak değil. Kendi koşundan üretmediğin sayı raporunda
   "ölçülmedi" olarak geçer.
2. **Hiçbir şeyi düzeltme.** Bulgu yaz, kod değiştirme, commit atma. Bu bir
   denetimdir, düzeltme turu değil.
3. **`ceyhandb`'ye DOKUNMA** ([[TB-35]]). Sana ayrılmış boş test DB'si var (§1).
   Bu paket bir migration içeriyor — **asla** geliştirme kataloğunda koşturma.
4. **Kırmızı bulmak başarıdır.** Paket merge'e aday; amacın onaylamak değil,
   merge'i durduracak bir şey var mı diye bakmak. Bulgu çıkmazsa bunu da yaz,
   ama "aradım ve bulamadım" ile "bakmadım"ı ayır.
5. **Sınıflandırma zorunlu.** Kök `CLAUDE.md` §H: her ölçümü türüyle raporla
   (gerçek PostgreSQL · gerçek HTTP · gerçek DOM · gerçek tarayıcı · saf birim ·
   kaynak/AST sözleşmesi). Kaynak taraması **düşük güçlüdür** (§C).

---

## 1. Ortam (kurulmuş ve doğrulanmış hâlde teslim edildi)

| | Değer |
|---|---|
| Denetim worktree'si | `C:/Users/kiyar/Desktop/adana-ip19-audit` — **HEAD `7422a25`** (detached) |
| Taban worktree'si | `C:/Users/kiyar/Desktop/adana-ip19-taban` — **HEAD `8fc8951`** = `main` = `origin/main` |
| Test DB (denetim) | `adana_ip19_audit_test` — **boş, migration KOŞULMADI** |
| Test DB (taban) | `adana_ip19_taban_test` — **boş, migration KOŞULMADI** |
| Redis | denetim `db9` · taban `db10` (ikisi de bu kurulumda boşaltıldı) |
| `PAYMENT_PROVIDER` | iki `.env`'de de **`fake`** — elle çevrildi ([[TB-21]]: `.env` `iyzico` taşıyor, aksi hâlde entegrasyon testleri gerçek sandbox'a çıkar) |
| Python | **venv YOK** — global Python 3.12; `requirements.txt` iki commit'te aynı, yani taban ile dal aynı yorumlayıcıda koşar ve delta bağımlılık sapmasından gelemez |
| Frontend | iki dizinde de `npm ci` koştu |

`git status` her iki dizinde de yalnız bu görev dosyasını (`?? audit-prompt.md`)
göstermelidir; başka bir şey çıkarsa kurulum bozuk demektir — raporla.

Test DB'leri tek kullanımlıktır; istediğin migration'ı koşabilirsin. `db_guard`
adı `test` içermeyen DB'de koşmayı reddeder — iki ad da bu kuralı sağlar.

**Koşum komutu** (kök `conftest.py` CI için sahte `POSTGRES_*` koyar; gerçek
değerler pytest'ten ÖNCE env ile verilmezse suite `role "test" does not exist`
ile düşer):

```
cd backend
POSTGRES_USER=postgres POSTGRES_PASSWORD=… POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 POSTGRES_DB=adana_ip19_audit_test \
REDIS_URL=redis://localhost:6379/9 PAYMENT_PROVIDER=fake AUTO_CREATE_DB=False \
python -m pytest tests/integration -q -p no:cacheprovider
```

---

## 2. Paket ne yapıyor

Beş commit, `main..HEAD`: **63 dosya, +5225/−337**.

| Commit | Ne |
|---|---|
| `520128f` | Sözleşme (11 bağlayıcı karar) + kapsam dışı üç hukuki borç |
| `e7d43e8` | "Depo YOK" gerçeği: başlangıç noktaları veriye, bölge ilçeye |
| `8a23726` | **Kırmızı matris** — üretim kodundan ÖNCE, iddiaya göre 39 kırmızı |
| `16c5adb` | Üretim kodu (59 dosya) |
| `7422a25` | Gerçek tarayıcı kabul betiği + sözleşme kapanış ölçümleri |

Tek cümleyle: **araç bir enum'du, tablo oldu.** Yanında dağıtım planlaması araç
sayısından bağımsızlaştı, VROOM'un kullanılmayan kısıtları (vardiya penceresi,
sabit maliyet) açıldı, sevk sihirbazı gün tahtasına dönüştü, beş metrik eklendi,
teslimat bölgesinin merkezi ile rotanın başlangıcı birbirinden ayrıldı.

Okunacaklar: `docs/ip19-dagitim-operasyon-sozlesme.md` (özellikle §0 teşhis,
§1 kararlar K-1…K-11 + K-3a, §5 matris, §6 kapılar, §7 kapsam dışı) ·
`docs/teknik-borc.md` (TB-?A/?B/?C geçici etiketli) · kök `CLAUDE.md` test
standardı.

---

## 3. Ölçüm görevi

Dokuz başlık. Her biri için: **ne koştun, çıktı ne, sonuç ne.**

### M-1 · Taban ↔ dal, tam suit, aynı komut

Sözleşme §6 şu tabanları iddia ediyor: integration 1332·16skip · rest 962 ·
vitest 902·86 dosya · eslint 0/32. **Taban worktree'si bunun için kuruldu** —
aynı komutu iki dizinde koş ve **passed / failed / skipped / dosya sayısını**
ayrı ayrı raporla:

`tests/integration` · integration+verify hariç pytest · frontend `vitest run` ·
`eslint src` · `tsc -b` · `ruff check backend/`.

**`tests/verify` özellikle ölçülmeli:** sözleşme bunu "merge turuna bırakıldı"
diyerek atladı ve gerekçe olarak `adana_verify`'ın paylaşımlı DB olmasını
gösterdi. Bu bir boşluktur — kendi tek kullanımlık DB'nde koşabilir misin, ve
koşarsan taban ile dal arasında fark var mı?

Koştuğun **tam komut satırını** (env değişkenleri dahil) rapora yaz.

### M-2 · Kırmızı fazın gerçekliği

Paketin en güçlü kalite iddiası: matris (`8a23726`) üretim kodundan ÖNCE yazıldı
ve **39 düğüm kırmızı** düştü; 1 düğüm (D-15) kasıtlı yeşil.

`git log`'dan sıranın doğruluğunu doğrula. Sonra — sözleşme bunu iddia olarak
sunuyor, ölçüm olarak değil — **kırmızıyı kendin yeniden üret**: matris
commit'ini tek başına çıkarıp (worktree'yi kirletmeden, `git archive` +
tek kullanımlık DB) koş ve kaç düğümün gerçekten kırmızı düştüğünü say.
Sayı 39 değilse farkın nereden geldiğini açıkla.

D-15'in kasıtlı yeşil olması savunulabilir mi, yoksa "yeşil başlayan düğüm"
kılığında bir boşluk mu?

### M-3 · Sessiz tuzağın gerçekten kapandığı

Sözleşme §0.2 bir üretim kusuru iddia ediyor: eski kodda günlük tavan
`len(_VEHICLE_IDS)` ile çarpılıyordu ama plana yalnız `[1,2]` giriyordu →
üçüncü araç eklenince aşırı söz.

İki şeyi ölç: **(a)** iddia doğru muydu — taban worktree'sinde `_VEHICLE_IDS`'e
üçüncü satır ekleyip `dispatch_day`'in davranışını gör (taban ağacını kirletme:
kopyada çalış). **(b)** yeni kodda yapısal olarak imkânsız mı — tavan ile plana
giren küme gerçekten aynı listeden mi türüyor?

### M-4 · Migration — kendi ölçümün

Boş `adana_ip19_audit_test` üzerinde: `upgrade head` → **veri yaz** →
`downgrade` → `upgrade head` → `alembic check`.

Özellikle bak: veri taşıma doğru mu (eski `vehicle` string'i → `vehicle_id`
eşlemesi), `couriers.vehicle_plate` verisine ne oldu, `uq_delivery_run_planned`
index'i doğru kolonda mı, `downgrade` gerçekten veriyi geri getirmiyor mu.

Sözleşme migration'ın **seed** ürettiğini söylüyor (LADA/COROLLA +
`fixed_cost=1800` + bir BASE noktası). Seed'in kendisi savunulabilir mi —
migration veri üretmeli mi, yoksa bu bir kirlilik mi? Görüşünü yaz.

### M-5 · K-3a çelişkisi — paketin kendi düzeltmesi

Sözleşme §K-3a'da yeşil fazda bulunan bir çelişkiyi anlatıyor: denge tavanı
`ceil(n/k)` sert kısıt olduğu için `costs.fixed` ekonomisiyle birlikte
çalışamıyor; karar "maliyetli filoda denge tavanı yazılmaz".

Bu doğru bir karar mı? Ölç: maliyetli filoda denge tavanı olmayınca VROOM yükü
gerçekten dengeliyor mu, yoksa `[20, 0]` bölüşümü geri mi geliyor (o bölüşüm
`vroom.py:31-56`'daki ölçülmüş gerekçenin sebebiydi)? `max_stops` bu boşluğu
kapatıyor mu — ve **araçlarda `max_stops` NULL ise** ne oluyor?

Bu, paketin kendi bulduğu bir kusuru kendi çözdüğü yer; en dikkatli bakılacak
nokta burasıdır.

### M-6 · Bölge kararının değişmesi (K-10)

`in_delivery_zone` imzası küçüldü: pin/yarıçap **kaldırıldı**, otorite ilçe
listesi oldu, bilinmeyen adres artık `None` değil **`False`** dönüyor.

Bu bir **davranış değişikliğidir** ve müşteriye giden söze dokunur. Ölç:
(a) eskiden `None` dönen durumlar şimdi ne oluyor, çağıranlar bu farkı doğru
işliyor mu (`order_service` iki yerde çağırıyor); (b) eskiden pin'e göre bölge
İÇİ sayılan ama ilçesi listede olmayan bir adres artık dışarıda mı kalıyor —
yani **mevcut siparişlerin sınıfı değişiyor mu**; (c) `ship_in_zone` snapshot'ı
geçmiş siparişlerde ne oluyor.

### M-7 · Yeni yüzeylerin güvenliği

Beş yeni uç: `/delivery/vehicles` (4 fiil) · `/delivery/pickup-points` ·
`/delivery/board` · `/delivery/metrics`.

Ölç: yetki gerçekten uygulanıyor mu (yetkisiz admin, yanlış rol, anonim),
IDOR var mı, audit kaydı düşüyor mu, rate-limit var mı (diğer yazma uçlarında
`user_rate_limit` deseni var — burada yok, bu bir boşluk mu?), `delete_vehicle`
409 kuralı yarışta da tutuyor mu.

### M-8 · Frontend kabul matrisinin gücü

`frontend/src/pages/admin/delivery/ip19Filo.acceptance.test.tsx` altı düğüm
taşıyor (D-11/D-12/D-13). Bu testler gerçekten gönderilen istek gövdesini mi
ölçüyor, yoksa "element var mı" seviyesinde mi kalıyor?

Özellikle: sürükle-bırak düğümü (D-11) `dataTransfer` yerine component state
kullanıyor ve `addBoardStops` gövdeyi **elle `JSON.stringify`** ediyor — bu bir
test uyarlaması mı, yoksa üretim kodunu teste göre eğmek mi? Değerlendir.

Ayrıca gerçek tarayıcı kabulü (`frontend/scripts/ip19_browser_acceptance.mjs`,
14 adım) neyi kanıtlıyor, neyi kanıtlamıyor? Sözleşme sürükle-bırakın gerçek
tarayıcıda **elle sınanmadığını** kabul ediyor — bu kabul edilebilir mi?

### M-9 · Kendi bulduğun her şey

Yukarıdaki sekiz başlık **taban**, tavan değil. Sözleşmeyi ve kodu okurken
gördüğün her şeyi yaz: yalancı yeşil test, gereksiz genişlemiş kapsam, silinmiş
olması gerekip kalmış kod, sözleşmede yazılıp kodda karşılığı olmayan iddia,
kodda olup sözleşmede geçmeyen davranış, ölü kod, sızıntı.

Bilinen bazı gerilim noktaları (bunları okuman iyi olur ama listenin **kapsayıcı
olduğunu varsayma** — denetlenen tarafın hazırladığı zayıflık listesi bilmediği
zayıflığı içermez):

* Paketin bir kısmı **alt ajanlara dağıtıldı** (10 test dosyası + 3 ekran).
  Dağıtılan işin kalitesi ana omurgayla aynı seviyede mi?
* `api/delivery.ts` ve `hooks/useDelivery.ts`'e üç ajan **paralel ekleme**
  yaptı; `fetchVehicles` ile `fetchBoardVehicles` aynı uca gidiyor olabilir —
  tekilleştirilmemiş kopya var mı?
* Sözleşmede olmayan bir uç eklendi (`/delivery/pickup-points`) ve bu "sözleşme
  eki" diye işaretlendi. Meşru mu?
* `DeliveryVehiclesPage`'de araç `<select>`'i `canManage` kapısının DIŞINA
  alındı (gerekçe: test kullanıcısında izin yok). Bu, testi geçirmek için
  yetki yüzeyini gevşetmek mi?
* Migration'ın ürettiği "Merkez (geçici)" BASE noktası ve `fixed_cost=1800`
  sayısı nereden geliyor, savunulabilir mi?
* `tests/verify` hiç koşulmadı (§6 tablosunda "merge turuna bırakıldı").

---

## 4. Raporun biçimi

Dosyaya yazma; sonucu **oturuma** ver. Şu sırayla:

1. **Karar cümlesi** — merge'i durduran bir bulgu var mı, yok mu.
2. **Bulgular**, ağırlık sırasıyla. Her biri: ne, nerede (`dosya:satır`), nasıl
   ölçüldü, neden önemli, önerilen sınıf (P0 / P1 / P2).
3. **Ölçüm tablosu** — M-1'in taban↔dal karşılaştırması, tam komutlarla.
4. **Ölçemediklerin** — zaman, ortam ya da yetki nedeniyle bakamadığın her şey.
   Bu bölümün boş kalması beklenmiyor; boş bırakırsan denetimin kapsamı
   okunamaz hâle gelir.
5. **İddia ↔ kanıt tablosu** — sözleşmenin ana iddiaları için: doğrulandı ·
   çürütüldü · ölçülmedi.

Uzunluk sınırı yok, ama her cümlenin arkasında ya bir çıktı ya bir dosya
referansı olsun.
