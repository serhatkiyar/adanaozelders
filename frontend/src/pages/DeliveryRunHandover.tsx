// Kurye zimmet ekranı (F30 sözleşme §3.4) — paketleri **araca alma** anı.
//
// Bu ekran teslim ekranı DEĞİLDİR ve öyle görünmemelidir. İkisi sahada aynı
// telefonda, dakikalar arayla kullanılır:
//
//   • zimmet (burası) → depoda, tur başında: "bu kutu bende"
//   • kapı taraması   → adreste: "bu kutuyu müşteriye verdim"
//
// Bu yüzden dil bilinçli olarak "zimmetle / araca al"dır; hiçbir yerde
// "teslim et" geçmez. Yanlış ekranda doğru refleksi uygulayan kurye, paketi
// depoda "teslim edilmiş" saydırırdı.
//
// **Eksik paket burada görünür.** Eksiği ancak turu başlatırken (409)
// öğrenmek, onu depoda değil yolda fark etmek demektir — manifest N/M sayacı
// ve satır rozetleri tam olarak bunun için var.
import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ETIKET_TANINMADI, manifestErrorMessage, scanErrorMessage } from "@/api/handover";
import { QrScanner } from "@/components/QrScanner";
import { useHandoverManifest, useHandoverScan } from "@/hooks/useHandover";
import { RUN_STATUS_LABEL } from "@/lib/deliveryRun";
import { isPackagePayload, PACKAGE_STATUS_LABEL } from "@/lib/packing";
import { qrScanMode, readQrEnvironment } from "@/lib/qrCapability";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";

import type { HandoverManifestRow } from "@/api/handover";
import type { PackageStatus } from "@/types/packing";

type SonucTuru = "ok" | "tekrar" | "hata";

interface TaramaSonucu {
  tur: SonucTuru;
  mesaj: string;
}

/** Satır rozeti — ham enum ekranda görünmez, `null` "paket yok" demektir. */
function durumEtiketi(row: HandoverManifestRow): string {
  if (row.package_status == null) return "Paket kaydı yok";
  const tablo = PACKAGE_STATUS_LABEL as Record<string, string | undefined>;
  return tablo[row.package_status as PackageStatus] ?? row.package_status;
}

/** Rozet rengi: yalnız "araçta" yeşildir; geri kalanı dikkat ister. */
function rozetSinifi(row: HandoverManifestRow): string {
  if (row.handed_over) {
    return "bg-emerald-50 text-emerald-700 ";
  }
  if (row.package_status === "PACKED") {
    return "bg-amber-50 text-amber-800 ";
  }
  return "bg-slate-100 text-slate-600 ";
}

export default function DeliveryRunHandover() {
  const { id } = useParams();
  const runId = Number(id);
  const gecerliTur = Number.isFinite(runId);
  const manifestQuery = useHandoverManifest(gecerliTur ? runId : null, { poll: true });
  const manifest = manifestQuery.data;
  const scan = useHandoverScan();

  const [kod, setKod] = useState("");
  const [sonuc, setSonuc] = useState<TaramaSonucu | null>(null);
  const [kameraAcik, setKameraAcik] = useState(false);
  const kutuRef = useRef<HTMLInputElement>(null);
  // Bu oturumda BİZİM okuttuğumuz paketler. Manifest tazelenene kadar (ya da
  // tazeleme düşerse hiç) ikinci okutmayı "tekrar" olarak tanıyabilmemiz için
  // gerekli: sunucu idempotenttir ve iki okutmaya da aynı 200'ü döner.
  const okutulanlar = useRef<Set<number>>(new Set());

  // Kamera yalnız gerçekten kullanılabilirse açılır. Kamera yoksa QrScanner
  // kendi manuel kutusunu gösterirdi ve sayfada İKİ kod kutusu olurdu —
  // aceleci kurye için ikisi de "doğru" görünen iki farklı yol demek.
  const kameraVar = useMemo(
    () => typeof window !== "undefined" && qrScanMode(readQrEnvironment(window)) === "camera",
    []
  );

  const satirlar = manifest?.rows ?? [];
  const toplam = manifest?.total ?? 0;
  const alinan = manifest?.handed_over ?? 0;
  const eksik = Math.max(0, toplam - alinan);

  const odaklan = () => kutuRef.current?.focus();

  const paketSatiri = (packageId: number) =>
    satirlar.find((r) => r.package_id === packageId) ?? null;

  const gonder = (ham: string) => {
    const deger = ham.trim();
    // Çift gönderim engeli: barkod okuyucu Enter'ı iki kez üretebilir ve
    // sahada aynı kutu iki kez okutulur. Sunucu idempotent olsa bile ikinci
    // isteğin yanıtı ekranda ilkini ezerdi.
    if (!deger || scan.isPending) return;

    // Yanlış QR türü İSTEMCİDE ayrılır ve sunucuya HİÇ gitmez: durak yükü
    // (`{stop_id}:{token}`) zimmet ucunda 404 üretirdi ve o 404 "etiket
    // tanınmadı" der — yani hatayı YANLIŞ yere işaret ederdi. Kurye elindeki
    // kutuyu suçlar, oysa yalnızca yanlış ekrandadır.
    if (!isPackagePayload(deger)) {
      setSonuc({
        tur: "hata",
        mesaj:
          "Bu bir paket etiketi değil, okuttuğun kod durak/teslimat etiketine " +
          "benziyor. Zimmet için kutunun üstündeki paket QR'ını okut " +
          "(kod PKT- ile başlar).",
      });
      setKod("");
      odaklan();
      return;
    }

    scan.mutate(deger, {
      onSuccess: (paket) => {
        const satir = paketSatiri(paket.id);
        const oncedenAlindi = satir?.handed_over === true || okutulanlar.current.has(paket.id);
        okutulanlar.current.add(paket.id);
        if (paket.status !== "HANDED_OVER") {
          // Sunucu 200 döndü ama paket zimmetli değil: beklenmeyen bir durum,
          // sessizce "tamam" demek yanlış olurdu.
          setSonuc({
            tur: "hata",
            mesaj: `${paket.code} zimmetlenemedi, sunucu paketi "${paket.status}" durumunda bildirdi.`,
          });
          return;
        }
        if (oncedenAlindi) {
          // Tekrar okutma yan etkisizdir (sunucu idempotent) ama SESSİZ
          // geçilmemeli: kurye ikinci bir kutu aradığını sanmasın.
          setSonuc({
            tur: "tekrar",
            mesaj: `${paket.code} zaten zimmetli, bu paket araçta, ikinci kayıt oluşmadı.`,
          });
          toast.info(`${paket.code} zaten araçta.`);
          return;
        }
        setSonuc({ tur: "ok", mesaj: `${paket.code} araca alındı.` });
        toast.success(`${paket.code} zimmetlendi ✓`);
      },
      onError: (e) => {
        const mesaj = scanErrorMessage(e, ETIKET_TANINMADI);
        setSonuc({ tur: "hata", mesaj });
        toast.error(mesaj);
      },
      onSettled: () => {
        // Odak her okutmadan sonra kutuya döner: barkod okuyucu klavye gibi
        // yazar ve odak kaybolursa bir sonraki okutma HİÇBİR YERE gitmez.
        setKod("");
        odaklan();
      },
    });
  };

  if (!gecerliTur) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-sm text-slate-500 ">
        Geçersiz tur adresi.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10 ">
      <header
        data-testid="zimmet-baslik"
        className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur "
      >
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <Link
            to={ROUTES.deliveryRun(runId)}
            className="shrink-0 text-sm font-semibold text-slate-500 "
          >
            ← Tura dön
          </Link>
          <h1 className="truncate text-sm font-bold text-slate-900 ">
            Zimmet · Tur #{runId}
          </h1>
          <span className="shrink-0 text-xs font-medium text-slate-500 ">
            {manifest ? (RUN_STATUS_LABEL[manifest.run_status] ?? manifest.run_status) : "-"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {/* ── Sayaç: kaç paket araçta / turda kaç paket var ── */}
        <section
          data-testid="zimmet-ozet"
          className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-100 "
        >
          {manifestQuery.isLoading ? (
            <p className="text-sm text-slate-500 ">Zimmet listesi yükleniyor…</p>
          ) : manifestQuery.isError ? (
            <div role="status" className="space-y-3">
              <p className="text-sm font-semibold text-rose-600 ">
                {manifestErrorMessage(manifestQuery.error)}
              </p>
              <button
                onClick={() => manifestQuery.refetch()}
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white "
              >
                Yeniden Dene
              </button>
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums text-slate-900 ">
                {alinan} / {toplam}
              </p>
              <p className="mt-1 text-sm text-slate-600 ">
                paket araca alındı
              </p>
              <p
                className={`mt-2 text-sm font-semibold ${
                  eksik > 0
                    ? "text-amber-700 "
                    : "text-emerald-600 "
                }`}
              >
                {eksik > 0
                  ? `${eksik} paket eksik, yola çıkmadan önce hepsini okut.`
                  : "Eksik paket yok, yola çıkabilirsin."}
              </p>
            </>
          )}
        </section>

        {/* ── Tarama alanı: manuel giriş HER ZAMAN açık ── */}
        <section
          data-testid="zimmet-tarama"
          className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 "
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              gonder(kod);
            }}
            className="flex gap-2"
          >
            <input
              ref={kutuRef}
              type="text"
              value={kod}
              onChange={(e) => setKod(e.target.value)}
              aria-label="Paket etiketi kodu"
              placeholder="PKG1:12:… (etiketteki kod)"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              // `autoFocus` burada bilinçli (jsx-a11y uyarısı kabul edildi):
              // ekranın TEK işi okutmak ve barkod okuyucu klavye gibi yazar —
              // odak kutuda değilse ilk okutma hiçbir yere gitmez.
              autoFocus
              className="input min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={!kod.trim() || scan.isPending}
              className="shrink-0 rounded-xl bg-marka px-5 py-2.5 text-sm font-bold text-marka-fg disabled:opacity-50"
            >
              {scan.isPending ? "Okunuyor…" : "Zimmetle"}
            </button>
          </form>
          <p className="text-xs text-slate-500 ">
            Barkod okuyucuyla okutabilir ya da kodu elle yazıp Enter'a basabilirsin.
          </p>
          {kameraVar && (
            <button
              type="button"
              onClick={() => setKameraAcik((a) => !a)}
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 "
            >
              {kameraAcik ? "Kamerayı kapat" : "Kamerayla okut"}
            </button>
          )}
          {kameraVar && kameraAcik && (
            <QrScanner
              onScan={(v) => {
                setKameraAcik(false);
                gonder(v);
              }}
              onClose={() => setKameraAcik(false)}
            />
          )}
        </section>

        {/* ── Son okutma sonucu: SAYFA İÇİNDE, toast'a bağlı değil ──
            Sahada telefon cebe girip çıkar; kaybolan bir toast, olmayan bir
            geri bildirimdir. Renk tek ayırt edici DEĞİL: her sonuç metinle de
            (✓ / ⟳ / ✕ + cümle) söylenir. */}
        {sonuc && (
          <p
            role="alert"
            data-testid="zimmet-sonuc"
            className={`rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ${
              sonuc.tur === "ok"
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200 "
                : sonuc.tur === "tekrar"
                  ? "bg-slate-50 text-slate-700 ring-slate-200 "
                  : "bg-rose-50 text-rose-800 ring-rose-200 "
            }`}
          >
            {sonuc.tur === "ok" ? "✓ " : sonuc.tur === "tekrar" ? "⟳ " : "✕ "}
            {sonuc.mesaj}
          </p>
        )}

        {/* ── Manifest ── */}
        <section data-testid="zimmet-manifest" className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 ">
            Bu turun paketleri
          </h2>
          {satirlar.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-100 ">
              {manifestQuery.isLoading ? "Yükleniyor…" : "Bu turda bekleyen durak yok."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl bg-white px-4 ring-1 ring-slate-100 ">
              {satirlar.map((row) => (
                <li
                  key={row.stop_id}
                  data-testid={`zimmet-satir-${row.stop_id}`}
                  className="flex items-center gap-3 py-3"
                >
                  <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-400">
                    {row.sequence}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 ">
                      {row.package_code ?? "Etiket yok"}
                    </span>
                    <span className="block text-xs text-slate-500 ">
                      Sipariş #{row.order_id}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${rozetSinifi(row)}`}
                  >
                    {row.handed_over ? "Araçta" : durumEtiketi(row)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="px-1 text-xs text-slate-400 ">
            Alıcı adı ve adresi burada gösterilmez, depoda kutuyu etiketteki kodla
            eşlersin; müşteri bilgisi kapıda, saha ekranında görünür.
          </p>
        </section>
      </main>
    </div>
  );
}
