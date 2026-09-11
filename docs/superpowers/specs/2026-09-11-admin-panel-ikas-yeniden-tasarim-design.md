# Admin Paneli — Sıfırdan Yeniden Tasarım (ikas referanslı)

**Tarih:** 11 Eylül 2026
**Durum:** Tasarım onaylandı (bilgi mimarisi + ekran anatomisi + teknik kurulum). Uygulama planı bekliyor.
**Kapsam:** ADMIN yönetim paneli arayüzü. Backend API'leri, iş mantığı ve yetki sistemi değişmez.

---

## 1. Bağlam ve amaç

Mevcut `/yonetim` paneli 47 rotaya yayılmış, tutarsız ve kullanıcı tarafından kullanılamaz bulunuyor ("tasarımlarımız çöp"). Panel daha önce bir kez Medusa Admin referansıyla yenilenmeye çalışılmış (`docs/tasarim-dili.md`, İP-A göç dalgaları, İP-B1/B2 — hepsi main'de) ama sonuç tatmin etmedi.

Bu turda **ikas** (Türk e-ticaret SaaS) admin paneli canlı olarak incelendi (bkz. `docs/ikas-admin-panel-arastirmasi.md`). Tespit: ikas'ın ekranlarının kalitesi büyük ölçüde **Ant Design** bileşenlerinden ve tutarlı tekrar eden desenlerden geliyor — her ekranı elle kurmaktan değil.

**Karar:** Yeni ADMIN paneli, ikas'ın modül organizasyonu ve etkileşim desenleri referans alınarak **sıfırdan** kurulacak. Mevcut panelin tasarımı referans alınmayacak; yalnızca **hangi işlevlerin var olduğu** envanter olarak kullanılacak.

## 2. Kapsam

**Dahil:** ADMIN paneli (15 modül, aşağıdaki bilgi mimarisi), panel kabuğu, ortak ekran bileşenleri, tema, mobil uyum.

**Hariç:** Storefront (müşteri-yüzü site, Tailwind'de kalır); TUTOR/CLIENT/LIBRARY_OPERATOR/COURIER panelleri (sonraki iş); backend değişikliği; yeni iş mantığı.

**Eski panelin kaderi:** Geliştirme sırasında `/yonetim` çalışmaya devam eder (yönetim işleri durmasın); yeni panel geçici olarak `/yonetim-yeni` kökünde gelişir. Yeni panel tamamlandığında `/yonetim` kökünü devralır ve **eski kod silinir**. Eskiye yama yapılmaz, karma görünüm hiçbir aşamada kullanıcıya gösterilmez.

## 3. Kararlar

| Konu | Karar | Gerekçe |
|---|---|---|
| Bileşen kütüphanesi | **Ant Design v5** (yalnız panelde) | ikas'ın görünümünün kaynağı; Table/Drawer/Modal/Tabs/Form hazır; CSS-in-JS olduğu için Tailwind ile birlikte yaşayabilir |
| Dil paketi | `ConfigProvider locale=tr_TR` | Tablo/sayfalama/tarih metinleri hazır Türkçe |
| Aksan rengi | **Marka turuncusu `#C2410C`** | ikas'ın mantığı "nötr zemin + tek aksan"; aksan bizim markamız olur. (İP-B1'deki "marka lacivert" açık kararı bu spec ile turuncu olarak kapanır.) |
| Mobil | Zorunlu, AntD kırılımları (576/768/992/1200) | ikas admin'i responsive (18 kırılım, `user-scalable=no` doğrulandı); kurye/operatör sahada telefondan çalışıyor |
| Rol kapsamı | Yalnız ADMIN | ikas tek rollü; diğer roller ayrı ele alınacak |
| Storefront | Dokunulmaz | Ayrı dünya, Tailwind'de kalır |

## 4. Bilgi mimarisi (onaylandı)

`★` ikas'ta karşılığı var · `▲` bize özgü (ikas'ta yok, aynı desenle kurulacak)

```
Giriş                ★ dashboard (metrik kartları)
Ürünler              ★
  ├─ Ürünler         ★
  ├─ Satın Alma      ★
  ├─ Stok Sayımı     ★
  ├─ Stok Hareketleri  (bizim append-only defter)
  ├─ Hasarlı Stok    ▲
  └─ Tanımlamalar    ★ kategoriler · varyant türleri · kişiselleştirme · etiketler
Siparişler           ★ siparişler · iadeler · paketleme▲
Dağıtım              ▲ tahta · turlar · dağıtım siparişleri · kuryeler · araçlar · performans
Müşteriler           ★
Dersler              ▲ rezervasyonlar (ders booking) · talepler (açık ders ilanı)
Eğitmenler           ▲ eğitmenler · başvurular · diplomalar · ad değişiklikleri
Kütüphaneler         ▲ kütüphaneler · deneme katalogları (TYT/AYT/LGS…)
İndirimler           ★ kuponlar · öne çıkarmalar (eğitmen reklamı)▲
Moderasyon           ▲ şikayetler
Finans               ▲ hakedişler
Raporlar             ★
Satış Kanalı (site)  ★ vitrin görselleri · blog
Ayarlar              ★ genel · personel & yetkiler · denetim kayıtları · hata çözme
```

### Mevcut 47 rotanın eşlemesi

| Yeni modül | Devralınan mevcut rotalar |
|---|---|
| Giriş | `/yonetim` |
| Ürünler | `magaza/urunler`, `magaza/kategoriler`, `magaza/tedarikci`, `envanter`, `envanter/sayimlar(+/:id)`, `envanter/hareketler`, `magaza/stok-hareketleri`, `envanter/hasar` |
| Siparişler | `magaza/siparisler`, `magaza/iadeler`, `paketleme`, `paketleme/paketler`, `paketleme/paket/:id`, `paketleme/iade` |
| Dağıtım | `dagitim`, `/tahta`, `/turlar(+/:id)`, `/siparisler`, `/kuryeler`, `/araclar`, `/performans` |
| Müşteriler | `kullanicilar`, `kullanicilar/:role/:id` |
| Dersler | `rezervasyonlar`, `talepler` |
| Eğitmenler | `egitmenler`, `egitmen-basvurulari`, `diplomalar`, `ad-degisiklikleri` |
| Kütüphaneler | `kutuphaneler`, `deneme-kataloglari` |
| İndirimler | `magaza/kuponlar`, `one-cikarmalar` |
| Moderasyon | `moderasyon/sikayetler` |
| Finans | `hakedisler` |
| Satış Kanalı | `vitrin-gorselleri`, `blog(+/yeni, /:postId)` |
| Ayarlar | `ayarlar`, `yetkiler`, `denetim-kayitlari`, `hata-cozme` |

**Not:** `magaza` kökü ve `envanter` kökü artık ayrı menü değil — içerikleri Ürünler/Siparişler altına dağıtıldı. `magaza/stok-hareketleri` ile `envanter/hareketler` aynı işi yapıyorsa uygulamada **tek ekrana** indirilir (uygulama sırasında doğrulanacak).

## 5. Ekran anatomisi (onaylandı)

**Kabuk:** `Layout.Sider` (koyu, collapse edilebilir; mobilde `Drawer`) + üst bar (breadcrumb/başlık + birincil aksiyonlar) + `Card` tabanlı içerik.

**Liste ekranı** (tüm modüllerde aynı iskelet):
```
[Başlık ⓘ]                      [Dışa Aktar] [İçe Aktar] [+ Ekle]
[🔍 ara]  [⚙ Filtre]                      [kolon] [liste|grid]
Table: seçim · sıralanabilir kolon · satır aksiyonu (⋯)
Satır Adedi: 20 ▾                         1-20 / N kayıt
```
Boş durumda `Empty`: ikon + başlık + açıklama + birincil buton.

**Form ekranı:** tek sayfa + üstte yatay `Tabs` (Temel Bilgi · Medya · Detay · Envanter · SEO · Özel Alanlar · Özelleştirme), her sekme bir `Card`, üst bar sabit (`[← ] Başlık … [İkincil Kaydet] [Kaydet]`). **Çok menüye bölme yok.**

**Yan pencere:** `Drawer` sağdan ~480px (mobilde tam ekran), altta sabit `[Vazgeç] [Kaydet]` — varyant ekleme, hızlı düzenleme, kural ekleme.

**Tip seçimi:** `Modal` + seçenek kartları (Basit/Varyantlı/Paket deseni).

**Matris:** `Table` + satır içi düzenlenebilir hücreler (fiyat/SKU/barkod/stok).

**Bileşen eşlemesi**

| Desen | Ant Design |
|---|---|
| Kabuk / menü | `Layout`, `Menu`, `Drawer` |
| Liste | `Table`, `Input.Search`, `Dropdown`, `Pagination`, `Empty` |
| Form | `Tabs`, `Card`, `Form`, `Input`, `Select`, `Upload`, `Switch`, `DatePicker` |
| Yan pencere | `Drawer` |
| Tip seçimi | `Modal` |
| Matris | `Table` (editable cells) |
| Geri bildirim | `message`, `notification`, `Popconfirm` |

## 6. Teknik kurulum (onaylandı)

**Paketler:** `antd@5`, `@ant-design/icons`, `dayjs`.

**Tailwind çakışması (ilk doğrulama adımı):** AntD v5 global reset dayatmaz ama Tailwind `preflight` buton/input'ta çakışabilir. Çözüm sırası: (1) `StyleProvider hashPriority="high"`, (2) AntD stillerini CSS `@layer`'a almak, (3) son çare panel rotasında preflight kapatmak. **Ekran yazmadan önce çalıştığı kanıtlanacak.**

**Tema:** `frontend/src/panel/theme.ts` → tek kaynak. Aksan `#C2410C`, nötr zemin, ferah padding, yumuşak radius, koyu Sider.

**Klasör:**
```
frontend/src/panel/
  layout/      PanelShell (Sider + Header + Content + mobil Drawer)
  components/  ListePage · FormPage · YanPencere · TipSecimi · Matris · durum bileşenleri
  pages/       urunler/ siparisler/ dagitim/ dersler/ egitmenler/ kutuphaneler/ …
  theme.ts
```
**Ortak bileşenler bir kez yazılır**; 15 modül aynı iskeleti kullanır — tutarsızlığın kökü böyle kesilir.

**Korunanlar:** backend API'leri, `api/axios.ts`, React Query hook'ları, yetki sistemi (`adminAccess`, izin kodları), tip tanımları, `lib/routes.ts` (yeni rotalar eklenir; rota kaynağı tek kalır).

**Rota:** Geliştirme kökü **`/yonetim-yeni`** (`/panel` zaten dolu — `/panel/rezervasyonlar` mevcut). Eski `/yonetim` bozulmadan çalışmaya devam eder. Tamamlanınca yeni panel `/yonetim` kökünü devralır, `/yonetim-yeni` kaldırılır ve eski panel kodu silinir. Rota tanımları tek kaynak `lib/routes.ts`'de yaşar.

## 7. Pilot: Ürünler modülü

Pilotun kapsamı (tüm desenleri içerir, sonra kopyalanır):
1. **Ürün listesi** — Table + arama + filtre + kolon/görünüm + sayfalama + boş durum
2. **"Ürün Ekle" modalı** — Basit / Varyantlı (Paket sonraki faz)
3. **Tek-sayfa sekmeli ürün formu** — Temel Bilgi · Medya · Detay · Envanter · SEO
4. **Varyant drawer'ı** — eksen adı + seçim stili + değerler
5. **Kombinasyon matrisi** — satır içi fiyat/SKU/barkod/stok
6. **Kabuk + tema** — Sider/Header/Content, mobil Drawer, token

## 8. Doğrulama

- **Kurulum kapısı:** AntD + Tailwind bir arada bozulmadan render ediyor (buton/input/tablo görsel kontrol).
- **Pilot kapısı:** Ürün listesi ve formu gerçek API ile çalışıyor (ürün oluşturma/düzenleme uçtan uca), mobil genişlikte (390px) kullanılabilir.
- Mevcut testler kırılmamalı; yeni ekranlar için kritik davranış testleri (yetki, form doğrulama) yazılır. Her paket sonunda gerçek tarayıcıda duman turu.
- Paket paket onay: her modül bitiminde kullanıcıya gösterilir (proje kuralı).

## 9. Riskler ve açık kararlar

| Konu | Durum |
|---|---|
| AntD + Tailwind çakışması | Kurulumun ilk adımında doğrulanacak; başarısızsa panel rotasında preflight kapatılır |
| İki UI sistemi bakım yükü | Kabul edildi: panel AntD, storefront Tailwind — sınır net |
| `envanter/hareketler` vs `magaza/stok-hareketleri` | Aynı işi yapıyorlarsa tek ekrana indirilecek (uygulamada doğrulanacak) |
| ikas'ta olup bizde olmayanlar: **Transferler, Fiyat Listesi, Ürün Barkod Etiketi** | Bu spec'in kapsamı dışında (yeni iş mantığı gerektirir); ayrı değerlendirilecek |
| ikas'ta stok hareket defteri ayrı ekran mı | Doğrulanamadı (panelde alt menü açılamadı); bizim defterimiz korunuyor |
| Eski panelin silinmesi | Yeni panel tamamlanınca; yarım bırakılmayacak |

## 10. Kapsam dışı (YAGNI)

Çok dil, çok satış kanalı, pazarlama otomasyonu, uygulama pazarı, eski panelin kademeli düzeltilmesi, diğer 4 rolün panelleri.
