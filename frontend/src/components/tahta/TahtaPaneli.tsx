import { useCallback, useEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  reconcileElements,
  restoreElements,
  viewportCoordsToSceneCoords,
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
  SERBEST_SAYFA,
  TAHTA_KONU,
  degisenler,
  elemanSayfasi,
  gorunurMu,
  mesajCoz,
  sayfaAnahtari,
  sayfaEtiketle,
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

/** Görünür alanın PDF zemini için ayrılan payı (kenarda nefes payı kalsın). */
const ZEMIN_PAYI = 0.88;

type Kutu = { x: number; y: number; genislik: number; yukseklik: number };

/**
 * Bir görüntüyü hedef kutuya EN-BOY ORANINI BOZMADAN sığdırır ve ortalar.
 *
 * Eski kod sabit bir 900 px genişliğe ölçekliyordu; yatay, dikey ve kare
 * sayfalar aynı kutuya oturmuyordu. Tek ölçek çarpanı kullanmak oranı korur,
 * `Math.min` ise taşmayı engeller — kutu dar gelirse genişlik, alçak gelirse
 * yükseklik sınırlar.
 */
function kutuyaSigdir(hedef: Kutu, gGenislik: number, gYukseklik: number): Kutu {
  const olcek = Math.min(hedef.genislik / gGenislik, hedef.yukseklik / gYukseklik);
  const genislik = Math.round(gGenislik * olcek);
  const yukseklik = Math.round(gYukseklik * olcek);
  return {
    x: Math.round(hedef.x + (hedef.genislik - genislik) / 2),
    y: Math.round(hedef.y + (hedef.yukseklik - yukseklik) / 2),
    genislik,
    yukseklik,
  };
}

/**
 * Sahneyi ve dosya deposunu birlikte boşaltır.
 *
 * `resetScene()` tek başına yetmiyor: ölçüldü, sahneyi siliyor ama dosya
 * deposuna dokunmuyor. O yüzden "Temizle"den sonra da gezilmiş bütün PDF
 * sayfalarının base64'ü bellekte duruyor ve geç katılan birine yeniden
 * gönderiliyordu.
 */
function sahneyiBosalt(api: ExcalidrawImperativeAPI): void {
  const dosyalar = api.getFiles() as Record<string, unknown>;
  for (const id of Object.keys(dosyalar)) delete dosyalar[id];
  api.resetScene();
}

/**
 * Artık çizilmeyen (mezar taşı olmuş) görüntülerin base64 verisini dosya
 * deposundan düşürür.
 *
 * Kural MEZAR TAŞINA bakar, "sayfayı kim çevirdi"ye değil — bu yüzden hem
 * sayfayı çeviren tarafta hem de değişikliği UZAKTAN ALAN tarafta aynı şekilde
 * işler. Yalnız gönderen tarafta yapılsaydı karşı katılımcı gezilen bütün
 * sayfaların JPEG'ini biriktirir ve geç katılan birine hepsini yollardı.
 *
 * Hâlâ canlı bir eleman aynı `fileId`yi gösteriyorsa dosya BIRAKILIR: aynı
 * görüntüden iki kopya varsa birinin silinmesi diğerini kırmamalı.
 *
 * SINIR: bu yalnız base64 dizesini serbest bırakır. Excalidraw'ın ÇÖZÜLMÜŞ
 * görüntü önbelleği (`imageCache`) genel API'den boşaltılamaz — ölçüldü,
 * `resetScene()` bile boşaltmıyor. Onu yalnız paneli kapatıp yeniden açmak
 * (Excalidraw'ın yeniden kurulması) serbest bırakır.
 */
function mezarDosyalariniAt(
  api: ExcalidrawImperativeAPI,
  elemanlar: readonly OrderedExcalidrawElement[]
): void {
  const canli = new Set<string>();
  const olu = new Set<string>();
  for (const e of elemanlar) {
    if (e.type !== "image" || !e.fileId) continue;
    (e.isDeleted ? olu : canli).add(e.fileId);
  }
  const dosyalar = api.getFiles() as Record<string, unknown>;
  for (const id of olu) {
    if (!canli.has(id) && id in dosyalar) delete dosyalar[id];
  }
}

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
  /* Yalnız başlıktaki bilgi içindir. PDF'i AÇMAYAN katılımcıda `pdf` boştur;
     hangi sayfanın gösterildiğini ancak gelen mesajdan öğrenir. */
  const [gosterilenSayfa, setGosterilenSayfa] = useState<string | null>(null);

  /* Efektler `api` değişimine bağlanmasın diye ref: veri akışı dinleyicisi
     odaya BİR KEZ kaydedilir, her Excalidraw yeniden çiziminde değil. */
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;

  /** "Karşı tarafın bildiğine inandığım sürüm" — eko döngüsünü bu kırar. */
  const bilinen = useRef(new Map<string, number>());

  /**
   * DEFTER — bütün sayfaların bütün elemanları.
   *
   * Excalidraw sahnesi artık gerçeğin kaynağı DEĞİL: sahnede yalnız AÇIK OLAN
   * sayfanın elemanları durur. Kullanıcı sayfa 2'ye geçtiğinde sayfa 1'in
   * çizimleri sahneden çıkar ama defterde kalır; geri dönünce aynı `id` ve
   * aynı `version` ile geri konur — yani silinmiş sayılmazlar ve senkron
   * muhasebesi (`bilinen`, `reconcileElements`) bozulmaz.
   *
   * Senkronla ilgili her şey defteri okur: yayınlanan da, birleştirilen de
   * TÜM sayfalardır. Sayfa kavramı yalnızca GÖRÜNÜRLÜK filtresidir.
   */
  const defter = useRef(new Map<string, OrderedExcalidrawElement>());
  /** O an gösterilen sayfa etiketi (efektler/geri çağrılar için ref). */
  const aktifSayfa = useRef<string>(SERBEST_SAYFA);
  /** Sayfa etiketi → o sayfanın zemin elemanının id'si. */
  const zeminler = useRef(new Map<string, string>());
  /** Sayfaların oturduğu sabit çerçeve — ilk sayfada bir kez hesaplanır. */
  const zeminCercevesi = useRef<Kutu | null>(null);
  /** Geri çağrılar içinden PDF'in açık olup olmadığını okumak için. */
  const pdfRef = useRef<AcikPdf | null>(null);
  pdfRef.current = pdf;
  const yayinZamani = useRef<number | null>(null);
  const sonImlec = useRef(0);
  const imlecler = useRef(new Map<SocketId, Collaborator>());

  /* ── Defter ───────────────────────────────────────────────────────────── */

  /** Sahnedeki elemanları deftere işler; defterdeki DİĞER sayfalara dokunmaz. */
  const defteriDoldur = useCallback((elemanlar: readonly OrderedExcalidrawElement[]) => {
    for (const e of elemanlar) defter.current.set(e.id, e);
  }, []);

  /**
   * Sahneyi defterin "şu an görünmesi gereken" alt kümesiyle yeniden yazar.
   *
   * Alt küme vermenin güvenli olduğu ÖLÇÜLDÜ: elemanların `index` ve `version`
   * değerleri ne çıkarıldığında ne de geri konduğunda değişiyor. Değişseydi
   * her sayfa geçişi bütün görünür kümede sürüm artırır ve kanalı yayın
   * fırtınasına sokardı.
   */
  const gorunuruYaz = useCallback((a: ExcalidrawImperativeAPI) => {
    const gorunur = [...defter.current.values()]
      .filter((e) => gorunurMu(e as unknown as TahtaEleman, aktifSayfa.current))
      // Z-sırası kesirli `index` anahtarındadır; Map'in ekleme sırası değil.
      .sort((x, y) => ((x.index ?? "") < (y.index ?? "") ? -1 : (x.index ?? "") > (y.index ?? "") ? 1 : 0));
    a.updateScene({ elements: gorunur, captureUpdate: CaptureUpdateAction.NEVER });
  }, []);

  /**
   * Mesaja `sayfa` alanı konacak mı?
   *
   * YALNIZ PDF'i açan taraf sayfa bildirir. Sebep: karşı katılımcıda PDF
   * nesnesi yoktur, kendi `aktifSayfa`sını yalnız gelen mesajdan öğrenir.
   * O da sayfa bildirseydi, henüz ilk mesajı almadan yaptığı bir çizim
   * "serbest" etiketiyle gider ve PDF'i açan tarafı sayfasından geri çekerdi.
   */
  const sayfayiBildir = useCallback(
    () => (pdfRef.current ? aktifSayfa.current : undefined),
    []
  );

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
      // Sahne değil DEFTER: gizli sayfaların elemanları da yayınlanır, yoksa
      // geç katılan yalnız o an açık sayfayı görür, ötekiler ona hiç gitmez.
      defteriDoldur(a.getSceneElementsIncludingDeleted());
      const elemanlar = [...defter.current.values()] as unknown as TahtaEleman[];
      surumleriYaz(elemanlar, bilinen.current);
      const dosyalar = dosyalarlaBirlikte
        ? (Object.values(a.getFiles()) as unknown as TahtaDosya[])
        : [];
      const mesaj: TahtaMesaji = { t: "durum", elemanlar: [...elemanlar] };
      if (dosyalar.length > 0) mesaj.dosyalar = dosyalar;
      const sayfa = sayfayiBildir();
      if (sayfa) mesaj.sayfa = sayfa;
      await gonder(mesaj, hedefler);
    },
    [defteriDoldur, gonder, sayfayiBildir]
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
    defteriDoldur(a.getSceneElementsIncludingDeleted());

    /* Yeni doğan elemanları AÇIK OLAN sayfaya etiketle.
       Sadece etiketSİZ olanlar etiketlenir — yeniden etiketlemek sürümü her
       turda artırır ve kanal hiç susmaz. Çizilmekte/yazılmakta/boyutlandırılmakta
       olan eleman atlanır: `updateScene` onun ortasına girmemeli; bir sonraki
       turda, çizim bittikten sonra etiketlenir. */
    const durumu = a.getAppState();
    const mesgul = new Set(
      [durumu.newElement?.id, durumu.editingTextElement?.id, durumu.resizingElement?.id].filter(
        (id): id is string => typeof id === "string"
      )
    );
    let etiketlendi = false;
    for (const e of [...defter.current.values()]) {
      if (mesgul.has(e.id)) continue;
      if (elemanSayfasi(e as unknown as TahtaEleman) !== null) continue;
      defter.current.set(
        e.id,
        sayfaEtiketle(e as unknown as TahtaEleman, aktifSayfa.current) as unknown as OrderedExcalidrawElement
      );
      etiketlendi = true;
    }
    if (etiketlendi) gorunuruYaz(a);

    const hepsi = [...defter.current.values()] as unknown as TahtaEleman[];
    const yeni = degisenler(hepsi, bilinen.current);
    if (yeni.length === 0) return;
    // Defter gönderimden ÖNCE işaretlenir (iyimser). Gönderim düşerse o
    // eleman tek tek bir daha denenmez; periyodik tam senkron toparlar.
    // Tersi — önce gönder, sonra işaretle — çizim sürerken aynı elemanı
    // arka arkaya birkaç kez yollardı.
    surumleriYaz(yeni, bilinen.current);
    const mesaj: TahtaMesaji = { t: "durum", elemanlar: yeni };
    const sayfa = sayfayiBildir();
    if (sayfa) mesaj.sayfa = sayfa;
    void gonder(mesaj);
  }, [defteriDoldur, gonder, gorunuruYaz, sayfayiBildir]);

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
        sahneyiBosalt(a);
        bilinen.current.clear();
        defter.current.clear();
        zeminler.current.clear();
        aktifSayfa.current = SERBEST_SAYFA;
        setGosterilenSayfa(null);
        zeminCercevesi.current = null;
        return;
      }

      /* Sayfa değişimi elemanlardan ÖNCE ve eleman GELMESE DE işlenir:
         "sayfa 2'ye geçtim" mesajı çoğu zaman boş eleman listesiyle gelir
         (sayfa daha önce açılmışsa yeni eleman yoktur). */
      if (mesaj.sayfa && mesaj.sayfa !== aktifSayfa.current) {
        aktifSayfa.current = mesaj.sayfa;
        setGosterilenSayfa(mesaj.sayfa);
      }

      // Görüntüler elemanlardan ÖNCE: `addFiles` yapılmadan gelen bir
      // `fileId`ye bakan eleman kırık görsel olarak çizilir.
      if (mesaj.dosyalar?.length) {
        a.addFiles(mesaj.dosyalar as unknown as BinaryFileData[]);
      }

      if (mesaj.elemanlar.length > 0) {
        // `restoreElements`: gelen ham JSON'u pakete ait geçerli elemanlara
        // çevirir ve kesirli z-sıra anahtarlarını onarır. Marka (`MakeBrand`)
        // tipleri yalnız derleyici içindir, çalışma zamanında karşılığı yok.
        const uzak = restoreElements(mesaj.elemanlar as unknown as ExcalidrawElement[], null, {
          repairBindings: true,
        }) as unknown as readonly RemoteExcalidrawElement[];
        // Sürümler `restoreElements` SONRASINDAN okunur: onarım bir sürümü
        // değiştirirse ham sayıyı yazmak sonsuz yeniden-yayın üretirdi.
        surumleriYaz(uzak as unknown as TahtaEleman[], bilinen.current);

        // Birleştirme SAHNEYE değil DEFTERE karşı yapılır: sahnede yalnız açık
        // sayfa var, ona karşı birleştirseydik gizli sayfaların elemanları
        // "yerelde yok" sayılıp sıralamaya yeniden sokulurdu.
        defteriDoldur(a.getSceneElementsIncludingDeleted());
        const birlesik = reconcileElements(
          [...defter.current.values()],
          uzak,
          a.getAppState()
        );
        defter.current.clear();
        defteriDoldur(birlesik);
        // Uzaktan gelen sayfa değişimi de depoyu toplar; yoksa yalnız sayfayı
        // çeviren taraf temizlenir, ötekinde 30 sayfa birikirdi.
        mezarDosyalariniAt(a, birlesik);
      }

      gorunuruYaz(a);
    },
    [defteriDoldur, gorunuruYaz, tamSahneyiGonder]
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
    sahneyiBosalt(a);
    bilinen.current.clear();
    defter.current.clear();
    zeminler.current.clear();
    aktifSayfa.current = SERBEST_SAYFA;
    setGosterilenSayfa(null);
    zeminCercevesi.current = null;
    // PDF durumu da sıfırlanır: zemin sahneden gittiği hâlde başlıkta "2/4"
    // yazmaya devam etmesi, olmayan bir şeyi gösteren bir sayaç olurdu.
    setPdf(null);
    setSayfaNo(1);
    void gonder({ t: "temizle" });
  }, [gonder]);

  /**
   * Seçilen PDF sayfasını açar: zemini koyar, GÖRÜNÜR SAYFAYI değiştirir.
   *
   * Sayfa daha önce açıldıysa yeniden çizilmez — zemini ve o sayfaya yapılmış
   * çizimler defterde durur, yalnız görünürlük filtresi değişir.
   */
  const sayfayiArkaPlanaKoy = useCallback(
    async (belge: AcikPdf, no: number) => {
      const a = apiRef.current;
      if (!a) return;
      const anahtar = sayfaAnahtari(no);

      // Sayfa değişmeden ÖNCE o anki sahne deftere işlenmeli, yoksa bu sayfaya
      // yapılan son çizimler filtrelenirken kaybolur.
      defteriDoldur(a.getSceneElementsIncludingDeleted());
      aktifSayfa.current = anahtar;
      setGosterilenSayfa(anahtar);

      const oncekiZemin = zeminler.current.get(anahtar);
      if (oncekiZemin && defter.current.has(oncekiZemin)) {
        // Daha önce açılmış sayfa: yeniden render YOK, yeni eleman YOK.
        gorunuruYaz(a);
        void gonder({ t: "durum", elemanlar: [], sayfa: anahtar });
        return;
      }

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

        /* NEREYE konacak?
           1) Bu belgede daha önce bir çerçeve hesaplandıysa YENİ SAYFA AYNI
              ÇERÇEVEYE oturur. Çok sayfalı bir PDF'te doğru davranış budur:
              kullanıcı bir kez yerleştirir, sonra sayfalar aynı yerde değişir.
           2) İlk sayfada çerçeve, kullanıcının O AN BAKTIĞI alandan türetilir.
              Eski kod sabit (0,0) kullanıyordu; tahtanın başka bir yerinde
              çalışan biri için yeni sayfa ekranın tamamen dışına düşüyordu.

           Çerçeve REF'te saklanır, önceki sayfa elemanının ölçüsünden yeniden
           okunmaz. Okunsaydı karışık yönlü bir PDF'te sayfa sayfa KÜÇÜLÜRDÜ:
           dikey kutuya sığdırılan yatay sayfa alçak bir kutu bırakır, sonraki
           dikey sayfa o alçak kutuya sığdırılır ve bu böyle sürer
           (380×538 → 380×268 → 189×268 → …).

           `scrollToContent` ÇAĞRILMAZ: sayfa zaten görünür alana yerleştiği
           için kaydırmaya gerek yok ve kullanıcının yakınlaşma düzeyini
           bozmak istemiyoruz. */
        let hedef: Kutu;
        if (zeminCercevesi.current) {
          hedef = zeminCercevesi.current;
        } else {
          const durum = a.getAppState();
          const solUst = viewportCoordsToSceneCoords(
            { clientX: durum.offsetLeft, clientY: durum.offsetTop },
            durum
          );
          const sagAlt = viewportCoordsToSceneCoords(
            { clientX: durum.offsetLeft + durum.width, clientY: durum.offsetTop + durum.height },
            durum
          );
          const gorunurG = sagAlt.x - solUst.x;
          const gorunurY = sagAlt.y - solUst.y;
          hedef = {
            x: solUst.x + (gorunurG * (1 - ZEMIN_PAYI)) / 2,
            y: solUst.y + (gorunurY * (1 - ZEMIN_PAYI)) / 2,
            genislik: gorunurG * ZEMIN_PAYI,
            yukseklik: gorunurY * ZEMIN_PAYI,
          };
          zeminCercevesi.current = hedef;
        }
        const kutu = kutuyaSigdir(hedef, goruntu.genislik, goruntu.yukseklik);

        // `locked` çünkü bu bir ZEMİN — üstüne yazarken kazayla sürüklenmemeli.
        // Sayfa etiketi DOĞARKEN verilir: zemin, ait olduğu sayfa dışında hiç
        // görünmemeli, bir tur bile.
        const [ham] = convertToExcalidrawElements([
          {
            type: "image",
            fileId: dosyaId as FileId,
            x: kutu.x,
            y: kutu.y,
            width: kutu.genislik,
            height: kutu.yukseklik,
            locked: true,
          },
        ]);
        const yeni = { ...ham, customData: { tahtaSayfa: anahtar } };

        /* Önceki sayfanın zemini SİLİNMEZ, yalnız görünmez olur — kullanıcı
           geri döndüğünde aynı eleman aynı sürümle yerinde durur. (Eski
           davranış onu mezar taşı yapıyordu; o zaman sayfaya dönmek mümkün
           değildi.)
           Zemin dizinin BAŞINA konur: Excalidraw kesirli z-sıra anahtarını
           dizi sırasından türetir, yani ilk eleman en altta kalır. */
        const gorunurDigerleri = [...defter.current.values()].filter((e) =>
          gorunurMu(e as unknown as TahtaEleman, anahtar)
        );
        a.updateScene({
          elements: [yeni, ...gorunurDigerleri],
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        zeminler.current.set(anahtar, yeni.id);

        // Sahneden GERİ OKUNUR: `updateScene` kesirli index'i o an atar,
        // gönderilen kopya index'siz olsaydı karşı tarafta zemin üste çıkardı.
        defteriDoldur(a.getSceneElementsIncludingDeleted());
        const yerlesmis = [defter.current.get(yeni.id)].filter(
          (e): e is OrderedExcalidrawElement => !!e
        ) as unknown as TahtaEleman[];
        surumleriYaz(yerlesmis, bilinen.current);
        await gonder({
          t: "durum",
          elemanlar: [...yerlesmis],
          dosyalar: [dosya],
          sayfa: anahtar,
        });
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

          {/* PDF'i açmayan katılımcıda sayfa düğmesi yoktur; hangi sayfanın
              gösterildiğini yine de bilmeli. */}
          {!pdf && gosterilenSayfa && gosterilenSayfa !== SERBEST_SAYFA && (
            <span className="text-xs text-slate-500">
              sayfa {gosterilenSayfa.replace(/^s/, "")}
            </span>
          )}

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
