import { create } from "zustand";

export type TransferStatus =
  | "pending-accept" // alıcı: gelen dosya onayı bekleniyor
  | "connecting" // bağlantı kuruluyor (offer/answer/ICE)
  | "transferring" // veri akıyor
  | "done"
  | "rejected"
  | "cancelled"
  | "error";

export interface TransferInfo {
  transferId: string;
  direction: "send" | "receive";
  fileName: string;
  fileSize: number;
  fileType: string;
  transferred: number; // aktarılan bayt
  status: TransferStatus;
  downloadUrl?: string; // alıcıda tamamlanınca object URL
  error?: string;
}

interface RtcState {
  active: TransferInfo | null;
  setActive: (info: TransferInfo | null) => void;
  patchActive: (patch: Partial<TransferInfo>) => void;
  clear: () => void;
}

// P2P (WebRTC) dosya aktarımının UI durumu. Asıl WebRTC mantığı lib/rtcTransfer.ts'te.
// Aynı anda tek aktif aktarım tutulur (gönderme ya da alma).
export const useRtcStore = create<RtcState>((set) => ({
  active: null,
  setActive: (info) => set({ active: info }),
  patchActive: (patch) =>
    set((s) => (s.active ? { active: { ...s.active, ...patch } } : s)),
  clear: () => set({ active: null }),
}));
