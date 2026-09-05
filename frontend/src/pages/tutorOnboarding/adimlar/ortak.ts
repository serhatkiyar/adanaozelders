import type { DisDurum, Durum } from "../sozlesme";

/**
 * Her adım bileşeninin aldığı imza.
 *
 * Adımlar durumu kendileri tutmaz: kabuk tek bir `Durum` nesnesi taşır ve
 * adımlar ona yama uygular. Böylece "geri" tuşu veri kaybetmez ve kaydetme
 * kararı tek yerde kalır.
 */
export interface AdimProps {
  d: Durum;
  guncelle: (yama: Partial<Durum>) => void;
  dis: DisDurum;
  /** Masaüstünde adım açılınca ilk alana odaklan (mobilde kapalı). */
  odakla: boolean;
  /** Özet ekranının eksik bir maddeden ilgili adıma atlaması için. */
  gitAdim: (n: number) => void;
}
