import { apiClient } from "@/api/axios";
import type { TutorSearchOut } from "@/types";

/**
 * Kök SEO sayfaları (Modül 6) — ilan, ders ve ilçe+ders sayfası.
 *
 * Başlık, açıklama, sayılar, SSS ve JSON-LD SUNUCUDA üretilir; ön-çizilmiş
 * HTML de aynı uçtan beslenir (`backend/services/on_cizim.py`). İstemci bu
 * metinleri yeniden yazmaz — iki yerde yazılan metin zamanla ayrışır.
 */

export interface SeoBaglanti {
  ad: string;
  yol: string;
  egitmen_sayisi?: number | null;
}

export interface SeoSss {
  soru: string;
  cevap: string;
}

export interface DersIstatistik {
  egitmen_sayisi: number;
  ucretli_sayisi: number;
  en_dusuk_ucret: number | null;
  en_yuksek_ucret: number | null;
  ortalama_ucret: number | null;
  yuz_yuze_sayisi: number;
  online_sayisi: number;
  ilk_ders_ucretsiz_sayisi: number;
  yorum_sayisi: number;
  ortalama_puan: number | null;
}

export interface DersSayfasiVerisi {
  tur: "ders" | "ilce";
  yol: string;
  ders_adi: string;
  ders_slug: string;
  ilce_adi: string | null;
  ilce_slug: string | null;
  baslik: string;
  h1: string;
  aciklama: string;
  ozet: string;
  istatistik: DersIstatistik;
  egitmenler: TutorSearchOut[];
  ilceler: SeoBaglanti[];
  ilgili_dersler: SeoBaglanti[];
  sss: SeoSss[];
  kirintilar: SeoBaglanti[];
  arama_yolu: string;
  json_ld: Record<string, unknown>[];
}

export interface IlanSayfasiVerisi {
  tur: "ilan";
  yol: string;
  tutor_id: number;
  url_slug: string;
  baslik: string;
  aciklama: string;
  kirintilar: SeoBaglanti[];
  json_ld: Record<string, unknown>[];
}

export interface SeoYonlendirme {
  tur: "yonlendir";
  hedef: string;
}

export type SeoSayfa = DersSayfasiVerisi | IlanSayfasiVerisi | SeoYonlendirme;

export interface PopulerDers {
  ad: string;
  yol: string;
  egitmen_sayisi: number;
}

/** "Bu kök adres ne?" — 404 ise adres bir sayfa değil ya da şu an kapalı. */
export async function fetchSeoSayfa(yol: string): Promise<SeoSayfa> {
  const { data } = await apiClient.get<SeoSayfa>("/seo/sayfa", { params: { yol } });
  return data;
}

/** En çok öğretmeni olan dersler (ana sayfa + footer iç linkleri). */
export async function fetchPopulerDersler(limit = 8): Promise<PopulerDers[]> {
  const { data } = await apiClient.get<PopulerDers[]>("/seo/populer-dersler", {
    params: { limit },
  });
  return data;
}
