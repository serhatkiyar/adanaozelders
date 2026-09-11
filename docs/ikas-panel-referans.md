# ikas panel referansı — canlı panelden çıkarıldı

**Kaynak:** `adanaozelders.myikas.com/admin` canlı oturum, 11 Eyl 2026. Etiketler, yardım
metinleri, alan sırası ve düğme adları **birebir** buradan alındı — uydurma yok.

**Amaç:** Panel bu referansa göre kopyalanacak. Fark varsa referans doğrudur.

---

## 1. Sol menü (Sider)

Koyu lacivert, **dar** (~172px), her öğe **ikonlu**. Marka kilidi üstte (`⚡ ikas` logosu +
sağda daraltma düğmesi).

Öğeler (bu sırayla):

```
Giriş
Ürünler ▾
  Ürünler
  Satın Alma
  Transferler
  Stok Sayımı
  Tanımlamalar
  Fiyat Listesi
  Ürün Barkod Etiketi
Siparişler
Müşteriler
İndirimler
Gelen Kutusu
Pazarlama
Raporlar
Uygulamalar
Ayarlar
Satış Kanalları
```

**Alt blok** (menünün altına sabit):
- "Hak Edişler" + tutar (₺0,00)
- Kullanıcı kartı: yuvarlak avatar + ad (Serhat Kıyar) + mağaza adı (adanaozelders) + `⋮`

**Not:** ikas'ta ayrıca sider içinde promosyon kartları var (webinar, iyzads, alan adı) —
**bunlar kopyalanmayacak**, reklam alanı.

## 2. Sayfa yerleşimi

- **Üst bar YOK.** Sayfa başlığı doğrudan içeriğin içinde, sol üstte.
- Başlık satırı: `Ürünler` + yanında bilgi ikonu → "Detaylı Bilgi"
- Başlık satırının **sağında** aksiyonlar: `Dışa Aktar` (ikon+outline) · `İçe Aktar`
  (ikon+outline) · `Ürün Ekle` (dolgu, aksan rengi)
- **İçerik zemini BEYAZ.** Tablo bir kartın içinde DEĞİL; düz beyaz yüzey, satırlar ince
  ayırıcı çizgiyle.

## 3. Liste ekranı (Ürünler)

Araç çubuğu (tablonun üstünde):
- Solda: arama kutusu — placeholder **"Tabloda arama yapın"** (büyüteç ikonu içeride, sol)
- Solda arama yanında: `Filtre` düğmesi (ikonlu, outline)
- Sağda üç ikon düğmesi: kolon ayarı · liste görünümü · ızgara görünümü

Tablo:
- **İlk kolon: satır seçimi checkbox'ı** (başlıkta da var — tümünü seç)
- Kolonlar sırayla: **Ürün** (sıralanabilir) · **Satış Fiyatı** · **Alış Fiyatı** ·
  **Envanter** (sıralanabilir) · **Satış Kanalları**
- `Ürün` hücresi: solda küçük kare görsel/placeholder + ürün adı (tek satır, taşarsa `…`)
- `Satış Fiyatı`: `₺ 250,00` biçimi
- `Envanter`: `50 adet`
- `Satış Kanalları`: yeşil nokta + `1 Satış Kanalı ▾`

Alt bilgi (tablonun altı, solda):
- `Satır Adedi:` + seçici (20)
- `1 - 1 / 1 Ürün` biçiminde aralık/toplam

## 4. "Ürün Oluştur" — SAĞDAN ÇEKMECE (kritik fark)

`Ürün Ekle` düğmesi **tip seçimi penceresi AÇMAZ.** Sağdan bir çekmece açar.

Başlık: **Ürün Oluştur** + sağda `×`

Bölümler — her bölüm **gri şeritli başlık + altında açıklama satırı**:

**1) Ürün Detayları**
> Ürünün özelliklerini ve önemli bilgilerini buradan yönetin.
- `Ürün Görseli` — sürükle-bırak alanı, ortada ikon, metin:
  **"Ürün görselini bu alana sürükleyin veya yüklemek için tıklayın."**
- `Ürün Adı` * — metin girişi
- `Açıklama` — **zengin metin editörü**: araç çubuğunda `AI ile Yaz` düğmesi, ardından
  **B** / *I* / <u>U</u> / bağlantı / yazı rengi / sırasız liste / sıralı liste

**2) Satış Ayarları**
> Satışa başlamak için gerekli temel bilgileri girin.
- `Satış Fiyatı` — sayı girişi, `₺` eki
- `İndirimli fiyat girmek istiyorum` — onay kutusu
- `Stoksuz satmaya izin ver` — onay kutusu

**3) Kategori Seçimi**
> Ürünün ait olduğu kategoriyi belirleyin.
- Kategori yoksa boş durum:
  **"Henüz kategori oluşturmadınız. Ürünleri düzenlemek için ilk kategorinizi ekleyin."**
  + `Kategori Ekle` düğmesi

**Alt kısım:**
- Ortada bağlantı: `Gelişmiş Ürün Eklemeye Geç →`
- Alt bar: `Vazgeç` (outline) · `Kaydet ve Satışa Aç` (dolgu, aksan)

## 5. Bizim panelde DÜZELTİLECEKLER (fark listesi)

| # | ikas | Bizde şu an |
|---|---|---|
| 1 | Menü ikonlu, 17 öğe, ikas sırası | İkon yok, 15 öğe, kendi sıramız |
| 2 | Sider altında Hak Edişler + kullanıcı kartı | Yok |
| 3 | Sider dar (~172px) | 224px |
| 4 | Üst bar yok, başlık içerikte | Üst barda marka adı var |
| 5 | İçerik zemini beyaz, kart yok | Gri zemin + beyaz kart |
| 6 | Dışa Aktar / İçe Aktar / Filtre düğmeleri | Yok |
| 7 | Satır seçimi checkbox + görünüm anahtarları | Yok |
| 8 | Alış Fiyatı + Satış Kanalları kolonları, ürün thumbnail'i | Yok |
| 9 | "Satır Adedi:" + "1 - 1 / 1 Ürün" alt bilgisi | AntD varsayılan sayfalama |
| 10 | Ürün Ekle → sağdan **Ürün Oluştur çekmecesi** | Tip seçimi modalı → tam sayfa form |
| 11 | Çekmecede gri şeritli bölüm başlıkları + açıklama satırı | Yok |
| 12 | Açıklama için zengin metin editörü | Yok |
| 13 | "Gelişmiş Ürün Eklemeye Geç" geçişi | Yok |

## 6. Kopyalanmayacaklar (bilinçli)

- Aksan rengi: ikas **mor**, biz **kendi markamız** (`#FF9900`, `index.css` → `--marka`).
  Renk kopyalanmaz; yerleşim, tipografi ve mekanik kopyalanır.
- Sider promosyon kartları (webinar/iyzads/alan adı) — reklam.
- `AI ile Yaz` — bizde yapay zeka metin üretimi yok; editörün diğer araçları kalır.
- ikas'a özgü kavramlar: Satış Kanalları çoklu yapısı, Hak Edişler tutarı (bizde karşılığı
  varsa bağlanır, yoksa gösterilmez — uydurma veri YOK).

---

## 7. ÖLÇÜLEN DEĞERLER (canlı DOM + computed style, tahmin değil)

ikas AntD ile yazılmış; bu değerler `getComputedStyle` ile canlı panelden okundu.

### Tema token'ları
| Token | ikas | Not |
|---|---|---|
| `borderRadius` | **4px** | bizde 8 — düzeltilecek |
| `controlHeight` | **40px** | düğme, girdi, select hepsi 40 |
| `fontSize` | 14px | gövde metni |
| Aksan (ikas'ın moru) | `#6F55FF` | **kopyalanmaz**, bizim markamız kalır |

### Sider
| | Değer |
|---|---|
| Genişlik (açık) | **224px** |
| Genişlik (daraltılmış) | 72px |
| Zemin | **#000000** (tam siyah) |
| Menü öğesi yüksekliği | **36px** |
| Menü öğesi yazı rengi | **#ECECED** |
| Menü öğesi köşe yarıçapı | 4px · `paddingInline` 10px · `marginBlock` 0 0 4px |
| Seçili öğe zemini | **#2E2E33** |
| Seçili öğe yazı rengi | **#F8FAFC** · `fontWeight` 400 (kalın DEĞİL) |

### Sayfa
| | Değer |
|---|---|
| Gövde zemini | **#FFFFFF** |
| Kenarlık rengi | **#E3E8EF** |
| Ana metin rengi | **#121926** |
| İkincil/başlık metni | **#4B5565** |

### Düğmeler (hepsi `height: 40px`, `borderRadius: 4px`, `fontSize: 14px`, `fontWeight: 500`)
- Birincil: zemin aksan, yazı beyaz. **Not:** ikas `ant-btn-primary` kullanmıyor, `ant-btn-default`'u kendi stiliyle boyuyor — biz `type="primary"` kullanabiliriz, sonuç aynı.
- İkincil: zemin `#FFFFFF`, kenarlık `#E3E8EF`, yazı `#121926`.

### Liste
| | Değer |
|---|---|
| Kolon başlığı | 14px · `fontWeight 500` · renk **#4B5565** · zemin **yok** · yükseklik 40px · alt çizgi **yok** |
| Ürün adı hücresi | 14px · `fontWeight 500` · renk `#121926` · `ant-typography` **tek satır ellipsis** |
| Arama girdisi | yükseklik 40px · yarıçap 4px · kenarlık `#E3E8EF` · zemin beyaz |

### Kullanılan AntD bileşenleri (envanter, çoktan aza)
`Typography` (17) · `Button` (10) · `Col`/`Row` · `Menu` · `Avatar` · `Input` · `Checkbox` · `Form` · `Upload` · `Switch` · `App` · `Breadcrumb` · `Space` · `Pagination` · `Select` · `Drawer`

**Önemli:** `ant-table` **HİÇ YOK** — ikas'ın liste tablosu AntD `Table` değil, `Row`/`Col` ile kurulmuş div yapısı. Bizde `Table` kalabilir (sıralama/sayfalama onunla geliyor) ama **görünümü** yukarıdaki değerlere çekilecek: başlıkta zemin yok, ince ayırıcı, 40px satır yüksekliği.

**Dikkat:** Önceki referans notlarında sider genişliği ~172px tahmin edilmişti — **yanlış**, o daraltılmış hâlin (72px) yanlış okunmasıydı. Doğrusu **224px**.

### Liste — İKİNCİ TUR ÖLÇÜM (DOM sınıfı `data-table-row`, düzeltme)

§7'nin ilk liste tablosu iki noktada YANLIŞTI; canlı DOM'dan yeniden okundu:

| | Değer | Düzeltme notu |
|---|---|---|
| Başlık satırı zemini | **#EEF2F6** (açık gri) | önce "zemin yok" yazmıştım — YANLIŞ |
| Başlık satırı yüksekliği | 40px · alt çizgi **yok** | doğruydu |
| Veri satırı yüksekliği | **69px** | önce "40px satır" demiştim — YANLIŞ; yükseklik hücre dolgusundan geliyor |
| Veri satırı zemini | #FFFFFF | |
| Veri satırı ayırıcısı | `border-bottom: 0.8px solid transparent` → **görünür ayırıcı ÇİZGİ YOK** | önce "ince ayırıcı çizgi" demiştim — YANLIŞ |
| Hücre dolgusu | **16px 12px** (ürün hücresi `16px 12px 16px 0`) | |
| Başlık hücresi dolgusu | 0 12px | |
| Kolon genişlikleri | seçim 40px · Ürün 240px · diğerleri 200px | satır toplam 1080px, sağda 24px boşluk |
| Köşe yarıçapı | satır/tablo 0px | tablo bir kart DEĞİL |
| Ürün adı | 14px · 500 · #121926 · tek satır ellipsis | |
| Fiyat/envanter hücresi | 14px · #121926 | |
| Alt bilgi | 14px · #4B5565 · "Satır Adedi: 20" + "1 - 1 / 1 Ürün" | |

### Sider menüsü — İKİNCİ TUR ÖLÇÜM

| | Değer |
|---|---|
| Kök öğe ikonu | **16×16** (`<span>` sarmalı içinde) — **YALNIZ kök öğelerde** |
| Alt öğe ikonu | **YOK** (Ürünler altındaki 7 alt öğede ikon yok) |
| Menü yazısı | 14px · `fontWeight 500` · **#ECECED** |
| Kök öğe `paddingLeft` | 10px · `fontWeight` 400 (açılır başlık) |
| Alt öğe | yükseklik **36px** · `paddingLeft` **34px** · yazı **#F8FAFC** |

### Başlık satırı ve araç çubuğu — ÖLÇÜLEN

**Metin düğmeleri** (Dışa Aktar · İçe Aktar · Ürün Ekle · Filtre):
yükseklik **40px** · yarıçap **4px** · dolgu **0 16px** · 14px · `fontWeight 500`
· kenarlık **0.8px solid #E3E8EF** · ikincil zemin #FFFFFF, yazı #121926
· birincil zemin = aksan, yazı beyaz, kenarlık aksanla aynı renk
· genişlik içeriğe göre (126 / 117 / 98 / 89 px — sabit genişlik verilmemiş)

**İkon düğmeleri** (kolon ayarı · liste görünümü · ızgara görünümü):
**32×32** · zemin **şeffaf** · kenarlık **yok** · yarıçap **2px** · dolgu 8px
· etkin olan #121926, etkin olmayan #697586

**Arama girdisi:** genişlik **397px** (sabit, esnek değil) · yükseklik **40px**
· placeholder **"Tabloda arama yapın"** · büyüteç ikonu içeride solda
