# Eğitmen ilan ekranı — mevcut durum ve yenileme notları

**Tarih:** 6 Eylül 2026 · **Durum:** keşif tamamlandı, yenileme YAPILMADI.

Kullanıcı Superprof'un "İlanlarım → Düzenle" ekranını referans gösterdi (tek
sayfa; her bölüm başlığında kalem; sağda sabit kart: avatar, saatlik ücret,
"İlan yayında" anahtarı, "Öğrencinin gözünden gör", "İlanımı sil").
Karar: **yenileme sonraya bırakıldı**; o turda yalnız keşifte bulunan hata
düzeltildi (tanıtım videosu — aşağıda §7).

Bu dosyanın amacı, bir dahaki turda aynı keşfi yeniden yapmayı gereksiz kılmak.

---

## 1. Bugün İKİ paralel editör var ve aynı 11 alanı yazıyorlar

| | Rota | Nasıl | Nereden girilir |
|---|---|---|---|
| **Sihirbaz** | `/ilanini-olustur` (`pages/tutorOnboarding/`) | 9 adım, her adım kendi `PATCH`ini atar | kayıt sonrası otomatik (`Register.tsx:59`, `AuthModal.tsx:254`) + eğitmen panosunda **yalnız `DRAFT` iken** "devam et" kartı (`TutorDashboard.tsx:282`) |
| **İlanım** | `/ilan-ayarlari` (`pages/TutorSettings.tsx`) | tek büyük form, tek "Kaydet" | menüdeki **"İlanım"** (`lib/nav.ts:62`) |

**Çakışan alanlar:** `headline`, `bio`, `lesson_info`, `hourly_rate`,
`first_lesson_free`, `teaching_mode`, `district`, `location_text/lat/lng`,
`subjects`, `subject_levels`, `intro_video_url`.

**Yalnız İlanım'da:** `availability` (haftalık müsaitlik).
**Yalnız sihirbazda:** `gender`, avatar yükleme, telefon doğrulama.
Bu ayrım bilinçli — müsaitlik ve belge 5 Eyl 2026'da sihirbazdan çıkarıldı ve
`sozlesme.test.ts:130` bunu çıpalıyor.

**Önemli:** `APPROVED` bir eğitmen `/ilanini-olustur`a giderse formu **hiç
göremez** — `IlanSihirbazi.tsx:249` onu `Tebrikler` ekranına düşürür. Yani
onaylı ilanı düzenlemenin bugün tek yolu `/ilan-ayarlari`.

---

## 2. Superprof ekranındaki kontroller — bizdeki karşılıkları

| Kontrol | Durum | Not |
|---|---|---|
| "İlan yayında" anahtarı | **VAR, ama düğme olarak** | `TutorSettings.tsx:344-365` "Pasife Al" / "Yeniden Aktifleştir" (APPROVED↔SUSPENDED). Hook `useTutorListingAction`. Anahtara çevirmek görsel iş; durum makinesi hazır. |
| "Öğrencinin gözünden gör" | **YOK — backend engelli** | `services/search_service.py:561 get_tutor_public` `status != APPROVED` ise **404**. Yayında olmayan ilan public uçtan alınamıyor. Ya yeni bir "kendi ilanımı public şemayla getir" ucu ya da istemci-taraflı adaptör gerekir. |
| "İlanımı sil" | **YOK** | `/tutors/me` için DELETE ucu yok; yalnız komple hesap silme var (`Settings.tsx:811`). |
| Sağda avatar + ücret kartı | **YOK** | Parçalar hazır: `components/Avatar.tsx`, `lib/money.ts::formatRate`, durum metinleri `TutorSettings.tsx:42-107 STATUS_CFG`. |
| Ders paketleri (5/10 saat) | **YOK** | Modelde/şemada yok. Yeni kolon + migration + rezervasyon/ödeme tarafının bu fiyatı tanıması. **Para yolu** — en pahalı kalem. |
| Webcam ayrı ücret | **YOK** | Tek `hourly_rate`; `teaching_mode` yalnız kanal seçiyor. |
| Ulaşım ek ücreti | **YOK** | `travel_fee` benzeri alan yok. |
| İlk ders ücretsiz | **VAR** | `first_lesson_free` |
| Video (YouTube/Vimeo) | **VAR** | Doğrulayıcı `schemas/tutor.py:98-114`. Sihirbaz tarafındaki kayıp §7'de düzeltildi. |
| Seviyeler | **VAR** | `subject_levels` |
| Diller | **YOK** | "Konuştuğu diller" faseti yok (ders olarak "İngilizce" seçilebiliyor, aynı şey değil). |
| Referans isteme | **YOK** | Yalnız ders sonrası yorum var. |
| Paylaşım bağlantıları | **KISMEN** | `ShareButton` public profilde var, düzenleme yüzeyinde yok. |

---

## 3. Yayın akışı

`TutorStatus` (`models/tutor.py:36`): `DRAFT`, `PENDING_APPROVAL`, `APPROVED`,
`REJECTED`, `SUSPENDED`.

Geçişler (`services/tutor_service.py:179 _TRANSITIONS`):

    DRAFT            → PENDING_APPROVAL
    PENDING_APPROVAL → APPROVED | REJECTED
    REJECTED         → PENDING_APPROVAL
    APPROVED         → SUSPENDED
    SUSPENDED        → APPROVED

**DRAFT'a geri dönüş YOK.** Eğitmen ilanını taslağa çekemez; "yayından kaldır"
= `SUSPENDED` ve yalnız `APPROVED`'dan mümkün.

`PATCH /tutors/me` yalnız `PENDING_APPROVAL`da 409 verir
(`_EDITABLE_STATES = {DRAFT, REJECTED, APPROVED, SUSPENDED}`).
**Hata mesajı koddan geride ve yanıltıcı:** "Profile editable only in DRAFT or
REJECTED state" diyor ama APPROVED da düzenlenebilir. Ayrı bir temizlik kalemi.

Yayın kapısı `submit_for_approval` (`:242`): diploma kapısı 5 Eyl'de kaldırıldı;
kalan tek koşul başlık kelime eşiği (aksi hâlde 422).

---

## 4. Yeniden kullanılabilecek parçalar

**Sihirbazın adım bileşenleri routera ya da react-query'ye bağlı DEĞİL** —
yalnız `AdimProps`'un beş alanına bağlılar (`adimlar/ortak.ts:10`:
`d, guncelle, dis, odakla, gitAdim`). Tek sayfa bir ekranda `gitAdim`'e no-op
verip her adımı bir "bölüm" olarak basmak mümkün:
`Dersler`, `Metinler` (`AdimBaslik`/`AdimYontem`/`AdimHakkinda`/`TanitimVideosu`),
`Yer`, `Ucret`, `Fotograf`, `Telefon`.

Diğerleri: `components/form/alanlar.tsx` (alan bileşenleri, `dolgu` varyantı),
`kabuk.tsx::IkiKolon` (sol içerik / sağ yardım — sağ sabit karta en yakın
iskelet), `ui/Modal.tsx`, `ProfileCompleteness.tsx` (8 kalemlik doluluk),
`hooks/useAvatarUpload.ts` + `ImageCropModal`.

"Öğrencinin gözünden" için doğru bileşen `pages/PublicTutorProfile.tsx` —
ama §2'deki 404 engeli çözülmeden kullanılamaz.

---

## 5. Yenileme yapılırsa kırılacak nöbetçiler

- **`__guards__/sihirbazMercani.test.ts`** — mercan hex'leri YALNIZ
  `pages/tutorOnboarding` ağacında doğabilir. Yeni ekran o ağacın dışına
  yazılıp sihirbaz görünümünü taşırsa CI kırılır. **En yüksek risk.**
- **`__guards__/dersKaynagiTekligi.test.ts:110`** — `TutorSettings.tsx`i
  **isimle** arıyor; dosya yeniden adlandırılır/silinirse sert düşer.
- **`lib/routes.test.ts:40`** — `tutorListing === "/ilan-ayarlari"` çıpalı.
- **`sozlesme.test.ts:130`** — "müsaitlik ve belge adımları sihirbazda YOKTUR".
- **`__guards__/gonderDugmesi.test.ts`** — birincil düğme `disabled` olamaz;
  ham çağrı sayımı dondurulmuş.
- `markaAksani` / `tekTema` / `uiBaseline` / `beklemeButcesi` — yeni ekran
  marka token'larını kullanmalı, yeni bekleme durumları envantere girer.

---

## 6. Bir dahaki tura kalan ürün soruları

1. **Sihirbaz ilk oluşturmada kalsın mı?** Superprof'un kendi akışı böyle:
   1–15 sihirbaz adımları → 16 ilan listesi ("Düzenle" düğmesi) → 17 tek sayfa.
   (Referans görseller: `C:\Users\kiyar\Desktop\superprof-ilan-olusturma-asamalar`)
2. Ekran `/ilan-ayarlari`'nda mı yenilensin, yeni rota mı? (Rotayı değiştirmek
   iki nöbetçi güncellemesi demek — §5.)
3. Ticari alanlar (paket, webcam ücreti, ulaşım) kapsama girsin mi? Üçü de
   migration + para yolu işi.
4. "Öğrencinin gözünden gör" için hangi yol: yeni backend ucu mu, istemci
   adaptörü mü?

---

## 7. Bu turda DÜZELTİLEN hata — sihirbaz tanıtım videosunu düşürüyordu

`Durum.introVideoUrl` alanı vardı, `IlanSihirbazi.tsx:91` sunucudan geleni
okuyordu, `Metinler.tsx:82 TanitimVideosu` Fotoğraf adımında basılıp yerel
duruma yazıyordu — **ama hiçbir adımın `yama`'sı `intro_video_url`
göndermiyordu.** Sihirbaz yalnız `adim.yama(durum)`un döndürdüğünü `PATCH`ler
(`IlanSihirbazi.tsx:186`), dolayısıyla yazılan link sunucuya hiç gitmiyordu.

Hata görünmüyordu çünkü ekranda değer duruyordu; kayıp ancak sayfa yenilenince
ya da ilan yayınlanınca fark ediliyordu.

Düzeltme: `fotograf` adımının yamasına `intro_video_url` eklendi.
Nöbetçi: `sozlesme.test.ts` → *"durumdaki her alanın bir adımda yaması VAR"* —
tek alanı değil **kusur sınıfını** çıpalar; `Durum`a alan eklenip hiçbir yamaya
bağlanmazsa aynı sessiz kayıp tekrarlanamaz.
