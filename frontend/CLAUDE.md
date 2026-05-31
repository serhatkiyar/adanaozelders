# Frontend — Ceyhan Tutoring Marketplace

React 18 + Vite + TypeScript + Tailwind CSS 3. Durum (State) yönetimi için Zustand, veri çekme/senkronizasyon için React Query (`@tanstack/react-query`), API iletişimi için Axios kullanılır.

## Çalıştırma

```bash
npm install
cp .env.example .env    # VITE_API_BASE_URL=http://localhost:8000/api/v1
npm run dev              # http://localhost:5173
npm run test             # Vitest (jsdom) — birim testleri (CI'da koşar)
```

**Test:** Vitest + React Testing Library (`vitest.config.ts`, jsdom). Testler `src/**/*.test.{ts,tsx}` (build'in `tsc -b`'sinden `tsconfig` exclude ile ayrılır; vitest/esbuild koşar). Kapsam: saf lib'ler (money/lesson/datetime/roles) + bileşen (PaymentBadge). Yeni saf yardımcı/edge-case eklerken testini de yaz.

## Dizin Yapısı ve Mimari Dağılım

```
frontend/src/
├── main.tsx                   # React root render
├── App.tsx                    # ErrorBoundary + Router + QueryProvider + WsManager + GlobalMeeting + Toaster
├── index.css                  # Tailwind direktifleri, custom animasyonlar (toast, marquee)
├── types/                     
│   └── index.ts               # (Kritik) Tüm TypeScript interfaceleri. Backend pydantic ile birebir eşleşir.
├── api/                       # Axios çağrılarını modüller halinde gruplayan katman
│   ├── axios.ts               # Base Axios; JWT interceptor; 401'de sessiz refresh (rotasyon) + retry, başarısızsa logout
│   ├── auth.ts (login/logout), bookings.ts, messages.ts, qa.ts, tutors.ts vb.
├── hooks/                     # Tüm asenkron API işlemleri için React Query hookları
│   ├── useBookings.ts         # Optimistic UI update içeren booking mutasyonları
│   ├── useMessages.ts         # Polling (15-30 sn) yapan mesaj/bildirim hookları
│   └── useTutorSearch.ts, useDebounce.ts vb.
├── store/                     # Zustand state yönetimi
│   ├── authStore.ts           # token, user, login/logout, localStorage persist
│   ├── themeStore.ts          # Light/Dark mode (localStorage persist)
│   ├── meetingStore.ts        # Aktif canlı ders penceresi (persist; minimize/leave)
│   ├── wsStore.ts             # WebSocket bağlantısı (token ile connect)
│   └── toastStore.ts          # Geçici toast bildirim kuyruğu (auto-dismiss)
├── lib/                       # Utility fonksiyonları
│   ├── queryClient.ts         # Global React Query ayarları (staleTime: 30s vb.)
│   ├── datetime.ts, money.ts  # Türkçe tarih ve para formatlayıcıları (Decimal parse dahil)
│   ├── examTree.ts            # LGS/YKS sınav konu taksonomisi
│   └── lesson.ts              # Jitsi URL + Google Maps URL + isLessonJoinable (zaman kapısı)
├── components/                # Tekrar kullanılabilir UI bileşenleri
│   ├── DashboardShell.tsx     # Private area: sidebar, hamburger, notification bell, user menu
│   ├── PublicShell.tsx        # Public area layout
│   ├── TutorCard.tsx          # Zengin eğitmen kartı (bayesian rating, bookmark, mesafe rozeti)
│   ├── GlobalMeeting.tsx      # Minimize edilebilir gömülü Jitsi ders penceresi (meetingStore)
│   ├── MapPicker.tsx          # Leaflet/OSM harita konum seçici (API key gerektirmez)
│   ├── ErrorBoundary.tsx      # Render hatalarında beyaz ekranı önler
│   └── Toaster, Modal'lar, StarRating, MegaMenu vb.
└── pages/                     # Sayfalar
    ├── Landing.tsx, PublicMarketplace.tsx, PublicTutorProfile.tsx  # Public (Auth gerektirmez)
    ├── Login.tsx, Register.tsx                                     # Auth
    ├── ForgotPassword.tsx, ResetPassword.tsx, VerifyEmail.tsx      # E-posta doğrulama & şifre sıfırlama (token'lı, public)
    ├── Marketplace.tsx, TutorProfile.tsx, Favorites.tsx            # Öğrenci Arama & Detay ("Yakınımda" geo arama)
    ├── StudentBookings.tsx, Exams.tsx, Questions.tsx, StudentDemands.tsx # Öğrenci Özel
    ├── TutorDashboard.tsx, TutorSettings.tsx, TutorDemands.tsx     # Eğitmen Özel (TutorSettings: konum MapPicker)
    ├── Messages.tsx, LessonDetail.tsx, Calendar.tsx, Profile.tsx   # Ortak Sayfalar (Calendar: haftalık takvim)
    └── dashboards/AdminHome.tsx                                    # Admin Dashboard
```

## Routing ve Erişim Kontrolü

URL yapısı **iki yüzeye** ayrılır ve **tek kaynaktan** (`lib/routes.ts::ROUTES`) yönetilir — bileşenlerde ham path literal'i kullanmayın, daima `ROUTES`'tan tüketin.

- **Public (Türkçe/SEO):** `/` (Landing), `/egitmenler` (arama), `/egitmenler/:slug` (eğitmen profili; slug = `isim-soyisim-{id}`, backend `slug` döner), `/giris`, `/kayit`, `/sifremi-unuttum`, `/sifre-yenile`, `/e-posta-dogrula`.
- **Panel (oturum içi, nötr `/panel` shell, role-adaptive):** aşağıdaki tablo.

Aynı kaynağın **tek kanonik URL'i** vardır: `/egitmenler` ve `/egitmenler/:slug`, oturuma göre shell uyarlayan **delegator** sayfalardır (`MarketplacePage`, `TutorProfilePage` → anonim = public shell, giriş'li = panel shell + rezervasyon/mesaj). Slug kanonik değilse (`/egitmenler/42` veya bayat slug) `useCanonicalTutorSlug` ile `replace` yönlendirilir. Eski URL'ler (`/login`, `/kesfet`, `/egitmen/:id`, `/student/*`, `/tutor/*`, `/lesson/:id`, `/profile` …) `routes/LegacyRedirect.tsx` ile yeni yapıya (query/param korunarak) yönlendirilir.

`ProtectedRoute.tsx` token + rol eşleşmesini kontrol eder; login olmuş kullanıcı `/giris`/`/kayit`'a girerse `roleHome` ile kendi yüzeyine döner (ADMIN/TUTOR → `/panel`, CLIENT → `/egitmenler`).

| Rol | Ana Sayfa | Özel Route'lar (hepsi `/panel/*`) |
|-----|-----------|-----------------------------------|
| ADMIN (1) | `/panel` (AdminHome) | — |
| TUTOR (2) | `/panel` (TutorDashboard) | `/panel/ilan` (ilan ayarları), `/panel/ogrenciler/:id`, `/panel/sorular` (gelen sorular) |
| CLIENT (3)| `/egitmenler` (arama) | `/panel/favoriler`, `/panel/denemeler`, `/panel/rezervasyonlar`, `/panel/sorular` (kendi soruları) |
| Ortak | — | `/panel/mesajlar`, `/panel/profil`, `/panel/ayarlar`, `/panel/liderlik`, `/panel/takvim`, `/panel/rezervasyonlar/:id` (ders detayı) |

`/panel` ve `/panel/sorular`, rol göre farklı içerik render eden delegator'lardır (`PanelHome`, `PanelQuestions`).

## State Yönetimi

- **Server State**: `@tanstack/react-query`. Caching, arka planda yenileme, error handling. Mesajlar ve bildirimlerde 15-30 saniyelik `refetchInterval` (polling) bulunur. Rezervasyon aksiyonlarında (accept, cancel) cache invalidation + optimistic update yapılır.
- **Client State**: Zustand.
  - `authStore`: Access + **refresh** token, aktif kullanıcı, "beni hatırla" tercihi (her ikisi de persist). `setTokens` login ve sessiz yenilemede ikisini yazar. Logout sunucuya `/auth/logout` atar (access denylist + refresh revoke), sonra yerel state'i temizler.
  - `themeStore`: Tema seçimi (Light/Dark). Tailwinds `dark:` class'ı tetiklenir.
  - `meetingStore`: Aktif canlı ders penceresi (oda/isimler/minimize). **persist** ile sayfa gezinmesinde korunur; `GlobalMeeting` bunu render eder.
  - `wsStore`: WebSocket bağlantısı (token ile connect); App'teki `WsManager` mesaj/bildirim/booking-comment push'larında React Query cache'ini invalidate eder.
  - `toastStore`: Hata, başarı, uyarı bildirimlerini ekranın altında gösterir.

## Öne Çıkan Özellikler (Akış Notları)

- **Canlı ders (Jitsi)**: `GlobalMeeting` minimize edilebilir gömülü pencere; `meetingStore.joinMeeting` ile açılır. "Derse Katıl" butonu yalnız `isLessonJoinable` (başlangıçtan 15 dk önce – bitişten 30 dk sonra) penceresinde aktiftir.
- **Coğrafi arama**: `Marketplace`'te "Yakınımda" butonu tarayıcı geolocation'ı alır; `lat/lng/radius_km` ile arar; sonuçlarda `TutorCard` mesafe rozeti gösterir. Eğitmen konumunu `TutorSettings`'te `MapPicker` ile işaretler.
- **Takvim**: `/calendar` — tutor/öğrenci için haftalık ders ızgarası (hafta gezinme).
- **Ders işbirliği**: `LessonDetail`'de yorumlar, kaynaklar (**link ekle** veya **dosya yükle** — gizli `<input type=file>`, kaynak listesinde dosya/link ayrımı + boyut/indirme), buluşma konumu (MapPicker) ve özel notlar; booking-comment'ler WebSocket ile canlı yenilenir.
- **E-posta doğrulama & şifre sıfırlama**: `/sifremi-unuttum` → `/sifre-yenile?token=` ve kayıt sonrası `/e-posta-dogrula?token=` akışları (PublicRoute dışında, oturumdan bağımsız erişilebilir; backend e-posta linkleri bu Türkçe path'leri üretir). `DashboardShell`, `user.email_verified === false` iken "yeniden gönder"li bir doğrulama banner'ı gösterir; doğrulama sonrası `me` cache'i tazelenir. Login'de "Şifremi unuttum?" linki.
- **Ödeme (escrow)**: `usePayments` (api/payments.ts) — `StudentBookings`'te onaylı+ödenmemiş derste "Öde" butonu (fake sağlayıcıda anında; prod'da `redirect_url`'e yönlendirir) ve `PaymentBadge` durum rozeti. `TutorDashboard`'da kazanç özeti (net + emanette) ve booking kartlarında ödeme rozeti. Ödeme durumu `BookingOut.payment` üzerinden gelir (ayrı istek gerekmez).

## Tasarım Dili ve UI Özellikleri

- **Modern SaaS Arayüzü**: Shadcn/Tailwind UI esintili. Bol `rounded-xl`, soft shadows (yumuşak gölgeler).
- **Karanlık Mod (Dark Mode)**: Uygulama baştan aşağı dark mode uyumludur (`dark:bg-slate-900`, `dark:text-white` vb.).
- **Mobil Uyumluluk**: Tamamen responsive'dir. Mobile geçişte Navbar gizlenir, Hamburger menüye dönüşür. Data tabloları yatay scroll edilir (`ScrollableRow`).
- **Lokalizasyon**: Tarih formatları `Intl.DateTimeFormat("tr-TR")`, para birimi ₺, tüm etiketler, durum mesajları ve error interceptor Türkçe'dir.
- **Yükleme Durumları (Loading states)**: Spinner yerine Skeleton (Shimmer) yapıları kullanılır.

## Kodlama Kuralları ve Geliştirme Akışı

- **Kesin Kural**: Sisteme MOCK (sahte) veri eklemek yasaktır. İhtiyaç varsa backend API güncellenir.
- Yeni bir endpoint kullanılacaksa:
  1. `types/index.ts` dosyasına Pydantic şemasının karşılığını ekleyin.
  2. `api/` altında bir axios fetch fonksiyonu yazın.
  3. `hooks/` altında ilgili query/mutation hook'unu tanımlayın (`useQuery` / `useMutation`).
  4. Component içinde bu hook'u çağırın.
- Sayfalar arasında gezinirken `react-router-dom`'un `Link` veya `useNavigate` metodunu kullanın, sayfa yenilemesi (a href) yapmayın.
- Tüm form veri değişimlerini ve API hata/başarı durumlarını bildirmek için `toast.success()`, `toast.error()` (veya hook error handler'ı) kullanın. Backend'den gelen `409` (çakışma), `429` (kota aşımı) hatalarını kullanıcı dostu mesajlarla ele alın.
