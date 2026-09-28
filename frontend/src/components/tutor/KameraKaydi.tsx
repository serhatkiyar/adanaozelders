import { useCallback, useEffect, useId, useRef, useState } from "react";
import { IlerlemeCubugu } from "@/components/IlerlemeCubugu";
import {
  bazTip,
  kameraDestekleniyor,
  kameraHataMesaji,
  kameraKisitlari,
  kayitDosyaAdi,
  kayitMimeSec,
} from "@/lib/kameraKaydi";
import { dikeyMi, sureBiciminde } from "@/lib/tanitimVideo";
import {
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";

/*
 * Tarayıcıda kamerayla tanıtım videosu kaydı (Preply'daki "kaydet" akışı).
 *
 * Kamera aç → canlı önizleme (sessiz, aynalı) → 3 sn geri sayım → kayıt
 * (en az `minSeconds`, en fazla `maxSeconds`, sınırda kendiliğinden durur)
 * → kaydı izle → "Bu kaydı kullan" ya da "Tekrar kaydet". Kullanılan kayıt
 * `File` olarak mevcut yükleme hattına verilir; backend değişmez.
 */

type Asama = "hazir" | "aciliyor" | "onizleme" | "geriSayim" | "kayit" | "bitti" | "hata";

const GERI_SAYIM = 3;

export function KameraKaydi({
  minSeconds,
  maxSeconds,
  onKullan,
  onVazgec,
}: {
  minSeconds: number;
  /** Kayıt üst sınırı (sn); sınıra gelince kendiliğinden durur. */
  maxSeconds: number;
  onKullan: (file: File) => void;
  onVazgec: () => void;
}) {
  const uid = useId();
  const [asama, setAsama] = useState<Asama>("hazir");
  const [hata, setHata] = useState<string | null>(null);
  const [gecen, setGecen] = useState(0);
  const [geriSayim, setGeriSayim] = useState(GERI_SAYIM);
  const [kayitUrl, setKayitUrl] = useState<string | null>(null);
  const [kameralar, setKameralar] = useState<MediaDeviceInfo[]>([]);
  const [kameraId, setKameraId] = useState<string>("");
  // Canlı görüntü dikey mi (telefon dik tutuluyor)? Sunucu dikey videoyu
  // reddeder; kayıttan ÖNCE uyarılır. `kayitDikey` bitmiş kaydın yönüdür.
  const [dikey, setDikey] = useState(false);
  const [kayitDikey, setKayitDikey] = useState(false);

  const onizlemeRef = useRef<HTMLVideoElement | null>(null);
  const akisRef = useRef<MediaStream | null>(null);
  const kaydediciRef = useRef<MediaRecorder | null>(null);
  const parcalarRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef<string>("video/webm");
  const zamanlayiciRef = useRef<number | null>(null);
  const baslangicRef = useRef(0);
  const acDugmesiRef = useRef<HTMLButtonElement>(null);

  // Önizleme boyutu: metadata gelince ve telefon döndürülünce (resize) okunur.
  useEffect(() => {
    const v = onizlemeRef.current;
    if (!v) return;
    const oku = () => setDikey(dikeyMi(v.videoWidth, v.videoHeight));
    v.addEventListener("loadedmetadata", oku);
    v.addEventListener("resize", oku);
    return () => {
      v.removeEventListener("loadedmetadata", oku);
      v.removeEventListener("resize", oku);
    };
  }, []);

  // Kayıt görünümü açılınca odak ilk eyleme taşınır (klavye/ekran okuyucu).
  useEffect(() => {
    acDugmesiRef.current?.focus();
  }, []);

  const zamanlayiciDurdur = () => {
    if (zamanlayiciRef.current != null) {
      window.clearInterval(zamanlayiciRef.current);
      zamanlayiciRef.current = null;
    }
  };

  const akisiKapat = useCallback(() => {
    akisRef.current?.getTracks().forEach((t) => t.stop());
    akisRef.current = null;
    if (onizlemeRef.current) onizlemeRef.current.srcObject = null;
  }, []);

  const kayitUrlBirak = useCallback(() => {
    setKayitUrl((eski) => {
      if (eski) URL.revokeObjectURL(eski);
      return null;
    });
  }, []);

  // Unmount: kamera ışığı sönsün, blob adresi bırakılsın.
  useEffect(
    () => () => {
      zamanlayiciDurdur();
      if (kaydediciRef.current?.state === "recording") kaydediciRef.current.stop();
      akisiKapat();
      kayitUrlBirak();
    },
    [akisiKapat, kayitUrlBirak]
  );

  const kamerayiAc = async (id?: string) => {
    setHata(null);
    setAsama("aciliyor");
    akisiKapat();
    try {
      const akis = await navigator.mediaDevices.getUserMedia(kameraKisitlari(id || undefined));
      akisRef.current = akis;
      if (onizlemeRef.current) {
        onizlemeRef.current.srcObject = akis;
        onizlemeRef.current.muted = true;
      }
      // Cihaz adları ancak izin verildikten sonra dolu gelir.
      const cihazlar = await navigator.mediaDevices.enumerateDevices?.().catch(() => []);
      setKameralar((cihazlar ?? []).filter((c) => c.kind === "videoinput"));
      setAsama("onizleme");
    } catch (err) {
      setHata(kameraHataMesaji(err));
      setAsama("hata");
    }
  };

  const kaydiDurdur = useCallback(() => {
    zamanlayiciDurdur();
    const k = kaydediciRef.current;
    if (k && k.state !== "inactive") k.stop();
  }, []);

  const kaydaBasla = () => {
    const akis = akisRef.current;
    if (!akis) return;
    const mime = kayitMimeSec((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) {
      setHata("Tarayıcın video kaydını desteklemiyor. Video dosyası yükleyebilirsin.");
      setAsama("hata");
      return;
    }
    mimeRef.current = mime;
    parcalarRef.current = [];
    let k: MediaRecorder;
    try {
      k = new MediaRecorder(akis, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    } catch (err) {
      setHata(kameraHataMesaji(err));
      setAsama("hata");
      return;
    }
    k.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parcalarRef.current.push(e.data);
    };
    k.onstop = () => {
      const blob = new Blob(parcalarRef.current, { type: bazTip(mimeRef.current) });
      blobRef.current = blob;
      const v = onizlemeRef.current;
      setKayitDikey(v ? dikeyMi(v.videoWidth, v.videoHeight) : false);
      setKayitUrl(URL.createObjectURL(blob));
      setAsama("bitti");
    };
    kaydediciRef.current = k;
    k.start(1000);
    baslangicRef.current = Date.now();
    setGecen(0);
    setAsama("kayit");
    zamanlayiciRef.current = window.setInterval(() => {
      const sn = (Date.now() - baslangicRef.current) / 1000;
      setGecen(sn);
      if (sn >= maxSeconds) kaydiDurdur();
    }, 250);
  };

  const geriSayimBaslat = () => {
    setGeriSayim(GERI_SAYIM);
    setAsama("geriSayim");
    let kalan = GERI_SAYIM;
    zamanlayiciRef.current = window.setInterval(() => {
      kalan -= 1;
      setGeriSayim(kalan);
      if (kalan <= 0) {
        zamanlayiciDurdur();
        kaydaBasla();
      }
    }, 1000);
  };

  const tekrarKaydet = () => {
    kayitUrlBirak();
    blobRef.current = null;
    setKayitDikey(false);
    setGecen(0);
    setAsama(akisRef.current ? "onizleme" : "hazir");
    if (!akisRef.current) void kamerayiAc(kameraId);
  };

  const kullan = () => {
    const blob = blobRef.current;
    if (!blob || kayitDikey) return;
    const tip = bazTip(mimeRef.current);
    akisiKapat();
    onKullan(new File([blob], kayitDosyaAdi(mimeRef.current), { type: tip }));
  };

  const vazgec = () => {
    zamanlayiciDurdur();
    if (kaydediciRef.current?.state === "recording") {
      kaydediciRef.current.onstop = null;
      kaydediciRef.current.stop();
    }
    akisiKapat();
    kayitUrlBirak();
    onVazgec();
  };

  if (!kameraDestekleniyor()) {
    return (
      <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <p className="text-sm leading-5">
          Tarayıcın kamerayla kaydı desteklemiyor. Video dosyası yükleyebilirsin.
        </p>
        <button type="button" className={`mt-3 ${DUGME_SATIR_IKINCIL}`} onClick={onVazgec}>
          Dosya yüklemeye dön
        </button>
      </div>
    );
  }

  const canli = asama === "onizleme" || asama === "geriSayim" || asama === "kayit" || asama === "aciliyor";
  const bitirebilir = gecen >= minSeconds;
  const dikeyUyari =
    (asama === "onizleme" && dikey) || (asama === "bitti" && kayitDikey)
      ? "Telefonu yatay çevir; dikey video kabul edilmiyor."
      : null;

  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        {/* Canlı önizleme: kendi sesini duymasın diye sessiz; ayna görüntü. */}
        <video
          ref={onizlemeRef}
          className={`h-full w-full object-contain ${canli ? "" : "hidden"}`}
          style={{ transform: "scaleX(-1)" }}
          autoPlay
          muted
          playsInline
          aria-label="Kamera önizlemesi"
        />
        {asama === "bitti" && kayitUrl && (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- eğitmenin kendi kaydının önizlemesi.
          <video
            className="h-full w-full"
            src={kayitUrl}
            controls
            playsInline
            aria-label="Kaydettiğin video"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth > 0) setKayitDikey(dikeyMi(v.videoWidth, v.videoHeight));
            }}
          />
        )}
        {(asama === "hazir" || asama === "hata") && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm leading-5 text-slate-200">
            Kamera kapalı
          </div>
        )}
        {asama === "geriSayim" && (
          <div
            className="absolute inset-0 flex items-center justify-center text-6xl font-semibold text-white"
            aria-live="assertive"
          >
            {geriSayim}
          </div>
        )}
        {asama === "kayit" && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-sm font-semibold text-white">
            <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            Kayıt
          </div>
        )}
      </div>

      {asama === "kayit" && (
        <div>
          <div className="flex items-center justify-between text-sm tabular-nums text-slate-700" aria-live="polite">
            <span>{sureBiciminde(gecen)}</span>
            <span>en fazla {sureBiciminde(maxSeconds)}</span>
          </div>
          <IlerlemeCubugu oran={gecen / maxSeconds} etiket="Kayıt süresi" className="mt-2" />
          {!bitirebilir && (
            <p id={`${uid}-min`} className={`mt-2 ${KUCUK_ACIKLAMA}`}>
              En az {minSeconds} saniye kaydet; {Math.ceil(minSeconds - gecen)} saniye kaldı.
            </p>
          )}
        </div>
      )}

      {dikeyUyari && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">
          {dikeyUyari}
        </p>
      )}

      {hata && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-900">
          {hata}
        </p>
      )}

      {kameralar.length > 1 && (asama === "onizleme" || asama === "bitti") && (
        <div>
          <label htmlFor={`${uid}-kamera`} className="mb-1 block text-sm font-semibold text-slate-900">
            Kamera
          </label>
          <select
            id={`${uid}-kamera`}
            value={kameraId}
            onChange={(e) => {
              setKameraId(e.target.value);
              kayitUrlBirak();
              void kamerayiAc(e.target.value);
            }}
            className="h-10 w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 text-base text-slate-900"
          >
            <option value="">Varsayılan kamera</option>
            {kameralar.map((c, i) => (
              <option key={c.deviceId || i} value={c.deviceId}>
                {c.label || `Kamera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap [&>button]:max-sm:h-11 [&>button]:max-sm:w-full">
        {(asama === "hazir" || asama === "hata") && (
          <button
            ref={acDugmesiRef}
            type="button"
            className={DUGME_SATIR_BIRINCIL}
            onClick={() => void kamerayiAc(kameraId)}
          >
            Kamerayı aç
          </button>
        )}
        {asama === "aciliyor" && (
          <button type="button" className={DUGME_SATIR_BIRINCIL} disabled>
            Kamera açılıyor…
          </button>
        )}
        {asama === "onizleme" && (
          <button type="button" className={DUGME_SATIR_BIRINCIL} onClick={geriSayimBaslat} disabled={dikey}>
            Kaydı başlat
          </button>
        )}
        {asama === "kayit" && (
          <button
            type="button"
            className={DUGME_SATIR_BIRINCIL}
            onClick={kaydiDurdur}
            disabled={!bitirebilir}
            aria-describedby={bitirebilir ? undefined : `${uid}-min`}
          >
            Kaydı bitir
          </button>
        )}
        {asama === "bitti" && (
          <>
            <button type="button" className={DUGME_SATIR_BIRINCIL} onClick={kullan} disabled={kayitDikey}>
              Bu kaydı kullan
            </button>
            <button type="button" className={DUGME_SATIR_IKINCIL} onClick={tekrarKaydet}>
              Tekrar kaydet
            </button>
          </>
        )}
        <button type="button" className={DUGME_SATIR_IKINCIL} onClick={vazgec}>
          Vazgeç
        </button>
      </div>

      {asama === "onizleme" && (
        <p className={KUCUK_ACIKLAMA}>
          Yüzün ortada ve aydınlıkta olsun. Kayıt {GERI_SAYIM} saniyelik geri sayımla başlar; {minSeconds} saniye ile{" "}
          {Math.floor(maxSeconds / 60)} dakika arasında tut.
        </p>
      )}
    </div>
  );
}
