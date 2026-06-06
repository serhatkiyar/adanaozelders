import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCatalog,
  deleteCatalog,
  listCatalogs,
  listUsableCatalogs,
  updateCatalog,
  uploadCatalogAnswerKey,
} from "@/api/examCatalogs";
import type { CatalogWrite } from "@/types";

/** Admin küratör listesi (gizli/özel dahil). */
export function useCatalogs(enabled = true) {
  return useQuery({
    queryKey: ["exam-catalogs"],
    queryFn: listCatalogs,
    enabled,
  });
}

/** Oturum açarken seçilebilecek public kataloglar (admin + operatör). */
export function useUsableCatalogs(enabled = true) {
  return useQuery({
    queryKey: ["exam-catalogs", "usable"],
    queryFn: listUsableCatalogs,
    enabled,
  });
}

export function useCreateCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CatalogWrite) => createCatalog(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-catalogs"] }),
  });
}

export function useUpdateCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CatalogWrite> }) =>
      updateCatalog(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-catalogs"] }),
  });
}

export function useDeleteCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCatalog(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-catalogs"] }),
  });
}

export function useUploadCatalogAnswerKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      uploadCatalogAnswerKey(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-catalogs"] }),
  });
}
