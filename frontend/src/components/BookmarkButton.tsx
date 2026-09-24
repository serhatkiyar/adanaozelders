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
        ? "h-[22px] w-[22px]"
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
    // Odak: tarayıcının kare varsayılan çerçevesi yerine proje halkası;
    // fotoğraf üstünde durduğu için beyaz ofsetle (koyu zeminde kaybolmaz).
    : "shrink-0 rounded-full p-2 outline-none transition active:scale-90 hover:scale-105 focus-visible:ring-2 focus-visible:ring-marka-focus focus-visible:ring-offset-2 disabled:opacity-50 md:p-0";

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
          d="m12 21.35-1.45-1.32C5.4 15.36 2 12.27 2 8.5 2 5.41 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.41 22 8.5c0 3.77-3.4 6.86-8.55 11.53L12 21.35Z"
        />
      </svg>
    </button>
  );
}
