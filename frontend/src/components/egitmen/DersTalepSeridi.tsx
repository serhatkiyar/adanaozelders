import { Icon } from "@/components/AppIcon";
import { PlainButton } from "@/components/ui/PlainButton";

/* ────────────────────────────────────────────────────────────────────────────
   SABİT "DERS TALEP ET" ŞERİDİ (mobil detay ekranı)

   Kullanıcı kararı, 10 Eyl 2026: telefonda kart diye bir şey kalmıyor, o
   yüzden karttaki CTA da yok. Sayfanın tek eylemi bu şerit ve HER ZAMAN
   görünür.

   ## Neden `StickyBuyBar`ın IntersectionObserver'ı YOK

   Oradaki "asıl düğme görünürken şeridi gizle" kuralının sebebi ÇİFT CTA'ydı.
   Burada çift CTA yapısal olarak imkânsız: çağıran sayfa `useMobil()` ile ya
   bu şeridi ya masaüstü kartını mount ediyor, karttaki düğme telefonda DOM'da
   bile yok. Gözlemci eklemek, olmayan bir çakışmayı çözmek için CTA'yı
   sayfanın başında kaybettirmek olurdu.

   ## Neden `--alt-serit`e bağlanmıyor

   Alt sekme çubuğu bu rotada çizilmediği için değişkeni yayan `<style>` hiç
   basılmaz ve tüketiciler `var(--alt-serit, 0px)` ile 0 görür. Şerit
   `bottom-0`da durur; değişkene bağlansaydı çubuğun ileride geri gelmesi
   sessiz bir üst üste binme yaratırdı.

   ## Neden yer tutucu KENDİ İÇİNDE değil

   İlk sürümde `StickyBuyBar` gibi kendi `aria-hidden` boşluğunu çiziyordu ve
   ÖLÇÜLDÜ ki çalışmıyor (gerçek Chrome turu, 10 Eyl 2026: şerit sayfanın son
   içeriğini 73px örtüyordu). Sebep sıralama: bu bileşen `main`in içinde, oysa
   `SiteFooter` `main`den SONRA geliyor — boşluk footer'ın ÜSTÜNE ekleniyordu.
   `MobilAltSekmeler`in yer tutucusu çalışıyor çünkü o, kabuk seviyesinde
   footer'dan sonra çiziliyor.

   Çözüm `--alt-serit` ile aynı desen: yükseklik CSS'e YAYINLANIR, boşluğu
   kabuğun en dış kabı bırakır. Sayı yine tek yerde kalır.
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Şeridin kapladığı yükseklik — kabuğun bıraktığı boşluk ile GÖRÜNEN şerit
 * aynı sayıyı kullanır. Ayrışırlarsa sayfanın son içeriği ya şeridin altında
 * kalır ya da altta boşluk açılır.
 * Ölçüm kapısı: `scripts/anasayfa_mobil_turu.mjs` · `sabitSerit`.
 */
const SERIT_YUKSEKLIGI = 76;

export function DersTalepSeridi({
  etiket = "Ders talep et",
  onTalep,
}: {
  etiket?: string;
  onTalep: () => void;
}) {
  return (
    <>
      {/* Şeridin kapladığı yüksekliği CSS'e yayınla; boşluğu kabuk bırakır
          (odak örtülmesin — WCAG 2.4.11). Değişken YALNIZ şerit çizildiğinde
          tanımlanır; başka yüzeylerde kabuk `var(--sabit-serit, 0px)` ile
          0 görür. */}
      <style>{`:root { --sabit-serit: calc(${SERIT_YUKSEKLIGI}px + env(safe-area-inset-bottom)); }`}</style>
      <div
        data-serit="ders-talep"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 pt-3 shadow-[0_-2px_12px_rgba(15,23,42,0.08)]"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <PlainButton
          onClick={onTalep}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-marka px-5 text-sm font-bold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
        >
          {/* İkon hapın İÇİNDE: tek dokunma hedefi kalsın. Ayrı bir daire
              ikinci bir eylem gibi okunur ve ne yaptığı belirsizdir. */}
          <Icon name="commentLightning" className="h-5 w-5" />
          {etiket}
        </PlainButton>
      </div>
    </>
  );
}
