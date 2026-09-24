/* ──────────────────────────────────────────────────────────────────────────
 * PDF SAYFASI → GÖRÜNTÜ (tarayıcıda, backend'e dokunmadan)
 *
 * Neden istemci tarafı: tahtaya arka plan koymak için sunucuya bir dönüştürme
 * servisi (LibreOffice/Ghostscript) kurmak gerekmiyor. `pdf.js` sayfayı
 * canvas'a çizer, canvas JPEG'e döner, JPEG doğrudan Excalidraw'a görüntü
 * olarak girer. Görüntü telden GİTMEZ: PDF ders kaynağı olarak yüklenir
 * (private/ + imzalı adres) ve her taraf sayfayı kendi tarayıcısında çizer.
 *
 * JPEG (PNG değil): taranmış bir ders sayfası PNG'de birkaç MB olabiliyor;
 * 0.72 kalitede JPEG aynı sayfayı bir mertebe küçültür ve tarayıcı belleğinde
 * daha az yer tutar. Tahta arka planı için kayıpsızlığın bir değeri yok.
 * ────────────────────────────────────────────────────────────────────────── */
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
// Vite `?url` ile işçiyi ayrı bir varlık olarak paketler. CDN'den çekilmez:
// dış konak isteği yok (bkz. `src/__guards__/disFont.test.ts` ile aynı ilke).
import calisanAdresi from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = calisanAdresi;

/** Tek bir sayfanın çizilmiş hâli. */
export type SayfaGoruntusu = {
  dataURL: string;
  genislik: number;
  yukseklik: number;
};

export type AcikPdf = {
  sayfaSayisi: number;
  sayfayiCiz: (sayfaNo: number) => Promise<SayfaGoruntusu>;
  kapat: () => void;
};

/** Çizim genişliği tavanı — üstü yavaş ve tahta zemini için gereksiz. */
const AZAMI_GENISLIK = 1600;

/** PDF'i açar: yerel dosyadan ya da (imzalı adresten indirilmiş) bayt dizisinden. */
export async function pdfAc(kaynak: File | ArrayBuffer): Promise<AcikPdf> {
  const veri = new Uint8Array(kaynak instanceof ArrayBuffer ? kaynak : await kaynak.arrayBuffer());
  const belge: PDFDocumentProxy = await getDocument({ data: veri }).promise;

  return {
    sayfaSayisi: belge.numPages,
    kapat: () => void belge.destroy(),
    sayfayiCiz: async (sayfaNo: number) => {
      const sayfa = await belge.getPage(sayfaNo);
      const tabanOlcu = sayfa.getViewport({ scale: 1 });
      const olcek = Math.min(2, AZAMI_GENISLIK / tabanOlcu.width);
      const gorunum = sayfa.getViewport({ scale: olcek });

      const tuval = document.createElement("canvas");
      tuval.width = Math.floor(gorunum.width);
      tuval.height = Math.floor(gorunum.height);
      const baglam = tuval.getContext("2d");
      if (!baglam) throw new Error("Tarayıcı 2D canvas vermedi");
      // Beyaz zemin: PDF sayfaları saydam gelir, JPEG saydamlık taşımaz ve
      // zeminsiz çizim siyah bir dikdörtgen üretir.
      baglam.fillStyle = "#ffffff";
      baglam.fillRect(0, 0, tuval.width, tuval.height);

      await sayfa.render({ canvas: tuval, viewport: gorunum }).promise;
      sayfa.cleanup();

      return {
        dataURL: tuval.toDataURL("image/jpeg", 0.72),
        genislik: tuval.width,
        yukseklik: tuval.height,
      };
    },
  };
}
