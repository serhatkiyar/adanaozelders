/**
 * Ders taksonomisi — arama çubuğundaki "Hangi ders?" seçicisinin TEK kaynağı.
 *
 * Kapsam MEB haftalık ders çizelgeleri (ilkokul/ortaokul/lise) + Türkiye'deki
 * özel ders platformlarının yerleşik kategorilerinden derlendi (29 Ağu 2026):
 * okul dersleri, sınav hazırlık, yabancı diller, üniversite dersleri,
 * yazılım, müzik, sanat/hobi, spor ve kişisel gelişim.
 *
 * `q` — arama filtresine giden KANONİK değer (`/egitmenler?subject=q`).
 * Eğitmen branş bildirimi serbest metindir (tutor_subjects.subject); q'lar
 * `lib/examTree.ts` içindeki mevcut kısa adlarla uyumlu tutulur (ör. "Din",
 * "Fen") ki bugüne kadar bildirilmiş branşlar aramada bulunmaya devam etsin.
 */

export interface DersSecenegi {
  label: string;
  /** Aramaya giden kanonik değer; verilmezse label. */
  q: string;
}

export interface DersGrubu {
  grup: string;
  dersler: DersSecenegi[];
}

const d = (label: string, q: string = label): DersSecenegi => ({ label, q });

export const DERS_TAKSONOMISI: DersGrubu[] = [
  {
    grup: "Okul Dersleri",
    dersler: [
      d("Matematik"),
      d("Geometri"),
      d("Türkçe"),
      d("Türk Dili ve Edebiyatı", "Edebiyat"),
      d("Fen Bilimleri", "Fen"),
      d("Fizik"),
      d("Kimya"),
      d("Biyoloji"),
      d("Sosyal Bilgiler"),
      d("Tarih"),
      d("T.C. İnkılap Tarihi", "İnkılap"),
      d("Coğrafya"),
      d("Felsefe"),
      d("Din Kültürü", "Din"),
      d("Hayat Bilgisi"),
      d("Okuma-Yazma"),
    ],
  },
  {
    grup: "Sınav Hazırlık",
    dersler: [
      d("TYT"),
      d("AYT"),
      d("YDT"),
      d("LGS"),
      d("KPSS"),
      d("ÖABT"),
      d("DGS"),
      d("ALES"),
      d("YDS"),
      d("YÖKDİL"),
      d("MSÜ"),
      d("IELTS"),
      d("TOEFL"),
    ],
  },
  {
    grup: "Yabancı Diller",
    dersler: [
      d("İngilizce"),
      d("Almanca"),
      d("Fransızca"),
      d("İspanyolca"),
      d("Arapça"),
      d("Rusça"),
      d("İtalyanca"),
      d("Japonca"),
      d("Korece"),
      d("Çince"),
      d("Yabancılar için Türkçe"),
      d("İşaret Dili"),
    ],
  },
  {
    grup: "Üniversite Dersleri",
    dersler: [
      d("Calculus"),
      d("Lineer Cebir"),
      d("Diferansiyel Denklemler"),
      d("İstatistik"),
      d("Olasılık"),
      d("Statik"),
      d("Dinamik"),
      d("Mukavemet"),
      d("Termodinamik"),
      d("Akışkanlar Mekaniği"),
      d("Devre Analizi"),
      d("Muhasebe"),
      d("Mikro İktisat"),
      d("Makro İktisat"),
    ],
  },
  {
    grup: "Yazılım & Bilgisayar",
    dersler: [
      d("Python"),
      d("Java"),
      d("C / C++", "C++"),
      d("C#"),
      d("JavaScript"),
      d("Web Geliştirme"),
      d("SQL / Veritabanı", "SQL"),
      d("Algoritma ve Veri Yapıları", "Algoritma"),
      d("Scratch"),
      d("Robotik ve Kodlama", "Robotik"),
      d("Arduino"),
      d("Excel"),
      d("Ofis Programları"),
      d("Photoshop"),
      d("AutoCAD"),
      d("SolidWorks"),
    ],
  },
  {
    grup: "Müzik",
    dersler: [
      d("Piyano"),
      d("Gitar"),
      d("Elektro Gitar"),
      d("Keman"),
      d("Bağlama"),
      d("Ukulele"),
      d("Yan Flüt"),
      d("Bateri"),
      d("Ney"),
      d("Ses Eğitimi (Şan)", "Şan"),
      d("Solfej ve Müzik Teorisi", "Solfej"),
    ],
  },
  {
    grup: "Sanat & Hobi",
    dersler: [
      d("Resim"),
      d("Karakalem"),
      d("Yağlı Boya"),
      d("Sulu Boya"),
      d("Ebru"),
      d("Hat"),
      d("Fotoğrafçılık"),
      d("Drama ve Tiyatro", "Drama"),
      d("Satranç"),
      d("El Sanatları"),
    ],
  },
  {
    grup: "Spor & Dans",
    dersler: [
      d("Yüzme"),
      d("Tenis"),
      d("Basketbol"),
      d("Futbol"),
      d("Voleybol"),
      d("Fitness"),
      d("Yoga"),
      d("Pilates"),
      d("Bale"),
      d("Halk Oyunları"),
    ],
  },
  {
    grup: "Kişisel Gelişim",
    dersler: [
      d("Diksiyon"),
      d("Hızlı Okuma"),
      d("Hafıza Teknikleri"),
      d("Etkili İletişim"),
      d("Sunum Becerileri"),
      d("Öğrenci Koçluğu"),
      d("Akıl ve Zeka Oyunları"),
    ],
  },
];

/** Türkçe duyarlı, aksan/büyük-küçük bağışlayan normalizasyon. */
function normalize(s: string): string {
  return s.toLocaleLowerCase("tr-TR").trim();
}

/**
 * Yazılan metne göre grup başlıkları korunarak süzer. Boş sorguda tüm
 * taksonomi döner (popover kaydırılabilir tam listeyi basar).
 */
export function dersAra(sorgu: string): DersGrubu[] {
  const n = normalize(sorgu);
  if (!n) return DERS_TAKSONOMISI;
  return DERS_TAKSONOMISI.map((g) => ({
    grup: g.grup,
    dersler: g.dersler.filter(
      (x) => normalize(x.label).includes(n) || normalize(x.q).includes(n)
    ),
  })).filter((g) => g.dersler.length > 0);
}
