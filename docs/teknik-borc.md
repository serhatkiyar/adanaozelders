# Teknik Borç Defteri

Paket çalışmaları sırasında **fark edilen ama kapsam dışı olduğu için
dokunulmayan** sorunlar. Amaç: "sonra bakarız" demenin izini bırakmak. Her
kayıt bulunduğu yeri, gerçek etkisini ve neden ertelendiğini söyler.

Bir borcu kapatan commit, ilgili satırı **buradan siler** (kapatılmış borcun
notunu bırakmak, yapılmış bir işi yapılmamış gibi anlatır).

---

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

## TB-3 · İade reconciler devraldığında stok geri yüklenmiyor

| | |
|---|---|
| **Bulundu** | F29 commit 5 adversarial kapanış denetimi (`SALE_CANCEL` üretim yollarının taranması sırasında) |
| **Yer** | `backend/services/order_service.py::_refund_payment` (~`:1363-1379`) ↔ `backend/services/escrow_reconciler.py::reconcile_refunding` (`:66-135`) |
| **Durum** | `_refund_payment` sağlayıcı çağrısı başarılı olursa `_restock` ile `SALE_CANCEL` yazar ve kuponu serbest bırakır. Sağlayıcı ilk denemede **reddederse** iade `REFUNDING` durumunda kalır ve sonradan `escrow_reconciler` tamamlar — ama reconciler `escrow.perform_refund` / `finalize_refund`'ı **doğrudan** çağırır, `_refund_payment`'a hiç uğramaz |
| **Etki** | Para müşteriye döner, **stok hiç geri yüklenmez ve kupon serbest bırakılmaz**. Defter sessizce eksik kalır; `verify_ledger` bunu "sapma" olarak bile göremez çünkü `products.stock` ile defter birbirine uyumlu kalır — yalnız fiziksel raf fazla verir. F29 sayımı bunu "fazla" olarak yakalar ama sebebini söyleyemez |
| **Neden ertelendi** | Düzeltme `escrow_reconciler` ile `order_service` arasındaki sorumluluk sınırını değiştirmeyi gerektiriyor (telafileri ortak bir "iade tamamlandı" kancasına taşımak). F29 commit 5'in kapsamı sayım servisidir; ödeme/iade akışına dokunmak paketi ve testlerini genişletirdi |
| **`order_service.py:1363-1366` yorumu bu boşluğu GİZLİYOR** | Yorum "reconciler o da bu fonksiyonu tekrar çağırdığında telafiler idempotency anahtarları sayesinde tek kez uygulanır" diyor; reconciler bu fonksiyonu çağırmıyor |
| **Sonraki adım** | Telafileri (`_restock` + kupon serbest bırakma) `escrow.finalize_refund` sonrasına ortak bir kancaya taşımak ve reconciler yolunu gerçek PG testiyle sınamak |

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
