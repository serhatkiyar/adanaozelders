// Varlık bazlı senkron yazma kilidi + kilide uyan düğme — Dağıtım ekranlarının ortak modeli (Kuryeler, Araçlar).
// Küresel kilit yoktur: `varlik` anahtarı (ör. `kurye:12`, `vehicle:yeni`) başına tek işlem sürer. Aynı varlık +
// aynı işlem yeniden istenirse uçuştaki söz paylaşılır (aynı tick çift tık → tek istek); farklı işlem istenirse istek
// çıkmaz ve neden görünür. Pending işlemin düğmesi loading, aynı varlığın diğer yazma düğmeleri kapalı + nedenli.
import { useRef, useState } from "react";
import { Button } from "antd";
import type { ButtonProps } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { getErrorDetail } from "@/lib/errors";

export const MESGUL_NEDENI = "Bu kayıt üzerinde başka bir işlem sürüyor; bitince deneyin.";

/** Varlık kilidine uyan yazma düğmesi: kendi işlemi sürüyorsa loading, aynı varlıkta başka işlem sürüyorsa kapalı + neden. */
export function VarlikDugmesi({ islem, mesgulIslem, title, disabled, loading, ...props }: ButtonProps & { islem: string; mesgulIslem: string | undefined }) {
  // `islem` kilit modelinin anahtarıdır; beyansız düğme kilide uyamaz — sessizce çizilmez, atar.
  if (!islem) throw new Error("VarlikDugmesi: `islem` zorunlu.");
  const baska = mesgulIslem !== undefined && mesgulIslem !== islem;
  // Çağıranın kendi önkoşulu (disabled/loading/title) EZİLMEZ, kilit nedeniyle BİRLEŞİR: kilit nedeni önceliklidir,
  // kilit yokken çağıranın `title`ı (kendi önkoşul açıklaması) kalır.
  return <Button {...props} loading={mesgulIslem === islem || Boolean(loading)} disabled={baska || Boolean(disabled)} title={baska ? MESGUL_NEDENI : title} />;
}

export function useVarlikKilidi(message: MessageInstance) {
  // Senkron ref karar verir, state düğmeleri çizer.
  const kilitRef = useRef(new Map<string, { islem: string; soz: Promise<unknown> }>());
  const [bekleyenler, setBekleyenler] = useState<Record<string, string>>({});
  const surenIslem = (varlik: string) => bekleyenler[varlik];
  /**
   * Aynı varlık + aynı işlem: uçuştaki söz paylaşılır (tek istek). Aynı varlık + başka işlem: istek çıkmaz, neden
   * görünür, `null` döner. Kilit başarı/hatadan bağımsız `finally` ile kesin bırakılır.
   */
  const kilitle = (varlik: string, islem: string, calistir: () => Promise<unknown>): Promise<unknown> | null => {
    const mevcut = kilitRef.current.get(varlik);
    if (mevcut) {
      if (mevcut.islem === islem) return mevcut.soz;
      message.warning(MESGUL_NEDENI);
      return null;
    }
    // `calistir` senkron atarsa kilit HİÇ alınmaz (sızıntı yok); hata reddedilmiş söz olarak döner ki onay pencereleri
    // açık kalsın ve çağıran `void`lasa bile state tutarlı olsun.
    let ic: Promise<unknown>;
    try {
      ic = calistir();
    } catch (e) {
      message.error(getErrorDetail(e, "İşlem başlatılamadı."));
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const soz = ic.finally(() => {
      kilitRef.current.delete(varlik);
      setBekleyenler((o) => {
        const kalan = { ...o };
        delete kalan[varlik];
        return kalan;
      });
    });
    kilitRef.current.set(varlik, { islem, soz });
    setBekleyenler((o) => ({ ...o, [varlik]: islem }));
    return soz;
  };
  const kilitli = (varlik: string) => kilitRef.current.has(varlik);
  /** Onay penceresi: varlık kilitliyken Vazgeç/ESC/maske kapatmaz. */
  const kapatmaEngeli = (varlik: string) => () => (kilitli(varlik) ? Promise.reject(new Error("bekleniyor")) : undefined);
  /** Onayın onOk'u: gerçek mutation sözü; kilit çakışırsa reddedilir ve pencere açık kalır. */
  const onayla = (varlik: string, islem: string, calistir: () => Promise<unknown>) => () => kilitle(varlik, islem, calistir) ?? Promise.reject(new Error("mesgul"));
  return { kilitle, kilitli, surenIslem, kapatmaEngeli, onayla };
}
