# Cıncık Teslimat 2.0 — Ekran Tasarımları (Wireframe Spec)

**Doküman türü:** Screen Design Specification — wireframe seviyesi, görsel tasarım öncesi
**Kaynak:** `delivery-experience-design.md` (PDS v2) — bileşen no'ları §7.2'ye, edge case no'ları §12'ye, akış no'ları §5'e referans verir
**Kapsam:** 28 ekran — Müşteri 13 · Kurye 7 · Operasyon 8
**Tarih:** Temmuz 2026

---

## 0. Okuma Kılavuzu

### Notasyon

```
┌──┐ çerçeve/kart      [Buton]  birincil aksiyon     [ Buton ]  ikincil
(çip)  seçilebilir çip  ◉ / ○  radio                 ☑ / ☐  checkbox
▢  görsel/foto alanı    ●──○  timeline noktaları      ⌄ / ⌃  katlanır bölüm
⠿  sürükleme tutamacı   ⚠  amber talimat/uyarı bandı  ⋮  taşma menüsü
🔒 kilitli/disabled     ~~~ skeleton bloğu             ═ saç-teli ayraç
```

### Breakpoint'ler

| Yüzey | Taban | Davranış |
|---|---|---|
| Müşteri (web SPA) | 375 px mobil taban | ≥768: içerik 720 px orta kolonda; sheet'ler ≥1024'te ortalanmış modal olur (max-w 480) |
| Kurye (mobil PWA) | 375–430 px, yalnız dikey | Responsive varyant yok — tek el, alt-bölge yerleşimi; ≥768 desteklenmez |
| Operasyon (masaüstü) | 1440 px taban, min 1024 | <1280: harita/kuyruk split'i dikey stack'e döner; mobil desteklenmez (saha ekranı kuryenindir) |

### Global durum kalıpları (ekranlar yalnız FARKINI yazar)

- **Loading:** içerik iskeleti (`~~~`), spinner yok, layout kaymaz (yükseklikler rezerve).
- **Empty:** `SystemState` — ikon + tek cümle + tek aksiyon.
- **Error:** satır-içi hata + [Tekrar dene]; sayfa-kırıcıda `SystemState`; asla boş beyaz.
- **Offline:** tepede `SystemState` offline şeridi + son veri %8 soluk + "son güncelleme HH:MM"; aksiyonlar kuyruklanır ya da nedenli disabled.
- **Success:** varsayılan tasarım.

### A11y tabanı (her ekranda geçerli; ekranlar yalnız deltasını yazar)

Dokunma hedefi müşteri ≥44 px / kurye ≥56 px; kontrast metin ≥4.5:1 (iki temada); durum = ikon + metin + renk (renk tek taşıyıcı değil); sheet'lerde focus trap + `Esc` + odak iadesi; saatler `<time>`; `prefers-reduced-motion` tüm animasyonları kapatır.

---

## 1. Customer Delivery Experience (M1–M13)

### M1 · Ürün Sayfası — Teslimat Bloğu (MVP)

**Amaç:** Satın alma kararı anında teslim sözünü göstermek. | **Kullanıcı hedefi:** "Ne zaman elimde olur?" sorusuna sayfadan ayrılmadan cevap almak.

```
┌─────────────────────────────────────┐
│ 🚚  Çarşamba kapında                │
│     Bugün 16:00'ya kadar sipariş    │
│     ver — (⏱ 2 sa 14 dk kaldı)      │
│ ─────────────────────────────────── │
│ Adana içi kendi kuryemizle ⓘ        │
└─────────────────────────────────────┘
```

```
DeliveryPromiseBlock/
├─ PromiseDisplay (variant: gün-rozeti)
│  ├─ Icon(truck) + Başlık("Çarşamba kapında")
│  ├─ AltSatır(cutoff cümlesi) + CountdownChip
│  └─ ═ ayraç + BölgeSatırı + InfoTrigger(ⓘ)
```

- **Layout:** Ürün bilgi kolonunda fiyatın altında tek kart; saç-teli çerçeve, gölge yok. İç dikey boşluk 16, satır arası 4.
- **Responsive:** ≥768 ürün sayfasının sağ satın-alma kolonunda; genişlik kolonu doldurur.
- **Durumlar:** L: iki satır `~~~` iskelet, yükseklik sabit (72 px) · E: — (blok her zaman veri taşır) · Er: **blok tamamen gizlenir** — yanlış söz > söz yok (PDS §8.1) · O: son bilinen söz + soluk, geri sayım donar · S: varsayılan.
- **Edge:** Cutoff geçti → başlık sonraki güne kayar, geri sayım "yarın 16:00'ya kadar" olur (E1) · Gün kapasitesi doldu → aynı davranış, ekstra açıklama yok (E2 — müşteriye "kapasite" kelimesi gösterilmez) · Dijital ürün → blok yerine "Anında teslim" varyantı.
- **Aksiyonlar:** ⓘ dokunuşu → küçük popover: bölge, cutoff kuralı, "sipariş sonrası ertele/tercih değiştirebilirsin".
- **Mikro etkileşimler:** Geri sayım dakikada bir günceller (saniye gösterilmez — telaş üretir).
- **Animasyonlar:** Yok — bu blok sakin bir bilgi yüzeyidir.
- **A11y:** Blok `role="status"` değil (sayfa yüklemesinde okunur, canlı bölge değil); geri sayım `aria-label`'da tam cümle ("bugün 16:00'ya kadar sipariş verirsen Çarşamba teslim").

---

### M2 · Checkout — Adres Adımı (MVP)

**Amaç:** Teslim noktasını pin hassasiyetinde almak. | **Kullanıcı hedefi:** Adresini en az çabayla doğru girmek; kuryeye kapıyı tarif etmek.

```
┌─────────────────────────────────────┐
│ ← Teslimat adresi            (1/3)  │
├─────────────────────────────────────┤
│ ◉ Ev — Kurttepe Mah. …   [Düzenle]  │
│ ○ Yurt — Sarıçam …       [Düzenle]  │
│ ─────────────────────────────────── │
│ + Yeni adres ekle                   │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │        HARİTA                   │ │
│ │          📍 (sürüklenebilir)    │ │
│ │              [◎ Konumumu bul]   │ │
│ └─────────────────────────────────┘ │
│ Pin teslim noktandır — kapına koy   │
├─────────────────────────────────────┤
│ Kapı tarifi (kuryene not)           │
│ ┌─────────────────────────────────┐ │
│ │ zil bozuk, 3. kat — arayın      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [        Devam et        ]          │
└─────────────────────────────────────┘
```

```
CheckoutAddressStep/
├─ StepHeader(geri + başlık + adım sayacı)
├─ SavedAddressList/ → AddressRow(radio + özet + Düzenle)
├─ AddNewAddressLink
├─ AddressPinEditor/
│  ├─ MapCanvas + DraggablePin + LocateMeButton
│  └─ PinHelperText
├─ DoorNoteField(label + textarea, 200 karakter)
└─ PrimaryButton(Devam)
```

- **Layout:** Tek kolon, bölümler saç-teli ile ayrık; harita 4:3 oran, min 220 px yükseklik. Devam butonu alta sabit (sticky) — içerik altına 88 px padding.
- **Responsive:** ≥768 iki kolon: sol adres listesi + kapı tarifi, sağ harita (sticky).
- **Durumlar:** L: adres satırları 2×`~~~`; harita gri placeholder · E: kayıtlı adres yok → liste yerine doğrudan yeni-adres formu açık gelir · Er: geocode servisi düştü → arama alanı gizlenir, elle adres + pin zorunlu kalır (M2 kırılmaz); pin ters-geocode boş dönerse adres metni elle istenir (A8) · O: harita tile'ları önbellekten; pin oynatma disabled + "bağlantı gelince dene" · S: seçili adresin pini haritada, Devam aktif.
- **Edge:** Pin ↔ metin adresi >300 m → sarı uyarı satırı "Pinin yazdığın adresten uzakta — kontrol et" (A1); Devam engellenmez, uyarı loglanır · Konum izni reddedildi → [◎] gizlenir, arama/sürükleme akışı tam çalışır (A7) · Bölge dışı pin → Devam'da bilgilendirme ekranı: "Bu adres teslimat bölgemizin dışında" + dış kargo notu (F6).
- **Aksiyonlar:** Adres seç (radio), düzenle, yeni ekle, pin sürükle, konumumu bul, kapı tarifi yaz, devam.
- **Mikro etkileşimler:** Pin bırakılınca adres metni alanı yumuşakça güncellenir + 1 sn "adres pinden güncellendi" mikro-metni; kapı tarifi alanında kalan karakter sayacı yalnız >150'de belirir.
- **Animasyonlar:** Pin bırakma: 150 ms yerleşme (drop) hareketi; harita kamerası pine 250 ms pan.
- **A11y:** Harita klavye alternatifi: adres arama + "pini adrese hizala" butonu; pin sürükleme dokunma dışı kullanıcı için ok tuşlarıyla 10 m adım; kapı tarifi `aria-describedby` ile "kuryenin göreceği not" açıklaması.

---

### M3 · Checkout — Teslimat Adımı (MVP)

**Amaç:** Tercih ön-seçimi + sözün teyidi. | **Kullanıcı hedefi:** Paketi nasıl teslim alacağını 5 saniyede seçmek.

```
┌─────────────────────────────────────┐
│ ← Teslimat tercihi           (2/3)  │
├─────────────────────────────────────┤
│ 🚚 Çarşamba kapında                 │
├─────────────────────────────────────┤
│ ◉ Adresteyim (elden teslim)         │
│   SMS kodunla kuryeye teslim        │
│ ─────────────────────────────────── │
│ ○ Kapıya bırak                      │
│   Fotoğraflı kanıt cebine gelir     │
│ ─────────────────────────────────── │
│ ○ Komşuya ver            (V2)       │
│ ○ Beni ara               (V2)       │
├─────────────────────────────────────┤
│ ⓘ Fikrini teslim anına kadar        │
│   değiştirebilirsin                 │
│                                     │
│ [        Ödemeye geç       ]        │
└─────────────────────────────────────┘
```

```
CheckoutDeliveryStep/
├─ StepHeader
├─ PromiseDisplay (variant: kompakt teyit)
├─ PrefRadioGroup/ → PrefOptionRow(radio + başlık + açıklama satırı) ×2 (V2: ×4)
├─ ReassuranceNote(değiştirilebilirlik)
└─ PrimaryButton(Ödemeye geç)
```

- **Layout:** Tek kolon; tercih satırları 64 px yükseklik, radio solda, iki satır metin. Yüksek değerli siparişte kapıya-bırak satırı kilitli.
- **Responsive:** ≥768 checkout orta kolonunda (max 560).
- **Durumlar:** L: söz satırı `~~~` · E: — · Er: söz servisi düşerse rozet gizlenir, tercih akışı çalışır · O: seçim yerelde tutulur, ödemeye geçiş bağlantı ister · S: son siparişin tercihi ön-seçili + "geçen seferki tercihin" mikro-etiketi (V2).
- **Edge:** Yüksek değerli sipariş → "Kapıya bırak" 🔒 + neden satırı: "Bu siparişin değeri nedeniyle elden teslim gerekli" (PDS §3.3) · Bölge dışı adresle gelindi → bu adım atlanır, dış kargo bilgilendirmesi gösterilir.
- **Aksiyonlar:** Tercih seç, ödemeye geç, geri.
- **Mikro etkileşimler:** Radio seçimi optimistic — anında işaretlenir (150 ms); seçilen satırın açıklaması bir ton koyulaşır.
- **Animasyonlar:** Yok.
- **A11y:** RadioGroup `fieldset/legend`; kilitli seçenek `aria-disabled` + neden `aria-describedby`; V2 rozeti ekran okuyucuya "yakında" olarak okunur.

---

### M4 · Sipariş Onayı (MVP)

**Amaç:** Sözü mühürlemek ve sonrasını anlatmak. | **Kullanıcı hedefi:** "Tamam, sipariş verdim — şimdi ne olacak?" güveniyle sayfadan ayrılmak.

```
┌─────────────────────────────────────┐
│              ✓                      │
│      Siparişin alındı               │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 🚚  Çarşamba kapında            │ │
│ │     Tercihin: Kapıya bırak      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ●  Sipariş alındı        14:32      │
│ ○  Hazırlanıyor                     │
│ ○  Yolda            Çrş bekleniyor  │
│ ○  Teslim           Çrş bekleniyor  │
│                                     │
│ Çarşamba sabahı sana saat aralığını │
│ bildireceğiz.                       │
│                                     │
│ [    Siparişimi görüntüle    ]      │
│ [       Mağazaya dön         ]      │
└─────────────────────────────────────┘
```

```
OrderConfirmation/
├─ SuccessMark(✓ çizim animasyonlu)
├─ PromiseDisplay (variant: büyük) + tercih satırı
├─ DeliveryTimeline (ilk adım done, gelecek adımlar tahminli)
├─ NextStepCopy
└─ ButtonGroup(birincil + ikincil)
```

- **Layout:** Ortalanmış tek kolon, max 480; ✓ işareti 64 px.
- **Responsive:** Değişmez (ortalanır).
- **Durumlar:** L: ödeme dönüşü doğrulanırken tam-ekran "Ödemen doğrulanıyor…" ara durumu (skeleton değil — tek istisna: kritik bekleme, belirsiz spinner + açıklama) · E/Er: ödeme doğrulanamadı → `SystemState`: "Ödemeni doğrulayamadık" + [Tekrar dene] + destek yolu; sipariş oluşmadıysa sepete iade · O: onay yerelde gösterilir, timeline "senkronlanacak" notlu · S: varsayılan.
- **Edge:** Hibrit sepet → timeline'da dijital kalem ayrı satır: "PDF'in hazır — [İndir]" (C6) · Çoklu paket kararı sonradan verilir; onayda tekil dil kullanılır.
- **Aksiyonlar:** Siparişi görüntüle, mağazaya dön.
- **Mikro etkileşimler:** —
- **Animasyonlar:** ✓ tek kalem SVG çizimi 600 ms; timeline ilk noktası dolumu 600 ms gecikmeli başlar (sıralı anlatı).
- **A11y:** Sayfa başlığı odağı alır ("Siparişin alındı" `h1` + `tabindex="-1"` focus); animasyonlar reduced-motion'da statik.

---

### M5 · Siparişlerim (MVP)

**Amaç:** Tüm siparişlerin durumunu tek bakışta okutmak. | **Kullanıcı hedefi:** Aktif siparişini bulup detayına inmek.

```
┌─────────────────────────────────────┐
│ Siparişlerim                        │
│ (Aktif)  ( Geçmiş )                 │
├─────────────────────────────────────┤
│ ▢  Fizik Soru Bankası +1     >      │
│    [● Yolda]  Bugün 13:00–18:00     │
│ ─────────────────────────────────── │
│ ▢  YKS Deneme Seti           >      │
│    [○ Hazırlanıyor]  Perşembe       │
│ ─────────────────────────────────── │
│ ▢  TYT Matematik             >      │
│    [✓ Teslim edildi]  9 Tem         │
└─────────────────────────────────────┘
```

```
OrdersList/
├─ PageHeader + SegmentControl(Aktif | Geçmiş)
└─ OrderRow/ ×n
   ├─ Thumbnail(▢ 48px) + Başlık(+n kalem)
   ├─ StatusPill + PromiseDisplay(satır varyantı: söz/pencere/tarih)
   └─ Chevron
```

- **Layout:** Satır yüksekliği 76 px; kutu yok — satırlar saç-teli ile ayrık (sakin liste).
- **Responsive:** ≥768: 720 px kolon; satır düzeni aynı (kart grid'ine ÇEVRİLMEZ — tarama listesi kalır).
- **Durumlar:** L: 3×`~~~` satır iskeleti · E(Aktif): "Aktif siparişin yok" + [Mağazaya git]; E(Geçmiş): "Henüz siparişin yok" · Er: `SystemState` + tekrar dene · O: son liste soluk + şerit · S: varsayılan.
- **Edge:** Teslim günü satırı: söz yerine pencere gösterir ("Bugün 13:00–18:00") — liste, detay açmadan günü planlatır · İade sürecindeki sipariş: `StatusPill` "İade — kontrolde".
- **Aksiyonlar:** Segment değiştir, satıra dokun → M6.
- **Mikro etkileşimler:** Segment geçişi içerik cross-fade 150 ms; pull-to-refresh (mobil).
- **Animasyonlar:** Liste girişinde animasyon yok (tarama yüzeyi).
- **A11y:** Satır tek dokunma hedefi (`<a>` bütünü); pill + tarih tek `aria-label` cümlede ("Yolda, bugün 13 ile 18 arası teslim").

---

### M6 · Sipariş Detayı (MVP — ekranın sahibi)

**Amaç:** Siparişle ilgili her şeyin evi; duruma göre şekil değiştiren adaptif yüzey. | **Kullanıcı hedefi:** Durumu görmek ve gerekiyorsa aksiyon almak (tercih/ertele/adres/iptal/iade).

```
┌─────────────────────────────────────┐
│ ← Sipariş #1042                  ⋮  │
├─────────────────────────────────────┤
│ [● Yolda]                           │
│ ┌─────────────────────────────────┐ │
│ │ 🚚 Bugün 13:00–18:00 arası      │ │   ← duruma göre:
│ │    (V2: canlı blok → M8)        │ │     söz kartı / pencere /
│ └─────────────────────────────────┘ │     kanıt kartı (teslim sonrası)
│                                     │
│ (Kapıya bırak ✓) (Ertele) (Adres)   │   ← ActionChipRow
│ (Kapı tarifi)                       │
├─────────────────────────────────────┤
│ ●  Sipariş alındı     Sal 14:32     │
│ ●  Hazırlanıyor       Sal 15:10     │
│ ●  Yolda              Bugün 13:05   │
│ ○  Teslim             13–18 arası   │
│ ⌄  Tüm hareketler                   │
├─────────────────────────────────────┤
│ Paketler: [1/1]  ▢ 2 kalem       ⌄  │
├─────────────────────────────────────┤
│ Teslimat: Ev — Kurttepe… 📍         │
│ Tercih: Kapıya bırak                │
├─────────────────────────────────────┤
│ Siparişi iptal et                   │
└─────────────────────────────────────┘
```

```
OrderDetail/
├─ Header(geri + sipariş no + ⋮ menü)
├─ StatusPill + AdaptiveHeroSlot/
│  ├─ (PAID) PromiseDisplay: gün sözü
│  ├─ (gün sabahı) PromiseDisplay: blok pencere
│  ├─ (SHIPPED, V2) LiveBlockPreview → M8'e açılır
│  └─ (DELIVERED) ProofCard kompakt → M11'e açılır
├─ ActionChipRow(tercih✓ · ertele · adres · tarif)
├─ DeliveryTimeline + CollapsibleAllEvents
├─ PackagesSection(StatusPill paket varyantı + kalemler ⌄)
├─ DeliveryInfoSection(adres 📍 + tercih özeti)
└─ DangerZone(iptal linki — buton değil, sakin metin)
```

- **Layout:** Bölümler saç-teli ile ayrık tek kolon; hero slot her durumda aynı dikey konumda (layout kayması yok). Çipler yatay kaydırılabilir tek satır.
- **Responsive:** ≥768: 720 px kolon; ≥1024: hero + timeline sol (60%), paket/adres sağ (40%) iki kolon.
- **Durumlar:** L: hero + 4 timeline satırı iskelet · E: — · Er: bölüm bazlı — timeline yüklenemezse yalnız o bölümde satır-içi hata, hero ayakta kalır · O: şerit + son veri; çipler disabled ("bağlantı gelince") · S: duruma adaptif.
- **Edge:** FAILED sonrası → timeline'da amber "Teslim edilemedi — Çrş 17:40" satırı KALIR, hero "Yarın yeniden geleceğiz" + (Ertele) çipi vurgulu (B1) · RESCHEDULED → "Senin isteğinle Perşembe'ye alındı" · Erteleme hakkı bitti → (Ertele) çipi disabled + neden tooltip (B8) · Kargoya çıktıysa iptal linki gizlenir → yerinde "İade et" (teslim sonrası) · Çoklu paket → paket bölümü rozetli satırlara açılır, timeline olayları "Paket 1/2" etiketli (C3) · Dijital kalem → kendi satırı + [İndir] (C6).
- **Aksiyonlar:** Çipler (→ M9/M10/adres akışı/tarif düzenle), tüm hareketler ⌄, paketler ⌄, iptal → M7, teslim sonrası: kanıt → M11, iade → M12.
- **Mikro etkileşimler:** Çip seçimi optimistic + hata geri dönüşü toast; "tüm hareketler" 250 ms açılır.
- **Animasyonlar:** Timeline'da yeni tamamlanan adım (ekran açıkken durum değişirse): nokta dolumu + çizgi çizimi 600 ms, tek sefer.
- **A11y:** Durum değişimi `aria-live="polite"`; hero slot `role="region"` + `aria-label="teslimat durumu"`; iptal linki buton gibi görünmez ama `<button>`'dur.

---

### M7 · İptal Akışı (sheet, MVP)

**Amaç:** Kargoya çıkmamış siparişi tek akışla iptal etmek. | **Kullanıcı hedefi:** İptal edip parasının ne zaman döneceğini öğrenmek.

```
┌─────────────────────────────────────┐
│ ═══                                 │
│ Siparişi iptal et                   │
├─────────────────────────────────────┤
│ Neden iptal ediyorsun?              │
│ ◉ Yanlışlıkla sipariş verdim        │
│ ○ Daha uygun fiyat buldum           │
│ ○ Teslimat çok geç                  │
│ ○ Diğer ┌─────────────────────┐     │
│         └─────────────────────┘     │
├─────────────────────────────────────┤
│ ⓘ Ödemen iptalle birlikte iade      │
│   edilir — bankana göre 1–5 iş günü │
│                                     │
│ [     Siparişi iptal et     ]       │
│ [        Vazgeç             ]       │
└─────────────────────────────────────┘
```

```
CancelSheet/
├─ SheetHandle + Başlık
├─ ReasonRadioGroup(4 seçenek + Diğer→textarea)
├─ RefundInfoNote(banka süresi dürüst)
└─ ButtonGroup(yıkıcı birincil + vazgeç)
```

- **Layout:** Bottom-sheet (mobil), ≥1024 ortalanmış modal 480 px.
- **Responsive:** Yukarıdaki gibi.
- **Durumlar:** L: iptal butonuna basınca buton-içi spinner, sheet kilitli · E: — · Er: iptal başarısız → sheet içinde satır hata + tekrar dene · O: buton disabled + "bağlantı gerekli" · S: sheet kapanır → M6 hero "İptal edildi" + timeline satırı; toast yok (ekran zaten sonucu gösterir).
- **Edge:** **Kargoya çıkmış sipariş** → bu sheet açılmaz; yerine bilgilendirme sheet'i: "Siparişin bugün dağıtımda — iptal yerine yarına erteleyebilir veya teslim almayıp iade başlatabilirsin" + (Ertele) kısayolu (PDS §8.1) · İade süreci başlamış → iptal görünmez.
- **Aksiyonlar:** Neden seç, iptal onayla, vazgeç.
- **Mikro etkileşimler:** "Diğer" seçilince textarea 250 ms açılır; iptal butonu neden seçilmeden disabled.
- **Animasyonlar:** Sheet 250 ms alttan, yaylanmasız.
- **A11y:** Yıkıcı buton `aria-describedby` iade notuna bağlı; sheet açılış odağı başlığa.

---

### M8 · "Yolda" Canlı Takip (V2)

**Amaç:** Teslim günü ana sahnesi — pencere, harita, sayaç, aksiyonlar tek yerde. | **Kullanıcı hedefi:** "Ne zaman kapımda?" sorusunu bakışta cevaplamak ve gerekirse son dakika aksiyonu almak.

```
┌─────────────────────────────────────┐
│ ← Sipariş #1042                     │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │         HARİTA                  │ │
│ │   🚗→ ~~~ rota ~~~   🏠         │ │
│ │              [◎ konuma dön]     │ │
│ │ son sinyal 12 sn önce           │ │
│ └─────────────────────────────────┘ │
│                                     │
│ 17:10 – 17:50 arası kapında         │
│ Önünde 3 durak var                  │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ▢ Mehmet · Beyaz LADA · 01 AB…  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ (Kapıya bırak ✓) (Ertele) (Tarif)   │
│ ⌄ Sipariş detayları                 │
└─────────────────────────────────────┘
```

```
LiveTracking/
├─ Header(geri + sipariş no)
├─ LiveMapCanvas/
│  ├─ HomePin + CourierMarker(araç ikonlu, yönlü)
│  ├─ RoutePolyline(yalnız gerçek geometri varsa)
│  ├─ RecenterButton + SignalAgeLabel
├─ PromiseDisplay(canlı pencere) + StopsCounter satırı
├─ CourierIdentityCard(kompakt)
├─ ActionChipRow
└─ CollapsedOrderDetails(→ M6 içeriği)
```

- **Layout:** Harita üstte, ekranın ~%42'si; altı bilgi istifi. Harita hiçbir durumda tam ekranı almaz — pencere metni her zaman fold üstünde.
- **Responsive:** ≥1024: harita sol %55, bilgi sağ %45 yan yana.
- **Durumlar:** L: harita gri + pencere satırı iskelet · E: kurye henüz son 8 durakta değil → harita YOK; bu ekran M6 hero'sunda "pencere kartı" olarak yaşar (canlı blok koşullu) · Er: harita yüklenemedi → **metin eşdeğeri kart**: "Kuryen yolda — önünde 3 durak, 17:10–17:50 arası" (deneyim eksilmez, PDS §10/4) · O: son konum + soluk marker + "son güncelleme 14:32"; poll durur · S: 15 sn poll ile canlı.
- **Edge:** Sinyal >90 sn → marker soluklaşır + "sinyali kesildi — muhtemelen kapalı alanda, teslimatlar devam ediyor" (D2/G2) · **Sayaç arttı** → animasyonsuz güncelle + "teslimat sırası güncellendi" mikro-metni (E8) · N=1 → sayaç metni "Sıradaki sensin — kuryen bir önceki teslimatında" · Pencere kaydı → pencere satırı "güncellendi" rozeti + neden satırı (E3) · Kurye çok yakın (≤2 durak) → tercih çipleri kilitlenir 🔒 + tooltip (F2).
- **Aksiyonlar:** Konuma dön, çipler, detayları aç; harita pan/zoom serbest.
- **Mikro etkileşimler:** Sayaç azalışı ticker 250 ms; recenter butonu yalnız kullanıcı haritayı oynattıysa belirir.
- **Animasyonlar:** Marker interpolasyonu poll aralığına yayılır + yön rotasyonu; kamera oto-takip yalnız kullanıcı dokunmadıysa (dokununca kapanır — PDS §9/5); yaklaşma zoom'u 600 ms.
- **A11y:** Harita `role="img"` + özet `aria-label`; pencere+sayaç metni DOM'da haritadan ÖNCE (ekran okuyucu sırası); sayaç `aria-live="polite"`; recenter 44 px.

---

### M9 · Tercih Değiştirme Sheet (MVP)

**Amaç:** F2 akışı — teslim şeklini son ana kadar değiştirmek. | **Kullanıcı hedefi:** Planı değişti; kuryeye tek dokunuşla haber vermek.

```
┌─────────────────────────────────────┐
│ ═══                                 │
│ Teslimat tercihi                    │
├─────────────────────────────────────┤
│ ◉ Kapıya bırak                      │
│   Fotoğraflı kanıt cebine gelir     │
│ ○ Adresteyim (elden)                │
│ ○ Komşuya ver               (V2)    │
│   ┌ Komşu adı / daire ────────┐     │
│   └───────────────────────────┘     │
│ ○ Beni ara                  (V2)    │
├─────────────────────────────────────┤
│ Not (isteğe bağlı)                  │
│ ┌─────────────────────────────────┐ │
│ └─────────────────────────────────┘ │
│ [        Kaydet         ]           │
└─────────────────────────────────────┘
```

```
PrefBottomSheet/
├─ SheetHandle + Başlık
├─ PrefRadioGroup (M3 ile aynı satır bileşeni)
│  └─ (KOMSUYA seçilince) NeighborFields(ad+daire, zorunlu)
├─ OptionalNoteField
└─ PrimaryButton(Kaydet)
```

- **Layout / Responsive:** M7 ile aynı sheet kalıbı.
- **Durumlar:** L: kaydet buton-içi spinner · E: — · Er: kayıt düştü → satır hata + eski tercih geri işaretlenir (optimistic geri alma) · O: kaydet disabled · S: sheet kapanır, M6/M8 çipi güncellenir, sessiz toast "Kuryene iletildi".
- **Edge:** Kurye ≤2 durak → sheet açılır ama başlık altı amber bant: "Kuryen çok yakın — tercihini iletiyoruz, garanti edemeyebiliriz" (F2 evet-dalı) · KOMSUYA ad/daire boş → kaydet disabled + alan altı hata · **Public token'dan açıldıysa** kapıya-bırak/komşu seçenekleri 🔒 "Giriş yapman gerekli" (G7) · Yüksek değerli sipariş → kapıya/komşu 🔒 + neden.
- **Aksiyonlar:** Seç, komşu bilgisi gir, not ekle, kaydet.
- **Mikro etkileşimler:** Komşu alanları 250 ms açılır; optimistic çip güncellemesi.
- **Animasyonlar:** Sheet standart.
- **A11y:** Zorunlu alan `aria-required`; kilit nedenleri `aria-describedby`.

---

### M10 · Erteleme Sheet (MVP)

**Amaç:** F3 — teslimi müşteri isteğiyle ileri almak. | **Kullanıcı hedefi:** "Yarın uygun değilim" sorununu 10 saniyede çözmek.

```
┌─────────────────────────────────────┐
│ ═══                                 │
│ Teslimatı ertele                    │
│ 2 erteleme hakkından 2'si duruyor   │
├─────────────────────────────────────┤
│ ◉ Perşembe (yarın)                  │
│ ○ Cuma                              │
├─────────────────────────────────────┤
│ ⓘ Ertelediğinde bugünkü teslimat    │
│   iptal olur, seçtiğin gün          │
│   öncelikli sıraya girersin.        │
│                                     │
│ [       Ertele        ]             │
└─────────────────────────────────────┘
```

```
PostponeSheet/
├─ SheetHandle + Başlık + QuotaLabel(hak sayacı)
├─ DayRadioGroup(sonraki 2 uygun gün — kapasiteli günler)
├─ InfoNote(öncelik açıklaması)
└─ PrimaryButton(Ertele)
```

- **Layout / Responsive:** Standart sheet.
- **Durumlar:** L: gün seçenekleri `~~~` (kapasite sorgusu) · E: — · Er: satır hata + tekrar dene · O: disabled · S: kapanır → M6 timeline'a "Senin isteğinle Perşembe'ye alındı" satırı + bildirim.
- **Edge:** **Hak bitti** → radio grubu yerine istisna içeriği: "Erteleme hakkın doldu" + [Bizi ara] + [Şubeden teslim al] (B8) · Sunulan günler kapasiteli günlerdir — dolu gün listede hiç görünmez (E2) · Tur o an aktif ve durak yaklaşıyorsa M9'daki amber bant kuralı burada da geçerli.
- **Aksiyonlar:** Gün seç, ertele, (hak bittiyse) istisna yolları.
- **Mikro etkileşimler:** Hak sayacı işlem sonrası düşer (metin, animasyonsuz).
- **Animasyonlar:** Standart sheet.
- **A11y:** Hak sayacı başlıkla birlikte okunur; istisna yolundaki telefon linki `tel:`.

---

### M11 · Teslim Kanıtı / Kapanış (MVP; 👍/👎 V2)

**Amaç:** Teslimin kanıtıyla kapanış; güvenin tahsil edildiği an. | **Kullanıcı hedefi:** Paketin teslim edildiğini (ve nereye) görmek; sorun varsa bildirmek.

```
┌─────────────────────────────────────┐
│              ✓                      │
│        Teslim edildi                │
│        Bugün 16:48                  │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ▢▢▢  KANIT FOTOĞRAFI  ▢▢▢       │ │
│ │  (kapı önü, kapı no görünür)    │ │
│ └─────────────────────────────────┘ │
│ Kapıya bırakıldı · adresinin 8 m    │
│ yakınında                           │
├─────────────────────────────────────┤
│ Teslimat nasıldı?          (V2)     │
│      [ 👍 ]      [ 👎 ]             │
│ (zamanında) (kibardı) (paket sağlam)│
├─────────────────────────────────────┤
│ Bir sorun mu var?                   │
└─────────────────────────────────────┘
```

```
DeliveryClosing/
├─ SuccessMark + Başlık + <time>
├─ ProofCard/
│  ├─ ProofPhoto(▢ tam genişlik, 4:3, ışık kutusuna açılır)
│  └─ ProofMeta(teslim şekli + konum teyidi + [alan adı — maskeli, komşu/güvenlik varyantı])
├─ ThumbRating/ (V2)
│  ├─ ThumbButtons(👍/👎, 56px)
│  └─ TagChips(seçime göre olumlu/olumsuz set)
└─ ProblemLink("Bir sorun mu var?" → sorun akışı, 24 saat görünür)
```

- **Layout:** M6'nın hero slotunu devralır (ayrı route değil, sipariş detayının teslim-sonrası hâli); kanıt fotoğrafı tam genişlik.
- **Responsive:** ≥768: foto sol, meta+rating sağ.
- **Durumlar:** L: foto `~~~` 4:3 rezerve · E: OTP'li teslimde foto yok → `ProofCard` fotosuz varyant: "Sana elden teslim edildi · kod doğrulandı" · Er: foto yüklenemedi → yeniden dene + meta her zaman görünür · O: meta önbellekten, foto bağlantı bekler · S: varsayılan.
- **Edge:** Komşu/güvenlik teslimi (V2/B3) → alan satırı: "Komşun A*** Hanım'a (daire 5) teslim edildi" · Yönetici teslimi (B5) → "teslimat notla onaylandı" satırı · 👎 seçilince olumsuz etiket seti + "bir sorun mu var?" vurgulanır · 24 saat geçti → sorun linki gizlenir, destek genel yolu kalır (C5) · Public token → bu ekran kanıt fotoğrafı GÖSTERMEZ (G7).
- **Aksiyonlar:** Fotoyu büyüt, 👍/👎 + etiket, sorun bildir.
- **Mikro etkileşimler:** 👍/👎 seçimi anında kilitlenir + etiket çipleri 250 ms belirir; etiketler çoklu seçim, gönder butonu yok (her dokunuş kaydeder).
- **Animasyonlar:** ✓ çizimi 600 ms (M4 ile aynı bileşen); foto ışık kutusu 250 ms.
- **A11y:** Foto `alt` şablonlu ("paketin kapı önünde fotoğrafı, kapı numarası 12 görünüyor"); 👍/👎 `aria-pressed`; teslim anı `aria-live="assertive"` (ekran açıksa).

---

### M12 · İade Başlat + Takip (V2)

**Amaç:** F5 — iadeyi başlatmak ve paranın yolunu saatli göstermek. | **Kullanıcı hedefi:** "Beğenmedim, param ne zaman döner?"

```
BAŞLATMA                              TAKİP
┌───────────────────────┐   ┌───────────────────────┐
│ ← İade et             │   │ ← İade #R-311         │
│ ☑ Fizik Soru Bankası  │   │ ●  Başlatıldı  Cum    │
│ ☐ Deneme Seti         │   │ ●  Kargoda     Cmt    │
│ Neden?                │   │ ○  Depoda kontrol     │
│ ◉ Beğenmedim          │   │ ○  Onay               │
│ ○ Hasarlı geldi       │   │ ○  ₺189 kartına iade  │
│   [▢ + foto ekle]     │   │    bankana göre       │
│ ○ Yanlış ürün         │   │    1–5 iş günü        │
│ [İadeyi başlat]       │   │ ─────────────────     │
└───────────────────────┘   │ İade kodu: R311-8Q    │
                            │ ▢▢ QR ▢▢  Kargoya     │
                            │ bırakırken göster     │
                            └───────────────────────┘
```

```
ReturnFlow/
├─ ReturnStart/
│  ├─ ItemCheckList(iade edilecek kalemler)
│  ├─ ReasonRadioGroup(+ hasar seçilince PhotoUpload zorunlu)
│  └─ PrimaryButton
└─ ReturnTracking/
   ├─ DeliveryTimeline(iade varyantı — para satırı vurgulu son adım)
   ├─ ReturnCodeCard(kod + QR + kargo yönergesi)
   └─ (red durumunda) RejectionCard(foto + gerekçe + [İtiraz et])
```

- **Layout:** Başlatma tek kolon form; takip M6 kalıbında timeline sayfası.
- **Responsive:** ≥768: 560 px kolon.
- **Durumlar:** L: başlat buton-içi spinner; takipte timeline iskeleti · E: iade edilebilir kalem yok (süre geçti) → `SystemState`: "İade süresi doldu" + koşul linki · Er: satır hata · O: başlatma bağlantı ister; takip son veri · S: başlatınca doğrudan takip ekranı + kod.
- **Edge:** Hasar nedeni seçili + foto yok → başlat disabled · Kontrol reddi (F3) → timeline kırmızı son adım + `RejectionCard` · "Param gelmedi" (F5) → para satırının altında kalıcı not: banka süresi + destek kısayolu · V3: kod kartı yerine "yarın kuryemiz alacak" pickup varyantı.
- **Aksiyonlar:** Kalem seç, neden+foto, başlat; takipte: kodu kopyala, QR büyüt, itiraz.
- **Mikro etkileşimler:** Foto ekleme küçük önizleme grid'i; kod kopyalama "kopyalandı" mikro-onayı.
- **Animasyonlar:** Timeline adım dolumu standart.
- **A11y:** Para satırı görsel vurgu + `strong` (renk tek taşıyıcı değil); QR'ın metin eşdeğeri kod her zaman görünür.

---

### M13 · Public Takip `/takip/:token` (MVP)

**Amaç:** Oturumsuz, paylaşılabilir izleme (SMS linki). | **Kullanıcı hedefi:** Uygulamasız/girişsiz olarak "nerede, ne zaman?" cevabını almak.

```
┌─────────────────────────────────────┐
│ 📦 Cıncık Teslimat                  │
│ S*** K*** için sipariş              │
├─────────────────────────────────────┤
│ [● Yolda]  Bugün 13:00–18:00        │
│ (V2: harita + sayaç — M8'in aynısı) │
├─────────────────────────────────────┤
│ ●  Sipariş alındı     Sal 14:32     │
│ ●  Yolda              Bugün 13:05   │
│ ○  Teslim             13–18 arası   │
├─────────────────────────────────────┤
│ (Ertele) (Beni ara V2)              │
│ Teslim şeklini değiştirmek için     │
│ [Giriş yap]                         │
└─────────────────────────────────────┘
```

```
PublicTracking/
├─ BrandHeader + MaskedRecipient
├─ StatusPill + PromiseDisplay (+ V2: LiveMapCanvas — M8 kuralları aynen)
├─ DeliveryTimeline (kısıtlı: adres/kanıt yok)
├─ LimitedActionChips(ertele · beni-ara) + LoginPrompt
```

- **Layout:** M6'nın soyulmuş hâli; adres, kanıt fotoğrafı, ödeme bilgisi YOK.
- **Responsive:** Müşteri kalıbı.
- **Durumlar:** L: standart iskelet · E: — · Er: **token geçersiz/süresi dolmuş** → nazik tam sayfa: "Bu takip bağlantısının süresi dolmuş — siparişini görmek için giriş yap" (suçlayıcı dil yok) · O: son veri + şerit · S: varsayılan.
- **Edge:** Teslimden sonra token pasif → Er sayfasının "teslim edildi" varyantı: "Bu sipariş teslim edildi ✓ — detay için giriş yap" (G7) · Kapıya-bırak değişikliği denenirse → M9 kilit kuralı (G7) · Link paylaşımı bir özelliktir: sayfada utandırıcı uyarı gösterilmez.
- **Aksiyonlar:** Ertele (M10 aynen açılır), giriş yap; V2: beni-ara.
- **Mikro etkileşimler / Animasyonlar:** M6/M8 ile aynı bileşenler, aynı kurallar.
- **A11y:** Maskeli ad ekran okuyucuda "alıcı adı gizlenmiştir" olarak açıklanır; giriş CTA'sı sayfanın son odak durağı.

---

## 2. Courier Experience (K1–K7)

**Yüzey kuralları (tüm K ekranları):** yalnız mobil dikey; birincil hedefler ≥56 px ve ekranın alt yarısında; yüksek parlaklık teması (açık hava); tüm sonuçlar sesli + haptik; offline-first — her işlem önce cihaza yazılır (`SystemState` offline şeridi senkron sayaçlı: "3 işlem bekliyor").

### K1 · Gün Başı + Yükleme (MVP)

**Amaç:** Turu kavratmak ve aracın eksiksiz yüklendiğini garanti etmek. | **Kullanıcı hedefi:** "Bugün ne var?" + hiçbir paketi depoda unutmamak.

```
┌─────────────────────────────────────┐
│ Günaydın, Mehmet        Çrş 12 Tem  │
├─────────────────────────────────────┤
│ Bugünkü tur                         │
│ 18 durak · ~5,5 saat · 41 km        │
│ İlk durak: Kurttepe Mah.            │
├─────────────────────────────────────┤
│ Yükleme            12/18 okutuldu   │
│ ████████████░░░░░░                  │
│                                     │
│ ✓ #1042 · 2 paket                   │
│ ✓ #1043                             │
│ ○ #1044  ← sıradaki                 │
│ ⌄ tümü                              │
│                                     │
│ [ 📷  Etiket okut ]                 │
│                                     │
│ [🔒     Turu başlat      ]          │
│  6 paket okutulmadan başlayamazsın  │
└─────────────────────────────────────┘
```

```
DriverDayStart/
├─ Greeting + <time>
├─ TourSummaryCard(durak · süre · km · ilk durak)
├─ LoadingSection/
│  ├─ ProgressBar + sayaç
│  ├─ PackageChecklist(✓/○ satırlar, ⌄ tümü)
│  └─ ScanButton(kamera açar, ardışık okutma)
└─ StartTourButton(🔒 tüm paketler okutulana dek)
```

- **Layout:** Tek kolon; [Turu başlat] alta sabit; okut butonu onun üstünde.
- **Responsive:** Yok (kurye kuralı).
- **Durumlar:** L: tur kartı iskelet ("tur hazırlanıyor") · E: "Bugün tur yok" + `SystemState` sakin ikon · Er: tur yüklenemedi → tekrar dene; okutma servisi düşükse okutmalar yerel kuyruğa · O: liste önbellekten; okutmalar kuyruklanır, başlat butonu senkron ister · S: 18/18 → buton kilidi açılır.
- **Edge:** Eksik paket bulunamıyor → satırda [Bulunamadı] aksiyonu → operasyona anında istisna + durak turdan düşürülür (sipariş yeniden planlanır) — tur eksikle başlayabilir ama SESSİZCE başlayamaz · Yanlış tur etiketi okutuldu → uzun titreşim + "Bu paket bugünkü turda değil" · Çift okutma → kısa "zaten okutuldu" bilgisi, hata değil.
- **Aksiyonlar:** Etiket okut (ardışık — kamera açık kalır), tümünü gör, bulunamadı işaretle, turu başlat.
- **Mikro etkileşimler:** Her başarılı okutmada satır ✓ + progress dolar + kısa titreşim; sayaç ticker.
- **Animasyonlar:** Progress bar dolumu 150 ms; kilit açılınca buton renk geçişi 250 ms.
- **A11y:** Progress `aria-valuenow`; kilit nedeni butonun `aria-describedby`'ı; okutma sonuçları sesli ("on iki, on sekizde").

---

### K2 · Sıradaki Durak (MVP — ekranın sahibi)

**Amaç:** "Şimdi ne yapacağım?" sorusunu 3 saniyede cevaplamak. | **Kullanıcı hedefi:** Sonraki adrese gitmek ve teslimata hazır olmak.

```
┌─────────────────────────────────────┐
│ Durak 7/18            ⏱ ~14:20      │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ S. Kıyar            #1042 · 📦2 │ │
│ │ Kurttepe Mah. 42. Sk. No:12/3   │ │
│ │ ─────────────────────────────── │ │
│ │ ⚠ KAPIYA BIRAK — zil bozuk,     │ │
│ │   3. kat, arayın                │ │
│ │ ─────────────────────────────── │ │
│ │ ⓘ güvenlik notu: köpek var      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [ 🧭  Yol tarifi ]  (harici uyg.)   │
│                                     │
│ [        📍 Vardım         ]        │
│                                     │
│ ─── sonraki ─────────────────────── │
│ 8/18  A. Demir · Sarıçam…           │
│ 9/18  B. Yılmaz · Çukurova…      ⌄  │
└─────────────────────────────────────┘
```

```
DriverNextStop/
├─ TourProgressHeader(durak x/n + sıradaki durak ETA)
├─ DriverStopCard/
│  ├─ Alıcı + sipariş no + paket rozeti
│  ├─ Adres (büyük, 2 satır)
│  ├─ ⚠ InstructionBand(tercih + kapı tarifi — amber)
│  └─ SafetyNote(varsa — ayrı satır, ⓘ)
├─ NavigateButton(deep-link) + ArrivedButton(birincil)
└─ NextStopsPeek(2 satır + ⌄ → K3)
```

- **Layout:** Kart üst, iki büyük buton alt yarıda (baş parmak bölgesi); sonrakiler en altta soluk.
- **Responsive:** Yok.
- **Durumlar:** L: kart iskelet · E: tüm duraklar bitti → K7'ye otomatik geçiş · Er: durak verisi çekilemedi → önbellek + şerit · O: kart tam çalışır; [Vardım] kuyruklanır · S: varsayılan.
- **Edge:** Tercih az önce değişti (müşteri M9'dan) → amber bant 600 ms vurgu yanıp söner + "az önce güncellendi" etiketi (F2) · Aynı binada 2. durak var → kart altında "bu binada 1 teslimat daha" satırı (A6) · Navigasyondan dönüş → state aynen (K2'ye döner, hiçbir şey sıfırlanmaz).
- **Aksiyonlar:** Yol tarifi (deep-link), Vardım → K4; sonraki listeye geç → K3; karttan telefon: müşteriyi ara (maskeli — yalnız vardıktan sonra aktif).
- **Mikro etkileşimler:** [Vardım] basılınca buton [Teslimata başla]'ya dönüşür (K4 açılır); tercih bandı güncellenince tek vurgu.
- **Animasyonlar:** Kart geçişi (durak tamamlanınca yenisi): 250 ms sağdan kayma — ilerleme hissi.
- **A11y:** Talimat bandı `role="note"` + sesli okunur; güvenlik notu ayrı satır (talimatla karışmaz); tüm butonlar ≥56 px.

---

### K3 · Durak Listesi (MVP)

**Amaç:** Genel bakış + sıra yönetimi (ikincil yüzey). | **Kullanıcı hedefi:** Günün resmini görmek; gerekirse bir durağı sona atmak.

```
┌─────────────────────────────────────┐
│ ← Duraklar              7/18 tamam  │
├─────────────────────────────────────┤
│ ✓ 1 · A. Ak · Seyhan        16:02   │  ← soluk
│ ✓ 2 · …                             │
│ ▶ 7 · S. Kıyar · Kurttepe    şimdi  │  ← vurgulu
│   8 · A. Demir · Sarıçam            │
│   9 · B. Yılmaz · Çukurova   ⋮      │
│     └ ⋮ menü: [Sona at (1 hak)]     │
│  10 · …                             │
│ ✗ 4 · C. Öz — ulaşılamadı    13:44  │  ← amber
└─────────────────────────────────────┘
```

```
DriverStopList/
├─ Header(geri + tamamlanma sayacı)
└─ StopRow ×n: sıra no + ad + semt + StatusPill mini + saat
   ├─ done: soluk + ✓ + teslim saati
   ├─ current: ▶ vurgulu
   ├─ pending: ⋮ menü → "Sona at"
   └─ failed: ✗ amber + neden kısaltması
```

- **Layout:** Yoğun liste (56 px satır); sürükleme YOK — sıralama operasyonundur, kurye yalnız "sona at" yapabilir.
- **Responsive:** Yok.
- **Durumlar:** L: satır iskeletleri · E: — (tur varsa durak vardır) · Er: önbellek + şerit · O: tam çalışır; sona-at kuyruklanır · S: varsayılan.
- **Edge:** "Sona at" turda 1 kez/durak (B2) → onay diyaloğu: "9. durak sona alınacak — müşteriye yeni sıra bildirilir"; kullanılınca menüden düşer · FAILED satırına dokunuş → salt-okunur özet (neden + saat + foto) · Sona atılan durağın müşterisinde E8 kuralı tetiklenir (sayaç artışı metni).
- **Aksiyonlar:** Satıra dokun (özet), sona at, geri.
- **Mikro etkileşimler:** Sona atılan satır 250 ms ile listenin sonuna süzülür (nereye gittiği görülür — ışınlanmaz).
- **Animasyonlar:** Yukarıdaki tek hareket; başka animasyon yok.
- **A11y:** Satır durumları ikon+metin; sona-at onayı diyalog odağı; "1 hak" bilgisi menü item'ında.

---

### K4 · Teslim Akışı (MVP)

**Amaç:** Doğru paket + doğru kişi + kanıt — teslimin kendisi. | **Kullanıcı hedefi:** 30 saniyede hatasız teslim kapatmak.

```
ADIM 1: PAKET            ADIM 2a: OTP (elden)     ADIM 2b: FOTO (kapıya)
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│ #1042 · S. Kıyar  │   │ Müşterinin kodunu │   │ ┌───────────────┐ │
│ ┌───────────────┐ │   │ gir               │   │ │   KAMERA      │ │
│ │   📷 QR       │ │   │  ┌─┬─┬─┬─┐        │   │ │ ┌───────────┐ │ │
│ │  [vizör]      │ │   │  │4│7│_│_│        │   │ │ │paket+kapı │ │ │
│ └───────────────┘ │   │  └─┴─┴─┴─┘        │   │ │ │ çerçevesi │ │ │
│ 1/2 paket okutuldu│   │ [Kod gelmedi]     │   │ │ └───────────┘ │ │
│                   │   │                   │   │ └───────────────┘ │
│                   │   │                   │   │ paketi kapı no ile│
│                   │   │                   │   │ birlikte çek      │
└───────────────────┘   └───────────────────┘   └───────────────────┘
                              ADIM 3
                        ┌───────────────────┐
                        │ ▢ foto önizleme   │
                        │ ≫≫ Kaydırarak     │
                        │    teslim et  ≫≫  │
                        └───────────────────┘
```

```
DeliveryFlow/
├─ FlowHeader(sipariş + alıcı — her adımda sabit)
├─ Step1_PackageScan(QRScanner + çoklu paket sayacı)
├─ Step2a_OtpEntry(OtpInput 4-6 hane + [Kod gelmedi] → B5 yolu)
│  veya Step2b_PhotoProof(kamera + statik çerçeve kılavuzu + ipucu satırı + oto-flaş)
└─ Step3_SwipeToComplete(foto önizlemeli)
```

- **Layout:** Tam ekran adım akışı; geri oku her adımda; adım göstergesi üstte (1-2-3 nokta).
- **Responsive:** Yok.
- **Durumlar:** L: — (kamera/kod anlık) · E: — · Er: **yanlış paket QR'ı** → kırmızı tam-ekran + uzun titreşim: "Bu paket 14. durağın! (A. Demir)" + [Tamam] — akış kilitli kalır (C1) · O: tüm adımlar offline çalışır; swipe sonucu kuyruklanır ("teslim kaydedildi — senkron bekliyor") · S: swipe → yeşil onay + çift titreşim → K2 (sonraki kart).
- **Edge:** Çoklu paket → adım 1 sayaçlı, TÜM QR'lar okutulmadan adım 2 açılmaz (C3) · OTP 5 hata → kilit + "operasyonu ara" (H1) · [Kod gelmedi] → operasyon onaylı notlu teslim akışı: not zorunlu + onay bekler (B5) · Foto çekilmeden swipe görünmez (H4) · Karanlık → oto-flaş; kılavuz metni "kapı numarası görünsün" · Etiket okunmuyor → [Elle gir] → sipariş no + operasyon teyidi (C4).
- **Aksiyonlar:** QR okut, kod gir / foto çek, yeniden çek, swipe, kod-gelmedi, elle gir, iptal (→ K5'e "sorun var" köprüsü).
- **Mikro etkileşimler:** QR başarı yeşil flaş + kısa titreşim; OTP kutuları oto-ilerler; swipe direnci + eşikte haptik; foto çekimde deklanşör sesi (sistem).
- **Animasyonlar:** Adım geçişleri 250 ms yatay kayma; başarı onayı 600 ms çizim.
- **A11y:** OTP `inputmode="numeric"`; hata/başarı sesli + haptik (ekrana bakmadan); swipe alternatifi: uzun-bas (2 sn) — motor beceri toleransı; kılavuz metni yüksek kontrast.

---

### K5 · Başarısız Teslim (MVP — F4 akışı)

**Amaç:** Ulaşılamayan müşteride dallanmayı hatasız yürütmek. | **Kullanıcı hedefi:** Kurallara uygun en iyi sonucu (teslim > ertele > FAILED) almak.

```
┌─────────────────────────────────────┐
│ ← #1042 · S. Kıyar                  │
│ Müşteriye ulaşılamıyor              │
├─────────────────────────────────────┤
│ ✓ Bildirim gönderildi (kapıdayız)   │
│                                     │
│ [ 📞  Müşteriyi ara ]               │
│                                     │
│      ◔ 1:23                         │
│   bekleme sayacı (2 dk)             │
├─────────────────────────────────────┤
│ Telefonda "kapıya bırak" derse:     │
│ [ Kodunu telefonda söyledi → gir ]  │
│ [ Onay linki gönder (90 sn) ]       │
├─────────────────────────────────────┤
│ Ulaşılamadıysa:                     │
│ neden?  ◉ evde yok ○ adres ○ erişim │
│ [ 📷 kapı önü fotoğrafı ]           │
│ [    Teslim edilemedi     ]         │
└─────────────────────────────────────┘
```

```
FailedDeliveryFlow/
├─ Header(sipariş + durum başlığı)
├─ AutoNotifyStatus(✓ push gitti — sistem otomatik)
├─ CallButton(maskeli arama) + WaitTimer(2 dk ring, titreşimli bitiş)
├─ PhoneConsentSection/
│  ├─ OtpHandoffButton → OtpInput (K4 2a aynı bileşen)
│  └─ ConsentLinkButton → 90 sn geri sayım + durum ("bekliyor…")
└─ FailSection/
   ├─ ReasonRadio(evde yok · adres bulunamadı · kapıya erişilemedi · güvenli değil)
   ├─ DoorPhotoCapture(zorunlu)
   └─ FailButton(neden+foto olmadan disabled)
```

- **Layout:** Üçe bölünmüş dikey akış: dene → telefonda çöz → kapat. Sıra görsel olarak yukarıdan aşağı (doğru davranış = doğal okuma sırası).
- **Responsive:** Yok.
- **Durumlar:** L: onay linki gönderilince "bekliyor…" durumu canlı · E: — · Er: arama başlatılamadı → cihaz arama uygulamasına ham fallback + operasyona işaret · O: arama cihazdan çalışır; FAILED kaydı kuyruklanır; onay-linki gönderimi bağlantı ister (disabled + neden) · S: üç çıkıştan biri — teslim (→K4 adım 3), onaylı kapıya bırakma (→foto→swipe), FAILED (→K2 sonraki kart).
- **Edge:** OTP-devri: müşteri kodu telefonda okur → kod doğruysa foto adımına geçilir; 5 hata kilidi burada da geçerli (F4/H1) · Onay linki 90 sn doldu → buton pasif + "onay gelmedi" → FAILED yolu · "Güvenli değil" nedeni → foto zorunluluğu KALKAR (kurye uzaklaşabilmeli), durak özel kodla kapanır, operasyon vakası (D8) · Müşteri "15 dk sonra evdeyim" → bu ekrandan çıkıp K3'te "sona at" (B2 — burada kısayol linki var).
- **Aksiyonlar:** Ara, OTP gir, onay linki gönder, neden seç, foto çek, teslim edilemedi, sona-at kısayolu.
- **Mikro etkileşimler:** 2 dk sayaç bitince tek uzun titreşim; onay linki durumu canlı güncellenir ("müşteri onayladı ✓" yeşil satır).
- **Animasyonlar:** Bölümler arası geçiş yok — tek sayfa (kurye kaydırarak karar verir).
- **A11y:** Sayaç `aria-live` dakika anonsları; foto zorunluluğu buton `aria-describedby`; "güvenli değil" seçeneği diğerleriyle eşit görünürlükte (utandırma yok).

---

### K6 · İade Pickup (V3)

**Amaç:** Teslimat turunda iade paketini devralmak. | **Kullanıcı hedefi:** Doğru iade paketini alıp devri kayda geçirmek.

```
┌─────────────────────────────────────┐
│ Durak 9/18 · İADE ALIMI       ↩︎    │
│ ┌─────────────────────────────────┐ │
│ │ E. Yılmaz          #R-311       │ │
│ │ Toros Mah. …                    │ │
│ │ ⚠ ALINACAK: 1 paket (kitap)     │ │
│ └─────────────────────────────────┘ │
│ [ 📷  İade QR'ını okut ]            │
│ Müşterinin ekranındaki/e-postadaki  │
│ kodu okut                           │
│ ─────────────────────────────────── │
│ Paket durumu: ◉ sağlam ○ hasarlı(📷)│
│ [ ≫ Devralındı ≫ ]                  │
└─────────────────────────────────────┘
```

```
ReturnPickupStop/
├─ StopHeader(↩︎ iade rozeti — teslim durağından görsel ayrım)
├─ DriverStopCard(pickup varyantı: ALINACAK bandı)
├─ ReturnQrScan + yönerge satırı
├─ ConditionCheck(sağlam/hasarlı + hasar fotosu)
└─ SwipeToComplete(devralındı)
```

- **Layout:** K2/K4 kalıbının varyantı — kurye yeni ekran öğrenmez.
- **Responsive:** Yok.
- **Durumlar:** L/Er/O: K4 ile aynı kurallar · E: — · S: swipe → müşteriye "iaden kuryede" bildirimi → K2.
- **Edge:** QR eşleşmedi (başka pakete ait) → devir GERÇEKLEŞMEZ + [Operasyona işaretle] (F2-iade) · Müşteri kodu bulamıyor → operasyon onaylı elle devir (B5 kalıbı) · Hasarlı işaretlendi → foto zorunlu; müşteriye "hasar notuyla alındı" kopyası.
- **Aksiyonlar:** QR okut, durum işaretle, foto, devral, operasyona işaretle.
- **Mikro etkileşimler / Animasyonlar:** K4 ile aynı (yeşil flaş, haptik, swipe).
- **A11y:** ↩︎ iade rozeti + "iade alımı" metni birlikte (ikon tek taşıyıcı değil).

---

### K7 · Gün Sonu Özeti (MVP)

**Amaç:** Günü kapatmak; performansı baskısız yansıtmak. | **Kullanıcı hedefi:** "Günüm nasıl geçti?" + turu resmen bitirmek.

```
┌─────────────────────────────────────┐
│ Gün bitti 🎉 — iyi iş, Mehmet       │
├─────────────────────────────────────┤
│   16        1         1             │
│ teslim   edilemedi  ertelendi       │
│                                     │
│ Söz tutma: 16/17 pencere içinde     │
├─────────────────────────────────────┤
│ Müşterilerinden:            (V2)    │
│ 👍 "kibardı" ×3  "zamanında" ×5     │
├─────────────────────────────────────┤
│ Bekleyen senkron: yok ✓             │
│ [       Turu kapat        ]         │
└─────────────────────────────────────┘
```

```
DriverDayEnd/
├─ ClosingHeader
├─ StatTriple(teslim · edilemedi · ertelendi — büyük rakam, tabular-nums)
├─ PromiseLine(pencere içi / toplam)
├─ FeedbackSection(V2 — yalnız olumlu etiketler burada; olumsuzlar operasyon kanalında)
├─ SyncStatus(offline kuyruk boş mu — tur kapatma ön koşulu)
└─ CloseTourButton
```

- **Layout:** Ortalanmış özet; tek buton.
- **Responsive:** Yok.
- **Durumlar:** L: rakamlar iskelet · E: — · Er: kapatma düştü → tekrar dene · O: **tur kapatılamaz** — "3 işlem senkron bekliyor; kapsama alanına gelince kapat" (veri bütünlüğü) · S: kapanış → K1 boş durumuna ("yarın görüşürüz").
- **Edge:** FAILED>0 → satır dokunulabilir: hangi duraklar, hangi neden (salt-okunur) · "Güvenli değil" kapanışları burada nötr dille listelenir, kurye metriğine yazılmadığı görünür (D8) · Hız/süre metriği GÖSTERİLMEZ (PDS §3.6).
- **Aksiyonlar:** Turu kapat, FAILED detayına bak.
- **Mikro etkileşimler:** Rakamlar 600 ms sayarak dolar (gün kapanış ritüeli — tek kutlama anı).
- **Animasyonlar:** Yalnız rakam dolumu; konfeti yok.
- **A11y:** Rakam üçlüsü tek cümle özetle de okunur ("on altı teslim, bir edilemedi, bir ertelendi"); kapatma engeli nedeni açık metin.

---

## 3. Operations Experience (O1–O8)

**Yüzey kuralları (tüm O ekranları):** masaüstü 1440 taban, min 1024; <1280'de split'ler dikey stack olur. Sol nav "Dağıtım" sekmesinin alt sekmeleri: Hazırlama · Dispatch · İstisnalar(rozetli) · Turlar · İadeler · Kuryeler · Raporlar. Exception-first: rozet sayıları yalnız aksiyon bekleyeni sayar. Yıkıcı aksiyonlar onay + 30 sn geri-al.

### O1 · Hazırlama İstasyonu (MVP)

**Amaç:** PAID → "pakete hazır" hattını yürütmek; etiket basmak. | **Kullanıcı hedefi (depo görevlisi):** Sıradaki siparişi toplayıp etiketleyip hazıra almak.

```
┌──────────────────────────────────────────────────────────────┐
│ Hazırlama                    bugün: 14 bekliyor · 22 hazır   │
├──────────────────────────┬───────────────────────────────────┤
│ BEKLEYENLER              │  #1044 · S. Kıyar                 │
│ ○ #1044  2 kalem  Çrş ▸  │  Söz: Çarşamba (yarın)            │
│ ○ #1045  1 kalem  Çrş    │  ─────────────────────────────    │
│ ○ #1046  3 kalem  Prş    │  ☑ Fizik Soru Bankası    ×1      │
│ ⚠ #1039  YENİDEN DENEME  │  ☐ TYT Deneme 10'lu      ×1      │
│ ─ HAZIR ───────────────  │  ─────────────────────────────    │
│ ✓ #1042  etiketli        │  [ 🖨  Etiket yazdır ]            │
│ ✓ #1043  etiketli        │  [ ✓  Hazır işaretle ] 🔒         │
│                          │   tüm kalemler işaretlenmeli      │
└──────────────────────────┴───────────────────────────────────┘
```

```
PrepStation/
├─ Header(bekleyen/hazır sayaçları)
├─ QueuePanel(sol)/
│  ├─ PendingList(sipariş no + kalem sayısı + söz günü; yeniden-deneme ⚠ öncelik rozetli, listenin üstünde)
│  └─ ReadySection(soluk, ✓)
└─ DetailPanel(sağ)/
   ├─ OrderHeader + söz günü
   ├─ PickChecklist(kalem ×adet — toplama onayı)
   ├─ PrintLabelButton
   └─ MarkReadyButton(🔒 checklist bitmeden + etiket basılmadan)
```

- **Layout:** 40/60 split; klavye ile sürülebilir (aşağı ok = sonraki sipariş) — depo hızı klavyededir.
- **Responsive:** <1280: liste üst, detay alt.
- **Durumlar:** L: liste iskeleti · E: "Hazırlanacak sipariş yok" (sakin) · Er: satır-içi · O: depo istasyonu çevrim-içi varsayılır; kopunca şerit + yazdırma disabled · S: hazır işaretlenen sipariş sol listede HAZIR'a süzülür.
- **Edge:** Yazıcı hatası → [Yeniden yazdır] + elle sipariş-no yazma yönergesi (C4 önlemi) · Stok eksik çıktı → [Eksik bildir] → sipariş istisnaya + müşteriye kısmi/yeni söz akışı (C3) · Yeniden-deneme paketi zaten etiketli → yazdırma adımı atlanır, doğrudan hazır · Söz günü yarından yakın (bugün) → satırda kırmızı nokta.
- **Aksiyonlar:** Sipariş seç, kalem işaretle, etiket yazdır, hazır işaretle, eksik bildir.
- **Mikro etkileşimler:** Checklist tamamlanınca hazır butonu kilidi açılır (renk geçişi); hazır işaretlenince satır 250 ms süzülür.
- **Animasyonlar:** Yalnız satır süzülmesi.
- **A11y:** Tam klavye akışı (ok + boşluk + Enter); yazdırma sonucu `aria-live`.

---

### O2 · Dispatch Board (MVP; optimize V2)

**Amaç:** Günün turunu kurmak. | **Kullanıcı hedefi:** Hazır siparişleri araca dizip turu başlatmak — söz riskini görerek.

```
┌──────────────────────────────────────────────────────────────┐
│ 2 araç · 18 durak · söz riski: 0 · kapasite yarın: 7/22      │
├────────────────────────────┬─────────────────────────────────┤
│ GÜN KUYRUĞU     [Optimize] │                                 │
│ LADA — 18 durak       (V2) │         HARİTA                  │
│ ⠿ 1 #1042 Kurttepe    ⚠dış │      ①─②─③ rota                 │
│ ⠿ 2 #1043 Sarıçam          │     🚗(canlı V2)                │
│ ⠿ 3 #1039 Çukurova  ↻öncel │      ⑧ ⑨ …                     │
│   …                        │   [katman: rota|durak|kurye]    │
│ ─ COROLLA (yedek) ─ boş ─  │                                 │
│ + durak ekle               │                                 │
│ [     Turu başlat     ]    │                                 │
└────────────────────────────┴─────────────────────────────────┘
```

```
DispatchBoard/
├─ HealthStrip(araç · durak · söz riski · yarın kapasitesi)
├─ QueuePanel/
│  ├─ VehicleGroup ×n: sürüklenebilir StopRow(⠿ + sıra + sipariş + semt
│  │   + rozetler: ↻yeniden-deneme(öncelikli) · ⚠rotayı-bozan(V2, detour)
│  ├─ OptimizeButton(V2) + AddStopLink
│  └─ StartTourButton
└─ RouteBoard(harita)/
   ├─ NumberedStopPins + RoutePolyline(V2, araç başına desen+renk)
   ├─ LiveCourierMarker(V2) + LayerToggle
```

- **Layout:** 38/62 split; kuyruk paneli kendi kaydırmasında.
- **Responsive:** <1280: kuyruk üst, harita alt (harita min 360 yükseklik).
- **Durumlar:** L(optimize): buton ilerleme durumuna döner + [İptal]; sonuç gelince kuyruk **diff önizlemesi** (eski→yeni sıra) + [Uygula]/[Vazgeç] · E: hazır sipariş yok → "Önce hazırlama istasyonu" yönlendirmesi · Er: rota motoru düştü → fallback sonucu "yaklaşık rota" rozetiyle + pencereler otomatik geniş (G3) · O: panel salt-okunur + şerit · S: tur başlar → O4'e geçiş önerisi.
- **Edge:** Yeniden denemeler kuyruğun başına kilitli (öncelik — PDS §2.1); sürüklense de uyarı · Konumsuz durak (pin yok) → listede sona + ⚠ "pin bekliyor" (A2 linki müşteriye gönderilebilir) · Kapasite aşımı denemesi (+ durak ekle, gün dolu) → engellenir: "Yarın 22/22 — Perşembe'ye planla" (E2) · Turu başlat: eksik etiketli durak varsa engellenir (K1 ile çift taraflı kilit) · Tur başladıktan sonra durak ekleme (E7, V2): kapasite + pencere kontrolüyle.
- **Aksiyonlar:** Sürükle-sırala (MVP), optimize (V2), durak ekle/çıkar, araca taşı, turu başlat, pin-doğrulama linki gönder.
- **Mikro etkileşimler:** Sürüklerken haritada ilgili pin vurgulanır (çift yönlü hover eşleme); optimize diff'inde değişen satırlar işaretli.
- **Animasyonlar:** Diff uygulanınca satırlar 250 ms yeni yerlerine akar.
- **A11y:** Sürükleme klavye alternatifi: satır seç + Alt-ok; harita katmanları renk+desen+etiket (renk körü — PDS §10/1); sağlık şeridi `aria-live="polite"` değil (sayfa içi bilgi).

---

### O3 · İstisna Kuyruğu (MVP — panelin uyanış ekranı)

**Amaç:** Operasyonun günde bakması gereken TEK liste. | **Kullanıcı hedefi:** Her istisnayı tek dokunuş aksiyonla eritmek.

```
┌──────────────────────────────────────────────────────────────┐
│ İstisnalar (3)                     (Tümü) (Açık) (Çözüldü)   │
├──────────────────────────────────────────────────────────────┤
│ 🔴 Söz riski · #1051 pencereyi taşıyor      12 dk   [Pencere │
│    LADA 14. durak · ETA 18:25 > 18:00        önce    kaydır] │
│ ─────────────────────────────────────────────────────────────│
│ 🟠 Ulaşılamadı · #1039 · 2. deneme          43 dk   [Müşteri │
│    evde yok · foto var                       önce    yi ara] │
│ ─────────────────────────────────────────────────────────────│
│ 🟠 Sinyal yok · LADA · son sinyal 14 dk     14 dk   [Kuryeyi │
│                                              önce    ara]    │
└──────────────────────────────────────────────────────────────┘
```

```
ExceptionQueue/
├─ Header(sayaç + filtre segmenti)
└─ ExceptionRow ×n:
   ├─ SeverityDot + tip + varlık linki + özet satırı
   ├─ AgeLabel(tabular-nums)
   └─ PrimaryActionButton(tipe özel) + ⋮ (ikincil aksiyonlar)
```

**İstisna tipleri ve birincil aksiyonları:** söz riski→[Pencere kaydır + otomatik özür]; ulaşılamadı(2.+)→[Müşteriyi ara]; sinyal yok→[Kuryeyi ara]; OTP ulaşmıyor→[Notlu teslimi onayla]; adres sorunu→[Pin linki gönder]; saha güvenliği→[Vaka aç]; stok eksik→[Kısmi gönderim].

- **Layout:** Tek kolon tablo-liste; severity sırası (kırmızı üstte), sonra yaş.
- **Responsive:** <1280: aksiyon butonu satır altına iner.
- **Durumlar:** L: 3 satır iskelet · E: **tek sakin satır** "Her şey yolunda — açık istisna yok" (kutlama grafiği YOK) · Er: satır-içi · O: son liste + şerit; aksiyonlar disabled · S: varsayılan.
- **Edge:** Aksiyon uygulanınca satır "çözüldü" durumuna geçer, 800 ms yeşil onayla durur, sonra listeden süzülür (loglanır — Çözüldü filtresinde) · Aynı siparişte ikinci istisna → satırlar gruplanır · 👎 memnuniyet bildirimleri BURada değil (günlük geri bildirim kuyruğu O8'de — istisna kuyruğu acil işler içindir).
- **Aksiyonlar:** Birincil aksiyon, ⋮ (yarına planla · telafi öner · vaka notu), varlığa git (O5).
- **Mikro etkileşimler:** Yeni istisna geldiğinde satır üstten belirir + rozet sayacı artar (ses YOK — panel gün boyu açık).
- **Animasyonlar:** Çözülme süzülmesi (PDS §9/11).
- **A11y:** Severity ikon+renk+metin; yaş `<time>`; birincil aksiyon her satırda ilk odak.

---

### O4 · Tur Detayı — Canlı (MVP; canlı konum V2)

**Amaç:** Tek turun röntgeni. | **Kullanıcı hedefi:** Turun gidişatını izlemek; gerekirse devretmek.

```
┌──────────────────────────────────────────────────────────────┐
│ ← Tur #86 · LADA · Mehmet     ACTIVE · 7/18   [⋮ Devret|İptal]│
├──────────────────────────┬───────────────────────────────────┤
│ ✓ 1 #1042 16:02          │         HARİTA                    │
│ ✓ 2 #1043 16:14          │   geçilen rota ── kalan rota ┅┅   │
│ ▶ 7 #1051  ETA 17:25     │        🚗 (V2 canlı)              │
│   8 #1052  ETA 17:40     │   son sinyal: 12 sn               │
│ ✗ 4 #1039 ulaşılamadı    │   batarya: %64                    │
│   …                      │                                   │
└──────────────────────────┴───────────────────────────────────┘
```

```
TourDetail/
├─ Header(tur no + araç + kurye + durum + ilerleme + ⋮ tehlikeli aksiyonlar)
├─ StopTimeline(sol — durak satırları: durum + saat/ETA; tıkla → O5)
└─ LiveMap(sağ)/
   ├─ TraveledPath + RemainingPath(ayrı desen)
   ├─ CourierMarker + SignalAge + BatteryLabel(V2)
```

- **Layout:** 40/60 split.
- **Responsive:** <1280 stack.
- **Durumlar:** L: iskelet · E: — · Er: harita düşse liste ayakta · O: şerit + son veri · S: 15 sn poll (V2).
- **Edge:** Sinyal >10 dk → başlıkta amber uyarı + istisna otomatik açılır (D2) · [Devret] → kalan durakları yedek araca taşıma sihirbazı: hedef araç seç → pencere etkisi önizlemesi → onay → müşterilere nedenli bildirim (D1/D3) · [Turu iptal] → çift onay + tüm siparişler yeniden-planlama havuzuna · Tur DONE → aynı ekran salt-okunur arşiv görünümü (canlı katman kalkar).
- **Aksiyonlar:** Durak → O5, devret, iptal, kuryeyi ara.
- **Mikro etkileşimler:** Liste-harita çift yönlü hover vurgusu.
- **Animasyonlar:** Marker interpolasyonu (V2); başka yok.
- **A11y:** Geçilen/kalan rota desen farkı + lejant; ilerleme başlıkta metin ("7 of 18" değil "7/18 durak tamamlandı").

---

### O5 · Sipariş / Durak Detayı — İç Görünüm (MVP)

**Amaç:** Vaka incelemesi: müşterinin gördüğü ile iç kaydı yan yana koymak. | **Kullanıcı hedefi:** "Bu siparişte ne oldu?" sorusunu kanıtlarla cevaplamak.

```
┌──────────────────────────────────────────────────────────────┐
│ ← #1039 · A. Demir        [Yarına planla] [Telafi öner] [⋮]  │
├──────────────────────────────┬───────────────────────────────┤
│ MÜŞTERİNİN GÖRDÜĞÜ           │ İÇ KAYIT (tam geçmiş)         │
│ ● Sipariş alındı  Sal 14:32  │ PENDING→PAID  payment  14:32  │
│ ● Yolda           Çrş 13:05  │ PAID→SHIPPED  courier  13:05  │
│ ⚠ Teslim edilemedi 17:44     │ stop FAILED — "evde yok,      │
│ ● Yolda (yeniden) Prş 13:02  │  zil çalışmıyor" M.K.  17:44  │
│                              │ + kapı önü fotoğrafı ▢        │
│                              │ + arama: 17:41 (34 sn) ☎      │
├──────────────────────────────┴───────────────────────────────┤
│ Kanıtlar: ▢ ▢   İletişim: SMS ×3 · arama ×1   Tercih: elden  │
└──────────────────────────────────────────────────────────────┘
```

```
OrderInternalDetail/
├─ Header(sipariş + müşteri + aksiyon butonları)
├─ SplitView/
│  ├─ CustomerProjection(müşteri timeline'ının birebir kopyası)
│  └─ InternalLog(ham geçiş kaydı: eski→yeni · aktör · gerekçe · saat)
└─ EvidenceStrip(kanıt fotoları · iletişim logu · tercih/adres özeti)
```

- **Layout:** 50/50 split — iki kolonun satırları zamana göre hizalı (aynı olay aynı yatay hizada).
- **Responsive:** <1280: sekmeli (Müşteri | İç kayıt).
- **Durumlar:** L: iki kolon iskelet · E: — · Er: satır-içi · O: salt-okunur · S: varsayılan.
- **Edge:** İç kayıttaki `gerekçe/aktör` alanlarının müşteri kolonunda ASLA karşılığı yoktur — bu ekran, beyaz-liste projeksiyonunun doğru çalıştığının görsel kanıtıdır (PDS §3.2) · "Teslim edilmedi" iddiası (F4-ödeme) → kanıt şeridi + konum teyidi bu ekranda savunma dosyasıdır · Telafi öner → O8 telafi kuyruğuna kayıt.
- **Aksiyonlar:** Yarına planla, telafi öner, ⋮ (iptal+iade başlat · notu düzelt), kanıt büyüt.
- **Mikro etkileşimler:** Kolonlar arası hizalı kaydırma (senkron scroll).
- **Animasyonlar:** Yok.
- **A11y:** Split sekme alternatifi klavyeyle; fotolar `alt` şablonlu.

---

### O6 · İade Kuyruğu (V2)

**Amaç:** İade yaşam döngüsünü yürütmek (kargo gelişi → kontrol → karar). | **Kullanıcı hedefi:** Bekleyen iadeyi kontrol edip parayı serbest bırakmak/reddetmek.

```
┌──────────────────────────────────────────────────────────────┐
│ İadeler          (Bekleyen 4) (Kontrolde 1) (Sonuçlanan)     │
├──────────────────────────┬───────────────────────────────────┤
│ ○ R-311 · E. Yılmaz      │ R-311 · Fizik Soru Bankası        │
│   "beğenmedim" · Cmt     │ Neden: beğenmedim                 │
│ ○ R-312 · hasarlı 📷     │ Müşteri fotoları: ▢ ▢             │
│   …                      │ Kontrol: ◉ satılabilir            │
│                          │          ○ hasarlı (📷 zorunlu)   │
│                          │ [ ✓ Onayla — ₺189 iade et ]       │
│                          │ [ ✗ Reddet (gerekçe zorunlu) ]    │
└──────────────────────────┴───────────────────────────────────┘
```

```
ReturnQueue/
├─ Header + durum segmenti
├─ ReturnList(sol: kod + müşteri + neden + tarih; hasarlı 📷 rozetli)
└─ InspectionPanel(sağ)/
   ├─ ReturnSummary + müşteri fotoları
   ├─ ConditionRadio(+hasar fotosu zorunlu)
   └─ Decision: ApproveButton(tutar görünür) / RejectButton(gerekçe alanı)
```

- **Layout:** 35/65 split.
- **Responsive:** <1280 stack.
- **Durumlar:** L/Er standart · E: "Bekleyen iade yok" · O: karar butonları disabled · S: onay → müşteriye "₺189 kartına iade — bankana göre 1–5 iş günü" bildirimi otomatik.
- **Edge:** Red → gerekçe alanı zorunlu; gerekçe **müşteri diline çevrilerek** gider + itiraz yolu açılır (F3) · Red kararı 30 sn geri-alınabilir · Hasarlı-geldi iddialı iadede müşteri fotoğrafı ile kontrol fotoğrafı yan yana.
- **Aksiyonlar:** İade seç, durum işaretle, onayla, reddet, fotoğraf karşılaştır.
- **Mikro etkileşimler:** Onay butonunda tutar yazar (yanlış tutarda fark edilir); karar sonrası satır süzülür.
- **Animasyonlar:** Satır süzülmesi.
- **A11y:** Karar butonları renk+ikon+metin; gerekçe alanı `aria-required`.

---

### O7 · Kuryeler & Araçlar (MVP)

**Amaç:** Kurye kimliği ve araç ataması CRUD. | **Kullanıcı hedefi:** Müşteriye gösterilecek kimlik kartını eksiksiz kurmak.

```
┌──────────────────────────────────────────────────────────────┐
│ Kuryeler                                      [+ Yeni kurye] │
├──────────────────────────┬───────────────────────────────────┤
│ ▢ Mehmet K. · LADA       │ ▢ vesikalık (zorunlu)  [Yükle]    │
│   aktif                  │ Ad Soyad ┌─────────────┐          │
│ ▢ Ali T. · —             │ Araç     ◉ LADA ○ COROLLA ○ —     │
│   pasif                  │ Plaka    ┌─────────────┐          │
│                          │ Durum    (aktif) (pasif)          │
│                          │ ── Müşteri kartı önizleme ──      │
│                          │ ┌ ▢ Mehmet · Beyaz LADA · 01… ┐   │
│                          │ [Kaydet]                          │
└──────────────────────────┴───────────────────────────────────┘
```

```
CourierAdmin/
├─ Header + AddButton
├─ CourierList(foto + ad + araç + durum)
└─ CourierForm/
   ├─ PhotoUpload(zorunlu — kart fotosuz yayınlanamaz)
   ├─ Fields(ad · araç radio · plaka · durum)
   ├─ CustomerCardPreview(CourierIdentityCard birebir — "müşteri bunu görecek")
   └─ SaveButton
```

- **Layout:** 30/70 split.
- **Responsive:** <1280 stack.
- **Durumlar:** L/Er standart · E: "Henüz kurye yok" + ekle · O: form disabled · S: kayıt → önizleme güncellenir.
- **Edge:** Foto olmadan kaydet → engellenir: müşteri kartı (V2) fotosuz çıkamaz · Aktif turdaki kuryeyi pasife alma → engellenir + "önce turu devret" (D1 köprüsü) · Aynı araca iki aktif kurye → uyarı (vardiya durumu netleştirilir).
- **Aksiyonlar:** Ekle, düzenle, foto yükle, araç ata, aktif/pasif.
- **Mikro etkileşimler:** Form alanları önizleme kartını canlı günceller (kimlik kartı WYSIWYG).
- **Animasyonlar:** Yok.
- **A11y:** Foto yükleme klavyeyle; önizleme `aria-label` "müşterinin göreceği kart".

---

### O8 · Raporlar & Ayarlar (MVP)

**Amaç:** KPI izleme + sistem parametreleri + telafi kuyruğu. | **Kullanıcı hedefi:** Haftayı okumak, eşikleri yönetmek, telafileri onaylamak.

```
┌──────────────────────────────────────────────────────────────┐
│ (Raporlar) ( Telafi 2 ) ( Geri bildirim ) ( Ayarlar )        │
├──────────────────────────────────────────────────────────────┤
│ RAPORLAR — bu hafta (baseline dönemi: hedef yok)             │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│ │Söz tutma │ │Pencere   │ │İlk dene- │ │Sorunsuz  │          │
│ │  94%  ▁▃▅│ │isabeti 88│ │mede 91%  │ │sipariş 86│          │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│ Unit economics: maliyet/durak ₺23 · SMS/sipariş 1,7 ·        │
│ kapasite kullanımı 0,82                                      │
│ FAILED nedenleri: evde yok 54% · adres 28% · erişim 18%      │
├──────────────────────────────────────────────────────────────┤
│ AYARLAR: kapasite/araç [22] · tampon [0,9] · cutoff [16:00]  │
│ bölge yarıçapı [25 km] · pencere toleransı [±30dk]           │
│ değer eşiği [₺1500] · erteleme limiti [2] · SMS tavanı [3]   │
│ sessiz saat [21:00–08:30]                                    │
└──────────────────────────────────────────────────────────────┘
```

```
ReportsSettings/
├─ TabBar(Raporlar · Telafi(rozet) · Geri bildirim · Ayarlar)
├─ ReportsTab/
│  ├─ KpiCardGrid(değer + mini trend; baseline döneminde hedef çizgisi YOK)
│  ├─ UnitEconomicsRow + FailReasonBreakdown
├─ CompensationTab: sıra bekleyen telafi önerileri → [Onayla|Değiştir|Reddet]
├─ FeedbackTab: 👎 kayıtları (günlük, acil değil) + etiket dağılımı
└─ SettingsTab: parametre formu (her alanda birim + açıklama + değişiklik logu)
```

- **Layout:** Sekmeli tek sayfa; KPI grid 4 sütun.
- **Responsive:** <1280: KPI 2 sütun.
- **Durumlar:** L: KPI kart iskeletleri · E(Telafi): "Bekleyen telafi yok" · Er: kart bazlı satır-içi · O: salt-okunur · S: varsayılan.
- **Edge:** Baseline döneminde (ilk 90 gün) hedef çizgileri ve kırmızı/yeşil yargı renkleri GÖSTERİLMEZ — sadece değer + trend (PDS §14) · Ayar değişikliği anında yarının sözlerini etkiler → kaydetmeden önce etki önizlemesi ("kapasite 22→18: yarın 4 sipariş Cumaya kayar") · Telafi onayı → müşteriye bildirim + O5 kaydına işlenir · Ayar değişiklikleri değişiklik loguna yazılır (kim, ne zaman, eski→yeni).
- **Aksiyonlar:** Sekme gezinme, telafi kararları, ayar düzenle + etki önizle, FAILED nedenine tıkla → filtreli sipariş listesi.
- **Mikro etkileşimler:** Ayar kaydetme onayı etki cümlesiyle; KPI kartına hover → tanım tooltip'i (metrik sözlüğü).
- **Animasyonlar:** Yok — rapor yüzeyi durağandır.
- **A11y:** Trend grafiklerinin metin eşdeğeri ("son 4 hafta: 91, 92, 94, 94"); ayar formu tam klavye; tehlikeli ayarlarda (kapasite düşürme) onay diyaloğu.

---

## 4. Kapanış Notu

28 ekranın tamamı bileşen hiyerarşisi, durum matrisi ve edge case bağlarıyla tanımlandı. Figma'da çizim sırası önerisi: **önce bileşen kütüphanesi** (PDS §7.2'deki 16 bileşen — özellikle `PromiseDisplay`, `DeliveryTimeline`, `DriverStopCard`, `SystemState`), sonra M6 → M8 → K2 → K4 → O2 (sistemin beş taşıyıcı ekranı), sonra kalanlar. Her ekran dosyada kendi durum varyantlarıyla (L/E/Er/O/S) bir frame seti olarak açılmalı; edge case'ler varyant değil anotasyon olarak işlenmeli.


