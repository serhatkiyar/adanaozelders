import { useEffect, useRef, useState, type ReactNode } from "react";

import { Modal } from "@/components/ui/Modal";
import { PlainButton } from "@/components/ui/PlainButton";

import { ADIMLAR } from "./sozlesme";
import { BILGI, MERCAN } from "./tema";

/**
 * Sihirbazın çerçeve parçaları: adım göstergesi, bilgi kartı, adım gövdesi ve
 * aksiyon çubuğu.
 *
 * ESKİ KARAR (Eylül başı) — TARİH OLARAK DURUYOR, ARTIK YÜRÜRLÜKTE DEĞİL:
 * "kart yok. Her adım tek bir soru gösteriyor; soruyu bir kutu içine almak
 * sayfada ikinci bir çerçeve doğuruyor. Ayrım boşlukla ve saç teli çizgiyle
 * kuruluyor."
 *
 * YÜRÜRLÜKTEKİ KARAR (5 Eyl 2026, kullanıcı): soru hâlâ kutusuz, ama YARDIM
 * artık dolgulu bir kart. Kullanıcı akışı gerçek sunucuda kullandı ve "neyin
 * ne olduğu belli değil" dedi: saç teli çizginin yanındaki soluk gri paragraf
 * okunmuyordu. Superprof'un aynı akışı bunu dolgulu bir kartla çözüyor.
 * Başlık da büyüdü ve `font-bold` oldu — tek-soru-tek-ekran düzeninde sayfanın
 * tek yön bulma işareti odur.
 *
 * Bu iki sapmanın kapsamı ve gerekçesi `docs/tasarim-dili.md` → "Ek A"da;
 * rengin sızmasının nöbetçisi `src/__guards__/sihirbazMercani.test.ts`,
 * kabuğun kendi sözleşmesi `kabuk.test.tsx`.
 *
 * MOBİL: yazılım klavyesi ekranın %70'ine kadarını kaplayabiliyor; kullanıcı o
 * anda bir-iki alandan fazlasını göremiyor. Bu yüzden her adım TEK BAŞINA
 * tamamlanabilir olmalı ve adımın ihtiyaç duyduğu her şey (etiket, sayaç,
 * hata, düğme) alanın hemen yanında durmalı.
 */

/** Sayfanın en üstündeki ince ilerleme şeridi — yüzde YAZMAZ, yalnız dolar. */
export function IlerlemeSeridi({ adimNo }: { adimNo: number }) {
  const oran = Math.round(((adimNo + 1) / ADIMLAR.length) * 100);
  return (
    <div
      className="h-[3px] w-full bg-slate-100"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={oran}
      aria-label="İlan oluşturma ilerlemesi"
    >
      <div
        className={`h-full ${MERCAN.zemin} transition-[width] duration-500 ease-out`}
        style={{ width: `${oran}%` }}
      />
    </div>
  );
}

/**
 * Şeridin altındaki dokunma hedefi — tüm adımların haritasını açar.
 *
 * NEDEN VAR: kullanıcılar ilerleme göstergesini GERİ GİTMEK için kullanmayı
 * deniyor ve gösterge adımların birebir haritası olmalı. On bir adımlık bir
 * akışta 9. adımdan 1. adıma dönmek sekiz kez "geri" demekti.
 *
 * Şeridin kendisi neden dokunulabilir değil: on bir dilim 360px ekranda 32px
 * eder, dokunma hedefi eşiğinin (44px) altında kalır. Bu yüzden şerit bilgi
 * verir, harita ayrı ve tam boy bir hedeftir; içindeki satırlar da 48px.
 */
export function AdimHaritasi({
  adimNo,
  enUzak,
  git,
}: {
  adimNo: number;
  /** Kullanıcının ulaştığı en ileri adım; ötesi henüz açılmadı. */
  enUzak: number;
  git: (n: number) => void;
}) {
  const [acik, setAcik] = useState(false);
  const toplam = ADIMLAR.length;

  return (
    <>
      <PlainButton
        onClick={() => setAcik(true)}
        aria-haspopup="dialog"
        className="-ml-2 flex min-h-[44px] min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-slate-500 transition hover:text-slate-800"
      >
        <span className="shrink-0 tabular-nums">
          Adım {adimNo + 1} / {toplam}
        </span>
        <span aria-hidden="true" className="text-slate-300">
          ·
        </span>
        <span className="truncate">{ADIMLAR[adimNo].kisaAd}</span>
        <svg
          className="h-4 w-4 shrink-0 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </PlainButton>

      <Modal
        open={acik}
        onClose={() => setAcik(false)}
        title="İlanının adımları"
        description="Tamamladığın adımlara geri dönebilirsin."
      >
        <ol className="mt-2">
          {ADIMLAR.map((a, i) => {
            const acilabilir = i <= enUzak;
            const suAn = i === adimNo;
            return (
              <li key={a.anahtar}>
                <PlainButton
                  onClick={() => {
                    if (!acilabilir) return;
                    setAcik(false);
                    git(i);
                  }}
                  disabled={!acilabilir}
                  aria-current={suAn ? "step" : undefined}
                  className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition ${
                    acilabilir
                      ? "text-slate-800 hover:bg-slate-50"
                      : "cursor-not-allowed text-slate-300"
                  } ${suAn ? "font-semibold text-indigo-700" : ""}`}
                >
                  <span className="w-5 shrink-0 text-center text-[13px] tabular-nums text-slate-400">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate">{a.kisaAd}</span>
                  {suAn && (
                    <span className="shrink-0 text-[12px] font-medium text-indigo-600">
                      buradasın
                    </span>
                  )}
                </PlainButton>
              </li>
            );
          })}
        </ol>
      </Modal>
    </>
  );
}

/**
 * Adımın yardım kartı.
 *
 * TASARIM DİLİNDEN BİLİNÇLİ SAPMA (5 Eyl 2026, kullanıcı kararı). Eskiden bu
 * bir kutu DEĞİLDİ: sol kenarında saç teli çizgi olan soluk gri bir paragraftı
 * ve `docs/tasarim-dili.md`nin "kart enflasyonu yasaktır" kuralına uyuyordu.
 * Kullanıcı akışı gerçek bir sunucuda kullandı ve "neyin ne olduğu belli
 * değil" dedi: her adımda aklındaki "bunu neden soruyorsunuz, ne yazmam
 * lazım" sorusu ekranda cevaplanmıyordu. Superprof'un aynı akışı bunu dolgulu
 * bir kartla çözüyor ve okunurluğu oradan geliyor.
 *
 * İstisnanın kapsamı ve gerekçesi `docs/tasarim-dili.md` → "Ek A"da yazılı;
 * rengin sızmasının nöbetçisi `src/__guards__/sihirbazMercani.test.ts`.
 *
 * MOBİLDE KART FORMUN ALTINDA ve KAPALI durur. Ön başvuru turunda ölçülmüştü:
 * anlatıyı formun üstüne koymak, dar ekranda asıl soruyu ekran dışına itiyor.
 * Kart DOM'da tek kopyadır; sıra `order-*` ile çevrilir — iki kopya render
 * etmek ekran okuyucuya aynı yardımı iki kez okuturdu.
 */
export function BilgiKarti({
  ipucu,
  ornekler,
  hatirlatma,
  ad,
}: {
  ipucu?: string;
  ornekler?: string[];
  hatirlatma?: string;
  /** Hatırlatma satırında kullanıcıya adıyla seslenmek için. */
  ad?: string;
}) {
  // Masaüstünde kart HER ZAMAN açık; mobilde kullanıcı açıp kapatır. Tek
  // `<details>` iki davranışı da taşır — ikinci bir kopya render etmek ekran
  // okuyucuya aynı yardımı iki kez okuturdu.
  const [acik, setAcik] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const uygula = () => {
      if (mq.matches) setAcik(true);
    };
    uygula();
    mq.addEventListener("change", uygula);
    return () => mq.removeEventListener("change", uygula);
  }, []);

  if (!ipucu && !ornekler?.length && !hatirlatma) return null;

  return (
    <details
      open={acik}
      onToggle={(e) => setAcik((e.currentTarget as HTMLDetailsElement).open)}
      className={`${BILGI.zemin} ${BILGI.kenar} rounded-3xl border px-6 py-5`}
    >
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold ${BILGI.baslik} lg:hidden [&::-webkit-details-marker]:hidden`}
      >
        Nasıl yazılır?
        <svg
          className="h-5 w-5 shrink-0 transition-transform"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" d={acik ? "M5 12h14" : "M12 5v14M5 12h14"} />
        </svg>
      </summary>

      <p className={`hidden text-[17px] font-semibold ${BILGI.baslik} lg:block`}>
        Bilgi
      </p>

      {ipucu && (
        <p className={`mt-3 text-[14px] leading-relaxed ${BILGI.metin}`}>
          {ipucu}
        </p>
      )}

      {!!ornekler?.length && (
        <>
          <p className={`mt-5 text-[13px] font-semibold uppercase tracking-wide ${BILGI.baslik}`}>
            İyi örnek
          </p>
          <ul className={`mt-2 space-y-2 text-[14px] leading-relaxed ${BILGI.metin}`}>
            {ornekler.map((o) => (
              <li key={o} className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {hatirlatma && (
        <p className={`mt-5 text-[13px] leading-relaxed ${BILGI.metin}`}>
          <span className={`font-semibold ${BILGI.baslik}`}>
            {ad ? `Unutma ${ad},` : "Unutma,"}
          </span>{" "}
          {hatirlatma}
        </p>
      )}
    </details>
  );
}

/**
 * Masaüstünde iki sütun: solda yardım, sağda soru. Mobilde tek sütun ve
 * yardım ALTTA (`order-*`), çünkü ilk görülmesi gereken şey sorunun kendisi.
 */
export function IkiKolon({
  bilgi,
  children,
}: {
  bilgi: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start lg:gap-14">
      {/* SORU DOM'DA ÖNCE gelir. Mobilde kapsayıcı grid DEĞİL (yalnız `lg:`),
          dolayısıyla `order-*` orada hiçbir şey yapmaz ve DOM sırası ekran
          sırasıdır. Yardımı DOM'da öne almak, dar ekranda asıl soruyu ekran
          dışına iterdi — ön başvuru turunda ölçülen kusurun ta kendisi.
          Masaüstünde sol/sağ yerleşim `lg:order-*` ile çevrilir. */}
      <div className="lg:order-2">{children}</div>
      <div className="mt-10 lg:order-1 lg:mt-0 lg:sticky lg:top-8">{bilgi}</div>
    </div>
  );
}

/**
 * Başlığı iki renkli basar: `vurgu` sözcüğü mercan, gerisi koyu.
 *
 * Eşleşme `indexOf` ile yapılır, RegExp ile DEĞİL: Türkçe'de büyük/küçük harf
 * dönüşümü (İ/ı, I/i) düzenli ifadelerde tuzaklı ve başlıklar Türkçe. Sözcük
 * başlıkta geçmiyorsa başlık tek renk çizilir — sessiz bozulma yok.
 */
function DevBaslik({ baslik, vurgu }: { baslik: string; vurgu?: string }) {
  const i = vurgu ? baslik.indexOf(vurgu) : -1;
  if (i < 0 || !vurgu) return <>{baslik}</>;
  return (
    <>
      {baslik.slice(0, i)}
      <span className={MERCAN.metin}>{vurgu}</span>
      {baslik.slice(i + vurgu.length)}
    </>
  );
}

/** Adımın başlığı ve gövdesi. */
export function AdimGovde({
  baslik,
  vurgu,
  altBaslik,
  children,
}: {
  baslik: string;
  vurgu?: string;
  altBaslik?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h1 className="text-[30px] font-bold leading-[1.12] tracking-tight text-slate-900 sm:text-[40px] lg:text-[46px]">
        <DevBaslik baslik={baslik} vurgu={vurgu} />
      </h1>
      {altBaslik && (
        <p className="mt-3 text-[15px] leading-relaxed text-slate-500">
          {altBaslik}
        </p>
      )}
      <div className="mt-8">{children}</div>
    </div>
  );
}

/** Adım doğrulaması geçmediğinde alanın hemen altında beliren satır. */
export function AdimHatasi({ mesaj }: { mesaj: string }) {
  return (
    <p
      role="alert"
      className="mt-6 flex items-start gap-2 text-[14px] leading-relaxed text-rose-600"
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
          clipRule="evenodd"
        />
      </svg>
      {mesaj}
    </p>
  );
}

/**
 * Alt aksiyon çubuğu.
 *
 * Mobilde ekranın altına sabitlenir. iOS'ta `position: fixed` bir öğe, yazılım
 * klavyesi açılınca görsel alanın dışında kalır: `visualViewport` dinlenip
 * çubuk elle yukarı çekilir. Klavye açıkken "devam" düğmesinin kaybolması,
 * akışı tam ortasından kesen bir arıza.
 *
 * Düzen iki satır: birincil düğme kendi satırında tam genişlik (mobilde en
 * büyük hedef o olmalı), "atla" ise altında ayrı bir metin bağlantısı — yan
 * yana dizmek dar ekranda birincil hedefi kırpıyordu.
 */
export function AksiyonCubugu({
  geri,
  ileri,
  ileriEtiket,
  bekliyor,
  atla,
}: {
  geri?: () => void;
  ileri: () => void;
  /** Sıradaki adımı ADIYLA söyler; "İleri" gibi jenerik bir sözcük değil. */
  ileriEtiket: string;
  bekliyor?: boolean;
  atla?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const uyarla = () => {
      const el = ref.current;
      if (!el) return;
      const fark = window.innerHeight - vv.height;
      // Küçük farklar adres çubuğunun gizlenmesidir, klavye değil.
      el.style.transform = fark > 120 ? `translateY(-${fark}px)` : "";
    };
    vv.addEventListener("resize", uyarla);
    vv.addEventListener("scroll", uyarla);
    return () => {
      vv.removeEventListener("resize", uyarla);
      vv.removeEventListener("scroll", uyarla);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-sm sm:static sm:border-0 sm:bg-transparent sm:backdrop-blur-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto max-w-5xl px-5 py-3 sm:px-0 sm:py-0 lg:max-w-none">
        <div className="flex items-center gap-3">
          {geri && (
            <PlainButton
              onClick={geri}
              aria-label="Önceki adım"
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 sm:h-12 sm:w-12`}
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </PlainButton>
          )}
          <button
            type="button"
            onClick={ileri}
            disabled={bekliyor}
            className={`h-14 flex-1 truncate rounded-full ${MERCAN.zemin} ${MERCAN.zeminHover} px-6 text-[16px] font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2695E] disabled:cursor-not-allowed disabled:opacity-60 sm:h-12 sm:text-[15px]`}
          >
            {bekliyor ? "Kaydediliyor…" : ileriEtiket}
          </button>
        </div>
        {atla && (
          <PlainButton
            onClick={atla}
            className="mt-1 flex min-h-[44px] w-full items-center justify-center rounded-lg text-[14px] font-medium text-slate-500 transition hover:text-slate-800"
          >
            Bu adımı şimdilik atla
          </PlainButton>
        )}
      </div>
    </div>
  );
}
