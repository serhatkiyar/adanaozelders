// Navbar'da logo yerine gösterilebilen "widget"ların saf mantığı:
// geri sayım hesabı, Open-Meteo hava kodu eşlemesi ve hazır şehir listesi.
// (UI yok — bileşenler bu yardımcıları tüketir; Vitest ile test edilir.)

export type NavbarWidget = "logo" | "yks" | "lgs" | "weather" | "clock";

export interface City {
  name: string;
  lat: number;
  lng: number;
}

// Open-Meteo için hazır şehir listesi (Türkiye, başlıca iller + platform lokasyonu).
export const CITIES: City[] = [
  { name: "Adana", lat: 37.0, lng: 35.3213 },
  { name: "Ceyhan", lat: 37.0247, lng: 35.8175 },
  { name: "İstanbul", lat: 41.0082, lng: 28.9784 },
  { name: "Ankara", lat: 39.9334, lng: 32.8597 },
  { name: "İzmir", lat: 38.4237, lng: 27.1428 },
  { name: "Bursa", lat: 40.1826, lng: 29.0665 },
  { name: "Antalya", lat: 36.8969, lng: 30.7133 },
  { name: "Mersin", lat: 36.8121, lng: 34.6415 },
  { name: "Gaziantep", lat: 37.0662, lng: 37.3833 },
  { name: "Konya", lat: 37.8746, lng: 32.4932 },
  { name: "Kayseri", lat: 38.7312, lng: 35.4787 },
  { name: "Eskişehir", lat: 39.7767, lng: 30.5206 },
  { name: "Samsun", lat: 41.2867, lng: 36.33 },
  { name: "Trabzon", lat: 41.0027, lng: 39.7168 },
  { name: "Diyarbakır", lat: 37.9144, lng: 40.2306 },
];

export const DEFAULT_CITY: City = CITIES[0]; // Adana (platform lokasyonu)

// Düzenlenebilir varsayılan sınav tarihleri (kullanıcı kendi tarihini girebilir).
export const DEFAULT_YKS_DATE = "2026-06-20";
export const DEFAULT_LGS_DATE = "2026-06-07";

// Hedef tarihe kalan tam gün sayısı (yerel gün sınırına göre; saat etkilemez).
export function daysUntil(targetISO: string, now: Date = new Date()): number {
  const target = new Date(`${targetISO}T00:00:00`);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((target.getTime() - start.getTime()) / MS_PER_DAY);
}

// ── Hava durumu (Open-Meteo WMO weather_code) ──
export type WeatherKind = "clear" | "cloud" | "rain" | "snow" | "storm" | "fog";

export function weatherKind(code: number): WeatherKind {
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloud";
}

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: "Açık",
  cloud: "Bulutlu",
  rain: "Yağmurlu",
  snow: "Karlı",
  storm: "Gök gürültülü",
  fog: "Sisli",
};
