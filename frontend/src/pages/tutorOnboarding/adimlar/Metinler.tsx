import { CokSatir, Metin } from "@/components/form/alanlar";
import { BASLIK_EN_AZ_KELIME, kelimeSayaci } from "@/lib/metin";

import {
  HAKKINDA_EN_AZ_KELIME,
  YONTEM_EN_AZ_KELIME,
} from "../sozlesme";
import type { AdimProps } from "./ortak";

/**
 * Uzun metin adımları: başlık, yöntem, kendini anlatma.
 *
 * Üçünün ortak yanı canlı kelime sayacı. Kullanıcı "yeterince yazdım mı"
 * sorusunun cevabını göndermeden ÖNCE görüyor — bunu 422 ile öğrenmesi,
 * yazdığı metni kaybetmesine ve akıştan düşmesine yol açıyordu.
 */

export function AdimBaslik({ d, guncelle, odakla }: AdimProps) {
  const sayac = kelimeSayaci(
    d.headline,
    BASLIK_EN_AZ_KELIME,
    "Branşını, seviyeni ve deneyimini ekle.",
  );
  return (
    <CokSatir
      dolgu
      ad="baslik"
      etiket="İlan başlığı"
      ipucu={sayac.metin}
      deger={d.headline}
      onChange={(v) => guncelle({ headline: v })}
      satir={3}
      maxLength={255}
      odakla={odakla}
      placeholder="Örnek: Lise ve üniversite hazırlık öğrencilerine sekiz yıldır birebir ders veren mühendislik mezunu"
    />
  );
}

export function AdimYontem({ d, guncelle, odakla }: AdimProps) {
  const sayac = kelimeSayaci(d.lessonInfo, YONTEM_EN_AZ_KELIME);
  return (
    <CokSatir
      dolgu
      ad="yontem"
      etiket="Dersin işleyişi"
      ipucu={sayac.metin}
      deger={d.lessonInfo}
      onChange={(v) => guncelle({ lessonInfo: v })}
      satir={8}
      maxLength={2000}
      odakla={odakla}
      placeholder="İlk derste öğrencinin seviyesini nasıl ölçüyorsun, hangi kaynakları kullanıyorsun, ders sonrası ödev veriyor musun?"
    />
  );
}

export function AdimHakkinda({ d, guncelle, odakla }: AdimProps) {
  const sayac = kelimeSayaci(d.bio, HAKKINDA_EN_AZ_KELIME);
  return (
    <CokSatir
      dolgu
      ad="hakkinda"
      etiket="Hakkında"
      ipucu={sayac.metin}
      deger={d.bio}
      onChange={(v) => guncelle({ bio: v })}
      satir={8}
      maxLength={2000}
      odakla={odakla}
      placeholder="Nerede okudun, kaç yıldır ders veriyorsun, öğrencilerinle hangi sonuçları aldın?"
    />
  );
}

/**
 * Fotoğraf adımının altındaki opsiyonel tanıtım videosu.
 *
 * Ayrı bir adım yapılmadı: video ekleyen eğitmen azınlık, herkese ayrı bir
 * ekran göstermek akışı uzatırdı.
 */
export function TanitimVideosu({ d, guncelle }: AdimProps) {
  return (
    <Metin
      dolgu
      ad="video"
      etiket="Tanıtım videosu"
      ipucu="İsteğe bağlı. Yalnız YouTube veya Vimeo bağlantısı."
      tip="url"
      inputMode="url"
      deger={d.introVideoUrl}
      onChange={(v) => guncelle({ introVideoUrl: v })}
      maxLength={500}
      placeholder="https://youtube.com/watch?v=..."
      duzeltmeKapali
    />
  );
}
