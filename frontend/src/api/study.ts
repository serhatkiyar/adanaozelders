import { apiClient } from "@/api/axios";
import type {
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
