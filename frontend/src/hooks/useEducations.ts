import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEducation,
  deleteEducation,
  fetchMyEducations,
  updateEducation,
  uploadEducationDocument,
} from "@/api/educations";
import { useAuthStore } from "@/store/authStore";
import type { EducationCreate, EducationUpdate } from "@/types";

const MY_EDUCATIONS_KEY = ["educations", "me"] as const;

export function useMyEducations(enabled = true) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: MY_EDUCATIONS_KEY,
    queryFn: fetchMyEducations,
    enabled: !!token && enabled,
  });
}

function useInvalidateEducations() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: MY_EDUCATIONS_KEY });
    // Eğitmenin herkese açık profili educations içerir → tazele.
    queryClient.invalidateQueries({ queryKey: ["tutors", "detail"] });
  };
}

export function useAddEducation() {
  const invalidate = useInvalidateEducations();
  return useMutation({
    mutationFn: (payload: EducationCreate) => createEducation(payload),
    onSuccess: invalidate,
  });
}

export function useUpdateEducation() {
  const invalidate = useInvalidateEducations();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: EducationUpdate }) =>
      updateEducation(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteEducation() {
  const invalidate = useInvalidateEducations();
  return useMutation({
    mutationFn: (id: number) => deleteEducation(id),
    onSuccess: invalidate,
  });
}

export function useUploadEducationDocument() {
  const invalidate = useInvalidateEducations();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      uploadEducationDocument(id, file),
    onSuccess: invalidate,
  });
}
