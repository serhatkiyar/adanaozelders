import { create } from "zustand";

interface WsState {
  socket: WebSocket | null;
  isConnected: boolean;
  connect: (token: string) => void;
  disconnect: () => void;
}

export const useWsStore = create<WsState>((set, get) => ({
  socket: null,
  isConnected: false,

  connect: (token: string) => {
    if (get().socket) return; // Already connected or connecting

    const wsUrl = import.meta.env.VITE_API_BASE_URL
      ? import.meta.env.VITE_API_BASE_URL.replace(/^http/, "ws")
      : "ws://localhost:8000/api/v1";

    const ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

    ws.onopen = () => {
      set({ isConnected: true });
    };

    ws.onclose = () => {
      set({ socket: null, isConnected: false });
    };

    set({ socket: ws });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.close();
      set({ socket: null, isConnected: false });
    }
  },
}));
