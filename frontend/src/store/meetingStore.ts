import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MeetingState {
  bookingId: number | null;
  roomName: string | null;
  tutorName: string | null;
  clientName: string | null;
  isMinimized: boolean;
  isDrawerOpen: boolean;
  joinMeeting: (
    bookingId: number,
    roomName: string,
    tutorName: string,
    clientName: string
  ) => void;
  leaveMeeting: () => void;
  toggleMinimize: () => void;
  toggleDrawer: () => void;
}

// persist: küçültülmüş (minimize) bir canlı ders, sayfa gezintisi/yenilemesinde
// kaybolmasın diye localStorage'da tutulur. Çekmece (sidebar) verisi bookingId
// üzerinden React Query ile yeniden çekilir.
export const useMeetingStore = create<MeetingState>()(
  persist(
    (set) => ({
      bookingId: null,
      roomName: null,
      tutorName: null,
      clientName: null,
      isMinimized: false,
      isDrawerOpen: false,
      joinMeeting: (bookingId, roomName, tutorName, clientName) =>
        set({
          bookingId,
          roomName,
          tutorName,
          clientName,
          isMinimized: false,
          isDrawerOpen: false,
        }),
      leaveMeeting: () =>
        set({
          bookingId: null,
          roomName: null,
          tutorName: null,
          clientName: null,
          isMinimized: false,
          isDrawerOpen: false,
        }),
      toggleMinimize: () => set((state) => ({ isMinimized: !state.isMinimized })),
      toggleDrawer: () => set((state) => ({ isDrawerOpen: !state.isDrawerOpen })),
    }),
    { name: "ceyhan-meeting" }
  )
);
