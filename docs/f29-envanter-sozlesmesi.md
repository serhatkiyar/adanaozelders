# F29 — Envanter Operasyon Sözleşmesi

Stok sayımı, sayım farkının uygulanması ve hasarlı stok yönetiminin **işletme
sözleşmesi**. Bu belge kod ile çelişemez: her madde çalışan bir testle
korunuyor ve testin adı yanına yazılı.

---

## 1. İki kova: SALEABLE ve DAMAGED

| Kavram | Nerede durur | Anlamı |
|---|---|---|
| **SALEABLE** | `products.stock` | Satılabilir durumdaki fiziksel adet |
| **DAMAGED** | `products.damaged_stock` | Hasarlı ama hâlâ **işletmede duran** adet |

* Dijital üründe her ikisi de `NULL`'dır ve bu bir DB kısıtıyla (
  `ck_products_damaged_pairing` + `products_damaged_pairing` trigger'ı)
  zorlanır. Dijital ürüne sayım da hasar işlemi de yapılamaz.
* İki kovanın **her biri** stok defterinde (`stock_movements`) kendi
  zincirini tutar: `qty_after[i] == qty_after[i-1] + qty_delta[i]`, kova
  başına bağımsız. Bir kovanın hareketi diğerinin `qty_after`'ını etkilemez.
* Her hareket **açık** bir `bucket` taşır. Kolonda kalıcı server default
  YOKTUR: varsayılan olsaydı hasarlı bir hareket sessizce satılabilir
  kovaya yazılırdı.

---

## 2. ON_PREMISE — işletmedeki fiziksel mevcut

```
ON_PREMISE = SALEABLE + DAMAGED + reserved_on_premise
```

`reserved_on_premise` = **ödenmiş ama işletmeden henüz çıkmamış** adet
(`orders.status='PAID' AND payment_status='PAID'`). Bu mal rafta durur; sayan
kişi onu sayar. Sistem stoğundan düşülmüştür ama fiziksel olarak oradadır.

Bu yüzden bir sayım satırının **beklenen fiziksel** değeri:

| Kova | Beklenen fiziksel |
|---|---|
| SALEABLE | `system_qty_snapshot + reserved_qty_snapshot` |
| DAMAGED | `system_qty_snapshot` (rezerve **uygulanmaz**, 0 değil) |

Hasarlı kovada rezerve kavramı yoktur; arayüz "0" değil **"Uygulanmaz"**
yazar — "0 rezerve" gerçek bir iddiadır ve yanlıştır.

**Fark** = `sayılan − beklenen fiziksel`. Sayılmamış satırın farkı `0` değil
**bilinmiyor**dur.

> Çalışılmış örnek: satılabilir 8, rezerve 2, sayılan 8 → beklenen 10 → fark **−2**.

---

## 3. Sayım FSM'i

```
DRAFT ──► IN_PROGRESS ──► REVIEW ──► APPLIED   (terminal)
             ▲               │
             └───────────────┘  (yeniden sayım / reopen; onay temizlenir)

DRAFT | IN_PROGRESS | REVIEW ──► CANCELLED     (terminal)
```

| Durum | İzinli eylemler |
|---|---|
| DRAFT | ürün ekle · başlat · iptal |
| IN_PROGRESS | say / yeniden say · incelemeye gönder · iptal |
| REVIEW | **uygula** · incelemeyi geri al · iptal — **sayım kapalı** |
| APPLIED, CANCELLED | salt okunur |

Kurallar:

* Boş oturum incelemeye gönderilemez; sayılmamış satır varken de gönderilemez.
* REVIEW'da miktar **girilemez**. Yeniden sayım yolu: **incelemeyi geri al**
  (`reopen`, `inventory.apply` yetkisi) → oturum `IN_PROGRESS`'e döner ve
  `reviewed_by/at` temizlenir — eski onay yeni sayımı kapsayamaz.
* Bir ürün+kova aynı anda **tek** açık oturumda bulunabilir
  (`uq_stock_count_lines_open` kısmi unique index'i; servis anlaşılır 409 verir).
* Bir oturumda en fazla **200 ürün** bulunur; bu aynı zamanda tek
  transaction'da kilitlenecek satır sayısının tavanıdır.

---

## 4. STALE ve RESOLVED

**STALE** = sayım yapıldıktan sonra, fiziksel etkisi **belirsiz** bir olay
geçti. Karar tablosu (`services/inventory_rules.py::PHYSICAL_EFFECT`) fiziksel
etkiyi olay bazında tanımlar:

| Olay | Fiziksel mevcut | Sayım için |
|---|---|---|
| `SALE` (ödeme) | **değişmez** — mal hâlâ rafta | satır bozulmaz |
| `ORDER_SHIPPED` | azalır | otomatik uzlaştırılır |
| Teslim edilemeyen paketin dönüşü | artar | otomatik uzlaştırılır |
| `RETURN` / iade kabulü | **belirsiz** (mal fiziksel geldi mi?) | **STALE** |
| `ADMIN_ADJUSTMENT` | belirsiz | **STALE** |
| Tanınmayan olay | bilinmiyor | **STALE** (fail-safe) |

**RESOLVED**, "çözüldü" DEĞİLDİR. Bir satıra açıklama yazmak belirsizliği
kayda geçirir ama fiziksel gerçeği yeniden ölçmez; satır **hâlâ uygulanamaz**.

> **STALE veya RESOLVED bir satır varken oturum uygulanamaz.** Kısmi uygulama
> yoktur: belirsizlik içeren bir satırı atlayıp oturumu APPLIED yapmak,
> sözleşmeyi sessizce delerdi.

Güvenli **tek çıkış** yeniden sayımdır (`set_counted`): kesiti, `counted_at`'i,
aktörü ve olay yüksek-su işaretini tazeler ve satırı `COUNTED`'a döndürür.

*Korunuyor:* `test_inventory_stale_safety_pg.py`,
`test_inventory_closing_pg.py::test_APPLY_stale_kontrolu_URUN_KILIDI_ALTINDA_yapilir`

---

## 5. APPLY atomikliği

Sıra kritiktir ve bu sırayla uygulanır:

1. Oturumu **claim et** (koşullu UPDATE — iki eşzamanlı uygulamadan yalnız biri kazanır),
2. ürünleri `stock_ledger.lock_products` ile **kilitle** (artan `id`),
3. satırları doğrula — **kilit altında**; `STALE`/`RESOLVED` varsa DUR,
4. farkı **sayım anındaki kesitten** hesapla (mutlak stok ataması YOK),
5. hareketleri **tek batch**'te yaz ve flush et,
6. ancak bundan sonra `APPLIED`.

* Ürün kilidi STALE kontrolünden **önce** alınır: kilitsiz okunan defter,
  iki ifade arasında commit eden bir hareketi göremez.
* Sıfır fark **hiçbir hareket yazmaz**; satır yine uygulanmış sayılır.
* Aynı `idempotency_key` ile ikinci istek **replay**'dir (yeni hareket yok);
  farklı anahtarla ikinci istek **409**'dur.
* Kısmi batch bir invariant hatasıdır; ya hepsi yazılır ya hiçbiri.

---

## 6. Hasar işlemleri

Kullanıcıya dört **fiil** olarak sunulur; API enum'u ekranda görünmez.

| İşlem | `kind` | Etki | Geri alınabilir mi |
|---|---|---|---|
| Hasara ayır | `TRANSFER` | SALEABLE −n, DAMAGED +n (iki bacak, tek transaction) | evet (kurtarma ile) |
| Satılabilir duruma döndür | `RECOVERY` | DAMAGED −n, SALEABLE +n | evet |
| İmha et | `DISPOSAL` | DAMAGED −n; SALEABLE etkilenmez | **hayır** |
| Tedarikçiye iade | `SUPPLIER_RETURN` | Seçilen kovadan −n | **hayır** |

* Tedarikçi iadesinde **kaynak kova zorunludur**; miktar yalnız o raftan
  düşer, diğerine sessizce aktarılmaz.
* Her işlem `stock_damage_events`'e **append-only** bir olay yazar; olay,
  hareketler ve bakiyeler **aynı transaction**tadır.
* Defter bacakları olaya yapısal olarak bağlıdır: `ref_type='damage_event'`,
  `ref_id=<olay id>`. Denetim olay→hareket ve hareket→olay yönünde gidebilir.
* Yetersiz kaynak stokta **hiçbir** olay veya hareket kalmaz.
* Parasal taraf (tedarikçi alacağı, maliyet, zarar, fatura) **kapsam dışıdır**.

---

## 7. Idempotency kapsamları

| Yüzey | Anahtar kapsamı | DB garantisi |
|---|---|---|
| Sayım APPLY | oturum başına `apply_idempotency_key` | koşullu UPDATE (claim) |
| Hasar işlemi | **`(actor_admin_id, idempotency_key)`** | `uq_stock_damage_events_idem` composite unique |
| Defter hareketi | `idempotency_key` (deterministik, kalıcı satır kimliğinden) | benzersiz index |

* Aynı yönetici + aynı anahtar + **aynı gövde** → replay (HTTP **200**).
* Aynı yönetici + aynı anahtar + **farklı gövde** → **409**.
* Farklı yöneticiler aynı metni bağımsız kullanabilir.
* Replay **hiçbir şey yazmaz**: yalnız defter bacaklarının tam ve doğru
  olduğunu doğrular. Eksik/fazla/yanlış bacak bir **veri bütünlüğü ihlalidir**
  ve 409 ile bildirilir — servis bozuk veriyi **onarmaz**.
* Uç yeni işte **201**, replay'de **200** döner. Arayüz ikisini ayırt eder;
  aksi hâlde operatör yapılmamış bir işi yapılmış sanıp ikinci kez gerçek bir
  imha yazabilirdi.

---

## 8. Rol ve izin matrisi

| İzin | Yapabildikleri |
|---|---|
| `inventory.view` | Oturum/satır/hasar olayı **okuma**, ürün adı ve SKU görme |
| `inventory.count` | Oturum açma, ürün ekleme, sayma, yeniden sayma, gönderme, çözümleme, iptal |
| `inventory.apply` | Gözden geçirmeyi geri alma, **farkı uygulama**, **hasar işlemleri** |

Seed edilen roller: **SUPER_ADMIN** ve **COMMERCE_MANAGER** üçünü de alır;
**OPERATIONS_MANAGER yalnız `inventory.view`** alır.

> **Görev ayrılığı**: sayan kişi tek başına envanteri değiştiremez.
> `products.*` bilinçli olarak yeniden kullanılmadı — ürün metnini düzenlemek
> ile envanteri değiştirmek aynı yetki kutusunda olmamalıdır.

Ek kural: **başkasının** sayım oturumunu iptal etmek ayrıca `inventory.apply`
ister. Token yoksa 401, izin yoksa 403; izin hatası 404 ile **gizlenmez**.

*Korunuyor:* `tests/acceptance/test_inventory_contract.py::test_migration_ROL_DAGITIMI_gercek_izin_setini_verir`

---

## 9. Global kilit sırası

```
StockCountSession → Product → Order → OrderReturn → DeliveryStop
```

* Ürün kilidi **tek huniden** alınır: `stock_ledger.lock_products` (artan `id`,
  tek sorgu, `populate_existing`). Hiçbir yazıcı kendi `FOR UPDATE` yolunu açmaz.
* Hasar servisi normalde yalnız Product kilidi alır.
* Bu sıra dokümandan değil **gerçek call-site'lardan** doğrulanır.

*Korunuyor:* `tests/acceptance/test_stock_lock_contract.py`,
`test_inventory_lock_order_pg.py`, `test_stock_lock_order_pg.py`

---

## 10. Bilinen sınırlar

F29 **fail-safe** tasarlandı: emin olmadığı yerde durur, tahmin etmez.

| Sınır | Sonuç | Sistem ne yapıyor |
|---|---|---|
| **Mal kabul akışı yok** | Tedarikten gelen mal defterde ayrı bir tür olarak görünmez | `ADMIN_ADJUSTMENT` + `TEDARIK` gerekçesiyle elle girilir; sayım bunu belirsiz sayıp **STALE** yapar |
| **`RETURN_RECEIVED` kaynağı yok** | İade edilen malın fiziksel olarak gelip gelmediği bilinmiyor | `RETURN` olayı **STALE** üretir; sayım uygulanmaz, operatör yeniden sayar |
| **Konum/depo ayrımı yok (F30)** | Aynı ürün tek bir fiziksel havuz sayılır | Çok depolu senaryo desteklenmiyor; tek konum varsayımı |
| **Ayrı onaylayan zorunlu değil** | Aynı kişi hem sayıp hem uygulayabilir | İzin ayrımı bunu **mümkün kılar** ama zorlamaz; roller ayrılırsa görev ayrılığı gerçek olur |
| **Maliyet/değerleme yok** | Hasarlı stoğun parasal karşılığı hesaplanmaz | Bilinçli kapsam dışı; F29 miktar ve iz tutar |
| **`audit_logs` DB seviyesinde değişmez değil** | Denetim kaydı teoride UPDATE edilebilir | Uygulama katmanında hiçbir uç yazmıyor; F29'un üç iz tablosu trigger'la kilitli |

Ayrıca `docs/teknik-borc.md`: **TB-2** (ürün kilidi altında ödeme sağlayıcısı
çağrısı), **TB-3** (reconciler devraldığında stok/kupon geri yüklenmiyor),
**TB-4** (transaction sahipliği belirsizliği), **TB-5** (`SALE_CANCEL`
`ref_type` etiketi), **TB-6** (`audit_logs` append-only değil).

---

## 11. Test ve smoke çalıştırma

```bash
# Birim + kabul (PG gerekmez)
cd backend && pytest -q --ignore=tests/integration --ignore=tests/verify

# Gerçek PostgreSQL entegrasyonu — ADI 'test' İÇEREN veritabanı ZORUNLU
POSTGRES_DB=adana_f29_test pytest tests/integration -q

# Yalnız envanter
POSTGRES_DB=adana_f29_test pytest tests/integration -q -k inventory

# Frontend
cd frontend && npm run test && npm run build && npm run lint
```

**İzole gerçek tarayıcı turu** (`scratchpad/f29_c8_smoke_izole.py` deseni):
her koşumda kendi disposable veritabanını yaratır, migrate eder, kontrollü
seed atar, backend ve Vite'ı **kendi seçtiği boş rastgele portlarda** başlatır,
doğru DB'ye bağlandığını yalnız o DB'de var olan bir işaretçi hesapla doğrular
ve `try/finally` ile hepsini temizler.

---

## 12. Disposable veritabanı güvenlik kuralları

1. **Adı `test` içermeyen bir veritabanında PG testi koşmaz** —
   `tests/integration/db_guard.py::assert_test_database` reddeder.
   `ceyhandb` (geliştirme) bilinçli olarak allowlist dışıdır.
2. Smoke/migration runner'ları kendi disposable DB'lerini **ön ekli ve
   rastgele** adla yaratır (`adana_smoke_…`, `adana_f29_migration_test`);
   yasaklı ad görülürse koşum **başlamadan** durur.
3. Runner **kendi başlattığı** process'leri durdurur; kullanıcının çalışan
   backend/Vite'ına dokunmaz. Seçtiği port doluysa **bağlanmaz, fail eder**.
4. Ölçüm ve prova betikleri de bu kurallara tabidir: ürettikleri her satır
   `try/finally` ile silinir. (Bu kural bir kez ihlal edildi — bir EXPLAIN
   probu test DB'sinde veri bıraktı; hijyen nöbetçisi artık sessizce
   geçmiyor, ölçemezse suite'i **düşürüyor**.)
5. Suite öncesi/sonrası 17 kritik tablonun sayıları karşılaştırılır
   (`tests/integration/conftest.py::_KRITIK_TABLOLAR`); beklenmeyen kalıcı
   veri oluşursa suite başarılı sayılmaz.
