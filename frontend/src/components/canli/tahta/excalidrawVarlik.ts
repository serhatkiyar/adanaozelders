/**
 * Excalidraw yazı tiplerinin KENDİ sunucumuzdan gelmesi (KVKK; bkz.
 * `src/__guards__/disFont.test.ts` ilkesi).
 *
 * Excalidraw yazı tipi adreslerini çizim anında `window.EXCALIDRAW_ASSET_PATH`
 * + `fonts/<Aile>/<dosya>.woff2` diye kurar; değişken yoksa paketin dış CDN
 * adresine gider. Dosyalar `vite.config.ts`teki `excalidrawVarliklari`
 * eklentisiyle `dist/assets/excalidraw/fonts/` altına kopyalanır (geliştirme
 * sunucusunda aynı yoldan `node_modules`tan sunulur).
 *
 * Bu modül `TahtaPaneli`nde Excalidraw'dan ÖNCE içe aktarılır: ES modülleri
 * sırayla değerlendirilir, değişken paket yüklenmeden kurulur.
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

export const EXCALIDRAW_VARLIK_YOLU = "/assets/excalidraw/";

window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_VARLIK_YOLU;
