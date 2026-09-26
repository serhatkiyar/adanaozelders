import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptBooking,
  cancelBooking,
  completeBooking,
  confirmBooking,
  reportBookingIssue,
  createBooking,
  fetchBooking,
  getCanliDersBileti,
  setTahtaDurumu,
  listBookings,
  rejectBooking,
  rescheduleBooking,
  tutorRescheduleBooking,
  acceptTutorReschedule,
  declineTutorReschedule,
  remindConfirm,
  setBookingLocation,
  addBookingResource,
  deleteBookingResource,
  uploadBookingResource,
  addBookingComment,
  deleteBookingComment,
  addBookingPrivateNote,
  deleteBookingPrivateNote,
  type ListBookingsParams,
} from "@/api/bookings";
import { agoraBiletiniCevir } from "@/components/canli/video/agora/bilet";
import type { NotrBilet } from "@/components/canli/video/tipler";
import { zoomBiletiniCevir } from "@/components/canli/video/zoom/bilet";
import {
  BookingStatus,
  type BookingCreate,
  type BookingIssueReason,
  type BookingOut,
  type CanliDersBiletiOut,
} from "@/types";
import { TUTOR_DASHBOARD_KEY } from "@/hooks/useTutorDashboard";
import { tutorSlotsKey } from "@/hooks/useTutorSlots";

/**
 * Optimistic durum güncellemesini ["bookings"] ön ekiyle eşleşen TÜM cache'lere
 * uygular. Bu cache'ler iki şekilde olabilir: liste sorguları (BookingOut[]) ve
 * tekil detay sorgusu ["bookings","detail",id] (BookingOut). Tek nesnede `.map`
 * olmadığı için ayrımı burada yaparız — aksi halde updater TypeError fırlatıp
 * onMutate'i (dolayısıyla tüm mutation'ı) patlatır.
 */
function patchBookingCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  id: number,
  status: BookingStatus
) {
  queryClient.setQueriesData<BookingOut[] | BookingOut>(
    { queryKey: ["bookings"] },
    (old) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.map((b) => (b.id === id ? { ...b, status } : b));
      }
      return old.id === id ? { ...old, status } : old;
    }
  );
}

export function useBookings(
  params: ListBookingsParams,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: ["bookings", params],
    queryFn: () => listBookings(params),
    enabled: options.enabled ?? true,
  });
}

export function useSetBookingLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, location, lat, lng }: { id: number; location: string; lat: number | null; lng: number | null }) =>
      setBookingLocation(id, location, lat, lng),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

/** Tahtayı aç/kapa (yalnız eğitmen). Durum kanal üzerinden iki tarafa yayılır. */
export function useTahtaDurumu(id: number) {
  return useMutation({
    mutationFn: (acik: boolean) => setTahtaDurumu(id, acik),
  });
}

export function useBooking(id: number) {
  return useQuery({
    queryKey: ["bookings", "detail", id],
    queryFn: () => fetchBooking(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

/** Sunucu bileti → nötr bilet; sağlayıcının alanı boşsa hata (sorgu hatası olur). */
function notrBilet(b: CanliDersBiletiOut): NotrBilet {
  if (b.saglayici === "agora") {
    if (!b.agora) throw new Error("Agora bileti boş");
    return agoraBiletiniCevir(b.agora);
  }
  if (!b.zoom) throw new Error("Zoom bileti boş");
  return zoomBiletiniCevir(b.zoom);
}

/**
 * Canlı dersin giriş bileti — sayfa açılışında BİR KEZ alınır; sağlayıcıdan
 * bağımsız biçimde (`NotrBilet`) döner. Sağlayıcı adı sunucunun biletinden
 * gelir (`/canli-ders-bileti` → `saglayici`), URL'den değil. Yenileme
 * (`refetch`) aynı uçtan; pencere dışı 409 = ders bitti.
 *
 * Anahtar bilerek `["bookings", …]` altında DEĞİL: kökteki WS dinleyicisi her
 * `BOOKING_UPDATE`/yorumda `["bookings"]` önekini geçersiz kılar; bilet onun
 * altında olsaydı ders ortasında yeniden istenir, pencere kapanmışsa 409'la
 * sayfa hata ekranına düşüp görüşmeyi koparırdı. Aynı nedenle odak/yeniden
 * bağlanma tazelemesi ve yeniden deneme kapalı; bilet tek kullanımlıktır.
 */
export function useCanliDersBileti(id: number) {
  return useQuery({
    queryKey: ["canli-ders-bileti", id],
    queryFn: () => getCanliDersBileti(id),
    select: notrBilet,
    enabled: Number.isFinite(id) && id > 0,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Hata sayfanın kendi ekranında anlatılır; genel "Veriler yüklenemedi"
    // bildirimi üstüne binmesin.
    meta: { silentError: true },
  });
}

/**
 * Seçilen saat bu arada başkası tarafından alındı mı? Sunucunun GiST çakışması
 * (`core/exceptions.py`) 409 + "time slot conflicts" döner. Aynı kodu taşıyan
 * "ücretsiz ders hakkı kullanılmış" 409'u bu değildir; o sunucu metniyle gösterilir.
 */
export function isSlotConflictError(error: unknown): boolean {
  const res = (error as { response?: { status?: number; data?: { detail?: unknown } } })
    ?.response;
  return (
    res?.status === 409 &&
    typeof res.data?.detail === "string" &&
    /time slot conflicts/i.test(res.data.detail)
  );
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BookingCreate) => createBooking(payload),
    onSuccess: (_booking, payload) => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: tutorSlotsKey(payload.tutor_id) });
    },
    onError: (error, payload) => {
      // Saat az önce doldu: güncel slotları yeniden iste.
      if (isSlotConflictError(error)) {
        queryClient.invalidateQueries({ queryKey: tutorSlotsKey(payload.tutor_id) });
      }
    },
  });
}

function dersVerisiniYenile(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["bookings"] });
  queryClient.invalidateQueries({ queryKey: TUTOR_DASHBOARD_KEY });
}

/** Öğrenci "ders gerçekleşti" der; ücret eğitmene geçer. */
export function useConfirmBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => confirmBooking(id),
    onSettled: () => dersVerisiniYenile(queryClient),
  });
}

/** Öğrenci ders sonrası sorun bildirir; ücret incelemeye kadar bekler. */
export function useReportBookingIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, note }: { id: number; reason: BookingIssueReason; note?: string }) =>
      reportBookingIssue(id, reason, note),
    onSettled: () => dersVerisiniYenile(queryClient),
  });
}

// İptal ayrı: neden (reason) taşır + karşı tarafa bildirim backend'de tetiklenir.
export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      cancelBooking(id, reason),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["bookings"] });
      const snapshots = queryClient.getQueriesData<BookingOut[] | BookingOut>({
        queryKey: ["bookings"],
      });
      patchBookingCaches(queryClient, id, BookingStatus.CANCELLED);
      return { snapshots };
    },
    onError: (_err, _vars, ctx) =>
      ctx?.snapshots.forEach(([key, data]) =>
        queryClient.setQueryData(key, data)
      ),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: TUTOR_DASHBOARD_KEY });
    },
  });
}

// İptal ayrı ele alınır (useCancelBooking, neden + bildirim). Burada yer almaz.
export function useRescheduleBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      startAt,
      endAt,
    }: {
      id: number;
      startAt: string;
      endAt: string;
    }) => rescheduleBooking(id, startAt, endAt),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });
}

/**
 * Öğretmen ertelemesi ve yanıtı, "Onaylamayı hatırlat" (24 Eyl 2026). Hepsi
 * aynı dersi değiştirir: ders listeleri ve öğretmen panosu tazelenir.
 */
function useDersIslemi<TVars>(fn: (v: TVars) => Promise<BookingOut>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: TUTOR_DASHBOARD_KEY });
    },
  });
}

export const useTutorReschedule = () =>
  useDersIslemi(({ id, startAt }: { id: number; startAt: string }) =>
    tutorRescheduleBooking(id, startAt)
  );
export const useAcceptTutorReschedule = () => useDersIslemi((id: number) => acceptTutorReschedule(id));
export const useDeclineTutorReschedule = () => useDersIslemi((id: number) => declineTutorReschedule(id));
export const useRemindConfirm = () => useDersIslemi((id: number) => remindConfirm(id));

export type BookingActionType = "accept" | "reject" | "complete";

const ACTION_FN: Record<
  BookingActionType,
  (id: number) => Promise<BookingOut>
> = {
  accept: acceptBooking,
  reject: rejectBooking,
  complete: completeBooking,
};

const ACTION_TARGET: Record<BookingActionType, BookingStatus> = {
  accept: BookingStatus.ACCEPTED,
  reject: BookingStatus.REJECTED,
  complete: BookingStatus.COMPLETED,
};

// Optimistic: tüm ["bookings", ...] cache'lerinde booking status'unu anında günceller,
// hata olursa geri alır, her durumda yeniden doğrular.
export function useBookingAction(action: BookingActionType) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => ACTION_FN[action](id),
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["bookings"] });
      const snapshots = queryClient.getQueriesData<BookingOut[] | BookingOut>({
        queryKey: ["bookings"],
      });
      patchBookingCaches(queryClient, id, ACTION_TARGET[action]);
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, data]) =>
        queryClient.setQueryData(key, data)
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: TUTOR_DASHBOARD_KEY });
    },
  });
}

export function useAddBookingResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title, url }: { id: number; title: string; url: string }) =>
      addBookingResource(id, title, url),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["bookings", "detail", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useDeleteBookingResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resourceId }: { id: number; resourceId: number }) =>
      deleteBookingResource(id, resourceId),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["bookings", "detail", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useUploadBookingResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      uploadBookingResource(id, file),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["bookings", "detail", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useAddBookingComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      addBookingComment(id, body),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["bookings", "detail", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useDeleteBookingComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, commentId }: { id: number; commentId: number }) =>
      deleteBookingComment(id, commentId),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["bookings", "detail", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useAddBookingPrivateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      addBookingPrivateNote(id, body),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["bookings", "detail", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useDeleteBookingPrivateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, noteId }: { id: number; noteId: number }) =>
      deleteBookingPrivateNote(id, noteId),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["bookings", "detail", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}
