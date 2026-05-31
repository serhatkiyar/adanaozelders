import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchEarnings, payBooking } from "@/api/payments";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";

// Öğrenci ödemesi. Başarıda booking listeleri tazelenir (ödeme durumu güncellensin).
// Prod (3DS) için redirect_url dönerse tarayıcı oraya yönlendirilir.
export function usePayBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: number) => payBooking(bookingId),
    onSuccess: (payment) => {
      if (payment.redirect_url) {
        window.location.href = payment.redirect_url;
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

export function useEarnings() {
  const user = useAuthStore((s) => s.user);
  const enabled = user?.role_id === ROLE_IDS.TUTOR;
  return useQuery({
    queryKey: ["payments", "earnings"],
    queryFn: fetchEarnings,
    enabled,
  });
}
