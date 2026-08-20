/**
 * İP-A3a · Karanlık mod paritesi sondası (gerçek tarayıcı için).
 *
 * İP-A2 `Form.*`'ın `dark:` sınıflarını taşıdığını SÖYLEDİ ama ölçmedi.
 * Bu sayfa pilot formu (`DamageDialog`) gerçek Chrome'da açar; sonda betiği
 * aynı DOM'u iki temada okuyup etiket/hint/hata metinlerinin kontrastını ve
 * slot yüksekliklerini karşılaştırır.
 *
 * **Gerçek veri kullanılmaz.** İP-A1 turu canlı `ceyhandb`'ye bağlanmış ve
 * ekran görüntüleri gerçek müşteri verisi içermişti; bu sonda hiçbir sunucuya
 * bağlanmaz — `DamageDialog`'a sahte prop'lar verilir, ürün seçici boş kalır.
 *
 * Yalnız ölçüm içindir; hiçbir route'a bağlı değildir.
 *
 * İP-A4 · Görev 5a: sonda sayfaları `src/` ağacından ÇIKARILDI. Eskiden
 * `src/__probe__/` altındaydılar; `tsc` kapsamında ve nöbetçi taramasındaydılar
 * (TB-A3c-2). Silinmek yerine `scripts/probe/` altına taşındılar: A2/A3a
 * ölçümlerinin tekrar üretilebilirliği sürüyor, üretim ağacı temiz.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { DamageDialog } from "@/components/admin/inventory/DamageDialog";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import "@/index.css";

import type { DamageKind } from "@/lib/inventory";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Sonda() {
  // İP-A4: pencere durumu artık düzenleme yüzeyinde.
  const yuzey = useDuzenlemeYuzeyi<never, DamageKind>();
  // Bir kez aç: `yuzey` kimliği açılışta değişir, bağımlılığa koymak sonsuz
  // döngü üretirdi.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { yuzey.yeniAc("SUPPLIER_RETURN"); }, []);
  return (
    <QueryClientProvider client={qc}>
      {/* Tedarikçi iadesi seçildi: hem `Form.Hint` hem kaynak kova alanı
          görünür olsun — hint'i olmayan bir `kind` seçilseydi hint kontrastı
          hiç ölçülemezdi. */}
      <DamageDialog yuzey={yuzey} isPending={false} error={null} onSubmit={() => {}} />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Sonda />);
