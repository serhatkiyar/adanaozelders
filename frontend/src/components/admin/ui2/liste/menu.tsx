import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/admin/ui";

/**
 * ── Açılır menü (İP-B2 · liste ailesi) ──
 *
 * Panelin üç yerinde aynı mekanizma gerekiyordu ve üçü de bu dosyadan gelir:
 * satır aksiyonlarının taşması (Ç-2 · D), "Filtre ekle", "Sırala".
 *
 * ## Neden Radix / `@medusajs/ui` `DropdownMenu` KULLANILMADI
 *
 * Medusa'nın deseni bir `DropdownMenu` ve `ui2/` katmanı Medusa'yı doğrudan
 * import edebiliyor — yani teknik bir engel yoktu. Karar ölçüme dayanıyor:
 * Radix menüsü `pointerdown`/`pointermove` ve `hasPointerCapture` üzerine
 * kuruluyor; jsdom bunların hiçbirini uygulamıyor. Bu depoda aynı sınıf iki
 * kez ısırdı (İP-A7d5 · `Observer` shim'leri; A7d1 · Radix `aria-hidden`
 * tuzağı) ve her seferinde bedeli aynı oldu: davranış testleri, ürünün
 * kendisini değil test ortamının kılığını ölçmeye başladı.
 *
 * Bu menü ~120 satır ve WAI-ARIA "menu button" desenini birebir uyguluyor;
 * karşılığında her davranışı (klavye, ESC, dış tıklama, odak dönüşü) GERÇEK
 * DOM'da test edilebiliyor. Görsel dil Medusa'nın aynısı.
 *
 * ## `fixed inset-0` YOK — bilinçli
 *
 * Menü tam ekran bir zemin katmanı sermez. İki sebep: (1) bir menü pencere
 * (modal) değildir; arkasını kilitlemesi yanlış olurdu, (2) `fixed inset-0`
 * yazan her katman ölçüm tabanında "overlay" sayılır ve `role="dialog"` +
 * `aria-modal` ister (`uiBaseline` eşiği `toBe(0)`). Dışarı tıklama
 * `pointerdown` dinleyicisiyle yakalanır.
 *
 * ## Ham `<button>` yok
 *
 * Tetikleyici ve öğeler ortak `Button`dan gelir. Menü öğesi görsel olarak
 * düğme değildir ama DAVRANIŞI düğmedir; `ghost` varyantı + genişlik ezmesi
 * ile aynı odak halkası ve dokunma yüksekliği miras alınır.
 */

export interface MenuProps {
  /** Tetikleyicinin erişilebilir adı — "Ürün işlemleri" gibi, satırı TANITIR. */
  etiket: string;
  /** Menü gövdesi. `kapat` verilir: bir öğe seçilince menü kendini kapatmalı. */
  children: (kapat: () => void) => ReactNode;
  /** Açılır katmanın hizası. Tablo satırında sağa, araç çubuğunda sola. */
  hizala?: "sol" | "sag";
  /** Tetikleyicinin görünen içeriği. Verilmezse üç nokta ikonu. */
  tetikleyiciIcerik?: ReactNode;
  /** Tetikleyici düğmesinin varyantı (araç çubuğunda `secondary`). */
  tetikleyiciVaryant?: "ghost" | "secondary";
  /** Menü genişliği sınıfı (içeriğe göre değişir). */
  genislikSinifi?: string;
  /**
   * Tetikleyiciye eklenen sınıf — mobil kartta dokunma hedefini 44 px'e
   * çıkarmak için (tasarım dili §5.5). Görsel dil değişmez, yalnız boy.
   */
  tetikleyiciSinif?: string;
}

const OGE_SECICI = '[role="menuitem"]:not([disabled])';

export function Menu({
  etiket,
  children,
  hizala = "sag",
  tetikleyiciIcerik,
  tetikleyiciVaryant = "ghost",
  genislikSinifi = "w-56",
  tetikleyiciSinif,
}: MenuProps) {
  const [acik, setAcik] = useState(false);
  const kapsayiciRef = useRef<HTMLDivElement>(null);
  const tetikleyiciRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const kapat = useCallback((odakDon = true) => {
    setAcik(false);
    if (odakDon) tetikleyiciRef.current?.focus();
  }, []);

  // Dışarı tıklama. `pointerdown` seçildi (`click` değil): kullanıcı menünün
  // dışındaki BAŞKA bir düğmeye basarsa, o düğme kendi `click`ini almadan
  // önce menü kapanır — aksi hâlde menü kapanırken tıklama hedefi kayar.
  useEffect(() => {
    if (!acik) return;
    const disari = (olay: PointerEvent) => {
      if (!kapsayiciRef.current?.contains(olay.target as Node)) setAcik(false);
    };
    document.addEventListener("pointerdown", disari);
    return () => document.removeEventListener("pointerdown", disari);
  }, [acik]);

  /** Menüdeki odaklanabilir öğeler — DOM'dan okunur, ref listesi tutulmaz. */
  const ogeler = () =>
    Array.from(kapsayiciRef.current?.querySelectorAll<HTMLElement>(OGE_SECICI) ?? []);

  const odakla = (indeks: number) => {
    const liste = ogeler();
    if (liste.length === 0) return;
    // Sarmalama bilinçli: menü döngüseldir (WAI-ARIA menu button deseni).
    const hedef = ((indeks % liste.length) + liste.length) % liste.length;
    liste[hedef]?.focus();
  };

  useEffect(() => {
    if (!acik) return;
    // Açılışta ilk öğeye odaklan: klavye kullanıcısı menüyü açtıktan sonra
    // ayrıca bir ok tuşuna basmak zorunda kalmamalı.
    const zamanlayici = setTimeout(() => odakla(0), 0);
    return () => clearTimeout(zamanlayici);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik]);

  const tusYonetimi = (olay: React.KeyboardEvent) => {
    if (!acik) return;
    const liste = ogeler();
    const suanki = liste.indexOf(document.activeElement as HTMLElement);
    if (olay.key === "Escape") {
      olay.preventDefault();
      kapat();
      return;
    }
    if (olay.key === "Tab") {
      // Menüden Tab ile çıkmak menüyü kapatır ama odağı GERİ ALMAZ: kullanıcı
      // ileri gitmek istiyor, tetikleyiciye dönmek geri gitmek olurdu.
      setAcik(false);
      return;
    }
    if (olay.key === "ArrowDown") {
      olay.preventDefault();
      odakla(suanki + 1);
      return;
    }
    if (olay.key === "ArrowUp") {
      olay.preventDefault();
      odakla(suanki <= 0 ? liste.length - 1 : suanki - 1);
      return;
    }
    if (olay.key === "Home") {
      olay.preventDefault();
      odakla(0);
      return;
    }
    if (olay.key === "End") {
      olay.preventDefault();
      odakla(liste.length - 1);
    }
  };

  return (
    <div ref={kapsayiciRef} className="relative inline-flex" onKeyDown={tusYonetimi}>
      <Button
        ref={tetikleyiciRef}
        variant={tetikleyiciVaryant}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={acik}
        aria-controls={acik ? menuId : undefined}
        onClick={() => setAcik((v) => !v)}
        onKeyDown={(olay) => {
          // Kapalıyken ok tuşu da açar (WAI-ARIA deseni).
          if (!acik && (olay.key === "ArrowDown" || olay.key === "ArrowUp")) {
            olay.preventDefault();
            setAcik(true);
          }
        }}
        className={`${tetikleyiciIcerik ? "" : "!px-2"} ${tetikleyiciSinif ?? ""}`.trim() || undefined}
      >
        {tetikleyiciIcerik ?? (
          <>
            <span className="sr-only">{etiket}</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </>
        )}
      </Button>

      {acik && (
        <div
          id={menuId}
          role="menu"
          aria-label={etiket}
          className={`absolute top-full z-40 mt-1 ${
            hizala === "sag" ? "right-0" : "left-0"
          } ${genislikSinifi} overflow-hidden rounded-xl border border-panel-border bg-panel-surface py-1 shadow-lg`}
        >
          {children(() => kapat())}
        </div>
      )}
    </div>
  );
}

export interface MenuOgesiProps {
  children: ReactNode;
  onSec: () => void;
  /**
   * Yıkıcı aksiyon: satırı/kaydı geri alınamaz biçimde değiştirir.
   *
   * Yalnız RENGİ değiştirir; onay adımını `SatirAksiyonlari` zorunlu kılar
   * (bu bileşen tek başına kullanılırsa onayı çağıran taraf kurar).
   */
  yikici?: boolean;
  bekliyor?: boolean;
  /** Etiketin altındaki açıklama satırı (ör. kısayol ya da sonuç bilgisi). */
  ipucu?: string;
}

export function MenuOgesi({ children, onSec, yikici, bekliyor, ipucu }: MenuOgesiProps) {
  return (
    <Button
      role="menuitem"
      variant="ghost"
      size="sm"
      isPending={bekliyor}
      onClick={onSec}
      className={`w-full !justify-start rounded-none px-3 text-left ${
        yikici ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10" : ""
      }`}
    >
      <span className="flex min-w-0 flex-col items-start">
        <span className="truncate">{children}</span>
        {/* Açık boşluk: erişilebilir ad hesabı bitişik metin düğümlerini
            birleştirirken ayırıcı GARANTİ ETMEZ; ipucu doğrudan etikete
            yapışırsa ekran okuyucu "Kapak görseli yüklePNG veya JPG" der.
            Flex kapsayıcıda yalnız-boşluk düğümü görsel olarak hiçbir şey
            çizmez (anonim flex öğesi oluşmaz). */}
        {ipucu && " "}
        {ipucu && <span className="text-[11px] font-normal text-panel-fg-subtle">{ipucu}</span>}
      </span>
    </Button>
  );
}

/** Menü içi ayraç — gruplar arası saç-teli çizgi (kutu değil, çizgi). */
export function MenuAyraci() {
  return <div role="separator" className="my-1 h-px bg-panel-border" />;
}
