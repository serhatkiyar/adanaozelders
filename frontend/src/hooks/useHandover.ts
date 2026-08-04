// Kurye zimmeti — React Query katmanı (ADMIN + KURYE saha ekranları).
//
// Anahtar öneki bilinçli olarak `["delivery", ...]`: `hooks/useDelivery.ts`
// içindeki bütün yazma işlemleri `invalidateQueries({ queryKey: ["delivery"] })`
// çağırır. Zimmet manifesti ayrı bir kökte dursaydı (`["handover"]`), turu
// başlatmak/durağı sonuçlandırmak manifesti TAZELEMEZ ve kurye ekranda bayat
// bir N/M sayacı görürdü.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as handoverApi from "@/api/handover";

const KEY = ["delivery"] as const;

export function handoverManifestKey(runId: number | null) {
  return [...KEY, "handover", "manifest", runId] as const;
}

/**
 * Turun zimmet manifesti.
 *
 * `poll` yalnız zimmet ekranında açılır: depoda aynı turu iki kişi (kurye +
 * operatör) yüklüyor olabilir ve sayaç ikisinde de ilerlemelidir. Saha
 * ekranında poll KAPALIDIR — orada manifest yalnız "bu paket bende mi"
 * kapısıdır ve tur sorgusu zaten 15 sn'de bir dönüyor; ikinci bir periyodik
 * istek, uç durak başına bir `live_package` sorgusu yaptığı için bedava değil.
 */
export function useHandoverManifest(runId: number | null, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: handoverManifestKey(runId),
    queryFn: () => handoverApi.fetchHandoverManifest(runId!),
    enabled: runId != null,
    refetchInterval: opts?.poll ? 20_000 : undefined,
  });
}

/**
 * Paket zimmetleme.
 *
 * Başarıda **bütün** teslimat ağacı tazelenir: zimmet siparişi `SHIPPED`
 * yapar ve turun/durakların görünümünü de değiştirir; yalnız manifesti
 * tazelemek, saha ekranındaki paket kapısını bayat bırakırdı.
 */
export function useHandoverScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: string) => handoverApi.handoverScan(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
