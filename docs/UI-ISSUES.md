# UI Issues

## High
- 768px civarında header'da "Ders Ver" / "Giriş Yap" sarılması.

## Medium
- Tutor card favori butonu touch target 38px; hedef 44px.
- LibraryCard focus davranışı TutorCard ile tutarsız.
- Skeleton → gerçek kart geçişinde layout shift.
- Ortak `components/ui/Modal.tsx` kapat düğmesi 36×36 (`h-9 w-9`); telefonda dokunma hedefi 44px altında (ör. Profilim → Video → Video gereksinimleri penceresi).

## Low
- Küçük LibraryCard'da "Şu an açık" etiketi avatar/baş harfle çakışabiliyor.
- Profilim (390px): `?bolum=video` gibi sağdaki bir bölümle açılınca etkin sekme yatay şeritte kesik kalıyor; etkin sekme yüklemede görünür kaydırılmıyor (`TutorSettings.tsx` bölüm menüsü).

## Verification gaps
- Favorites route login ile 390px / 1440px doğrulanmadı.
- Promoted/reklam tutor varyantı gerçek veriyle doğrulanmadı.