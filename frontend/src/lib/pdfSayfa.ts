/* ──────────────────────────────────────────────────────────────────────────
 * PDF SAYFASI → GÖRÜNTÜ (tarayıcıda, backend'e dokunmadan)
 *
 * Neden istemci tarafı: tahtaya arka plan koymak için sunucuya bir dönüştürme
 * servisi (LibreOffice/Ghostscript) kurmak gerekmiyor. `pdf.js` sayfayı
 * canvas'a çizer, canvas JPEG'e döner, JPEG doğrudan Excalidraw'a görüntü
 * olarak girer. Dosya hiç yüklenmez; kullanıcının makinesinden çıkmaz —
 * karşı katılımcıya giden şey yalnız çizilmiş sayfanın görüntüsüdür.
 *
 * JPEG (PNG değil): taranmış bir ders sayfası PNG'de birkaç MB olabiliyor ve
 * bu görüntü LiveKit veri kanalından karşı tarafa gidiyor. 0.72 kalitede JPEG
 * aynı sayfayı tipik olarak bir mertebe küçültüyor; tahta arka planı için
 * kayıpsızlığın bir değeri yok.
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

/** Çizim genişliği tavanı — üstü hem yavaş hem de veri kanalı için gereksiz. */
const AZAMI_GENISLIK = 1600;

export async function pdfAc(dosya: File): Promise<AcikPdf> {
  const veri = new Uint8Array(await dosya.arrayBuffer());
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
