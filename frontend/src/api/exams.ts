import { apiClient } from "@/api/axios";
import type { PracticeExamCreate, PracticeExamOut } from "@/types";

export async function listExams(): Promise<PracticeExamOut[]> {
  const { data } = await apiClient.get<PracticeExamOut[]>("/practice-exams", {
    params: { limit: 100 },
  });
  return data;
}

export async function createExam(
  payload: PracticeExamCreate
): Promise<PracticeExamOut> {
  const { data } = await apiClient.post<PracticeExamOut>(
    "/practice-exams",
    payload
  );
  return data;
}
