import { BASLIK_EN_AZ_KELIME, kelimeSay } from "@/lib/metin";
import { Gender, TeachingMode, type TutorProfileUpdate } from "@/types";

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
  /** Arama faseti. İSTEĞE BAĞLI — boş bırakılabilir. */
  gender: Gender | "";
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
  gender: "",
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
  /**
   * Başlıktaki VURGULU sözcük — mercan renge boyanır.
   *
   * Başlığın içinde birebir geçmeli; geçmezse başlık tek renk çizilir
   * (sessiz bozulma yok). Eşleşme `indexOf` ile yapılır, RegExp ile değil:
   * Türkçe'de büyük/küçük harf dönüşümü (İ/ı) düzenli ifadelerde tuzaklı.
   */
  vurgu?: string;
  /** Bilgi kartındaki "neden soruyoruz" paragrafı. */
  ipucu?: string;
  /** Bilgi kartındaki "iyi örnek" maddeleri — kullanıcı ne yazacağını görsün. */
  ornekler?: string[];
  /** Bilgi kartının en altındaki kısa uyarı ("Unutma, …"). */
  hatirlatma?: string;
  /** Doldurulmadan geçilebilir mi. */
  atlanabilir?: boolean;
  /**
   * İLERLEMEYİ KESEN koşul. `null` dönerse adım geçerli.
   *
   * Yalnız YAPISAL eksikler burada: ders seçilmemişse ilan aramada hiç
   * görünmez, ders şekli yoksa öğrenci nasıl ders alacağını bilemez. Bunları
   * geçmeye izin vermek, kullanıcıya işe yaramayan bir ilan yaptırmaktır.
   */
  dogrula?: (d: Durum, dis: DisDurum) => Hata | null;
  /**
   * UYARIR AMA KESMEZ (5 Eyl 2026, kullanıcı kararı: "daha yumuşak olsun").
   *
   * Metin uzunluğu gibi kalite önerileri burada yaşar: az yazan kullanıcı
   * ilerleyebilir, sayacı ve uyarıyı görür, eksik Özet ekranında "Düzelt"
   * bağlantısıyla listelenir. Superprof aynı yerde İleri düğmesini kapatıyor;
   * bizde birincil düğmenin `disabled` olması ayrıca YASAK
   * (`src/__guards__/gonderDugmesi.test.ts`).
   */
  oneri?: (d: Durum) => Hata | null;
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
    vurgu: "dersleri",
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
    vurgu: "başlığı",
    kisaAd: "Başlığın",
    baslik: "İlanının başlığı ne olsun?",
    altBaslik:
      "Öğrencilerin arama sonuçlarında gördüğü ilk satır. Neyi, kime ve nasıl anlattığını tek cümlede söyle.",
    ipucu:
      "Başlık ilanının en çok okunan yeri. Yalnızca dersin adını yazmak yerine seviyeni ve deneyimini de ekle.",
    oneri: (d) =>
      kelimeSay(d.headline) < BASLIK_EN_AZ_KELIME
        ? {
            alan: "baslik",
            mesaj: `Başlık en az ${BASLIK_EN_AZ_KELIME} sözcük olmalı; şu an ${kelimeSay(d.headline)}.`,
          }
        : null,
    yama: (d) => ({ headline: d.headline.trim() }),
    ornekler: [
      "Mühendislik öğrencisi, ilkokuldan liseye matematik ve fizik dersleri",
      "15 yıl deneyimli piyanist, evde piyano ve solfej dersi",
      "TYT-AYT matematikte 8 yıl, hedefi ilk 10 bin olan öğrencilere",
    ],
    hatirlatma:
      "İletişim bilgin ya da bağlantı adresin başlıkta yer alamaz.",
  },
  {
    anahtar: "yontem",
    vurgu: "nasıl",
    kisaAd: "Dersin işleyişi",
    baslik: "Dersin nasıl işliyor?",
    altBaslik:
      "İlk ders nasıl başlar, hangi kaynakları kullanırsın, ödev verir misin?",
    ipucu:
      "Öğrenci burada senin yöntemini başkasınınkinden ayırt edebilmeli. Somut yaz: kaynak adı, ders süresi, ödev düzeni.",
    oneri: (d) =>
      kelimeSay(d.lessonInfo) < YONTEM_EN_AZ_KELIME
        ? {
            alan: "yontem",
            mesaj: `Biraz daha anlat: en az ${YONTEM_EN_AZ_KELIME} sözcük; şu an ${kelimeSay(d.lessonInfo)}.`,
          }
        : null,
    yama: (d) => ({ lesson_info: d.lessonInfo.trim() }),
    ornekler: [
      "Öğretim teknik ve yöntemlerin",
      "Dersin nasıl aktığı (soru çözümü mü, konu anlatımı mı)",
      "Kimler için uygun: sınıf, seviye, sınav türü",
    ],
    hatirlatma:
      "İletişim bilgin ya da bağlantı adresin burada yer alamaz.",
  },
  {
    anahtar: "hakkinda",
    vurgu: "kimsin",
    kisaAd: "Sen kimsin",
    baslik: "Sen kimsin?",
    altBaslik: "Eğitimin, deneyimin ve neden ders verdiğin.",
    ipucu:
      "Veli ve öğrenci burada güven arıyor. Nerede okudun, kaç yıldır ders veriyorsun, hangi sonuçları aldın?",
    oneri: (d) =>
      kelimeSay(d.bio) < HAKKINDA_EN_AZ_KELIME
        ? {
            alan: "hakkinda",
            mesaj: `Biraz daha anlat: en az ${HAKKINDA_EN_AZ_KELIME} sözcük; şu an ${kelimeSay(d.bio)}.`,
          }
        : null,
    yama: (d) => ({ bio: d.bio.trim() }),
    ornekler: [
      "Eğitimin ve varsa deneyim yılın",
      "Neden ders verdiğin",
      "Öğrencilerinin aldığı somut sonuçlar",
    ],
    hatirlatma:
      "Bu metin öğrencinin senin hakkında okuduğu ilk şey; yazım kurallarına dikkat et.",
  },
  {
    anahtar: "yer",
    vurgu: "nerede",
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
          mesaj: "Yüz yüze ders için ilçeni seç: öğrenciler ilçeye göre arıyor.",
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
    hatirlatma:
      "Açık adresin ilanda ASLA görünmez; yalnız dersi kabul ettiğin öğrenciye iletilir.",
  },
  {
    anahtar: "ucret",
    vurgu: "ücretin",
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
    hatirlatma:
      "Yeni başlıyorsan yüksek bir ücret seçmemek işine yarar; yorum ve referans topladıkça yükseltirsin.",
  },
  {
    anahtar: "telefon",
    vurgu: "numaran",
    kisaAd: "Telefonun",
    baslik: "Telefon numaran",
    altBaslik: "Ders talebi geldiğinde SMS ile haber veriyoruz.",
    ipucu:
      "Numaran ilanında görünmez. Rezervasyon ve ödeme adımlarında doğrulanmış numara istenir; şimdi atlarsan o adımda tekrar sorulur.",
    atlanabilir: true,
    hatirlatma:
      "Numaran ilanında görünmez; yalnız dersi kabul ettiğin öğrenciye iletilir.",
  },
  {
    anahtar: "fotograf",
    vurgu: "Fotoğrafını",
    kisaAd: "Fotoğrafın",
    baslik: "Fotoğrafını ekle",
    altBaslik: "Öğrencinin ilanında gördüğü ilk şey.",
    ipucu:
      "Yüzün net görünsün, tek başına ol ve karşıya bak. Fotoğrafı olan ilanlar belirgin biçimde daha çok tıklanıyor.",
    atlanabilir: true,
    // Telefon adımının "Numaran ilanında görünmez" uyarısının SİMETRİĞİ.
    // Cinsiyet bir arama faseti ve ilanda GÖRÜNÜR; sorulduğu anda bunun
    // söylenmesi, alanın eklenmesinin koşuludur.
    hatirlatma:
      "Fotoğrafın tüm ilanlarında kullanılır. Cinsiyetini yazarsan ilanında görünür ve öğrenciler ona göre filtreleyebilir.",
    yama: (d) => ({
      gender: d.gender || null,
      intro_video_url: d.introVideoUrl.trim() || null,
      // Tanıtım videosu bu adımda gösteriliyor (`TanitimVideosu`) ama uzun
      // süre yamada YOKTU: eğitmen linki yazıyor, alan doluyor, "İleri"ye
      // basıyor ve link sunucuya HİÇ gitmiyordu. Ekranda değer durduğu için
      // hata görünmüyordu; kayıp ancak sayfa yenilenince fark ediliyordu.
      //
      // `|| null`: sunucu boş string'i de temizleme sayıyor
      // (`schemas/tutor.py::_check_intro_video` strip'leyip None döndürür),
      // yani ikisi de çalışır. `null` seçildi çünkü istemci tipi
      // `string | null` ve "alanı temizle" niyeti okunur olsun.
    }),
  },
  {
    anahtar: "ozet",
    vurgu: "hazır",
    kisaAd: "Özet",
    baslik: "İlanın hazır",
    altBaslik: "Gözden geçir ve yayına gönder.",
  },
];

export const SON_ADIM = ADIMLAR.length - 1;

/**
 * Anahtardan adım numarası.
 *
 * NEDEN VAR: adım numaraları başka dosyalara ELLE yazılıyordu (özet ekranının
 * "Düzenle" bağlantıları). Sözleşmeye bir adım eklendiğinde ya da sırası
 * değiştiğinde bu sayılar sessizce yanlış adımı gösteriyordu — hata vermeden,
 * yalnız kullanıcıyı yanlış ekrana götürerek. Bilinmeyen anahtarda FIRLATIR:
 * silinmiş bir adıma bağlanan kod, sessizce 0. adıma düşmek yerine kırılsın.
 */
export function adimIndeksi(anahtar: string): number {
  const i = ADIMLAR.findIndex((a) => a.anahtar === anahtar);
  if (i < 0) throw new Error(`Bilinmeyen adım anahtarı: ${anahtar}`);
  return i;
}

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
    // İKİSİ DE listelenir: `dogrula` ilerlemeyi kesen yapısal eksik,
    // `oneri` kesmeyen kalite eksiği. Özet ekranı kullanıcının "neyi
    // düzeltmem gerekiyor" sorusuna tek yerden cevap vermeli — uyarıyı
    // buradan gizlemek, az yazılmış bir ilanın sessizce yayına gitmesi
    // demek olurdu.
    const hata = adim.dogrula?.(d, dis) ?? adim.oneri?.(d) ?? null;
    if (hata) liste.push({ adim: i, mesaj: hata.mesaj });
  });
  return liste;
}
