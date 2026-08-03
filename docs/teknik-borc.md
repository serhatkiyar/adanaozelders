# Teknik Borç Defteri

Paket çalışmaları sırasında **fark edilen ama kapsam dışı olduğu için
dokunulmayan** sorunlar. Amaç: "sonra bakarız" demenin izini bırakmak. Her
kayıt bulunduğu yeri, gerçek etkisini ve neden ertelendiğini söyler.

Bir borcu kapatan commit, ilgili satırı **buradan siler** (kapatılmış borcun
notunu bırakmak, yapılmış bir işi yapılmamış gibi anlatır).

---

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
