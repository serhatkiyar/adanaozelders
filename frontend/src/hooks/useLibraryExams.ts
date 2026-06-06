import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  attendRegistration,
  bulkUploadDocuments,
  cancelRegistration,
  cancelSession,
  createOperator,
  createSession,
  deleteOperator,
  fetchManageSessions,
  fetchMyRegistrations,
  fetchOperatorMe,
  fetchOperators,
  fetchPublicSessions,
  fetchRoster,
  payRegistration,
  publishResults,
  registerForSession,
  setResultSummary,
  updateSession,
  uploadResultDocument,
  uploadSessionAnswerKey,
  verifyAttendance,
} from "@/api/libraryExams";
import type { ExamSessionWrite, OperatorCreate, ResultSummaryIn } from "@/types";

/* ── Public / öğrenci ── */

export function usePublicSessions(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["exam-sessions", "public", libraryId],
    queryFn: () => fetchPublicSessions(libraryId!),
    enabled: Number.isFinite(libraryId) && (libraryId ?? 0) > 0,
  });
}

export function useMyRegistrations() {
  return useQuery({
    queryKey: ["exam-registrations", "mine"],
    queryFn: fetchMyRegistrations,
  });
}

export function useRegisterForSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) => registerForSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-sessions"] });
      qc.invalidateQueries({ queryKey: ["exam-registrations"] });
    },
  });
}

export function usePayRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: number) => payRegistration(registrationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-sessions"] });
      qc.invalidateQueries({ queryKey: ["exam-registrations"] });
    },
  });
}

export function useCancelRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: number) => cancelRegistration(registrationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-sessions"] });
      qc.invalidateQueries({ queryKey: ["exam-registrations"] });
    },
  });
}

/* ── Yönetim (admin / operatör) ── */

export function useManageSessions(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["exam-sessions", "manage", libraryId],
    queryFn: () => fetchManageSessions(libraryId!),
    enabled: Number.isFinite(libraryId) && (libraryId ?? 0) > 0,
  });
}

export function useCreateSession(libraryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ExamSessionWrite) => createSession(libraryId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-sessions"] }),
  });
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ExamSessionWrite> }) =>
      updateSession(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-sessions"] }),
  });
}

export function useCancelSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: number) => cancelSession(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-sessions"] }),
  });
}

export function useRoster(sessionId: number | undefined) {
  return useQuery({
    queryKey: ["exam-roster", sessionId],
    queryFn: () => fetchRoster(sessionId!),
    enabled: Number.isFinite(sessionId) && (sessionId ?? 0) > 0,
  });
}

/* ── Sonuç girişi + yayınlama (admin / operatör) ── */

function useResultInvalidator() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["exam-roster"] });
    qc.invalidateQueries({ queryKey: ["exam-sessions"] });
  };
}

export function useSetResultSummary(sessionId: number) {
  const invalidate = useResultInvalidator();
  return useMutation({
    mutationFn: ({
      registrationId,
      payload,
    }: {
      registrationId: number;
      payload: ResultSummaryIn;
    }) => setResultSummary(sessionId, registrationId, payload),
    onSuccess: invalidate,
  });
}

export function useBulkUploadDocuments(sessionId: number) {
  const invalidate = useResultInvalidator();
  return useMutation({
    mutationFn: (files: File[]) => bulkUploadDocuments(sessionId, files),
    onSuccess: invalidate,
  });
}

export function useUploadResultDocument(sessionId: number) {
  const invalidate = useResultInvalidator();
  return useMutation({
    mutationFn: ({ registrationId, file }: { registrationId: number; file: File }) =>
      uploadResultDocument(sessionId, registrationId, file),
    onSuccess: invalidate,
  });
}

export function usePublishResults(sessionId: number) {
  const invalidate = useResultInvalidator();
  return useMutation({
    mutationFn: () => publishResults(sessionId),
    onSuccess: invalidate,
  });
}

export function useUploadSessionAnswerKey(sessionId: number) {
  const invalidate = useResultInvalidator();
  return useMutation({
    mutationFn: (file: File) => uploadSessionAnswerKey(sessionId, file),
    onSuccess: invalidate,
  });
}

/* ── Operatör ── */

export function useVerifyAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: string) => verifyAttendance(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exam-roster"] }),
  });
}

/** Operatör: katılımcı listesinden seçip doğrula (QR/kod olmadan). */
export function useAttendRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: number) => attendRegistration(registrationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exam-roster"] });
      qc.invalidateQueries({ queryKey: ["exam-sessions"] });
    },
  });
}

export function useOperatorMe() {
  return useQuery({
    queryKey: ["operator", "me"],
    queryFn: fetchOperatorMe,
  });
}

/* ── Operatör hesapları (admin) ── */

export function useOperators(libraryId: number | undefined) {
  return useQuery({
    queryKey: ["operators", libraryId],
    queryFn: () => fetchOperators(libraryId!),
    enabled: Number.isFinite(libraryId) && (libraryId ?? 0) > 0,
  });
}

export function useCreateOperator(libraryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OperatorCreate) => createOperator(libraryId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operators", libraryId] }),
  });
}

export function useDeleteOperator(libraryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (operatorId: number) => deleteOperator(operatorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operators", libraryId] }),
  });
}
