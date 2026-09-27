# İP-19 — Dağıtım Operasyon Modeli (filo · gün tahtası · raporlama)

Tarih: 2026-08-15 · Dal: `ip19-dagitim-operasyon` · Taban: `8fc8951` (main)

Bu paket, "Cıncık Teslimat"ın **kaynak modelini** düzeltir: aracı bir enum
olmaktan çıkarıp veriye çevirir, dağıtım planlamasını araç sayısından bağımsız
hâle getirir, VROOM'un zaten sunduğu vardiya/maliyet kısıtlarını açar, sevk
sihirbazını bir gün tahtasına dönüştürür ve operasyonu ölçen beş metrik ekler.

**Kapsam dışıdır ve ayrı paketlerde ele alınacaktır:** bölge dışı kargo
entegrasyonu (İP-20), teslimat sözünün hukuki dili, kurye ekranının hız-baskısı
riski, P1\* yetki belgesi (§9 — borç defterine yazıldı).

---

## 0. Neden bu paket

Sahibin şikâyeti tek cümleydi: *"biraz ucuz duruyor ve esneklik yok gibi, iki
tane araç var, varsayılan olarak sabit."*

Beş bağımsız araştırma (kendi kodumuz · filo modelleme sektör pratiği · açık
kaynak ekosistem · ticari ürün özellik barı · Türkiye operasyon gerçeği) aynı
teşhise vardı ve his doğrulandı. Üç kök sebep:

### 0.1 Araç bir varlık değil, sekiz yere kopyalanmış bir etiket

| Yer | İçerik |
|---|---|
| `backend/models/delivery.py:40-44` | `class DeliveryVehicle(str, enum.Enum)` — `LADA`, `COROLLA` |
| `backend/models/delivery.py:134-136` | `delivery_runs.vehicle` `String(20)`, `server_default 'LADA'` — **FK yok, CHECK yok** |
| `backend/schemas/delivery.py:12` | `pattern="^(LADA|COROLLA)$"` |
| `backend/services/delivery_service.py:1396` | `_VEHICLE_IDS = {1: "LADA", 2: "COROLLA"}` |
| `backend/models/courier.py:22` | `couriers.vehicle_plate` — **araç niteliği sürücü kaydında** |
| `frontend/src/types/index.ts:1849` | `type DeliveryVehicle = "LADA" \| "COROLLA"` |
| `frontend/src/lib/deliveryRun.ts:69-72` | `VEHICLE_LABEL` sözlüğü |
| `frontend/src/pages/admin/delivery/DeliveryTodayPage.tsx:252-253` | iki `<option>` **elle yazılmış** |

Enum'un kendisi **hiçbir yerde kullanılmıyor** — kolon serbest string, doğrulama
regex, servis ayrı sözlük. Yani tek doğruluk kaynağı yok; enum ölü bir
dokümantasyon ve yanlış güven veriyor. Üçüncü araç eklemek 6 üretim + ~10 test
dosyasına dokunmak demek.

### 0.2 🔴 Sessiz tuzak — üçüncü aracı eklemek BUGÜN güvenli değil

İki satır birbirinden habersiz:

```python
# delivery_service.py:1427  — günlük tavan, araç SAYISINI okuyor
max_total = max(len(_VEHICLE_IDS), 1) * settings.DELIVERY_MAX_STOPS_PER_RUN

# delivery_service.py:1438-1442  — plana giren araçlar, SABİT iki değer
vehicle_ids = [1] if len(candidates) <= SINGLE_VEHICLE_MAX_STOPS else [1, 2]
```

`_VEHICLE_IDS`'e üçüncü satır eklenirse tavan sessizce `3 × 40 = 120`'ye çıkar,
ama plan hâlâ en fazla iki araç döndürür. Sonuç: **120 siparişe söz verilir,
2 araca yüklenir**, `max_tasks = ceil(120/2) = 60` olur ve
`DELIVERY_MAX_STOPS_PER_RUN=40` tavanı araç başına aşılır (o tavan yalnız
toplamda uygulanıyor).

**Bunu yakalayan hiçbir test yoktur.** `test_delivery_dispatch_live_pg.py:343`
`{r.vehicle for r in runs} == {"LADA", "COROLLA"}` küme eşitliğine çivili —
üçüncü araç plana girmezse test **yeşil kalır ve gerçeği gizler**.

Bu, paketin düzelttiği tek **gerçek üretim kusurudur**; geri kalanı yapısal borç.

### 0.3 Motorun %85'i kullanılmıyor

`build_vroom_payload` (`core/routing/vroom.py:59-86`) bugün tam olarak şunu
gönderiyor: araçta `id` · `profile` · `start` · `max_tasks`; işte `id` ·
`location` · sabit `service`.

VROOM v1.14'ün (bizim imajımız — `docker-compose.yml:103`) desteklediği ve
**kullanılmayan** kısıtlar, bize değeri sırasıyla:

| Yetenek | Değer |
|---|---|
| `vehicle.time_window` | Kurye 17:00'de bitiyorsa plan bunu **bilmiyor** |
| `vehicle.costs.fixed` | "12 durak" sihirli sayısını *"ikinci aracı çıkarmanın maliyeti X TL"* ekonomisine çevirir |
| `job.time_windows[]` | Müşteriye "14-16 arası" sözü vermenin ön koşulu |
| `job.setup` | Aynı apartmandaki 3 sipariş bugün 3×180 sn sayılıyor |
| `job.priority` | Gecikmiş/söz verilmiş sipariş önce |
| `vehicle.breaks[]` | Öğle arası ETA'lara yansımıyor |

Bu paket ilk ikisini açar; kalanı §8'de sıralanmıştır.

### 0.4 Panel bir sihirbaz, gün tahtası değil

İncelenen 13 ticari üründe (Onfleet · Routific · OptimoRoute · Track-POD ·
Detrack · Shipday · Bringg …) **istisnasız** iki şey ortak: araç/sürücü birinci
sınıf CRUD'lu bir varlıktır, ve plan **bir güne** aittir — atanmamış işler
havuzu + kaynak satırları + sürükle-bırak. Bizde tek yönlü "tur kur → durak ekle
→ başlat" sihirbazı var.

Panelin kendisi bunu dürüstçe yazıyor (`DeliveryCouriersPage.tsx:19-20`):
*"Salt-okunur yapılandırma — sahte düzenleme butonu YOK: bu değerler .env'de
yaşar ve deploy ile değişir."*

### 0.5 Bu his zaten repoda kayıtlı

`docs/arsiv/teslimat/teslimat-profesyonellestirme-gorev.md:70` — **cevaplanmamış** açık soru:

> *"KULLANICIYA SOR: LADA/COROLLA çalışma saatleri, kurye vardiyaları, zorunlu
> mola, depo tamponu ve apartman servis süresi başlangıç değerleri nedir?"*

`docs/arsiv/teslimat/teslimat-faz0-denetim-matrisi.md:27` (P0 boşluk): *"Kapasite tek global
sayı; **araç/kurye/vardiya/retry-borcu kavramı** yok."*

Ve `docs/delivery-screens-wireframes.md` koddan ileride: araç bazlı yük görünümü
(satır 1011-1016), kurye kartında araç seçici (1213), tur "Devret" butonu (1093)
— üçü de çizilmiş, hiçbiri yazılmamış.

---

## 1. Bağlayıcı tasarım kararları

### K-1 · Araç bir tablodur, enum değildir

`vehicles` tablosu açılır ve **`vehicles.id` doğrudan VROOM vehicle id'si olur.**
Bu, `_VEHICLE_IDS` sözlüğünü ve int↔string köprüsünü tamamen ortadan kaldırır.

### K-2 · Vardiya alanları NULLABLE — "kim taşıyor" kararı ertelenebilir olmalı

Proje sahibinin sorusu doğrudan bu kararı doğurdu: *"kurucu ben taşıyacağım
deyip sonra kuryeye ihtiyaç duyarsam ne yapacağım?"*

Cevap: **hiçbir şey.** Model bu soruyu sormaz. `shift_start`/`shift_end` `NULL`
ise VROOM'a zaman penceresi **gönderilmez** ve plan bugünkü davranışını birebir
korur. Kurye tutulduğu gün alanlar doldurulur, kod değişmez, deploy olmaz.
`delivery_runs.courier_id` zaten nullable'dır (`SET NULL`) — kuryesiz tur bugün
de mümkündür.

**Bu, paketin merkezî felsefesidir:** operasyonel varsayımlar koda değil veriye
yazılır. "İki araç" hatasının kökeni de tam olarak bu ilkenin ihlaliydi.

### K-3 · Araç sayısı kararı eşikten ekonomiye taşınır

`DELIVERY_SINGLE_VEHICLE_MAX_STOPS = 12` sabiti **kaldırılır**. Yerine:
aktif araçların **tamamı** VROOM'a gönderilir, yedek araçlara `costs.fixed`
verilir, VROOM ikinci aracı **yalnız kazanç sabit maliyeti aşarsa** kullanır.
Boş kalan araç `routes`'ta görünmez (mevcut davranış).

Haversine fallback'in maliyet modeli yoktur; orada araç sayısı
`ceil(len(points) / en_küçük_max_stops)` ile türetilir — yani eşik yine vardır
ama **araç verisinden** gelir, sabitten değil.

**Yeşil fazda ölçülen düzeltme (K-3a):** denge tavanı `ceil(n/k)` SERT bir
kısıttır ve `costs.fixed` ekonomisiyle birlikte ifade edilemez — ikisi birden
yazılırsa VROOM 3 siparişi bile bölmek zorunda kalır (tek araç tavanı aşamaz)
ve "ikinci araç ancak kazanç sabit maliyeti aşarsa çıkar" kuralı hiç çalışmaz:
kurucu tek başınayken her gün iki tura bölünürdü. Karar: **filoda `fixed_cost
> 0` bir araç varsa denge tavanı payload'a yazılmaz**; dengeyi ekonomi +
`max_stops` yönetir. Maliyetsiz (homojen) filoda ölçülmüş denge davranışı
birebir korunur. Nöbetçi: `test_D6b_maliyetli_filoda_denge_tavani_YAZILMAZ`
(matris SONRASI eklendi — §5'e ek). Migration seed'i COROLLA'ya
`fixed_cost=1800` verir: eski "COROLLA yalnız yoğun günlerde" kuralının
ekonomik karşılığı (≈ ikinci aracı çıkarmak yarım saatlik sürüşe bedel);
eşik artık kodda bir sabit değil, admin panelinden araç başına ayarlanabilir
bir sayıdır.

### K-4 · Kapasite tek boyutludur ve NULLABLE'dır

Sektör pratiği çok boyutlu kapasiteyi (ağırlık + hacim + palet) destekler, ama
1-5 araçlık bir kitap operasyonunda **bağlayıcı kısıt yüktür değil zamandır**.
Bir Lada'nın bagajına sığmayacak kadar kitap, günlük sipariş adedinin çok
üstündedir. `max_stops int NULL` (NULL = kısıtsız) yeterlidir; `max_tasks`
tercihi (`vroom.py:31-56`'daki ölçülmüş gerekçe) korunur.

### K-5 · Araç niteliği araçta yaşar

`couriers.vehicle_plate` **kaldırılır**, veri `vehicles.plate`'e taşınır. Bugünkü
hâl bir anti-pattern'dir: kurye araç değiştirdiğinde geçmiş yalan söyler. Müşteri
takip sayfasındaki plaka (`delivery_service.py:1689`) turun **aracından** okunur.

### K-6 · Ekosistemden kod alınmaz, desen alınır

Tek ciddi açık kaynak aday **Fleetbase FleetOps** ve lisansı **AGPL-3.0** —
kapalı kaynak ticari bir platformda kod olarak kullanılamaz. Şema/desen okumak
serbesttir; `manifests`/`manifest_stops` yapısı ve motor-kayıt deseni bu
sözleşmeyi biçimlendirmiştir, ama **tek satır kod taşınmayacaktır**.

Ayrıca: Python'da üretim düzeyi bir son-kilometre platformu **yoktur** (yapılan
taramada en yüksek 3 yıldız, hepsi portfolyo projesi). Kendimiz yazmak eksiklik
değil, tek seçenektir. Buna karşılık **optimizasyon katmanı asla kendimiz
yazılmaz** — VROOM/OSRM kalır (§K-7).

### K-7 · VROOM kalır

`vroom-express`'in bakım modunda olduğu (son 12 ayda 2 commit) ve PyVRP'nin
(MIT, Python, canlı) konteyneri tamamen kaldırabileceği ölçüldü. **Bu pakette
motor değiştirilmez** — çalışan bir kurulumu değiştirmek, kullanılmayan
yeteneklerini açmaktan daha riskli ve daha pahalıdır. PyVRP değerlendirmesi
ayrı bir ölçümlü spike'a bırakılır (§8).

### K-8 · Gün+araç başına tek planlı tur kısıtı KORUNUR

`uq_delivery_run_planned` index'i `vehicle` string'inden `vehicle_id`'ye taşınır,
semantiği değişmez. Aynı araçla gün içinde ikinci dalga (multi-trip) bu paketin
kapsamı **değildir** — ticari ürünlerde orta/üst segment özelliğidir ve bizde
henüz talep eden bir hacim yoktur.

### K-9 · Depo yoktur — başlangıç noktası ve toplama noktaları VERİDİR

Proje sahibinin teyidi (15 Ağu 2026): **platformun deposu yoktur**; kitaplar
birden fazla toptancıdan alınır ve `core/config.py:218-219`'daki koordinat
(`36.9855 / 35.3253`, yorumu *"Seyhan Çakmak Cad. civarı"*) **gerçek bir yer
değildir** — yalnızca şehir merkezi yer tutucusudur.

`pickup_points` tablosu açılır: konsolidasyon noktası (turun başladığı yer) ve
toptancılar veri olarak girer. Araç `start`'ı bu noktalardan birine bağlanır
(`RouteVehicle.start`), yani VROOM'a araç başına farklı başlangıç verilebilir —
VROOM bunu zaten destekliyor, biz tüm araçlara aynı sabiti yazıyorduk
(`vroom.py:74`).

### K-10 · 🔴 `DELIVERY_DEPOT_LAT/LNG` İKİ ALAKASIZ İŞ yapıyor — ayrılır

Ölçüldü: `services/delivery_promise.py::in_delivery_zone` (satır 137-156)
müşterinin pin'i varsa **yarıçapı OTORİTE** sayar (ilçe listesi yalnız pin
yoksa fallback), ve yarıçap **depo koordinatından** ölçülür. Yani aynı değişken
hem (a) rotanın başlangıç noktası hem (b) teslimat bölgesinin merkezidir.

Bugün tesadüfen zarar vermiyor — 25 km, Adana merkezinden dört ilçeyi kapsıyor,
yani ilçe listesiyle kabaca örtüşüyor. **Ama başlangıç noktası gerçek bir yere
taşındığı an teslimat bölgesi de kayar** ve bunu hiçbir test yakalamaz.

**Karar:** `DELIVERY_ZONE_RADIUS_KM` ve yarıçap yolu **tamamen kaldırılır**;
bölge kararının tek otoritesi **ilçe listesidir** (`DELIVERY_ZONE_DISTRICTS` =
Seyhan · Yüreğir · Çukurova · Sarıçam — "Adana kent merkezi"). İlçe bilgisi
yoksa sonuç **bölge dışıdır** (güvenli taraf: dış kargo kuyruğuna düşer, yanlış
söz verilmez).

Gerekçe proje sahibinin ifadesidir: *"Adana kent merkezinde dağıtım yapacağız,
kent merkezi içinde değilse kargo firmasına veririz."* İlçe listesi bu cümlenin
birebir karşılığıdır, yarıçap ise onun yaklaşık bir vekilidir — vekili atıp
aslını tutmak hem dürüst hem açıklanabilir: müşteriye "şu ilçelere kendi
aracımızla" denir.

### K-11 · Tur TEK FAZLIDIR — toplama planlanmaz, doğaçlamaya bırakılır

Akış hibrittir (çoğu sipariş konsolide edilir, bazısı yol üstünde bırakılabilir)
ama **planlama tek fazlı kalır**: rota, başlangıç noktasından müşterilere kurulur.
Toplama bacağı (toptancı gezme) rotaya **sokulmaz**.

Gerekçe — dördü birden:

1. **ETA güvenilirliği.** Toptancıda beklenen süre sınırsızdır (kuyruk, stok
   arama). Toplama bacağına müşteri durağı serpiştirmek, müşteriye verilen varış
   penceresini toptancının kuyruğuna bağlar. Kazanılan kilometre, bozulan sözden
   ucuz değildir.
2. **Ölçek.** Günde 5-20 siparişte kazanç küçüktür; kitap toptancıları da
   coğrafi olarak kümelenir.
3. **Karmaşıklık.** Planlamak = pickup-delivery problemi + öncelik kısıtı +
   "paket henüz araçta değil" durumu + kurye ekranında toplama adımı + değişen
   teslim kanıtı zinciri. Paketi ikiye katlar.
4. **Ertelemek bedavadır.** Toptancılar `pickup_points`'te veri olduğu için
   ileride VROOM `shipments`'a geçmek payload kurucusunda tek daldır.

**Kritik ölçüm — doğaçlama zaten mümkündür ve engellenmeyecektir:**
`delivery_service.py::scan` (satır 2353) durağı **QR token'ından** bulur, sıra
kontrolü yapmaz; kodun kendi yorumu (`:1191`) *"`sequence` rota sırasıdır, kilit
sırası değildir"* der. Yani kurye ekranı sıra **önerir, dayatmaz** — toptancıya
giderken yol üstündeki paket okutulup teslim edilebilir. Bu davranış
**korunacaktır** ve nöbetçisi konacaktır (§5, D-15).

Esneklik algoritmaya değil **sürücüye** bırakılmıştır. Küçük operasyonda doğru
cevap budur.

---

## 2. Şema

### 2.1 Yeni tablo — `vehicles`

| Kolon | Tip | Not |
|---|---|---|
| `id` | PK int | **VROOM vehicle id'si doğrudan budur** |
| `code` | varchar(20) UNIQUE | `LADA`, `COROLLA` — migration'da geçmiş turların string'i buraya eşlenir |
| `label` | varchar(50) | Panelde görünen ad |
| `plate` | varchar(20) NULL | `couriers.vehicle_plate`'ten taşınır |
| `profile` | varchar(20) NOT NULL, default `'car'` | OSRM profili; motosiklet eklenirse `bike` |
| `max_stops` | int NULL | NULL = kısıtsız. `DELIVERY_MAX_STOPS_PER_RUN`'ın araç bazlı hâli |
| `shift_start` | time NULL | VROOM `time_window[0]`. NULL → pencere gönderilmez |
| `shift_end` | time NULL | VROOM `time_window[1]` |
| `fixed_cost` | int NOT NULL default 0 | VROOM `costs.fixed` — yedek aracı çıkarma ekonomisi |
| `sort_order` | int NOT NULL default 0 | "birincil/yedek" sırası. **`is_primary` boolean KULLANILMAZ** — üçüncü araçta anlamsızlaşır |
| `is_active` | bool NOT NULL default true | |
| + `TimestampMixin`, `SoftDeleteMixin` | | Proje geneli desen |

`models/__init__.py`'ye import + `__all__` kaydı zorunludur.

### 2.2 Yeni tablo — `pickup_points`

Depo olmadığı için (K-9) başlangıç ve toplama noktaları veriye taşınır.

| Kolon | Tip | Not |
|---|---|---|
| `id` | PK int | |
| `name` | varchar(80) | "Konsolidasyon", "Toptancı X" |
| `kind` | varchar(20) | `BASE` (turun başladığı yer) \| `SUPPLIER` (toptancı) |
| `address` | text NULL | |
| `lat` / `lng` | double | |
| `is_active` | bool NOT NULL default true | |
| `sort_order` | int NOT NULL default 0 | |
| + `TimestampMixin`, `SoftDeleteMixin` | | |

`vehicles.start_point_id` → `pickup_points.id` NULL (NULL = tek `BASE` noktası).
`SUPPLIER` kayıtları bu pakette **rotaya girmez** (K-11); ileride `shipments`
akışı açıldığında hazır bekler.

`DELIVERY_DEPOT_LAT/LNG` ayarları **kaldırılır**.

### 2.3 Değişen tablolar

```
delivery_runs
  + vehicle_id  FK -> vehicles.id  NOT NULL   (RESTRICT — araç silinirse geçmiş tur bozulmasın)
  - vehicle     String(20)                     KALDIRILIR
  ~ uq_delivery_run_planned: (run_date, vehicle) -> (run_date, vehicle_id)

couriers
  - vehicle_plate                              KALDIRILIR (veri vehicles.plate'e taşınır)
```

### 2.4 Migration

Tek revizyon, üç adım — **veri kaybı yok**:

1. `vehicles` tablosunu kur; `INSERT (code,label,sort_order) VALUES ('LADA','Lada',0),('COROLLA','Corolla',1)`
2. `delivery_runs.vehicle_id` ekle (önce nullable) →
   `UPDATE delivery_runs r SET vehicle_id = v.id FROM vehicles v WHERE v.code = r.vehicle` →
   `NOT NULL`'a çevir → index'i yeniden kur → `vehicle` kolonunu düşür
3. `couriers.vehicle_plate` verisini `vehicles.plate`'e taşı (tek plaka varsa),
   sonra kolonu düşür

`downgrade` şemayı geri kurar ama **veriyi geri getirmez** — revizyon
docstring'inde açıkça yazılır ve bu iddia gerçek PostgreSQL'de **dolu tabloda**
ölçülür (§5, D-9). Baseline'a dokunulmaz; ileri yönlü revizyon yazılır.

---

## 3. Servis ve routing değişiklikleri

### 3.1 `RoutingProvider` imzası araç nesnesi alır

`core/routing/base.py`'ye yeni saf veri sınıfı:

```python
@dataclass(frozen=True)
class RouteVehicle:
    id: int
    profile: str = "car"
    max_stops: int | None = None          # araç bazlı tavan
    shift_start_sec: int | None = None    # gün başından saniye; None -> pencere yok
    shift_end_sec: int | None = None
    fixed_cost: int = 0
```

`plan_fleet(*, depot_lat, depot_lng, points, vehicles: list[RouteVehicle])` —
`vehicle_ids: list[int]` parametresi **kaldırılır**. Bu tek değişiklik dört
kısıtı birden açar: homojen kapasite, sabit profil, vardiya yokluğu ve
maliyet körlüğü.

`FleetPlan.routes` anahtarı `vehicles.id` olmaya devam eder.

### 3.2 `build_vroom_payload`

Araç sözlüğüne koşullu alanlar eklenir:

- `max_tasks` = `min(ceil(n/k), vehicle.max_stops)` — ikisi de varsa küçüğü;
  yalnız biri varsa o; hiçbiri yoksa alan yazılmaz
- `time_window` = `[shift_start_sec, shift_end_sec]` — **yalnız ikisi de doluysa**
- `costs` = `{"fixed": n}` — **yalnız `fixed_cost > 0` ise**
- `profile` araçtan okunur (bugün sabit `"car"`)

Bugünkü payload, tüm araçlar varsayılan değerlerdeyken **birebir korunur** —
geriye uyumluluk nöbetçisiyle sabitlenir (§5, D-4).

### 3.3 `dispatch_day`

```
aktif_araclar = DB'den (is_active, deleted_at IS NULL, sort_order)
max_total     = Σ (arac.max_stops ?? DELIVERY_MAX_STOPS_PER_RUN)
plan_fleet(..., vehicles=aktif_araclar)
```

`_VEHICLE_IDS` sözlüğü ve `[1] / [1,2]` ternary'si **silinir**;
`DELIVERY_SINGLE_VEHICLE_MAX_STOPS` ayarı **kaldırılır** (K-3).

§0.2'deki sessiz tuzak bu değişiklikle yapısal olarak imkânsız hâle gelir:
tavan ile plana giren araç kümesi **aynı listeden** türer.

### 3.4 Yeni uçlar

| Uç | Yetki | İşlev |
|---|---|---|
| `GET /delivery/vehicles` | `delivery.view` | Liste (panel + gün tahtası) |
| `POST /delivery/vehicles` | `delivery.manage` | Ekle |
| `PATCH /delivery/vehicles/{id}` | `delivery.manage` | Düzenle / pasifleştir |
| `DELETE /delivery/vehicles/{id}` | `delivery.manage` | Soft-delete; **aktif turu olan araç silinemez → 409** |
| `PATCH /delivery/runs/{id}` | `delivery.manage` | `vehicle_id` alanı eklenir (bugün yalnız `courier_id` taşıyor) |
| `GET/POST /delivery/pickup-points` | view/manage | **Sözleşme eki (K-9'un doğal sonucu):** başlangıç/toplama noktaları veridir; uç olmadan seed'li BASE satırı deploy'suz düzenlenemezdi — "uydurma koordinat config'ten tabloya taşınmış ama yine kilitli" olurdu |
| `GET /delivery/board?date=` | `delivery.view` | Gün tahtası verisi: atanmamış havuz + araç bazlı turlar |
| `GET /delivery/metrics?from=&to=` | `delivery.view` | Beş metrik (§4.2) |

Yazma uçları `user_rate_limit` ile kapılanır (mevcut desen,
`api/deps.py:236-252`). Admin aksiyonları `audit_logs`'a yazılır.

---

## 4. Frontend

### 4.1 Araç yönetimi + türetilmiş etiketler

`frontend/src/lib/deliveryRun.ts:69-72`'deki `VEHICLE_LABEL` sözlüğü,
`types/index.ts:1849`'daki union ve `DeliveryTodayPage.tsx:252-253`'teki elle
yazılmış `<option>`'lar **kaldırılır**; hepsi `GET /delivery/vehicles`'tan
türetilir. `DeliveryTodayPage.tsx:317-319`'daki `dispatchable > 12` sabiti ve
"Lada ve Corolla" metni de kaldırılır (backend eşiği artık yok).

Araç CRUD ekranı `CourierManager.tsx` desenini izler (aynı sekme grubu).

### 4.2 Gün tahtası

`/yonetim/dagitim` "Bugün" sekmesi sihirbazdan tahtaya çevrilir:

- **Sol**: atanmamış uygun siparişler havuzu (bugünkü `eligible-orders`)
- **Sağ**: araç başına satır — turdaki duraklar, sırasıyla
- **Sürükle-bırak**: havuzdan araca. *(Bağımsız denetim B-11 düzeltmesi: bu
  satır önce "havuzdan araca, araçtan araca, araç içinde sıra değiştirme"
  diyordu; yazılan yalnız birincisidir. Kalan ikisi **[[TB-52]]** — yarım bir
  taşıma yüzeyi hiç olmayanından kötüdür, çünkü atomik değildir.)*
- **Kapasite uyarısı**: araç `max_stops`'u aşınca satır işaretlenir; ihlal
  **engellenmez, görünür kılınır** (elle karar sahibinindir)
- "Günü Optimize Et" ve elle sıralama korunur

Sürükle-bırak için **yeni bağımsızlık eklenmez**; HTML5 drag-and-drop yeterlidir.

### 4.3 Raporlama — beş metrik

`GET /delivery/metrics` ve "Performans" sekmesi:

1. **Zamanında teslim oranı** — `promised_delivery_date`'e göre
2. **İlk denemede başarı oranı** — `order.failed_delivery_count == 0` olan
   teslim edilmiş siparişler. *(Denetim B-14 düzeltmesi: metin "sipariş başına
   durak sayısı 1 olanlar" diyordu; kod başka bir şey ölçüyor ve DOĞRUSU odur —
   müşteri ertelemesi (`RESCHEDULED`) sayacı artırmaz, yani kurye, müşterinin
   ertelemesi yüzünden cezalandırılmaz.)*
3. **Durak/saat** — tur süresi başına sonuçlanan durak
4. **Başarısızlık nedenleri dağılımı** — mevcut `FailReason` enum'u üzerinden
5. **km/teslimat** — teslim edilen durak başına, **yalnız sahaya çıkmış**
   turların `total_distance_km` toplamı (denetim B-6: optimize edilip hiç
   başlamamış ya da iptal edilmiş turun kilometresi paydaya girmez)

Hepsi mevcut alanlardan türer; **yeni ölçüm alanı eklenmez.**

---

## 5. Yokluk ve davranış matrisi (üretim kodundan ÖNCE yazılır)

Kök `CLAUDE.md` §E gereği matris ayrı bir commit'te, üretim kodundan önce
yazılacak ve **kırmızı çıktısı commit mesajına** yazılacaktır.

| Kod | Ne ölçer | Sınıf |
|---|---|---|
| **D-1** | `DeliveryVehicle` enum'u, `_VEHICLE_IDS` ve `SINGLE_VEHICLE_MAX_STOPS` **yok** (import/attr hatası) | gerçek import |
| **D-2** | `GET/POST/PATCH/DELETE /delivery/vehicles` gerçek HTTP'de çalışır; yetkisiz **403**, yabancı id **404** | gerçek HTTP |
| **D-3** | Üçüncü araç **INSERT ile** eklenince `dispatch_day` onu plana **alır** ve `max_total` **aynı listeden** türer | gerçek PostgreSQL |
| **D-4** | Tüm araçlar varsayılan değerlerdeyken `build_vroom_payload` çıktısı **bugünküyle birebir aynı** | saf birim |
| **D-5** | `shift_start`/`shift_end` doluysa payload'da `time_window` **var**; biri NULL ise **yok** | saf birim |
| **D-6** | `fixed_cost > 0` ise `costs.fixed` **var**; 0 ise alan **yok** | saf birim |
| **D-7** | `max_tasks` = `min(ceil(n/k), max_stops)`; yalnız biri varsa o; hiçbiri yoksa alan yok | saf birim |
| **D-8** | Aktif turu olan araç silinmeye çalışılınca **409**, tur bozulmaz | gerçek PostgreSQL |
| **D-9** | Migration: taze DB'de `upgrade` → **veri yaz** → `downgrade` → şema geri gelir, **veri gelmez** → `upgrade` → `alembic check` temiz | gerçek PostgreSQL |
| **D-10** | `uq_delivery_run_planned` `vehicle_id` üzerinde çalışır: aynı gün+araç ikinci PLANNED tur **reddedilir** | gerçek PostgreSQL |
| **D-11** | Gün tahtası: havuzdan araca sürükleme gerçekten `POST /runs/{id}/stops` isteğine dönüşür | gerçek DOM |
| **D-12** | `max_stops` aşılınca uyarı **DOM'da görünür**, ama işlem **engellenmez** | gerçek DOM |
| **D-13** | Panelde araç `<option>`'ları **sunucudan** gelir — sabit iki seçenek yok | gerçek DOM |
| **D-14** | Beş metrik uçtan doğru hesaplanır (bilinen fixture üzerinde elle doğrulanmış değerler) | gerçek PostgreSQL |

### 5.1 Doluluk nöbetçileri (yalancı yeşile karşı)

Yokluk iddiaları boş kümede kendiliğinden sağlanır. Her ölçümün yanına:

| Nöbetçi | Neyi imkânsız kılar |
|---|---|
| D-1: `Vehicle` modeli **import edilebilir** | Modül tamamen silinse "enum yok" iddiası da geçerdi |
| D-3: iki araçlı gün **hâlâ iki tur** üretir | "Üçüncü araç plana girdi" iddiası, plan tamamen bozuksa da geçebilirdi |
| D-4: payload'da `jobs` **dolu** | Boş payload karşılaştırması iki tarafta da eşit çıkardı |
| D-9: `srs_*` benzeri komşu tablolar **etkilenmedi** | Migration her şeyi düşürse "flashcard yok" gibi boş DB'de de sağlanırdı |
| D-13: en az bir araç `<option>`'u **var** | İstek hiç atılmasa da "sabit iki seçenek yok" geçerdi |

---

## 6. Doğrulama kapıları

Taban `main = 8fc8951` üzerinde ölçülecek; tek kullanımlık `adana_ip19_test`
veritabanı, Redis `db11`, `PAYMENT_PROVIDER=fake` ([[TB-21]]).

| Kapı | Taban | ÖLÇÜLEN (15 Ağu 2026) |
|---|---|---|
| `pytest tests/integration` | 1332 · 16 skip | **1340 eşdeğeri · 16 skip** (solo koşum 1339 + son düzeltme; +8 = İP-19 7 + D-9) |
| `pytest` (integration/verify hariç) | 962 | **988 passed** (acceptance dahil) |
| frontend `vitest run` | 902 · 86 dosya | **912 passed · 88 dosya** (+ip19Filo 6, +opsMetrics 4) |
| `eslint src` | 0 hata · 32 uyarı | **0 hata · 32 uyarı** (turda doğan 3 uyarı aynı turda temizlendi) |
| `tsc -b` · `ruff check backend/` | temiz | **temiz** |
| Mutasyon provası | — | **5/5 yakalandı** (D-7 min→max · D-5 AND→OR · D-16 il kontrolü · D-8 açık-tur kontrolü · D-3 sabit çarpan); her prova sonrası md5 ile geri-yükleme doğrulandı |
| Gerçek tarayıcı turu | — | **14 adım · 0 kırık** (aşağıda §6.2) |
| `pytest tests/verify` (132) | — | merge turuna bırakıldı (`adana_verify` paylaşımlı DB ister) |

### 6.2 Gerçek tarayıcı kabulü — Chrome + CDP, İZOLE yığın

Betik: `frontend/scripts/ip19_browser_acceptance.mjs` (F30 boru hattının
deseni; Playwright yok). Yığın bilinçli olarak İZOLE kuruldu — backend :8019
(`adana_ip19_test` + Redis db11), vite :5177 — çünkü canlı geliştirme yığını
eski koddan koşuyor ve **`ceyhandb`'ye İP-19 migration'ı uygulanamaz**
([[TB-35]] dersi: feature dalı migration'ı dev DB'ye uygulanmaz).

14 adım, 0 kırık. En güçlü kanıt: **KANGOO gerçek 'Yeni araç' formundan
eklendi ve tur kurma formunun seçeneklerinde belirdi** — "araç bir INSERT'tir"
tezi uçtan uca gerçek tarayıcıda ölçüldü. Ayrıca: gerçek form girişi (token
enjekte edilmedi) · seed araçlar listede · "Lada ve Corolla" sabit metni yok ·
gün tahtası yüklendi · beş metrik görünür ve veri yokken "—" (null ≠ %0).
Ekran görüntüleri `frontend/ip19-kabul/` (commit'e girmez).

Yol boyunca ölçülen iki Chrome/CDP tuzağı (betiğe yorum olarak işlendi):
(1) `--user-data-dir` GÖRELİ yolu çözemiyor — "veri dizinine yazamıyor"
penceresi açıp debug portunu hiç açmadan bekliyor; (2) kilitli profil —
takılan önceki koşumun Chrome'u profili tutarken yeni koşum aynı hatayı
veriyor. Sürükle-bırak gerçek tarayıcıda ELLE sınanmadı (jsdom kabulü D-11
POST gövdesini ölçüyor; CDP ile programatik drag güvenilir değil) — bu sınır
kabul edilmiştir.

Ayrıca **mutasyon provası** (§CLAUDE.md D): D-3, D-7, D-8 ve D-10 için en az
birer ters prova; sürücü `backend/scripts/mutation_drill.py`.

### 6.1 Testlerin "2"den kurtarılması

Aşağıdaki sabitler araç sayısından türetilmiş hâle getirilecektir — bugün
üçüncü araç eklense **sessizce yeşil kalan** yerler bunlardır:

- `test_delivery_dispatch_live_pg.py:343` — `{"LADA","COROLLA"}` küme eşitliği
- `test_delivery_dispatch_live_pg.py:347` — `ceil(n/2)`
- `test_delivery_dispatch_live_pg.py:365` — `2 * DELIVERY_MAX_STOPS_PER_RUN`
- ~11 fabrika/test dosyasındaki literal `vehicle="LADA"`

Referans desen: `test_routing_hardening.py:25-37` — orada `k` zaten `1..N`
döngüsüyle sınanıyor.

---

## 7. Kapsam dışı — bilinçli

| Kalem | Gerekçe |
|---|---|
| Çok boyutlu kapasite (ağırlık + hacim + palet) | Kitapta bağlayıcı kısıt zaman; üç sayı da bakımı zorunlu ölü veri olur |
| `skills` / beceri eşleştirme | Her araba her kitabı taşır |
| Toplama bacağının planlanması (VROOM `shipments`) | K-11 — tur tek fazlı kalır; toptancılar `pickup_points`'te veri olarak durur, doğaçlama zaten mümkün |
| Çoklu tur (aynı araç, ikinci dalga) | Orta/üst segment özelliği; talep eden hacim yok (K-8) |
| Sürücü müsaitlik takvimi (izin/rapor) | 1-2 kişide takvim yeter |
| Telematik / yakıt / bakım / km takibi | Varlık yönetimi; 2 araçta ajanda işi |
| Gerçek zamanlı auto-dispatch | Sipariş akışı batch (gün başında ödenmiş siparişler) |
| 3. parti kurye marketplace | Kendi aracımız var, kıyaslanacak taşıyıcı yok |
| Sürücü ücret/prim hesaplama | 2 sürücüde Excel daha hızlı |
| Turu başka kuryeye devretme | Wireframe'de çizili (D1 ❌); ayrı karar ister |
| Motor değişimi (PyVRP) | K-7 — ayrı ölçümlü spike |
| Bölge dışı kargo entegrasyonu | **İP-20** |

---

## 8. Sonraki adımlar (bu paketten sonra)

Öncelik sırasıyla, her biri bağımsız:

1. **İP-20 — Basit Kargo entegrasyonu.** Bölge dışı kuyruğu bugün ölü; elle
   takip-no akışı bile yok. REST/JSON + Bearer, `ECONOMIC`/`FAST` ile firma
   seçimi kod dışında, `SELF_` önekiyle büyüme yolu. **Ön koşul:** Basit
   Kargo'ya sandbox/test ortamı olup olmadığı sorulmalı (dokümante edilmemiş).
2. **`job.setup` ayrımı** — aynı apartmandaki N sipariş bugün N×180 sn sayılıyor.
3. **`job.time_windows[]`** — müşteriye saat aralığı sözü vermenin ön koşulu.
4. **`vehicle.breaks[]`** — öğle arası ETA'lara yansısın.
5. **PyVRP spike** — VROOM konteynerini ve bakım modundaki `vroom-express`'i
   kaldırma değerlendirmesi; ölçümlü, atılabilir.

---

## 9. Kapsam dışı bulgular — borç defterine yazıldı

Araştırma turunda çıkan ve **bu paketin konusu olmayan** üç bulgu. Numaralar
merge turunda tahsis edildi (defterin dört maddelik kuralı): sırasıyla
**[[TB-48]]** (teslimat sözünün hukuki dili), **[[TB-49]]** (kurye ekranı hız
baskısı / muvazaa) ve **[[TB-50]]** (yetki belgesi P1* varsayımı).

- **Teslimat sözünün hukuki dili.** Mesafeli Sözleşmeler Yönetmeliği m.16/1:
  30 gün **üst** sınır, taahhüt edilen süre **alt** sınırı belirler. m.16/2:
  tutulmazsa tüketici derhal fesheder, m.16/3: 14 gün içinde **yasal faiziyle**
  iade. Bizde `Order.promised_delivery_date` ve geri sayımlı söz rozeti var —
  yani "aynı gün" pazarlama değil, sisteme yazılmış bağlayıcı taahhüt.
- **Kurye ekranının hız-baskısı riski.** Yeni mevzuatta platformun sürücüye hız
  baskısı kurması ve makul olmayan teslimat süresi dayatması yasaklanmış
  (tam metin birincil kaynaktan **doğrulanamadı**). Ayrıca Yargıtay içtihadı,
  esnaf-kurye modelinde platformu asıl işveren sayabiliyor ve **ekranın kontrol
  sıkılığı davada delil oluyor**.
- **Yetki belgesi K2 değil muhtemelen P1\*.** Kurye/dağıtım faaliyeti ayrı belge
  sınıfında; pazaryeri modelinde ürün mülkiyeti satıcıda kalırsa "kendi malım"
  savunması çöker. ⚠️ Bulgular belge aracısı sitelerinden; resmî KTY metninden
  **teyit edilemedi** — e-Devlet U-NET veya Adana Bölge Müdürlüğü'nden yazılı
  teyit gerekir.

Ayrıca kayıt dışı bir ölçüm: **kendi filonun kırılma noktası ~40 teslimat/gün.**
SGK'lı kurye + araç ≈ 59.000 TL/ay; anlaşmalı kargo ~55-90 TL/gönderi. Ücretli
kurye tutulduğu anda, günde 40 teslimata varana kadar kendi filo kargodan
pahalıdır. Kurucu kendisi taşırsa hesap değişir (günde ~12'de başabaş). Bu bir
kod kararı değildir; paketin **kapsamını** etkilemez ama sahibinin kurye
kararını etkiler.

---

## 10. Bağımsız denetim ve düzeltme turu (15 Ağu 2026)

Paket, merge'den önce ayrı bir worktree'de (`adana-ip19-audit`, taban
`adana-ip19-taban`) bağımsız denetime gönderildi. Denetçi gerçek PostgreSQL,
gerçek HTTP, **gerçek VROOM v1.14 + gerçek OSRM Adana yol ağı** ile ölçtü.
Sonuç: merge'i durduran **3 bulgu (P1)** + 11 P2.

### 10.1 Kabul edilen ve kapatılan bulgular

| # | Bulgu | Karar |
|---|---|---|
| **B-1** | `tests/integration/test_routing_live_vroom.py` `plan_fleet`'in eski imzasıyla kalmış; dosya diff'te olmadığı ve VROOM'suz CI'da **skip** olduğu için kırıklığı görülmedi. | Onarıldı. Ders: filo davranışının tek nöbetçisi VROOM'a bağlı bir dosyada duramaz — B-2 tam da bu yüzden gizlendi. Yeni düğümler VROOM'suz koşan dosyaya kondu. |
| **B-2** | **Yük tavanı üretim varsayılanında hiç uygulanmıyor.** `_route_vehicle` rota katmanına ham `v.max_stops`'u (seed'de NULL) veriyor; `dispatch_day` ise aynı alanı `or DELIVERY_MAX_STOPS_PER_RUN` ile okuyup tavanı hesaplıyor. İki ifade ayrışıyor: tavan iki aracı sayıyor, sağlayıcı hiç kısıt görmüyor, haversine `vehicles[:1]` ile tek araç kullanıyor. Ölçüldü (gerçek VROOM): 20 sipariş → `{araç1: 20}`, 40 → `{araç1: 40}`. | **`max_stops` NULL artık "kısıt yok" değil, "platform varsayılanı"** demektir. Efektif tavan tek bir yardımcıda (`_arac_tavani`) çözülür; `gunluk_tavan`, `dispatch_day` ve `_route_vehicle` üçü de onu çağırır. İki sayı aynı *listeden* değil aynı **sayıdan** türer. |
| **B-3** | K-10 ile bölge otoritesi ilçe listesi oldu ama adres şeması/formu ilçeyi opsiyonel bıraktı; pin'li/ilçesiz adres sessizce bölge dışı oluyor ve düşeceği dış kargo kuyruğu henüz yok (İP-20). | İl ve ilçe **zorunlu** (şema + form). Üretimde henüz adres verisi olmadığı için backfill gerekmiyor; açık olan formdu. |
| **B-4** | Migration eşleşmeyen `delivery_runs.vehicle` kodunu LADA'ya düşürüyor; kolon FK'siz serbest string olduğu için tarihsel "hangi araçla koştu" bilgisi kaybolabiliyor. | Eşleşmeyen her DISTINCT kod için `vehicles` satırı açılır (büyük harfe katlanarak). |
| **B-5** | `PATCH /delivery/runs/{id}` gövdede `courier_id` gönderilmese bile `run.courier_id = None` yazıyor — aracı değiştiren ilk ekran kurye atamasını silecekti. | Yalnız **gönderilen** alanlar yazılır (`model_fields_set`). Açık `null` ile çözme davranışı korunur. |
| **B-6** | `km_per_delivery` başlamamış/iptal turların kilometresini paydaya katıyor; `planned` CANCELLED durakları sayıyor (model docstring'i "kurye performansına SAYILMAZ" diyor). | İkisi de düzeltildi. |
| **B-7** | D-14 "elle doğrulanmış değerler" iddiası gerçekte **boş** tarih aralığında yalnız anahtar varlığına bakıyordu; boşluk B-6'yı örtmüştü. | Bilinen fixture üzerinde yedi değerin tamamı elle hesaplanıp doğrulanır. |
| **B-10** | §3.4 "yazma uçları `user_rate_limit` ile kapılanır" diyor, kodda yok (30 POST → 30× 201). | Kablolandı. |
| **B-12** | Paralel ajan artığı: `GET /delivery/vehicles` için iki fetcher, iki tip, iki cache anahtarı. | Tekilleştirildi. |
| **B-13** | Üretim kodunun teste göre eğildiği iki yer. | Düzeltildi. |

### 10.2 Katılmadığımız çerçeveleme — kayda geçer

Denetim B-2'yi "K-3a kararı ölçümle çürüdü" diye çerçeveledi. **Denge** kaybı
bir hata değil, K-3'ün (senin kararın) doğrudan sonucudur: yedek araç ancak
kazanç sabit maliyeti aşarsa çıkar. Hata olan şey **fiziksel tavanın hiç
uygulanmaması** — yani "80 siparişe söz ver, 1 araca yükle". Düzeltme tavanı
geri getirir, ekonomiyi bozmaz: tavan altındaki günler hâlâ tek araçla gider
(doluluk nöbetçisi `test_B2b_*`), tavan aşılınca bölünme **zorunlu** olur.
Dengeyi daha da sıkılaştırmak isteyen operatör, panelden araç başına
`max_stops` düşürür — varsayım yine kodda değil veridedir.

### 10.3 Denetimin kapatmadığı boşluklardan öğrendiğimiz

`dispatch_day` **filo-küreseldir**: aktif araç listesini veritabanından okur.
Bu yüzden dispatch testleri filoyu sabitlemeden yazılamaz — nitekim tarayıcı
kabul turundan test DB'sinde kalan iki araç (DOBLO/KANGOO) üç mevcut testi
düşürdü. `tests/integration/dispatch_yardim.py::SeedFilosu` artık autouse
fixture olarak aktif filoyu seed'in kendisine indirger (hiçbir satır silinmez,
yalnız geçici pasifleştirilir).

### 10.4 Düzeltme turunun matrisi (üretim kodundan ÖNCE, 14 kırmızı)

| Düğüm | İddia | Kanıt sınıfı |
|---|---|---|
| Y-1 | `_arac_tavani` NULL'ı platform varsayılanına çözer | saf birim |
| Y-2 | `_route_vehicle` rota katmanına tavansız araç vermez | saf birim |
| Y-2b | `gunluk_tavan` ile `_route_vehicle` aynı yardımcıyı çağırır | **AST/kaynak (düşük güçlü, §C)** |
| Y-3 | `AddressCreate` il/ilçe ister | saf birim |
| Y-4 | `AddressUpdate` dolu alanı boşa çekemez | saf birim |
| B2-a | Seed filoda tavanı aşan gün ikinci araca taşar (haversine) | gerçek PostgreSQL |
| B2-b | *(kasıtlı yeşil)* tavan altındaki gün bölünmez — doluluk nöbetçisi | gerçek PostgreSQL |
| B2-c | Günlük tavan = plana giren kapasite; araç başına tavan aşılmaz | gerçek PostgreSQL |
| B2-canlı | Aynı iddia **gerçek VROOM + OSRM** ile | gerçek çözücü |
| K-3a canlı | `costs.fixed` ile `max_tasks` aynı payload'da yaşar | gerçek çözücü |
| B-4 | Eşleşmeyen araç kodu korunur | gerçek PostgreSQL + alembic |
| B-5 | Araç değişimi kuryeyi silmez; açık `null` çözer | gerçek HTTP |
| B-6 | Yedi metrik değeri elle hesaplanmış fixture ile birebir | gerçek PostgreSQL + HTTP |
| B-3 | İlçesiz adres 422; formda kayıt ilerlemez | gerçek HTTP + gerçek DOM |

### 10.5 Düzeltme turunun kapıları (15 Ağu 2026)

Zincir: matris `914ff65` (14 kırmızı, üretim kodundan ÖNCE) → düzeltme
`7862b51`. Bütün ölçümler **gerçek VROOM v1.14 + gerçek OSRM Adana yol ağı
ayaktayken** alındı — denetimin B-1'i bulmasını sağlayan koşul buydu.

| Kapı | Denetim tabanı (7422a25) | Düzeltme sonrası |
|---|---|---|
| `pytest tests/integration` | 1348 · **1 kırık** (routing_live) | **1368 passed · 0 failed · 0 skip** |
| `pytest tests` (birim) | 988 | **993** |
| `pytest tests/verify` | 126 passed · 6 skipped | **aynı** (damga geri alındı) |
| `npx vitest run` | 912 · 88 dosya | **917 · 90 dosya** |
| `npx eslint src` | 0 hata · 32 uyarı | **aynı** |
| `tsc -b` · `ruff check .` | temiz | **temiz** |
| Mutasyon provası | — | **8/8 yakalandı** (md5-doğrulamalı güvenli yama) |
| Gerçek Chrome kabulü | 14 adım · 0 kırık | **22 adım · 0 kırık** |

Mutasyonların hepsi düzeltmenin nöbetçisini hedefledi: rota katmanına ham
`max_stops` (B-2), günlük tavanın ayrı ifadeden türemesi (B-2), başlamamış
turun km'si (B-6), iptal durağın sayılması (B-6), pasifleştirmenin kapıyı
atlaması (B-14), eşleşmeyen araç kodunun ezilmesi (B-4), ilçenin yeniden
opsiyonel olması (B-3), nokta düzenlemenin sessizce yazmaması (B-9).

Tarayıcı turuna eklenen dört yeni adım (6a–6e, 7a–7c) gerçek Chrome'da
ölçüldü: başlangıç noktası gerçek formdan düzenlendi ve **sayfa yeniden
yüklendikten sonra sunucudan okunarak** kalıcılığı doğrulandı; canlı eklenen
araçla gerçek bir tur kuruldu ve gün tahtasında **o aracın benzersiz
etiketiyle** çizildiği görüldü (B-12 tekilleştirmesinin uçtan uca kanıtı).

**Turun kendi hataları — dürüst kayıt.** İki adım ilk koşumda yanlış sebeple
kırmızı düştü ve ikisi de TESTİN hatasıydı: (a) "Düzenle" tıklaması sayfadaki
ilk görünen butonu yakalıyordu (araç satırlarının kendi Düzenle'si) — tıklama
bölüme sabitlendi; (b) "araç tahtada listelenir" beklentisi yanlıştı, tahta
araç listesini yalnız `vehicle_id → araç` eşlemesi için kullanır, tur yoksa
hiçbir araç çizmez — iddia "tur kurulunca aracın etiketiyle çizilir"e
çevrildi ve böylece **güçlendi**. Ayrıca B-5'in ilk hâli `courier_id` diye
olmayan bir alan okuduğu için `KeyError` ile kırmızıydı (yanlış sebep);
düzeltildikten sonra ters prova ile gerçekten nöbetçilik ettiği gösterildi.

### 10.6 Kapsam dışı bırakılanlar → borç defteri

* **[[TB-51]]** `core/ratelimit._client` event loop'a bağlı → suite içinde
  limiter sessizce fail-open; depodaki her rate-limit testi yalancı yeşil
  olabilir. İP-19'un düğümü kendi ön koşulunu kurar, genel çözüm ortak yüzeyi
  değiştirir.
* **[[TB-52]]** Gün tahtasında yalnız havuz→araç sürükleme var (§4.2 düzeltildi).
* **[[TB-53]]** `delete_vehicle` 409'unun kontrol-sonra-yaz yarışı (denetim de
  kaybeden sıralamayı üretemedi).

Denetimin diğer P2'lerinden **B-8** (D-3 nöbetçisinin üretim ifadesini
kopyalaması, `test_D3_ucuncu_arac_*`'ın `dispatch_day`'i hiç çağırmaması) ve
**B-14**'ün `first_attempt_rate` tanım sapması bu turda **davranışla**
kapatıldı: `test_B2c_*` artık tavanı gerçek `dispatch_day` çıktısıyla ölçüyor
(kopya ifade değil, gözlemlenen bölüşüm) ve §4.3'ün metni koda göre
düzeltildi. **D-15**'in kaynak taraması olduğu kaydı §5'te duruyor.
