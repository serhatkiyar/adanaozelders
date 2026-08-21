import { useContext, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useModalA11y } from "@/hooks/useModalA11y";
import {
  GELISTIRME,
  IcerikKorumasiCtx,
  icerikKorumasiDenetle,
} from "@/components/admin/ui2/icerikKorumasi";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  /**
   * Panel genişliği (İP-A7d1 · Görev 3'te eklendi).
   *
   * Ortak pencere bugüne dek TEK genişlikteydi (`max-w-lg`) ve panelde ondan
   * geniş yaşayan yüzeyler ortak yüzeye GEÇEMİYORDU: kütüphane editörü
   * (iki sütunlu adres ızgarası + harita + yedi günlük saat tablosu) ve
   * oturum yönetimi kendi `fixed inset-0` katmanlarını kuruyordu — yani
   * etiketsiz overlay borcunun bir kısmı doğrudan bu eksikten geliyordu.
   *
   * Serbest bir `className` değil, İKİ ADIM: yüzeylerin rastgele
   * genişliklerde büyümesi bir tasarım kararıdır ve ekran başına verilmemeli.
   */
  genislik?: "dar" | "genis";
  /**
   * "Bu pencere bilerek korumasız" beyanı (İP-A7d4 · Görev 1).
   *
   * Panelinde düzenlenebilir kontrol taşıyan ama hiçbir kirli form bekçisi
   * kaydolmayan pencere GELİŞTİRMEDE PATLAR — çünkü bu, göç boyunca iki kez
   * üretimde yakalanan sessiz veri kaybının ta kendisidir (SK-4, SK-7).
   *
   * Korumasız pencere meşru olabilir (salt-okunur detay, tek süzgeç kutusu
   * taşıyan seçici); o zaman kendini BEYAN eder. `false` yazılamaz:
   * "korumasızım ama değilim" diye bir durum yok — `pencereSiz` beyanının
   * aynı kuralı. Beyanın yanına gerekçesi yazılır; gerekçesiz beyan bir
   * kaçış kapısıdır.
   */
  korumasiz?: true;
}

const GENISLIK: Record<"dar" | "genis", string> = {
  dar: "max-w-lg",
  genis: "max-w-2xl",
};

export function Dialog({ open, title, description, children, onClose, initialFocusRef, genislik = "dar", korumasiz }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useModalA11y({ open, onClose, panelRef, initialFocusRef });

  // ── "İçeriğim korumasız" dedektörü (İP-A7d4 · Görev 1) ──
  //
  // Denetim BURADA yaşıyor çünkü `Dialog` panelin TEK overlay boğazıdır
  // (`etiketsiz overlay = 0` nöbetçisi bunu ayrıca tutuyor): kim hangi
  // katmandan pencere kurarsa kursun buradan geçer. Bekçinin kaydını
  // pencere sözleşmesinin sahibi (`DuzenlemeYuzeyi`/`DuzenlemePenceresi`)
  // bağlam üzerinden bildirir.
  //
  // Bağımlılık dizisi YOK: içerik bekçisini koşullu kaydedebilir ve alanlar
  // veri geldikten SONRA basılabilir. Aynı commit'te çocuk efektleri
  // ebeveyn efektinden ÖNCE koştuğu için kayıt her denetimde tazedir.
  const korumaVarMi = useContext(IcerikKorumasiCtx);
  useEffect(() => {
    if (!open) return;
    icerikKorumasiDenetle({
      kok: panelRef.current,
      korumaVar: korumaVarMi?.() ?? false,
      korumasiz,
      baslik: title,
    });
  });

  /* ── İP-A8 · Görev 3 · B-2: denetim `Dialog`un RENDER'ına bağlı OLAMAZ ──
   *
   * Yukarıdaki efektin bağımlılık dizisi yok ve A7d4 bunu "her render'da
   * koşuyor, kayıt taze" diye savunmuştu. Doğrusu şu: **`Dialog`un KENDİ
   * render'ında** koşuyor. Pencerenin içindeki bir çocuk kendi `useState`ini
   * değiştirdiğinde (katlanır bölüm açıldı, sekme değişti, çocuğun sorgusu
   * geldi) `Dialog` yeniden render EDİLMEZ ve denetim bir daha hiç çalışmaz.
   *
   * Bağımsız denetim #3 bunu `vi.mock` ile ölçtü: B-1 senaryosunda dedektöre
   * yapılan çağrı sayısı **BİR**di ve o tek çağrı anında panelde sıfır girdi
   * vardı; "+ Operatör"e basılıp dört alan belirdiğinde denetim bir daha
   * koşmadı. Dedektörün kapsamı bu yüzden sanılandan çok daha dardı: yalnız
   * "pencere açıldığı anda zaten basılı olan" alanları görüyordu.
   *
   * Çözüm panelin İÇERİĞİNİ izlemek: `MutationObserver` alt ağacı dinler ve
   * her değişimde denetim yeniden koşar.
   *
   * Hata gözlemci geri çağrısından DOĞRUDAN fırlatılmaz — orası React'in
   * dışıdır ve hata sınırına ulaşmaz, teşhis edilemez bir "uncaught" olurdu.
   * Duruma yazılıp **render sırasında** fırlatılır: böylece mevcut sözleşme
   * (hata sınırı yakalar, test onu okur) aynen korunur.
   *
   * Sıralama güvenli: çocuğun bekçi kaydı bir `useEffect`tir ve React 18'de
   * commit sonrası SENKRON akar; gözlemci geri çağrısı ise bir mikrogörevdir
   * ve ondan SONRA koşar. Yani "form açıldı ama bekçisi henüz kaydolmadı"
   * diye bir yanlış pozitif oluşmaz.
   */
  const [icerikHatasi, setIcerikHatasi] = useState<Error | null>(null);
  useEffect(() => {
    if (!GELISTIRME || !open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const gozlemci = new MutationObserver(() => {
      try {
        icerikKorumasiDenetle({
          kok: panel,
          korumaVar: korumaVarMi?.() ?? false,
          korumasiz,
          baslik: title,
        });
      } catch (hata) {
        setIcerikHatasi(hata as Error);
      }
    });
    gozlemci.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      // `disabled`/`readonly` kalkması da "artık veri taşıyor" demektir.
      attributeFilter: ["disabled", "readonly", "type", "contenteditable"],
    });
    return () => gozlemci.disconnect();
  }, [korumaVarMi, korumasiz, open, title]);

  if (icerikHatasi) throw icerikHatasi;

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Pencereyi kapat" className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} className={`relative max-h-[92vh] w-full ${GENISLIK[genislik]} overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 sm:rounded-3xl`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-slate-950 dark:text-white">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800">
            <span className="sr-only">Kapat</span>
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
