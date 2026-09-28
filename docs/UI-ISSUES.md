# UI Issues

## High
- 768px civarında header'da "Ders Ver" / "Giriş Yap" sarılması.
- Profilim (`TutorSettings.tsx`): bölüm değiştirince (`<section key={aktif}>`) kaydedilmemiş metin sessizce kayboluyor; "Onaya gönder" kaydedilmemiş değişikliği göndermiyor ve düzenlemeyi kilitliyor. Bölüm başına kirli durum + onay gerekli (desen: `components/admin/ui2/gezinmeBekcisi.tsx`).

## Medium
- Tutor card favori butonu touch target 38px; hedef 44px.
- LibraryCard focus davranışı TutorCard ile tutarsız.
- Skeleton → gerçek kart geçişinde layout shift.
- Ortak `components/ui/Modal.tsx` kapat düğmesi 36×36 (`h-9 w-9`); telefonda dokunma hedefi 44px altında (ör. Profilim → Video → Video gereksinimleri penceresi).
- Masaüstü arama hapı: "Ders şekli" / "Yer" seçicileri ve ders önerileri klavyeyle seçilemiyor (ok/Enter yok, `onMouseDown` ile seçim) — `AramaSecicileri.tsx`, `HeroSearch.tsx`.
- Masaüstü liste filtre açılırları (`FiltreAcilir.tsx`): açılınca odak panele taşınmıyor, kapanınca tetikleyiciye dönmüyor; panel `<body>` sonuna portallandığı için klavyeyle ulaşılamıyor.
- Öğretmen profili, anonim + 390px: mesaj düğmesi yok (masaüstünde var); masaüstünde anonim "Mesaj gönder" girişten sonra niyeti taşımıyor, öğrenci düğmeyi yeniden bulmak zorunda (`PublicTutorProfile.tsx`, `lib/bekleyenNiyet.ts`).
- Oturumlu ÖĞRETMEN başka öğretmenin profilinde "Ders Talep Et" görüyor; ders rezervasyonu eğitmene kapalı (`egitmen-alici-sozlesme.md` K-20), sihirbaz sonunda "yetkin yok" hatası çıkıyor. Ürün kararı gerekiyor: düğmeyi gizlemek mi, açıklamak mı.

## Low
- Küçük LibraryCard'da "Şu an açık" etiketi avatar/baş harfle çakışabiliyor.
- Profilim (390px): `?bolum=video` gibi sağdaki bir bölümle açılınca etkin sekme yatay şeritte kesik kalıyor; etkin sekme yüklemede görünür kaydırılmıyor (`TutorSettings.tsx` bölüm menüsü).
- Mesajlar: gönder düğmesi 36px (`Messages.tsx`, `h-9 w-9`).
- Ortak `PhoneEditor` (ders talebi penceresi ve Mesajlar'daki telefon kapısı): siyah birincil düğme penceredeki turuncu birincil düğmeyle çelişiyor; girdi 14px (iOS yakınlaştırır, mobil kural 16px); "kod gönderildi / kod hatalı" geri bildirimi yalnız toast (pencerenin `aria-modal` alanı dışında).
- Öğretmen takvimi (masaüstü haftalık görünüm): 1 saatlik bekleyen derste "Ad · onay bekliyor" etiketinin durum kısmı kutuda kırpılıyor (ad görünür; durum renk ve lejantla da belli).
- `/egitmenler`: kart başlıkları `h3`, sayfada `h2` yok (axe heading-order).
- İlan sihirbazı: ders/ders şekli grup hatalarında odak `div`e gidemiyor, hata metni alana bağlı değil (`IlanSihirbazi.tsx` `alanaOdaklan`, `AdimProps`).
- Profilim ücret/başlık/müsaitlik doğrulama hataları yalnız toast; müsaitlik satırı etiketleri her satırda aynı ("Gün/Başlangıç/Bitiş").
- Kayıtlı adres kartı ikon düğmeleri yalnız `title` ile adlandırılmış; `AddressForm` doğrulama hataları yalnız toast.
- Kayıt parolası: kural yalnız placeholder'da ("En az 8 karakter"); tarayıcının İngilizce yerel doğrulama balonu görünüyor.

## Verification gaps
- Favorites route login ile 390px / 1440px doğrulanmadı.
- Promoted/reklam tutor varyantı gerçek veriyle doğrulanmadı.
- Yüz yüze ders + yeni adres ekleme akışı gerçek haritayla (MinIO/harita karosu olmadan) tarayıcıda uçtan uca denenmedi; yalnız birim testiyle doğrulandı.
