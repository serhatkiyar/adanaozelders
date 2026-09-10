import { useState, type ReactNode } from "react";

import { PlainButton } from "@/components/ui/PlainButton";
import { SEKIL_ADI, type DersSekli } from "@/components/AramaSecicileri";
import { useSubjects } from "@/hooks/useSubjects";
import { dersAra } from "@/lib/dersArama";
import { LIBRARY_TRENDING_SEARCHES, TRENDING_SEARCHES } from "@/lib/trendingSearches";
import { yerAra, yerEtiketi, type YerSecimi } from "@/lib/yerArama";
import { TeachingMode } from "@/types";

/* ────────────────────────────────────────────────────────────────────────────
   TELEFONDA ADIMLI ARAMA (Airbnb deseni) — kullanıcı kararı, 10 Eyl 2026.

   Referans ekran: Airbnb mobil arama yüzeyi. Tek açık kart + altında kapalı
   satırlar; her kapalı satırda solda alan adı, sağda ya seçili değer ya da
   davet metni. Altta "Hepsini temizle" ve birincil "Ara" düğmesi.

   ## Neden ayrı bir mobil form (MobilAramaSheet'teki eski karar DEĞİŞTİ)

   O dosya "kopya bir mobil form yazılmasın, aynı hap geçilsin" diyordu ve o
   gün doğruydu: hap dikeye dönüyor, `aramaHapiIkizligi` nöbetçisinin koruduğu
   teklik bozulmuyordu. Ama hap TEK BAKIŞTA tüm alanları gösteren bir yüzeydir;
   telefonda üç alan alt alta açık durunca ekran doluyor ve hiçbir alan
   önceliklenmiyordu. Airbnb deseni sırayı görünür kılıyor: önce ne, sonra
   nerede, sonra nasıl.

   İKİZLİK BOZULMADI: masaüstündeki iki hap (`DersArama`, `KutuphaneArama`)
   hâlâ tek tasarım ve kabukta yaşıyor. Bu dosya ÜÇÜNCÜ BİR HAP DEĞİL, farklı
   bir YÜZEY — telefonun tam ekran arama adımları. Nöbetçi, üçüncü hap
   tasarımının çağrıldığı yerleri HAM METİNLE tarar; burada hap
   bileşenlerinin hiçbiri çağrılmaz (bileşenin adını bu yorumda yazmak bile
   nöbetçiyi tetikler — ölçüldü).

   ## Veri

   Öneriler uydurulmaz: dersler `useSubjects("secim")` katalogundan
   (`dersAra` ile), yerler `lib/yerArama`dan, trend başlıklar
   `lib/trendingSearches`ten gelir.
   ──────────────────────────────────────────────────────────────────────── */

type Adim = "ne" | "nerede" | "nasil";

/** Kapalı satır: solda alan adı, sağda değer ya da davet. */
function KapaliSatir({
  etiket,
  deger,
  davet,
  onAc,
}: {
  etiket: string;
  deger: string | null;
  davet: string;
  onAc: () => void;
}) {
  return (
    <PlainButton
      onClick={onAc}
      className="flex min-h-[64px] w-full items-center justify-between gap-4 rounded-2xl bg-white px-5 text-left shadow-sm ring-1 ring-slate-100 transition active:scale-[0.99]"
    >
      <span className="text-sm font-medium text-slate-500">{etiket}</span>
      <span
        className={`truncate text-sm font-semibold ${
          deger ? "text-slate-900" : "text-slate-400"
        }`}
      >
        {deger || davet}
      </span>
    </PlainButton>
  );
}

/** Açık kart: başlık + içerik. */
function AcikKart({ baslik, children }: { baslik: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <h2 className="text-xl font-bold text-slate-900">{baslik}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Arama kutusu — kart içindeki tek satırlık girdi. */
function Kutu({
  deger,
  onDegis,
  ipucu,
  etiket,
}: {
  deger: string;
  onDegis: (v: string) => void;
  ipucu: string;
  etiket: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 focus-within:border-marka-mid focus-within:ring-2 focus-within:ring-marka-focus/30">
      <svg
        className="h-5 w-5 shrink-0 text-slate-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
      </svg>
      <input
        type="text"
        value={deger}
        onChange={(e) => onDegis(e.target.value)}
        placeholder={ipucu}
        aria-label={etiket}
        className="min-h-[56px] w-full border-0 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
      />
    </div>
  );
}

/** Öneri satırı — solda yuvarlak kare simge kabı, sağda iki satır metin. */
function OneriSatiri({
  simge,
  baslik,
  altBaslik,
  onSec,
}: {
  simge: ReactNode;
  baslik: string;
  altBaslik?: string;
  onSec: () => void;
}) {
  return (
    <PlainButton
      onClick={onSec}
      className="flex min-h-[64px] w-full items-center gap-4 rounded-xl px-1 text-left transition active:scale-[0.99] hover:bg-slate-50"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-marka-soft text-xl">
        {simge}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base font-semibold text-slate-900">
          {baslik}
        </span>
        {altBaslik && (
          <span className="block truncate text-sm text-slate-500">{altBaslik}</span>
        )}
      </span>
    </PlainButton>
  );
}

export function AramaAdimlari({
  kutuphaneMi,
  ders,
  dersEtiket,
  onDersChange,
  sekil,
  setSekil,
  yer,
  setYer,
  kutuphaneQ,
  setKutuphaneQ,
  onAra,
  onTemizle,
}: {
  kutuphaneMi: boolean;
  ders: string;
  dersEtiket: string;
  onDersChange: (q: string, etiket: string) => void;
  sekil: DersSekli;
  setSekil: (v: DersSekli) => void;
  yer: YerSecimi | null;
  setYer: (v: YerSecimi | null) => void;
  kutuphaneQ: string;
  setKutuphaneQ: (v: string) => void;
  onAra: () => void;
  onTemizle: () => void;
}) {
  const [adim, setAdim] = useState<Adim>("ne");
  const [yerMetni, setYerMetni] = useState("");

  const { data: katalog } = useSubjects("secim");
  const metin = kutuphaneMi ? kutuphaneQ : dersEtiket;

  /* Ders önerileri: kutu boşken trend başlıklar, yazarken katalog araması.
     Kütüphanede katalog yok — orada yalnız trend başlıklar var. */
  /* `dersAra` GRUPLU döner (Matematik ▸ TYT Matematik…); adım listesi düz bir
     satır dizisi istiyor, o yüzden gruplar düzleştirilip ilk altısı alınır. */
  const dersOnerileri = kutuphaneMi
    ? []
    : dersAra(katalog, ders && metin === dersEtiket ? "" : metin)
        .flatMap((g) => g.dersler)
        .slice(0, 6);
  /* Liste kart içinde birkaç satır kalır (referansta da öyle): tamamı
     basılırsa kapalı adımlar ve "Ara" düğmesi katlamanın altına düşer. */
  const trend = (kutuphaneMi ? LIBRARY_TRENDING_SEARCHES : TRENDING_SEARCHES).slice(0, 5);

  /* Ders listesiyle AYNI kural: kart içinde birkaç satır. Tam liste
     basılırsa alttaki adımlar ve "Ara" düğmesi katlamanın altına düşer. */
  /* `slice` ŞART: `yerAra` boş sorguda `limit`i UYGULAMIYOR — o dalda tüm
     ilçeleri döndürüyor (`lib/yerArama.ts`). Sınırı burada koymazsak liste
     alttaki adımları ve "Ara" düğmesini katlamanın altına itiyor. */
  const yerOnerileri = yerAra(yerMetni, 5).slice(0, 5);

  const neBasligi = kutuphaneMi ? "Ne arıyorsun?" : "Hangi ders?";
  const neDegeri = kutuphaneMi ? kutuphaneQ : dersEtiket;

  return (
    <div className="flex h-full flex-col">
      {/* `min-h-0` ŞART: flex çocuğunun varsayılan `min-height:auto`'su
          içeriğe göre büyür ve `overflow-y-auto` hiçbir şey yapmaz — alt
          eylem çubuğu ekranın dışına taşardı (ölçüldü, 10 Eyl 2026). */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
        {/* ── 1. NE ── */}
        {adim === "ne" ? (
          <AcikKart baslik={neBasligi}>
            <Kutu
              deger={metin}
              onDegis={(v) =>
                kutuphaneMi ? setKutuphaneQ(v) : onDersChange("", v)
              }
              ipucu={kutuphaneMi ? "Kütüphane adı, semt…" : "Matematik, İngilizce…"}
              etiket={neBasligi}
            />
            <p className="mt-5 text-sm font-medium text-slate-500">
              {metin.trim() ? "Sonuçlar" : "Popüler aramalar"}
            </p>
            <div className="mt-1">
              {metin.trim() && dersOnerileri.length > 0
                ? dersOnerileri.map((d) => (
                    <OneriSatiri
                      key={d.id}
                      simge="📘"
                      baslik={d.name}
                      onSec={() => {
                        onDersChange(d.name, d.name);
                        setAdim("nasil");
                      }}
                    />
                  ))
                : trend.map((t) => (
                    <OneriSatiri
                      key={t}
                      simge={kutuphaneMi ? "📚" : "📘"}
                      baslik={t}
                      onSec={() => {
                        if (kutuphaneMi) setKutuphaneQ(t);
                        else onDersChange("", t);
                        setAdim("nerede");
                      }}
                    />
                  ))}
            </div>
          </AcikKart>
        ) : (
          <KapaliSatir
            etiket={kutuphaneMi ? "Arama" : "Ders"}
            deger={neDegeri || null}
            davet={kutuphaneMi ? "Ne arıyorsun?" : "Ders ekle"}
            onAc={() => setAdim("ne")}
          />
        )}

        {/* ── 2. NASIL (yalnız eğitmen) ── */}
        {!kutuphaneMi &&
          (adim === "nasil" ? (
            <AcikKart baslik="Ders nasıl işlensin?">
              <div className="space-y-1">
                {([
                  ["", "Fark etmez", "Uzaktan ve yüz yüze eğitmenlerin hepsi"],
                  [TeachingMode.ONLINE, SEKIL_ADI[TeachingMode.ONLINE], "Görüntülü ders"],
                  [
                    TeachingMode.IN_PERSON,
                    SEKIL_ADI[TeachingMode.IN_PERSON],
                    "Belirli bir semtte buluşarak",
                  ],
                ] as const).map(([deger, baslik, alt]) => (
                  <OneriSatiri
                    key={baslik}
                    simge={deger === TeachingMode.ONLINE ? "💻" : deger === TeachingMode.IN_PERSON ? "📍" : "✨"}
                    baslik={baslik}
                    altBaslik={alt}
                    onSec={() => {
                      setSekil(deger as DersSekli);
                      /* Yer YALNIZ yüz yüzede sorulur — uzaktan ders arayana
                         semt sormak anlamsız (mevcut kural, `DersArama`). */
                      setAdim(deger === TeachingMode.IN_PERSON ? "nerede" : "ne");
                    }}
                  />
                ))}
              </div>
            </AcikKart>
          ) : (
            <KapaliSatir
              etiket="Ders şekli"
              deger={sekil ? SEKIL_ADI[sekil] : null}
              davet="Fark etmez"
              onAc={() => setAdim("nasil")}
            />
          ))}

        {/* ── 3. NEREDE ── */}
        {adim === "nerede" ? (
          <AcikKart baslik="Nerede?">
            <Kutu
              deger={yerMetni}
              onDegis={setYerMetni}
              ipucu="İlçe veya mahalle"
              etiket="Yer"
            />
            <p className="mt-5 text-sm font-medium text-slate-500">Önerilen yerler</p>
            <div className="mt-1">
              {yer && (
                <OneriSatiri
                  simge="✕"
                  baslik="Yer seçimini kaldır"
                  altBaslik={yerEtiketi(yer)}
                  onSec={() => {
                    setYer(null);
                    setYerMetni("");
                  }}
                />
              )}
              {yerOnerileri.map((o) => (
                <OneriSatiri
                  key={`${o.secim.tur}-${o.baslik}-${o.altBaslik}`}
                  simge="📍"
                  baslik={o.baslik}
                  altBaslik={o.altBaslik}
                  onSec={() => {
                    setYer(o.secim);
                    setYerMetni("");
                    setAdim("ne");
                  }}
                />
              ))}
            </div>
          </AcikKart>
        ) : (
          <KapaliSatir
            etiket="Yer"
            deger={yerEtiketi(yer) || null}
            davet="Konum ekle"
            onAc={() => setAdim("nerede")}
          />
        )}
      </div>

      {/* ── Alt eylem çubuğu ── */}
      <div
        className="flex items-center justify-between gap-4 border-t border-slate-200 bg-white px-1 pt-3"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <PlainButton
          onClick={onTemizle}
          className="min-h-[44px] px-2 text-sm font-semibold text-slate-900 underline underline-offset-4 transition active:scale-95"
        >
          Hepsini temizle
        </PlainButton>
        <PlainButton
          onClick={onAra}
          className="flex min-h-[52px] items-center gap-2 rounded-full bg-marka px-7 text-base font-semibold text-marka-fg shadow-sm transition hover:bg-marka-hover active:scale-95"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
          </svg>
          Ara
        </PlainButton>
      </div>
    </div>
  );
}
