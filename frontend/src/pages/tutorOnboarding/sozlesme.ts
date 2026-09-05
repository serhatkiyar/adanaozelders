import { BASLIK_EN_AZ_KELIME, kelimeSay } from "@/lib/metin";
import { TeachingMode, type Availability, type TutorProfileUpdate } from "@/types";

/**
 * İlan sihirbazının sözleşmesi: adım listesi, adım doğrulaması ve her adımın
 * sunucuya yazdığı gövde.
 *
 * Neden veri olarak tutuluyor: adımlar bileşenlerin içine dağılırsa "kaçıncı
 * adımdayım", "bu adım neyi kaydeder", "ilerlemem ne kadar" soruları üç ayrı
 * yerden yanıtlanır ve bir adım eklenince diğerleri unutulur. Burası TEK
 * kaynak; kabuk yalnız bu tabloyu yürütür.
 *
 * Dosya saftır — React, ağ ve tarayıcı bağımlılığı yoktur.
 */

export interface Durum {
  subjects: string[];
  /** { subject_id: level_id[] } */
  subjectLevels: Record<number, number[]>;
  headline: string;
  lessonInfo: string;
  bio: string;
  teachingMode: TeachingMode | "";
  district: string;
  locationText: string;
  locationLat: number | null;
  locationLng: number | null;
  hourlyRate: string;
  firstLessonFree: boolean;
  introVideoUrl: string;
  availability: Availability[];
}

/** Sunucudan gelen, sihirbazın kendi yazmadığı ama okuduğu durum. */
export interface DisDurum {
  avatarUrl: string | null;
  belgeVar: boolean;
  telefonDogrulandi: boolean;
}

export const BOS_DURUM: Durum = {
  subjects: [],
  subjectLevels: {},
  headline: "",
  lessonInfo: "",
  bio: "",
  teachingMode: "",
  district: "",
  locationText: "",
  locationLat: null,
  locationLng: null,
  hourlyRate: "",
  firstLessonFree: false,
  introVideoUrl: "",
  availability: [],
};

export interface Hata {
  /** `data-alan` değeri — kabuk bununla ilk hatalı alana odaklanır. */
  alan?: string;
  mesaj: string;
}

export interface Adim {
  anahtar: string;
  /**
   * Adım haritasında ve "sırada ne var" etiketinde kullanılan kısa ad.
   *
   * Birincil düğme "İleri" gibi jenerik bir sözcük TAŞIMAZ: kullanıcı bastığı
   * anda ne geleceğini bilmediğinde duraksıyor. Düğme sıradaki adımı adıyla
   * söyler ("Sırada: Başlığın").
   */
  kisaAd: string;
  /** Ekranın tek sorusu. */
  baslik: string;
  /** Sorunun altındaki bir cümlelik açıklama. */
  altBaslik?: string;
  /** Yan bilgi kutusu — bu adımın neden önemli olduğu. */
  ipucu?: string;
  /** Doldurulmadan geçilebilir mi. */
  atlanabilir?: boolean;
  /** `null` dönerse adım geçerli. */
  dogrula?: (d: Durum, dis: DisDurum) => Hata | null;
  /** Bu adımın `PATCH /tutors/me` gövdesi. Yoksa adım kendi ucuna yazar. */
  yama?: (d: Durum) => TutorProfileUpdate;
}

/** Ücret rehberliği. Sunucu üst sınır koymuyor; bunlar kullanıcıyı uyarır. */
export const UCRET_EN_AZ = 50;
export const UCRET_EN_COK = 5000;

export const YONTEM_EN_AZ_KELIME = 25;
export const HAKKINDA_EN_AZ_KELIME = 25;

export function ucretiCoz(deger: string): number | null {
  const n = Number(deger.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const ADIMLAR: Adim[] = [
  {
    anahtar: "dersler",
    kisaAd: "Derslerin",
    baslik: "Hangi dersleri veriyorsun?",
    altBaslik:
      "Birden fazla seçebilirsin. Ders ekledikçe altında hangi seviyelere baktığın sorulur.",
    ipucu:
      "Seçtiğin dersler öğrencilerin seni aramada bulmasını sağlar. Seviyeyi de işaretlersen yalnız sana uygun öğrenciler ulaşır.",
    dogrula: (d) =>
      d.subjects.length === 0
        ? { alan: "dersler", mesaj: "En az bir ders seç." }
        : null,
    yama: (d) => ({
      subjects: d.subjects,
      subject_levels: Object.entries(d.subjectLevels)
        .filter(([, ids]) => ids.length > 0)
        .map(([sid, ids]) => ({ subject_id: Number(sid), level_ids: ids })),
    }),
  },
  {
    anahtar: "baslik",
    kisaAd: "Başlığın",
    baslik: "İlanının başlığı ne olsun?",
    altBaslik:
      "Öğrencilerin arama sonuçlarında gördüğü ilk satır. Neyi, kime ve nasıl anlattığını tek cümlede söyle.",
    ipucu:
      "Başlık ilanının en çok okunan yeri. Yalnızca dersin adını yazmak yerine seviyeni ve deneyimini de ekle.",
    dogrula: (d) =>
      kelimeSay(d.headline) < BASLIK_EN_AZ_KELIME
        ? {
            alan: "baslik",
            mesaj: `Başlık en az ${BASLIK_EN_AZ_KELIME} sözcük olmalı; şu an ${kelimeSay(d.headline)}.`,
          }
        : null,
    yama: (d) => ({ headline: d.headline.trim() }),
  },
  {
    anahtar: "yontem",
    kisaAd: "Dersin işleyişi",
    baslik: "Dersin nasıl işliyor?",
    altBaslik:
      "İlk ders nasıl başlar, hangi kaynakları kullanırsın, ödev verir misin?",
    ipucu:
      "Öğrenci burada senin yöntemini başkasınınkinden ayırt edebilmeli. Somut yaz: kaynak adı, ders süresi, ödev düzeni.",
    dogrula: (d) =>
      kelimeSay(d.lessonInfo) < YONTEM_EN_AZ_KELIME
        ? {
            alan: "yontem",
            mesaj: `Biraz daha anlat — en az ${YONTEM_EN_AZ_KELIME} sözcük; şu an ${kelimeSay(d.lessonInfo)}.`,
          }
        : null,
    yama: (d) => ({ lesson_info: d.lessonInfo.trim() }),
  },
  {
    anahtar: "hakkinda",
    kisaAd: "Sen kimsin",
    baslik: "Sen kimsin?",
    altBaslik: "Eğitimin, deneyimin ve neden ders verdiğin.",
    ipucu:
      "Veli ve öğrenci burada güven arıyor. Nerede okudun, kaç yıldır ders veriyorsun, hangi sonuçları aldın?",
    dogrula: (d) =>
      kelimeSay(d.bio) < HAKKINDA_EN_AZ_KELIME
        ? {
            alan: "hakkinda",
            mesaj: `Biraz daha anlat — en az ${HAKKINDA_EN_AZ_KELIME} sözcük; şu an ${kelimeSay(d.bio)}.`,
          }
        : null,
    yama: (d) => ({ bio: d.bio.trim() }),
  },
  {
    anahtar: "yer",
    kisaAd: "Ders nerede",
    baslik: "Ders nerede işleniyor?",
    altBaslik: "Uzaktan, yüz yüze ya da ikisi birden.",
    ipucu:
      "Adresin ilanında ASLA görünmez. Yalnız ders vermeyi kabul ettiğin öğrenciye iletilir; harita işareti sadece yakınlık aramasında kullanılır.",
    dogrula: (d) => {
      if (!d.teachingMode)
        return { alan: "dersSekli", mesaj: "Ders şeklini seç." };
      if (d.teachingMode !== TeachingMode.ONLINE && !d.district)
        return {
          alan: "ilce",
          mesaj: "Yüz yüze ders için ilçeni seç — öğrenciler ilçeye göre arıyor.",
        };
      return null;
    },
    yama: (d) => ({
      teaching_mode: (d.teachingMode || null) as TeachingMode | null,
      district: d.district || null,
      location_text: d.locationText.trim() || null,
      location_lat: d.locationLat,
      location_lng: d.locationLng,
    }),
  },
  {
    anahtar: "ucret",
    kisaAd: "Ücretin",
    baslik: "Saatlik ücretin ne kadar?",
    altBaslik: "İstediğin zaman değiştirebilirsin.",
    ipucu:
      "Fiyatı sonradan serbestçe değiştirebilirsin. İlk dersi ücretsiz vermek, henüz yorumu olmayan yeni bir ilanda ilk öğrenciyi bulmayı kolaylaştırır.",
    dogrula: (d) => {
      const n = ucretiCoz(d.hourlyRate);
      if (n === null) return { alan: "ucret", mesaj: "Saatlik ücretini yaz." };
      if (n < UCRET_EN_AZ)
        return { alan: "ucret", mesaj: `Ücret en az ${UCRET_EN_AZ} ₺ olmalı.` };
      if (n > UCRET_EN_COK)
        return {
          alan: "ucret",
          mesaj: `Ücret en fazla ${UCRET_EN_COK} ₺ olabilir.`,
        };
      return null;
    },
    yama: (d) => ({
      hourly_rate: ucretiCoz(d.hourlyRate),
      first_lesson_free: d.firstLessonFree,
    }),
  },
  {
    anahtar: "musaitlik",
    kisaAd: "Müsaitliğin",
    baslik: "Ne zaman müsaitsin?",
    altBaslik: "Pencere eklemezsen öğrenciler herhangi bir saati talep edebilir.",
    ipucu:
      "Eklediğin saatlerin dışında rezervasyon yapılamaz. Boş bırakmak da bir seçim: talebi sen değerlendirirsin.",
    atlanabilir: true,
    yama: (d) => ({ availability: d.availability }),
  },
  {
    anahtar: "fotograf",
    kisaAd: "Fotoğrafın",
    baslik: "Fotoğrafını ekle",
    altBaslik: "Öğrencinin ilanında gördüğü ilk şey.",
    ipucu:
      "Yüzün net görünsün, tek başına ol ve karşıya bak. Fotoğrafı olan ilanlar belirgin biçimde daha çok tıklanıyor.",
    atlanabilir: true,
  },
  {
    anahtar: "belgeler",
    kisaAd: "Belgelerin",
    baslik: "Eğitimini belgele",
    altBaslik:
      "Diploma, öğrenci belgesi ya da e-Devlet barkodu. Yayına çıkmak için gerekli.",
    ipucu:
      "Belgen ilanında görünmez; yalnız yönetici doğrulaması için kullanılır. Bu adım olmadan ilan yayına alınamaz.",
    dogrula: (_d, dis) =>
      dis.belgeVar
        ? null
        : {
            mesaj:
              "Yayına çıkmak için en az bir eğitim kaydı ve belgesi (ya da e-Devlet barkodu) gerekiyor.",
          },
  },
  {
    anahtar: "telefon",
    kisaAd: "Telefonun",
    baslik: "Telefon numaran",
    altBaslik: "Ders talebi geldiğinde SMS ile haber veriyoruz.",
    ipucu:
      "Numaran ilanında görünmez. Rezervasyon ve ödeme adımlarında doğrulanmış numara istenir; şimdi atlarsan o adımda tekrar sorulur.",
    atlanabilir: true,
  },
  {
    anahtar: "ozet",
    kisaAd: "Özet",
    baslik: "İlanın hazır",
    altBaslik: "Gözden geçir ve yayına gönder.",
  },
];

export const SON_ADIM = ADIMLAR.length - 1;

/** Adım numarasını her zaman geçerli aralığa çeker. */
export function adimiSinirla(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.trunc(n), 0), SON_ADIM);
}

/**
 * Yayın kapısının önkoşulları — sunucudaki `submit_for_approval` ile hizalı.
 *
 * Kullanıcı en sonda 422 yemesin diye özet ekranında önden gösterilir. Sunucu
 * yine tek otoritedir; bu liste yalnız hangi adıma dönmesi gerektiğini söyler.
 */
export function eksikler(
  d: Durum,
  dis: DisDurum,
): { adim: number; mesaj: string }[] {
  const liste: { adim: number; mesaj: string }[] = [];
  ADIMLAR.forEach((adim, i) => {
    if (!adim.dogrula) return;
    const hata = adim.dogrula(d, dis);
    if (hata) liste.push({ adim: i, mesaj: hata.mesaj });
  });
  return liste;
}
