import axios from "axios";
import { useAuthStore } from "@/store/authStore";

const baseURL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export const apiClient = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
  },
  // Refresh token `httpOnly` çerezde taşınır; çerezin isteğe eklenmesi için
  // gerekli (backend CORS'ta allow_credentials açık).
  withCredentials: true,
});

// JWT'yi her isteğe otomatik ekle.
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Aynı anda birden çok 401 olursa tek bir refresh isteği yapılır; diğerleri bekler.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    // apiClient yerine ham axios: interceptor döngüsünü ve eski Authorization'ı
    // önler. Gövde YOK — refresh token `httpOnly` çerezde gider ve JS onu
    // okuyamaz; `withCredentials` olmadan çerez de gitmez.
    const { data } = await axios.post<{ access_token: string }>(
      `${baseURL}/auth/refresh`,
      null,
      { withCredentials: true }
    );
    useAuthStore.getState().setToken(data.access_token);
    return data.access_token;
  } catch {
    return null;
  }
}

// 401 -> önce sessizce token'ı yenilemeyi dene, başarısızsa oturumu düşür.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    // Refresh token'ın varlığı JS'ten GÖRÜLEMEZ (httpOnly çerez) — denemeden
    // bilinemez. Access token'ın varlığını kapı olarak kullanıyoruz: oturum
    // hiç açılmamışsa boşuna yenileme isteği atmayalım.
    const canRetry =
      status === 401 &&
      original &&
      !original._retry &&
      !!useAuthStore.getState().token;

    if (canRetry) {
      original._retry = true;
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccess = await refreshPromise;
      if (newAccess) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newAccess}`;
        return apiClient(original); // orijinal isteği yeni token ile tekrarla
      }
    }

    if (status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);
