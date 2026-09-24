/**
 * "Derse katıl" yönlendirmesi: Zoom dersi tam sayfa Zoom odasına, diğerleri
 * bugünkü Jitsi akışına.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDerseKatil } from "@/hooks/useDerseKatil";
import { tamSayfaGit } from "@/lib/tamSayfaGezinme";
import { useMeetingStore } from "@/store/meetingStore";
import type { BookingOut } from "@/types";

vi.mock("@/lib/tamSayfaGezinme", () => ({ tamSayfaGit: vi.fn() }));

const ders = (ek: Partial<BookingOut>): BookingOut =>
  ({
    id: 42,
    meeting_room: "adana-42-abc",
    tutor_name: "Ayşe Hoca",
    client_name: "Mehmet",
    ...ek,
  }) as BookingOut;

describe("useDerseKatil", () => {
  beforeEach(() => {
    vi.mocked(tamSayfaGit).mockClear();
    useMeetingStore.getState().leaveMeeting();
  });

  it("zoom → /canli-ders/:id tam sayfa; açık Jitsi odası kapanır", () => {
    useMeetingStore.getState().joinMeeting(7, "eski-oda", "A", "B");
    const { result } = renderHook(() => useDerseKatil());

    result.current(ders({ canli_ders_saglayici: "zoom" }));

    expect(tamSayfaGit).toHaveBeenCalledWith("/canli-ders/42");
    expect(useMeetingStore.getState().roomName).toBeNull();
  });

  it.each(["jitsi", "livekit", null, undefined] as const)(
    "%s → bugünkü Jitsi akışı, sayfa değişmez",
    (saglayici) => {
      const { result } = renderHook(() => useDerseKatil());

      result.current(ders({ canli_ders_saglayici: saglayici }));

      expect(tamSayfaGit).not.toHaveBeenCalled();
      const s = useMeetingStore.getState();
      expect(s.bookingId).toBe(42);
      expect(s.roomName).toBe("adana-42-abc");
      expect(s.tutorName).toBe("Ayşe Hoca");
    },
  );
});
