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
5. Kategoriler — tamamlandı; `/yonetim-yeni/urunler/kategoriler` (`KategoriListesi.tsx`, `KategoriCekmecesi.tsx`; menüde Tanımlamalar öğesi). Kalan: tedarikçi, kuponlar.
6. Ayarlar, yetkiler, denetim kayıtları
7. İadeler ve Müşteri Detayı — tamamlandı; `/yonetim-yeni/siparisler/iadeler` (`IadeListesi.tsx`, `IadePenceresi.tsx`; menüde Siparişler grubu), `/yonetim-yeni/musteriler/:role/:id` (`MusteriDetayi.tsx`, `MusteriDetayPencereleri.tsx`; menüde Müşteriler grubu). Kalan: Sipariş Detayı.
8. Paketleme · 9. Dağıtım · 10. Eğitmen yönetimi · 11. Kütüphane/deneme/rezervasyon/
   talep · 12. Moderasyon, hak edişler, kalan rotalar

## Notlar

- Canlı ikas ölçümleri `docs/ikas-panel-referans.md` sonundaki "CANLI DOM ÖLÇÜMÜ"
  bölümünde; ListePage/theme bu değerleri taşıyor, diğer liste modülleri aynı kabuğu
  kullanmalı.
- Bilinçli boşluklar: Dışa Aktar (uç yok), satır seçimi/toplu işlem (uç yok),
  filtre operatörü ve kolon sürükleme (karşılığı yok).
