# İP-B1 — Tasarım dili, özellik eşlemesi ve panel kabuğu

**Dal:** `feat/panel-tasarim` (taban `main` @ `2442e8c`) · **Worktree:**
`C:\Users\kiyar\Desktop\adana-tasarim` · **Tarih:** 21 Ağustos 2026

Bu paket B serisinin ilkidir: ekran göçü yok, envanter + karar + kabuk var.
Çıktılar:

| Görev | Çıktı |
|---|---|
| 1 | Yetenek envanteri ve Medusa eşlemesi (§1) — paketin en önemli bölümü |
| 2 | Çakışmalar, seçenekler, tavsiyeler — **karar bekleyenler işaretli** (§2) |
| 3 | `docs/tasarim-dili.md` (ayrı dosya) |
| 4 | Panel kabuğu + kırmızı matris + eşik kanıtı (§4) |
| 5 | Gerçek Chrome turu (§5) |
| 6 | B serisi yol haritası (§6) |

---

## 1. Görev 1 — Yetenek envanteri ve Medusa eşlemesi

**Yöntem.** Başlangıç noktası `frontend/src/__guards__/uiBaseline.test.ts`ün
işaret ettiği `OLCUM_TABANI` (109 dosya) idi, ama envanter **dosya bazlı
değil yetenek bazlıdır**: bir dosya birden çok yetenek taşıyabiliyor
(`AdminStore.tsx` altı yüzey), bir yetenek birden çok dosyaya yayılabiliyor
(dağıtım: yedi ekran + iki saha ekranı). Kaynaklar: `adminNavigation.ts`
(20 alan), `App.tsx` rota ağacı (44 panel rotası), `lib/routes.ts`,
`frontend/CLAUDE.md`, kök `CLAUDE.md` ve üç Medusa karşılaştırma belgesi.

**Sayı.** 58 yetenek. Dağılım: **Taşı** 17 · **Uyarla** 21 · **Yeni tasarla** 20.
Yani panelin **%64'ünün** Medusa'da hazır bir deseni yok ya da deseni bizim
verimize göre değişiyor. Bu, dilin neden "Medusa + mobil uzantısı" olarak
tanımlandığının sayısal karşılığıdır (§2 · Ç-1).

Karar sözlüğü:

- **Taşı** — Medusa'nın deseni doğrudan benimsenir.
- **Uyarla** — desen var ama bizim veri/iş kuralımıza göre değişir.
- **Yeni tasarla** — Medusa'da karşılığı yok; **aynı dilde** kurulur
  (hangi Medusa deseninin analog olduğu "Medusa'da nasıl" sütununda yazılı).

### 1.1 Platform

| # | Bizdeki yetenek | Medusa'da var mı | Medusa'da nasıl | Karar | Not |
|---|---|---|---|---|---|
| P1 | **Genel bakış** — platform sağlığı, bekleyen iş sayaçları, kullanıcı metrikleri (`/yonetim`) | Yok | Medusa'nın giriş ekranı yok; panel doğrudan bir listeye açılıyor | **Yeni tasarla** | Analog: liste sayfasının üst "özet şeridi". Kart yerine çizgiyle ayrılmış metrik satırı (tasarım dili §3.2) |
| P2 | **Kullanıcı listesi** — ADMIN+TUTOR+CLIENT tek liste (UNION ALL), arama + rol/durum filtresi + sıralama + sayfalama | Kısmen | `customers` liste ekranı: arama, grup/kayıtlı filtresi, sayfalama. Tek tip kullanıcı | **Uyarla** | Bizde üç rol tek listede; Medusa'nın "filtre ekle" menüsü rol filtresi için doğrudan uygun |
| P3 | **Kullanıcı detayı** (`/yonetim/kullanicilar/:role/:id`) | Kısmen | `customers/:id` bölümlü detay sayfası + `CustomerOrderSection` | **Uyarla** | Bizde sipariş geçmişi yok (tur 2 · GEREKLİ #14); bölümlü detay anatomisi (tasarım dili §6) buraya birebir oturur |
| P4 | **Admin şifre sıfırlama** (backend hazır, UI yok) | Yok | — | **Yeni tasarla** | Detay sayfasının "Tehlikeli işlemler" bölümü + onay penceresi. Tur 2 · GEREKLİ #15 (~2 saat) |
| P5 | **Ayarlar — ödeme kolu kapıları** (gerekçe zorunlu, audit'li) | Kısmen | Ayarlar bölümü var ama ödeme sağlayıcı bölge bazlı; kol kavramı yok | **Uyarla** | Ayarlar alt sayfası (tasarım dili §9) |
| P6 | **Ayarlar — özellik bayrakları** (DB tabanlı, gerekçeli, audit'li) | Yok | Medusa'nın flag'leri `.env` sabiti | **Yeni tasarla** | Ayarlar alt sayfası; satır içi anahtar + gerekçe penceresi |
| P7 | **Hata çözme** — çözülemeyen para kayıtları + tavana çarpmış bildirim işleri, yeniden kuyruğa alma | Yok | — | **Yeni tasarla** | İki ayrı kuyruk = iki liste sayfası anatomisi. Boş durum burada **iyi haberdir** ("kuyruk temiz") ve öyle yazılmalı |
| P8 | **Bildirimler** (zil + yan panel, okunmamış sayacı) | Var | Sağ üstte ikon → yan pencere | **Taşı** | Kabukta yapıldı (§4) |
| P9 | **Tema açık/koyu/sistem** | Var | Profil menüsünden | **Taşı** | Kabukta yapıldı (§4). Panelde bugüne dek "sistem" seçilemiyordu |
| P10 | **Komut penceresi + klavye kısayolları** | Var | `Ctrl+K` + `G`+harf, tooltip'te gösterilen kısayol | **Taşı** | Kabukta yapıldı (§4); mekanizma görev modülünün paletinden taşındı |
| P11 | **Katlanabilir gezinme çubuğu** | Var | Katlanabilir | **Taşı** | Kabukta yapıldı (§4) |
| P12 | **Kişiselleştir** — rol bazlı navbar/kenar kısayol düzeni (`PersonalizeModal`) | Yok | — | **Yeni tasarla** | Kapsam notu: bu yüzey `DashboardShell`e ait; panel kabuğu artık `DashboardHeader` taşımadığı için panelden erişilemiyor (§4.4 · bilinen sınır) |

### 1.2 Eğitim

| # | Bizdeki yetenek | Medusa'da var mı | Medusa'da nasıl | Karar | Not |
|---|---|---|---|---|---|
| E1 | **Eğitmen ilanı onay/red/askı** — DRAFT→PENDING→APPROVED/REJECTED/SUSPENDED FSM, gerekçeli red | Yok | Medusa'da tedarikçi/satıcı onayı kavramı yok | **Yeni tasarla** | Analog: **durum filtreli liste + satır aksiyonu + gerekçe penceresi**. Bekleyen kuyruğu varsayılan sekme olmalı |
| E2 | **Diploma doğrulama** — belge görüntüleme, e-Devlet karşılaştırması | Yok | — | **Yeni tasarla** | Analog: **detay sayfası + yan sütunda belge önizleme**. Belge `private/` imzalı adresle geliyor — önizleme ömrü kısa, arayüz bunu söylemeli |
| E3 | **Rezervasyon yönetimi** — iptal, ihtilaf | Kısmen | `orders` liste + detay; ama ders/zaman kavramı yok | **Uyarla** | Liste anatomisi taşınır, sütunlar bizim (eğitmen/öğrenci/tarih/ücret/durum) |
| E4 | **Öğrenci talepleri (demand)** — açık talepler ve eğitmen yanıtları, iptal gerekçesi | Yok | — | **Yeni tasarla** | Analog: liste + detay; talep bir "sipariş öncesi" nesne, detay anatomisi §6 |

### 1.3 Ticaret — mağaza

| # | Bizdeki yetenek | Medusa'da var mı | Medusa'da nasıl | Karar | Not |
|---|---|---|---|---|---|
| T1 | **Ürün listesi** — arama (300 ms debounce, URL'de), kategori filtresi, **sunucu taraflı sıralama göstergesi**, sayfalama | Var | `products` listesi: arama, "filtre ekle", sayfalama. **Sıralama YOK** | **Uyarla** | Medusa'nın araç çubuğu alınır, **sıralama bizde kalır** (bizim artımız). `renderMobileRow` bugün kullanılmıyor — B2'de bağlanır |
| T2 | **Ürün oluşturma/düzenleme** — tek uzun form + katlanır bölümler (künye, varyantlar), URL'siz pencere | Var | **`FocusModal` + `ProgressTabs`**, üç adım (Detaylar→Düzenle→Varyantlar), görsel yükleme birinci adımda | **Taşı** | Serhat'ın özellikle istediği iki şeyden biri. Kitap künyesi bizim dördüncü koşullu adımımız olur |
| T3 | **Çoklu ürün görseli** (`uploadProductImages`/`deleteProductImage` **yazılmış, çağrılmıyor**) | Var | Oluşturma akışının birinci adımında sürükle-bırak | **Taşı** | Yarım özellik; T2 ile birlikte kapanır |
| T4 | **Varyant sistemi** — eksen (`VARIANT_AXES` sabit + CHECK), grup, SKU/fiyat/stok | Var | Varyantlar adımı **toplu düzenleyici tablo** (satır=varyant, sütun=SKU/stok/fiyat) + DataGrid | **Uyarla** | Eksenlerimiz sabit ve kitap kuralı `variant_service` kapısında — Medusa'nın serbest opsiyon motoru alınmaz, **ızgara arayüzü alınır** |
| T5 | **Varyant grubu düzenle/sil** (`updateVariantGroup`/`deleteVariantGroup` yazılmış, çağrılmıyor) | Var | — | **Uyarla** | Yarım özellik |
| T6 | **Kategoriler** — ağaç, varsayılan KDV oranı mirası | Var | Kategori ekranı (ağaç) | **Uyarla** | KDV mirası bizim; Medusa'da vergi ayrı modül |
| T7 | **Toplu CSV içe aktarma** | Var | Ürün ekranında içe/dışa aktarma | **Uyarla** | Bizde tek yönlü (import); dışa aktarma yok |
| T8 | **Sipariş listesi** — yalnız durum filtresi; **arama yok, sayfalama yok** (ilk 100 + amber uyarı) | Var | `orders` listesi: `q` arama, sıralama, `offset` sayfalama, tarih filtresi | **Taşı** | Tur 2 · GEREKLİ #3, #4. Liste anatomisi bunu doğal olarak kapatır |
| T9 | **Sipariş detay sayfası** — **YOK**, tüm bilgi ve aksiyon liste satırında | Var | Bölümlü detay: genel, özet, ödeme, fulfillment, müşteri + ~15 aksiyon | **Taşı** | Tur 2 · GEREKLİ #2. Detay anatomisi §6 |
| T10 | **Sipariş durum geçmişi** (`OrderStatusHistory` **yazılıyor, gösterilmiyor**) | Kısmen | Zaman çizelgesi istemcide birleştirilir; not özelliği kodda devre dışı | **Uyarla** | Bizde gerçek tablo var — Medusa'dan iyi. Detayın standart bölümü olur |
| T11 | **Admin sipariş iptali** (backend hazır, UI yok) | Var | Detay sayfasında aksiyon | **Taşı** | Tur 2 · GEREKLİ #5 |
| T12 | **İade (RMA) kuyruğu** — talep, CAYMA otomatik onayı, admin onay/ret | Kısmen | Draft-and-confirm iade akışı; cayma hakkı kavramı yok | **Uyarla** | Cayma kuralı arayüzde **görünür** olmalı: CAYMA satırında "Reddedilemez" rozeti |
| T13 | **İade fiziksel kabul** (backend hazır, UI yok — **stoğun geri döndüğü tek nokta**) | Var | "Receive items", kalem+miktar, hasarlı ayrımı | **Taşı** | Tur 2'nin **en acil** kalemi (#1). Adımlı pencere adayı: kalem sayımı + hasarlı ayrımı + onay |
| T14 | **MANUAL_REVIEW iade kuyruğu** | Yok | — | **Yeni tasarla** | Analog: ikinci bir liste sekmesi; boş durum "iyi haber" |
| T15 | **Kuponlar** — liste + aktif/pasif anahtarı; **düzenleme yok, tarih alanı yok** | Var | Promosyon: 3 adımlı sihirbaz, tam düzenleme formu | **Uyarla** | Tur 2 · GEREKLİ #8, #9. Bizim kupon modeli çok daha basit — sihirbaz **gerekmez**, çekmece yeter (tasarım dili §7) |
| T16 | **Stok hareket defteri** — append-only, salt okunur, trigger korumalı | Kısmen | Envanter hareketleri var ama defter garantisi yok | **Uyarla** | Salt-okunurluk arayüzde de görünür olmalı: satır aksiyonu YOK, "Bu defter değiştirilemez" notu |
| T17 | **"En düşük 30 gün" yasal referans fiyat** (`ProductPriceHistory`) | Yok | — | **Yeni tasarla** | Ürün detayında fiyat bölümünün yanında küçük bir geçmiş grafiği/satırı |
| T18 | **Ürün yorumu moderasyonu** (`deleteProductReview` yazılmış, çağrılmıyor) | Yok | Medusa'da ürün yorumu yok | **Yeni tasarla** | Şikâyet ekranıyla aynı desen (moderasyon kuyruğu) |
| T19 | **Hakedişler** — eğitmen/kütüphane alacakları, elle ödeme kaydı | Yok | Medusa'da pazaryeri/alt üye yok | **Yeni tasarla** | Analog: liste + satır aksiyonu ("Ödendi işaretle" + dekont referansı). Para yüzeyi: onay penceresi zorunlu |

### 1.4 Ticaret — envanter ve paketleme

| # | Bizdeki yetenek | Medusa'da var mı | Medusa'da nasıl | Karar | Not |
|---|---|---|---|---|---|
| N1 | **Envanter genel bakış** | Kısmen | `inventory` listesi | **Uyarla** | |
| N2 | **Sayım oturumu listesi** + **detay** (fark uygulama, iptal, açıklama) | Yok | Medusa'da stok sayımı (cycle count) kavramı yok | **Yeni tasarla** | Analog: **liste + gerçek detay sayfası**; detayda satır bazlı sayım girişi → **DataGrid** (Medusa'nın varyant ızgarası) en yakın desen |
| N3 | **Hasarlı stok kayıtları** (elle tablo; **filtresi URL'e hiç yazılmıyor**) | Yok | — | **Yeni tasarla** | Liste anatomisi + URL filtresi. Bugünkü elle tablo `DataTable`a taşınır |
| N4 | **Paketleme kuyruğu** | Yok | Medusa'da fulfillment var ama istasyon kavramı yok | **Yeni tasarla** | Analog: liste; ama asıl ekran istasyon (N5) |
| N5 | **Paketleme istasyonu** — paket aç, kalem kalem QR okut, kutuyu kapat | Yok | — | **Yeni tasarla** | **Tek görevli tam ekran** yüzey: `FocusModal` mantığı ama bir sayfa. Elde tarayıcı/telefon var → dokunmatik hedefler ve büyük tipografi kuralı burada masaüstünde de geçerli |
| N6 | **Paket etiketi baskısı** (print CSS, QR boyut koruması) | Yok | Medusa'da PDF/baskı hiç yok (`"pdf"` sıfır sonuç) | **Yeni tasarla** | **Ekran dili baskıya uygulanamaz**: baskı katmanları nöbetçide de ayrı istisna listesinde (`PRINT_LAYERS`). Kendi bölümünü hak ediyor |
| N7 | **İade (geri dönüş) kuyruğu** — depoya kabul gerekçesi | Kısmen | Return receive | **Uyarla** | T13 ile aynı akışın istasyon tarafı |

### 1.5 Ticaret — kendi filo teslimatı

Bu blok panelin **Medusa'da hiç karşılığı olmayan en büyük** parçasıdır.

| # | Bizdeki yetenek | Medusa'da var mı | Medusa'da nasıl | Karar | Not |
|---|---|---|---|---|---|
| D1 | **Bugün kokpiti** — rota sağlık şeridi (`/health`), istisna kuyruğu, kapasite şeridi, günün turları | Yok | — | **Yeni tasarla** | Analog yok; en yakını "genel bakış". **Kart enflasyonu riski en yüksek ekran** — kural §3.2 burada en sıkı uygulanmalı |
| D2 | **Sipariş kuyrukları** (`?kuyruk=hazirlik\|hazir\|dis-kargo`) + tura ekle + "Kargola" | Kısmen | Fulfillment oluşturma | **Uyarla** | Kuyruk = Medusa'nın sekmeli listesi; aksiyonlar bizim |
| D3 | **Turlar arşivi** + **tur detayı** — sürükle-bırak durak sıralama, harita (polyline), teslimat tercihi rozeti, çoklu paket rozeti | Yok | — | **Yeni tasarla** | Detay anatomisinin (§6) **tam genişlik istisnası**: harita metin değil mesafe gösterir |
| D4 | **Rota optimizasyonu** — "Günü Optimize Et", sağlayıcı rozeti (yol ağı/yaklaşık), sapma (detour) işareti | Yok | — | **Yeni tasarla** | Uzun süren iş: **iyimser UI yasak**, ilerleme ve sonuç açıkça gösterilmeli; sağlayıcı düşüşü sessiz kalmamalı (kod tarafında zaten öyle) |
| D5 | **Performans** — Pareto çubukları, 👎 yorum → sipariş linki | Yok | — | **Yeni tasarla** | Grafik dili ayrı bir karar; B serisinde `dataviz` ilkeleriyle ele alınmalı |
| D6 | **Kurye CRUD** (isim/vesikalık/plaka) | Yok | — | **Yeni tasarla** | Liste + çekmece (8 alandan az) |
| D7 | **Araç CRUD** (`max_stops` NULL = platform varsayılanı) | Yok | — | **Yeni tasarla** | NULL'un anlamı arayüzde yazılmalı — "boş = platform varsayılanı (N)" |
| D8 | **Kapalı günler** | Yok | — | **Yeni tasarla** | Takvim yüzeyi |
| D9 | **Toplama noktaları** (`pickup_points`, BASE/SUPPLIER) | Yok | — | **Yeni tasarla** | Tanımsızsa "Günü Optimize Et" 409 dönüyor — **bu boşluk ekranda görünmeli**, hata anında değil |
| D10 | **Dağıtım tahtası** | Yok | — | **Yeni tasarla** | |
| D11 | **Saha ekranı** `/dagitim/:id` — mobil, QR, OTP, foto PoD, canlı konum ping | Yok | — | **Yeni tasarla** | **Kabuk YOK ve olmamalı**: tek elle, güneş altında, tek görev. Kendi mobil dili var; §0'ın "mobilde bizim desenimiz" kuralının en uç örneği |
| D12 | **Zimmet ekranı** `/dagitim/:id/zimmet` | Yok | — | **Yeni tasarla** | Aynı aile |
| D13 | **Teslimat sözü + bölge** (16:00 cutoff, ilçe listesi otoritesi) | Yok | — | **Yeni tasarla** | Ayarlar alt sayfasına taşınacak (tur 2 · GEREKLİ #12, #13) |

### 1.6 Operasyon — kütüphaneler ve operatör

| # | Bizdeki yetenek | Medusa'da var mı | Medusa'da nasıl | Karar | Not |
|---|---|---|---|---|---|
| K1 | **Kütüphane CRUD** — konum (harita), çalışma saatleri, olanaklar, durum, saatlik ücret | Yok | Medusa'da üçüncü bir arz tarafı varlık yok | **Yeni tasarla** | Alan sayısı 8'i aşıyor → **tam ekran pencere + adımlar** (tasarım dili §7-8) |
| K2 | **Operatör hesapları** (kütüphane başına oluştur/sil) | Kısmen | Kullanıcı daveti (`Invite`) | **Uyarla** | Bizde davet yok, doğrudan hesap; Medusa'nın davet deseni **gereksiz** (tur 2) |
| K3 | **Kütüphane ödeme bilgileri** (IBAN/TCKN, at-rest şifreli) | Yok | — | **Yeni tasarla** | PII yüzeyi: maskeli gösterim + "değiştir" akışı |
| K4 | **Deneme oturumu yönetimi** (CRUD + katılımcı listesi; admin ve operatör ORTAK bileşen) | Yok | — | **Yeni tasarla** | Aynı bileşenin iki rolde farklı yetkiyle görünmesi — dilin "aynı ekran, farklı yetki" kuralı yazılmalı |
| K5 | **Deneme katalogları + cevap anahtarı** | Yok | — | **Yeni tasarla** | Cevap anahtarı `private/` — operatöre hiçbir listede verilmez; arayüz bu sınırı göstermeli |
| K6 | **Operatör paneli** (`/kutuphanem`, `/oturumlar`) + **birleşik QR doğrulama** | Yok | — | **Yeni tasarla** | `DashboardShell` kullanıyor, panel kabuğunu DEĞİL. Mobil-önce; **alt gezinme çubuğu doğru desen** (3-4 öğe) — §2 · Ç-1 |

### 1.7 Güvenlik

| # | Bizdeki yetenek | Medusa'da var mı | Medusa'da nasıl | Karar | Not |
|---|---|---|---|---|---|
| G1 | **Ad değişikliği kuyruğu** | Yok | — | **Yeni tasarla** | Moderasyon kuyruğu deseni |
| G2 | **Şikâyet moderasyonu** (+ gezinmede açık şikâyet rozeti) | Yok | — | **Yeni tasarla** | Rozet kabukta korundu (§4) |
| G3 | **Denetim kaydı** — before/after JSONB, redaction, filtreli liste | Yok | Medusa'da audit log **hiç yok** | **Yeni tasarla** | Salt-okunur liste + genişleyen fark görünümü. **Bizim artımız**; kaybedilmemeli |
| G4 | **Yetki yönetimi** — 28 izin, 5 sistem rolü, atamalar | Kısmen | `@medusajs/rbac` **feature-flag arkasında, varsayılan KAPALI** | **Yeni tasarla** | Medusa'nınki üretimde çalışmıyor; kopyalanacak bir desen yok. İzin matrisi → **ızgara** (DataGrid analogu) |
| G5 | **İçerik gizleme** (`setContentHidden` yazılmış, çağrılmıyor) | Yok | — | **Yeni tasarla** | Yarım özellik |

### 1.8 Bizde olup Medusa'dan **iyi** olanlar — kaybedilmeyecekler

Bunlar kilitli kararların gerekçesidir; dil hiçbirini bozamaz.

| # | Yetenek | Neden Medusa'dan iyi |
|---|---|---|
| İ1 | **`renderMobileRow` mobil kart deseni** | Medusa'nın panelinde mobil düzen **yok** (`sm:`/`md:`/`lg:` araması sıfır sonuç). Operatör ve kurye telefondan çalışıyor |
| İ2 | **Açık satır aksiyonları** (üç nokta menü değil) | Dokunmatik hedef; hover-only aksiyon yok |
| İ3 | **Sunucu taraflı sıralama + gösterge** (`manualSorting`) | Medusa'nın ana listelerinde sıralama hiç yok |
| İ4 | **`EmptyState`/`ErrorState`/`PageSkeleton` üçlüsü tutarlı** | "Hata ≠ boş ekran" kuralı her sorguda uygulanıyor |
| İ5 | **`useModalA11y`** — focus trap, ESC, odak geri dönüşü, scroll kilidi | Medusa bunu Radix'ten alıyor; biz yazdık ve çalışıyor |
| İ6 | **Dar kapsamlı a11y lint** (8 gerçekten uygulanan kural) | "recommended açıp CI'ı gürültüye boğmak" yerine uygulanan kurallar |
| İ7 | **Nöbetçi eşikleri** (overlay 0, pencere durumu 0, adsız kontrol, ham düğme) | Medusa'da böyle bir ölçüm katmanı yok; borcun sessizce büyümesini engelliyor |
| İ8 | **Türkçe arayüz, tek dil** | Medusa i18next taşıyor; tek dilli ürün için doğru sadelik |

---

## 2. Görev 2 — Çakışmalar · **KARAR BEKLİYOR**

Hiçbiri tek başıma karara bağlanmadı. Her biri için seçenekler, bedelleri ve
tavsiyem yazılı.

### Ç-1 · Mobil: Medusa'nın mobil düzeni yok — **KARAR BEKLİYOR**

**Durum.** Medusa masaüstü-öncelikli; bizim operatör ve kuryemiz telefondan
çalışıyor ve `renderMobileRow` bu turda ilk kez kullanıma girdi.

**Seçenekler.**

| | Seçenek | Bedeli |
|---|---|---|
| A | **Tek dil, masaüstü-öncelikli** (Medusa'yı bire bir) | Operatör/kurye telefonda yatay kaydırmaya mahkûm; `renderMobileRow` ölü kod olur |
| B | **İki katmanlı dil**: masaüstü Medusa, mobil bizim | Her liste iki yüzey; bakım maliyeti ~%25 fazla |
| C | **Mobil-öncelikli tek dil** | Masaüstünde bilgi yoğunluğu düşer; 20 sütunlu dağıtım tablosu kart olarak okunmaz |

**Tavsiyem: B.** Ölçülebilir gerekçe: panelin 58 yeteneğinin **13'ü** (D11-D12
saha, K6 operatör, N5 paketleme istasyonu, D1-D2 kuyruklar…) sahada telefondan
kullanılıyor; 45'i masaüstünde. İkisi de birinci sınıf.

**Bedeli nasıl sınırlanır** (bu tur uygulandı): mobil yüzey ekran başına elle
yazılmaz, **`DataTable`ın `renderMobileRow` yuvasından** gelir — yani ekran
"kart nasıl görünsün" der, "mobil düzen nasıl kurulsun" demez.

**Bu turda uygulanan kısmı:** kabuk (§4.3 tasarım dili) — rail gizlenir,
çekmece açılır, **alt gezinme çubuğu yapılmaz**. Gerekçe: yönetim gezinmesi
20 öğe, alt çubuk en fazla 5 yuva. Alt çubuk 3-5 öğeli **rol panellerinin**
(operatör, kurye) doğru deseni ve o paketlerde ayrıca ele alınacak.

**Karar bekleyen kısım:** operatör ve kurye panellerinde alt gezinme çubuğuna
geçilecek mi? Onlar `DashboardShell` kullanıyor, bu kabuğu değil — yani ayrı
bir paket ve ayrı bir onay.

### Ç-2 · Satır aksiyonları: üç nokta mı, açık düğme mi — **KARAR BEKLİYOR**

**Durum.** Medusa üç nokta menü (`ActionMenu`) kullanıyor; kilitli kararımız
açık düğme (dokunmatik).

**Seçenekler.**

| | Seçenek | Bedeli |
|---|---|---|
| A | **Her yerde açık düğme** (bugünkü karar) | 4+ aksiyonlu satırda tablo kalabalıklaşır; sütun genişliği aksiyonlara gider |
| B | **Her yerde üç nokta** | Dokunmatikte iki dokunuş; hover-only keşif; kilitli kararın ihlali |
| C | **Melez: masaüstünde üç nokta, mobilde açık düğme** | Aynı yetenek iki farklı yerde — kullanıcı masaüstünde öğrendiğini telefonda bulamaz |
| D | **Melez: en fazla 2 açık düğme + fazlası üç noktada, her iki genişlikte aynı** | Uygulaması en zor; "hangi ikisi birincil" kararı ekran başına verilmeli |

**Tavsiyem: D.** Gerekçe: Ç-2'nin gerçek sorunu "menü mü düğme mi" değil,
**satır başına aksiyon sayısı**. Bugün panelde satır başına aksiyon sayısı 1-5
arasında değişiyor; 1-2 aksiyonlu satırda menü gereksiz bir dokunuş, 5
aksiyonlu satırda düğme dizisi tabloyu yiyor. D ikisini de çözer ve **tek
desendir** — C'nin "genişliğe göre farklı yer" sorununu üretmez.

**Not:** D, kilitli kararı **daraltır ama ihlal etmez** — birincil aksiyonlar
hâlâ açık düğmedir ve dokunmatik hedefleri korunur. Yine de kilitli karar
metnini değiştirdiği için **onay gerekiyor**; onay gelene kadar A yürürlüktedir.

### Ç-3 · Marka rengi: navy mi indigo mu — **KARAR BEKLİYOR**

`#1A365D` navy, `#F6AD55` turuncu ve `Figtree` **kod tabanında hiç geçmiyor**
(arama: `frontend/` ağacının tamamında sıfır sonuç). Panel bugün `indigo-600`
ve `Inter` kullanıyor.

Tavsiye ve gerekçeler `docs/tasarim-dili.md` §1.4'te. Özet: **nötr yüzey +
marka aksanı**; turuncu aksan değil **dikkat rengi** olmalı.

**Neden B1'de uygulanmadı:** aksanı yalnız kabukta çevirmek paneli yarı
lacivert yarı indigo bırakırdı. Değişiklik tek pakette, kabuk + ekranlar
birlikte yapılmalı. Token tek noktada (`--panel-accent`): karar verildiği gün
bir satır değişir.

### Ç-4 · Ayarlar bölümü: tek sayfa mı, alt gezinme mi — **KARAR BEKLİYOR**

Medusa'nın Ayarları ~15 alt sayfalı ayrı bir bölüm. Bizimki bugün tek sayfa
(ödeme kolları + bayraklar), ama tur 2 oraya **dört kalem daha** taşımayı
öneriyor (kargo ücreti, teslimat ilçeleri, vergi, e-posta şablonu).

- **A · Tek uzun sayfa + iç bağlantılar:** ucuz; ama 6 bölümden sonra
  kaydırma ekranı okunmaz kılar.
- **B · Alt gezinmeli bölüm (Medusa):** doğru ölçekleniyor; ama bugün 2
  bölüm için ağır durur.

**Tavsiyem: B, ama tetiklenmeli** — dördüncü bölüm eklendiğinde. Bugün A ile
devam etmek, üç ay sonra taşınacak bir yüzeyi iki kez yazmaktır; B'yi bugün
kurmak iki bölüm için fazla çerçeve. Karar noktası: **kargo/teslimat ayarları
paketi** (tur 2 · GEREKLİ #12-13) — o paket B'yi getirir.

### Ç-5 · Google Fonts: belge ile kod çelişiyor — **KARAR BEKLİYOR** (yeni bulgu)

`frontend/tailwind.config.js` içindeki yorum şöyle diyor:

> "Preset'in 'Roboto Mono'su geri alınıyor: font yüklü değil ve **KVKK gereği
> Google Fonts CDN'i kullanılmıyor**."

Ama `frontend/index.html:11-16` `fonts.googleapis.com`a `preconnect` yapıp
`Inter`ı oradan çekiyor. İkisi aynı anda doğru olamaz.

Bu bir tasarım meselesi değil **KVKK meselesi**: Google Fonts CDN'i her sayfa
yüklemesinde ziyaretçinin IP'sini üçüncü tarafa gönderir (Almanya'da bu
gerekçeyle tazminata hükmedilmiş emsal kararlar var). Seçenekler:

- **A · Fontu yerelleştir** (`Inter`ı `public/fonts`a indir, `@font-face` ile
  bağla). Bedeli: ~200 KB varlık + bir build adımı. Yorumdaki iddiayı gerçek
  yapar.
- **B · Yorumu düzelt** ve CDN kullanımını bilinçli kabul et. Bedeli: KVKK
  riski açıkta kalır.

**Tavsiyem: A.** Ayrıca `Figtree` eklenecekse (Ç-3) bu karar **önce**
verilmelidir — ikinci bir CDN fontu riski ikiye katlar.

Kapsam dışı olduğu için düzeltilmedi; `docs/teknik-borc.md`'ye yazılması
öneriliyor.

### Ç-6 · Sıralama: Medusa'da yok, bizde var — çakışma DEĞİL (kayıt)

Medusa'nın liste ekranlarında sıralama göstergesi yok. Bu bir çakışma değil,
bir **eksiklik**; bizimki korunur (İ3). Kayda geçiyorum çünkü "Medusa'yı izle"
kuralı körlemesine uygulanırsa bu yetenek sessizce silinebilir.

---

## 3. Görev 3 — Tasarım dili belgesi

`docs/tasarim-dili.md` yazıldı. On bir bölüm: dilin tanımı · renk/token ·
tipografi · boşluk ritmi ve düzen · kabuk · liste anatomisi (+ mobil) · detay
anatomisi · düzenleme yüzeyi · adımlı akış · ayarlar · ikonlar · değişmezler.

Her kuralın yanında gerekçesi var. Örnekler:

- **"Neden 16 değil de 24"** → §3: 16px "aynı cümlenin kelimeleri", 24px "iki
  ayrı cümle".
- **"Neden rail 264px"** → §4.1: en uzun etiket + ikon + rozet + dolgu 240'a
  sığıyor, 264 kırılma payı bırakıyor.
- **"Neden katlı genişlik 72"** → §4.1: 40px dokunma hedefi + 2×16px dolgu.
- **"Neden alt gezinme çubuğu yok"** → §4.3: 20 öğe, 5 yuva.
- **"Neden kartta gölge yok"** → §3.3: gölge "ayrı katman" der; kart ayrı
  katman değil.
- **"Neden `G`+harf, tek harf değil"** → §4.4: tek harf metin alanında yazmayı
  bozar.

---

## 4. Görev 4 — Panel kabuğu

### 4.1 Önce / sonra

| | Önce | Sonra |
|---|---|---|
| Üst | Genel site navbar'ı (`DashboardHeader`) — panelin parçası olmayan kategori/arama/rol ikonları | Panelin kendi üst şeridi: yol + `<h1>` + açıklama + birincil aksiyon yuvası + bildirim |
| Sol | Tek parça kenar çubuğu, yalnız gezinme | Üç bölgeli rail: **arama (⌘K)** · alanlar · **Ayarlar + profil** |
| Katlama | Yok | 264px ↔ 72px, tercih `localStorage`'da kalıcı |
| Arama / komut | Yok | `Ctrl+K` komut penceresi (izinden geçmiş alanlar) |
| Kısayol | Yok | `G` + harf (10 alan), girdi odaktayken devre dışı |
| Tema | Yalnız açık↔koyu geçişi; **"sistem" bir kez terk edilince seçilemiyordu** | Üç seçenekli `radiogroup` (Açık/Koyu/Sistem), profil menüsünde |
| Bildirim | Site navbar'ında | Panelin üst şeridinde — **gerçek** `NotificationsBell` (uydurma değil) |
| Kaydırma | Sayfa gövdesi | `h-dvh` + yalnız `<main>` kayar; rail ve üst şerit ekranda kalır |
| Renk | Ham Tailwind + elle `dark:` çifti | `--panel-*` token katmanı; kabukta `dark:` sınıfı **sıfır** |
| Ayarlar | Gezinme gruplarının içinde ("Platform") | Alt bölgede, gruplardan ayrı (ayarlar bir alan değil, bir kip) |

**Ekran içerikleri değişmedi.** `Outlet`in altındaki hiçbir ekran dosyası bu
pakette elden geçmedi; değişen dosyalar §4.5'te listeli.

### 4.2 Kırmızı matris

Testler kabuk kodundan **önce** yazıldı ve önce koşuldu
(`src/components/admin/layout/panelKabugu.test.tsx`, 15 test, hepsi gerçek DOM).

Ölçülen ilk koşum: **12 kırmızı / 3 yeşil.**

| # | Davranış | İlk koşum | Sonra |
|---|---|---|---|
| 1 | Gezinme bir `<nav>`tır ve adı vardır | ✅ zaten geçiyordu | ✅ |
| 2 | Bulunulan sayfa `aria-current="page"` taşır | ✅ zaten geçiyordu | ✅ |
| 3 | Gezinme üç bölgelidir (arama üstte, Ayarlar+profil altta) | ❌ | ✅ |
| 4 | Katlama düğmesinin erişilebilir adı var, durumu bildiriyor | ❌ | ✅ |
| 5a | Katlanınca rail daralır **ve tercih depoya yazılır** | ❌ | ✅ |
| 5b | Kaydedilen tercih **yeniden yüklemede geri okunur** | ❌ | ✅ |
| 6 | Katlı hâlde gezinme öğelerinin erişilebilir **adı kaybolmaz** | ❌ | ✅ |
| 7 | Profil menüsü üç temalı seçenek sunar, seçim store'a yazılır | ❌ | ✅ |
| 8 | `Ctrl+K` komut penceresini açar, pencere **etiketlidir** | ❌ | ✅ |
| 9 | Yazılan metin listeyi süzer, `Enter` o alana gezindirir | ❌ | ✅ |
| 10 | `Escape` komut penceresini kapatır | ❌ | ✅ |
| 11 | `G` sonra `K` kullanıcılar alanına gider | ❌ | ✅ |
| 12 | **Girdi odaktayken** kısayol dizisi başlamaz | ❌ | ✅ |
| 13 | Sayfa başına **tek** `<h1>`, bulunulan alanı adlandırır | ✅ zaten geçiyordu | ✅ |
| 14 | Bildirim alanı gerçek bir denetimdir (yer tutucu değil) | ❌ | ✅ |
| 15 | Hamburger etiketli çekmece açar (`role=dialog` + `aria-modal`) | ❌ | ✅ |
| 16 | **Aynı anda yalnız BİR gezinme öğesi etkin** | — (sonradan eklendi) | ✅ |

Üç maddenin baştan yeşil olması dürüstlük gereği yazılıdır: `<nav>`,
`aria-current` ve tek `<h1>` eski kabukta da doğruydu; bu paketin kazancı
değil, **korunduğunun kanıtıdır** (regresyon nöbetçisi).

Matris koşum sırasında **iki kez güçlendi** ve ikisi de kendi testimin kusuruydu
(kök CLAUDE.md §E/§I):

1. **Madde 5 yalancı yeşildi.** İlk yazımda tek bir test hem yazmayı hem
   okumayı iddia ediyordu: katla → `unmount()` → `render()` → hâlâ katlı.
   Ama `zustand/persist` hidrasyonu **modül ilk yüklendiğinde** bir kez olur;
   yeniden mount onu tekrarlamaz. Yani test aslında **bellekteki değeri**
   okuyordu ve depo boş olsa da geçerdi. Karışık sıralı koşum
   (`--sequence.shuffle --sequence.seed=555`) bunu yan etkisinden yakaladı:
   katlı durum sonraki testlere sızıyor ve "aria-current taşır" testini
   düşürüyordu (katlı railde etiket metni DOM'da yok → `textContent` boş).
   Düzeltme: `beforeEach`te store'u da sıfırla; testi **yazma** (5a) ve
   **okuma** (5b, `persist.rehydrate()` ile gerçek yenileme) diye ikiye böl.
   Sıra da önemliydi ve ölçüldü: `setState` kalıcı store'da depoya yazdığı
   için önce depoyu doldurup sonra `setState` çağırmak, az önce yazılan kaydı
   eziyordu (`{"state":{"katli":false}}`).
2. **Madde 16 hiç yoktu ve gerçek bir hata canlıydı** — turda ekran
   görüntüsünden yakalandı (§5).

### 4.3 Mutasyon provası

Sürücü: `scratchpad/drill_b1.py` — ortak `backend/scripts/mutation_drill.py`
**değiştirilmedi** (bu turun mutasyonları yalnız frontend'e dokunuyor). Güvenlik
kuralları aynısı: geri alma `git` ile değil dosyanın baytları belleğe alınıp
geri yazılarak; her mutasyondan sonra dosya SHA'sı başlangıçtakine eşit mi diye
doğrulanıyor; **yama tutmazsa prova başarısız sayılıyor**, sessizce atlanmıyor.
Her mutasyondan önce ayrıca **yeşil taban** ölçülüyor (mutasyondan önce testler
geçmezse "yakalandı" yazılamaz).

**Sonuç: 9/9 yakalandı.** Çalışma ağacı her provadan sonra bayt bayt
başlangıç hâline döndü (`git status` provalar öncesi ve sonrası aynı).

| # | Mutasyon | Kırdığı nöbetçi | Sonuç |
|---|---|---|---|
| M-B1-1 | Katlama tercihi artık depoya yazılmıyor (`partialize: () => ({})`) | kabuk 5a | ✅ yakalandı |
| M-B1-2 | Katlı railde ad kaynağı (`aria-label` + `title`) kaldırıldı | kabuk 6 | ✅ yakalandı |
| M-B1-3 | Komut penceresinden `aria-modal` kaldırıldı | kabuk 8 **+ `uiBaseline` etiketsiz overlay** (3 test) | ✅ yakalandı |
| M-B1-4 | Kısayol dizisi metin alanında da başlıyor | kabuk 12 | ✅ yakalandı |
| M-B1-5 | Tema seçeneklerinden "Sistem" çıkarıldı | kabuk 7 | ✅ yakalandı |
| M-B1-6 | `Ayarlar` tekrar orta bölgedeki gruplara girdi | kabuk 3 | ✅ yakalandı |
| M-B1-7 | Arama tetikleyicisi ortak `Button` yerine ham `<button>` | `uiBaseline` ham düğme eşiği | ✅ yakalandı |
| M-B1-8 | Yeni kabuk dosyası ölçüm tabanından çıkarıldı | `uiBaseline` `fazlaDosyalar` | ✅ yakalandı |
| M-B1-9 | İki alan aynı kısayol harfini aldı | `adminNavigation` kısayol tekilliği | ✅ yakalandı |

**Sürücünün kendi kusuru (raporlanıyor, §I):** ilk koşumda dört prova "yama
tutmadı" dedi. Sebep depo satır sonlarıydı — dosyalar **CRLF**, desenler
`
` ile yazılmıştı ve çok satırlı desenler hiç eşleşmiyordu. Sürücü bunu
sessiz bir atlama olarak değil **başarısız prova** olarak raporladığı için
görüldü; "eşleşmezse sessizce geç" yazılmış olsaydı dört mutasyon hiç
uygulanmadan "9/9 yakalandı" yazılabilirdi.

**M-B1-2'nin ilk hâli KAÇIRILDI ve bu bir bulgudur:** yalnız `aria-label`
kaldırıldığında test hâlâ geçiyordu, çünkü aynı öğede duran `title`
erişilebilir adı **ayakta tutuyordu**. Yani üretim davranışı doğruydu ama
mutasyon bir şey ayırt etmiyordu. Mutasyon, gerçek regresyonu (adsız ikon
bağlantısı) üretecek biçimde düzeltildi: ikisi birden kaldırıldı.

### 4.4 Eşiklerin bozulmadığı kanıtı

`node frontend/scripts/ui-baseline-sayim.mjs` çıktısı (İP-B1 sonrası):

| Ölçüm | Eşik | Önce | Sonra | Durum |
|---|---|---|---|---|
| Etiketsiz overlay | `toBe(0)` | 0 | **0** | ✅ |
| Ekranda yaşayan pencere durumu | `toBe(0)` | 0 | **0** | ✅ |
| Erişilebilir adı olmayan form kontrolü (kaynak) | `≤ 7` | 7 | **7** | ✅ değişmedi |
| Erişilebilir adı olmayan form kontrolü (çalışma zamanı) | `0` | 0 | **0** | ✅ |
| Ham `<button>` | artamaz (`≤102`) | 102 | **99** | ✅ **-3** |
| `ui2/` dışında `@medusajs/ui` importu | `toEqual([])` | [] | **[]** | ✅ |
| `eksikDosyalar` / `fazlaDosyalar` | `[]` | [] | **[]** | ✅ |

**Ham düğme neden düştü (-3):** mobil çekmecenin hamburger'ı ve kapatma
düğmesi ortak `Button`a geçti; zemin katmanı ham bir
`<button aria-label="…kapat">` iken `aria-hidden` bir katmana indi — yani odak
sırasından da çıktı. Düşüş bir erişilebilirlik kazancının yan ürünü, kozmetik
bir sayı oyunu değil.

**Kabuk yeni denetimler getirdi ama hiçbiri ham düğme değil:** arama
tetikleyicisi, katlama, profil ve çekmece kapatma ortak `Button`; tema
seçenekleri `<label>` içine sarılı `<input type="radio">`; komut penceresi
sonuçları **listbox deseni** (`role="listbox"` + `role="option"`), sonuç başına
bir düğme yazan eski palet deseni değil. Eşik **99'a indirildi** — gevşetilmedi,
sıkılaştırıldı.

**Ölçüm tabanı 109 → 114 dosya.** Beş yeni dosyanın hepsi `OLCUM_TABANI`'na
ve (dördü `.tsx` olduğu için üçü) çalışma zamanı kapısının kapsamına **elle**
yazıldı. `fazlaDosyalar` nöbetçisi bunu zorunlu kıldı: yazılmasalardı CI
kırılırdı ve nöbetçinin tam olarak istenen davranışı budur.

### 4.5 Değişen dosyalar

**Yeni:**

| Dosya | Ne |
|---|---|
| `components/admin/ui2/komutPenceresi.tsx` | Komut penceresinin **ortak mekanizması** — `TaskCommandPalette`ten taşındı |
| `components/admin/layout/AdminKomutPenceresi.tsx` | Panelin komut verisi + `Ctrl+K` + `G`+harf |
| `components/admin/layout/AdminProfilMenusu.tsx` | Profil + üç seçenekli tema + çıkış |
| `components/admin/layout/panelKabuguDurumu.ts` | Katlama tercihi (kalıcı) |
| `components/admin/layout/panelKabugu.test.tsx` | Kırmızı matris (16 test) |
| `frontend/scripts/ip_b1_kabuk_turu.mjs` | Gerçek tarayıcı turu sürücüsü |
| `docs/tasarim-dili.md` | Tasarım dili sözleşmesi |
| `docs/ip-b1/` | Tur çıktısı: `tur.json` + 20 ekran görüntüsü |

**Değişen:**

| Dosya | Ne |
|---|---|
| `components/admin/layout/AdminLayout.tsx` | Kabuk yeniden kuruldu |
| `components/admin/layout/AdminSidebar.tsx` | Üç bölge + katlama + token |
| `components/admin/layout/AdminPageHeader.tsx` | Üst şerit: hamburger + başlık + aksiyon yuvası + bildirim |
| `components/admin/layout/adminNavigation.ts` | `kisayol` alanı (10 alan) |
| `components/admin/layout/adminNavigation.test.ts` | Kısayol tekilliği/biçimi/hedefi (3 test) |
| `src/index.css` | Yarım kalmış `--admin-*` yerine tam `--panel-*` token kümesi (koyu tema değerleri gerçek Chrome ölçümüyle düzeltildi) |
| `tailwind.config.js` | `colors.panel` köprüsü |
| `scripts/ui-baseline-sayim.mjs` | Ölçüm tabanına 5 dosya |
| `src/__guards__/uiBaseline.test.ts` | Ham düğme eşiği 102 → 99 |
| `src/__guards__/calismaZamaniKapisi.test.tsx` | Kapsam + `ZORUNLU_PROPLAR` |
| `src/__guards__/tembelModul.test.ts` | Satır çıpası güncellendi |

### 4.6 `useNavSearch` / `TaskCommandPalette` — yeniden yazılmadı, taşındı

Bulgu: bu ikisi **farklı şeyler**.

- **`useNavSearch`** panelin değil, **public sitenin** arama hapıdır
  (`CategoryBar` + `BigSearch`/`CompactSearch`, `/egitmenler` ve
  `/kutuphaneler`e gider). Yönetim panelinde bir karşılığı yok ve zorlanarak
  taşınması yanlış olurdu — panelde aranan şey eğitmen değil, **alan ve
  komuttur**. Dokunulmadı.
- **`TaskCommandPalette`** görev modülünün `Ctrl+K` paletidir ve içindeki
  **etkileşim mekanizması** taşınabilirdi: overlay, arama girdisi, gruplu
  sonuçlar, ok tuşlarıyla gezinme, `Enter`/`Escape`, işaretçiyle etkinleşme.
  Bu mekanizma `ui2/komutPenceresi.tsx`e çıkarıldı; görev modülünün kendi
  verisi orada kaldı.

Taşırken eski palette'in **üç canlı borcu** düzeldi:

1. **Overlay etiketsizdi** — `role="dialog"` ve `aria-modal` yoktu; ekran
   okuyucu için o katman bir pencere değildi. (Ölçüm tabanının dışında olduğu
   için nöbetçi görmüyordu: borç gerçekti, sadece sayılmıyordu.)
2. **Sonuç listesinin ARIA yapısı yoktu** — sonuçlar `<button>` yığınıydı;
   "N sonuçtan 2.si" bilgisi hiçbir yerde yoktu. Artık standart
   combobox↔listbox deseni (`aria-activedescendant`, `aria-selected`).
3. **Odak geri dönmüyordu** — pencere kapanınca odak `document.body`de
   kalıyordu.

**Bilinen sınır:** `TaskCommandPalette` bu turda ortak mekanizmaya
**bağlanmadı** — görev modülü bu paketin kapsamı dışında ve orayı değiştirmek
kabuğun kırmızı matrisini görev modülünün testleriyle karıştırırdı. Ortak
katman kurulmuş durumda; bağlama işi §6'da B9'a yazıldı ve
`docs/teknik-borc.md`'ye kaydedilmeli.

**İkinci bilinen sınır:** panel kabuğu artık `DashboardHeader` taşımadığı için
**"Kişiselleştir" penceresine panelden erişilemiyor** (P12). O pencere
`DashboardShell` yüzeylerini (navbar/kenar kısayol düzeni) ayarlıyor ve panel
rail'ini hiç etkilemiyordu — yani panelde işlevsizdi. Yine de bilinçli bir
kayıptır ve burada yazılıdır.

---

## 5. Görev 5 — Gerçek tarayıcı turu

**Sürücü:** `frontend/scripts/ip_b1_kabuk_turu.mjs` (Chrome headless + CDP).
**Çıktı:** `docs/ip-b1/tur.json` + 20 ekran görüntüsü.

**Önceki turlardan farkı:** sonda (probe) sayfası KULLANILMADI. Ölçülen şey
kabuk ve kabuk gerçek rota ağacında yaşıyor — sahte bir sayfaya monte edilseydi
`aria-current`, kısayolların gerçekten gezindirmesi, rota değişince çekmecenin
kapanması ve katlama tercihinin sayfa yenilemesinde korunması **ölçülemezdi**.

**Veri:** canlı `ceyhandb`'ye **bağlanılmadı**. Tur için yeni ve boş bir demo
veritabanı açıldı (`adana_b1_demo`), backend `AUTO_CREATE_DB` ile şemayı kurup
seed'i çalıştırdı, ödeme sağlayıcısı `fake`, e-posta `console`. Ekran
görüntülerinde yalnız seed kullanıcısı (`System Admin`) ve boş durumlar var;
gerçek kişisel veri yok.

### 5.1 Kapsam — 4 ekran × 2 tema × 2 genişlik = 16 ölçüm

| Ekran | Yol |
|---|---|
| Mağaza | `/yonetim/magaza/urunler` |
| Envanter | `/yonetim/envanter` |
| Kurye | `/yonetim/dagitim/kuryeler` |
| Kütüphane | `/yonetim/kutuphaneler` |

Her ölçümde denetlenen kapılar: yatay taşma · iç içe `<button>` · 403 kutusu ·
`<h1>` sayısı · temanın gerçekten uygulanması · rail'in masaüstünde görünüp
mobilde gizlenmesi · adsız form kontrolü.

**Sonuç: 16/16 ölçüm, düşen kapı YOK.**

- Yatay taşma: **0 px** (16/16)
- İç içe `<button>`: **0** (16/16)
- `<h1>`: her ekranda **tam 1** ve bulunulan alanı adlandırıyor
- `aria-current="page"`: rail'de tam bir öğe (+ ekranın kendi alt sekmesi)
- En küçük dokunma hedefi: **36 px** (her ölçümde)
- Adsız form kontrolü: **0** (16/16)
- Rail: 1280'de **263 px** görünür, 380'de **gizli** (16/16)

### 5.2 Etkileşim ölçümleri

| # | Ölçüm | Sonuç |
|---|---|---|
| E-1 | Rail katlama | 263 px → **71 px**; `data-katli="true"`; **başka bir rotaya gidince tercih korundu**; katlı railde 18 gezinme bağlantısının **hepsinin adı var** |
| E-2 | `Ctrl+K` | Pencere açıldı, `aria-label="Komut penceresi"`, `aria-modal="true"`; odak arama kutusuna gitti (`Panelde ara`); "envanter" yazınca **1 seçenek**; `Enter` → `/yonetim/envanter`; pencere kapandı |
| E-3 | `G` + `K` | `/yonetim/kullanicilar`'a gitti. **Girdi odaktayken tetiklenmedi** (yol değişmedi) |
| E-4 | Profil menüsü / tema | **3 seçenek** (Açık/Koyu/Sistem), "Koyu" tıklanınca `<html class="dark">` uygulandı |
| E-5 | Mobil çekmece (380) | `role="dialog"` + `aria-modal="true"` + `aria-label="Yönetim menüsü"`; 6 `Tab` boyunca **odak dışarı çıkmadı**; `Esc` kapattı |
| E-6 | Odak halkası | Klavyeyle gezilen 8 öğenin hepsinde görünür halka (`box-shadow` halkası) |

### 5.3 Kontrast — **iki gerçek kusur bulundu ve düzeltildi**

Tur, kabuğun metin seviyelerini gerçek Chrome'da ölçtü. İlk koşumda **koyu
temada iki eşik ihlali** çıktı ve ikisi de **bu paketin yeni yazdığı token
katmanındaydı**:

| Ölçüm | İlk değer | Eşik | Sonra |
|---|---|---|---|
| Etkin gezinme öğesi (koyu) — indigo-400 üzerine indigo-**900** | **3,83** ❌ | 4,5 (14 px metin, büyük metin muafiyeti yok) | **5,36** ✅ (accent-soft → indigo-950) |
| `fg-subtle` (koyu) — slate-500 üzerine slate-900 | **3,75** ❌ | 4,5 (arama öğesinin "Ara" metni ve tuş rozeti) | **6,96** ✅ (fg-subtle → slate-400) |

Değerler tahminle değil hesapla seçildi ve **yeniden ölçüldü**. Üç metin
seviyesi hâlâ birbirinden ayırt edilebilir (12,02 / 6,96 / yüzey).

Açık temada ihlal yoktu: etkin öğe **5,62**, pasif öğe **17,85**, grup başlığı
**4,76**.

**Ölçülüp KABUL EDİLEN:** rail'in bölge ayıracı (saç-teli çizgi) açık temada
**1,23**, koyu temada **1,22**. Bu bir ihlal DEĞİL: WCAG 2.1 SC 1.4.11 anlam
taşıyan arayüz bileşeni sınırlarını kapsar, dekoratif ayıracı değil — ve bu
çizgi tasarım dilinin bilinçli tercihidir (§3.2: "kutu yerine boşluk + saç-teli
çizgi"). Değer, panelin bugüne dek kullandığı `border-slate-200` /
`dark:border-slate-800` ile **aynı**; yani bu paket bir şeyi kötüleştirmedi.
Sondanın eşiği (3) burada fazla geniş; kayda geçirildi.

### 5.4 Ekran görüntüsünden yakalanan üretim hatası

**Aynı anda İKİ gezinme öğesi etkin görünüyordu.** `/yonetim/magaza/*`
altındayken hem "Mağaza" hem **"Hakedişler"** vurguluydu. Sebep: etkinlik
kontrolü rotaya değil **ikona** bakıyordu (`item.icon === "store"`) ve
"Hakedişler" de o ikonu taşıyor.

Bu hata **`main`'de de vardı** — bu paketin ürettiği bir regresyon değil,
kabuğu yeniden çizerken görünür olan mevcut bir kusur. Önemi: `aria-current`
**doğruydu** (yalnız Mağaza'daydı), yani hata **salt görseldi** ve mevcut
erişilebilirlik iddialarının hiçbiri onu göremezdi. Ancak gerçek bir ekran
görüntüsü yakalayabilirdi — kök CLAUDE.md §F'nin "gerçek tarayıcı gerektirir"
maddesinin somut örneği.

Düzeltme: koşul rotaya bağlandı. Nöbetçi: gezinme öğesi artık DOM'da
`data-etkin` sözleşmesi taşıyor ve yeni bir test "aynı anda yalnız bir öğe
etkin" diyor (kırmızı matris · madde 16).

### 5.5 Turun kendi kusurları (raporlanıyor)

Sürücü üç kez düzeltildi ve üçü de **sahte kırmızı** üretiyordu:

1. **Sabit giriş beklemesi (3,5 sn) yetersizdi** — tüm tur "giriş başarısız"
   diye düşüyordu (24 kapı). Yol değişene kadar beklemeye çevrildi.
2. **Sabit render beklemesi yetersizdi** — 13 kapı "h1 sayısı 0" / "rail
   görünmüyor" diyordu. Rotalar `React.lazy` ile bölünüyor; ölçülen şey düzen
   değil **yükleme hızıydı**. `hazirBekle()` eklendi.
3. **Chrome profili çıktı dizinine yazılıyordu** — arka planda kalmış bir
   Chrome varken `EPERM` ile turu düşürüyordu ve profil `docs/` altında
   birikiyordu. Profil geçici dizine ve koşuma özel bir ada taşındı.

**Ölçülemeyen:** sondanın `sayfaBasligi` kontrast ölçümü `null` döndü — sonda
metin seviyelerini rail içinde arıyor, `<h1>` ise üst şeritte. Kapsam kusuru,
kayda geçirildi; başlığın kontrastı `--panel-fg` (açık 17,85 / koyu 17,06 ile
aynı token) üzerinden zaten geçiyor.

### 5.6 Kapatma

Tur bitiminde vite (5173), backend (8000) ve CDP portu (9411) kapatıldı ve
kapandığı `netstat` ile **doğrulandı**. Chrome süreçleri sonlandırıldı.

---


---

## 6. Görev 6 — B serisi yol haritası

### 6.1 Öncelik ölçütü

Üç aday ölçüt vardı: **en çok kullanılan ekran**, **en çok kazanç getiren**,
**deseni en çok zorlayan**. Üçü de tek başına yanlış:

- "En çok kullanılan" ile başlamak, ortak parçalar (filtre menüsü, iki boş
  durum, sayfalama, mobil kart) henüz yokken en çok bakılan ekranı yarım bir
  dille yazmak demek.
- "Deseni en çok zorlayan" ile başlamak (dağıtım, saha ekranı) dili henüz
  kanıtlanmamışken en uç örnekle sınamak demek — kural yerine istisna üretir.
- "En çok kazanç" ölçülemiyor: panelin kullanım sayacı yok.

**Kullandığım ölçüt: ortak parça verimi.** Sıra, *bir paketin ürettiği ortak
parçanın kaç ekranı beklemekten kurtardığına* göre kuruldu. Bu, "en çok
kullanılan"ı da doğal olarak öne alıyor (en çok kullanılan ekranlar aynı
zamanda en çok tekrar eden desenleri taşıyor) ama sırayı hissiyata değil
sayıya bağlıyor.

### 6.2 Paketler

| Paket | Kapsam | Ürettiği ortak parça | Kaç ekranı açar | Neden burada |
|---|---|---|---|---|
| **B2 · Liste sayfası anatomisi + ürün listesi** | Araç çubuğu (arama/filtre menüsü/sıralama), uygulanan filtre çipleri, iki ayrı boş durum, sayfalama, **mobil kart bağlanması**, satır aksiyon kuralı (Ç-2) | `DataTable` v2 + `ListeAracCubugu` + `EmptyState` ikizi | **~22 liste ekranı** | Serhat'ın istediği #1. Panelin en çok tekrar eden yüzeyi; ortak parça verimi en yüksek paket |
| **B3 · Ürün oluşturma akışı** | `FocusModal` + `ProgressTabs` sarmalayıcıları, akış içi görsel yükleme (T3), varyant ızgarası (T4) | `TamEkranAkis` + `AdimliForm` + `GorselYukleyici` + `Izgara` | **~8 oluşturma akışı** (kütüphane K1, deneme oturumu K4, sayım N2, tur D3…) | Serhat'ın istediği #2. B2'den ayrı — gerekçesi 6.3'te |
| **B4 · Sipariş yüzeyi** | Detay sayfası anatomisi (§6), zaman çizelgesi bölümü, tehlikeli işlem onayı | `DetaySayfasi` + `ZamanCizelgesi` + `TehlikeliIslem` | **~10 detay sayfası** | Tur 2'nin en acil beş işinin dördü burada (T8-T11, T13); dil kazancı + gerçek eksik kapanışı aynı pakette |
| **B5 · Envanter + paketleme** | Baskı katmanı dili (N6), istasyon yüzeyi (N5), elle tabloların `DataTable`a göçü | `BaskiSayfasi` + `IstasyonYuzeyi` | ~7 ekran | B2'nin ortak parçalarını ilk kez "elle tablo" üzerinde sınar; baskı dili başka hiçbir pakette doğmaz |
| **B6 · Dağıtım** | Tam genişlik harita düzeni, uzun-süren-iş yüzeyi (D4), kokpit metrik şeridi (D1) | `GenisDuzen` + `UzunIsDurumu` + `MetrikSeridi` | ~10 ekran | Deseni en çok zorlayan blok — **kasıtlı olarak dil kanıtlandıktan sonra**. Saha ekranları (D11-D12) buraya değil, kendi mobil paketine |
| **B7 · Eğitim + güvenlik listeleri** | Moderasyon kuyruğu deseni (E1, G1, G2, T18), izin ızgarası (G4) | `ModerasyonKuyrugu` + `IzinIzgarasi` | ~9 ekran | Aynı deseni dört kez tekrar eden blok; B2'nin araç çubuğunu doğrudan tüketir |
| **B8 · Kütüphane + operatör + Ayarlar bölümü** | Ayarlar alt gezinmesi (Ç-4), PII maskeli alan (K3), aynı ekran/farklı yetki kuralı (K4) | `AyarlarBolumu` + `MaskeliAlan` | ~8 ekran | Ç-4'ün karar noktası bu pakette; operatörün mobil-öncelikliği Ç-1'in ikinci yarısını karara bağlar |
| **B9 · Temizlik** | İkon göçü (`@medusajs/icons`), `dark:` sınıflarının token'a devri, `TaskCommandPalette`in ortak mekanizmaya bağlanması | — | tüm panel | **En sona**: mekanik, ve bütün ekranlar göç ettikten sonra tek geçişte yapılırsa iki kez dokunulmaz |

### 6.3 "B2 ve B3 birlikte olur mu?" — **Hayır, ayrılmalı**

Serhat'ın istediği iki şey (ürün listesi + ürün oluşturma akışı) aynı ekranın
iki yüzü gibi görünüyor ama **iki ayrı ortak parça ailesi** üretiyorlar:

- B2 → **liste ailesi**: araç çubuğu, filtre menüsü, boş durumlar, sayfalama,
  mobil kart. 22 ekranı bekletiyor.
- B3 → **yüzey ailesi**: tam ekran pencere, adımlı akış, görsel yükleyici,
  düzenleme ızgarası. 8 akışı bekletiyor.

Birlikte yapılırsa üç somut zarar doğar:

1. **Paket incelenemez hâle gelir.** İkisi birlikte `AdminStore`'un altı
   yüzeyinden dördüne dokunur; kırmızı matris 40+ satır olur ve "neyin
   kanıtlandığı" okunamaz.
2. **Geri alma ikisini birden kaybettirir.** B3'ün adımlı akışı bir sorun
   çıkarırsa, 22 ekranı bekleten liste ailesi de rafa kalkar.
3. **Sıra zaten doğal olarak B2'dir.** Oluşturma akışının son adımı yeni
   kaydı **listeye** düşürür; liste anatomisi belirsizken akışın "sonra ne
   olacak"ı da belirsiz kalır.

**Öneri:** B2 ve B3 **arka arkaya**, aynı hafta, ayrı iki onay kapısıyla.
Serhat ikisini birlikte görmek istiyorsa B3'ün sonunda tek bir demo turu
yapılır — ama paket sınırı ikisini ayırır.

---

## 7. Kapı

| Kapı | Sonuç |
|---|---|
| `tsc --noEmit` | ✅ temiz |
| `npm run build` | ✅ başarılı |
| `npm run lint` | ✅ **0 hata**, 32 uyarı (taban 31 → +1) |
| Tam suite (sıralı) | ⚠️ **1730 / 1730 yeşil ölçüldü**, ama tekrar koşumlarında 1 test dönüşümlü olarak zaman aşımına düşüyor — aşağı bakınız |
| Nöbetçiler (`src/__guards__/`) | ✅ **218 / 218** |
| Mutasyon provası | ✅ **9 / 9** yakalandı, çalışma ağacı bozulmadı |
| Gerçek tarayıcı turu | ✅ 16 ölçüm + 6 etkileşim, **düşen kapı yok** |
| ≥6 tohumlu karışık koşum | ⚠️ **YEŞİL DEĞİL** — aşağı bakınız |

**Lint uyarısı +1:** `komutPenceresi.tsx`teki `aria-hidden` zemin katmanı
(`jsx-a11y/no-noninteractive-element-interactions`). Bilinçli: zemin
klavyeyle erişilebilir OLMAMALI (ESC ve odak tuzağı zaten var); eski palet
orada odak sırasına giren etiketsiz bir tıklama alanı taşıyordu.

### 7.1 Karışık sıralı kapı — **açıkça kırmızı, gizlenmiyor**

**Sıralı koşum da bağışık değil.** Paketin ortasında yapılan iki tam koşum
**1728/1728** ve **1730/1730** yeşildi. Kapanışta, makine saatlerdir yük
altındayken yapılan üç ardışık koşumun ikisinde **birer** test düştü — ve **her
koşumda BAŞKA bir test** (`adminStoreBolme.acceptance` → `adminStoreDalAdlari.acceptance`).
Düşen test tek başına koşulduğunda **geçiyor** (5/5). Yani sıralı kapı da aynı
zamanlama sınıfına ait; deterministik bir kırmızı değil.

Altı tohum (`101 · 4001 · 7 · 20260821 · 555 · 31337`) koşuldu. **Altısında da**
1-4 test düştü ve **hepsinin sebebi aynı**: `Test timed out in 9000ms`. Düşen
küme tohuma göre değişiyor; hepsi bu paketin **dokunmadığı** dosyalarda:

`adminRezervasyonFiltre.acceptance` · `examOturumlariGoc.acceptance` ·
`adminStoreBolme.acceptance` · `operatorPanel.acceptance`

**Bu paketin sebep olmadığı ÖLÇÜLDÜ** (iddia değil):

1. Bu paketin eklediği test dosyası (`panelKabugu.test.tsx`, 16 test) geçici
   olarak **kaldırıldı** ve aynı tohum (31337) yeniden koşuldu: kırmızı
   sürdü ve **arttı** (2 → 4 test). Yani kırmızılık eklenen testlerden
   gelmiyor.
2. Aynı dosyalar **tek başlarına**, karışık sırayla, üç kez koşuldu:
   **31/31 yeşil** (üçünde de).

Sonuç: kusur yük altındaki zamanlamada, testlerin mantığında değil. Kök,
`vitest.config.ts`teki 9.000 ms bütçesinin ölçüldüğü makineye kalibre olması —
depo bu sınıfı zaten iki kez kaydetmiş (TB-23 ve İP-A8 · B-4). Doğru çözüm
bütçeyi büyütmek DEĞİL, ağır acceptance testlerinin fixture'larını küçültmektir
(B-4'te bir kez yapıldı: `limit=25` → `limit=5`).

Borç: **TB-?A** (`docs/teknik-borc.md`; numara main merge turunda tahsis
edilecek).

**"Altı tohum yeşil" DİYE YAZILMADI** — çünkü değil. **"Tam suite yeşil" de
koşulsuz yazılmadı**: yeşil ölçüldü, ama tekrarlanabilir değil ve tekrarlanabilir
olmadığı burada duruyor.

**Merge öncesi beklenen:** bu kapı, TB-?A kapanmadan ya da daha az yüklü bir
makinede yeniden ölçülmeden "geçti" sayılmamalı.

---

## 8. Bilinen sınırlar

Beş kalem `docs/teknik-borc.md`'ye **geçici etiketle** (TB-?A…TB-?E) yazıldı;
numaralar main merge turunda tahsis edilecek (defterin numara kuralı).

1. **`TaskCommandPalette` ortak mekanizmaya bağlanmadı** — ortak katman
   kuruldu ve panelde kullanılıyor; görev modülü hâlâ kendi kopyasını
   taşıyor (üç a11y borcuyla birlikte). B9'a yazıldı · **TB-?B**.
2. **"Kişiselleştir" penceresine panelden erişilemiyor** (§4.6). O pencere
   `DashboardShell` yüzeylerini ayarlıyordu ve panel rail'ini hiç
   etkilemiyordu; kayıp bilinçli ve burada yazılı · **TB-?D**.
3. **Kabuk hâlâ inline `<svg>` taşıyor.** `@medusajs/icons` kurulu ama ikon
   göçü kendi paketini hak ediyor (B9); kabukla karıştırılsaydı ikisi de yarım
   kalırdı.
4. **Token katmanı yalnız kabukta kullanılıyor.** Ekranlar hâlâ ham Tailwind +
   `dark:` çiftiyle çalışıyor (891 kullanım). Bilinçli: bu paketin kuralı
   "ekran içerikleri değişmez".
5. **Aksan rengi karar bekliyor** (Ç-3) — kabuk bugün `indigo` aksanla
   çalışıyor.
6. **Ç-5 (Google Fonts / KVKK) düzeltilmedi** — kapsam dışı; teknik borca
   yazıldı · **TB-?C**.
7. **Envanter yetenek bazlıdır ama tam sayım değil.** 58 yetenek panelin
   gezinilebilir yüzeylerini kapsıyor; alt akışların (ör. bir pencerenin
   içindeki üçüncü seviye form) hepsi ayrı satır olarak yazılmadı — B2'den
   itibaren her paket kendi ekranının alt akışlarını kendi sözleşmesinde
   ayrıntılandırır.
8. **Ölçüt verisi yok.** §6.1'in "en çok kullanılan" ölçütünü ölçemedim: panelde
   kullanım sayacı yok. Sıra, ortak parça verimi üzerinden kuruldu.
9. **Mobil çekmecede `Ctrl K` tuş rozeti görünüyor.** Arama öğesi rail ile
   çekmecede aynı bileşen; dokunmatik cihazda fiziksel klavye olmayabilir.
   Küçük, kozmetik; B2'de arama öğesi ele alınırken kapatılmalı · **TB-?E**.
10. **`sayfaBasligi` kontrast ölçümü sondanın kapsamı dışında kaldı** (§5.5).
11. **Tur için açılan demo ortamı depoda durur:** `adana_b1_demo` veritabanı
    ve `backend/.env` / `frontend/.env` (ikisi de `.gitignore`'da). `.env`
    canlı `ceyhandb`'ye DEĞİL demo veritabanına bakıyor; bu worktree'de backend
    çalıştırılırsa demo verisi görülür. Bilinçli ve güvenli yön, ama sürpriz
    olmasın diye yazılı.
12. **Karışık sıralı kapı yeşil değil** — bkz. §7.1 ve TB-?A.
