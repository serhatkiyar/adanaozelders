# docs/ — dizin

`docs/` kökünde yalnız **hâlâ geçerli** belgeler durur: ürün/teknik kararlar,
iş sözleşmeleri (para, KVKK, stok, teslimat), tasarım ve panel referansları.
Bitmiş işlerin raporları, denetimler ve ölçüm kanıtları `docs/arsiv/` altındadır
(25 Eyl 2026 envanterine göre taşındı; koddaki atıflar güncellendi).

Bir belge güncelliğini yitirince buraya değil `arsiv/<seri>/`ye taşınır
(`git mv`, aynı commit'te kod yorumları ve `frontend/scripts/*` çıktı yolları).

## Kaynak belgeler (Active)

| Belge | Ne için |
|---|---|
| `urun-kararlari.md` | Ürün kararları defteri (ÜK-n); ürün davranışı değişmeden önce oku |
| `teknik-borc.md` | Teknik borç defteri (TB-n); CI ve testler atıf yapar |
| `DESIGN.md` | Public site ve panoların tasarım dili (marka `#FF9900`, tek açık tema, Fluent ikonları) |
| `UI-ISSUES.md` | `ui-review` akışının açık görsel sorun listesi |
| `ikas-panel-referans.md` | Yeni `/yonetim-yeni` panelinin ölçü/yerleşim referansı |
| `panel-ikas-ilerleme.md` | Yeni panel modüllerinin ilerleme durumu |
| `ip1a-ders-para-sozlesme.md` | Ders kolunda para güvenliği: escrow, iade, zamanlama |
| `ip2a-magaza-iade-sozlesme.md` | Mağaza iadesi, refund ve stok bütünlüğü |
| `ip2b-siparis-iptal-telafi-sozlesme.md` | Sipariş iptali ve telafisi |
| `ip5-kdv-fatura-sozlesme.md` | KDV aritmetiği ve fatura |
| `ip3-yetki-kvkk-sozlesme.md` | Yetki, KVKK silme, oturum iptali |
| `ip18-siparis-kilit-sozlesme.md` | Sipariş kilidi ve ölü varlık kuralları |
| `egitmen-alici-sozlesme.md` | Eğitmenin mağazada alıcı olması (gölge müşteri) |
| `one-cikarma-sozlesmesi.md` | İlanı öne çıkarma paketleri |
| `tedarikci-senkron-sozlesme.md` | Tedarikçi stok/fiyat senkronu |
| `ip16-aralikli-tekrar-sozlesme.md` | Aralıklı tekrar (FSRS) |
| `ip19-dagitim-operasyon-sozlesme.md` | Dağıtım operasyonu (tur, kurye, araç) |
| `f29-envanter-sozlesmesi.md` | Envanter: sayım, hasarlı stok kuralları |
| `f30-paketleme-sozlesmesi.md` | Paketleme kuyruğu ve etiket |
| `ip1b-kutuphane-kontenjan-sozlesme.md` | Kütüphane kontenjan, bilet, silme kuralları |
| `iyzico-pazaryeri-sorulari.md` | Pazaryeri ödemesi için açık sorular (PK-2 önkoşulu) |

## Referans (Reference)

`preply-referans.md`, `ikas-admin-panel-arastirmasi.md`, `panel-arastirmasi.md`,
`ikas-uygulama-p0-*.md` / `ikas-uygulama-p1-*.md` (uygulanmamış taslaklar),
`delivery-experience-design.md`, `delivery-screens-wireframes.md`,
`transactional-mail-arastirmasi.md`, `stok-hareket-defteri-plani.md`,
`sm2-kaldirma-sozlesme.md`, `ip21-nobetci-denetimi-sozlesme.md`,
`kimlik-ve-diploma-dogrulama-plani.md`, `ip4-admin-operasyon-sozlesme.md`,
`ip14-operator-panel-sozlesme.md`, `operator-panel-olcumu.md`,
`magaza-merge-dogrulama-raporu.md` (+ `magaza-merge-dogrulama/`),
`ilan-ekrani-bulgular.md`, `tasarim-dili.md` (yalnız eski `/yonetim`, tarihsel bant taşır),
`anasayfa-mobil/` (mobil kapı ekran görüntüleri), `data/` (kitap toptancıları analizi).

## Arşiv (`arsiv/`)

| Klasör | İçerik |
|---|---|
| `arsiv/ip-a/` | İP-A0…A9 ölçüm/denetim raporları ve kanıt klasörleri (ekran görüntüleri, JSON) |
| `arsiv/ip-b/` | İP-B1/B2 eski panel kabuğu raporları ve kanıtları |
| `arsiv/ip-c/` | İP-C1/C2/C4 kontrast ve public tur kanıtları |
| `arsiv/denetim/` | Temmuz–Ağustos 2026 bağımsız denetim raporları, doğrulama ve ekspertiz |
| `arsiv/medusa/` | Medusa arayüz karşılaştırmaları |
| `arsiv/vitrin-p0/` | Mağaza vitrini P0 raporu ve kanıtları |
| `arsiv/teslimat/` | Teslimat faz 0 denetim matrisi, profesyonelleştirme görevi, İP-19 denetim görevi |
| `arsiv/panel-eski/` | Eski `/yonetim` devir notu, İP-12 mağaza paneli sözleşmesi, 11 Eyl panel spec/planı |
| `arsiv/stok/` | F29 sayım/hasarlı stok planı (geçerli kurallar `f29-envanter-sozlesmesi.md`'de) |
| `arsiv/altyapi/` | PK-1 lansman kontrol listesi (bayat), presence yarışı merge notu |
| `arsiv/sihirbaz-superprof/` | Onboarding sihirbazı ölçüm kanıtları |

Arşivdeki belgeler değiştirilmez; içlerinde kalan açık bulgular gerekirse
`teknik-borc.md`'ye aktarılır.
