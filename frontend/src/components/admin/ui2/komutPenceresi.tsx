import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useModalA11y } from "@/hooks/useModalA11y";

/**
 * ── Komut penceresi — ORTAK MEKANİZMA (İP-B1 · Görev 4) ──
 *
 * Bu dosya sıfırdan yazılmadı: `components/TaskCommandPalette.tsx`in
 * ETKİLEŞİM MEKANİZMASI buraya taşındı (overlay, arama girdisi, gruplu
 * sonuçlar, ok tuşlarıyla gezinme, Enter/Escape, işaretçiyle etkinleşme).
 * Görev modülünün kendi veri kabuğu orada kaldı; ortak olan şey burada.
 *
 * Taşırken üç şey DÜZELDİ ve üçü de eski palette'te canlı borçtu:
 *
 *   1. **Overlay etiketsizdi.** `TaskCommandPalette` `role="dialog"` ve
 *      `aria-modal` taşımıyordu; ekran okuyucu için o katman bir pencere
 *      değildi. (Ölçüm tabanının dışında olduğu için nöbetçi görmüyordu —
 *      yani borç gerçekti, sadece sayılmıyordu.)
 *   2. **Sonuç listesinin ARIA yapısı yoktu.** Sonuçlar `<button>` yığınıydı;
 *      "N sonuçtan 2.si" bilgisi hiçbir yerde yoktu. Artık standart
 *      combobox↔listbox deseni: girdi `role="combobox"` +
 *      `aria-activedescendant`, liste `role="listbox"`, öğeler
 *      `role="option"` + `aria-selected`.
 *   3. **Odak geri dönmüyordu.** Pencere kapanınca odak `document.body`de
 *      kalıyordu; artık pencereyi açan öğeye geri döner.
 *
 * Deseni `<button>` yığını yerine listbox'a çevirmenin ikinci bir kazancı da
 * var: nöbetçi eşiği "ham `<button>` artamaz" (uiBaseline). Sonuç başına bir
 * ham düğme yazan bir palet, uzun listede eşiği tek başına yerdi. Listbox
 * deseni HEM daha doğru ARIA HEM sıfır düğme.
 *
 * Kilit, odak tuzağı, ESC ve odağın geri verilmesi `useModalA11y`den gelir:
 * pencere böylece sayaçlı kaydırma kilidine ve modal yığınına katılır. Eskiden
 * `body.style.overflow`u kendisi saklayıp geri yazıyordu; bir `Dialog`un
 * üstünde açılınca tek ESC ikisini birden kapatıyor ve kapanış sırası yüzünden
 * gövde `hidden` kalıyordu. Tab da odağı arkadaki sayfaya kaçırıyordu.
 *
 * Pencere `createPortal` ile `document.body`ye taşınır: panel kabuğunun üst
 * şeridi `backdrop-blur` taşıyor ve blur'lu bir ata, içindeki `position:fixed`
 * katmanı kendi kutusuna hapseder (bu tuzak bu depoda bir kez yaşandı).
 */

export interface KomutOgesi {
  /** React anahtarı ve `aria-activedescendant` kimliğinin tabanı. */
  anahtar: string;
  etiket: string;
  ikon?: ReactNode;
  /** Sağda görünen ikincil bilgi (grup adı, alan adı). */
  yardimci?: string;
  /** Sağda görünen tuş rozeti (ör. "G K"). */
  kisayol?: string;
  calistir: () => void;
}

export interface KomutGrubu {
  baslik: string;
  ogeler: KomutOgesi[];
}

export interface KomutPenceresiProps {
  acik: boolean;
  onKapat: () => void;
  /** Pencerenin erişilebilir adı. */
  baslik: string;
  /** Arama girdisinin erişilebilir adı. */
  aramaEtiketi: string;
  yerTutucu: string;
  sorgu: string;
  onSorgu: (deger: string) => void;
  gruplar: KomutGrubu[];
  bosMetin?: string;
  /** Etkin satır dizini — çağıran tutar (sorgu değişince sıfırlanabilsin). */
  etkin: number;
  onEtkin: (dizin: number) => void;
}

export function KomutPenceresi({
  acik,
  onKapat,
  baslik,
  aramaEtiketi,
  yerTutucu,
  sorgu,
  onSorgu,
  gruplar,
  bosMetin = "Sonuç yok.",
  etkin,
  onEtkin,
}: KomutPenceresiProps) {
  const kimlik = useId();
  const girdiRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const duz = useMemo(() => gruplar.flatMap((g) => g.ogeler), [gruplar]);
  const ogeKimligi = (anahtar: string) => `${kimlik}-${anahtar}`;
  const etkinKimlik = duz[etkin] ? ogeKimligi(duz[etkin].anahtar) : undefined;

  useModalA11y({ open: acik, onClose: onKapat, panelRef, initialFocusRef: girdiRef });

  // Odak girdide kaldığı için (`aria-activedescendant`) tarayıcı ok tuşuyla
  // seçilen satırı kendiliğinden görünür kılmaz; uzun listede vurgu alt
  // kenardan çıkıp kayboluyordu. jsdom `scrollIntoView` taşımaz, çağrı korumalı.
  useEffect(() => {
    if (!acik || !etkinKimlik) return;
    document.getElementById(etkinKimlik)?.scrollIntoView?.({ block: "nearest" });
  }, [acik, etkinKimlik]);

  if (!acik) return null;

  const calistir = (oge: KomutOgesi) => {
    // Önce kapat, sonra çalıştır: `calistir` gezinme yapıyorsa pencere zaten
    // kapanmış olmalı, aksi hâlde yeni sayfanın üstünde asılı kalır.
    onKapat();
    oge.calistir();
  };

  const tusIsle = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      onEtkin(duz.length ? (etkin + 1) % duz.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onEtkin(duz.length ? (etkin - 1 + duz.length) % duz.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (duz[etkin]) calistir(duz[etkin]);
    }
    // ESC ve Tab `useModalA11y`de: yalnız yığının en üstündeki pencere işler.
  };

  let dizin = -1;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/50 p-4 pt-[12vh] backdrop-blur-sm">
      {/* Zemin kapatıcı: klavyeyle erişilemez olmalı (ESC zaten var), bu yüzden
          bir düğme değil `aria-hidden` bir katman. Eski palette burada
          etiketsiz bir tıklama alanı taşıyordu. */}
      <div aria-hidden="true" className="absolute inset-0" onClick={onKapat} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={baslik}
        onKeyDown={tusIsle}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-panel-border bg-panel-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-panel-border px-4 py-3">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 flex-none text-panel-fg-subtle">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
          </svg>
          <input
            ref={girdiRef}
            role="combobox"
            aria-label={aramaEtiketi}
            aria-expanded="true"
            aria-controls={`${kimlik}-liste`}
            aria-autocomplete="list"
            aria-activedescendant={etkinKimlik}
            value={sorgu}
            onChange={(e) => onSorgu(e.target.value)}
            placeholder={yerTutucu}
            className="min-w-0 flex-1 bg-transparent text-sm text-panel-fg outline-none placeholder:text-panel-fg-subtle"
          />
          <kbd className="flex-none rounded-lg bg-panel-surface-hover px-2 py-1 text-[10px] font-semibold text-panel-fg-subtle">
            Esc
          </kbd>
        </div>

        <ul id={`${kimlik}-liste`} role="listbox" aria-label={baslik} className="max-h-[55vh] overflow-y-auto py-2">
          {duz.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-panel-fg-subtle">{bosMetin}</li>
          ) : (
            gruplar
              .filter((g) => g.ogeler.length > 0)
              .map((grup) => (
                <li key={grup.baslik}>
                  <ul role="group" aria-label={grup.baslik}>
                    <li
                      role="presentation"
                      className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-panel-fg-subtle"
                    >
                      {grup.baslik}
                    </li>
                    {grup.ogeler.map((oge) => {
                      dizin += 1;
                      const bu = dizin;
                      const secili = bu === etkin;
                      return (
                        <li
                          key={oge.anahtar}
                          id={ogeKimligi(oge.anahtar)}
                          role="option"
                          aria-selected={secili}
                          onMouseMove={() => onEtkin(bu)}
                          onClick={() => calistir(oge)}
                          className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm ${
                            secili ? "bg-panel-accent-soft" : ""
                          }`}
                        >
                          {oge.ikon && <span className="flex-none text-panel-fg-subtle">{oge.ikon}</span>}
                          <span className="min-w-0 flex-1 truncate font-medium text-panel-fg">{oge.etiket}</span>
                          {oge.yardimci && (
                            <span className="flex-none text-xs text-panel-fg-subtle">{oge.yardimci}</span>
                          )}
                          {oge.kisayol && (
                            <kbd className="flex-none rounded-lg bg-panel-surface-hover px-1.5 py-0.5 text-[10px] font-semibold text-panel-fg-subtle">
                              {oge.kisayol}
                            </kbd>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
          )}
        </ul>
      </div>
    </div>,
    document.body
  );
}
