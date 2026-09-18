import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createExtra, deleteExtra, listExtra } from "@/api/ekAralik";
import type { TimeOffRange } from "@/types";

export const EK_ARALIK_KEY = ["extra-availability"] as const;

/** Verilen penceredeki ek aralıklar. `range` yoksa sorgu çalışmaz. */
export function useEkAraliklar(range: { start: string; end: string } | null) {
  return useQuery({
    queryKey: [...EK_ARALIK_KEY, range?.start, range?.end],
    queryFn: () => listExtra(range!.start, range!.end),
    enabled: range !== null,
  });
}

export function useCreateEkAralik() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (range: TimeOffRange) => createExtra(range),
    onSettled: () => qc.invalidateQueries({ queryKey: EK_ARALIK_KEY }),
  });
}

export function useDeleteEkAralik() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteExtra(id),
    onSettled: () => qc.invalidateQueries({ queryKey: EK_ARALIK_KEY }),
  });
}
