// Kilide bağlı onay penceresi — kapanışı GERİ ÇAĞRI yönetir, AntD'ye söz dönmez.
//
// ## Neden bu model
//
// Önceki desen `onOk`/`onCancel`'dan reddedilen bir söz döndürüyordu: "işlem uçarken
// Vazgeç pencereyi kapatmasın" davranışı doğru çalışıyordu, ama AntD o reddi kendi
// içinde YENİDEN reddediyor (`_util/ActionButton.js` → `Promise.reject(e)`) ve kimse
// yakalamadığı için rejection süreç düzeyine düşüyordu. Testler geçtiği hâlde CI
// "unhandled rejection" yüzünden kırmızı kalıyordu (9 ekran, 76 kayıt).
//
// AntD'nin kendi sözleşmesi çıkışı veriyor: `onOk`/`onCancel` bir PARAMETRE
// (`close`) alıyorsa AntD fonksiyonu `actionFn(close)` diye çağırır, dönüş değerini
// söz olarak İŞLEMEZ ve pencereyi kendiliğinden KAPATMAZ. Yani kapanışın tek sahibi
// biziz: başarıda bir kez `close()`, meşgulde hiç çağırmayız.
//
// Kurallar:
//   * meşgul kapatma / ikinci işlem → SENKRON ve SESSİZ: pencere açık kalır, söz üretilmez;
//   * asenkron mutasyon hatası → hata ilgili ekranda gösterilir (çağıranın `catch`i),
//     kilit bırakılır, pencere açık ve yeniden denenebilir kalır;
//   * başarı → pencere YALNIZ BİR kez kapanır.
//
// Yasak olan üç kaçış yolu burada da yok: global `unhandledrejection` susturması,
// körlemesine `.catch(() => {})` ve hiç sonuçlanmayan söz. Ret, bu modülde AntD'ye
// hiç verilmeden `then`in ikinci dalında TÜKETİLİR.
import type { App } from "antd";
import type { ModalFuncProps } from "antd";

type ModalOrnegi = { destroy: () => void; update: (config: ModalFuncProps) => void };
type ModalArayuzu = ReturnType<typeof App.useApp>["modal"];

export type OnayIsi = {
  /** Kilit/uçuş durumu — true iken pencere kapanmaz ve ikinci istek çıkmaz. */
  mesgulMu: () => boolean;
  /**
   * Gerçek iş. Söz döndürür; `null` "meşgul, istek çıkmadı" demektir.
   * Hata metnini ÇAĞIRAN gösterir (ekranın kendi `message.error`/alan hatası yolu).
   */
  calistir: () => Promise<unknown> | null;
};

export type OnaySecenekleri = Omit<ModalFuncProps, "onOk" | "onCancel"> & OnayIsi & {
  /**
   * Pencere GERÇEKTEN kapandığında (başarı ya da Vazgeç) koşar.
   *
   * AntD'nin `afterClose`u kapanış ANİMASYONUNA bağlıdır ve jsdom'da hiç tetiklenmez;
   * kilit/serbest bırakma gibi durum işleri ona bağlanırsa testte de üretimde de
   * "kapandı ama kilit açık kaldı" hâli doğar. Bu geri çağrı kapanışla AYNI adımda,
   * deterministik çalışır.
   */
  kapanista?: () => void;
};

/**
 * Onay penceresini açar ve kapanışını üstlenir. Dönen değer AntD örneğidir
 * (test/çağıran gerekirse `destroy` edebilir).
 */
export function onayAc(modal: ModalArayuzu, { mesgulMu, calistir, kapanista, ...ayarlar }: OnaySecenekleri): ModalOrnegi {
  let ornek: ModalOrnegi | null = null;
  let kapandi = false;
  const kapat = (calistirKapat: () => void) => {
    // Başarıda YALNIZ bir kez: ikinci bir çözüm (paylaşılan söz) ikinci kapanış üretmesin.
    if (kapandi) return;
    kapandi = true;
    calistirKapat();
    kapanista?.();
  };
  const okProps = ayarlar.okButtonProps ?? {};
  const iptalProps = ayarlar.cancelButtonProps ?? {};
  const bekleyenGorunum = (bekliyor: boolean) =>
    ornek?.update({
      // `update` nesneyi DEĞİŞTİRİR, birleştirmez: çağıranın `danger` gibi ayarları
      // her seferinde yeniden yazılır.
      okButtonProps: { ...okProps, loading: bekliyor },
      cancelButtonProps: { ...iptalProps, disabled: bekliyor },
    });

  ornek = modal.confirm({
    ...ayarlar,
    // ESC ve maske kapatmayı BİZ yönetiyoruz; AntD'nin kendi yolu `onCancel`i atlar.
    keyboard: false,
    maskClosable: false,
    onOk: (calistirKapat: () => void) => {
      // Meşgul: ikinci mutasyon açılmaz, pencere açık kalır, söz ÜRETİLMEZ.
      if (mesgulMu()) return;
      const soz = calistir();
      // `null` = kilit isteği reddetti (aynı varlıkta başka işlem): yine sessiz.
      if (!soz) return;
      bekleyenGorunum(true);
      void soz.then(
        () => kapat(calistirKapat),
        () => {
          // Hata ekranda gösterildi; pencere açık kalır ve düğme yeniden denenebilir.
          bekleyenGorunum(false);
        },
      );
    },
    onCancel: (calistirKapat: () => void) => {
      if (mesgulMu()) return;
      kapat(calistirKapat);
    },
  });
  return ornek;
}
