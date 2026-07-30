# Teknik Borç Defteri

Paket çalışmaları sırasında **fark edilen ama kapsam dışı olduğu için
dokunulmayan** sorunlar. Amaç: "sonra bakarız" demenin izini bırakmak. Her
kayıt bulunduğu yeri, gerçek etkisini ve neden ertelendiğini söyler.

Bir borcu kapatan commit, ilgili satırı **buradan siler** (kapatılmış borcun
notunu bırakmak, yapılmış bir işi yapılmamış gibi anlatır).

---

## TB-1 · `order_returns.reason` model ↔ şema varsayılan sapması

| | |
|---|---|
| **Bulundu** | Stok hareket defteri paketi, commit 4 (test tohumu yazılırken) |
| **Yer** | `backend/models/store.py::OrderReturn.reason` ↔ `order_returns.reason` kolonu |
| **Durum** | Modelde `server_default=text("''")` var; **veritabanı kolonunda varsayılan YOK** (`column_default IS NULL`, `is_nullable = 'NO'`) |
| **Etki** | Çalışma zamanında **yok**: uygulama yolu iade talebini her zaman `reason` ile oluşturuyor (müşteri gerekçeyi yazıyor, cayma hakkında boş dizgi geçiliyor). Sapma yalnız **ham SQL** ile satır ekleyen yerlerde patlar — bugün tek örneği test tohumları |
| **Risk** | Düşük ama sinsi: modele bakarak "varsayılanı var" varsayan bir migration/script `NotNullViolation` alır ve sebebi modelde görünmez |
| **Neden ertelendi** | Stoğa dokunmuyor. Düzeltmesi bir migration gerektiriyor (`ALTER COLUMN … SET DEFAULT ''`) ve o migration'ı stok paketinin revizyonuna karıştırmak, iki bağımsız değişikliği tek geri alma birimine bağlardı |
| **Önerilen çözüm** | Ayrı bir küçük migration: `ALTER TABLE order_returns ALTER COLUMN reason SET DEFAULT ''`. Alternatif olarak modeldeki `server_default` kaldırılıp gerçeğe uydurulabilir — ama o zaman `reason` gerçekten zorunlu bir iş alanı hâline gelir ve **cayma** yolunda gerekçe zorunlu olmadığı için (`Mesafeli Sözleşmeler` m.15 koşulsuz cayma) tercih edilen yön **DB'ye varsayılan eklemektir** |
| **Doğrulama** | `SELECT column_default FROM information_schema.columns WHERE table_name='order_returns' AND column_name='reason'` → bugün `NULL` |

**Not:** aynı sınıftan başka sapma olup olmadığı taranmadı. Bu borç kapatılırken
`server_default` tanımlı olup DB'de karşılığı bulunmayan **tüm** kolonlar için
tek seferlik bir denetim yazılması önerilir (baseline migration squash'ından
kalmış başka örnekler olabilir).

---

## TB-2 · İade akışında sağlayıcı çağrısı boyunca ürün satırı kilitli kalıyor

| | |
|---|---|
| **Bulundu** | Stok hareket defteri paketi, commit 5 (iki fazlı iadenin telafi sırası değiştirilirken) |
| **Yer** | `backend/services/order_service.py::_refund_payment` ve `::_settle_return` — `_lock_order_products` çağrıları |
| **Durum** | Ürün satırları `FOR UPDATE` ile kilitleniyor, **sonra** ödeme sağlayıcısına HTTP isteği gidiyor, telafiler dönüşte uygulanıyor. Yani kilitler bir dış ağ çağrısı boyunca tutuluyor |
| **Neden böyle** | Telafiler artık yalnız sağlayıcı **başarılı** olduktan sonra uygulanıyor (para dönmeden mal geri gelmiş sayılmasın). Ama `perform_refund` içindeki `finalize_refund` sipariş satırını UPDATE ediyor, yani **Order kilidi** alıyor. Ürün kilidini o noktadan sonra almak bu yolu `Order → Product` yapar ve `_finalize_paid`'in `Product → Order` sırasıyla **gerçek bir deadlock döngüsü** kurar (plan §4e) |
| **Etki** | Sağlayıcı yavaşsa (iyzico HTTP, saniyeler) o siparişteki ürünlerin satırları kilitli kalır; aynı ürünü almaya çalışan eşzamanlı ödemeler bekler. İade **nadir ve yönetici tetikli** olduğu için pratikte dar bir pencere |
| **Değerlendirilen alternatifler** | (a) Telafiyi Faz 2 commit'inden sonraya almak → süreç orada ölürse sipariş REFUNDED olduğu için reconciler devralmaz ve **stok geri yüklemesi kalıcı olarak kaybolur**. (b) Kilit sırasını global olarak `Order → Product` yapmak → `_finalize_paid` ürünleri PAID claim'inden ÖNCE kilitlemek zorunda (oversell ön kontrolü), yani mümkün değil. (c) Savepoint'li iyimser geri yükleme → kilitler yine sağlayıcı çağrısı boyunca tutulur, üstüne karmaşıklık ekler |
| **Neden ertelendi** | Doğru çözüm, sağlayıcı çağrısını transaction dışına alan bir **outbox / iş kuyruğu** desenidir (mevcut `core/outbox` altyapısı buna uygun). Bu, ödeme/iade mimarisinin yeniden tasarımıdır ve stok paketinin kapsamı dışındadır |
| **İzleme** | Kilit bekleme süresi üretimde gözlenmeli: `pg_stat_activity` üzerinde `wait_event_type = 'Lock'` + `products` birleşimi bir uyarıya bağlanabilir |
| **Koruma** | Kanonik sıra `tests/acceptance/test_stock_lock_contract.py`, deadlock yokluğu `tests/integration/test_stock_lock_order_pg.py` (5 çift × ters sıra × 3 tur, `lock_timeout`'lu) ile sabitlendi. Sıra bozulursa testler kırılır |
