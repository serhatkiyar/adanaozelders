# Teknik Borç Defteri

Paket çalışmaları sırasında **fark edilen ama kapsam dışı olduğu için
dokunulmayan** sorunlar. Amaç: "sonra bakarız" demenin izini bırakmak. Her
kayıt bulunduğu yeri, gerçek etkisini ve neden ertelendiğini söyler.

Bir borcu kapatan commit, ilgili satırı **buradan siler** (kapatılmış borcun
notunu bırakmak, yapılmış bir işi yapılmamış gibi anlatır).

---

<!-- Numaralandırma notu (main ↔ İP-3 birleştirmesi): iki dal TB-6'nın üstüne
     BAĞIMSIZ olarak TB-7…TB-10 tahsis etti ve numaralar çakıştı. main
     kanoniktir (bkz. TB-8'in "Bulundu" satırı) ve F30/İP-2b sözleşmeleri
     main'in TB-8/TB-9'una atıf yapıyor; bu yüzden İP-3'ün dört kaydı
     TB-10…TB-13'e taşındı. Hiçbir kayıt silinmedi. Eski→yeni: İP-3 TB-7→TB-10,
     TB-8→TB-11, TB-9→TB-12, TB-10→TB-13 (`docs/ip3-yetki-kvkk-sozlesme.md`
     atıfları da güncellendi). -->

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

<!-- Kapanma notu (İP-5, `bda2edf`): **TB-21** ("Entegrasyon testleri
     `.env`'den `PAYMENT_PROVIDER` alıyor") KAPANDI ve dosyanın kendi kuralı
     gereği SİLİNDİ. Kapatan kod iki katmanlıdır: kök `conftest.py`
     `os.environ.setdefault("PAYMENT_PROVIDER", "fake")` (değişken YOKKEN
     korur) ve `tests/integration/db_guard.py::assert_fake_payment_provider`
     (açıkça `iyzico` verilmiş koşumu REDDEDER; session kapsamlı autouse
     fixture'da çağrıldığı için tüm entegrasyon suite'ini kapsar). Mutasyon
     provası P9 conftest satırını sökünce T-1a kırılıyor. Detay:
     `docs/ip5-kdv-fatura-sozlesme.md` §8. -->

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

## TB-19 · İP-4 nihai bağımsız audit'inin P2 listesi (on kayıt — öncelik sırasıyla)

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
| 9 | **`PackageLabel` Vitest flake'i — tam suite yükünde düşüyor** | `frontend/src/**` `PackageLabel.test.tsx` | Tek başına koşarken geçiyor, tam suite yükü altında ara sıra düşüyor. **İP-4 kaynaklı değil** — audit tabanda (`e726b9b`) da doğruladı. [[TB-14]]/8'deki `inventoryScreens` flake'iyle aynı sınıf ama **AYRI** kayıt: farklı dosya, farklı teşhis. (Merge duman testinde bu tur GÖRÜLMEDİ: 73 dosya / 744 test yeşil.) Sonraki adım: teşhis — paylaşılan zamanlayıcı/`waitFor` yarışı mı, yoksa suite'ler arası sızan durum mu |
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

## TB-15 · Mağaza para sözleşmesinin kaçağı — **(a) KAPANDI**, (b) açık

| | |
|---|---|
| **Bulundu** | İP-2a nihai bağımsız audit'i (4 Ağu 2026); merge sonrası main kodunda yeniden doğrulandı |
| **Yer** | `backend/services/order_service.py::complete_checkout` "ölü varlık" dalı (~`:626-665`) |
| **(a) `_out_of_stock_refund` merkezi sözleşme dışında** | **KAPANDI — İP-5** (`3a23f03` + `cf3615b`). Akış artık `reserve_refund` → `begin_refund` → `perform_refund` → `settle_refunded_order`. "Hiç satılmamış mala `SALE_CANCEL`" zararı iki katmanla kapatıldı: **açık parametre** (`settle_refunded_order(restock=False)` — canlı çağrıda bilgi tam) ve **kalıcı iz** (`_restock` → `_oversell_iptali_mi`, `order_status_history.changed_by = 'system:oversell'` — reconciler devraldığında parametre kaybolmuştur). Gerçek PG ile ölçüldü (O-1…O-4 + O-4b nöbetçisi), mutasyon provaları P7/P8 yakaladı. Detay: `docs/ip5-kdv-fatura-sozlesme.md` §7 |
| **(a) — geri alınan ara çözüm** | İlk uygulama "`_restock` satılan adedi `stock_ledger.sold_quantity_by_order_item` ile **defterden** okusun" diyordu. **GERİ ALINDI** (`cf3615b`) ve yardımcı silindi. Ölçüm çürüttü: geliştirme veritabanındaki 20 PAID fiziksel siparişin **19'unda** `SALE` hareketi yok (defter `stok_hareket_defteri_sku` onlardan SONRA kuruldu); `paid_at` 7 dolu / 12 NULL, `order_status_history`'de PAID kaydı 3 var / 16 yok. O kural, defter öncesi GERÇEK bir siparişin iptalinde stoğu geri döndürmezdi — **gerçek stok kaybı**. Kayıt burada duruyor çünkü kural makul görünüyor ve tekrar önerilebilir |
| **(b) `complete_checkout` geç-tahsilat dalı ikinci `refunded_amount` yazıcısı** | `apply_refunded_amount` "TEK yazıcı (M6)" diyor, ama "ölü varlık" dalı `refunded_amount`'a **mutlak atama** yapıyor (`refunded_amount: order_total`) — artırımlı değil, `LEAST(..., total)` tavanı yok, `refund_reserved` güncellenmiyor. Satır `refunded_amount=total, refund_reserved=0` gibi kendi içinde tutarsız kalıyor (`escrow.order_inflight_refund` bu ikiliyi birlikte okur) |
| **(b) bugünkü gerçek risk** | Düşük, kayıp güncelleme DEĞİL: dal yalnız `from_statuses=["PENDING","FAILED"]` claim'iyle koşuyor, fonksiyon girişi PAID/REFUNDING/REFUNDED'ı zaten erken döndürüyor ve kısmi RMA siparişin PAID olmasını gerektiriyor → o noktada `refunded_amount` pratikte 0. Yani **sözleşme ihlali / regresyon riski** |
| **Sonraki adım** | (b) ölü-varlık dalını `apply_refunded_amount`'a çevirmek + "kod tabanında `refunded_amount`'a yazan tek yer" yapısal nöbetçisi |

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
| 8 | **frontend `inventoryScreens` flake** | `frontend/src/**` Vitest | Ara sıra kırılıyor; teşhis edilmedi. Yeşil/kırmızı sinyalini bulandırır ([[TB-10]] ile aynı sınıf) |

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
