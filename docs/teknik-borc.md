# Teknik Borç Defteri

Paket çalışmaları sırasında **fark edilen ama kapsam dışı olduğu için
dokunulmayan** sorunlar. Amaç: "sonra bakarız" demenin izini bırakmak. Her
kayıt bulunduğu yeri, gerçek etkisini ve neden ertelendiğini söyler.

Bir borcu kapatan commit, ilgili satırı **buradan siler** (kapatılmış borcun
notunu bırakmak, yapılmış bir işi yapılmamış gibi anlatır).

---

## TB-10 · KVKK silme: kurye PROFİLİ (vesikalık/plaka/telefon) ve silme audit kaydı — ürün kararı bekliyor

| | |
|---|---|
| **Bulundu** | İP-3 üretim uygulaması (Commit D — hesap silme/KVKK) |
| **Yer** | `backend/services/account_deletion_service.py::anonymize_account` ↔ `backend/models/courier.py` (`name`/`phone`/`photo_url`/`vehicle_plate`) |
| **Durum** | Kurye kendi GİRİŞ hesabını (`courier_accounts`) sildiğinde hesap anonimleşiyor ve token'lar ölüyor; ama `courier_id` ile bağlı **Courier profili** (isim, telefon, `private/` vesikalık foto, plaka) admin-yönetimli işletme kaydı olduğu için DOKUNULMUYOR. Benzer şekilde `LibraryOperator.library_id` bağı anonimleştirmede kalıyor (tek başına tanımlayıcı değil, re-identification vektörü düşük). Ayrıca kullanıcı tetikli hesap silme `audit_logs`'a satır YAZMIYOR (yalnız PII'siz `logger.info`); bu yüzden İP-3'ün "silme audit kaydı PII sızdırmaz" testi bugün boş küme üzerinde geçiyor |
| **Neden ertelendi** | İP-3 sözleşmesi bu iki noktada karar içermiyor; sözleşme talimatı açık: "keyfî yeni ürün politikası uydurma; belirsizliği raporla". Kurye profili çalışan/işletme kaydı mı (saklama meşru) yoksa kişisel veri talebiyle silinmeli mi — ürün + hukuk kararı. Silme audit kaydı yazmak ise hijyen nöbetçisi ve test teardown kapsamını da değiştirir |
| **Sonraki adım** | (1) Kurye ayrılınca `Courier` profilinin anonimleştirilme/saklama süresi kararı (PoD 12 ay kararıyla birlikte düşünülmeli); (2) hesap silmeye actor'ü kendisi olan bir audit satırı + testte "kayıt VAR ve PII yok" biçimine geçiş |

## TB-9 · İP-3 P2 nöbetçi eksikleri (test tarafı — kapanış denetiminden sonra eklenmeli)

| | |
|---|---|
| **Bulundu** | İP-3 üretim uygulaması kapanışı (P2 listesi) |
| **Yer** | `backend/tests/integration/test_ip3_*.py` + `tests/integration/conftest.py::_KRITIK_TABLOLAR` |
| **Durum** | Üretim davranışı kapatıldı ama şu nöbetçiler YOK: (a) ADMIN 404 beklentileri yalnız durum kodunu ölçüyor, Not Found gövdesini değil; (b) `_admin_rota_kimlikleri()` boş dönerse 29 ADMIN node'u sessizce kaybolur (parametrize boş küme — modül seviyesi sert assert yok); (c) TUTOR→LIBRARY mesaj yönü kodda kapalı (`_can_message` iki yönü de reddeder) ama bu yönün davranış testi yok; (d) `GET /reviews/booking/{id}` admin erişimi `reports.view` iznine bağlandı — admin nöbetçi testi yok; (e) rol→model eşlemesi tek kaynağa indirildi (`auth_service.MODEL_BY_ROLE_ID`) ve `auth_version` mixin'e taşındı, ama "yeni rol eklenince kataloglar/mixin unutulursa kır" diyen yapısal drift nöbetçisi yok; (f) İP-3 hijyen tablosu kapsamı: `_KRITIK_TABLOLAR` `tutors`/`library_operators`/`courier_accounts`/`libraries` saymıyor |
| **Neden ertelendi** | İP-3 kırmızı matrisi bağımsız denetimden geçmiş test dosyalarıdır; üretim turu sırasında bu dosyalara davranış ekleyip denetimin onayladığı sözleşmeyi kaydırmamak bilinçli tercih. Kapsam da kontrolsüz büyümesin (İP-3 talimatı) |
| **Sonraki adım** | Ayrı, küçük bir test-güçlendirme commit'i: (a)+(b) gate dosyasına, (c) mesajlaşma dosyasına, (d) review dosyasına birer nöbetçi; (e) için `_LOGIN_PRECEDENCE`×`AuthVersionMixin` yapısal testi; (f) için hijyen tablosuna 4 tablo |

## TB-8 · CI entegrasyon adımı seed admin'siz koşuyor (`seed_admin` sessizce no-op)

| | |
|---|---|
| **Bulundu** | İP-3 (yetki/KVKK) kırmızı test matrisi — temiz bir test veritabanında ölçüldü |
| **Yer** | `backend/core/seed.py::seed_admin` (ilk iki satır) ↔ `.github/workflows/ci.yml` (`env:` bloğu) |
| **Durum** | `seed_admin` `ADMIN_EMAIL` **ve** `ADMIN_PASSWORD` ayarlı değilse hiçbir şey yapmadan döner — hata da log da yok. CI iş akışının `env:` bloğunda ikisi de tanımlı değil. Stok/envanter entegrasyon testleri ise `admins.id = 1`'i (seed admin) varsayıyor: `actor_id=1`, `created_by_admin_id=1` |
| **Etki** | Temiz bir veritabanında entegrasyon suite'inin **157 testi** `products_created_by_admin_id_fkey` ihlaliyle kırılıyor (yerelde ölçüldü: seed admin'siz 157 failed / 364 passed → seed admin'le 522 passed / 0 failed). CI'ın bu adımı ya kırmızı ya da hiç koşmuyor; her iki hâlde en riskli kod yolları korumasız |
| **İkinci kusur** | Sessiz no-op'un kendisi: "admin seed edilemedi" hiçbir yerde raporlanmıyor. Üretimde `AUTO_CREATE_DB` açılışında da aynı sessizlik geçerli |
| **Neden ertelendi** | İP-3'ün konusu yetki/kişisel veri sözleşmesi; CI zemini ayrı bir iş kolunun (İP-0) kapsamında. Düzeltme iki yerde: CI env'ine seed değişkenleri + `seed_admin`'in atlama kararını loglaması. Ayrıca testlerin `admins.id = 1` sabitine bağlılığı ayrıca gözden geçirilmeli (kırılgan varsayım) |
| **Sonraki adım** | CI `env:` bloğuna `ADMIN_EMAIL`/`ADMIN_PASSWORD` eklemek · `seed_admin`'e uyarı logu · testlerdeki sabit `1` yerine gerçek seed admin id'sini fixture'dan almak |

## TB-7 · `test_stock_migration_pg` flaky

| | |
|---|---|
| **Bulundu** | İP-3 regresyon koşuları (3 tam suite koşumu) |
| **Yer** | `backend/tests/integration/test_stock_migration_pg.py::test_bos_veritabaninda_upgrade_head_calisir` |
| **Durum** | Tam suite'in bir koşumunda kırıldı; aynı suite'in ikinci koşumunda ve test tek başına koşarken geçti (3 koşumda 1 kırılma) |
| **Etki** | Yeşil/kırmızı sinyali güvenilmez hale getirir: gerçek bir migration regresyonu "yine o flaky test" diye geçiştirilebilir |
| **Olası sebep** | Test kendi tek kullanımlık veritabanını `DROP`/`CREATE` edip `alembic`'i **subprocess** olarak koşuyor; en olası kaynak bu subprocess/DB yaşam döngüsündeki yarış (önceki koşumdan kalan bağlantı `DROP DATABASE`'i engelleyebilir) |
| **Neden ertelendi** | İP-3 yalnız test ekliyor, bu testin koduna dokunmuyor; teşhis için birkaç kez tekrarlı koşum + `pg_stat_activity` gözlemi gerekiyor |
| **Sonraki adım** | Kırılmayı yakalamak için `-p no:randomly` ile tekrarlı koşum; `DROP DATABASE ... WITH (FORCE)` kullanımı ve subprocess sonrası bağlantı kapanışının doğrulanması |

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
