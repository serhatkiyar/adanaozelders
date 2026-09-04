import { apiClient } from "@/api/axios";

/**
 * Ders kataloğu — tek kaynak sunucudur.
 *
 * Bu dosya, birbirinden sessizce ayrışmış iki TypeScript sabitinin
 * (`lib/examTree.ts` + `lib/dersTaksonomisi.ts`) yerine geçer. Ölçülmüştü:
 * arama listesindeki 85+ kalemin arkasında hiçbir eğitmen yoktu (garantili
 * sıfır sonuç), ters yönde 5 kalem seçilebiliyor ama aranamıyordu.
 */

/** Ders grubu kodları — sunucudaki `SUBJECT_GROUPS` ile aynı sözlük. */
export type DersGrubu =
  | "OKUL"
  | "SINAV"
  | "DIL"
  | "BILISIM"
  | "MUZIK"
  | "SANAT"
  | "SPOR"
  | "KOCLUK";

export const GRUP_ADI: Record<DersGrubu, string> = {
  OKUL: "Okul ve akademik",
  SINAV: "Sınav hazırlık",
  DIL: "Yabancı diller",
  BILISIM: "Bilişim ve yazılım",
  MUZIK: "Müzik",
  SANAT: "Sanat",
  SPOR: "Spor",
  KOCLUK: "Koçluk ve kişisel gelişim",
};

/** Grupların gösterim sırası — okul/sınav önce, niş alanlar sonra. */
export const GRUP_SIRASI: DersGrubu[] = [
  "OKUL",
  "SINAV",
  "DIL",
  "BILISIM",
  "MUZIK",
  "SANAT",
  "SPOR",
  "KOCLUK",
];

export interface Ders {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  group_code: DersGrubu;
  sort_order: number;
  /** Bu derste geçerli seviye merdivenleri (OKUL / CEFR / SANAT / KONSERVATUVAR). */
  scales: string[];
  /** Arama eşanlamlıları (normalize edilmiş): "matemetik", "tyt matematik"… */
  aliases: string[];
  /** Bu dersi bildiren yayındaki eğitmen sayısı (öneri sıralaması için). */
  tutor_count: number;
}

export interface Seviye {
  id: number;
  scale_code: string;
  code: string;
  name: string;
  sort_order: number;
}

export interface SeviyeMerdiveni {
  code: string;
  name: string;
  sort_order: number;
  levels: Seviye[];
}

/**
 * `kapsam` iki yüzeyi ayırır ve kuralları bilerek zıttır:
 * - `vitrin`: öğrenciye gösterilen küratörlü liste (arkasında eğitmen olmayan
 *   ders gösterilmez — aratılınca sıfır sonuç verir).
 * - `secim`: eğitmenin branşını bildirirken göreceği tam katalog (kısıtlamak
 *   arzı kesmek olurdu).
 */
export type DersKapsami = "vitrin" | "secim";

export async function fetchSubjects(kapsam: DersKapsami = "vitrin"): Promise<Ders[]> {
  const { data } = await apiClient.get<Ders[]>("/subjects", { params: { kapsam } });
  return data;
}

export async function fetchLevelScales(): Promise<SeviyeMerdiveni[]> {
  const { data } = await apiClient.get<SeviyeMerdiveni[]>("/subjects/levels");
  return data;
}
