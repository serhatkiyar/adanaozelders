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
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import { DamageDialog } from "@/components/admin/inventory/DamageDialog";
import "@/index.css";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Sonda() {
  return (
    <QueryClientProvider client={qc}>
      {/* Tedarikçi iadesi seçildi: hem `Form.Hint` hem kaynak kova alanı
          görünür olsun — hint'i olmayan bir `kind` seçilseydi hint kontrastı
          hiç ölçülemezdi. */}
      <DamageDialog
        kind="SUPPLIER_RETURN"
        isPending={false}
        error={null}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Sonda />);
