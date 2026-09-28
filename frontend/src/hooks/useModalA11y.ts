import { useEffect, useRef, type RefObject } from "react";

/**
 * Modal erişilebilirliğinin üç zorunlu parçası: odak tuzağı, Esc ile kapanma
 * ve odağın geri verilmesi.
 *
 * NEDEN: bu kod tabanında 18 tüketici modalı vardı ve HİÇBİRİNDE odak tuzağı
 * yoktu. Klavyeyle gezen bir kullanıcı modal açıkken Tab'a bastığında odak
 * modalın arkasındaki sayfaya kaçıyor, ekran okuyucu kullanıcısı "nerede
 * olduğunu" kaybediyordu. Doğru uygulama admin panelin `Dialog` bileşeninde
 * zaten vardı; burası onun paylaşılan hâlidir (admin Dialog da bunu kullanır).
 *
 * Ayrıca arkadaki sayfanın kaydırılması kilitlenir: mobilde modal açıkken
 * arka planın kayması, kullanıcının modalı kaybetmesine yol açar.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * ── AÇIK PENCERE YIĞINI (İP-A8 · Görev 4 · B-3) ──
 *
 * Her açık pencere `document`e KENDİ `keydown` dinleyicisini ekliyordu ve
 * aralarında sıra yoktu: iki pencere açıkken **tek ESC ikisinin de**
 * `onClose`unu çağırıyordu.
 *
 * Bu, envanterde "iç içe ESC yığını yok" başlığıyla ve **erişilebilirlik
 * konforu** olarak kayıtlıydı. Bağımsız denetim #3 sınıflandırmanın yanlış
 * olduğunu davranışla ölçtü (B-3): `AdminLibraries` → oturum yönetimi →
 * "+ Oturum" (iç pencere, kirli form bekçisi KAYITLI) → başlığa yaz → tek ESC:
 *
 *     ic pencere acildiktan sonra dialog sayisi: 2
 *     ESC sonrasi dialog sayisi: 0
 *     onay metni: false
 *
 * Yani dıştaki pencere (bekçi defteri boş) ANINDA kapanıyor ve içteki
 * KORUMALI formun onay istemi daha görünmeden ağaçtan sökülüyordu. Bu bir
 * konfor eksiği değil, göçün kapatmak için kurulduğu **sessiz veri kaybının**
 * ta kendisidir.
 *
 * Çözüm bir modal yığınıdır ve sözleşme `ui2/` katmanında değil BURADA kurulur
 * — çünkü ESC'i dinleyen katman burasıdır ve panelin dışındaki tüketici
 * modalları da (harita, kırpma, paylaş) aynı kancayı kullanır. Ekran başına
 * çözülseydi her yeni iç içe yüzeyde yeniden unutulabilirdi.
 *
 * Kural: **klavye olayını yalnız yığının EN ÜSTÜNDEKİ pencere işler.** ESC en
 * içteki pencereyi kapatır; kapanan pencere korumalıysa onayı o pencerenin
 * kendi `onClose`u (bekçi) sorar. Dıştaki pencereye dokunulmaz.
 *
 * Tab tuzağı da aynı kurala tabidir: iki panel birden odak döngüsü kurmaya
 * çalışırsa odak, üstteki pencereden alttakine kaçabilirdi.
 *
 * Yığın modül düzeyindedir çünkü paylaşılan tek gerçek "hangi pencere en
 * üstte" sorusudur; React bağlamı bunu veremez (pencereler kardeş ağaçlarda,
 * `createPortal` ile gövdeye çıkıyorlar).
 */
const MODAL_YIGINI: symbol[] = [];

/**
 * Şu an açık bir pencere var mı? Pencerenin ARKASINDAKİ sayfaya ait genel
 * klavye kısayolları (panelin Ctrl+K ve `G` + harf dizisi) bunu sorar: açık
 * bir pencerenin üstünde gezinmek, içindeki formu uyarısız söker.
 */
export function acikModalVarMi(): boolean {
  return MODAL_YIGINI.length > 0;
}

/**
 * ── KAYDIRMA KİLİDİ SAYACI (TB-71) ──
 *
 * Yukarıdaki yığın İP-A8'de yalnız KLAVYE için kuruldu; kaydırma kilidi ona
 * hiç bağlanmadı ve her pencere `document.body.style.overflow`u tek başına
 * yönetmeye devam etti: açılışta "önceki" değeri saklar, kapanışta geri yazar.
 *
 * İki pencere aynı anda açıkken ikincinin sakladığı "önceki" değer
 * BİRİNCİNİN yazdığı `hidden`dır. Kapanma sırası LIFO değilse son temizleyici
 * `hidden`i geri yazar ve arka plan sayfa yenilenene dek kilitli kalır.
 *
 * Bu teorik bir uç değildi: `<AuthModal />` hem `App.tsx`te (global) hem
 * `StoreLayout`/`PublicShell` içinde monte ediliyordu, ikisi de aynı URL
 * parametresini (`?modal=login`) okuyup birlikte açılıyordu. Gerçek Chrome'da
 * ölçüldü (`/magaza`, oturum kapalı): pencere kapandıktan sonra
 * `body.style.overflow="hidden"`, kaydırma çubuğu 15px → 0px iken
 * `scrollHeight(2110) > innerHeight(788)`; 3/3 tur.
 *
 * Çift monte kaldırıldı (asıl düzeltme), ama kilit ayrıca SAYACA bağlanır:
 * iç içe pencere bu kod tabanında meşru bir durumdur (`MODAL_YIGINI`in
 * varlık sebebi) ve tek bir yanlış montaj kullanıcıyı yine kilitli sayfada
 * bırakırdı. Kural Radix'in `react-remove-scroll` deseniyle aynıdır:
 * **ilk giren kilitler, SON çıkan açar** — ve açılan değer sayfanın kendi
 * değeridir, boş dize değil.
 *
 * Yığın ayrı tutulur çünkü `lockScroll: false` pencereler klavye yığınında
 * vardır ama kilide katılmazlar.
 */
const KILIT_YIGINI: symbol[] = [];
let kilitOncesiOverflow: string | null = null;

function kaydirmaKilidiAl(kimlik: symbol): void {
  if (KILIT_YIGINI.length === 0) {
    kilitOncesiOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  KILIT_YIGINI.push(kimlik);
}

function kaydirmaKilidiBirak(kimlik: symbol): void {
  const sira = KILIT_YIGINI.lastIndexOf(kimlik);
  if (sira < 0) return;
  KILIT_YIGINI.splice(sira, 1);
  if (KILIT_YIGINI.length > 0) return;
  document.body.style.overflow = kilitOncesiOverflow ?? "";
  kilitOncesiOverflow = null;
}

export interface ModalA11yOptions {
  open: boolean;
  onClose: () => void;
  /** Odak tuzağının uygulanacağı panel. */
  panelRef: RefObject<HTMLElement | null>;
  /** Açılışta odaklanacak öğe; verilmezse paneldeki ilk odaklanabilir öğe. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Arka planın kaydırmasını kilitle (varsayılan: açık). */
  lockScroll?: boolean;
}

/**
 * Kendi kabuğunu çizen modallar için kısayol: panel ref'ini üretir ve odak
 * tuzağını kurar. Kendi arka planını/animasyonunu yöneten (harita, kırpma,
 * tam ekran) bileşenleri ortak `Modal`'a taşımadan erişilebilir kılar.
 *
 *     const panelRef = useModalPanel({ onClose });
 *     …
 *     <div ref={panelRef} role="dialog" aria-modal="true">
 */
export function useModalPanel({
  open = true,
  onClose,
}: {
  open?: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y({ open, onClose, panelRef });
  return panelRef;
}

export function useModalA11y({
  open,
  onClose,
  panelRef,
  initialFocusRef,
  lockScroll = true,
}: ModalA11yOptions): void {
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // ── `onClose` bir REF'te yaşar; etkinin bağımlılığı DEĞİLDİR (TB-A3c-1) ──
  //
  // Çağıran taraf `onClose`u satır içi ok fonksiyonu olarak verirse — panelde
  // yaygın desen, `onClose={() => setAcik(false)}` — kimlik her render'da
  // değişir. Bağımlılıkta durduğu sürece etki HER RENDER'DA sökülüp yeniden
  // kuruluyordu ve üç zarar üretiyordu:
  //
  //   1. Odak panelin İLK odaklanabilir öğesine geri alınıyordu. İP-A3c'nin
  //      "gönderimde odak ilk hatalı alana taşınır" davranışı bir sonraki
  //      render'da sessizce iptal oluyordu (form her tuş vuruşunda render
  //      eder: kullanıcı yazarken bile odak kayabiliyordu).
  //   2. Temizlik `returnFocusRef.current?.focus()` çağırdığı için odak
  //      pencerenin DIŞINA, açan öğeye sıçrayabiliyordu.
  //   3. `body.style.overflow` her render'da yeniden okunup yazılıyordu;
  //      okunan "önceki" değer artık kendi yazdığımız `hidden` olabiliyordu.
  //
  // Ref render sırasında güncellenir: etkinin içinden okunan işleyici HER
  // ZAMAN günceldir, ama etki yeniden kurulmaz. Çağıran tarafın kimliği elle
  // sabitlemesi (İP-A3c pilotunda yapılmıştı) artık GEREKMEZ.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Bu pencerenin yığındaki kimliği. Ref'te yaşar: her render'da yeni bir
  // sembol üretmek pencereyi kendi yığın girdisinden koparırdı.
  const kimlikRef = useRef<symbol>();
  if (!kimlikRef.current) kimlikRef.current = Symbol("modal-a11y");

  useEffect(() => {
    if (!open) return;

    // Açılış sırası = yığın sırası. Sonradan açılan pencere ÜSTTEDİR.
    const kimlik = kimlikRef.current!;
    MODAL_YIGINI.push(kimlik);
    const enUsttekiMi = () => MODAL_YIGINI[MODAL_YIGINI.length - 1] === kimlik;

    // Modal kapanınca odak, onu açan öğeye geri döner — aksi halde odak
    // <body>'ye düşer ve klavye kullanıcısı sayfanın başına savrulur.
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusTarget =
      initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    // `preventScroll` ZORUNLU, kozmetik değil. Tarayıcı odaklanan öğeyi
    // "görünür kılmak" için en yakın kaydırılabilir atayı kaydırır ve bu,
    // öğe `position: fixed` bir kabın içinde olsa bile bazı mobil
    // tarayıcılarda (ölçüldü: Firefox Android) ALTTAKİ BELGEYİ kaydırır.
    // Kullanıcı şikâyeti (9 Eyl 2026): telefonda alt sekme çubuğundan giriş
    // ekranı açılıp kapatılınca ana sayfa sonuna kadar kayıyordu — kapanışta
    // odak, ekranın DİBİNDEKİ sabit çubuğun bağlantısına geri veriliyor.
    // `html { scroll-behavior: smooth }` yürürlükte olduğu için kayma ayrıca
    // gözle görülüyordu.
    focusTarget?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      // Yalnız EN ÜSTTEKİ pencere klavyeyi işler (B-3). Alttakiler sessiz
      // kalır: aksi hâlde tek ESC bütün yığını birden kapatır ve içteki
      // korumalı formun onayı hiç görünmeden yok olurdu.
      if (!enUsttekiMi()) return;
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    if (lockScroll) kaydirmaKilidiAl(kimlik);

    return () => {
      const sira = MODAL_YIGINI.lastIndexOf(kimlik);
      if (sira >= 0) MODAL_YIGINI.splice(sira, 1);
      document.removeEventListener("keydown", onKeyDown);
      if (lockScroll) kaydirmaKilidiBirak(kimlik);
      // Aynı sebeple `preventScroll`: pencereyi AÇAN öğeye dönerken sayfanın
      // kaydırma konumu kullanıcının bıraktığı yerde kalmalı.
      returnFocusRef.current?.focus({ preventScroll: true });
    };
    // `onClose` BİLEREK yok: ref üzerinden okunuyor (yukarıdaki nota bak).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocusRef, lockScroll, open, panelRef]);
}
