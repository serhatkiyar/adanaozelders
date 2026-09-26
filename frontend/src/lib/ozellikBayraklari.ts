/**
 * Lansmana yetişmeyen bölümlerin AÇMA/KAPAMA anahtarları.
 *
 * ## Neden bayrak, neden silme değil
 *
 * "Kütüphaneler" ve "Denemeler" ürün olarak bitmiş değil; kod olarak bitmiş.
 * Sayfaları, uçları, testleri ve verisi yerinde duruyor — eksik olan tek şey
 * lansmana yetişecek zaman. Bu yüzden bölümler SİLİNMEZ, DONDURULUR: menüde
 * görünür kalır ("Yakında" rozetiyle), tıklanamaz olur ve rotası gerçek sayfa
 * yerine "Yakında" ekranını açar.
 *
 * Bayrağı `true` yapmak tek başına yeterlidir; başka hiçbir dosyaya
 * dokunulmadan eski davranışın tamamı geri gelir. Bu sözleşme
 * `__guards__/bolumDondurmaBayrakAcik.test.tsx` tarafından korunur — dondurma
 * ile kalıcı silmeyi ayıran şey odur.
 *
 * ## Sınır
 *
 * Bu YALNIZ arayüz dondurmasıdır. Backend uçları, veritabanı ve operatör
 * (LIBRARY_OPERATOR) tarafı BİLEREK dokunulmadan bırakıldı: donmuş bölümün
 * verisi lansman sırasında da toplanmaya devam ediyor ve bayrak açıldığında
 * boş bir katalogla karşılaşılmıyor.
 */

/** Kütüphane/etüt merkezi kataloğu, profili ve self-servis kaydı.
 *  29 Ağu 2026: kullanıcı kararıyla AÇILDI (26 Eyl 2026'da teyit edildi). */
export const KUTUPHANELER_ACIK = true;

/**
 * Mağaza (D&R tarzı katalog, ürün detayı, sepet, kampanya sayfaları).
 * 16 Eyl 2026: kullanıcı kararıyla KAPATILDI — "şu anlık localde
 * geliştirelim, public olmasın". Kapalıyken kategori şeridinde GİZLİ
 * (donuk değil), mağaza adresleri "Yakında" açar, Hesabım'daki mağaza
 * kartları çizilmez. Sipariş, adres ve yönetim panelinin mağaza modülü
 * bayraktan bağımsız çalışmaya devam eder.
 * 26 Eyl 2026: kullanıcı kararıyla AÇILDI — lansmanın iki gelir kaynağından
 * biri. Satışın gerçekten açılması ayrıca `store_payments_live` DB bayrağına
 * ve gerçek ödeme sağlayıcısına bağlıdır (services/payment_gates.py).
 */
export const MAGAZA_ACIK = true;

/**
 * "Denemeler" — İKİ yüzeyi birden kapsar:
 *  1. Kütüphanelerin ücretli deneme oturumları (bilet/QR) — keşif sekmesi,
 *  2. `/denemeler` öğrencinin kendi deneme net takibi (Öğren hub'ı kartı).
 */
export const DENEMELER_ACIK = false;

/**
 * "Öğren" hub'ı ve altındaki çalışma araçları: aralıklı tekrar (FSRS),
 * Pomodoro zamanlayıcı, grafik çizici, alışkanlıklar.
 *
 * 5 Eyl 2026, kullanıcı kararı: *"öğren sayfasını şu an kullanmayalım."*
 * Lansmanda odak özel ders arzıdır; çalışma araçları ürünün hikâyesini
 * dağıtıyor. Kod, veri ve backend uçları YERİNDE — yalnız arayüz donduruldu.
 *
 * KAPSAM DIŞI: `/gorevler`. Hub kartlarından biri olmasına rağmen ders
 * detayındaki "Bu Derse Ait Görevler" akışı ona bağlı; dondurulursa öğrenci
 * ders içinden görev listesi oluşturamaz hâle gelir.
 */
export const OGREN_ACIK = false;

/**
 * Öğrenci talepleri: öğrencinin "şu dersi arıyorum" ilanı açması ve
 * eğitmenlerin bu ilanlara dönmesi (`/talepler`).
 *
 * 6 Eyl 2026, kullanıcı kararı: *"şu an kullanmak istemiyorum, kodları
 * dursun."*
 *
 * İKİ YÜZEY BİRDEN kapsanır ve bu zorunludur: öğrencinin "Taleplerim"i ile
 * eğitmenin "Gelen Talepler"i aynı akışın iki ucu. Yalnız öğrenci tarafı
 * kapatılsaydı eğitmen, hiç dolmayacak bir gelen kutusuna bakmaya devam
 * ederdi.
 *
 * Kod, veri ve backend uçları YERİNDE — yalnız arayüz donduruldu. Bayrağı
 * `true` yapmak tek başına yeterlidir.
 */
export const TALEPLER_ACIK = false;

/**
 * Ayarlar'daki "Görünüm ve tercihler" sekmesi: üst bar widget'ı (YKS/LGS geri
 * sayımı, hava durumu, saat), kısayol düzeni ve "son görüntülenenler" anahtarı.
 *
 * 5 Eyl 2026, kullanıcı kararı. Tercihler sunucuya değil localStorage'a
 * yazılıyordu; sekme kapanınca kullanıcının mevcut ayarları uygulanmaya devam
 * edip DEĞİŞTİRİLEMEZ hâle gelirdi. Bunu önlemek için saklama anahtarları da
 * bumplandı (bkz. store/navPrefsStore.ts, store/navbarWidgetStore.ts,
 * store/uiPrefsStore.ts) — herkes varsayılana döner, kimse kilitlenmez.
 */
export const KISISELLESTIRME_ACIK = false;
