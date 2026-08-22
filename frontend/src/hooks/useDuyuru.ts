import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createDuyuruSeridi,
  deleteDuyuruSeridi,
  fetchAktifDuyuru,
  fetchDuyuruSeridiList,
  updateDuyuruSeridi,
} from "@/api/duyuru";
import * as duyuruCache from "@/lib/duyuruCache";
import type { DuyuruSeridiCreate, DuyuruSeridiUpdate } from "@/types";

const AKTIF_KEY = ["duyuru-seridi", "aktif"] as const;
const LISTE_KEY = ["admin", "duyuru-seridi"] as const;

/**
 * Storefront şeridi — public, kimlik doğrulaması gerektirmez.
 *
 * `usePaymentAvailability` deseni: `retry:false` + `meta.silentError` — uç
 * düşerse şerit sessizce yok olur, kullanıcıya hata toast'ı gösterilmez
 * (yanlış bir duyuru göstermemek, göstermemekten iyidir).
 *
 * ## CLS düzeltmesi (İP-C2 düzeltme turu, madde D)
 *
 * Gerçek ölçüm: her ziyarette şerit ASENKRON geldiği için ilk boyamada
 * `null` render edip yanıt gelince içerik eklemek düzen kayması üretiyordu
 * (hızlı bağlantıda bile CLS≈0.21). Şerit haftalarca değişmediği için bu
 * ikinci ve sonraki ziyaretlerde TAMAMEN gereksiz: `lib/duyuruCache`'teki
 * son bilinen durum `placeholderData` olarak verilir — tarayıcı GERÇEK
 * yanıtı beklemeden önceki hâli iyimser gösterir. İlk ziyarette önbellek
 * boş olduğundan (`oku()` → `undefined`) davranış DEĞİŞMEZ: yanıt gelene
 * kadar hiçbir şey render edilmez.
 *
 * Gerçek yanıt geldiğinde (`isPlaceholderData === false`) o her zaman
 * KAZANIR — bu bir `useEffect` ile önbelleğe yazılır, iyimser tahmin bir
 * DAHA sonraki ziyaret için güncellenir. İçerik değişmişse (metin/varyant/
 * aktiflik) React zaten yeni `data`yı render eder; ayrı bir "yükseklik"
 * karşılaştırması gerekmez — kazanan her zaman GERÇEK veridir, önbellek
 * yalnız ilk karede geçici bir tahmindir.
 */
export function useAktifDuyuru() {
  const onbellek = duyuruCache.oku();
  const query = useQuery({
    queryKey: AKTIF_KEY,
    queryFn: fetchAktifDuyuru,
    staleTime: 60_000,
    retry: false,
    meta: { silentError: true },
    placeholderData: onbellek,
  });

  useEffect(() => {
    // Yalnız GERÇEK yanıt yazılır — `isPlaceholderData` iyimser tahminin
    // ta kendisini geri yazıp hiçbir şey kanıtlamayan bir döngü kurardı.
    if (query.isSuccess && !query.isPlaceholderData) {
      duyuruCache.yaz(query.data ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isSuccess, query.isPlaceholderData, query.data]);

  return query;
}

export function useDuyuruSeridiList() {
  return useQuery({ queryKey: LISTE_KEY, queryFn: fetchDuyuruSeridiList });
}

function useInvalidateDuyuru() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: LISTE_KEY });
    qc.invalidateQueries({ queryKey: AKTIF_KEY });
  };
}

export function useCreateDuyuruSeridi() {
  const invalidate = useInvalidateDuyuru();
  return useMutation({
    mutationFn: (payload: DuyuruSeridiCreate) => createDuyuruSeridi(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateDuyuruSeridi() {
  const invalidate = useInvalidateDuyuru();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: DuyuruSeridiUpdate }) =>
      updateDuyuruSeridi(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteDuyuruSeridi() {
  const invalidate = useInvalidateDuyuru();
  return useMutation({
    mutationFn: (id: number) => deleteDuyuruSeridi(id),
    onSuccess: invalidate,
  });
}
