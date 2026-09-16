import { create } from "zustand";

import { toast } from "@/store/toastStore";

/**
 * Kullanıcının tarayıcıdan alınan konumu — "yakınımda" aramasının referansı.
 *
 * ## `persist` YOK, bilerek
 *
 * Koordinat ne adrese ne diske yazılır. Adres yalnız NİYETİ taşır
 * (`?yakinimda=1&yaricap=25`); paylaşılan bir arama bağlantısı kullanıcının
 * bulunduğu yeri 5 haneli hassasiyetle taşımamalı. Bağlantıyı açan kişi için
 * konum yeniden istenir. Aynı gerekçe `lib/yerArama`nın URL'de ham koordinat
 * değil mahalle ADI taşıma kararında da var.
 *
 * ## Neden store, neden yerel state değil
 *
 * Konumu YAZAN yer filtre modalı, OKUYAN yer iki ayrı arama sayfası
 * (`Marketplace`, `PublicMarketplace`). Modal ortak bileşene çıkınca yerel
 * state ile paylaşılamaz hâle geldi.
 */
export interface Koordinat {
  lat: number;
  lng: number;
}

interface KonumDurumu {
  konum: Koordinat | null;
  yukleniyor: boolean;
  /** Tarayıcıdan konum ister. `basarisiz` izin reddinde çağrılır. */
  iste: (basarisiz?: () => void) => void;
  unut: () => void;
}

export const useKonumStore = create<KonumDurumu>((set) => ({
  konum: null,
  yukleniyor: false,

  iste: (basarisiz) => {
    if (!navigator.geolocation) {
      toast.error("Tarayıcınız konum servisini desteklemiyor.");
      basarisiz?.();
      return;
    }
    set({ yukleniyor: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({
          konum: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          yukleniyor: false,
        });
      },
      () => {
        toast.error("Konum alınamadı. Lütfen izin verin.");
        set({ yukleniyor: false });
        // Niyet adreste asılı kalmasın: izin verilmediyse "yakınımda"
        // filtresi açıkmış gibi görünmemeli.
        basarisiz?.();
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  },

  unut: () => set({ konum: null }),
}));

/**
 * "Yakınımda" SEÇİLDİĞİ AN konum izni istenir (kullanıcı kararı, 16 Eyl
 * 2026: "aramayı yapıp konum bilgisi yok demek saçmalık"). Sonuç sayfasına
 * gidildikten sonra değil, hapta/adımda seçim yapılır yapılmaz tarayıcı
 * sorar. Konum zaten bellekteyse sormaz. İzin verilmezse `geriAl` seçimi
 * düşürür; store zaten kullanıcıya uyarı gösterir. Sonuç sayfasındaki
 * `useYakinimdaKonum` yalnız paylaşılan bağlantılar için yedek kalır.
 */
export function yakinimdaSecildi(geriAl: () => void) {
  const { konum, yukleniyor, iste } = useKonumStore.getState();
  if (konum || yukleniyor) return;
  iste(geriAl);
}
