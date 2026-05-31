import type { TutorSearchOut } from "@/types";

// "Son görüntülenen ilanlar" — kullanıcının baktığı eğitmen profillerini
// tarayıcıda (localStorage) tutar. Sunucu kaydı gerektirmez; anonim ya da
// giriş'li fark etmeksizin landing'de kategori çubuğunun altında gösterilir.

const KEY = "recently_viewed_tutors";
const MAX = 12;

// localStorage olayı sekmeler arası; aynı sekme içi reaktiflik için kendi
// event'imizi yayınlarız (useRecentlyViewed bunu dinler).
export const RECENTLY_VIEWED_EVENT = "recently-viewed-change";

// Karta render etmek için yeterli minimal alt küme — ağır alanları
// (availability/educations) saklamayıp localStorage'ı şişirmeyiz.
function trim(t: TutorSearchOut): TutorSearchOut {
  return {
    id: t.id,
    slug: t.slug,
    full_name: t.full_name,
    avatar_url: t.avatar_url ?? null,
    headline: t.headline ?? null,
    bio: t.bio ?? null,
    hourly_rate: t.hourly_rate ?? null,
    teaching_mode: t.teaching_mode ?? null,
    rating_count: t.rating_count ?? 0,
    rating_average: t.rating_average ?? null,
    bayesian_score: t.bayesian_score ?? 0,
    subjects: t.subjects ?? [],
  } as TutorSearchOut;
}

export function getRecentlyViewed(): TutorSearchOut[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as TutorSearchOut[]) : [];
  } catch {
    return [];
  }
}

export function recordViewedTutor(tutor: TutorSearchOut): void {
  if (!tutor || typeof tutor.id !== "number") return;
  try {
    // En son bakılan başa gelir; tekrar bakılanlar yukarı taşınır.
    const list = getRecentlyViewed().filter((t) => t.id !== tutor.id);
    list.unshift(trim(tutor));
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(RECENTLY_VIEWED_EVENT));
  } catch {
    // storage dolu/erişilemez — sessizce yok say.
  }
}
