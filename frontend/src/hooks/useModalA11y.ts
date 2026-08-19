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

  useEffect(() => {
    if (!open) return;

    // Modal kapanınca odak, onu açan öğeye geri döner — aksi halde odak
    // <body>'ye düşer ve klavye kullanıcısı sayfanın başına savrulur.
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusTarget =
      initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    focusTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
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

    const previousOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
    // `onClose` BİLEREK yok: ref üzerinden okunuyor (yukarıdaki nota bak).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocusRef, lockScroll, open, panelRef]);
}
