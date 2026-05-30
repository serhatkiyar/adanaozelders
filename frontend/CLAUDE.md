# Frontend — Ceyhan Tutoring Marketplace

React 18 + Vite + TypeScript + Tailwind CSS 3. Durum (State) yönetimi için Zustand, veri çekme/senkronizasyon için React Query (`@tanstack/react-query`), API iletişimi için Axios kullanılır.

## Çalıştırma

```bash
npm install
cp .env.example .env    # VITE_API_BASE_URL=http://localhost:8000/api/v1
npm run dev              # http://localhost:5173
```

## Dizin Yapısı ve Mimari Dağılım

```
frontend/src/
├── main.tsx                   # React root render
├── App.tsx                    # Router + QueryProvider + Toaster (Toast container)
├── index.css                  # Tailwind direktifleri, custom animasyonlar (toast, marquee)
├── types/                     
│   └── index.ts               # (Kritik) Tüm TypeScript interfaceleri. Backend pydantic ile birebir eşleşir (460+ satır).
├── api/                       # Axios çağrılarını modüller halinde gruplayan katman (16 dosya)
│   ├── axios.ts               # Base Axios instance, JWT interceptor, 401 otomatik logout
│   ├── auth.ts, bookings.ts, messages.ts, qa.ts, tutors.ts vb.
├── hooks/                     # Tüm asenkron API işlemleri için React Query hookları (18 dosya)
│   ├── useBookings.ts         # Optimistic UI update içeren booking mutasyonları
│   ├── useMessages.ts         # Polling (15-30 sn) yapan mesaj/bildirim hookları
│   └── useDebounce.ts vb.
├── store/                     # Zustand state yönetimi
│   ├── authStore.ts           # token, user, login/logout, localStorage persist
│   ├── themeStore.ts          # Light/Dark mode (localStorage persist)
│   └── toastStore.ts          # Geçici toast bildirim kuyruğu (auto-dismiss)
├── lib/                       # Utility fonksiyonları
│   ├── queryClient.ts         # Global React Query ayarları (staleTime: 30s vb.)
│   ├── datetime.ts, money.ts  # Türkçe tarih ve para formatlayıcıları (Decimal parse dahil)
│   ├── examTree.ts            # LGS/YKS sınav konu taksonomisi
│   └── lesson.ts              # Jitsi Meet URL ve Google Maps URL jeneratörleri
├── components/                # Tekrar kullanılabilir UI bileşenleri
│   ├── DashboardShell.tsx     # Private area: sidebar, hamburger, notification bell, user menu
│   ├── PublicShell.tsx        # Public area layout
│   ├── TutorCard.tsx          # Zengin eğitmen kartı (bayesian rating, bookmark vb.)
│   └── Toaster, Modal'lar, StarRating, MegaMenu vb.
└── pages/                     # Sayfalar
    ├── Landing.tsx, PublicMarketplace.tsx, PublicTutorProfile.tsx  # Public (Auth gerektirmez)
    ├── Login.tsx, Register.tsx                                     # Auth 
    ├── Marketplace.tsx, TutorProfile.tsx, Favorites.tsx            # Öğrenci Arama & Detay
    ├── StudentBookings.tsx, Exams.tsx, Questions.tsx, StudentDemands.tsx # Öğrenci Özel
    ├── TutorDashboard.tsx, TutorSettings.tsx, TutorDemands.tsx     # Eğitmen Özel
    ├── Messages.tsx, LessonDetail.tsx, Profile.tsx                 # Ortak Sayfalar
    └── dashboards/AdminHome.tsx                                    # Admin Dashboard
```

## Routing ve Erişim Kontrolü

Projede asimetrik bir rol/yönlendirme mimarisi vardır. `ProtectedRoute.tsx` token varlığını kontrol eder ve rol eşleşmesine bakar.
Ayrıca, login olmuş bir kullanıcı `/login` veya `/` public sayfalarına girerse kendi dashboard'una redirect edilir.

| Rol | Ana Sayfa / Dashboard | Özel Route'lar |
|-----|-----------------------|----------------|
| ADMIN (1) | `/admin` | Sadece admin istatistikleri ve kullanıcı yönetimi |
| TUTOR (2) | `/tutor` | `/tutor/settings`, `/tutor/students`, `/tutor/demands`, `/tutor/questions` |
| CLIENT (3)| `/student` | `/student/favorites`, `/student/exams`, `/student/demands`, `/student/bookings` |
| Ortak | - | `/messages`, `/profile`, `/settings`, `/leaderboard`, `/lesson/:id` |

## State Yönetimi

- **Server State**: `@tanstack/react-query`. Caching, arka planda yenileme, error handling. Mesajlar ve bildirimlerde 15-30 saniyelik `refetchInterval` (polling) bulunur. Rezervasyon aksiyonlarında (accept, cancel) cache invalidation + optimistic update yapılır.
- **Client State**: Zustand.
  - `authStore`: Token, aktif kullanıcı, "beni hatırla" tercihi.
  - `themeStore`: Tema seçimi (Light/Dark). Tailwinds `dark:` class'ı tetiklenir.
  - `toastStore`: Hata, başarı, uyarı bildirimlerini ekranın altında gösterir.

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
