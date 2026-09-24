import { Icon } from "@/components/AppIcon";

/**
 * Profil kartının sağ üst sütunundaki "Mesaj gönder" düğmesi — favori ve
 * paylaşın ÜSTÜNDE (kullanıcı kararı, 23 Eyl 2026: ders talep etmeden de
 * mesaj gönderilebilsin). Görünüm yanındaki favori/paylaş düğmelerinin `md`
 * hâliyle aynı: zeminsiz 36px daire, 20px ikon, üzerine gelince açık gri.
 *
 * İkon genel Mesajlar ikonuyla aynı (`messages`, Fluent Comment).
 *
 * Ne yapacağına sayfa karar verir: giriş yapmış öğrencide sohbete gider,
 * anonim ziyaretçide giriş kapısını açar.
 */
export function MesajDugmesi({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Mesaj gönder"
      title="Mesaj gönder"
      onClick={onClick}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-900 transition hover:bg-slate-100 active:scale-90"
    >
      <Icon name="messages" className="h-5 w-5" />
    </button>
  );
}
