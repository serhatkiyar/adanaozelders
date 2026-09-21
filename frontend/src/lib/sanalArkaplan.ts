/**
 * Canlı derste kullanılabilen Adana temalı sanal arka planlar.
 *
 * Görseller `frontend/public/sanal-arkaplan/` altındadır ve hepsi Wikimedia
 * Commons'tan alınmış, lisansı doğrulanmış gerçek fotoğraflardır. Tam kaynak
 * listesi ve lisans metinleri: `public/sanal-arkaplan/KAYNAKLAR.md`.
 *
 * Fotoğraflar CC BY-SA lisanslıdır; bu yüzden `atif` alanı kullanıcıya
 * gösterilir ve boş bırakılamaz.
 */
export type SanalArkaplan = {
  /** Kalıcı kimlik — seçim state'inde ve testlerde kullanılır. */
  id: string;
  /** Seçicide gösterilen kısa ad. */
  ad: string;
  /** `public/` köküne göre yol. */
  gorsel: string;
  /** Lisansın gerektirdiği atıf satırı. */
  atif: string;
};

export const SANAL_ARKAPLANLAR: readonly SanalArkaplan[] = [
  {
    id: "tas-kopru",
    ad: "Taş Köprü",
    gorsel: "/sanal-arkaplan/tas-kopru.jpg",
    atif: "Taş Köprü · Carole Raddato · CC BY-SA 2.0",
  },
  {
    id: "sabanci-camii",
    ad: "Merkez Camii",
    gorsel: "/sanal-arkaplan/sabanci-camii.jpg",
    atif: "Sabancı Merkez Camii · zamansehri · CC BY-SA 4.0",
  },
  {
    id: "kopru-ve-cami",
    ad: "Köprü ve Cami",
    gorsel: "/sanal-arkaplan/kopru-ve-cami.jpg",
    atif: "Taş Köprü ve Merkez Camii · Dosseman · CC BY-SA 4.0",
  },
  {
    id: "seyhan-manzara",
    ad: "Seyhan Nehri",
    gorsel: "/sanal-arkaplan/seyhan-manzara.jpg",
    atif: "Seyhan Nehri manzarası · John Lubbock · CC BY-SA 2.0",
  },
];

/** Bulanıklaştırma yarıçapı — track-processors varsayılanı (10) biraz zayıf kalıyor. */
export const BULANIKLIK_YARICAPI = 14;
