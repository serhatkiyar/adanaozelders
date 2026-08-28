/**
 * Puck bileşen prop şekilleri — backend köprüsüyle (services/
 * store_merchandising_puck.py) birebir sözleşme. `block_key` her öğede açık
 * prop olarak taşınır: sunucu boş olanları üretir ve normalize veriyi geri
 * döndürür; metrik tarihçesi bu anahtarla kesintisiz sürer.
 */

export interface PuckMedya {
  image_url: string;
  mobile_image_url?: string | null;
  alt_text?: string;
  decorative?: boolean;
  link_url?: string | null;
  label?: string;
  fit?: "cover" | "contain";
  focal_x?: number;
  focal_y?: number;
}

export interface PuckOrtak {
  block_key?: string;
  title?: string;
  description?: string;
  link_label?: string;
  link_url?: string | null;
}

export interface PuckIcerikOgesi {
  type: string;
  props: PuckOrtak & Record<string, unknown>;
}

export interface PuckVerisi {
  root: { props?: Record<string, unknown> };
  content: PuckIcerikOgesi[];
  zones: Record<string, unknown>;
}

export interface KoleksiyonSecimi {
  id: number;
  title: string;
}
