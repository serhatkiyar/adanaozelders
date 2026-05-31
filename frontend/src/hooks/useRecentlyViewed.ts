import { useEffect, useState } from "react";
import {
  getRecentlyViewed,
  RECENTLY_VIEWED_EVENT,
} from "@/lib/recentlyViewed";
import type { TutorSearchOut } from "@/types";

// Son görüntülenen eğitmenleri reaktif okur: aynı sekmede yeni profil bakınca
// (custom event) ve diğer sekmede değişince (storage) listeyi tazeler.
export function useRecentlyViewed(): TutorSearchOut[] {
  const [items, setItems] = useState<TutorSearchOut[]>(() => getRecentlyViewed());

  useEffect(() => {
    const sync = () => setItems(getRecentlyViewed());
    window.addEventListener(RECENTLY_VIEWED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(RECENTLY_VIEWED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return items;
}
