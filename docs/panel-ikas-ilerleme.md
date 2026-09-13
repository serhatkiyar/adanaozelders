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
9. Dağıtım · Bugün, Siparişler, Turlar listesi, Tur Detayı ve Kuryeler — tamamlandı; `/yonetim-yeni/dagitim` (`DagitimBugun.tsx`; menüde Dağıtım grubu), `/yonetim-yeni/dagitim/siparisler` (`DagitimSiparisleri.tsx`), `/yonetim-yeni/dagitim/turlar` (`DagitimTurlari.tsx`), `/yonetim-yeni/dagitim/turlar/:id` (`DagitimTurDetayi.tsx`; Bugün ve Turlar listesi yeni detaya bağlı), `/yonetim-yeni/dagitim/kuryeler` (`DagitimKuryeler.tsx` + `KuryePencereleri.tsx`; Tur Detayı'ndaki "Kurye ekle" bağlantısı yeni Kuryeler rotasına bağlı; doğrulama sözleşmeleri eski ekranla ortak `components/admin/kuryeSemalari.ts`). Kalan: Performans, Tahta, Araçlar.
10. Eğitmen yönetimi
11. Kütüphane/deneme/rezervasyon/talep
12. Moderasyon, hak edişler, kalan rotalar

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
- Teknik borç (test): AntD `modal.confirm` reddedilen `onOk` sözünü kendi içinde yeniden
  reddettiği için onay-hata testleri vitest'te "Unhandled Rejection" gürültüsü üretiyor
  (Tur Detayı ve Kuryeler ortak); testleri kırmıyor, ayrı iş.
