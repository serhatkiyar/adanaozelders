import { useBookmarks, useToggleBookmark } from "@/hooks/useBookmarks";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useGirisKapisi } from "@/hooks/useGirisKapisi";
import { alisverisYapabilir } from "@/lib/roles";
import { GORSEL_USTU_DAIRE } from "@/components/egitmen/gorselUstuDaire";

interface BookmarkButtonProps {
  tutorId: number;
  size?: "sm" | "md" | "lg";
  /**
   * Düz (fotoğrafsız) bir zemin üzerinde mi duruyor? true iken tema-güvenli
   * nötr kalp; false (varsayılan) iken görsel üzerinde Airbnb tarzı
   * yarı-saydam dolgu + beyaz kenar + gölge.
   */
  onSolid?: boolean;
  /**
   * Fotoğrafın üstünde duran BEYAZ DAİRE varyantı (mobil detay ekranı hero'su).
   *
   * `onSolid=false` dalından farkı: orada kalp zeminsizdir ve okunurluğunu
   * kendi gölgesinden alır — kart kapağının üstünde doğru olan budur. Hero'da
   * ise düğme ekranın tek çıkış/eylem takımının parçası ve fotoğrafın rengi
   * ne olursa olsun aynı ağırlıkta görünmesi gerekiyor; daire zemini bunu
   * garanti eder. Daire tanımı `gorselUstuDaire.ts`te, paylaş düğmesiyle ORTAK.
   */
  gorselUstu?: boolean;
}

export function BookmarkButton({
  tutorId,
  size = "sm",
  onSolid = false,
  gorselUstu = false,
}: BookmarkButtonProps) {
  const { girisGerekli } = useGirisKapisi();
  const { data: user } = useCurrentUser();
  const { data: bookmarks } = useBookmarks();
  const toggle = useToggleBookmark();
  const bookmarked = !!bookmarks?.some((t) => t.id === tutorId);

  // Favorileyebilen roller: üye VE eğitmen (ÜK-6 · docs/urun-kararlari.md).
  // Eğitmenin isteği sunucuda gölge `Client`e çevrilir; admin/operatör/kurye
  // 403 alacağı için düğme onlara HÂLÂ gösterilmez.
  // Anonim ziyaretçiye gösterilir → tıklayınca giriş modalı açılır.
  if (user && !alisverisYapabilir(user.role_id)) return null;

  const icon = gorselUstu
    ? "h-5 w-5"
    : onSolid
    ? size === "md"
      ? "h-5 w-5"
      : "h-4 w-4"
    : size === "lg"
      ? "h-8 w-8"
      : size === "md"
        ? "h-7 w-7"
        : "h-6 w-6";

  // Düz zeminde (kart içinde) kap: `ShareButton`ın DAİRESİYLE AYNI ölçü ve
  // renk. Kullanıcı kararı, 7 Eyl 2026 — ikisi yan yana duruyordu ve
  // ayrışmışlardı: paylaş dairesel zeminliydi, kalp zeminsiz ve DOLU GRİYDİ,
  // yani "favorilenmiş ama pasif" gibi okunuyordu. Kalp artık favorilenmemişken
  // ÇİZGİ, favorilenince dolu.
  //
  // 8 Eyl 2026: daire ZEMİN kalktı. Kullanıcı kartı Superprof'unkiyle
  // karşılaştırıp "sembolleri kötü" dedi; gri dolu daireler ikincil iki eylem
  // için fazla ağırlık taşıyor, kartın sakin dilini bozuyordu. İkon artık tek
  // başına duruyor ve rengiyle konuşuyor: favorilenmemişken gri çizgi,
  // favorilenince dolu gül rengi.
  // `group`: hover DÜĞMEDE oluyor ama dolgu SVG'de değişmeli. `hover:` doğrudan
  // svg'ye yazılsaydı yalnız ikonun kendi üstüne gelince tetiklenir, düğmenin
  // boş kenarında sessiz kalırdı.
  const kap = gorselUstu
    ? `group ${GORSEL_USTU_DAIRE} ${bookmarked ? "text-rose-500" : "text-slate-900"}`
    : onSolid
    ? `group flex ${size === "md" ? "h-9 w-9" : "h-8 w-8"} shrink-0 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-50 ${
        bookmarked
          ? "text-rose-500 hover:bg-rose-50"
          : "text-slate-900 hover:bg-slate-100"
      }`
    // Telefonda `p-2`: ikon 28px, dokunma hedefi 44px olur (proje eşiği,
    // `scripts/sihirbaz_mobil_turu.mjs`). Görünüm değişmez — büyüyen yalnız
    // saydam vuruş alanı; çağıran kart konumunu `md:` ile telafi eder.
    : "shrink-0 p-2 transition active:scale-90 hover:scale-110 disabled:opacity-50 md:p-0";

  // Airbnb tarzı kalp: dolgu (pasif/aktif) + okunurluk için kenar/gölge.
  //
  // Pasif dolgu `black/40` (once /50 idi, /30'a inip /40'ta durdu) ve kenar 1,5px (eskiden 2px):
  // kullanıcı kararı — kalp fotoğrafın önünde bir leke gibi duruyordu.
  // Okunurluğu artık ağırlıklı olarak `drop-shadow` taşıyor; onu inceltmek
  // açık renkli fotoğraflarda kalbi kaybederdi, bu yüzden gölge DEĞİŞMEDİ.
  // Düz zeminde kalp SİYAH ÇİZGİdir; üstüne gelince içi kırmızı dolar ve çizgi
  // de kırmızıya döner (kullanıcı kararı, 8 Eyl). Önizleme niteliğinde: tıklayınca
  // ne olacağını basmadan gösteriyor.
  const fillCls = gorselUstu
    ? bookmarked
      ? "fill-current stroke-current"
      : "fill-none stroke-current group-hover:fill-rose-500 group-hover:stroke-rose-500"
    : onSolid
    ? bookmarked
      ? "fill-current stroke-current"
      : "fill-none stroke-current group-hover:fill-rose-500 group-hover:stroke-rose-500"
    : bookmarked
      ? "fill-rose-500 stroke-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
      : "fill-black/40 stroke-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]";

  return (
    <button
      type="button"
      aria-label={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      title={bookmarked ? "Favorilerden çıkar" : "Favorilere ekle"}
      aria-pressed={bookmarked}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Kapı niyeti saklar ve giriş penceresini MEVCUT ADRESE ekler:
        // filtreli listede kalp, filtreleri artık uçurmuyor.
        if (girisGerekli({ tip: "favori", hedef: "egitmen", id: tutorId })) return;
        toggle.mutate({ tutorId, bookmarked });
      }}
      disabled={toggle.isPending}
      className={kap}
    >
      <svg
        viewBox="0 0 24 24"
        strokeWidth={onSolid || gorselUstu ? 1.8 : 1.5}
        className={`${icon} transition-colors ${fillCls}`}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
        />
      </svg>
    </button>
  );
}
