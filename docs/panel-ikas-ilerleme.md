# /yonetim-yeni ilerleme (feat/panel-ikas)

Son güncelleme: 12 Eyl 2026.

## Tamamlanan modüller

- **Ürünler** (`/yonetim-yeni/urunler`): liste (canlı ikas ölçüleri), arama, sıralama,
  sayfalama (sticky alt bilgi), filtre penceresi (stok/yayınevi/yazar/tedarikçi → gerçek
  `listProductsAdmin` alanları), kolon ayarı penceresi (localStorage), liste/ızgara
  görünümü (localStorage), CSV içe aktarma (+ şablon indirme), satır menüsü
  (Düzenle/Gizle-Yayınla/Kapak yükle/Sil-onaylı), Durum ve Maliyet/Marj kolonları
  (`suppliers.view`), `products.manage` kapısı (salt okunur uyarısı), loading/error/
  empty ("kayıt yok" ≠ "sonuç yok"), mobil (396px'te yatay taşma yok).
  Doğrulama: `tsc -b`, ESLint (değişen dosyalar), `vitest src/__guards__ src/panel`
  (tek bilinen sallantı: `urunFormu.test.tsx` compare_at_price testi yük altında
  zaman aşımı; tek başına geçiyor, bu değişiklikle ilgisiz). Tarayıcı: masaüstü +
  iframe ile 396px mobil prova.

## Sıradaki

1. Gösterge paneli — tamamlandı (`0b04b18`).
2. Envanter · Stok Sayımı listesi + detayı — tamamlandı; liste `/yonetim-yeni/urunler/stok-sayimi` (`StokSayimiListesi.tsx`, `YeniSayimCekmecesi.tsx`), detay `/yonetim-yeni/urunler/stok-sayimi/:id` (`StokSayimiDetayi.tsx`, `StokSayimiPencereleri.tsx`).
3. Envanter · Stok Hareketleri — tamamlandı; `/yonetim-yeni/urunler/stok-hareketleri` (`StokHareketleriListesi.tsx`, salt okunur defter + denetim).
4. Envanter · Genel Bakış ve Hasarlı Stok — tamamlandı; `/yonetim-yeni/urunler/envanter` (`EnvanterGenelBakis.tsx`), `/yonetim-yeni/urunler/hasarli-stok` (`HasarliStokListesi.tsx`, `HasarliStokPencereleri.tsx`).
5. Kategoriler, Tedarikçiler ve Kuponlar — tamamlandı; `/yonetim-yeni/urunler/tanimlamalar` (`Tanimlamalar.tsx` hub; menüde Tanımlamalar öğesi, kart rotaları alias), `/yonetim-yeni/urunler/kategoriler` (`KategoriListesi.tsx`, `KategoriCekmecesi.tsx`), `/yonetim-yeni/urunler/tedarikciler` (`TedarikciListesi.tsx`, `TedarikciCekmecesi.tsx`), `/yonetim-yeni/indirimler/kuponlar` (`KuponListesi.tsx`, `KuponCekmecesi.tsx`; menüde İndirimler grubu).
6. Ayarlar · Genel Ayarlar, Personel & Yetkiler, Denetim Kayıtları ve Hata Çözme — tamamlandı; `/yonetim-yeni/ayarlar/genel` (`GenelAyarlar.tsx`, `BayrakGerekcePenceresi.tsx`), `/yonetim-yeni/ayarlar/personel-yetkiler` (`PersonelYetkiler.tsx`, `RolCekmecesi.tsx`), `/yonetim-yeni/ayarlar/denetim-kayitlari` (`DenetimKayitlariListesi.tsx`, `DenetimKaydiPenceresi.tsx`), `/yonetim-yeni/ayarlar/hata-cozme` (`HataCozme.tsx`; menüde Ayarlar grubu).
7. İadeler, Müşteri Detayı ve Sipariş Detayı — tamamlandı; `/yonetim-yeni/siparisler/iadeler` (`IadeListesi.tsx`, `IadePenceresi.tsx`; menüde Siparişler grubu), `/yonetim-yeni/musteriler/:role/:id` (`MusteriDetayi.tsx`, `MusteriDetayPencereleri.tsx`; menüde Müşteriler grubu), `/yonetim-yeni/siparisler/:id` (`SiparisDetayi.tsx`, `SiparisDetayPencereleri.tsx`; tekil `GET /store/admin/orders/{id}` ucu).
8. Paketleme · Kuyruk, Paketler listesi, İstasyon/Detay ve Geri Dönüş — tamamlandı; `/yonetim-yeni/paketleme` (`PaketlemeKuyrugu.tsx`, `usePaketlemeErisimi.ts`; menüde Paketleme grubu), `/yonetim-yeni/paketleme/paketler` (`PaketListesi.tsx`), `/yonetim-yeni/paketleme/paket/:id` (`PaketlemeDetayi.tsx`, `PaketlemePencereleri.tsx`; Kuyruk ve Paketler yeni detaya bağlı) ve `/yonetim-yeni/paketleme/geri-donus` (`GeriDonusKuyrugu.tsx`, `DepoyaAlPenceresi.tsx`).
9. Dağıtım · Bugün, Siparişler, Turlar listesi, Tur Detayı, Performans, Kuryeler, Tahta ve Araçlar — tamamlandı; `/yonetim-yeni/dagitim` (`DagitimBugun.tsx`; menüde Dağıtım grubu), `/yonetim-yeni/dagitim/siparisler` (`DagitimSiparisleri.tsx`), `/yonetim-yeni/dagitim/turlar` (`DagitimTurlari.tsx`), `/yonetim-yeni/dagitim/turlar/:id` (`DagitimTurDetayi.tsx`; Bugün ve Turlar listesi yeni detaya bağlı), `/yonetim-yeni/dagitim/kuryeler` (`DagitimKuryeler.tsx` + `KuryePencereleri.tsx`; Tur Detayı'ndaki "Kurye ekle" bağlantısı yeni Kuryeler rotasına bağlı; doğrulama sözleşmeleri eski ekranla ortak `components/admin/kuryeSemalari.ts`), `/yonetim-yeni/dagitim/araclar` (`DagitimAraclar.tsx` + `AracPencereleri.tsx`; filo + başlangıç noktaları, şemalar eski ekranla ortak `components/admin/aracSemalari.ts`; varlık kilidi ve pencere alan-hatası altyapısı `panel/components/varlikKilidi.tsx` / `pencereAlanlari.ts` ile Kuryeler'le ortak), `/yonetim-yeni/dagitim/performans` (`DagitimPerformans.tsx`; salt okunur: operasyon metrikleri, teslimat göstergeleri `?gun=`, son değerlendirmeler — sipariş bağlantısı yeni Sipariş Detayı'na gider), `/yonetim-yeni/dagitim/tahta` (`DagitimTahtasi.tsx`; atanmamış sipariş havuzu, erişilebilir tura ekleme, araç/tur şeritleri ve günü optimize etme).
10. Eğitmen Yönetimi — TAMAMLANDI (İlanlar, Ön Başvurular, Diploma Doğrulama, Öne Çıkarmalar); `/yonetim-yeni/egitmenler` (`EgitmenIlanlari.tsx`, `EgitmenIlanPencereleri.tsx`), `/yonetim-yeni/egitmenler/on-basvurular` (`EgitmenOnBasvurulari.tsx`; durum filtresi, gerçek sunucu sayfalaması ve ayrıntı açılımı), `/yonetim-yeni/egitmenler/diplomalar` (`EgitmenDiplomaDogrulama.tsx`, `DiplomaDogrulamaPenceresi.tsx`; liste hassas değer taşımaz — TCKN, barkod, dosya adı ve imzalı belge adresi yalnız açık inceleme penceresinde bulunur ve pencere kapanınca DOM'dan kalkar; `usePendingEducations` yetkisizken sorgu ve yoklama yapmaz, son gözlemci ayrılınca PII önbelleğini `gcTime: 0` ile bırakır). `/yonetim-yeni/egitmenler/one-cikarmalar` (`EgitmenOneCikarmalar.tsx`, `OneCikarmaPenceresi.tsx`; satın alınan reklam paketleri — gerçek sunucu sayfalaması, para durumu ile görünürlük ayrı eksen, iptal/iade penceresi; sağlayıcı referansı yalnız açık ayrıntı penceresinde). Modülde kalan ekran yok.
11. Kütüphane/deneme/rezervasyon/talep — TAMAMLANDI; `/yonetim-yeni/kutuphaneler` (`KutuphaneListesi.tsx`; mevcut kütüphane editörü, oturum, operatör ve ödeme yüzeyleri korunur), `/yonetim-yeni/kutuphaneler/deneme-kataloglari` (`DenemeKataloglari.tsx`; mevcut katalog editörü ve cevap anahtarı akışı korunur), `/yonetim-yeni/rezervasyonlar` (`RezervasyonListesi.tsx`; mevcut filtre, sıralama, sunucu sayfalaması, iptal/iade ve ihtilaf akışları korunur), `/yonetim-yeni/talepler` (`TalepListesi.tsx`; mevcut arama, durum filtresi, sıralama, sunucu sayfalaması ve gerekçeli iptal akışı korunur).
12. Moderasyon · Şikayetler ve Ad Değişiklikleri — tamamlandı; `/yonetim-yeni/moderasyon/sikayetler` (`SikayetListesi.tsx`; durum/hedef filtresi, gerçek sunucu sayfalaması, çöz/reddet kararı, isteğe bağlı moderasyon notu ve uygun yorum hedefini yayından kaldırma akışı korunur), `/yonetim-yeni/moderasyon/ad-degisiklikleri` (`AdDegisiklikleri.tsx`; URL durum filtresi, onay ve isteğe bağlı notla red korunur). Kalan: hak edişler ve diğer rotalar.

## Notlar

- Canlı ikas ölçümleri `docs/ikas-panel-referans.md` sonundaki "CANLI DOM ÖLÇÜMÜ"
  bölümünde; ListePage/theme bu değerleri taşıyor, diğer liste modülleri aynı kabuğu
  kullanmalı.
- Bilinçli boşluklar: Dışa Aktar (uç yok), satır seçimi/toplu işlem (uç yok),
  filtre operatörü ve kolon sürükleme (karşılığı yok).
- Teknik borç (dağıtım): backend `add_stops` sıra numarasını DB kilidi olmadan
  hesaplıyor; Tur Detayı aynı sekmedeki eklemeleri tur düzeyinde sıraya alıyor, farklı
  sekme/istemcilerden eşzamanlı istek yarışı backend tarafında hâlâ mümkün. Ayrıca
  `GET /delivery/runs?run_date=…` yavaşlığı (canlıda ~4 sn) ayrı performans işi olarak duruyor.
- Teknik borç (kuryeler): backend kurye hesabı e-postasını yalnız uzunluk açısından
  doğruluyor; e-posta biçimi ve büyük/küçük harf normalizasyonu sunucuda ayrıca
  sağlamlaştırılmalı (frontend zod + lowercase ile telafi ediyor). Fotoğraf için frontend
  ön kontrolü yok; backend 12 MB sınırı uyguluyor. Fotoğraf audit metadata'sındaki
  istemci dosya adı ayrıca sınırlandırılmalı/normalize edilmeli.
- Teknik borç (araçlar): eski `DeliveryVehiclesPage` formundaki "sınırsız" durak tavanı
  placeholder'ı backend sözleşmesiyle çelişiyor; gerçek davranışta `max_stops = null`,
  `DELIVERY_MAX_STOPS_PER_RUN` sunucu varsayılanını kullanıyor. Yeni panel doğru anlamı
  gösteriyor ("varsayılan durak tavanı"); eski ekran metni bu commit'te değiştirilmedi.
- Teknik borç (test): AntD `modal.confirm` reddedilen `onOk` sözünü kendi içinde yeniden
  reddettiği için onay-hata testleri vitest'te "Unhandled Rejection" gürültüsü üretiyor
  (Tur Detayı ve Kuryeler ortak); testleri kırmıyor, ayrı iş.
- Teknik borç (öne çıkarma defteri): bu düzeltmeden ÖNCE iade edilmiş promosyon kayıtları `refunded_amount = 0` kalmaya devam ediyor; sipariş tarafındaki gibi tek satırlık bir veri taşıma adımı gerekiyor.
- Teknik borç (mutabakat denetimi): `escrow_reconciler._manual_review_audit` promosyon kayıtlarını `target_type="order"` diye yazıyor ve bildirim metni sipariş dili kullanıyor; promosyon dalı eklenmeli.
- Telemetri (merkezi, `lib/monitoring.ts`): yönetim yollarındaki `ui.*` breadcrumb'ları
  sabit `[yönetim etkileşimi]` metnine indirilir (DOM serileştirmesi ad/e-posta/dosya adı
  taşıyordu). Hata ve transaction olaylarında adresler ortak maskeden geçer: oturum/doğrulama
  token'ları, yolun kendisinde token taşıyan public rotalar, presigned özel dosya yolu ile
  imza/credential alanları (AWS, Azure SAS, GCS) gizlenir. Kullanıcının gerçek bağlantısı
  değişmez; yalnız telemetriye giden kopya maskelenir.
