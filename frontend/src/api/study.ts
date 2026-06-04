import { apiClient } from "@/api/axios";
import type {
  AttendanceResult,
  StudyPayResult,
  StudyQuoteOut,
  StudyReservationOut,
} from "@/types";

export async function fetchStudyQuote(
  libraryId: number,
  startsAt: string,
  endsAt: string
): Promise<StudyQuoteOut> {
  const { data } = await apiClient.get<StudyQuoteOut>("/study-reservations/quote", {
    params: { library_id: libraryId, starts_at: startsAt, ends_at: endsAt },
  });
  return data;
}

export async function reserveStudy(
  libraryId: number,
  startsAt: string,
  endsAt: string
): Promise<StudyReservationOut> {
  const { data } = await apiClient.post<StudyReservationOut>("/study-reservations", {
    library_id: libraryId,
    starts_at: startsAt,
    ends_at: endsAt,
  });
  return data;
}

export async function payStudy(reservationId: number): Promise<StudyPayResult> {
  const { data } = await apiClient.post<StudyPayResult>(
    `/study-reservations/${reservationId}/pay`
  );
  return data;
}

export async function cancelStudy(reservationId: number): Promise<void> {
  await apiClient.post(`/study-reservations/${reservationId}/cancel`);
}

export async function fetchMyStudyReservations(): Promise<StudyReservationOut[]> {
  const { data } = await apiClient.get<StudyReservationOut[]>("/study-reservations/mine");
  return data;
}

export async function fetchManageStudyReservations(
  libraryId: number
): Promise<StudyReservationOut[]> {
  const { data } = await apiClient.get<StudyReservationOut[]>(
    "/study-reservations/manage",
    { params: { library_id: libraryId } }
  );
  return data;
}

/** Operatör: rezervasyon listesinden seçip girişi doğrula (QR/kod olmadan). */
export async function attendStudyReservation(
  reservationId: number
): Promise<AttendanceResult> {
  const { data } = await apiClient.post<AttendanceResult>(
    `/study-reservations/${reservationId}/attend`
  );
  return data;
}
