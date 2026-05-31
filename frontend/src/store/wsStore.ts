import { create } from "zustand";

interface WsState {
  socket: WebSocket | null;
  isConnected: boolean;
  connect: (token: string) => void;
  disconnect: () => void;
}

// Modül-seviyesi reconnect durumu (store dışında; render tetiklemez).
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentToken: string | null = null;
let intentionalClose = false;
let attempts = 0;

function wsBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL
    ? import.meta.env.VITE_API_BASE_URL.replace(/^http/, "ws")
    : "ws://localhost:8000/api/v1";
}

export const useWsStore = create<WsState>((set, get) => ({
  socket: null,
  isConnected: false,

  connect: (token: string) => {
    // Token (sessiz refresh'te) değişse bile yeniden bağlanmada güncel token kullanılsın.
    currentToken = token;
    intentionalClose = false;

    const existing = get().socket;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN ||
        existing.readyState === WebSocket.CONNECTING)
    ) {
      return; // Zaten bağlı/bağlanıyor.
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const ws = new WebSocket(`${wsBaseUrl()}/ws?token=${token}`);

    ws.onopen = () => {
      attempts = 0;
      set({ isConnected: true });
    };

    ws.onclose = () => {
      set({ socket: null, isConnected: false });
      // Beklenmedik kopma + hâlâ oturum açık → üstel geri çekilmeyle yeniden bağlan.
      if (!intentionalClose && currentToken) {
        const delay = Math.min(30000, 1000 * 2 ** attempts);
        attempts += 1;
        reconnectTimer = setTimeout(() => {
          if (currentToken && !get().socket) get().connect(currentToken);
        }, delay);
      }
    };

    ws.onerror = () => {
      // Hata sonrası kapanmayı tetikle; reconnect onclose'da ele alınır.
      try {
        ws.close();
      } catch {
        /* yoksay */
      }
    };

    set({ socket: ws });
  },

  disconnect: () => {
    intentionalClose = true;
    currentToken = null;
    attempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const { socket } = get();
    if (socket) socket.close();
    set({ socket: null, isConnected: false });
  },
}));
