import type { ReactNode } from "react";

import { colorFor, initials } from "@/components/Avatar";
import { BookmarkButton } from "@/components/BookmarkButton";
import { ShareButton } from "@/components/ShareButton";
import { StarRating } from "@/components/StarRating";
import { PlainButton } from "@/components/ui/PlainButton";
import { GORSEL_USTU_DAIRE } from "@/components/egitmen/gorselUstuDaire";
import { ozetSatirlari } from "@/components/TutorTrust";
import type { TutorSearchOut } from "@/types";

/* ────────────────────────────────────────────────────────────────────────────
   EĞİTMEN PROFİLİNİN MOBİL ÜST BLOĞU (yalnız `<md`)

   Kullanıcı kararı, 10 Eyl 2026 (referans: Superprof mobil eğitmen profili):
   telefonda profil, gezinme kabuğu olan bir "sayfa" gibi değil, tek bir ilana
   odaklanan bir DETAY EKRANI gibi açılsın.

   Öncesi masaüstü düzeninin daraltılmış hâliydi: `lg:` grid'in sağ sütunundaki
   beyaz rezervasyon kartı mobilde içeriğin üstüne düşüyor, karar verdiren tek
   şey olan YÜZ o kartın içinde 128px'lik bir yer tutucu gibi duruyordu. Üstünde
   üst bar (~130px), altında alt sekme çubuğu vardı.

   Bu bileşen ve `DersTalepSeridi` ORTAKTIR: rotanın iki kabuğu
   (`PublicTutorProfile` anonim, `TutorProfile` girişli) düzeni birebir tekrar
   ediyor ve daha önce sessizce ayrışmışlardı. Mobil düzen tek yerde yaşasın ki
   bir sonraki düzeltme ikisine birden uygulansın.
   GÖRÜNÜRLÜK DEĞİL MONTAJ: bu bileşen `md:hidden` TAŞIMAZ. Çağıran sayfalar
   `useMobil()` ile ya bunu ya masaüstü kartını mount eder, ikisini birden
   asla. Sebep `useMedyaSorgusu.ts`te yazılı olanın aynısı: iki dal da DOM'a
   basılsaydı sayfada iki `<h1>` ve iki "Ders talep et" düğmesi olurdu —
   `__guards__/eylemKapisiSayfayiKorur.test.tsx:190` tam da o düğmeyi tek
   olarak arıyor ve çoklu eşleşmeden düşerdi.
   ──────────────────────────────────────────────────────────────────────── */

export function EgitmenMobilUst({
  tutor,
  ucret,
  rozet,
  favoriGizli = false,
  ilkDersMetni,
  onGeri,
  onYorumlar,
  onMesaj,
}: {
  tutor: TutorSearchOut;
  /** Biçimlendirilmiş saatlik ücret; `null` ise sütun basılmaz. */
  ucret: string | null;
  /** İsmin yanındaki rozet (anonim kabukta `<DocumentedBadge/>`). */
  rozet?: ReactNode;
  /** Eğitmen kendi profiline bakıyorsa favori düğmesi çizilmez. */
  favoriGizli?: boolean;
  /** "İlk ders ücretsiz" / "İlk dersin ücretsiz" — yoksa `null`. */
  ilkDersMetni: string | null;
  /**
   * GERİ — sayfanın TEK çıkışı (üst bar da alt çubuk da çizilmiyor).
   *
   * Karar SAYFAYA ait: `useGeriDonus` sayfa seviyesinde çağrılmalı, çünkü
   * "geçmiş var mı" işaretinin ilk render'da yakalanması gerekiyor ve bu
   * bileşen veri geldikten sonra mount oluyor. Gerekçenin tamamı
   * `hooks/useGeriDonus.ts`te.
   */
  onGeri: () => void;
  onYorumlar: () => void;
  /**
   * "Mesaj gönder" dairesi. Yalnız giriş yapmış öğrenciye verilir; anonim
   * kabuk (`PublicTutorProfile`) vermez ve daire çizilmez.
   */
  onMesaj?: () => void;
}) {
  // Hangi ölçülerin basılacağı masaüstü tablosuyla ORTAK kaynaktan gelir
  // (`ozetSatirlari`); burada değişen yalnız yerleşim ve etiketin kısa hâli.
  const sutunlar = ozetSatirlari(tutor, ucret);
  // Tailwind JIT literal sınıf ister: `grid-cols-${n}` yazılamaz.
  const SUTUN_SINIFI = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" } as const;

  const puanVar = (tutor.rating_count ?? 0) > 0;

  return (
    <div>
      {/* ── Fotoğraf ── */}
      {/* `data-hero`: gerçek Chrome turunun (`scripts/anasayfa_mobil_turu.mjs`)
          "veri geldi mi" kanıtı. Sınıf adına dayanan bir seçici stil
          değişince sessizce boşa düşerdi. */}
      <div data-hero="egitmen" className="relative w-full overflow-hidden bg-slate-100">
        <div className="aspect-square w-full">
          {tutor.avatar_url ? (
            <img
              src={tutor.avatar_url}
              alt={tutor.display_name}
              className="h-full w-full object-cover"
            />
          ) : (
            /* Fotoğrafsız eğitmende hero YÜKSEKLİĞİ DEĞİŞMEZ (kullanıcı
               kararı): aynı kare alanda baş harfler. Yüzen düğmelerin yeri ve
               panelin başladığı çizgi her eğitmende aynı kalır. Harf ve renk
               `Avatar` ile ORTAK — aynı kişi iki ekranda iki farklı renkte
               görünmesin. */
            <div
              aria-hidden
              className={`flex h-full w-full select-none items-center justify-center text-7xl font-semibold ${colorFor(
                tutor.display_name
              )}`}
            >
              {initials(tutor.display_name)}
            </div>
          )}
        </div>

        {/* ── Yüzen eylemler ──
            `env(safe-area-inset-top)`: üst bar kalktığı için bu düğmeler artık
            telefonun çentik/durum çubuğu bandına en yakın öğeler. */}
        <div
          className="absolute inset-x-0 top-0 z-10 flex items-start justify-between px-3"
          style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
        >
          <PlainButton
            aria-label="Geri"
            title="Geri"
            onClick={onGeri}
            className={GORSEL_USTU_DAIRE}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-5 w-5"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </PlainButton>

          <div className="flex items-center gap-2">
            {onMesaj && (
              <PlainButton
                aria-label="Mesaj gönder"
                title="Mesaj gönder"
                onClick={onMesaj}
                className={GORSEL_USTU_DAIRE}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-5 w-5"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
                  />
                </svg>
              </PlainButton>
            )}
            <ShareButton gorselUstu />
            {!favoriGizli && <BookmarkButton tutorId={tutor.id} gorselUstu />}
          </div>
        </div>

        {/* "İlk ders ücretsiz" fotoğrafın üstüne taşındı: kartta bir dipnottu,
            burada ilanın ilk okunan vaadi. Panel fotoğrafın son 24px'ini
            örttüğü için hap ondan yukarıda durur. */}
        {ilkDersMetni && (
          <span className="absolute bottom-9 left-4 z-10 inline-flex items-center rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold text-emerald-700 shadow-sm backdrop-blur-sm">
            {ilkDersMetni}
          </span>
        )}
      </div>

      {/* ── Beyaz panel ──
          Bir KART DEĞİL (kullanıcı kararı, 10 Eyl): kutu, gölge ve halka yok.
          Panel sayfanın gövdesidir; fotoğrafın üstüne binmesi ikisini tek bir
          yüzey gibi okutur. */}
      <div className="relative -mt-6 rounded-t-3xl bg-white px-4 pt-5">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center justify-center gap-1.5">
            {/* Ad `p`: sayfanın H1'i ilan başlığıdır (Modül 6). */}
            <p className="text-2xl font-bold text-slate-900">{tutor.display_name}</p>
            {rozet}
          </div>

          <PlainButton
            onClick={onYorumlar}
            /* `min-h-[44px]`: gerçek Chrome turu bu satırı 183x28 ölçtü ve
               `dokunmaHedefi` kapısı kırmızı düştü. Görsel ağırlık artmasın
               diye büyüyen yalnız vuruş alanı. */
            className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 transition active:scale-95"
          >
            <StarRating value={tutor.rating_average} single={true} />
            <span className="text-sm font-medium text-marka-metin">
              {puanVar
                ? `${tutor.rating_average?.toFixed(1)} (${tutor.rating_count} değerlendirme)`
                : "Değerlendirme yok"}
            </span>
          </PlainButton>
        </div>

        {/* Aynı üç ölçü, masaüstündeki `TutorOzetTablosu` ile AYNI veri — yalnız
            yerleşim farklı: dar ekranda etiket/değer satırları dikey yer yiyor,
            üç sütun tek bakışta okunuyor. */}
        {sutunlar.length > 0 && (
          <dl
            className={`mt-4 grid ${
              SUTUN_SINIFI[sutunlar.length as 1 | 2 | 3]
            } divide-x divide-slate-200 rounded-2xl py-3 ring-1 ring-slate-200/70`}
          >
            {sutunlar.map((s) => (
              /* `dt` → `dd` DOM sırası HTML5 zorunluluğu; göze değer ÖNCE
                 görünsün diye sıra `flex-col-reverse` ile çevriliyor. */
              <div
                key={s.anahtar}
                className="flex flex-col-reverse items-center gap-0.5 px-2 text-center"
              >
                <dt className="text-xs leading-tight text-slate-500">{s.kisaEtiket}</dt>
                <dd className="text-base font-bold leading-tight text-slate-900">
                  {s.deger}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
