import { apiClient } from "@/api/axios";
import type {
  LessonQuestionGroup,
  QAStatus,
  QAThreadCreate,
  QAThreadOut,
} from "@/types";

export async function askQuestion(
  payload: QAThreadCreate
): Promise<QAThreadOut> {
  const { data } = await apiClient.post<QAThreadOut>("/qa", payload);
  return data;
}

export async function postQaMessage(
  threadId: number,
  body: string
): Promise<QAThreadOut> {
  const { data } = await apiClient.post<QAThreadOut>(
    `/qa/${threadId}/messages`,
    { body }
  );
  return data;
}

export interface ListThreadsParams {
  status?: QAStatus;
  limit?: number;
  offset?: number;
}

export async function listThreads(
  params: ListThreadsParams
): Promise<QAThreadOut[]> {
  const { data } = await apiClient.get<QAThreadOut[]>("/qa", { params });
  return data;
}

export async function fetchQaRights(): Promise<LessonQuestionGroup[]> {
  const { data } = await apiClient.get<LessonQuestionGroup[]>("/qa/rights");
  return data;
}
