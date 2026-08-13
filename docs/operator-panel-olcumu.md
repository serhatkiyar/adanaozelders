# Kütüphane Operatörü Paneli — Ölçüm Raporu

**Tarih:** 8 Ağustos 2026 · **Kapsam:** `LIBRARY_OPERATOR` (role_id=4) rolünün oturum
açtıktan sonra gördüğü tüm yüzeyler · **Yöntem:** kaynak kodu okuması (frontend rota
tablosu + sayfa bileşenleri, backend router + servis katmanı). Kod yazılmadı, hiçbir
dosya değiştirilmedi.

> **Ölçülemeyenler (dürüstlük notu).** Bu rapor **gerçek tarayıcı turu içermez**:
> uygulama çalıştırılmadı, gerçek bir operatör hesabıyla oturum açılmadı, mobil
> cihazda denenmedi, gerçek veriyle liste doluluğu/performansı ölçülmedi. Aşağıdaki
> "kaç tıklama" sayıları **rota + bileşen yapısından** çıkarılmıştır, kronometreyle
> değil. Kök `CLAUDE.md` → *Test Kalitesi ve Doğrulama Standardı* §F uyarınca
> bunlar **düşük güçlü** kanıttır; "bu buton gerçekten çalışıyor" iddiası
> içermezler, yalnız "bu ekran/uç var mı, hangi veriyi taşıyor" sorusunu
> cevaplarlar. Yetki/tenant iddiaları ise gerçek PostgreSQL entegrasyon testlerine
> dayandırılmıştır (§7).

---

## 1. Rota haritası: operatör ne görüyor

### 1.1 Giriş noktası

| Adım | Yer | Sonuç |
|------|-----|-------|
| Giriş sonrası yönlendirme | `frontend/src/lib/roles.ts:6-17` | Tüm roller gibi operatör de `/` köküne düşer |
| Kök dağıtıcı | `frontend/src/App.tsx:220` | `role_id === 4` → `OperatorHome` (URL `/` kalır) |
| Rol kapısı | `frontend/src/App.tsx:489-493` | `/kutuphanem` ve `/oturumlar` yalnız role 4'e açık |
| Onay kapısı (backend) | `backend/api/deps.py:173-212` | Kütüphane `ACTIVE` değilse yönetim uçları 403 |

Self-servis kayıt (`POST /libraries/register`, `backend/api/routers/libraries.py:160-182`)
anında geçerli bir operatör token'ı üretir; bu yüzden onay kapısı rol kontrolünden
ayrı olarak her yönetim ucunda tekrar uygulanır.

### 1.2 Kenar çubuğu (üst bar) — 5 giriş

`frontend/src/lib/nav.ts:51-57`:

| Etiket | Hedef | Ekran |
|--------|-------|-------|
| Panel | `/` | `pages/dashboards/OperatorHome.tsx` |
| Kütüphanem | `/kutuphanem` | `pages/dashboards/OperatorLibrary.tsx` |
| Oturumlar & QR | `/oturumlar` | `pages/dashboards/OperatorSessions.tsx` |
| Bakiyem | `/bakiyem` | `pages/Balance.tsx:126-157` (rol delegasyonu) |
| Mesajlar | `/mesajlar` | `pages/Messages.tsx:44-50` (OPERATOR_NAV destekli) |

Mobilde bu 5 giriş hamburger menüsünde dikey listeye dönüyor
(`components/DashboardHeader.tsx:238,294-295`) — nav mobilde kayboluyor değil.

### 1.3 Dört operasyon ekranının içeriği

**`/` — Panel** (`OperatorHome.tsx:20-57`)
- Kütüphane kimliği: kapak/logo/ad/ilçe/puan + durum rozeti + "Öğrenci görünümü" (`:68-152`)
- Onay durumu bandı: PENDING/REJECTED (+ "Tekrar başvur") (`:155-215`)
- Kazanç özeti: serbest / emanette / toplam (`:312-353`)
- "Oturumlar & QR" kısayol kartı (`:218-235`)
- Şifre değiştirme paneli (`:237-310`)
- **Bugüne dair hiçbir şey yok**: ne bugünkü rezervasyon sayısı, ne yaklaşan oturum, ne bekleyen iş.

**`/kutuphanem`** (`OperatorLibrary.tsx:70-97`) — bölüm bölüm düzenlenen profil:
Görseller (`:231-243`), Hakkında + kapasite + saatlik ücret (`:246-339`), İletişim
(`:342-408`), Adres & Konum + MapPicker (`:411-495`), Çalışma Saatleri (`:498-606`),
Olanaklar (`:609-659`).

**`/oturumlar`** (`OperatorSessions.tsx:22-55`) — günlük işin tamamı burada:
- QR/kod doğrulama kartı (`:58-157`) — kamera + elle kod + USB okuyucu, birleşik
  (deneme bileti **ve** çalışma rezervasyonu aynı kutudan)
- Deneme oturumları yöneticisi (`components/ExamSessionsManager.tsx:57-98`) — oturum
  CRUD, katılımcı paneli (`:212-251`), sonuç/karne paneli (`:255-417`)
- "Çalışma Alanı Rezervasyonları (yaklaşan)" listesi (`OperatorSessions.tsx:160-209`)

**`/bakiyem`** (`Balance.tsx:126-157`) — 3 özet kart (toplam kazanç / emanette / bu ay)
+ ödeme hesabı formu + işlem dökümü tablosu (`:250-319`).

### 1.4 Operatörün ayrıca *erişebildiği* ama kendisi için tasarlanmamış rotalar

`App.tsx:382-406` altındaki "yalnız kimlik gerektiren" grup role-agnostiktir; operatör
bu 20 rotanın hepsine girebilir. Davranışları:

| Rota | Operatörde ne oluyor | Kanıt |
|------|----------------------|-------|
| `/rezervasyonlar` | `/`'a geri yönlendirilir | `App.tsx:236-242` |
| `/sorular` | `/`'a geri yönlendirilir | `App.tsx:245-251` |
| `/talepler` | **Boş sayfa** (başlıksız kabuk, nav bile yok) | `pages/Demands.tsx:44-49` |
| `/takvim` | Açılır ama **öğrenci nav'ı** gösterir; `useBookings` çağırır | `pages/Calendar.tsx:71-75` |
| `/gorevler`, `/ogren/*` | Çalışır (sahiplik `(user_id, role_id)`) ama **öğrenci nav'ı** | `pages/Tasks.tsx:1146`, `pages/Learn.tsx:10` |
| `/bildirimler`, `/liderlik` | Açılır, **nav çubuğu boş** (`navItems=undefined`) | `Notifications.tsx:47-52`, `Leaderboard.tsx:52-57` |
| `/ayarlar` | Ödeme bilgileri sekmesi doğru çalışıyor ama **nav çubuğu boş** | `Settings.tsx:95-104`, `:820-837` |
| `/hesabim`, `/hesabim/profil` | Profil editörü, **nav çubuğu boş** | `App.tsx:226-231`, `Profile.tsx:49-53` |
| `/ders-talepleri/:id` | Rol eşleşmesi yok (`LessonDetail.tsx:53-55`) — içerik boş kalır | — |

Yani operatör panelin dışına düştüğü anda **navigasyondan kopuyor**: geri dönmek için
logoya/tarayıcı geri tuşuna basmak zorunda.

---

## 2. 17 görevin sınıflandırması

Tıklama sayımı, operatör `/` (Panel) ekranındayken başlar; nav'a bir tıklama sayılır.

### Günlük iş

| # | Görev | Sınıf | Yol ve kanıt |
|---|-------|-------|--------------|
| 1 | Bugün kaç rezervasyon var, kimler geliyor | **VAR ama eksik** | `/oturumlar` (1 tık) → "Çalışma Alanı Rezervasyonları (yaklaşan)". Liste **tüm geleceği** döker; bugün/yarın ayrımı, tarih başlığı, sayaç yok (`OperatorSessions.tsx:160-209`, `services/study_reservation_service.py:592-612` → `ends_at >= now`, sayfalama yok). Deneme oturumuna kayıtlı kişiler bu listede DEĞİL; ayrı oturum satırından "Katılımcılar" açmak gerekiyor. Panel ekranında bugüne dair sıfır bilgi. |
| 2 | Gelen kişinin biletini doğrulamak (QR/kod) | **VAR, kolay** | `/oturumlar` (1 tık) → sayfanın en üstünde QR kartı; elle kod alanı zaten açık (kod yaz + Enter). Kamera için 1 tık daha. Deneme bileti ve çalışma rezervasyonu **tek kutudan** doğrulanıyor (`api/routers/library_exams.py:412-427` → `library_exam_service.py:1247-1288` token'ı iki tabloda arıyor). Kamerasız/iOS için manuel giriş kutusu var (`components/QrScanner.tsx:20-37`). |
| 3 | Yoklama almak — kim geldi kim gelmedi | **VAR, zahmetli** | Deneme: `/oturumlar` → oturum satırı → "Katılımcılar" (3 tık) → satır satır "Giriş ver" (`ExamSessionsManager.tsx:212-251`). Çalışma: listede doğrudan "Giriş ver" (2 tık). **Ama:** liste yalnız `PAID`/`ATTENDED` içerir (`library_exam_service.py:1006-1020`, `models/library_exam.py:57-60`); "gelmedi" diye bir işaret, "X/Y geldi" sayacı ve yoklama özeti **yok**. Gelmeyenler sessizce listede kalır. |
| 4 | Boş yer var mı, anlık doluluk | **YOK** | Operatöre doluluk döndüren hiçbir uç/ekran yok. En yakın şey public `GET /study-reservations/quote` (`api/routers/study_reservations.py:51-58`) — o da **belirli bir zaman aralığı** için `remaining` döner ve operatör panelinde hiç kullanılmıyor. Backend'de sayım mantığı hazır (`library_capacity.count_study_seats`), yüzeyi yok. |
| 5 | Yarının rezervasyonlarını görmek | **VAR ama eksik** | Aynı "yaklaşan" listesi (görev 1). Tarih seçici, gün filtresi, gruplama yok; yarını görmek için listeyi gözle taramak gerekiyor. |

### Oturum ve kontenjan

| # | Görev | Sınıf | Yol ve kanıt |
|---|-------|-------|--------------|
| 6 | Yeni deneme sınavı oturumu açmak | **VAR, kolay** | `/oturumlar` → "+ Oturum" (2 tık) → modal: katalog, tür, ücret, başlık, tarih/saat, süre, kontenjan (`ExamSessionsManager.tsx:526-658`). |
| 7 | Oturumun kontenjanını değiştirmek | **VAR, zahmetli** | `/oturumlar` → satırda "Düzenle" → Kontenjan → "Güncelle" (4 tık, modal). Backend kontenjanı mevcut aktif kayıt sayısının altına indirmeyi 409 ile engelliyor (`services/library_exam_service.py:278-284`). |
| 8 | Oturumu iptal etmek | **VAR, kolay** | `/oturumlar` → satırda "İptal" (2 tık) + onay. Ödeyenlere iade otomatik (`library_exam_service.py:292-303`). Onay için `window.confirm` kullanılıyor (`ExamSessionsManager.tsx:126-132`) — panelin olgun tarafında `ConfirmDialog` var. |
| 9 | Çalışma saatleri / slot yapısını düzenlemek | **VAR, zahmetli** | `/kutuphanem` → "Çalışma Saatleri" → "Düzenle" → 7 gün için aç/kapa + saat → "Kaydet" (4+ tık, `OperatorLibrary.tsx:498-606`). **Slot kavramı yok**: rezervasyon serbest aralık + kontenjan modelidir; min 30 dk / maks 14 saat sınırları koda gömülü (`services/study_reservation_service.py:46-47`) ve operatör tarafından değiştirilemez. |
| 10 | Kütüphane bilgilerini güncellemek | **VAR, kolay** | `/kutuphanem` (1 tık) → ilgili bölümde "Düzenle" (2 tık). Adres+harita, telefon/e-posta/web, açıklama, kapasite, saatlik ücret, olanaklar, logo/kapak/galeri — hepsi var (`OperatorLibrary.tsx:70-97`). Ad ve durum bilinçli olarak admin'e ait (`:45-68`). |

### Para

| # | Görev | Sınıf | Yol ve kanıt |
|---|-------|-------|--------------|
| 11 | Bu ay ne kazandım | **VAR, kolay** | `/bakiyem` (1 tık) → "Bu ay kazanılan" kartı (`Balance.tsx:230-242`, `services/library_service.py:965+` → `this_month_earning`). Panel ekranında da serbest/emanet özeti var. |
| 12 | Hakediş ne zaman ödenecek | **YOK** | Operatöre ödeme takvimi, ödenmiş/ödenmemiş bakiye veya havale geçmişi döndüren **hiçbir uç yok**. Hakediş defteri tamamen ADMIN'e ait (`backend/api/routers/payouts.py:1-5,55+`: "Ödeme banka üzerinden ELLE yapılır; burada yalnız defter tutulur"). Ekranda operatörün gördüğü tek şey "toplam kazanç" toplamı. **Ayrıca metin yanıltıcı:** `Balance.tsx:196-199` "tutarlar iyzico üzerinden doğrudan IBAN'ına geçer" diyor; kurulu mekanizma elle havale defteri. |
| 13 | Tek rezervasyonun ödeme durumu | **VAR, zahmetli** | `/bakiyem` → İşlem Dökümü tablosunda öğrenci adı + durum rozeti (`Balance.tsx:284-313`). **Arama/filtre/sıralama yok**; kişiyi gözle bulmak gerekiyor. Rezervasyon listesinde (görev 1) ödeme durumu hiç gösterilmiyor. |
| 14 | İade edilmiş rezervasyonları görmek | **VAR ama eksik** | Aynı tabloda `REFUNDED` rozetiyle görünür (`library_service.py:1172-1176` `normalize_escrow_status`). Filtre yok; "İade edilen" toplamı yalnız sıfırdan büyükse küçük bir alt satır olarak çıkıyor (`Balance.tsx:237-241`). |

### Sorun çözme

| # | Görev | Sınıf | Yol ve kanıt |
|---|-------|-------|--------------|
| 15 | Öğrenci "ödedim ama görünmüyor" derse | **YOK** | Katılımcı listesi yalnız `PAID`/`ATTENDED` gösterir (`library_exam_service.py:1006-1020`); ödemesi yarım kalmış (`PENDING_PAYMENT`) kayıt **hiçbir operatör ekranında görünmez**. Öğrenci adıyla arama yapılabilecek yüzey yok. Kod girilirse dönen tek yanıt 404 "Geçersiz QR / bilet bulunamadı" (`library_exam_service.py:1284`) — sebebi (ödenmemiş / başka kütüphane / yanlış kod) söylenmez. Operatörün elinde teşhis aracı yok; iş admin'e düşüyor. |
| 16 | Yanlışlıkla yoklama alındıysa geri alma | **YOK** | Geri alma ucu yok (kod tabanında `unattend`/geri alma karşılığı bulunamadı). `ATTENDED` claim'i emaneti aynı anda serbest bırakıyor ve `released_at` geri alınamaz bir damga (`study_reservation_service.py:757-770`, `library_exam_service.py:1286-1288`). Admin tarafında da karşılığı yok. |
| 17 | Öğrenci iptal etmek isterse operatör ne yapabilir | **YOK (operatör için)** | `cancel` uçlarının ikisi de yalnız CLIENT'a açık (`api/routers/study_reservations.py:153-159`, `api/routers/library_exams.py:389-398`). Operatörün elindeki tek araç **oturumun tamamını iptal etmek** (herkese iade). Tek kişilik iade/iptal yolu yok; 24 saat kuralı (`study_reservation_service.py:537,558-564`) öğrencinin kendi ekranından işliyor. |

**Özet:** 17 görevin **4'ü kolay**, **4'ü zahmetli**, **4'ü eksik**, **5'i yok**.
Yok olanların dördü (12, 15, 16, 17) doğrudan "işletme sahibinin telefonu çaldığında"
gereken şeyler.

---

## 3. Envanter sayıları

| Ölçüm | Değer | Not |
|-------|-------|-----|
| Operatöre **tasarlanmış** sayfa | **5** | Panel, Kütüphanem, Oturumlar & QR, Bakiyem, Mesajlar (+ Mesaj Merkezi aynı içeriği sarar) |
| Kimlik doğrulamalı erişebildiği toplam rota | **23** | 3 operatör/kök + 20 ortak (`App.tsx:382-406`) |
| Bunlardan yönlendirilen / boş açılan | **3** | `/rezervasyonlar`, `/sorular` (redirect), `/talepler` (boş kabuk) |
| Yanlış rol nav'ı gösteren | **6** | `/takvim`, `/gorevler`, `/ogren/*` → öğrenci nav'ı |
| Nav çubuğu tamamen boş açılan | **5** | `/bildirimler`, `/liderlik`, `/ayarlar`, `/hesabim`, `/hesabim/profil` |
| `DataTable` kullanan operatör ekranı | **0** | `DataTable` yalnız 5 admin sayfasında (`components/admin/data-table/DataTable.tsx` tüketicileri) |
| Sayfalama içeren operatör listesi | **0** | — |
| Arama kutusu içeren operatör ekranı | **0** | — |
| Filtre (durum/tarih/tür) içeren operatör ekranı | **0** | — |
| URL state (`useSearchParams`) kullanan operatör ekranı | **0** | Admin tarafında 14 sayfa kullanıyor |
| Düz HTML tablo | **2** | Bakiyem işlem dökümü, oturum sonuç tablosu — ikisi de sayfalamasız |
| Hata durumu gösterilmeyen sorgu | **~15 (hepsi)** | Aşağıda dökümü |

### 3.1 Sessiz kesilen / sınırsız listeler

| Liste | Durum | Kanıt |
|-------|-------|-------|
| Bakiyem → İşlem Dökümü | **SESSİZ KESİLİYOR**: kaynak başına 200 satır tavanı, "daha fazla" yok, toplam sayı yok, kullanıcıya uyarı yok | `services/library_service.py:1134-1135,1159,1193` |
| Deneme oturumları (yönetim) | **Sınırsız**: kütüphanenin geçmiş+gelecek TÜM oturumları tek seferde | `library_exam_service.py:369-381` (`limit` yok) |
| Çalışma rezervasyonları (yaklaşan) | **Sınırsız**: tüm gelecek | `study_reservation_service.py:592-612` |
| Oturum katılımcı listesi (roster) | **Sınırsız** | `library_exam_service.py:1006-1020` |

Bugünkü hacimde ikisi de sorun değil; ama 200 satırlık tavan **sessiz** olduğu için
"eski bir işlem kayboldu" şikâyeti geldiğinde yanıltıcıdır, sınırsız listeler ise
kütüphane bir yıl çalıştıktan sonra oturum ekranını kullanılamaz hâle getirir.

**Sıralama kusuru:** oturum listesi `starts_at DESC` sıralı
(`library_exam_service.py:379`) — yani **en uzak gelecekteki oturum en üstte**.
Bugünkü sınavı yönetecek operatör, listede aşağı inmek zorunda.

### 3.2 Hata durumu gösterilmeyen sorgular

Operatörün dokunduğu ekranlarda `isError` okuyan **tek bir yer yok** (grep: 0 sonuç
`OperatorHome.tsx`, `OperatorSessions.tsx`, `OperatorLibrary.tsx`, `Balance.tsx`,
`ExamSessionsManager.tsx`). Hata durumunda kullanıcı **boş liste** ya da sonsuz
iskelet görür:

| Ekran | Sorgu | Hata davranışı |
|-------|-------|----------------|
| Panel | `useOperatorMe`, `useLibraryAdminDetail`, `useLibraryEarnings`, `usePaymentAvailability` | Kart hiç render edilmez (`OperatorHome.tsx:319-320` `if (!data) return null`) |
| Oturumlar & QR | `useOperatorMe`, `useLibraryAdminDetail`, `useManageSessions`, `useManageStudyReservations`, `useRoster`, `useUsableCatalogs` | "Henüz oturum eklenmedi" / liste hiç görünmez (`OperatorSessions.tsx:167` `if (!data \|\| data.length === 0) return null`) — **hata ile boş ayırt edilemiyor** |
| Kütüphanem | `useOperatorMe`, `useLibraryAdminDetail`, `useLibraryMedia` | Sonsuz iskelet (`OperatorLibrary.tsx:77-82`) |
| Bakiyem | `useOperatorMe`, `useLibraryEarnings`, `useLibraryEarningsTransactions`, `useLibraryPayout` | "Henüz bir işlem yok" (`Balance.tsx:266-269`) — **hata "işlem yok" diye okunuyor**, para ekranında en kötü yanlış |
| Ayarlar | `useCurrentUser`, `useOperatorMe`, `useLibraryPayout` | Sessiz |

Karşılaştırma: admin sayfaları `ErrorState` bileşenini kullanıyor
(`components/admin/ui/PageState.tsx:20-33`, `role="alert"` + "Yeniden dene").

### 3.3 Mobil / dar ekran

Operatörün işi **fiziksel olarak mobil**: QR okutma kapıda, telefonla yapılır.
Kodda mobil için doğru yapılanlar:

- Nav mobilde hamburger listesine dönüyor (`DashboardHeader.tsx:238,294-295`).
- Ekranlar tek sütun + `max-w-3xl`; kartlar `sm:` kırılımlarıyla yığılıyor.
- QR tarayıcı `facingMode: "environment"` (arka kamera) ve **kamera yoksa manuel
  giriş kutusu** sunuyor; `http://` üzerinden bağlanıldığında sebebi ayırt ediyor
  (`components/QrScanner.tsx:14-19,35-37`).
- Sonuç tablosu `overflow-x-auto` + `min-w-[480px]` ile yatay kaydırılıyor
  (`ExamSessionsManager.tsx:396-397`).

Mobil için eksik olanlar:
- Kamera **HTTPS zorunlu**; kütüphane sahasında `http://` ile açılırsa kamera hiç
  görünmez, elle kod girişine düşülür (kod bunu doğru raporluyor ama operatöre
  "HTTPS gerekiyor" diye bir kurulum notu hiçbir ekranda yok).
- Bakiyem işlem dökümü `min-w-[640px]` (`Balance.tsx:272`) — telefonda yatay kaydırma.
- Oturum düzenleme modal'ı 12 alanlı; telefonda uzun form.
- **Karar:** operatörün QR/yoklama işi telefonda, oturum kurma + para işi masaüstünde
  yapılacak şekilde tasarlanmış görünüyor; ama "bugünün işi" ekranı olmadığı için
  telefondaki asıl senaryo (kapıda dururken "sırada kim var") desteklenmiyor.

---

## 4. Olgun panelle desen farkı

Karşılaştırma tarafı: `/yonetim/kullanicilar`, `/yonetim/rezervasyonlar`,
`/yonetim/denetim-kayitlari`, `/yonetim/paketleme`, `/yonetim/dagitim/*`.

| Desen | Olgun admin tarafı | Operatör tarafı |
|-------|--------------------|-----------------|
| Tablo altyapısı | `DataTable` (TanStack Table): sıralama, sayfa boyutu, toplam sayı, mobil satır render'ı (`components/admin/data-table/DataTable.tsx:13-29`) | Yok — düz `<table>` ya da `<ul>` |
| Sayfalama | `page`/`pageSize`/`total` zorunlu prop | Yok; 200'lük sessiz tavan |
| URL state | `useSearchParams` (14 admin sayfası: `?kuyruk=`, `?tarih=`, `?gun=`) — deep-link + tarayıcı geri tuşu | Hiç yok; panel içi durum yalnız `useState` |
| Hata durumu | Her sorguda `ErrorState` — "hata ≠ boş ekran" kuralı (`admin/ui/PageState.tsx:20-33`) | 0 sorguda |
| Boş durum | `EmptyState` (başlık + açıklama + aksiyon) | Bazı yerlerde tek satır metin, bazı yerlerde `return null` |
| Onay diyaloğu | `ConfirmDialog` (`admin/ui/ConfirmDialog.tsx`), gerekçeli `ReasonDialog` | `window.confirm` (`ExamSessionsManager.tsx:127,299`) |
| Bilgi mimarisi | Bölüm → alt sekme → deep-link'li detay (ör. dağıtım 5 alt sekme + tur detayı) | 4 düz sayfa; en yoğun sayfa (`/oturumlar`) üç işi tek sayfada üst üste yığıyor |
| Kokpit ekranı | "Bugün" sayfası: kapasite şeridi, istisna kuyruğu, günün turları (`pages/admin/delivery/DeliveryTodayPage.tsx`) | Panel ekranı **bugünü hiç göstermiyor** |
| Arama/filtre | Durum/tarih/kuyruk filtreleri standart | Yok |
| Denetim izi | Admin kritik aksiyonları `audit_logs`'a yazılıyor | Operatör aksiyonları (yoklama, oturum iptali) **audit'e yazılmıyor**; yalnız `attended_by_operator_id` damgası var (`study_reservation_service.py:766`) |

**Tek cümle:** operatör paneli, admin panelinin *önceki nesli* gibi duruyor — İP-4'te
admin tarafına getirilen desenlerin (DataTable, URL state, ErrorState, ConfirmDialog,
kokpit) **hiçbiri** operatör tarafına uygulanmamış.

---

## 5. En çok kullanılacak beş görev ve durumları

Kullanım sıklığına göre (günlük → aylık):

| Sıra | Görev | Sıklık | Durum | Asıl sorun |
|------|-------|--------|-------|-----------|
| 1 | Bilet/rezervasyon doğrulama (görev 2) | Her müşteri | 🟢 **Sağlam** | Yok. Birleşik QR + manuel fallback doğru kurgulanmış. |
| 2 | Bugünün listesi / sırada kim var (görev 1, 5) | Günde onlarca kez | 🟡 **Eksik** | "Bugün" kavramı yok; tüm gelecek tek liste. Deneme katılımcıları ile çalışma rezervasyonları ayrı yerlerde. |
| 3 | Yoklama durumu — kim geldi kim gelmedi (görev 3) | Her oturum günü | 🟡 **Eksik** | Sayaç yok, no-show görünürlüğü yok, geri alma yok (görev 16). |
| 4 | "Ödedim ama görünmüyor" (görev 15) | Haftada birkaç | 🔴 **Yok** | Operatörün teşhis aracı sıfır; her vaka admin'e gidiyor. |
| 5 | Para: bu ay ne kazandım / ne zaman ödenecek (görev 11, 12) | Haftalık–aylık | 🟡 **Yarısı var** | Kazanç var, **hakediş/ödeme takvimi yok**; üstelik ekrandaki metin gerçek mekanizmayla çelişiyor. |

---

## 6. Öneri listesi

### 6.1 Ucuz (mevcut bileşenlerle, yarım gün – bir gün)

1. **"Bugün" bloğu — Panel ekranına.** Mevcut iki uçtan (`/study-reservations/manage`,
   `/exam-sessions/manage`) gelen veriyi istemcide bugüne göre süzüp Panel'e koymak:
   "Bugün N rezervasyon · M kişi bekleniyor · sıradaki 14:00 Ayşe K.". Yeni uç
   gerekmiyor. En yüksek fayda/maliyet oranı bu.
2. **Yaklaşan listesini güne göre grupla** (`Bugün` / `Yarın` / `Bu hafta` başlıkları)
   ve her grubun başına sayaç koy — `OperatorSessions.tsx:177-208` içinde saf bir
   gruplama fonksiyonu (Vitest'lenebilir) yeterli.
3. **Oturum listesini kronolojik sırala.** `starts_at DESC` → yaklaşanlar önce
   (geçmiş oturumlar altta). Tek satırlık backend değişikliği
   (`library_exam_service.py:379`) ama gündelik kullanımda büyük fark.
4. **`ErrorState`'i operatör ekranlarına bağla.** Bileşen hazır
   (`admin/ui/PageState.tsx`); 4 sayfada ~15 sorguya `isError` eklemek mekanik iş.
   Özellikle Bakiyem'de kritik: "hata" şu an "işlem yok" diye okunuyor.
5. **Yoklama sayacı.** Roster ve rezervasyon listesinin başına "N/M giriş yapıldı"
   satırı — veri zaten elde (`status === "ATTENDED"` sayımı).
6. **`window.confirm` → `ConfirmDialog`.** Oturum iptali ve karne yayınlama, para/
   iade sonucu doğuran iki aksiyon; tarayıcı diyaloğu bu ağırlıkta yetersiz.
7. **Ortak sayfalarda operatör nav'ını doğru geç.** `Notifications`, `Leaderboard`,
   `Settings`, `Profile`, `Tasks`, `Learn`, `Calendar` — hepsinde tek satırlık
   `? OPERATOR_NAV` dalı. Operatörün navigasyondan kopmasını bitirir.
8. **Bakiyem'deki yanıltıcı ödeme metnini düzelt** (`Balance.tsx:196-199`) — hakediş
   gerçekte elle havaleyle ödeniyor; metin bunu söylemeli.
9. **200 satır tavanını görünür kıl.** "Son 200 işlem gösteriliyor" notu; sessiz
   kesme kaldırılana kadar en azından dürüst olur.

### 6.2 Pahalı (yeni uç veya yeni ekran)

1. **Operatör hakediş görünürlüğü** (görev 12). `payout_ledger`'dan kütüphaneye özel
   okuma ucu (`hak edilen / ödenen / bakiye / son havaleler`) + Bakiyem'de bir bölüm.
   Yetki modeli hazır; yeni uç + tenant kontrolü + ekran işi.
2. **"Kayıt ara / bilet sorgula" ekranı** (görev 15). Öğrenci adı veya bilet koduyla
   arama; `PENDING_PAYMENT` dahil tüm durumları, sebebiyle birlikte gösteren uç.
   KVKK açısından alan seçimi dikkat ister (yalnız ad + durum + tutar).
3. **Yoklama geri alma** (görev 16). Emanet serbest bırakma damgası geri alınamaz
   olduğu için bu **saf UI işi değil**: ya "yanlış yoklama" için düzeltme kaydı +
   admin onayı, ya da `released_at` yazılmadan önce kısa bir geri alma penceresi
   tasarlanmalı. Para güvenliği kararı gerektirir → ayrı paket.
4. **Tek rezervasyon iptali/iadesi (operatör tarafı)** (görev 17). İş kuralı kararı
   önce: operatör tek başına iade edebilir mi, yoksa talebi admin'e mi açar?
   Mevcut 24 saat kuralıyla ve `REFUND_WINDOW_HOURS` ile uyumlu olmalı.
5. **Anlık doluluk ekranı** (görev 4). "Şu an içeride N/M kişi" + gün boyu doluluk
   şeridi. Sayım mantığı `library_capacity`'de var; operatör ucu + ekran yazılmalı.
6. **Operatör bildirimleri.** Şu an sistemde `role_id=4`'e giden **tek bir bildirim
   yok** (`services/` genelinde LIBRARY_OPERATOR'a `notify` çağrısı bulunamadı).
   Yeni ödeme/rezervasyon/iptal olduğunda operatöre bildirim, "listeyi yenile"
   alışkanlığını bitirir.
7. **Operatör ekranlarına DataTable + URL state.** Hacim büyüdüğünde şart; bugün
   erken. Önce (6.1/1-3) yapılmalı.

### 6.3 Gereksiz (bizim ölçeğimizde gerek yok)

1. **Operatör için rol/izin matrisi.** Admin'deki `permissions` modelinin operatöre
   taşınması — bir kütüphanede tek operatör hesabı varken karmaşıklık katar.
2. **Operatöre özel denetim (audit) arayüzü.** Kayıt tutulması yararlı, ama operatöre
   ayrı bir "denetim kayıtlarım" ekranı bu ölçekte gereksiz.
3. **Çoklu operatör/vardiya yönetimi, vardiya devir ekranı.**
4. **Slot bazlı rezervasyon motoru** (30'ar dakikalık ızgara, koltuk numarası).
   Kontenjan modeli bu ölçekte yeterli; koltuk numarası fiziksel operasyonu
   zorlaştırır.
5. **Operatöre gelişmiş raporlama/grafik paneli.** "Bu ay ne kazandım" + işlem dökümü
   yetiyor; Pareto/kohort analizi bu hacimde gürültü.
6. **Operatör mobil uygulaması.** Web QR tarayıcı + manuel fallback yeterli çalışıyor.

---

## 7. Güvenlik notu: tenant sızıntısı riski

**Ölçüm sonucu: operatör tarafında bilinen bir tenant sızıntısı bulunmadı.** İP-3'ün
getirdiği kapılar operatör yüzeyinde tutarlı biçimde uygulanmış:

| Kapı | Uygulama | Kanıt |
|------|----------|-------|
| Onay kapısı (`ACTIVE` değilse yönetim yok) | Ortak dependency, endpoint gövdesinden ÖNCE; allowlist (fail-closed) | `backend/api/deps.py:173-212`; kablolama: `library_exams.py:120`, `study_reservations.py:66`, `libraries.py:274` |
| Tenant kontrolü — deneme oturumları | Yabancı kütüphane **404** (403 değil): varlık sızmaz | `library_exams.py:79-93` (+ `not_found_detail` kaynağa göre) |
| Tenant kontrolü — çalışma rezervasyonları | Aynı desen, 404 | `study_reservations.py:39-45`; `study_reservation_service.py:717-729` |
| Tenant kontrolü — kütüphane profili/para | Aynı desen, 404 | `libraries.py:92-104`, `:232-243`, `:277-320`, `:386-420` |
| Cevap anahtarı | Operatöre **hiçbir listede** dönmez (`include_answer_key=isinstance(user, Admin)`) | `library_exams.py:134-137,153-155,171-173,188-190` |
| Mesajlaşma | Operatör yalnız kendi kütüphanesiyle **gerçek ilişkisi olan** öğrenciye yazabilir | `services/messaging_service.py:45` |
| Oturum sonlandırma | Şifre değişimi/silme tüm rollerde `auth_version` ile anında geçersizleştirir | `backend/api/deps.py` + `auth_service` |

Bu iddialar gerçek PostgreSQL entegrasyon testleriyle destekleniyor (kaynak sözleşmesi
değil, davranış testi):

- `backend/tests/integration/test_ip3_operator_active_gate_pg.py` — 16 senaryo:
  PENDING/REJECTED/HIDDEN operatör hiçbir yönetim ucunu kullanamıyor, silinmiş
  kütüphane 404, silinmiş hesap 401, **yabancı oturumda varlık sızmıyor**, yabancı
  oturum PATCH ile değiştirilemiyor, admin aynı rotalarda 403 almıyor.
- `backend/tests/integration/test_ip3_operator_messaging_pg.py` — 13 senaryo:
  ilişkisiz hedefte kimlik sızmıyor, başka kütüphanenin ilişkisi kapı açmıyor.
- `backend/tests/integration/test_ip3_answer_key_pg.py` — 6 senaryo: cevap anahtarı
  public listede, öğrenci biletinde ve **operatör yönetim listesinde** yok.

**Ancak üç nokta dikkat gerektiriyor (sızıntı değil, kalıntı risk):**

1. **Operatör aksiyonları audit'e yazılmıyor.** Yoklama doğrulama (para serbest
   bırakır), oturum iptali (toplu iade tetikler) ve kontenjan değişikliği
   `audit_logs`'a düşmüyor. Kurye saha aksiyonları İP-3'te audit'e bağlanmıştı
   (`delivery_stop.deliver` vb.); operatör aynı sınıfta para etkisi doğuruyor ama
   izi yalnız `attended_by_operator_id` kolonunda. Bir hesap ele geçirilirse "kim,
   ne zaman, hangi girişi doğruladı" sorusunun cevabı zayıf.
2. **Yoklamanın geri alınamaz olması** (görev 16) güvenlik değil operasyon riski
   ama para ile birleştiği için burada anılmalı: yanlış okutma = kütüphaneye
   haksız hak ediş, öğrenciye iade hakkının kaybı. Bugün düzeltme yolu **yok**.
3. **Ortak sayfaların rol-agnostik olması** yetki açığı değil (backend uçları rolü
   ayrıca denetliyor), ama operatörün `/takvim`, `/talepler`, `/ders-talepleri/:id`
   gibi kendisiyle ilgisiz ekranlara girip boş/kırık yüzey görmesi, panelin
   sınırlarının UI'da net çizilmediğini gösteriyor. Bu, ileride bir ekran yanlışlıkla
   rol kapısız açıldığında hatanın fark edilmesini zorlaştırır.

---

## Ek: bu raporda kanıt olarak kullanılan dosyalar

**Frontend:** `lib/nav.ts`, `lib/routes.ts`, `lib/roles.ts`, `App.tsx`,
`routes/ProtectedRoute.tsx`, `pages/dashboards/OperatorHome.tsx`,
`pages/dashboards/OperatorLibrary.tsx`, `pages/dashboards/OperatorSessions.tsx`,
`components/ExamSessionsManager.tsx`, `components/QrScanner.tsx`,
`components/DashboardShell.tsx`, `components/DashboardHeader.tsx`, `pages/Balance.tsx`,
`pages/Settings.tsx`, `pages/Calendar.tsx`, `pages/Demands.tsx`,
`pages/Notifications.tsx`, `pages/Leaderboard.tsx`, `pages/Tasks.tsx`,
`pages/Learn.tsx`, `pages/Profile.tsx`, `hooks/useLibraries.ts`,
`hooks/useLibraryExams.ts`, `hooks/useStudy.ts`,
`components/admin/data-table/DataTable.tsx`, `components/admin/ui/PageState.tsx`.

**Backend:** `api/deps.py`, `api/routers/library_exams.py`,
`api/routers/study_reservations.py`, `api/routers/libraries.py`,
`api/routers/payouts.py`, `api/routers/payout.py`, `api/routers/auth.py`,
`services/library_exam_service.py`, `services/study_reservation_service.py`,
`services/library_service.py`, `models/library_exam.py`,
`tests/integration/test_ip3_operator_active_gate_pg.py`,
`tests/integration/test_ip3_operator_messaging_pg.py`,
`tests/integration/test_ip3_answer_key_pg.py`.
