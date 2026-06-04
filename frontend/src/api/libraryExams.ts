import { apiClient } from "@/api/axios";
import type {
  AttendanceResult,
  ExamSessionOut,
  ExamSessionWrite,
  OperatorCreate,
  OperatorOut,
  PayResult,
  RegistrationOut,
  RosterEntry,
} from "@/types";

/* ── Public: bir kütüphanenin yaklaşan oturumları ── */

export async function fetchPublicSessions(
  libraryId: number
): Promise<ExamSessionOut[]> {
  const { data } = await apiClient.get<ExamSessionOut[]>("/exam-sessions", {
    params: { library_id: libraryId },
  });
  return data;
}

/* ── Yönetim (admin / operatör) ── */

export async function fetchManageSessions(
  libraryId: number
): Promise<ExamSessionOut[]> {
  const { data } = await apiClient.get<ExamSessionOut[]>("/exam-sessions/manage", {
    params: { library_id: libraryId },
  });
  return data;
}

export async function createSession(
  libraryId: number,
  payload: ExamSessionWrite
): Promise<ExamSessionOut> {
  const { data } = await apiClient.post<ExamSessionOut>("/exam-sessions", payload, {
    params: { library_id: libraryId },
  });
  return data;
}

export async function updateSession(
  sessionId: number,
  payload: Partial<ExamSessionWrite>
): Promise<ExamSessionOut> {
  const { data } = await apiClient.patch<ExamSessionOut>(
    `/exam-sessions/${sessionId}`,
    payload
  );
  return data;
}

export async function cancelSession(sessionId: number): Promise<ExamSessionOut> {
  const { data } = await apiClient.post<ExamSessionOut>(
    `/exam-sessions/${sessionId}/cancel`
  );
  return data;
}

export async function fetchRoster(sessionId: number): Promise<RosterEntry[]> {
  const { data } = await apiClient.get<RosterEntry[]>(
    `/exam-sessions/${sessionId}/roster`
  );
  return data;
}

/* ── Öğrenci: kayıt + ödeme + biletlerim ── */

export async function registerForSession(
  sessionId: number
): Promise<RegistrationOut> {
  const { data } = await apiClient.post<RegistrationOut>("/exam-registrations", {
    session_id: sessionId,
  });
  return data;
}

export async function payRegistration(registrationId: number): Promise<PayResult> {
  const { data } = await apiClient.post<PayResult>(
    `/exam-registrations/${registrationId}/pay`
  );
  return data;
}

export async function cancelRegistration(registrationId: number): Promise<void> {
  await apiClient.post(`/exam-registrations/${registrationId}/cancel`);
}

export async function fetchMyRegistrations(): Promise<RegistrationOut[]> {
  const { data } = await apiClient.get<RegistrationOut[]>("/exam-registrations/mine");
  return data;
}

/* ── Operatör: QR doğrulama ── */

export async function verifyAttendance(payload: string): Promise<AttendanceResult> {
  const { data } = await apiClient.post<AttendanceResult>("/exam-attendance/verify", {
    payload,
  });
  return data;
}

/* ── Operatör hesapları (admin) ── */

export async function fetchOperators(libraryId: number): Promise<OperatorOut[]> {
  const { data } = await apiClient.get<OperatorOut[]>(
    `/libraries/${libraryId}/operators`
  );
  return data;
}

export async function createOperator(
  libraryId: number,
  payload: OperatorCreate
): Promise<OperatorOut> {
  const { data } = await apiClient.post<OperatorOut>(
    `/libraries/${libraryId}/operators`,
    payload
  );
  return data;
}

export async function deleteOperator(operatorId: number): Promise<void> {
  await apiClient.delete(`/library-operators/${operatorId}`);
}

export async function fetchOperatorMe(): Promise<OperatorOut> {
  const { data } = await apiClient.get<OperatorOut>("/library-operators/me");
  return data;
}
