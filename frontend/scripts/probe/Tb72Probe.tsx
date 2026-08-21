/**
 * TB-72 · Kirli form bekçisinde "Çık" sondası (gerçek tarayıcı için).
 *
 * Kusur jsdom'da YENİDEN ÜRETİLEMEDİ: `@testing-library` ile "Çık" tıklandığında
 * pencere kapanıyor. Gerçek Chrome'da ise (`/yonetim/envanter/hasar` → "Hasara
 * ayır" → miktar=3 → kapat → "Çık") pencere açık kalıyordu. Fark tarayıcıya
 * özgü: Medusa'nın `usePrompt`u kendi React kökünü kurar, Radix `AlertDialog`
 * gerçek animasyon/odak/`pointer-events` yönetimi yapar.
 *
 * Bu sayfa aynı pencereyi (`DamageDialog` + `DuzenlemeYuzeyi`) gerçek
 * tarayıcıda açar ve üç kapatma yolunu da sürülebilir kılar. Hiçbir sunucuya
 * BAĞLANMAZ (ürün seçici boş) — gerçek veri kullanılmaz.
 *
 * Yalnız ölçüm içindir; hiçbir route'a bağlı değildir (`scripts/probe/`,
 * `tsc` kapsamı ve nöbetçi taraması dışında — TB-A3c-2 kararı).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { DamageDialog } from "@/components/admin/inventory/DamageDialog";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import "@/index.css";

import type { DamageKind } from "@/lib/inventory";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Sonda() {
  const yuzey = useDuzenlemeYuzeyi<never, DamageKind>();
  return (
    <QueryClientProvider client={qc}>
      <div style={{ padding: 24 }}>
        <button id="sonda-ac" type="button" onClick={() => yuzey.yeniAc("TRANSFER")}>
          Hasara ayır
        </button>
        <span id="sonda-durum" data-acik={yuzey.acik ? "1" : "0"}>
          {yuzey.acik ? "açık" : "kapalı"}
        </span>
      </div>
      <DamageDialog yuzey={yuzey} isPending={false} error={null} onSubmit={() => {}} />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Sonda />);
