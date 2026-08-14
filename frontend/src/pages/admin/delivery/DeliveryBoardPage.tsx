// İP-19 · Gün tahtası — İSKELET (kırmızı matris commit'i).
//
// Bu dosya bilinçli olarak BOŞTUR ve matris commit'inde açılmıştır. Sebebi
// ölçüm kalitesidir: `ip19Filo.acceptance.test.tsx` bu modülü import ediyor;
// modül hiç yokken Vite dosyayı **toplayamıyor** ve vitest "no tests" diyordu.
// "Sıfır test seçildi" bir kırmızı DEĞİLDİR — bu depoda mutasyon sürücüsünün
// açıkça BAŞARISIZLIK saydığı durumdur (`mutation_drill.py::_secilen_test_sayisi`).
//
// İskelet sayesinde kırmızı, iddia seviyesinde düşer: testler DOM'da
// `havuz-siparis-*` / `tur-*` / `kapasite-uyarisi-*` arar ve bulamaz.
// Yani ölçülen şey "modül yok" değil, "davranış yok" olur.
//
// Gerçek uygulama üretim kodu turunda buraya yazılacaktır (sözleşme §4.2).
export default function DeliveryBoardPage() {
  return null;
}
