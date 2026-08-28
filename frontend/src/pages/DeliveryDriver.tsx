// Dağıtıcı saha ekranı (mobil, ADMIN) — "vur-kaç" akışı.
// Araçta şoför sürer, dağıtıcı bu ekranı kullanır: sıradaki durağı görür,
// "Yol Tarifi Al" Google Maps'i açar (adım-adım navigasyon YAZILMAZ),
// kapıda paket QR'ı doğrulanır + müşteriye SMS'lenen kod girilir → teslim.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { trackDeliveryRun } from "@/api/delivery";
import { ETIKET_TANINMADI, scanErrorMessage } from "@/api/handover";
import { compressImage } from "@/lib/compressImage";
import { QrScanner } from "@/components/QrScanner";
import {
  useDeliverDrop,
  useDeliveryRun,
  useFailStop,
  useOverrideDeliver,
  useRunAction,
  useScanDeliveryLabel,
  useSendDeliveryOtp,
  useUploadStopPhoto,
  useVerifyDelivery,
} from "@/hooks/useDelivery";
import { useHandoverManifest } from "@/hooks/useHandover";
import { isDropPref, prefBannerText } from "@/lib/deliveryPref";
import {
  FAIL_REASON_LABEL,
  FAIL_REASONS,
  RUN_STATUS_LABEL,
  STOP_STATUS_LABEL,
  coLocatedPendingStops,
  googleNavUrl,
  nextPendingStop,
  runProgress,
} from "@/lib/deliveryRun";
import { formatEta } from "@/lib/polyline";
import { qrScanMode, readQrEnvironment } from "@/lib/qrCapability";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import { ROLE_IDS, type DeliveryStop } from "@/types";

import type { HandoverManifestRow } from "@/api/handover";

/** Saha ekranı ADMIN + COURIER ortak; yönetici-özel aksiyonlar bununla kapılanır. */
function useIsAdmin() {
  return useAuthStore((s) => s.user?.role_id === ROLE_IDS.ADMIN);
}

/** Teslim anı konumu (kanıt) — alınamazsa konumsuz devam edilir, akış bekletilmez. */
function getCoords(): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 4000 }
    );
  });
}

function apiDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data
    ?.detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

/**
 * Paket kapısı: bu durakta teslim eylemi sunulabilir mi? (F30 sözleşme §3.4)
 *
 * Kaynak, turun **zimmet manifestidir** (`GET /delivery/handover/manifest/{id}`)
 * — `DeliveryStopOut` paket durumu TAŞIMAZ, dolayısıyla tur yanıtından
 * türetilemez. Manifest bekleyen durakların her biri için paketin canlı
 * durumunu verir ve kuryenin kendi turuyla sınırlıdır.
 *
 * Kapı gerçekten yük taşır: `verify_delivery` / `deliver_drop` /
 * `override_deliver` uçları paket durumunu **denetlemez** (yalnız
 * `POST /delivery/scan` denetler). Yani depoda unutulmuş bir paketi "teslim
 * edildi" yapmayı bugün engelleyen tek şey bu ekrandır — kapı açık kalırsa
 * sipariş DELIVERED olur ama kutu raftadır.
 *
 * `bilinmiyor` hâlinde **fail-open**'dır ve bu bilinçli bir sapmadır: manifest
 * isteği düşerse ya da sipariş F30 öncesinden geldiği için hiç paket kaydı
 * yoksa (`package_status === null`), kapıyı kapatmak sahadaki bütün teslimatı
 * durdururdu. Belirsizlik sessizce yutulmaz; ekranda görünür bir uyarıya
 * dönüşür ve karar sunucuya bırakılır.
 */
type PaketKapisi =
  | { acik: true; uyari: string | null }
  | { acik: false; not: string; zimmetLinki: boolean };

function paketKapisi(
  row: HandoverManifestRow | null | undefined,
  durum: "yukleniyor" | "hazir" | "bilinmiyor"
): PaketKapisi {
  if (durum === "yukleniyor") {
    return { acik: false, not: "Paket durumu kontrol ediliyor…", zimmetLinki: false };
  }
  if (durum === "bilinmiyor" || row == null) {
    return {
      acik: true,
      uyari: "Paket durumu doğrulanamadı — teslimden önce kutunun elinde olduğundan emin ol.",
    };
  }
  if (row.package_status == null) {
    return {
      acik: true,
      uyari: "Bu siparişin paket kaydı yok (paketleme istasyonundan geçmemiş eski sipariş).",
    };
  }
  if (row.package_status === "HANDED_OVER") return { acik: true, uyari: null };
  if (row.package_status === "RETURN_PENDING") {
    return {
      acik: false,
      not:
        "Bu paketin depoya geri dönmesi bekleniyor — teslim edilemez. " +
        "Depoda okutulup kabul edilmeden yeniden yola çıkamaz.",
      zimmetLinki: false,
    };
  }
  if (row.package_status === "PACKED" || row.package_status === "OPEN") {
    return {
      acik: false,
      not:
        "Paket henüz zimmetlenmedi — depodan teslim alıp araca yüklemen gerekiyor. " +
        "Kutuyu okutmadan teslim akışı açılmaz.",
      zimmetLinki: true,
    };
  }
  return {
    acik: false,
    not: `Bu paket teslim akışına uygun değil (durum: ${row.package_status}) — yöneticini ara.`,
    zimmetLinki: false,
  };
}

/** Canlı takip yayını: tur AKTİF iken dağıtıcı telefonunun konumunu ~10 sn'de
 *  bir sunucuya iletir (müşteri haritası bunu okur). Best-effort — konum izni
 *  yoksa ya da istek düşerse saha akışı ETKİLENMEZ. */
function useCourierBroadcast(runId: number | null, active: boolean) {
  const lastSent = useRef(0);
  useEffect(() => {
    if (!active || runId == null || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSent.current < 10_000) return; // ping aralığı
        lastSent.current = now;
        trackDeliveryRun(runId, pos.coords.latitude, pos.coords.longitude).catch(
          () => {} // sessiz — takip yayını asla teslim akışını bozmasın
        );
      },
      () => {}, // izin yok/hata → yayınsız devam
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [runId, active]);
}

/* ─── Aktif durak kartı ──────────────────────────────── */

function CurrentStopCard({
  stop,
  isJumped,
  kapi,
}: {
  stop: DeliveryStop;
  isJumped?: boolean;
  /** Paket kapısı — kapalıysa hiçbir teslim eylemi ÇİZİLMEZ (fail-closed). */
  kapi: PaketKapisi;
}) {
  const isAdmin = useIsAdmin();
  const sendOtp = useSendDeliveryOtp();
  const verify = useVerifyDelivery();
  const fail = useFailStop();
  const override = useOverrideDeliver();
  const uploadPhoto = useUploadStopPhoto();
  const deliverDrop = useDeliverDrop();
  const photoRef = useRef<HTMLInputElement>(null);
  const dropMode = isDropPref(stop.delivery_pref);
  const banner = prefBannerText(stop.delivery_pref, stop.delivery_pref_note);

  const [code, setCode] = useState("");
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [mode, setMode] = useState<"deliver" | "fail" | "override">("deliver");
  const [note, setNote] = useState("");
  const [failCode, setFailCode] = useState(FAIL_REASONS[0].code);

  const navUrl = googleNavUrl(stop.lat, stop.lng, stop.address);
  const busy = verify.isPending || fail.isPending || override.isPending;

  const doVerify = async () => {
    if (code.trim().length < 4) return toast.error("Müşterinin söylediği kodu gir.");
    const coords = await getCoords();
    verify.mutate(
      { stopId: stop.id, code: code.trim(), coords },
      {
        onSuccess: () => {
          toast.success("Teslimat doğrulandı ✓");
          setCode("");
          setMaskedPhone(null);
        },
        onError: (e) => toast.error(apiDetail(e, "Kod doğrulanamadı.")),
      }
    );
  };

  return (
    <div
      data-testid="aktif-durak"
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 "
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 ">
        {isJumped ? "Seçilen durak" : "Sıradaki durak"} · #{stop.sequence}
      </p>
      <h2 className="mt-1 text-xl font-bold text-slate-900 ">
        {stop.recipient ?? "Alıcı bilinmiyor"}
      </h2>
      <p className="mt-1 whitespace-pre-line text-sm text-slate-600 ">
        {stop.address ?? "Adres yok"}
      </p>
      <p className="mt-2 text-xs text-slate-500 ">
        Sipariş #{stop.order_id} ·{" "}
        {stop.items.map((it) => `${it.title} ×${it.quantity}`).join(", ") || "—"}
        {stop.eta && (
          <span className="ml-2 font-semibold text-indigo-600 ">
            tahmini ~{formatEta(stop.eta)}
          </span>
        )}
      </p>

      {/* Müşteri talimatı — belirgin bant (15 sn poll ile canlı güncellenir) */}
      {banner && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 ring-1 ring-amber-200 ">
          {banner}
        </p>
      )}

      {/* Birincil aksiyonlar */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {navUrl && (
          <a
            href={navUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="col-span-2 rounded-xl bg-indigo-600 py-3 text-center text-base font-bold text-white hover:bg-indigo-700"
          >
            Yol Tarifi Al
          </a>
        )}
        {stop.phone && (
          <a
            href={`tel:${stop.phone}`}
            className="rounded-xl py-2.5 text-center text-sm font-semibold text-slate-700 ring-1 ring-slate-200 "
          >
            Müşteriyi Ara
          </a>
        )}
        {kapi.acik && !dropMode && (
          <button
            onClick={() =>
              sendOtp.mutate(stop.id, {
                onSuccess: (r) => {
                  // `sent` gerçek gönderim sonucu — SMS sağlayıcısı düşükken
                  // "gönderildi" deyip müşteriyi kapıda kod bekletmeyelim.
                  if (r.sent) {
                    setMaskedPhone(r.masked_phone);
                    toast.success(`Kod gönderildi (${r.masked_phone}).`);
                  } else {
                    setMaskedPhone(null);
                    toast.error(
                      "SMS gönderilemedi — tekrar dene ya da notlu teslime geç."
                    );
                  }
                },
                onError: (e) => toast.error(apiDetail(e, "Kod gönderilemedi.")),
              })
            }
            disabled={sendOtp.isPending}
            className="rounded-xl py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50 "
          >
            {sendOtp.isPending ? "Gönderiliyor…" : "Müşteriye Kod Gönder"}
          </button>
        )}
      </div>

      {/* ── Paket kapısı ──
          Kapı kapalıyken TEK BİR açıklama satırı çizilir ve teslim/kanıt
          eylemlerinin hiçbiri DOM'a girmez: "pasif buton" göstermek, kuryeye
          "bir şekilde basılabilir" izlenimi verirdi. */}
      {!kapi.acik && (
        <div className="mt-4 space-y-2 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200 ">
          <p className="text-sm font-semibold text-slate-700 ">
            {kapi.not}
          </p>
          {kapi.zimmetLinki && (
            <Link
              to={ROUTES.deliveryRunHandover(stop.run_id)}
              className="inline-block text-sm font-semibold text-indigo-600 hover:underline "
            >
              Zimmet ekranını aç →
            </Link>
          )}
        </div>
      )}
      {kapi.acik && kapi.uyari && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200 ">
          {kapi.uyari}
        </p>
      )}

      {kapi.acik && (
        <>
      {/* Teslim kanıtı fotoğrafı — kapıya/komşuya bırakmada zorunlu, normalde opsiyonel */}
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f)
            // Kamera çıktısı 3-8 MB olabilir; sahada yükleme beklemesin.
            uploadPhoto.mutate(
              { stopId: stop.id, file: await compressImage(f) },
              {
                onSuccess: () => toast.success("Kanıt fotoğrafı kaydedildi."),
                onError: (err) =>
                  toast.error(apiDetail(err, "Fotoğraf yüklenemedi.")),
              }
            );
          e.target.value = "";
        }}
      />
      <div className="mt-3 flex items-center gap-3">
        {stop.photo_url && (
          <img
            src={stop.photo_url}
            alt="Teslim kanıtı"
            className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-slate-200 "
          />
        )}
        <button
          onClick={() => photoRef.current?.click()}
          disabled={uploadPhoto.isPending}
          className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-50 "
        >
          {uploadPhoto.isPending
            ? "Yükleniyor…"
            : stop.photo_url
              ? "Fotoğrafı Yeniden Çek"
              : "Kanıt Fotoğrafı Çek"}
        </button>
      </div>

      {/* Teslim / sorun akışları */}
      {mode === "deliver" && dropMode && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-500 ">
            Müşteri talimatı: bırakma teslimi — OTP alınmaz, kanıt fotoğrafı zorunlu.
          </p>
          <button
            onClick={() =>
              deliverDrop.mutate(stop.id, {
                onSuccess: () => toast.success("Bırakma teslimi kaydedildi ✓"),
                onError: (e) => toast.error(apiDetail(e, "Teslim edilemedi.")),
              })
            }
            disabled={busy || deliverDrop.isPending || !stop.photo_url}
            className="w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {stop.photo_url ? "Bırak & Teslim Et" : "Önce kanıt fotoğrafı çek"}
          </button>
          <div className="flex justify-end pt-1 text-xs">
            <button
              onClick={() => setMode("fail")}
              className="font-medium text-rose-600 hover:underline "
            >
              Teslim edilemedi
            </button>
          </div>
        </div>
      )}

      {mode === "deliver" && !dropMode && (
        <div className="mt-4 space-y-2">
          {maskedPhone && (
            <p className="text-xs text-slate-500 ">
              Kod {maskedPhone} numarasına gitti — müşteri kodu söylesin.
            </p>
          )}
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6 haneli kod"
              className="input flex-1 text-center text-lg tracking-[0.3em]"
            />
            <button
              onClick={doVerify}
              disabled={busy}
              className="rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Teslim Et
            </button>
          </div>
          <div className="flex justify-between pt-1 text-xs">
            {isAdmin ? (
              <button
                onClick={() => setMode("override")}
                className="font-medium text-slate-500 hover:underline "
              >
                Kod ulaşmıyor mu?
              </button>
            ) : (
              // Notlu teslim (OTP bypass) yalnız yönetici yetkisi — kurye arar.
              <span className="text-slate-400 ">
                Kod ulaşmıyorsa yöneticini ara
              </span>
            )}
            <button
              onClick={() => setMode("fail")}
              className="font-medium text-rose-600 hover:underline "
            >
              Teslim edilemedi
            </button>
          </div>
        </div>
      )}

      {mode === "fail" && (
        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-700 ">
              Neden teslim edilemedi?
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {FAIL_REASONS.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => setFailCode(r.code)}
                  className={`rounded-xl px-4 py-3 text-left text-sm font-medium ring-1 transition ${
                    failCode === r.code
                      ? "bg-rose-50 text-rose-700 ring-rose-300 "
                      : "text-slate-700 ring-slate-200 "
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ek not (isteğe bağlı) — yalnız operasyon görür, müşteriye gitmez."
            rows={2}
            className="input w-full"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                fail.mutate(
                  {
                    stopId: stop.id,
                    // Serbest not boşsa neden etiketini gönder (min 3 char kuralı).
                    reason: note.trim() || FAIL_REASON_LABEL[failCode],
                    reasonCode: failCode,
                  },
                  {
                    onSuccess: () => {
                      toast.success("Durak 'teslim edilemedi' olarak işaretlendi.");
                      setNote("");
                      setFailCode(FAIL_REASONS[0].code);
                      setMode("deliver");
                    },
                    onError: (e) => toast.error(apiDetail(e, "İşaretlenemedi.")),
                  }
                )
              }
              disabled={busy}
              className="flex-1 rounded-xl bg-rose-600 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              Onayla
            </button>
            <button
              onClick={() => setMode("deliver")}
              className="rounded-xl px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 "
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {mode === "override" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-500 ">
            SMS ulaşmadıysa: teslimi notla kayda geçir (kanıt "yönetici onayı" olur).
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Not (ör. müşteri kimliğiyle doğrulandı, kod SMS'i gelmedi)"
            rows={2}
            className="input w-full"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                override.mutate(
                  { stopId: stop.id, note: note.trim() },
                  {
                    onSuccess: () => {
                      toast.success("Notlu teslim kaydedildi.");
                      setNote("");
                      setMode("deliver");
                    },
                    onError: (e) => toast.error(apiDetail(e, "Kaydedilemedi.")),
                  }
                )
              }
              disabled={busy || note.trim().length < 3}
              className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white disabled:opacity-50 "
            >
              Notlu Teslim
            </button>
            <button
              onClick={() => setMode("deliver")}
              className="rounded-xl px-4 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 "
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

/* ─── Sayfa ──────────────────────────────────────────── */

export default function DeliveryDriver() {
  const isAdmin = useIsAdmin();
  const logout = useAuthStore((s) => s.logout);
  const { id } = useParams();
  const runId = Number(id);
  const runQuery = useDeliveryRun(Number.isFinite(runId) ? runId : null, {
    poll: true,
  });
  const { data: run, isLoading } = runQuery;
  const runAction = useRunAction();
  const scanLabel = useScanDeliveryLabel();
  // Paket kapısının kaynağı: `DeliveryStopOut` paket durumu taşımaz, zimmet
  // manifesti taşır. Poll KAPALI — tur sorgusu zaten 15 sn'de bir dönüyor ve
  // manifest durak başına bir sorgu maliyetinde.
  const manifestQuery = useHandoverManifest(Number.isFinite(runId) ? runId : null);
  const [showScanner, setShowScanner] = useState(false);
  const [kod, setKod] = useState("");
  const [tarama, setTarama] = useState<{ hata: boolean; mesaj: string } | null>(null);
  const kodKutusu = useRef<HTMLInputElement>(null);
  // Kamera yoksa QrScanner kendi manuel kutusunu açardı; sayfada zaten kalıcı
  // bir kod kutusu var ve iki kutu, aceleci kuryeye iki "doğru" yol gösterir.
  const kameraVar = useMemo(
    () => typeof window !== "undefined" && qrScanMode(readQrEnvironment(window)) === "camera",
    []
  );
  // Kurye sıradakini atlayıp başka bir BEKLEYEN durağa geçebilir (kapıda kimse
  // yoksa sonrakine devam etmek gibi). Sıra DEĞİŞMEZ — yalnız ekran odağı;
  // teslim uçları zaten stop_id bazlıdır. Durak sonuçlanınca seçim düşer.
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  useCourierBroadcast(
    Number.isFinite(runId) ? runId : null,
    run?.status === "ACTIVE"
  );

  if (isLoading || !run) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center text-sm text-slate-500 ">
        {isLoading ? (
          "Tur yükleniyor…"
        ) : runQuery.isError ? (
          <>
            {/* Ağ hatası ile 404 ayrışır — sahada en sık senaryo bağlantı kopması. */}
            <p>Bağlantı kurulamadı — tur bilgisi alınamıyor.</p>
            <button
              onClick={() => runQuery.refetch()}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white "
            >
              Yeniden Dene
            </button>
          </>
        ) : (
          "Tur bulunamadı."
        )}
      </div>
    );
  }

  const nextStop = nextPendingStop(run);
  const selectedStop =
    selectedStopId != null
      ? run.stops.find((s) => s.id === selectedStopId && s.status === "PENDING") ?? null
      : null;
  const current = selectedStop ?? nextStop;
  const manifestDurumu: "yukleniyor" | "hazir" | "bilinmiyor" = manifestQuery.isLoading
    ? "yukleniyor"
    : manifestQuery.isError || !manifestQuery.data
      ? "bilinmiyor"
      : "hazir";
  const paketSatiri =
    current != null
      ? (manifestQuery.data?.rows ?? []).find((r) => r.stop_id === current.id) ?? null
      : null;
  const kapi = paketKapisi(paketSatiri, manifestDurumu);
  const [done, total] = runProgress(run);
  const delivered = run.stops.filter((s) => s.status === "DELIVERED").length;
  const failed = run.stops.filter((s) => s.status === "FAILED").length;
  const remaining = run.stops.filter((s) => s.status === "PENDING").length;

  const onScan = (value: string) => {
    const deger = value.trim();
    // Çift gönderim engeli: barkod okuyucu Enter'ı yineleyebilir, kurye de
    // "gitmedi" sanıp ikinci kez basar.
    if (!deger || scanLabel.isPending) return;
    setShowScanner(false);
    setKod("");
    scanLabel.mutate(deger, {
      onSuccess: ({ stop }) => {
        // Sonuç SAYFA İÇİNDE de yazılır: toast birkaç saniyede kaybolur ve
        // telefon o sırada cepte olabilir (kurye kutuyu taşırken okutur).
        if (stop.run_id !== run.id) {
          const m = `Bu paket başka bir turun (#${stop.run_id}).`;
          setTarama({ hata: true, mesaj: m });
          toast.error(m);
        } else if (current && stop.id === current.id) {
          const m = `Doğru paket ✓ — ${stop.recipient ?? `#${stop.order_id}`}`;
          setTarama({ hata: false, mesaj: m });
          toast.success(m);
        } else {
          const m = `Bu paket ${stop.sequence}. durağın (${stop.recipient ?? "?"}) — sıradaki ${current ? `#${current.sequence}` : "yok"}.`;
          setTarama({ hata: false, mesaj: m });
          toast.info(m);
        }
      },
      onError: (e) => {
        // `scanErrorMessage` 409'da sunucunun cümlesini korur — "paket henüz
        // zimmetlenmedi" ile "başka turun paketi" ayrımını yalnız sunucu bilir.
        const mesaj = scanErrorMessage(e, ETIKET_TANINMADI);
        setTarama({ hata: true, mesaj });
        toast.error(mesaj);
      },
      onSettled: () => kodKutusu.current?.focus(),
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-10 ">
      {/* Üst çubuk */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur ">
        <div className="mx-auto flex max-w-md items-center justify-between">
          {isAdmin ? (
            <Link
              to={ROUTES.home}
              className="text-sm font-semibold text-slate-500 "
            >
              ← Panel
            </Link>
          ) : (
            // Kurye panel görmez; tek çıkışı oturumu kapatmak.
            <button
              onClick={() => logout()}
              className="text-sm font-semibold text-slate-500 "
            >
              Çıkış
            </button>
          )}
          <p className="text-sm font-bold text-slate-900 ">
            Tur #{run.id} · {done}/{total}
          </p>
          <span className="text-xs font-medium text-slate-500 ">
            {RUN_STATUS_LABEL[run.status]}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {/* Günün özeti — kurye kendi ilerleyişini görsün */}
        {run.status === "ACTIVE" && total > 0 && (
          <div className="flex items-center justify-center gap-4 text-xs tabular-nums text-slate-500 ">
            <span className="font-semibold text-emerald-600 ">
              ✓ {delivered} teslim
            </span>
            {failed > 0 && (
              <span className="font-semibold text-rose-600 ">
                ✕ {failed} başarısız
              </span>
            )}
            <span>{remaining} kaldı</span>
          </div>
        )}
        {/* Zimmet ekranına kalıcı giriş.
            PLANNED turda ÖZELLİKLE gerekli: paketler tur başlamadan önce
            araca alınır (sunucu PLANNED/ACTIVE turda zimmete izin verir) ve
            başlatma, eksik paket varsa 409 ile reddedilir — kurye eksiği
            depoda görmeli, kapıda değil. */}
        {(run.status === "PLANNED" || run.status === "ACTIVE") && (
          <Link
            to={ROUTES.deliveryRunHandover(run.id)}
            className="block rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-100 "
          >
            Paketleri araca al (zimmet) →
          </Link>
        )}
        {run.status !== "ACTIVE" ? (
          <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-100 ">
            {run.status === "PLANNED"
              ? isAdmin
                ? "Tur henüz başlatılmadı — admin panelinden başlatın."
                : "Tur henüz başlatılmadı — yönetici başlatınca burada görünecek."
              : "Bu tur sonuçlandı."}
          </p>
        ) : current ? (
          <>
            {/* Çoklu paket (Faz 7): aynı noktaya giden diğer bekleyen paketler —
                kurye kapıya TEK seferde çıksın; her paket yine ayrı okutulur. */}
            {(() => {
              const siblings = coLocatedPendingStops(run, current);
              if (siblings.length === 0) return null;
              return (
                <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 ">
                  Bu adrese bu turda {siblings.length} paket daha var (durak{" "}
                  {siblings.map((s) => `#${s.sequence}`).join(", ")}) — hepsini
                  birlikte götür, her paketi ayrı okut.
                </p>
              );
            })()}
            <CurrentStopCard
              key={current.id}
              stop={current}
              isJumped={selectedStop != null}
              kapi={kapi}
            />
            {selectedStop != null && nextStop && selectedStop.id !== nextStop.id && (
              <button
                onClick={() => setSelectedStopId(null)}
                className="w-full rounded-xl py-2 text-xs font-semibold text-indigo-600 ring-1 ring-indigo-200 "
              >
                Sıradaki durağa dön (#{nextStop.sequence})
              </button>
            )}
            {/* ── Etiket okutma ──
                Manuel kutu SAYFANIN KENDİSİNDE ve HER ZAMAN açık: eskiden yalnız
                QrScanner'ın kamera-yok fallback'inde vardı, yani kamerası olan
                ama etiketi okuyamayan (buruşuk/ıslak QR) kurye sıkışıyordu. */}
            <section
              data-testid="saha-tarama"
              className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 "
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onScan(kod);
                }}
                className="flex gap-2"
              >
                <input
                  ref={kodKutusu}
                  type="text"
                  value={kod}
                  onChange={(e) => setKod(e.target.value)}
                  aria-label="Etiket kodu"
                  placeholder="Etiketteki kod (ör. PKG1:12:abc…)"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="input min-w-0 flex-1"
                />
                <button
                  type="submit"
                  disabled={!kod.trim() || scanLabel.isPending}
                  className="shrink-0 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 "
                >
                  {scanLabel.isPending ? "Okunuyor…" : "Okut"}
                </button>
              </form>
              {kameraVar && (
                <button
                  onClick={() => setShowScanner(true)}
                  className="w-full rounded-xl py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 "
                >
                  Kamerayla okut
                </button>
              )}
              {kameraVar && showScanner && (
                <QrScanner
                  onScan={onScan}
                  onClose={() => setShowScanner(false)}
                  manualHint="Paket etiketindeki QR'ın altında yazan kodu elle girebilirsin."
                  manualPlaceholder="Etiketteki kod (ör. 12:abc…)"
                />
              )}
            </section>
            {tarama && (
              <p
                role="alert"
                data-testid="saha-sonuc"
                className={`rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ${
                  tarama.hata
                    ? "bg-rose-50 text-rose-800 ring-rose-200 "
                    : "bg-emerald-50 text-emerald-800 ring-emerald-200 "
                }`}
              >
                {/* Renk tek ayırt edici değil: hata ✕, olumlu ✓ ile de söylenir. */}
                {tarama.hata ? "✕ " : "✓ "}
                {tarama.mesaj}
              </p>
            )}
          </>
        ) : (
          <div className="space-y-3 rounded-2xl bg-white p-6 text-center ring-1 ring-slate-100 ">
            <p className="text-sm font-semibold text-slate-900 ">
              Tüm duraklar sonuçlandı 🎉
            </p>
            <button
              onClick={() =>
                runAction.mutate(
                  { runId: run.id, action: "complete" },
                  {
                    onSuccess: () => toast.success("Tur tamamlandı."),
                    onError: (e) =>
                      toast.error(apiDetail(e, "Tamamlanamadı.")),
                  }
                )
              }
              disabled={runAction.isPending}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Turu Tamamla
            </button>
          </div>
        )}

        {/* Durak listesi */}
        <ul
          data-testid="durak-listesi"
          className="divide-y divide-slate-100 rounded-2xl bg-white px-4 ring-1 ring-slate-100 "
        >
          {[...run.stops]
            .sort((a, b) => a.sequence - b.sequence)
            .map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() =>
                    s.status === "PENDING" && run.status === "ACTIVE"
                      ? setSelectedStopId(s.id === nextStop?.id ? null : s.id)
                      : undefined
                  }
                  disabled={s.status !== "PENDING" || run.status !== "ACTIVE"}
                  className={`flex w-full items-center gap-3 py-2.5 text-left ${
                    s.status === "PENDING" && run.status === "ACTIVE"
                      ? "cursor-pointer"
                      : "cursor-default"
                  } ${current?.id === s.id ? "bg-indigo-50/50 -mx-4 px-4 " : ""}`}
                >
                <span
                  className={`w-6 text-right text-sm font-semibold tabular-nums ${
                    current?.id === s.id
                      ? "text-indigo-600 "
                      : "text-slate-400"
                  }`}
                >
                  {s.sequence}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm text-slate-700 ">
                  {s.recipient ?? `Sipariş #${s.order_id}`}
                </p>
                {s.eta && s.status === "PENDING" && (
                  <span className="shrink-0 text-xs tabular-nums text-slate-400 ">
                    ~{formatEta(s.eta)}
                  </span>
                )}
                <span
                  className={`text-xs font-medium ${
                    s.status === "DELIVERED"
                      ? "text-emerald-600 "
                      : s.status === "FAILED"
                        ? "text-rose-600 "
                        : "text-slate-400"
                  }`}
                >
                  {STOP_STATUS_LABEL[s.status]}
                </span>
                </button>
              </li>
            ))}
        </ul>
      </main>
    </div>
  );
}
