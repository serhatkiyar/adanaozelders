import { useEffect, useState } from "react";
import { Icon } from "@/components/AppIcon";
import { useNavigate, useParams } from "react-router-dom";
import { DashboardShell } from "@/components/DashboardShell";
import { UYE_NAV, TUTOR_NAV } from "@/lib/nav";
import { Avatar } from "@/components/Avatar";
import { StarRating } from "@/components/StarRating";
import { DersPuani, ReviewsSection } from "@/components/ReviewsSection";
import { kriterOrtalamalari, reviewOutToItem } from "@/lib/reviewStats";
import { BookmarkButton } from "@/components/BookmarkButton";
import { MesajDugmesi } from "@/components/egitmen/MesajDugmesi";
import { ShareButton } from "@/components/ShareButton";
import {
  DocumentedBadge,
  TutorOzetTablosu,
  hasVerifiedEducation,
} from "@/components/TutorTrust";
import { ReportModal } from "@/components/ReportModal";
import { FullScreenSpinner } from "@/components/Spinner";
import { ReviewListModal } from "@/components/ReviewListModal";
import { useTutorDetail } from "@/hooks/useTutorSearch";
import {
  useReviewsByTutor,
  useTutorRatingDistribution,
} from "@/hooks/useReviews";
import { useBookings } from "@/hooks/useBookings";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatRateSymbol, parseMoney } from "@/lib/money";
import { BookingStatus, ROLE_IDS, TeachingMode } from "@/types";
import type { TutorSearchOut } from "@/types";
import { BookingModal } from "@/components/BookingModal";
import { ROUTES, parseTutorId } from "@/lib/routes";
import type { IlanSayfasiVerisi } from "@/api/seo";
import { Seo } from "@/components/Seo";
import { JsonLd } from "@/components/JsonLd";
import { useCanonicalTutorSlug } from "@/hooks/useCanonicalTutorSlug";
import { recordViewedTutor } from "@/lib/recentlyViewed";
import { TanitimVideosu, tanitimVideosuVar } from "@/components/egitmen/TanitimVideosu";
import { useNavSearch } from "@/hooks/useNavSearch";
import { useBekleyenNiyet } from "@/hooks/useBekleyenNiyet";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { useGeriDonus } from "@/hooks/useGeriDonus";
import { EgitmenMobilUst } from "@/components/egitmen/EgitmenMobilUst";
import { DersTalepSeridi } from "@/components/egitmen/DersTalepSeridi";

// Removed constants

/* ─── main page ─────────────────────────────────────────── */

export default function TutorProfile({
  tutorId: verilenId,
  ilanSeo,
}: {
  /** Kök ilan adresinden gelindiyse sunucunun çözdüğü eğitmen. */
  tutorId?: number;
  /** Sunucunun ürettiği başlık/açıklama/JSON-LD (ön-çizimle AYNI). */
  ilanSeo?: IlanSayfasiVerisi;
} = {}) {
  const { slug } = useParams();
  const tutorId = verilenId ?? parseTutorId(slug);
  const navigate = useNavigate();
  const { center, bottom, open: searchOpen, setOpen: setSearchOpen } =
    useNavSearch("egitmenler");

  const { data: currentUser } = useCurrentUser();
  const navItems =
    currentUser?.role_id === ROLE_IDS.TUTOR
      ? TUTOR_NAV
      : currentUser?.role_id === ROLE_IDS.CLIENT
        ? UYE_NAV
        : undefined;

  const { data: tutor, isLoading, isError } = useTutorDetail(tutorId);
  useCanonicalTutorSlug(tutor);
  // "Son görüntülenen ilanlar" için bu eğitmeni kaydet.
  useEffect(() => {
    if (tutor) recordViewedTutor(tutor);
  }, [tutor]);
  const { data: reviews } = useReviewsByTutor(tutorId);
  const { data: ratingDist } = useTutorRatingDistribution(tutorId);
  const { data: myBookings } = useBookings({ limit: 100 });

  const [showBookingModal, setShowBookingModal] = useState(false);

  /* Anonim kabukla AYNI karar — bkz. `PublicTutorProfile`. Rotanın iki kabuğu
     ayrışmasın diye mobil düzen ortak bileşende. */
  const mobil = useMobil();
  const geriDon = useGeriDonus(ROUTES.tutors);
  const isOwnerTutor =
    currentUser?.role_id === ROLE_IDS.TUTOR && currentUser.id === tutorId;
  // Modül 5: giriş yapmış öğrenci ders ayırtmadan da yazabilir; ders öncesi
  // sohbetin sınırları ve korumaları sunucuda uygulanır.
  const mesajGonderebilir =
    !isOwnerTutor && currentUser?.role_id === ROLE_IDS.CLIENT;
  /*
   * Anonimken "Ders Talep Et"e basan ziyaretçi giriş yapınca pencere
   * KENDİLİĞİNDEN açılır (ÜK-10). `TutorProfilePage` token'a göre bu bileşenle
   * `PublicTutorProfile` arasında takas yaptığı için burası girişten hemen
   * sonra sıfırdan mount olur.
   *
   * `esler` şart: kullanıcı 42 numaralı eğitmende kapıyı açıp başka sekmeden
   * 99'a geçtiyse, 99'un sayfası niyeti ne uygular ne de YER.
   */
  useBekleyenNiyet({
    tip: "dersTalebi",
    hazir: !!tutor && !isOwnerTutor,
    esler: (n) => n.egitmenId === tutorId,
    uygula: () => setShowBookingModal(true),
  });

  const [showReport, setShowReport] = useState(false);
  const [showReviews, setShowReviews] = useState(false);

  if (isLoading) return <FullScreenSpinner />;

  if (isError || !tutor) {
    return (
      <DashboardShell title="Öğretmen" navItems={navItems} sekmeler={null}>
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-marka-metin hover:text-marka-metin-hover"
          >
            ← Geri dön
          </button>
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 py-16 text-center ">
            <p className="text-sm text-slate-500">Öğretmen bulunamadı.</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const rate = parseMoney(tutor.hourly_rate);
  // Ücretsiz ilk ders: eğitmen sunuyor + öğrencinin bu eğitmenle (iptal/red dışı) dersi yok.
  const hadLessonWithTutor = (myBookings ?? []).some(
    (b) =>
      b.tutor_id === tutorId &&
      b.status !== BookingStatus.CANCELLED &&
      b.status !== BookingStatus.REJECTED
  );
  const canRequestFreeLesson =
    tutor.first_lesson_free !== false && !isOwnerTutor && !hadLessonWithTutor;
  const videoVar = tanitimVideosuVar(tutor.intro_video, tutor.intro_video_url);
  const modeLabel = tutor.teaching_mode === TeachingMode.ONLINE
    ? "Uzaktan" 
    : tutor.teaching_mode === TeachingMode.IN_PERSON 
    ? "Yüzyüze" 
    : tutor.teaching_mode === TeachingMode.BOTH 
    ? "Uzaktan & Yüzyüze"
    : null;

  return (
    <DashboardShell
      title="Öğretmen Detayı"
      navItems={navItems}
      sekmeler={null}
      center={center}
      bottom={bottom}
      mobilDetayEkrani
    >
      {ilanSeo && (
        <Seo
          title={ilanSeo.baslik}
          tamBaslik
          description={ilanSeo.aciklama}
          canonicalPath={ilanSeo.yol}
          type="profile"
          image={tutor.avatar_url ?? undefined}
        >
          <JsonLd data={ilanSeo.json_ld} />
        </Seo>
      )}
      {/* Geniş arama açıkken sayfayı hafifçe karart; tıklayınca kapat. */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 animate-in fade-in duration-200"
          onClick={() => setSearchOpen(false)}
        />
      )}
      {/* Konteyner DAR (64rem, site standardı 76rem'in altında — kullanıcı
          kararı, 21 Eyl 2026): tanıtım videosu üste alınınca sayfa geniş/boş
          hissettirdi, daraltılınca (sağdaki sabit kart dahil TÜM bölme)
          beğenildi — bilinçli, sayfaya özel bir sapma. */}
      <div className="mx-auto max-w-[64rem] pb-12">
        {/* "← Geri dön" KALDIRILDI (kullanıcı kararı, 7 Eyl 2026): tarayıcının
            kendi geri düğmesi zaten var ve bağlantı, kartı bir satır aşağı
            itiyordu. Hata dalındaki kopyası KALIR — orada sayfanın tek
            çıkışı odur. */}
        <div
          className={
            mobil
              ? "flex flex-col"
              : "flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6"
          }
        >
          {mobil && (
            <EgitmenMobilUst
              tutor={tutor}
              ucret={rate !== null ? formatRateSymbol(tutor.hourly_rate) : null}
              rozet={hasVerifiedEducation(tutor.educations) ? <DocumentedBadge /> : undefined}
              favoriGizli={isOwnerTutor}
              ilkDersMetni={
                tutor.first_lesson_free !== false
                  ? canRequestFreeLesson
                    ? "İlk dersin ücretsiz"
                    : "İlk ders ücretsiz"
                  : null
              }
              onGeri={geriDon}
              onYorumlar={() => setShowReviews(true)}
              onMesaj={
                mesajGonderebilir
                  ? () => navigate(ROUTES.messageWith(tutor.id, tutor.display_name))
                  : undefined
              }
            />
          )}
          {/* ── Sağ: öğretmen bilgi + rezervasyon kartı (dikey, sticky) ── */}
          {/* Kart ekrandan TAŞMASIN (kullanıcı kararı, 7 Eyl 2026): sticky kart
              viewport'tan uzunsa alt kısmı (fiyat + birincil düğme) görünmüyor
              ve sabitlendiği için sayfa kaydırılsa bile gelmiyordu. Artık
              yüksekliği ekranla sınırlı ve gerekirse KENDİ İÇİNDE kayar. */}
          {!mobil && (
          <aside className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-[calc(var(--yapiskan-ust,6rem)+1.5rem)]">
            <section className="relative rounded-2xl bg-white p-5 shadow-lg shadow-slate-300/40 ring-1 ring-slate-200/60 lg:max-h-[calc(100vh-var(--yapiskan-ust,6rem)-3rem)] lg:overflow-y-auto lg:overscroll-contain">
              {/* Favori + paylaş + mesaj: sağ üst köşede DİKEY sütun
                  (PublicTutorProfile'la AYNI desen — kullanıcı kararı,
                  21 Eyl 2026: bu kabuk yatay bir satıra SAPMIŞTI, anonim
                  kabuk zaten dikeydi. `absolute` bilinçli: normal akışta
                  kalsalardı fotoğrafı aşağı iter, kartı uzatırdı. */}
              {/* Mesaj gönder GERİ GELDİ, sütunun en üstünde (kullanıcı kararı,
                  23 Eyl 2026 — 21 Eyl'de kalabalık diye kaldırılmıştı): ders
                  talep etmeden de yazılabilsin. Görünürlük mobil üst barla
                  (`EgitmenMobilUst`) aynı kural: `mesajGonderebilir`. */}
              <div className="absolute right-4 top-4 z-10 flex flex-col items-center gap-3">
                {mesajGonderebilir && (
                  <MesajDugmesi
                    onClick={() => navigate(ROUTES.messageWith(tutor.id, tutor.display_name))}
                  />
                )}
                {!isOwnerTutor && (
                  <BookmarkButton tutorId={tutor.id} size="md" onSolid />
                )}
                <ShareButton size="md" />
              </div>

              <div className="flex flex-col items-center text-center">
                {/* Fotoğraf 64px'ten 128px'e çıktı (kullanıcı kararı, 21 Eyl
                    2026 — PublicTutorProfile'la aynı `xl` boyuta hizalandı). */}
                <Avatar
                  name={tutor.display_name}
                  avatar_url={tutor.avatar_url}
                  size="xl"
                  shape="square"
                />
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  {/* Ad `p`: H1 ilan başlığıdır (Modül 6). Görünüm aynı. */}
                  <p className="text-2xl font-bold text-slate-900 ">
                    {tutor.display_name}
                  </p>
                </div>

                {/* Bilerek ARTIK BUTON DEĞİL (kullanıcı kararı, 21 Eyl 2026):
                    yıldız+puan tüm satırı tıklanabilir/hover'lı göstermek
                    yanıltıcıydı — tek gerçek eylem yorumlara gitmek, o da
                    yalnız "(N yorum)" metninde. */}
                <div className="mt-2 inline-flex items-center gap-1.5">
                  {tutor.rating_count > 0 && (
                    <StarRating value={tutor.rating_average} single={true} />
                  )}
                  {/* Puan SAYISI kalın/siyah, yorum adedi küçük/gri (kullanıcı
                      kararı, 21 Eyl 2026): tek span'da eşit ağırlıktaydı. */}
                  {tutor.rating_count > 0 ? (
                    <>
                      <span className="text-sm font-bold text-slate-900 ">
                        {tutor.rating_average?.toFixed(1)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowReviews(true)}
                        className="text-sm font-medium text-slate-600 underline hover:text-slate-700 hover:no-underline "
                      >
                        ({tutor.rating_count} yorum)
                      </button>
                    </>
                  ) : (
                    // Preply deseni: yorum yoksa açılacak liste de yok —
                    // tıklanmayan "Yeni öğretmen" etiketi.
                    <span className="text-sm text-slate-600">
                      <span className="font-bold text-slate-900">Yeni</span>{" "}
                      öğretmen
                    </span>
                  )}
                </div>

                {/* Ders mekânı buradan KALKTI, sol sütundaki "Ders Mekânı"
                    başlığına taşındı. Anonim kabukla (PublicTutorProfile) aynı
                    değişiklik: rotanın iki kabuğu ayrışmasın — bu ayrışma daha
                    önce ölçülmüş bir kusurdu (bkz. __guards__/ilanKartiTasmaz). */}
              </div>

              {/* Ücret + güven sinyalleri TEK TABLODA (Superprof deseni).
                  Eskiden ikisi ayrı bloktu ve kart 632 piksele çıkıyordu;
                  1366x768'de bile taşıyordu. Ayrıntı: `TutorOzetTablosu`. */}
              <TutorOzetTablosu
                tutor={tutor}
                ucret={rate !== null ? formatRateSymbol(tutor.hourly_rate) : null}
              />
              {!isOwnerTutor && (
                <button
                  onClick={() => setShowBookingModal(true)}
                  className="mx-auto mt-4 flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-marka px-10 text-center text-base font-bold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
                >
                  {/* Mobil şeritle (DersTalepSeridi) AYNI ikon: aynı eylem. Düğme tam
                    genişlik değil; 48px yükseklik, 16px yazı, ortalı (kullanıcı kararı,
                    23 Eyl 2026). */}
                  <Icon name="commentLightning" className="h-5 w-5" />
                  Ders Talep Et
                </button>
              )}
              {tutor.first_lesson_free !== false && (
                <p className="mt-2 text-center text-sm font-semibold text-emerald-600 ">
                  {canRequestFreeLesson ? "İlk dersin ücretsiz" : "İlk ders ücretsiz"}
                </p>
              )}
            </section>

            {/* Şikayet (kartın dışında, altında; ikincil) */}
            {currentUser && !isOwnerTutor && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setShowReport(true)}
                  className="text-xs font-medium text-slate-400 transition hover:text-rose-600 "
                >
                  ⚐ Şikayet et
                </button>
              </div>
            )}
            {showReport && (
              <ReportModal
                targetType="TUTOR"
                targetId={tutorId}
                targetLabel={tutor.display_name}
                onClose={() => setShowReport(false)}
              />
            )}
          </aside>
          )}

          {/* ── Sol: akan içerik (kartsız, alt alta) ── */}
          <div
            className={
              mobil
                ? "space-y-8 bg-white px-4 pb-8 pt-6"
                : "space-y-8 lg:col-start-1 lg:row-start-1"
            }
          >
            {/* Tanıtım videosu — Preply karşılaştırması (21 Eyl 2026, sonra
                kullanıcı kararıyla EN ÜSTE alındı — etiket/başlıktan bile
                önce). Kendi max-w'si YOK: konteynerin kendisi (max-w-[64rem])
                zaten dar, video sütunu tam doldurur. Otomatik+sessiz oynar
                (bkz. `videoEmbedUrl`). */}
            {videoVar && (
              <section>
                <TanitimVideosu
                  video={tutor.intro_video}
                  linkUrl={tutor.intro_video_url}
                  ad={tutor.display_name}
                />
              </section>
            )}

            {/* Verdiği Dersler — ilan başlığının üstünde */}
            {tutor.subjects && tutor.subjects.length > 0 && (
              <section>
                <div className="flex flex-wrap gap-2">
                  {tutor.subjects.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-marka-soft px-3 py-1 text-sm font-medium text-marka-metin-hover "
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Headline / İlan Başlığı */}
            {(tutor.headline || isOwnerTutor) && (
              <h1 className="text-3xl font-extrabold leading-tight text-slate-900 ">
                {tutor.headline || "Öğretmen"}
              </h1>
            )}

            {/* Bio */}
            {tutor.bio && (
              <section className="border-t border-slate-200 pt-6 ">
                <h2 className="mb-2 text-xl font-bold text-slate-900 ">
                  {tutor.display_name} ile ilgili bilgiler
                </h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-600 ">
                  {tutor.bio}
                </p>
              </section>
            )}

            {/* Ders Mekânı — kartta rozet olarak duruyordu, buraya taşındı */}
            {modeLabel && (
              <section className="border-t border-slate-200 pt-6 ">
                <h2 className="mb-2 text-xl font-bold text-slate-900 ">
                  Ders Mekânı
                </h2>
                <p className="text-[15px] leading-relaxed text-slate-600 ">
                  {modeLabel}
                </p>
              </section>
            )}

            {/* Ders Hakkında — metodoloji */}
            {tutor.lesson_info && (
              <section className="border-t border-slate-200 pt-6 ">
                <h2 className="mb-2 text-xl font-bold text-slate-900 ">
                  Ders Hakkında
                </h2>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-600 ">
                  {tutor.lesson_info}
                </p>
              </section>
            )}

            {/* Ders puanı (alt kriter kutucukları) + değerlendirmeler — Preply
                öğretmen profili düzeni. Dağılım çubukları "tümünü göster"
                penceresinde (ReviewListModal). */}
            {tutor.rating_count > 0 && kriterOrtalamalari(ratingDist).length > 0 && (
              <>
                <hr className="my-8 border-slate-200 " />
                <DersPuani kriterler={kriterOrtalamalari(ratingDist)} />
              </>
            )}
            <hr className="my-8 border-slate-200 " />
            <section>
              <ReviewsSection
                baslikGoster
                average={tutor.rating_average}
                count={tutor.rating_count}
                title="Öğrencilerim hakkımda ne diyor?"
                bosMetin={`${tutor.display_name} için değerlendirme yok`}
                reviews={(reviews ?? []).map(reviewOutToItem)}
                onShowAll={() => setShowReviews(true)}
              />
            </section>
          </div>
        </div>
      </div>

      {/* Telefonda sayfanın TEK eylemi. Öğretmen KENDİ profiline bakıyorsa
          şerit hiç basılmaz — karttaki düğmenin `!isOwnerTutor` kapısı burada
          da geçerli. */}
      {mobil && !isOwnerTutor && (
        <DersTalepSeridi onTalep={() => setShowBookingModal(true)} />
      )}

      {showBookingModal && tutor && (
        <BookingModal
          tutor={tutor as TutorSearchOut}
          onClose={() => setShowBookingModal(false)}
          canRequestFreeLesson={canRequestFreeLesson}
        />
      )}

      {showReviews && tutor && (
        <ReviewListModal
          tutorId={tutor.id}
          tutorName={tutor.display_name}
          onClose={() => setShowReviews(false)}
        />
      )}
    </DashboardShell>
  );
}

