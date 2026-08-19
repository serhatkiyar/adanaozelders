/**
 * Rota gezinmesinde kirli form uyarısı (İP-A6 · Görev 3).
 *
 * ## Ne çözüyor
 *
 * İP-A3a'nın kirli form bekçisi DÖRT kapatma yolunu kapsıyordu: × düğmesi,
 * ESC, dış tıklama ve tarayıcıyı kapatma/yenileme (`beforeunload`). BEŞİNCİ
 * yol açıktı ve panelde en sık kullanılanıydı: kullanıcı formu açık bırakıp
 * **kenar çubuğundan başka bir sayfaya gidiyor** ve yazdığı her şeyi uyarısız
 * kaybediyordu. Bu, `beforeunload`'ın hiç görmediği bir yoldur — sayfa
 * yeniden yüklenmez, React ağacı sökülür.
 *
 * ## Neden `useBlocker` değil
 *
 * `useBlocker`/`unstable_usePrompt` **data router** ister. Proje klasik
 * `<BrowserRouter>` + `<Routes>` kullanıyor (126 rota) ve bu mimaride hook
 * hata fırlatır (İP-A0 ölçümü, İP-A3a'da yeniden doğrulandı). Router göçü
 * ayrı ve ertelenmiş bir karardır; bu paket ona bağlanamazdı.
 *
 * ## Sözleşme
 *
 * İki uçlu, ve iki uç birbirini TANIMAZ:
 *
 * | Uç | Kim çağırır | Ne yapar |
 * |---|---|---|
 * | `useGezinmeKorumasi(korumali)` | `useKirliFormBekcisi` (yani her form) | "şu an kaybedilecek veri var" der |
 * | `GezinmeBaglantisi` | kenar çubuğu / ana gezinme | tıklamayı karşılar, gerekirse onay sorar |
 *
 * Ekranlar İKİSİNİ DE yazmaz: koruma kaydı `useKirliFormBekcisi`nin içinde
 * kurulur ve `DuzenlemeYuzeyi` onu zaten çağırır. Bir ekranın kirli formunu
 * rota gezinmesine karşı korumak için yazılması gereken kod **sıfır satırdır**.
 *
 * ## Neden bağlam (context) değil, modül düzeyi kayıt
 *
 * Kayıt bir React bağlamında tutulsaydı her form kirlendiğinde/temizlendiğinde
 * sağlayıcının ALTINDAKİ HER ŞEY (kenar çubuğu + aktif ekran + tablo) yeniden
 * render edilirdi — her tuş vuruşunda. Gezinme bileşenlerinin bu bilgiye
 * render sırasında ihtiyacı YOK; yalnız TIKLAMA ANINDA okurlar. Bu yüzden
 * kayıt modül düzeyinde bir kümedir ve hiçbir abonelik üretmez.
 *
 * Yan kazanç: sağlayıcı yok, yani `App.tsx` değişmedi ve testlerde sarmalayıcı
 * gerekmiyor.
 *
 * ## Router göçüne hazırlık
 *
 * Rota tabanlı yüzeylere/data router'a geçilirse **bu dosyanın içi** değişir:
 * `GezinmeBaglantisi` sıradan bir `NavLink`e iner ve karar `useBlocker`a
 * devredilir. Ekranlar ve `useKirliFormBekcisi` sözleşmesi aynı kalır.
 *
 * ## Bilinen sınırlar (kapsam dışı, sessiz kalmasın)
 *
 * 1. **Tarayıcının geri/ileri tuşu bu mimaride KAPATILAMAZ.** `popstate` olay
 *    olarak ancak gezinme GERÇEKLEŞTİKTEN sonra ateşlenir; iptal etmenin tek
 *    yolu `history.pushState` ile geri itmektir ve bu, tarayıcı geçmişini
 *    kullanıcının altında bozar. Data router'a geçilmeden bu yol kapanmaz.
 * 2. **Kapsam kenar çubuğu ve ana gezinmedir.** İçerik alanındaki bir
 *    `<Link>` (ör. tablo satırından detaya gitmek) bu bileşenden geçmez.
 *    Bilinçli: göç ilerledikçe kapsam genişletilir, ama her `Link`i bugün
 *    sarmak dokunulmaması gereken 21 ekranı değiştirmek demekti.
 * 3. **Programatik `navigate()` çağrıları** (başarı sonrası yönlendirme)
 *    geçmez — geçmemeli de: orada veri zaten kaydedilmiştir.
 */
import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { NavLink, useNavigate, type NavLinkProps, type To } from "react-router-dom";

import { ConfirmDialog } from "@/components/admin/ui";

import { GEZINME_ONAYI } from "./medusa-tr";
import { useDuzenlemeYuzeyi } from "./yuzeyDurumu";

/**
 * Şu an "kaybedilecek verisi olan" yüzeyler.
 *
 * Anahtar `symbol`dür: iki ayrı formun aynı adı taşıması ya da aynı formun iki
 * kez mount edilmesi (React 18 StrictMode) kaydı çakıştıramaz.
 */
const korumaliYuzeyler = new Set<symbol>();

/** Kaydedilmemiş veri taşıyan bir form açık mı? */
export function kirliFormVarMi(): boolean {
  return korumaliYuzeyler.size > 0;
}

/**
 * Testler için: kaydı sıfırlar.
 *
 * Üretim kodunda ÇAĞRILMAZ — modül düzeyi durum testler arasında sızar ve
 * bir testin bıraktığı kayıt sonrakini yanlış-kırmızı yapar (kök CLAUDE.md
 * §G: bir testin ürettiği veri başka teste kalmaz).
 */
export function gezinmeKaydiniSifirla(): void {
  korumaliYuzeyler.clear();
}

/**
 * Bu bileşenin formunda kaydedilmemiş veri olduğunu ilan eder.
 *
 * `korumali` false olduğunda ya da bileşen söküldüğünde kayıt kalkar; sökülme
 * temizliği ŞART: yoksa kapanan her pencere kalıcı bir "kirli" izi bırakır ve
 * uyarı anlamını yitirir (kullanıcı refleksle onaylamayı öğrenir).
 */
export function useGezinmeKorumasi(korumali: boolean): void {
  const kimlikRef = useRef<symbol>();
  if (!kimlikRef.current) kimlikRef.current = Symbol("kirli-yuzey");

  useEffect(() => {
    const kimlik = kimlikRef.current!;
    if (!korumali) {
      korumaliYuzeyler.delete(kimlik);
      return;
    }
    korumaliYuzeyler.add(kimlik);
    return () => {
      korumaliYuzeyler.delete(kimlik);
    };
  }, [korumali]);
}

/**
 * Gezinme isteğini karşılar: temizse doğrudan sürdürür, kirliyse onay sorar.
 *
 * ## Neden Medusa'nın `usePrompt`u DEĞİL
 *
 * İlk yazımı `usePrompt` kullanıyordu ve ölçüldü: `AdminSidebar` bu modülü
 * statik import ettiği için Medusa'nın `AlertDialog`u (Radix dahil, **72 kB /
 * 23 kB gzip**) HER yönetim sayfasının ilk yüküne giriyordu — oysa pencere
 * yalnız kirli formda, tıklama anında gerekiyor. Panelin kendi
 * `ConfirmDialog`u zaten aynı işi yapıyor, aynı görsel dili taşıyor ve
 * `admin/ui` paketinin içinde.
 *
 * Onaylanınca kayıt ELLE TEMİZLENMEZ: gezinme formu söker ve
 * `useGezinmeKorumasi`nin temizliği kaydı kaldırır. Elle temizlemek,
 * gezinmenin bir sebeple gerçekleşmediği durumda korumayı sessizce
 * düşürürdü.
 */
export function useGezinmeOnayi(): {
  /** Gezinmeyi dener; gerekirse onay penceresini açar. */
  dene: (devam: () => void) => void;
  /** Pencerenin kendisi — çağıran taraf render eder. */
  pencere: ReactNode;
} {
  // Pencere durumu `useState` ile DEĞİL, ortak yüzey kancasıyla tutulur:
  // göçün ekranlara dayattığı kuralın bu katmandaki karşılığı budur.
  const yuzey = useDuzenlemeYuzeyi<() => void>();

  const dene = useCallback(
    (devam: () => void) => {
      if (!kirliFormVarMi()) {
        devam();
        return;
      }
      yuzey.ac(devam);
    },
    [yuzey]
  );

  const devamEt = yuzey.kayit;
  const pencere = (
    <ConfirmDialog
      open={yuzey.acik}
      title={GEZINME_ONAYI.baslik}
      description={GEZINME_ONAYI.aciklama}
      confirmLabel={GEZINME_ONAYI.onay}
      danger
      onClose={yuzey.kapat}
      onConfirm={() => {
        yuzey.kapat();
        devamEt?.();
      }}
    />
  );

  return { dene, pencere };
}

/**
 * Tarayıcının kendi davranışına bırakılması gereken tıklamalar.
 *
 * Yeni sekmede/pencerede açılan bağlantı MEVCUT sayfayı söküp veri
 * kaybettirmez — orada onay sormak gereksiz sürtünmedir ve kullanıcıya
 * uyarıyı önemsememeyi öğretir.
 */
function tarayiciyaBirak(olay: MouseEvent<HTMLAnchorElement>, target?: string): boolean {
  return (
    olay.defaultPrevented ||
    olay.button !== 0 ||
    olay.metaKey ||
    olay.ctrlKey ||
    olay.shiftKey ||
    olay.altKey ||
    (!!target && target !== "_self")
  );
}

export interface GezinmeBaglantisiProps extends Omit<NavLinkProps, "children"> {
  to: To;
  children?: ReactNode | NavLinkProps["children"];
}

/**
 * `NavLink` yerine geçen gezinme bağlantısı — kirli form varken onay sorar.
 *
 * `NavLink`in bütün sözleşmesi (fonksiyonel `className`/`children`, `end`,
 * `aria-current`) korunur; eklenen tek şey tıklama kapısıdır.
 */
export function GezinmeBaglantisi({ to, onClick, ...kalan }: GezinmeBaglantisiProps) {
  const { dene, pencere } = useGezinmeOnayi();
  const navigate = useNavigate();

  return (
    <>
      <NavLink
        {...(kalan as NavLinkProps)}
        to={to}
        onClick={(olay) => {
          if (tarayiciyaBirak(olay, kalan.target)) {
            onClick?.(olay);
            return;
          }
          if (!kirliFormVarMi()) {
            onClick?.(olay);
            return;
          }
          // Gezinmeyi DURDUR: karar onay penceresinden sonra verilir.
          olay.preventDefault();
          dene(() => {
            onClick?.(olay);
            navigate(to);
          });
        }}
      />
      {/* Kapalıyken `Dialog` `null` döner: kenar çubuğundaki on beş bağlantı
          on beş boş bileşen demek, DOM'a hiçbir şey basmıyorlar. */}
      {pencere}
    </>
  );
}
