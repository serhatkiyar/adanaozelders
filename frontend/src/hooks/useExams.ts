import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createExam, listExams } from "@/api/exams";
import { useAuthStore } from "@/store/authStore";
import type { PracticeExamCreate } from "@/types";

export function useExams() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["exams"],
    queryFn: listExams,
    enabled: !!token,
  });
}

export function useCreateExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PracticeExamCreate) => createExam(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exams"] }),
  });
}
