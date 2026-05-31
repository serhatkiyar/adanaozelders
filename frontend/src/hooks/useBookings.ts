import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptBooking,
  cancelBooking,
  completeBooking,
  createBooking,
  fetchBooking,
  listBookings,
  rejectBooking,
  rescheduleBooking,
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
import { BookingStatus, type BookingCreate, type BookingOut } from "@/types";

export function useBookings(params: ListBookingsParams) {
  return useQuery({
    queryKey: ["bookings", params],
    queryFn: () => listBookings(params),
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

export function useBooking(id: number) {
  return useQuery({
    queryKey: ["bookings", "detail", id],
    queryFn: () => fetchBooking(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useCreateBooking() {
  return useMutation({
    mutationFn: (payload: BookingCreate) => createBooking(payload),
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
      const snapshots = queryClient.getQueriesData<BookingOut[]>({
        queryKey: ["bookings"],
      });
      queryClient.setQueriesData<BookingOut[]>(
        { queryKey: ["bookings"] },
        (old) =>
          old?.map((b) =>
            b.id === id ? { ...b, status: BookingStatus.CANCELLED } : b
          )
      );
      return { snapshots };
    },
    onError: (_err, _vars, ctx) =>
      ctx?.snapshots.forEach(([key, data]) =>
        queryClient.setQueryData(key, data)
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
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
      const snapshots = queryClient.getQueriesData<BookingOut[]>({
        queryKey: ["bookings"],
      });
      queryClient.setQueriesData<BookingOut[]>(
        { queryKey: ["bookings"] },
        (old) =>
          old?.map((b) =>
            b.id === id ? { ...b, status: ACTION_TARGET[action] } : b
          )
      );
      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      ctx?.snapshots.forEach(([key, data]) =>
        queryClient.setQueryData(key, data)
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
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
