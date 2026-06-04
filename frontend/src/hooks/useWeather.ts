import { useQuery } from "@tanstack/react-query";
import { weatherKind, type WeatherKind } from "@/lib/navbarWidget";

export interface WeatherNow {
  temperature: number;
  kind: WeatherKind;
}

// Open-Meteo anlık hava durumu (ücretsiz, anahtar gerektirmez). Backend'i
// ilgilendirmeyen üçüncü-parti veri olduğu için apiClient yerine doğrudan
// fetch kullanılır; yine de React Query ile cache'lenir ve periyodik yenilenir.
export function useWeather(lat: number, lng: number, enabled: boolean) {
  return useQuery({
    queryKey: ["weather", lat, lng],
    enabled,
    staleTime: 10 * 60 * 1000, // 10 dk
    refetchInterval: 15 * 60 * 1000, // 15 dk'da bir tazele
    queryFn: async (): Promise<WeatherNow> => {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}` +
        `&longitude=${lng}&current=temperature_2m,weather_code`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Hava durumu alınamadı");
      const data = await res.json();
      return {
        temperature: Math.round(data.current.temperature_2m),
        kind: weatherKind(data.current.weather_code),
      };
    },
  });
}
