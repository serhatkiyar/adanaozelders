import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useMaybeRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type {
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";

import { pdfAc, type AcikPdf } from "@/lib/pdfSayfa";
import {
  TAHTA_KONU,
  degisenler,
  mesajCoz,
  silindiIsaretle,
  surumleriYaz,
  type TahtaDosya,
  type TahtaEleman,
  type TahtaMesaji,
} from "@/lib/tahtaSenkron";

/* ──────────────────────────────────────────────────────────────────────────
 * ORTAK TAHTA — LiveKit odası üzerinden senkron Excalidraw (PROTOTİP)
 *
 * ## Neden bu mimari
 *
 * Senkronizasyon birimi PİKSEL DEĞİL ELEMANDIR: her şekil kendi `id` ve
 * `version` sayacını taşır, yalnız sürümü değişen elemanlar yayınlanır.
 * Bu, Excalidraw'ın kendi resmi çoklu-kullanıcı uygulamasının (`excalidraw-app`
 * · `collab/Collab.tsx`, `collab/Portal.tsx`) deseninin aynısıdır ve zor kısmı
 * — iki taraf aynı elemanı aynı anda değiştirdiğinde kimin kazanacağı —
 * paketin kendi `reconcileElements`i ile çözülür. Kural kopyalanmadı,
 * fonksiyon doğrudan çağrıldı; `restoreElements` de aynı şekilde.
 *
 * Excalidraw.com'un uçtan uca AES şifrelemesi BİLEREK atlandı: o katman
 * kendi sunucularına güvenmedikleri için var. Buradaki taşıyıcı kendi LiveKit
 * sunucumuz ve WebRTC zaten şifreli.
 *
 * ## Taşıyıcı: neden iki farklı LiveKit API'si
 *
 * `excalidraw-app`'in Portal'ı iki tür yayın yapar (güvenilir eleman
 * güncellemesi · anlık imleç). Burada ikisi de korunur ama FARKLI API'lerle:
 *
 *   • Eleman/dosya  → `localParticipant.sendText(..., { topic })`.
 *     `publishData` DEĞİL, çünkü tek bir veri paketi ~16 KiB ile sınırlıdır ve
 *     uzun bir serbest çizim elemanı (yüzlerce nokta) ya da bir PDF sayfası
 *     görüntüsü bu sınırı TEK BAŞINA aşar. `sendText` LiveKit'in akış
 *     mekanizmasıdır: parçalamayı SDK yapar, sınır yoktur, teslim güvenilirdir.
 *     Elle 16 KiB'lik parçalara bölmek aynı işi daha kırılgan yapardı.
 *   • İmleç        → `publishData(..., { reliable: false })`.
 *     Küçük, çok sık ve eskiyen veri; kaybolması bir sonraki paketle zaten
 *     düzelir. Volatile kanal tam olarak bunun içindir.
 *
 * ## Kayıp mesaja karşı
 *
 * Yalnız "değişeni gönder" kuralı bir mesaj düşerse kalıcı ayrışma üretir.
 * `excalidraw-app` gibi burada da periyodik TAM SAHNE yayını var
 * (`TAM_SENKRON_MS`): sessizce ayrışan sahne en geç bir turda kendini toplar.
 *
 * ## Kapsam (bilinçli sınırlar)
 *
 * Bu bir deneme yüzeyidir; `/test-livekit` dışında hiçbir yerden kullanılmaz,
 * gerçek ders akışına (Jitsi · `GlobalMeeting`) dokunmaz. Tahtası KAPALI olan
 * bir katılımcı geç gelene sahne gönderemez — paneli açan taraf sahneyi ister,
 * açık olan taraf yanıtlar.
 * ────────────────────────────────────────────────────────────────────────── */

/** Anlık imleç konumu — ayrı ve güvenilir OLMAYAN kanal. */
const IMLEC_KONU = "tahta-imlec";

/** Çizim yayını bu aralıkta biriktirilir (60 fps'de her kareyi yollamamak için). */
const YAYIN_ARALIGI_MS = 120;

/** Periyodik tam sahne yayını — düşen mesajın bıraktığı ayrışmayı kapatır. */
const TAM_SENKRON_MS = 10_000;

/** İmleç yayını aralığı. */
const IMLEC_ARALIGI_MS = 60;

type Props = {
  /** Panel başlığındaki kapat düğmesi. */
  onKapat: () => void;
};

export default function TahtaPaneli({ onKapat }: Props) {
  const oda = useMaybeRoomContext();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [durum, setDurum] = useState<string | null>(null);
  const [pdf, setPdf] = useState<AcikPdf | null>(null);
  const [sayfaNo, setSayfaNo] = useState(1);
  const [pdfMesgul, setPdfMesgul] = useState(false);

  /* Efektler `api` değişimine bağlanmasın diye ref: veri akışı dinleyicisi
     odaya BİR KEZ kaydedilir, her Excalidraw yeniden çiziminde değil. */
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;

  /** "Karşı tarafın bildiğine inandığım sürüm" — eko döngüsünü bu kırar. */
  const bilinen = useRef(new Map<string, number>());
  /** Arka plana konmuş PDF sayfası elemanının id'si (yenisi gelince silinir). */
  const arkaPlanId = useRef<string | null>(null);
  const yayinZamani = useRef<number | null>(null);
  const sonImlec = useRef(0);
  const imlecler = useRef(new Map<SocketId, Collaborator>());

  /* ── Gönderim ─────────────────────────────────────────────────────────── */

  const gonder = useCallback(
    async (mesaj: TahtaMesaji, hedefler?: string[]) => {
      if (!oda || oda.state !== "connected") return;
      try {
        await oda.localParticipant.sendText(JSON.stringify(mesaj), {
          topic: TAHTA_KONU,
          destinationIdentities: hedefler,
        });
      } catch (e) {
        setDurum(`Gönderilemedi: ${(e as Error).message}`);
      }
    },
    [oda]
  );

  /**
   * Sahnedeki HER elemanı (silinmişler dahil) yayınlar.
   *
   * `dosyalarlaBirlikte` yalnız sahneyi İLK KEZ isteyen birine yanıt verirken
   * açıktır. Periyodik senkron onu KAPALI çağırır: dosya önbelleğinde duran
   * PDF sayfası görüntüleri (base64, sayfa başına yüz kilobaytlar, üstelik
   * artık silinmiş olanlar dahil) on saniyede bir yeniden yayınlanırdı.
   * Elemanlar görüntüyü değil yalnız `fileId`yi taşır; periyodik tur ucuzdur.
   */
  const tamSahneyiGonder = useCallback(
    async (hedefler?: string[], dosyalarlaBirlikte = false) => {
      const a = apiRef.current;
      if (!a) return;
      const elemanlar = a.getSceneElementsIncludingDeleted() as unknown as TahtaEleman[];
      surumleriYaz(elemanlar, bilinen.current);
      const dosyalar = dosyalarlaBirlikte
        ? (Object.values(a.getFiles()) as unknown as TahtaDosya[])
        : [];
      await gonder(
        dosyalar.length > 0
          ? { t: "durum", elemanlar: [...elemanlar], dosyalar }
          : { t: "durum", elemanlar: [...elemanlar] },
        hedefler
      );
    },
    [gonder]
  );

  /**
   * Yalnız DEĞİŞENLERİ yayınlar.
   *
   * `onChange`in verdiği eleman dizisi değil, `getSceneElementsIncludingDeleted()`
   * okunur: silgi karşı tarafa ancak `isDeleted` mezar taşı olarak ulaşabilir,
   * mezar taşları ise `onChange` argümanında güvenilir biçimde bulunmaz.
   * Elenirse silme hiç yayılmaz ve çizgi diğer ekranda ölümsüz olur.
   */
  const degisenleriGonder = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    const hepsi = a.getSceneElementsIncludingDeleted() as unknown as TahtaEleman[];
    const yeni = degisenler(hepsi, bilinen.current);
    if (yeni.length === 0) return;
    // Defter gönderimden ÖNCE işaretlenir (iyimser). Gönderim düşerse o
    // eleman tek tek bir daha denenmez; periyodik tam senkron toparlar.
    // Tersi — önce gönder, sonra işaretle — çizim sürerken aynı elemanı
    // arka arkaya birkaç kez yollardı.
    surumleriYaz(yeni, bilinen.current);
    void gonder({ t: "durum", elemanlar: yeni });
  }, [gonder]);

  const degisimeTepki = useCallback(() => {
    if (yayinZamani.current !== null) return;
    yayinZamani.current = window.setTimeout(() => {
      yayinZamani.current = null;
      degisenleriGonder();
    }, YAYIN_ARALIGI_MS);
  }, [degisenleriGonder]);

  /* ── Alım ─────────────────────────────────────────────────────────────── */

  const uygula = useCallback(
    (mesaj: TahtaMesaji, kimden: string) => {
      const a = apiRef.current;
      if (!a) return;

      if (mesaj.t === "istek") {
        // Tek yer: sahneyi ilk kez isteyene görüntüler de gider.
        void tamSahneyiGonder([kimden], true);
        return;
      }
      if (mesaj.t === "temizle") {
        a.resetScene();
        bilinen.current.clear();
        arkaPlanId.current = null;
        return;
      }

      // Görüntüler elemanlardan ÖNCE: `addFiles` yapılmadan gelen bir
      // `fileId`ye bakan eleman kırık görsel olarak çizilir.
      if (mesaj.dosyalar?.length) {
        a.addFiles(mesaj.dosyalar as unknown as BinaryFileData[]);
      }
      if (mesaj.elemanlar.length === 0) return;

      // `restoreElements`: gelen ham JSON'u pakete ait geçerli elemanlara
      // çevirir ve kesirli z-sıra anahtarlarını onarır. Marka (`MakeBrand`)
      // tipleri yalnız derleyici içindir, çalışma zamanında karşılığı yok.
      const uzak = restoreElements(mesaj.elemanlar as unknown as ExcalidrawElement[], null, {
        repairBindings: true,
      }) as unknown as readonly RemoteExcalidrawElement[];
      // Sürümler `restoreElements` SONRASINDAN okunur: onarım bir sürümü
      // değiştirirse ham sayıyı yazmak sonsuz yeniden-yayın üretirdi.
      surumleriYaz(uzak as unknown as TahtaEleman[], bilinen.current);

      const birlesik = reconcileElements(
        a.getSceneElementsIncludingDeleted() as readonly OrderedExcalidrawElement[],
        uzak,
        a.getAppState()
      );
      a.updateScene({ elements: birlesik, captureUpdate: CaptureUpdateAction.NEVER });
    },
    [tamSahneyiGonder]
  );

  /* Eleman/dosya kanalı (güvenilir, akış). */
  useEffect(() => {
    if (!oda) return;
    const isle = async (
      okuyucu: { readAll: () => Promise<string> },
      bilgi: { identity: string }
    ) => {
      const mesaj = mesajCoz(await okuyucu.readAll());
      if (mesaj) uygula(mesaj, bilgi.identity);
    };
    try {
      oda.unregisterTextStreamHandler(TAHTA_KONU);
    } catch {
      /* kayıtlı değilse sorun yok (StrictMode çift efekt) */
    }
    oda.registerTextStreamHandler(TAHTA_KONU, (okuyucu, bilgi) => void isle(okuyucu, bilgi));
    return () => {
      try {
        oda.unregisterTextStreamHandler(TAHTA_KONU);
      } catch {
        /* yoksay */
      }
    };
  }, [oda, uygula]);

  /* İmleç kanalı (volatile). Sahneyi DEĞİŞTİRMEZ; yalnız collaborators. */
  useEffect(() => {
    if (!oda) return;
    const alindi = (
      yuk: Uint8Array,
      katilimci: { identity: string } | undefined,
      _tur: unknown,
      konu?: string
    ) => {
      if (konu !== IMLEC_KONU || !katilimci) return;
      const a = apiRef.current;
      if (!a) return;
      try {
        const n = JSON.parse(new TextDecoder().decode(yuk)) as {
          x: number;
          y: number;
          dugme?: "up" | "down";
        };
        imlecler.current.set(katilimci.identity as SocketId, {
          pointer: { x: n.x, y: n.y, tool: "pointer" },
          button: n.dugme ?? "up",
          username: katilimci.identity,
        });
        a.updateScene({ collaborators: new Map(imlecler.current) });
      } catch {
        /* bozuk paket yutulur */
      }
    };
    oda.on(RoomEvent.DataReceived, alindi);
    return () => {
      oda.off(RoomEvent.DataReceived, alindi);
    };
  }, [oda]);

  /* Panel açıldığında sahneyi iste; periyodik tam senkron başlat. */
  useEffect(() => {
    if (!oda || !api) return;
    void gonder({ t: "istek" });
    const sayac = window.setInterval(() => void tamSahneyiGonder(), TAM_SENKRON_MS);
    return () => window.clearInterval(sayac);
  }, [oda, api, gonder, tamSahneyiGonder]);

  useEffect(
    () => () => {
      if (yayinZamani.current !== null) window.clearTimeout(yayinZamani.current);
    },
    []
  );

  /* ── Araçlar ──────────────────────────────────────────────────────────── */

  const temizle = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    a.resetScene();
    bilinen.current.clear();
    arkaPlanId.current = null;
    // PDF durumu da sıfırlanır: zemin sahneden gittiği hâlde başlıkta "2/4"
    // yazmaya devam etmesi, olmayan bir şeyi gösteren bir sayaç olurdu.
    setPdf(null);
    setSayfaNo(1);
    void gonder({ t: "temizle" });
  }, [gonder]);

  /** Seçilen PDF sayfasını arka plana koyar ve karşı tarafa yollar. */
  const sayfayiArkaPlanaKoy = useCallback(
    async (belge: AcikPdf, no: number) => {
      const a = apiRef.current;
      if (!a) return;
      setPdfMesgul(true);
      setDurum(null);
      try {
        const goruntu = await belge.sayfayiCiz(no);
        const dosyaId = `pdf-${Date.now()}-${no}`;
        const dosya: TahtaDosya = {
          id: dosyaId,
          dataURL: goruntu.dataURL,
          mimeType: "image/jpeg",
          created: Date.now(),
        };
        a.addFiles([dosya as unknown as BinaryFileData]);

        // Ekrana sığacak ölçüye indir; `locked` çünkü bu bir ZEMİN — üstüne
        // yazarken kazayla sürüklenmemeli.
        const olcek = Math.min(1, 900 / goruntu.genislik);
        const [yeni] = convertToExcalidrawElements([
          {
            type: "image",
            fileId: dosyaId as FileId,
            x: 0,
            y: 0,
            width: Math.round(goruntu.genislik * olcek),
            height: Math.round(goruntu.yukseklik * olcek),
            locked: true,
          },
        ]);

        const mevcut = a.getSceneElementsIncludingDeleted();
        const eski = arkaPlanId.current;
        // Önceki sayfa MEZAR TAŞI olarak kalır: diziden atmak silmeyi karşı
        // tarafa duyurmaz, eski sayfa orada asılı kalırdı.
        const temizlenmis = mevcut.map((e) =>
          eski && e.id === eski
            ? (silindiIsaretle(e as unknown as TahtaEleman) as unknown as typeof e)
            : e
        );
        // Zemin en başa: Excalidraw kesirli z-sıra anahtarını dizi sırasından
        // türetir, yani ilk eleman en altta kalır.
        a.updateScene({
          elements: [yeni, ...temizlenmis],
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        arkaPlanId.current = yeni.id;
        a.scrollToContent(yeni, { fitToContent: true });

        // Sahneden GERİ OKUNUR: `updateScene` kesirli index'i o an atar,
        // gönderilen kopya index'siz olsaydı karşı tarafta zemin üste çıkardı.
        const yerlesmis = a
          .getSceneElementsIncludingDeleted()
          .filter((e) => e.id === yeni.id || (eski && e.id === eski)) as unknown as TahtaEleman[];
        surumleriYaz(yerlesmis, bilinen.current);
        await gonder({ t: "durum", elemanlar: [...yerlesmis], dosyalar: [dosya] });
      } catch (e) {
        setDurum(`PDF sayfası çizilemedi: ${(e as Error).message}`);
      } finally {
        setPdfMesgul(false);
      }
    },
    [gonder]
  );

  const pdfSec = useCallback(
    async (dosya: File) => {
      setDurum(null);
      try {
        pdf?.kapat();
        const belge = await pdfAc(dosya);
        setPdf(belge);
        setSayfaNo(1);
        await sayfayiArkaPlanaKoy(belge, 1);
      } catch (e) {
        setDurum(`PDF açılamadı: ${(e as Error).message}`);
      }
    },
    [pdf, sayfayiArkaPlanaKoy]
  );

  const sayfaDegistir = useCallback(
    (yon: -1 | 1) => {
      if (!pdf) return;
      const hedef = Math.min(Math.max(1, sayfaNo + yon), pdf.sayfaSayisi);
      if (hedef === sayfaNo) return;
      setSayfaNo(hedef);
      void sayfayiArkaPlanaKoy(pdf, hedef);
    },
    [pdf, sayfaNo, sayfayiArkaPlanaKoy]
  );

  useEffect(() => () => pdf?.kapat(), [pdf]);

  /** İmleç yayını — kayıpsızlık gerekmez, bu yüzden volatile paket. */
  const imlecGonder = useCallback(
    (nokta: { x: number; y: number }, dugme: "up" | "down") => {
      if (!oda || oda.state !== "connected") return;
      const simdi = Date.now();
      if (simdi - sonImlec.current < IMLEC_ARALIGI_MS) return;
      sonImlec.current = simdi;
      const yuk = new TextEncoder().encode(
        JSON.stringify({ x: nokta.x, y: nokta.y, dugme })
      );
      void oda.localParticipant
        .publishData(yuk, { reliable: false, topic: IMLEC_KONU })
        .catch(() => undefined);
    },
    [oda]
  );

  // `remoteParticipants` istemci tarafında tutulur ve tanımı gereği yalnız
  // KARŞI tarafı sayar. `numParticipants` sunucudan gelir, bağlantının ilk
  // anında 0 olabilir ve "-1 katılımcı" yazdırırdı.
  const baglantiNotu = !oda
    ? "oda yok — yerel deneme"
    : oda.state === "connected"
      ? `${oda.remoteParticipants.size} katılımcıyla paylaşılıyor`
      : `bağlantı: ${oda.state}`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700">Tahta</span>
        <span className="text-xs text-slate-400">{baglantiNotu}</span>

        <span className="ml-auto flex items-center gap-2">
          <label className="cursor-pointer rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200">
            {pdfMesgul ? "Çiziliyor…" : "PDF arka plan"}
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(e) => {
                const secilen = e.target.files?.[0];
                e.target.value = "";
                if (secilen) void pdfSec(secilen);
              }}
            />
          </label>

          {pdf && (
            <span className="flex items-center gap-1 text-xs text-slate-600">
              <button
                type="button"
                onClick={() => sayfaDegistir(-1)}
                disabled={pdfMesgul || sayfaNo <= 1}
                className="rounded-lg bg-slate-100 px-2 py-1.5 font-semibold transition hover:bg-slate-200 disabled:opacity-40"
              >
                ‹
              </button>
              <span className="tabular-nums">
                {sayfaNo}/{pdf.sayfaSayisi}
              </span>
              <button
                type="button"
                onClick={() => sayfaDegistir(1)}
                disabled={pdfMesgul || sayfaNo >= pdf.sayfaSayisi}
                className="rounded-lg bg-slate-100 px-2 py-1.5 font-semibold transition hover:bg-slate-200 disabled:opacity-40"
              >
                ›
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={temizle}
            className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            Temizle
          </button>
          <button
            type="button"
            onClick={onKapat}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            Kapat
          </button>
        </span>
      </div>

      {durum && (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {durum}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <Excalidraw
          excalidrawAPI={setApi}
          onChange={degisimeTepki}
          onPointerUpdate={({ pointer, button }) => imlecGonder(pointer, button)}
          isCollaborating={!!oda}
          langCode="tr-TR"
          initialData={{ appState: { viewBackgroundColor: "#ffffff" } }}
        />
      </div>
    </div>
  );
}
