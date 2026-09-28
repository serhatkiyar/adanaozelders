import { useState } from "react";
import { Icon } from "@/components/AppIcon";
import { Modal } from "@/components/ui/Modal";
import { ETIKET, KART, KUCUK_ACIKLAMA } from "@/components/pano/stil";

/*
 * Tanıtım videosu gereksinimleri — Preply'daki "Video gereksinimleri" düzeni
 * (28 Eyl 2026 karşılaştırması): masaüstünde sağ sütunda sabit kutu, telefonda
 * oynatıcının altında dokunulabilir kart → alt pencere. Maddeler worker'ın
 * uyguladığı kurallarla aynı (30 sn–2 dk, yatay, en az 360p).
 */

export const VIDEO_YAPILACAKLAR = [
  "Videon 30 saniye ile 2 dakika arasında olsun",
  "Yatay modda ve göz hizasında kaydet",
  "Aydınlık bir yer ve sade bir arka plan seç",
  "Titrememesi için kamerayı sabit bir yere koy",
  "Yüzün ve gözlerin baştan sona görünsün",
  "Deneyimini ve ders anlatma yaklaşımını kısaca anlat",
];

export const VIDEO_KACINILACAKLAR = [
  "Soyadını ya da iletişim bilgini paylaşma",
  "Logo veya bağlantı gösterme",
  "Slayt ya da sunum dosyası kullanma",
  "Videoda senden başka kimseyi gösterme",
  "Dikey ya da düşük çözünürlüklü (360p altı) kayıt yükleme",
];

const GIRIS = "Videonun onaylanması için gereksinimleri karşıladığından emin ol.";

export function VideoGereksinimleriListesi() {
  return (
    <div className="space-y-6">
      <div>
        <h4 className={`flex items-center gap-2 ${ETIKET}`}>
          <span aria-hidden className="text-emerald-600">
            <Icon name="checkmark" className="h-5 w-5" />
          </span>
          Yapman gerekenler
        </h4>
        <ul className="mt-3 space-y-2 pl-7">
          {VIDEO_YAPILACAKLAR.map((m) => (
            <li key={m} className={`list-disc marker:text-emerald-600 ${KUCUK_ACIKLAMA}`}>
              {m}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className={`flex items-center gap-2 ${ETIKET}`}>
          <span aria-hidden className="text-red-600">
            <Icon name="dismiss" className="h-5 w-5" />
          </span>
          Kaçınman gerekenler
        </h4>
        <ul className="mt-3 space-y-2 pl-7">
          {VIDEO_KACINILACAKLAR.map((m) => (
            <li key={m} className={`list-disc marker:text-red-600 ${KUCUK_ACIKLAMA}`}>
              {m}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Masaüstü: sağ sütundaki gri kutu (başlık + giriş + listeler). */
export function VideoGereksinimleriKutusu({ className = "" }: { className?: string }) {
  return (
    <section aria-labelledby="video-gereksinimleri-baslik" className={`${KART} ${className}`}>
      <h3 id="video-gereksinimleri-baslik" className={ETIKET}>
        Video gereksinimleri
      </h3>
      <p className={`mt-2 ${KUCUK_ACIKLAMA}`}>{GIRIS}</p>
      <div className="mt-5">
        <VideoGereksinimleriListesi />
      </div>
    </section>
  );
}

/** Telefon: oynatıcının altındaki dokunulabilir kart → alt pencere. */
export function VideoGereksinimleriKarti({ className = "" }: { className?: string }) {
  const [acik, setAcik] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAcik(true)}
        aria-haspopup="dialog"
        className={`flex min-h-14 w-full items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marka-focus focus-visible:ring-offset-2 ${className}`}
      >
        <span className="min-w-0 flex-1">
          <span className={`block ${ETIKET}`}>Video gereksinimleri</span>
          <span className={`block ${KUCUK_ACIKLAMA}`}>Süre, yön ve içerik kuralları</span>
        </span>
        <span aria-hidden className="text-slate-700">
          <Icon name="chevronRight" className="h-5 w-5" />
        </span>
      </button>
      <Modal open={acik} onClose={() => setAcik(false)} title="Video gereksinimleri" description={GIRIS}>
        <div className="mt-5">
          <VideoGereksinimleriListesi />
        </div>
      </Modal>
    </>
  );
}
