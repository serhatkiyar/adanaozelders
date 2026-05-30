import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MeetingState {
  roomName: string | null;
  tutorName: string | null;
  clientName: string | null;
  isMinimized: boolean;
  joinMeeting: (roomName: string, tutorName: string, clientName: string) => void;
  leaveMeeting: () => void;
  toggleMinimize: () => void;
}

// persist: küçültülmüş (minimize) bir canlı ders, sayfa gezintisi/yenilemesinde
// kaybolmasın diye localStorage'da tutulur.
export const useMeetingStore = create<MeetingState>()(
  persist(
    (set) => ({
      roomName: null,
      tutorName: null,
      clientName: null,
      isMinimized: false,
      joinMeeting: (roomName, tutorName, clientName) =>
        set({ roomName, tutorName, clientName, isMinimized: false }),
      leaveMeeting: () =>
        set({ roomName: null, tutorName: null, clientName: null, isMinimized: false }),
      toggleMinimize: () => set((state) => ({ isMinimized: !state.isMinimized })),
    }),
    { name: "ceyhan-meeting" }
  )
);
