# /yonetim-yeni ilerleme (feat/panel-ikas)

Son güncelleme: 11 Eyl 2026.

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

1. Gösterge paneli
2. Envanter: genel bakış, stok sayımları, detay, hasarlı stok, stok hareketleri
3. Kategoriler, tedarikçi, kuponlar
4. Ayarlar, yetkiler, denetim kayıtları
5. Sipariş detayı, müşteri detayı, iadeler
6. Paketleme · 7. Dağıtım · 8. Eğitmen yönetimi · 9. Kütüphane/deneme/rezervasyon/
   talep · 10. Moderasyon, hak edişler, kalan rotalar

## Notlar

- Canlı ikas ölçümleri `docs/ikas-panel-referans.md` sonundaki "CANLI DOM ÖLÇÜMÜ"
  bölümünde; ListePage/theme bu değerleri taşıyor, diğer liste modülleri aynı kabuğu
  kullanmalı.
- Bilinçli boşluklar: Dışa Aktar (uç yok), satır seçimi/toplu işlem (uç yok),
  filtre operatörü ve kolon sürükleme (karşılığı yok).
