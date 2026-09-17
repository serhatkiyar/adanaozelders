# Preply eğitmen deneyimi — analiz referansı

Kaynak: 2026-09-17 tarihli inceleme. Preply web uygulamasının herkese açık statik JS/CSS
paketleri (`static.preply.com/space`, 840 parça, 1031 GraphQL işlemi), Türkçe çeviri
paketleri (10.704 metin) ve onay bekleyen bir eğitmen hesabıyla açılabilen sayfalar.
Kilitli sayfalar (Ana Sayfa, Takvim, Analizler, Profilim) koddan çıkarıldı; ekran görüntüsü yok.

Bu belge **fikir referansıdır**. Preply'ın metinleri, görselleri ve marka rengi ürüne olduğu
gibi taşınmaz. Bizim marka rengimiz `#FF9900`. Preply'da olup bizde karşılığı olmayan
(abonelik, 28 günlük döngü, kurumsal öğrenci, yapay zekâ ders analizi) özellikler
doğrudan değil, uyarlanarak kullanılır.

Bizim modelle farklar: Preply online + deneme dersi + 28 günlük abonelik; bizde Adana'da
yüz yüze/online birebir ders, ücretsiz ilk ders ve tekli rezervasyon, ödeme emanette.

---

## 1. Temel ürün fikri

Panel rakam göstermekten çok eğitmene **sıradaki işini** söyler. Her ekran üç soruya
yanıt verir: şu an ne var, acil ne var, hangi öğrenci için ne yapmalıyım. Her iş tek
düğmelidir ve kapatılabilir / tamamlandı işaretlenebilir.

Eğitmen menüsü (masaüstü): Ana Sayfa · Mesajlar · Takvim · Öğrenciler · Sınıf · Analizler ·
Profilim · Ayarlar · Akademi. Üst çubukta bakiye ve "arkadaşını davet et" bağlantısı.
**Ayrı bir kazanç/bakiye sayfası yok**; kazanç Analizler'de, para çekme başlıktaki bakiyeden
açılan pencerede.

---

## 2. Ana Sayfa

Sıra (tek sütun; blok aralığı mobil 32px, ≥880px 64px):

1. **Selamlama** — "Günaydın/Tünaydın/İyi akşamlar, {ad}" (sınırlar 12:00 ve 18:00). Alt satır
   duruma göre: yeni eğitmen "Burada olman ne güzel", bugün ders yok "Bugün dersin yok.
   Planlamak ister misin?".
2. **Acil şeritler** (yalnız doluysa, sayı rozetli tam genişlik satır):
   - cevapsız potansiyel öğrenci mesajları ("profilini görünür tutmak için yanıtla"),
   - yaklaşan derslerde öğrencinin saat değişikliği istekleri,
   - "N öğrencin aboneliğini iptal etti" → tek öğrenciyse profili, çoksa akıllı filtreli liste.
     Aynı iptal bir kez gösterilir (localStorage, döngü başlangıcına göre).
3. **Sıradaki ders kartı** — avatar 48px, ad, saat aralığı, "Devam ediyor"/kalan süre; deneme
   yeşil, normal mavi zemin. Giriş düğmesi hiç devre dışı değil: >15 dk "Sınıfa gir" (ikincil),
   ≤15 dk veya başladıysa "Derse katıl" (birincil). Yan düğmeler: öğrenme hedefleri, mesaj,
   geçen denemenin özeti.
   Ders yoksa boş durum kartları (öncelik sırasıyla): yeni eğitmen · ≥3 öğrenci geri bildirim
   bekliyor · günün dersleri bitti "Harikasın!" · bekleyen eylem var · "Önceden hazırlan".
   Derse <3 saat varsa boş durum kartı gösterilmez.
4. **Sıradaki dersler** — önümüzdeki 3 gün, en fazla 3 ders, "Tümünü görüntüle".
5. **Öne çıkan eylemler** (`tutorPendingActions`), üç grup:
   - *Potansiyel öğrencileri yanıtla* — 3 avatar + "+N", "Mesaj gönder".
   - *Deneme öğrencilerinin başlamasına yardım et* — satır başına tek eylem: Öğrenciyi karşıla ·
     Öğrenim hedeflerini sor/gör · Deneme gündemini incele · Sıradaki adımları tasarla/paylaş.
   - *Aktif öğrencilerle etkileşime geç* — Haftalık ders planla (önerilen gün+saat) · Ders ekle ·
     Değerlendirme iste · Ders planla / Saat aralığı öner · Ödev gönder · Geri bildirim ver ·
     Ders isteğini incele.
   - Satır menüsü: "Görevi sil", "Tamamlandı olarak işaretle" → "Görev tamamlandı, bravo!".
   - Boş: "Güncel durumdasın." / tümü bitti: "Harikasın! Listendeki her şeyi tamamladın."
6. **Başarıları kutla** — "Birlikte {n} ders!", "Abonelik başladı!", "Yeni fiyat kabul edildi",
   "# öğrenci", "# ders", "Preply'da N. yıl", "Super Tutor oldun" (paylaş düğmeli, kapatılabilir).
7. **Öneri kartı karuseli** (masaüstü 4, tablet 2, mobil 1 kart) — uygulamayı indir (QR),
   sertifika/eğitim ekle, yoğun saatlere müsaitlik aç, deneme bildirim süresini kısalt,
   profil reklam izni, deneme ipuçları (zamanında başla, önceden mesaj at, sonrasında takip et,
   yapılandırılmış deneme, net sonraki adımlar).

Uyarı bantları (öncelik sırası, `TutorStatusBanner`): vergi eksik · standart ihlali ·
ders kaçırma · aktif ceza · Preply gizledi · kötü davranış · **cevapsız mesajlar yüzünden gizlendi** ·
kimlik doğrulama · adres · onay bekliyor · profil düzeltme notu · engelli.

---

## 3. Takvim

Altyapı: **FullCalendar** (`@fullcalendar/timegrid`, `interaction`, `luxon3`; MIT eklentiler).
Haftalık saat ızgarası, pazartesi başlangıç, 30 dk dilim, açılışta 06:00'ya kayar, "şimdi"
çizgisi, sürükle-bırak ve boyutlandırma, seçimde önizleme, özel çakışma fonksiyonu.
Mobilde "Takvim ↔ Ajanda (liste)" geçişi.

Olay türleri ve renkleri (zemin / metin):

| Tür | Renk |
|---|---|
| Deneme / ilk ders | teal `#d8f8f2` / `#067560` |
| Haftalık ders | pembe `#ffe5f0` / `#d13d76` |
| Tekli ders | mavi `#cce2ff` / `#0450b4` |
| Öğrencinin istediği saat | beyaz zemin + renkli çerçeve |
| Rezerve haftalık oturum | "Bu saat {öğrenci} için ayrıldı" |
| İzin | sarı |
| Google etkinliği | gri `#e2e6eb` / `#5a6b7a` |
| Yoğun saat önerisi | beyaz, gri çerçeve: "Yüksek talep. Yeni öğrencilere ulaşmak için bu saati aç" |

Eğitmen eylemleri:
- Boş alan seçimi → **Ders planla / İzin ekle / Ekstra müsaitlik aç**.
- Ekstra müsaitlik: geçmişe olmaz, en fazla 24 saat, izinle veya bildirim süresiyle çakışırsa uyarı.
- Haftalık müsaitlik ayarlardan (haftada en fazla 120 saat).
- **İzin iki adım**: (1) başlık + "Bu izin N dersini iptal edecek" listesi, (2) haber verilecek
  öğrencileri seç + not (hazır örnek metin).
- **Haftalık ders**: gün, saat, başlangıç tarihi, süre → önce **simülasyon** ("N ders
  planlanamıyor: şu tarihlerde sen veya öğrenci meşgul"), sonra kayıt.
- Sürükle-bırak yalnız ders kartlarında; geçmişe ve 210 dk üstüne taşınamaz.

Kurallar:
- Deneme ve normal ders için ayrı **en az önceden bildirim**: 1, 2, 3, 4, 5, 6, 12 saat, 1–2 gün.
- Rezervasyon penceresi: 1 veya 2 ay.
- **12 saatten az kaldıysa iptal yok, yalnız erteleme.** Bir kez <12 saatte ertelenmiş ders
  tekrar yalnız ertelenebilir.
- İptal formu: ders türü → politika uyarısı → "öğrenci kullanılmamış dersleri kaybedebilir"
  + **"Bunun yerine ertele"** → neden (sağlık, öğrenci istedi, öğrenci gelmedi, teknik, izin,
  program çakışması, diğer) + öğrenciye zorunlu yorum → "sıralamamın düşeceğini biliyorum" kutusu.
- Erteleme: <24 saat "kısa süreli değişiklik" uyarısı, 5 günden yakın "onaylamadan önce".
- **30 günde aynı öğrenciyle 3. erteleme** → "Son 30 günde N kez erteledin" + öneriler
  (izin ekle, takvimi bağla, haftalık ders kur).
- Öğrencinin saat değişikliği isteği: beklemede/kabul/red/süresi doldu/geri çekildi.
- Takvim senkronu: Google (etkinlikler müsaitliği bloklar; 24 saatten uzunlar bloklamaz),
  Outlook, Apple (`.ics` abonelik).

---

## 4. Öğrenciler

Liste kolonları: Ad · Tür (deneme/abonelik/paket/kurumsal/iptal) · Dersler (ilerleme çubuğu
"8 dersten 5'i planlandı", "Bakiye yok") · Yenileme · Sonraki ders · **Önerilen eylem** ·
satır ikonları (mesaj, planla, ders analizi, diğer).
- Varsayılan sıralama: sonraki ders ↑. Sıralama/filtre localStorage'da.
- Filtre: Görünürlük (Güncel/Arşiv) + Tür. **Akıllı filtre**: "Son 7 gün içinde iptal edildi ve
  kalan bakiye yok — bir mesaj geri getirebilir." Ana sayfada da önizlenir.
- Ad araması (1 sn gecikmeli). Boş: "Burada henüz öğrenci yok... hadi bunu değiştirelim" +
  "Profilini paylaş"; filtre boş: "Her şey sakin" + "Filtreleri temizle".
- Diğer menüsü: yeniden adlandır, arşivle/geri al, fiyat değiştir, sınıfa gir, geri bildirim ver,
  sonraki adımlar, deneme özetini gör.

Öğrenci detayı (yan panel) sekmeleri: **Genel · Dersler · Öğrenme ihtiyaçları · İlerleme**.
- Genel: tür, ders sayısı, sıklık, yenileme tarihi, deneme tarihi; **bu öğrenciden kazanç**,
  ders sayısı, süre; son 3 dönem ders kullanım yüzdesi; fiyatın aramadaki fiyatla karşılaştırması;
  zaman çizelgesi (başladı, yükseltti, düşürdü, iptal etti, fiyat değişikliği kabul/red).
- 7 gün içinde iptal kartı + nedene göre öneri.
- Dersler: Yaklaşan/Geçmiş; filtre tümü/ödenmiş/iptal/onay bekleyen; rozetler
  onaylandı/otomatik onaylandı/"{tarih} otomatik onaylanacak"/iptal/çözüm bekliyor/haftalık;
  eylemler ertele, düzenle, iptal, **onaylamasını hatırlat**, sorun bildir.

**Öğrenciye özel fiyat değişikliği**: mevcut/yeni fiyat + % değişim + zorunlu mesaj → öğrencinin
N gün yanıt süresi → kabul edilirse bir sonraki dönemden geçerli; planlı dersler eski fiyatta.
Engeller: abonelik aktif değil, ilk ders onaylanmamış, aynı teklif beklemede, öğrenci çok yeni,
min/max sınırı. Kabulde "bir süre tekrar zam yapma" uyarısı.

---

## 5. Ders çevresi akışı

**Deneme gündemi** (yalnız eğitmen görür, otomatik kaydedilir): sunucu varsayılan bölümleri
üretir; eğitmen bölüm ekler/siler/sıralar, not yazar, tamamlandı işaretler, "orijinale döndür".
İçinde öğrencinin paylaştığı öğrenme ihtiyaçları; yoksa "İhtiyaçlarını sor" tek tıkla sohbete
hazır mesaj bırakır.

**Öğrenme ihtiyaçları anketi** (öğrenci): hedef, kariyer, hobiler, eğitim, aile — kod/metin
listeleri, çoklu seçim.

**Deneme sonrası (eğitmen)**: "Harika iş! Şimdi kısa bir mesajla bağla" + hazır mesaj +
şablon seçimi ("bir dakika içinde gönder"). Ders erken bittiyse: her şey iyi / ders sorunu /
teknik sorun (12 etiket).

**Sıradaki adımlar** (öğrenciyle paylaşılır, taslağı yapay zekâ önerir): öğrenme hedefi,
odak beceriler, aylık kilometre taşları, sonraki ders konuları, önerilen materyaller, kısa not.
Öğrenci "{eğitmen}'in senin için planı" olarak görür + "Sıradaki dersi planla".

**Ders onayı**: onayı **öğrenci** verir ("{eğitmen} ile dersin gerçekleşti mi? Eğitmenin ödeme
alabilsin diye onayla" → Onayla / Sorun bildir). Otomatik onay: Preply sınıfında 15 dk,
dışarıda bitişten **72 saat** sonra.
Sorun bildirme — eğitmen: erteleme konusunda anlaştık (3 gün içinde ertele) · teknik sorun ·
öğrenci gelmedi (deneme → iptal; ücretli → iptal ve ödenmiş) · öğrenci onaylamadı · ben gelmedim ·
diğer. Öğrenci: eğitmen gelmedi (bakiyeye iade / yeni saat) · beklentimi karşılamadı.

**Ödev**: ders içeriğinden öğe seç + mesaj → gönder (gönderilince değişmez); durumlar
yapılacak/işleniyor/tamamlandı + doğruluk yüzdesi.

**Değerlendirme**: "Değerlendirme iste" ana sayfa ve öğrenci listesinde önerilen eylem.

---

## 6. Analizler (Performance Hub)

Kapsayıcı en fazla 960px. Bölüm sırası:
1. **Genel bakış** — ders, kazanç, aktif öğrenci, yeni öğrenci; 7/30/90 gün; değer + önceki
   döneme göre trend; "şu aralık, şu aralıkla karşılaştırıldı" notu.
2. **Başarının anahtarları** — kart başına ✓/✗, "X'i hedefle", "Canlı" etiketi,
   "bu değeri yükseltmek için eylemler mevcut".
3. **Yeni öğrenciler** — profil görüntülenme → deneme → abonelik; profilden denemeye dönüşüm
   hedefi %2; dünkü ortalama profil sıralaması.
4. **Super Tutor** — yarım daire gösterge "9 hedeften 7'si", her ayın 1'i son 90 gün.
5. **Kazanç grafiği** (Highcharts) — hafta/ay/çeyrek/yıl; mevcut/tahmini; rapor indir (tarih aralığı).
6. **Preply yolculuğun** — toplam gün, ders saati, ders, öğrenci, kazanç (paylaşılabilir).

Başarı eşikleri (koddan kesin):

| Metrik | Başarılı |
|---|---|
| İptal oranı | ≤ %5 |
| Erteleme oranı | ≤ %10 |
| Kaçırılan ders | 0 |
| 24 saatte yanıt oranı | ≥ %90 |
| Haftalık sabit ders oranı | ≥ %75 |
| Sınıfta yapılan ders oranı | ≥ %75 |
| Ortalama puan | ≥ 4,8 |
| Profil puanı | ≥ 90 (altındaysa eylem listesi) |
| Yoğun saat kapsaması | baseline'a göre; eksikse "N popüler 30 dk aralık daha ekle" |

Öğretim standardı ihlali (çeyrek): erteleme ≥ %40, iptal ≥ %20 veya kaçırılan ders ≥ 5 →
profil gizlenir, kısa kurs istenir.

Kötü metriğe tıklayınca: açıklama + hedef + **o metriği bozan dersler** (öğrenci, tarih,
deneme/normal, işlem tarihi, neden) + eylem düğmeleri (profili düzenle, mesajı yanıtla,
sonraki adımları paylaş, takvimi bağla, müsaitlik ayarla, fiyatı değiştir, yorumları gör).

Super Tutor (yeni set): kaçırılan ders 0, onaylı ders ≥ 40, puan ≥ 4,8, normal ders
iptal/erteleme ≤ %20, deneme iptal/erteleme ≤ %5, abonelik dönüşümü ≥ %50 (3'ten az denemede
geçmiş sayılır), denemeden önceki 24 saatte etkileşim ≥ %80, denemede sınıf kullanımı ≥ %80,
denemeden sonraki 24 saatte takip ≥ %80. Kazanımlar: rozet, aramada öne çıkma.

Ceza (kaçırılan deneme sayısına göre): 1 → video izle ve aç · 2 → kurs + tarih ·
3–4 → tarihte otomatik açılır · ≥5 → tarihten sonra açabilirsin.

Profil puanı kriterleri:
- Fotoğraf: ortalanmış, özel bilgi yok, iyi görünüm, başka kişi yok, filtre yok, kaliteli,
  iyi ışık, yüz görünür.
- Açıklama: dikkat çekici başlık, özel bilgi yok, okunabilir, 3. şahıs yok, kopyala-yapıştır yok,
  çok dilli, hatasız, faydalı.
- Video: yatay, sabit kamera, filtre yok, arka plan sesi yok, iyi ışık, sade arka plan,
  yalnız eğitmen, telif yok.

---

## 7. Mesajlar ve bildirimler

- Liste sekmeleri: Tümü / Okunmamış / Arşiv + arama. Kişi rozetleri: "Deneme dersi N gün önce",
  "Onay bekleyen ders", "Planlanmış ders yok", "Bakiye: 0 ders".
- Sohbet yan paneli: Detaylar · Öğrenme ihtiyaçları · Ekler · Asistan. Talep detayı: haftalık ders
  sayısı, ön ödemeli ders, ders fiyatı, sınıfa gir, arşivle, engelle.
- **Hazır mesaj şablonları** (başlık yalnız eğitmene görünür; ekle/düzenle/sil; göndermeden
  kişiselleştir).
- Sohbetten müsait saat önerme widget'ı; sesli mesaj; tepkiler; yanıtla; dosya eki + virüs
  taraması; **dolandırıcılık uyarı bandı**; dış bağlantı uyarısı; kısa yanıt uyarısı; karakter sayacı.
- ~200 sistem mesajı türü (yeni talep, deneme hatırlatma, ödeme, iptal, planlama/satın alma
  dürtmesi, yorum bırakıldı, sonraki adımlar paylaşıldı...).
- Cevapsız aday mesajları → profil otomatik gizlenir, sarı bant "mesajları gör".
- Bildirim merkezi: 60 sn'de bir yenilenir; kartta geri sayım, ilerleme çubuğu
  ("Ders planlama: planlandı/planlanmadı"), kopyala/bağlantı düğmeleri.

---

## 8. Ayarlar, kazanç, para çekme

Ayarlar sekmeleri: Hesap · E-posta · Şifre · Ödeme yöntemleri · Ödeme geçmişi · Otomatik onay ·
Takvim · Tercih edilen saatler · Bildirimler · İzinler · Profil tanıtımı · Vergiler · Hesabı sil.
- Bildirimler: kategori/alt kategori; işlemsel her zaman açık; ders hatırlatma 14 sa / 1 sa /
  15 dk önce veya ders günü 08:00.
- Profil tanıtımı: reklamlarda göster, dinamik fiyat izni, kurumsal aramada görün.

**Komisyon kademeleri** (tamamlanan saate göre): 0–20 %33 · 21–50 %28 · 51–200 %25 ·
201–400 %22 · 400+ %18. Deneme dersinde komisyon %100.

Cüzdan yalnız `balance` + `lastPayoutMethod`. Para çekme penceresi: (vergi) → e-posta kodu
(+ gerekirse SMS) → yöntem (önerilen etiketi) → hesap/tutar → özet "işlem ücreti, eline
geçecek" + "daha düşük ücret için X ve üzeri çek" → onay → "Para yolda". Aktarım genelde
1 saat, güvenlik için 48 saate kadar. Yöntemler: banka, Payoneer, PayPal, Skrill, Wise.

Davet: link/QR/WhatsApp; durumlar kaydoldu → deneme ayırttı → deneme aldı → abone oldu → tamamlandı.

---

## 8b. Başvuru, profil düzenleme ve herkese açık profil

Başvuru sırası: **Hakkında → Fotoğraf → Sertifika → Eğitim → Açıklama → Video → Müsaitlik → Fiyat**.
"Profilim" sekmeleri aynı bölümler; yanda önizleme/paylaşım kartı ve QR.

- **Hakkında**: ad, soyad (öğrenci yalnız baş harfini görür), e-posta, doğum ülkesi, ders,
  konuşulan diller + seviye, saat dilimi, telefon (opsiyonel); "18 yaşından büyüğüm" zorunlu;
  tamamı büyük harf yasak; internet hızı testi.
- **Fotoğraf**: JPG/PNG ≤ 5 MB; 1:1 kırpma, 1–3 kat yakınlaştırma, ±10° döndürme. Sunucu yüz
  denetimi: siyah-beyaz engel; yüz yok, birden çok kişi, fazla yakın, ortalanmamış, kameraya
  bakmıyor, güneş gözlüğü, düşük kalite uyarı.
- **Açıklama** dört bölüm: kendini tanıt · öğretim deneyimi · öğrencileri motive et · dikkat
  çekici başlık. Ortak sayaç: 400 karakter altı kırmızı. İlk iki bölüm 400'ü geçince yapay zekâ
  yazma yardımı (resmi/samimi/kısa). İstemci kontrolleri: boş, tamamı büyük harf, soyadı geçmesi,
  bölümler birbirinin kopyası, başlıkta tırnak. İletişim bilgisi/link tespiti sunucuda.
- **Video**: tarayıcıda kayıt, dosya (mp4/m4v/webm ≤ 200 MB) veya YouTube/Vimeo linki;
  30–120 sn, yatay, ≥ 320×240; soyad, iletişim, logo/link, slayt, başka kişi yasak;
  kapak 16:9 ≤ 20 MB (fiyat/indirim yazısı yasak).
- **Sertifika / eğitim / deneyim**: doğrulanmış listeden seç veya elle gir; belge JPG/PNG ≤ 20 MB;
  açıklama ≤ 500, alanlar ≤ 256 karakter; "sertifikam/diplomam yok" ile atlanabilir;
  ≤ 2 iş günü inceleme; doğrulanınca yeşil rozet, **belge dosyası silinir**.
- **Müsaitlik**: önce saat dilimi onayı; her gün için 30 dk adımlı birden çok aralık
  (yeni aralık 09:00–17:00); haftada ≤ 120 saat; ders+ülkeye göre en yoğun 4 saat önerisi;
  çok erken saatlerde "gerçekten ders verebilir misin?".
- **Fiyat**: 50 dk ders fiyatı; ders ve ülkeye göre öneri ("öneriye uyanların ilk hafta
  deneme alma şansı %40 daha yüksek"); aralık içi/dışı sinyali; ders süreleri 25/50 dk.
- **Onay durumları**: başvuru, ön onay, incelemede, düzenleme gerekli, onaylı, yeniden onay,
  engelli. Profil değişikliği incelemesi ≤ 3 iş günü; "Profil gönderildi" / "Kabul edilmedi" ekranları.

**Herkese açık profil** bölüm sırası: video → ana bilgi → hakkımda + diller → yorumlar →
takvim → özgeçmiş → uzmanlıklar → benzer eğitmenler. Masaüstünde sağda yapışkan fiyat/CTA
paneli, mobilde alt çubuk. Güven sinyalleri: yanıt süresi, ders sayısı, aktif öğrenci,
yıldız dağılımı, "öğrenciler genelde N+ ders alıyor", doğrulanmış diploma/sertifika rozeti,
Super Tutor. Aciliyet: "Çevrimiçi", "son 48 saatte N temas, M rezervasyon"; popülerlik
etiketi (4–5 "Çok popüler", 6+ "Süper popüler") yalnız son 48 saatte rezervasyon varsa veya
en az 2 yeni temas varsa gösterilir.

---

## 9. Preply'ın kendi ölçtüğü etkiler (arayüz metinlerinden)

Eğitmeni ikna için her öneri rakamla gerekçelendiriliyor:
- 24 saat içinde yanıt veren eğitmen %30'a kadar daha fazla deneme alıyor.
- Denemeden sonraki 24 saatte mesaj atan %50'ye kadar daha fazla abonelik alıyor;
  dersten hemen sonra mesaj alan öğrencinin abone olma ihtimali %60 daha yüksek.
- Öğrenme ihtiyaçlarını incelemek %18, sonraki adımları paylaşmak %21, hedef + sonraki adım +
  ritim konuşmak %27 daha fazla dönüşüm.
- Derse geç başlamak dönüşümü %10 düşürüyor.
- Yoğun saatlerin %80'inde müsait olan 3 kata kadar daha fazla yeni öğrenci alıyor.
- Yüksek profil puanı %25'e kadar daha fazla deneme; yüksek puan %40'a kadar daha fazla abonelik.
- Yüksek devam oranı %20, az erteleme %10 daha fazla öğrenci tutma.
- Deneme bildirim süresini kısaltmak %5'e kadar daha fazla öğrenci.

---

## 10. Tasarım sistemi (ölçüler)

Kırılımlar: 400 · **700** · **880** (dialog mobil→masaüstü) · **1200** (sayfa kabı) · 1900.

Renk (nötr): metin `#121117` / `#4d4c5c` / `#6a697c`; zemin `#fff` / `#f4f4f8` / `#ebebf1`;
kenarlık `#dcdce5`; odak `#006af5`. Durum (açık/koyu): başarı `#d8f8f2`/`#067560`,
bilgi `#cce2ff`/`#0450b4`, uyarı `#fff5c2`/`#966208`, hata `#ffe2e0`/`#a3120a`.
Marka pembe `#ff7aac` — **bizde `#FF9900` ile değişir**.

Tipografi: gövde Figtree; başlık 64/68, 48/52, 32/36, 24/32, 20/24; gövde 20/28, 16/24, 14/20,
12/16; ağırlık 400/600.

Boşluk: 0, 2, 4, 8, 12, 16, 20, 24, 32, 48, 64, 96. Köşe: 4 (avatar, rozet), 8 (buton, input,
kart, dialog), 16. Gölge: `0 4px 16px` / `0 8px 32px` / `0 16px 48px` `rgba(18,17,23,.15)`.
Odak: 2px `#006af5`, offset 2px.

Bileşenler: Buton 40/48/56 yükseklik, padding 16/24/28, 600 ağırlık, 2px kenar, köşe 8.
Input 48 yükseklik, 2px kenar. Kart 1px kenar, köşe 8, padding 24. Rozet min 20/24/32.
Avatar 24/32/48/64/96/160, **kare köşeli (4)**. Dialog mobilde alttan tam genişlik (padding 24),
≥880px ortada (32; genişlik 440/520/640/840). Sekme altı 4px vurgu çizgisi. Toast koyu
`#302f3b`, sağ üst, max 385px. İkonlar kendi SVG seti, 24'lük viewBox, `currentColor`.
Hareket: 220ms `cubic-bezier(0.22,1,0.36,1)`; `prefers-reduced-motion` destekli;
hover yalnız `(hover:hover) and (pointer:fine)`.

---

# ÖĞRENCİ TARAFI

Kaynak: aynı JS paketleri + 7.534 öğrenci metni + öğrenci hesabıyla canlı gezinti (arama,
profil, deneme dersi ayırtma → ödeme sayfası; ödeme yapılmadı) ve herkese açık sayfalar.

## 12. Arama, iniş sayfaları, keşif

**İniş sayfası** (`/tr/online/ingilizce-eğitimi`): solda eğitmen+öğrenci görsel kolajı, sağda
H1, kısa giriş ("Devamını oku"), **"Hızlıca birkaç soru cevaplayarak kişiselleştirilmiş bir
öğretmen seçkisine eriş"** + ders seçici + "Öğretmenini bul" ya da "46.070 öğretmeni göster".
Bölüm sırası: eğitmen listesi · nasıl çalışıyor (3 adım) · uyruğa göre ücretler · ortalama
ücretler · seçenekler · nasıl işliyor · para iade garantisi · SSS.

**Şehir sayfası** (`/tr/Adana/ingilizce-eğitimi`; şehir adı büyük harf): canlı sayılarla H1 ve
giriş; liste → "neden en iyi site" → şehirlere göre fiyat tablosu → ana dili olan/olmayan
fiyatlar → şehir yorumları → iç bağlantılar (aynı şehirde diğer dersler, diğer şehirler).
**Tamamen online; yüz yüze/ilçe/yerel bilgi yok** — bizim ayrışma alanımız. Filtreli sayfa ve
2. sayfa sonrası `noindex, follow`, canonical her zaman; yapılandırılmış veri: eğitmenler (fiyat,
puan), sayfa puanı, yorumlar, fiyat aralığı, hizmet şehri, breadcrumb. Profil altbilgisinde
"Bursa şehrinde İngilizce öğretmenleri" gibi şehir iç bağlantıları.

**Filtreler** (URL'de): hedef, ilgi alanı, ders ücreti (histogramlı kaydırıcı), öğretim tarzı,
konuştuğu diller, öğretmenin ülkesi, kategoriler (ana dili, sertifikalı, Super Tutor), müsaitlik
(gün × 8 saat dilimi), cinsiyet, metin araması, favoriler. Sıralama: bizim seçtiklerimiz,
popülerlik, fiyat ↑↓, puan, yorum sayısı. Mobilde tam ekran filtre + canlı "N öğretmeni göster".
Boş sonuç: "eşleşme bulamadık" + kaldırılabilecek filtre çipleri. Sıralama sunucuda,
kişiselleştirilmiş (embedding).

**Eğitmen kartı (masaüstü)**: sol fotoğraf (çevrimiçi noktası) · orta: ad + doğrulama + bayrak,
Profesyonel/Süper öğretmen rozeti, ders, diller ve seviyesi, **öğretim tarzı etiketi**
("Hedef odaklı ve teşvik edici"), kalın başlık + kırpılmış açıklama, "Daha fazla",
**"Çok popüler. Yakın zamanda 73 kez ayırtıldı"** · sağ: fiyat "/50 dakikalık ders", puan +
yorum sayısı, öğrenci, ders; "Deneme dersi ayırt" (birincil), "Mesaj gönder"; favori kalbi.
Hover'da sağda yapışkan panel: video, "Programın tamamını gör", "Profiline bak".
Popülerlik (son 48 saat rezervasyon): ≥5 Popüler, ≥12 Çok popüler, ≥20 Süper popüler.
**Mobil kart**: fotoğraf + ad + puan + fiyat üstte, başlık, tarz etiketi, "39 aktif öğrenci ·
5.021 ders", altta ikon mesaj düğmesi + tam genişlik "Deneme dersi ayırt".

**Eşleştirme sihirbazı** (canlı, `/tr/get-started`, iniş sayfasındaki "Öğretmenini bul"):
her adım tam ekran (üstte illüstrasyon bandı, geri oku, başlık, seçenekler, altta tam genişlik
"Devam et" — seçim yapılana kadar pasif). Adımlar (sınav hedefi seçilince):
1. Hedefin nedir? — Kariyer ve iş / Çocuklar için dersler / Sınavlar ve ödevler / Kültür, seyahat ve hobi
2. Hangi sınava veya konulara odaklanmak istersin? — Tercihim yok / IELTS / TOEFL / … "Tümünü göster"
3. Sınavına ne kadar süre kaldı? — 1-4 hafta / 1-3 ay / 3-6 ay / 6 aydan fazla / Henüz bir tarih yok
4. Sınavın senin için en önemli bölümleri hangileri?
5. Seviyen nedir?
6. Sana en uygun öğretim tarzı hangisi? — en fazla 3 seçim
7. Öğretmenin nereli olsun istersin?
8. Öğretmenin başka diller de konuşsun mu?
9. Ders için ne zaman uygunsun? — Günler (Pzt…Paz) + Zamanlar (Sabah / Öğleden sonra / Akşam / Gece)
10. Bütçen nedir?
11. Gelecekte başka bir konu öğrenmek ister misin? → "{Ders} öğretmenlerini keşfet"
Her cevap URL'ye yazılır (`goal=exam&specialties=…&goal_achievement_period=WEEKS_1_4&level=…&
tutor_style=…&times_of_day=EVENING&days_of_week=sat`) ve sonuç listesinin filtresi olur.
Hedefe göre dallanır (sınav → sınav soruları; çocuk → çocuk soruları).

## 13. Herkese açık eğitmen profili (canlı)

Masaüstü: sol sütunda video → fotoğraf + ad + "İngilizce öğretmeni · Türkiye" → **"İngilizcede
en iyi %5'lik dilimde · 5.022 ders verdi"** → "öne çıkan özellikler" (tarz etiketleri) →
verdiği dersler → Hakkımda ("Devamını göster") → konuştuğu diller + seviye → yorumlar
(puan, "78 öğrenci değerlendirmesine göre", ad + tarih + metin, çeviri, "tümünü göster") →
**Program** ("İlk dersinizin zamanını seçin. Saatler saat diliminizde") → Özgeçmiş (eğitim,
sertifika, "Diploma doğrulandı") → uzmanlık etiketleri → benzer öğretmenler → breadcrumb.
Sağda yapışkan kart: fiyat, puan, ders sayısı, "Deneme dersi ayırt", mesaj / favori / paylaş
ikonları, altında **"Olmadı mı? Hâlâ 2 ücretsiz öğretmen deneme hakkın var."**
"Genellikle 1 saat içinde yanıt verir". Eğitmen hesabıyla: "Eğitmen olarak giriş yapmışsınız —
ders ayarlamak için öğrenci olarak kayıt olun".

**Ders puanı** (yorumlardan ayrı blok): 4 alt puan — **Motivasyon · Netlik · Gelişim · Hazırlık**
(her biri 4,9) — "152 anonim öğrenci değerlendirmesi baz alınmıştır"; herkese açık yorum sayısı
ayrı (78). Anonim ders sonu puanlaması profile ayrı bir güven sinyali olarak yansıyor.

**Mobil profil** (390 px): video tam genişlik → fotoğraf + ad + ülke → "en iyi %5" rozeti →
"Mesaj gönder" + paylaş → "Genellikle 1 saat içinde yanıt verir" → puan / ders / fiyat satırı;
**altta yapışkan çubuk: favori kalbi + "Deneme dersi ayırt"**. Özgeçmiş Eğitim/Sertifikalar
sekmeli, uzmanlıklar açılır liste.

**Eğitmen başvurusu sonrası** (canlı): üstte onay işaretli 8 adımlı şerit (Hakkında › Fotoğraf ›
Sertifika › Eğitim › Açıklama › Video › Müsaitlik › Ücretlendirme), gönderildikten sonra adımlar
kilitli. "Kaydını tamamladığın için teşekkürler" + "Şimdi ne olur?": 1) 2 iş günü içinde inceleme,
2) düzeltme gerekirse e-posta, 3) onaydan sonra platforma erişim, 4) profili yayınla ve
öğrencilerle iletişime geç; sonunda eğitim kursuna bağlantı.

## 14. Deneme dersi ayırtma → ödeme (canlı)

1. **Süre penceresi**: "Deneme dersinin süresi ne olsun istersin?" — 25 dk "Öğretmeni tanı,
   hedeflerini paylaş ve öğrenim planını incele" / 50 dk "25 dakikalık dersteki her şeye ek olarak
   öğrenmeye başla". Seçmeden "Devam et" pasif.
2. **Saat penceresi**: üstte 25/50 dk segment, "17–23 Eyl 2026" + oklar, 7 günlük şerit (bugün
   vurgulu), "Senin saat diliminde, Europe/Istanbul", saatler **"Öğleden sonra" / "Akşam"**
   başlıklı gruplarda 30 dk'lık düğmeler (3 sütun), seçilince "Devam et" aktif.
3. "Devam et" → talep (lead) oluşur, sohbet listesinde öğretmen görünür → `/checkout/{id}`.
4. **Ödeme sayfası** (pembe üst bant, sade başlık, iki sütun):
   - Sol: **Öğretmenin** (ad, puan, öğrenci/ders/yıl deneyim kutuları) · **Deneme dersi
     bilgileri** (EYL 18 tarih kutusu, 17:00–17:50, "Yerel saatinle") + yeşil bant
     **"18 Eyl, 05:00 tarihine kadar ücretsiz iptal veya değişim"** (derse 12 saat kala) ·
     **Ödeme bilgisi**: 25 dk ₺949 / 50 dk ₺1.572 seçici, ders ₺1.557,44 + işlem ücreti ₺14,60,
     Toplam ₺1.572,04, "$32,30 olarak ücretlendirilir", "Promosyon kodun mu var?",
     **"Ücretsiz öğretmen değişimi — bu öğretmen uygun değilse 2 öğretmen daha ücretsiz dene"** ·
     "Muzaffer harika bir seçim" + puan + bir yorum.
   - Sağ: "Nasıl ödeyeceğini seç" Kart / Apple Pay / Google Pay / PayPal, "Bu kartı gelecek
     ödemeler için kaydet", **"Dersi ayırt ve öde · ₺1.572,04"**, politika onay notu,
     "SSL şifrelemeyle korunmaktadır".
   - Mobilde iki adım (bilgiler → "Ödemeye geç").
5. Koddan: kayıt saat seçiminden **sonra** istenir, seçilen saat korunur; deneme koruması
   penceresi bir kez; hata metinleri (kart reddi, 3DS, saat artık müsait değil); başarı ekranı
   "Google Takvim'e ekle", "Derse hazırlan" (duygu kontrolü, konular, öğretmene mesaj, abonelik
   tanıtımı). Çıkış anketinde "deneme dersinin bedava olacağını sanmıştım" seçeneği var.

## 15. Öğrenci paneli

Menü: yatay sekme şeridi **Ana Sayfa · Mesajlar · Derslerim · Ayarlar** (sağda "İş için"),
aktif sekmenin altında renkli çizgi; üst çubukta Öğretmen Bul, Arkadaşına öner, dil/para,
mesaj, yardım, favoriler, bildirim, avatar; bakiye varsa "Planlanacak N ders".

**Ana sayfa** — boş hesap: pembe bant, "Nasıl gidiyor, {ad}?" + "Senin için en iyi öğretmenle
öğrenim yolculuğuna başla", üç eğitmen fotoğrafı, "Ücret, müsaitlik ve diğer özelliklerine göre
kolayca bir öğretmen bul", "Öğretmenleri keşfet".
Dolu hesap (koddan): ana kart tek, öncelik sırası → bakiye hatırlatma · yükseltme · **sıradaki
ders** ("Dersin yarın başlıyor", "Derse katıl" / "X saat içinde katıl", Google Takvim'e ekle,
"Dersinden önce" kontrol listesi) · ödeme sorunu · **"Öğretmenin takviminde az önce yer açıldı —
Şimdi planla"** · bakiye kartı · yeni öğretmen bul · kötü puan sonrası öneriler.
Altında **"Sıradaki"** zaman çizelgesi (ilk 3 kart + "daha fazla"): ders, haftalık program
rezervi, abonelik bitiyor, ek ders, tercih edilen saatler, eğitmen geri bildirimi, sıradaki
adımlar paylaşıldı, değerlendirme hatırlatma, başka öğretmen dene. Sonra ilerleme, materyaller,
"Öğrenmeye devam et", abonelikler.

**Derslerim** — boş: "Henüz ders yok — uygun bir öğretmen bulup ilk dersinizi ayırttığınızda
burada görebileceksiniz" + "Öğretmen bul". Dolu (koddan): Liste / Takvim / Öğretmenler görünümü;
Onaylanmamış (3'er) · Yaklaşan · Geçmiş (5'er) · Haftalık dersler. Duruma göre eylemler
(gelecek: ertele, mesaj, profil, iptal · bitmiş: onayla, sorun bildir · tamamlanmış: puanla).
Etiketler: onaylandı, iptal, "iptal edildi ve ödendi", ödendi, ödeme bekliyor, çözüm bekliyor.

**Ders planlama** (bakiyeli öğrenci): "Tek dersler / Haftalık dersler" sekmeleri, haftalık ızgara,
çoklu slot seçimi ("Ders 1, Ders 2…", "Planlanacak N ders"), tek istekle kayıt; seçim yoksa
"{Öğretmen} bu hafta dolu" + sonraki müsait tarih / mesaj / haftalığa geç; tek dersten sonra
"Bu saat her hafta uygun — haftalık yap?"; **tercih edilen saatler** (gün/saat/süre) ile öneri;
kapatırken "Rezervasyona bir adım kaldın".

**İptal (öğrenci)**: politika saati sunucudan (≈12 saat); süre geçtiyse yalnız iptal ve bakiyeden
düşer, erteleme yok. Önce **"Bunun yerine başka zamana al"** (yeni öğrenciye "istikrarlı
öğrenciler 3 kat hızlı ilerliyor"), sonra zorunlu neden + öğretmene mesaj, nedene göre alternatif
saat önerisi. Öğretmen dersi değiştirirse öğrenciye **"Bu değişikliği sen mi istedin?"**
(eski/yeni saat; Hayır → yeniden planla). Öğretmen gelmediyse: yeni saat veya "dersi bakiyeme
iade et"; denemede ücretsiz yeni deneme (en fazla 2).

**Mesajlar**: Tümü / Okunmadı / Arşivlendi; sağda "Konuşma başlatmak için bir öğretmen seç".
**Ayarlar**: sol menü Hesap · Şifre · E-posta · Ödeme yöntemleri · Ödeme geçmişi · Otomatik onay ·
Takvim · Bildirimler · Hesabı sil; Hesap: profil resmi (≤ 2 MB, JPG/PNG), ad (gerekli), soyad,
telefon, saat dilimi, sosyal hesap bağlama, "Değişiklikleri kaydet".

## 16. Abonelik, bakiye, elde tutma

- 28 günlük döngü; plan "haftada N ders", "4 haftada {fiyat}", ders başı fiyat; "Popüler"
  etiketi haftada 3 derste; 12 haftalık ödemede indirim; özel plan (+/−, en fazla 20 ders).
- Ek ders (tek seferlik), dönemde en fazla 2 kez; ikincide "planını yükselt".
- Yenilemeyi 20 güne kadar erteleme (uyarı: "öğrencilerin %50'si dondurduktan sonra bırakıyor").
- **İptal akışı nedene göre dallanır**: giriş (dondur / küçük plan / devam) → neden anketi →
  pahalı/kullanılmayan → düşük plan; ara vermek → "ne zaman döneceksin? 1–4+ ay" → o tarihe
  dondur teklifi; bakiyesi olana başka öğretmen → FOMO kartları (tamamlanan ders, seri) → başarı
  ekranı + "iptali geri al".
- Öğretmen değiştirme: kalan bakiyeyi aktar, fiyat farkı öde/krediye çevir, eski öğretmene
  düzenlenebilir **teşekkür notu**, "neden" anketi (öğretmenle paylaşılmaz).
- Başarısız yenileme: tekrar dene / yeniden başlat / daha küçük plan.
- Üst üste 2 kaçırılan ders → "yaklaşan derslere katılacak mısın?"; 3'te gelecek dersler iptal,
  bakiyeye döner.
- İade: son ödemeden beri ders planlanmadıysa ve 28 günden az geçtiyse; 12 saatten az kalan ders
  iade edilmez.

## 17. İlerleme ve etkileşim

- **İlerlemem**: haftalık etkinlik (ders + bireysel çalışma), önceki haftaya göre değişim,
  en iyi seri (hafta), tamamlanan ders, çalışma dakikası (ortalama / en iyi gün / en iyi hafta),
  boş haftada "Bu hafta henüz ders almadın — ders planla", veri azsa "N ders sonra görünür".
  Konu hâkimiyeti grupları (henüz kullanılmadı / pratik gerekli / iyi / tam hâkim) — matematik,
  fizik için doğrudan uyarlanabilir.
- **Hedef formu**: hedef türü, belirli hedef, süre, seviye, sınav + odak alanları, tempo,
  tercih edilen gün/saat, okul, ilgi alanları, çocuk mu; önce öğrenci inceler → öğretmenle
  paylaşır ("yalnız öğretmenin görür"); değişiklikler öğretmene bildirilir. Hedef + süreye göre
  tempo önerisi (Hafif/Dengeli/Yoğun, "Senin için önerilen").
- **Öğretmenin planı** (sıradaki adımlar): hedef, aylık ara hedefler, sonraki ders konuları,
  beceriler, kaynaklar, mesaj; "Bir sonraki dersi planla"; plan yoksa öğrenci "plan iste".
- **Ödev**: yapılacak/işleniyor/tamamlandı, doğruluk %, "{öğretmen} ödev verdi 2/5",
  "İyi yaptıkların / daha iyi yapabileceklerin"; dersten önce kontrol listesi.
- **Aylık yansıma**: "İlerlemen nasıl hissettiriyor?" (harika/yolunda/geride) → hedefe göre
  soru → olumlu: öğretmende neyi seviyorsun · olumsuz: ne yavaşlatıyor → dondur / küçük plan /
  önerilen öğretmenler.
- **Değerlendirme**: deneme sonrası 3 seviye (kötü/iyi/harika) + etiketler, "yalnız Preply ile
  paylaşılır"; normal ders anonim puan; herkese açık yorum ayrı ve moderasyonlu.
- **Paylaşılabilir anlar**: N saat ders sertifikası, hedefe ulaşma, öğretmen iltifatı
  ("Harika bir ödev"), yıl dönümü — davet ödülüne bağlı.
- **"Nereden duydun" anketi**: arama motoru / sosyal medya / öneri / YZ aracı / reklam… +
  alt sorular, her adım atlanabilir.
- **Bildirimler**: ders hatırlatma 14 sa / 1 sa / 15 dk önce veya ders günü 08:00; dürtmeler:
  planlanmamış dersler yanıyor, takvimde yer açıldı, haftalık saat önerisi, bu hafta ders yok,
  hedeflerin seni bekliyor.

---

## 19. Resmî kurallar (yardım merkezi, İngilizce makaleler)

Not: bazı makaleler birbiriyle çelişiyor veya eski olabilir; koddaki değerler öncelikli.

**Öğrenci**
- Deneme dersi 25/50 dk ve **ücretli**; eğitmen başına 1 deneme. Memnun kalınmazsa hesap başına
  **toplam 2** ücretsiz öğretmen değişimi (yeni denemeye %100 indirim); koşul: deneme tamamlanmış
  ve o eğitmenle abonelik başlamamış. Eğitmen gelmediyse bu hak harcanmaz.
- İptal/erteleme eşiği **12 saat**: öncesinde ders bakiyeye döner, sonrasında eğitmen ücretini alır.
- İade: yalnız abonelik iptal edilmiş ve o döngüde ders kullanılmamışsa, çekimden sonra **28 gün**
  içinde destekten; paranın dönmesi **30 güne kadar**. Kullanılmayan bakiye **180 gün** sonra düşer.
- Eğitmen gelmezse: öğrenci 15–20 dk bekler, ders bitince bildirir; ders bakiyeye döner, eğitmen
  para almaz.
- Otomatik onay: sınıfta **15 dk**, dışarıda **72 saat**; onay ücreti eğitmene geçirir ve
  **geri alınamaz**; onayı yalnız öğrencinin şikâyeti durdurur.
- Abonelik: 28 gün, en az 4 ders; ayırtılmamış plan dersleri yenilemede yanar, ayırtılmış ders
  yanmaz; ekstra dersler 2 döngü geçerli; dondurma döngü başına 1 kez 1–20 gün; fiyat artışı
  öğrencinin açık onayı olmadan uygulanmaz.
- Şikâyet: "Sorun bildir", 72 saatlik pencere, karar Preply'da.
- Yorum: **3. ders** tamamlandıktan sonra e-posta davetiyle; düzenlenebilir; link, iletişim
  bilgisi, küfür, siyasi içerik yasak; Preply kaldırabilir.

**Eğitmen**
- Başvuru: 8 bölüm, inceleme ≤ 5 iş günü (başvuru ekranı "2 iş günü" diyor). Red: profil
  şartları, 18 yaş altı, konuya talep azlığı, yaptırımlı ülke.
- Komisyon: yeni öğrenci deneme dersi **%100**; normal ders 0–20 saat %33 → 400+ saat %18.
- Kazanç ders onaylanınca bakiyeye geçer. Çekim üst sınırı çoğu yöntemde 3.000 $; banka/Wise
  en az 10 $, PayPal %2 (≤ 20 $), Payoneer işlem başı 1–3 $, Skrill %1.
- Eğitmen <12 saatte iptal edemez, yalnız erteler. Son 90 günde 5+ rezervasyonu olan için
  eşik: kaçırılan ders < 5, kısa süreli erteleme < %40, iptal < %20; aşılırsa profil yalnız
  aramadan gizlenir, metrik düzelince otomatik geri gelir.
- Kaçırılan deneme kademeleri: 1) eğitim tamamlanana kadar gizli, 2) 7 gün, 3) 14 gün,
  4) 30 gün, 5) yeni öğrencilere 2 yıl gizli.
- Öğrenci üst üste 3 derse gelmezse kalan dersleri otomatik iptal edilir.
- **İlk ders ödenmeden** telefon, e-posta, sosyal medya, dış link paylaşımı yasak: ilk ihlalde
  profil bloke, tekrarında kalıcı silme.
- Fiyatı eğitmen belirler; mevcut öğrenciye zam için "90 gün bekle" tavsiyesi.
- Arama sıralamasında açıklanan faktörler: profil doluluğu, uzmanlık, dil, müsaitlik, fiyattaki
  dönüşüm, iptal/devamsızlık, ücretli reklam (ağırlıklar açıklanmamış).
- Eğitmen 18 yaş üstü; "doğrulanmış" rozeti belgeli kimlik kontrolü.

**Bizim modele çıkarım**: ilk ders ücretsiz olduğunda maliyeti eğitmen taşır → öğrenci başına
ücretsiz ilk ders sınırı gerekir. Emanet ödeme Preply mantığıyla uyumlu (onaya kadar bekle,
şikâyet onayı durdurur); yüz yüze derste sınıf kaydı olmadığı için iki tarafın beyanı gerekir.
Yol süresi yüzünden yüz yüze derste iptal eşiği 24 saat düşünülebilir.

---

## 20. Teknik SEO (herkese açık sayfalar, sitemap)

- `tr-sitemap-index.xml` → 16 alt sitemap. Sayılan URL'ler: şehir × ders 1026, şehir uzmanlık 112,
  ana dili 98, sınav 36; online ders 108, online uzmanlık 122, kurs 179; blog 309; öğretmen
  profilleri 11 dosya (ilk dosyada 10.000). Listeleme sitemap'lerinde hreflang yok, `lastmod`
  her gün bugüne yenileniyor.
- URL şablonları: `/tr/online/{ders}-eğitimi` · `/tr/{Şehir}/{ders}-eğitimi` ·
  `/tr/{Şehir}/öğretmeni-s-{etiket}` · `/tr/{Şehir}/yabancıdan-{dil}` · `/tr/öğretmen/{id}`.
- 146 şehir/ilçe; **Adana 25 sayfa** (7 ders, 5 ana dili, 9 uzmanlık, 4 sınav), Osmaniye 10,
  Mersin "Mercin" yazım hatasıyla 8 (+ Tarsus, Silifke), Hatay il sayfası yok (Antakya,
  İskenderun, Dörtyol var). Dil dışı derslerden yalnız **matematik**; fizik 404, kimya yok.
- Adana/İstanbul/Mersin matematik sayfaları **aynı online öğretmen listesini** gösteriyor;
  yalnız şablon metin değişiyor. Title/H1 "Özel Ders Matematik öğretmeni (Adana)", 1450–1870
  kelime, canonical kendisi, hreflang ve robots meta yok.
- JSON-LD: `LocalBusiness` (ABD adresi, `areaServed: Adana`, TRY fiyat aralığı, ders genelinde
  aynı puan), `ItemList` → `Product` + `Offer` + `AggregateRating` (10 öğretmen),
  `BreadcrumbList` (iki kez). FAQ şeması ve görünen SSS yok.
- Sayfa hataları: metinde "GENERAL_TAG" yer tutucusu, toplam öğretmen sayısı üç şehirde aynı
  (6353), aynı şehirdeki üç ders linkinin metni hepsi "Ingilizce kursu - Adana".
- İç bağlantılar: 30 profil, aynı şehirde 3 ders, 2 uzmanlık, rastgele 10 şehir, şehir ücret tablosu.
- `?page=2` → `noindex, follow` + canonical sayfa 1; fiyat/sıralama filtreleri → indexlenebilir,
  canonical temiz URL.
- Profil: title "{Ad S.}, {başlık}", description bio başı; JSON-LD `Product` (Offer, puan,
  `review`) + `ProfilePage/Person` + breadcrumb.
- Blog büyük ölçüde İngilizce öğrenimi; matematik/LGS/YKS yok; şehir sayfalarına link yok.
- Arama sonuçları (ABD merkezli araç, doğrulanmamış sıra): "Adana matematik özel ders"te
  Armut, Superprof ("767 öğretmen"), Özel Ders Alanı ("935 öğretmen") ve Preply;
  "Adana ingilizce özel ders"te Preply ilk 10'da değil.

**adanaozelders.com.tr için SEO mimarisi**
- URL: küçük harf ASCII `/adana/{ders}-ozel-ders`, öğretmen varsa `/adana/{ilce}/{ders}-ozel-ders`,
  sınav alt sayfaları (`/adana/matematik-ozel-ders/lgs`), `/ogretmen/{slug}-{id}`, dizinler
  `/dersler`, `/ilceler`.
- Her sayfa: gerçek öğretmen sayısı ve sunucuda hesaplanan fiyat (title + H1), gerçek API'den
  liste + yüz yüze/online rozeti, sayfaya özgü yerel metin, doğrulanmış yorumlar, görünen SSS,
  doğru iç linkler, breadcrumb.
- Şema: iniş `BreadcrumbList` + `ItemList` + `FAQPage` + `Service`/`EducationalOrganization`
  (`areaServed`: Adana/ilçe); profil `ProfilePage` + `Person`; puan/yorum şeması yalnız sayfada
  görünen gerçek yorumlardan.
- İndeksleme: sayfalama `noindex, follow`; filtreler canonical temiz URL; öğretmeni az olan
  sayfa `noindex` ve sitemap dışı; karşılığı olmayan ders-ilçe 404; türe göre bölünmüş sitemap,
  `lastmod` gerçek değişiklik tarihi.

---

## 21. Mesajlaşma, bildirim, yorum, güvenlik (derin)

**Sistem mesajları** (~190 tür, gövde metinleri sunucudan gelir): tebrik çıkartmaları (eğitmen →
öğrenci: "Çalışkan ve motive", "Cesur ve özgüvenli", "Harika ödev"); ders/plan (iptal, ödendi,
haftalık program kuruldu, yeni müsaitlik, saat önerisi, müsaitlik isteği); satın alma/planlama
dürtmeleri ve kaçan ders uyarıları (1/2/3); talep ve deneme (yeni talep, denemeden önce iletişim
hatırlatması, deneme sonrası plan); hedefler ve sıradaki adımlar; değerlendirme (yorum bırak,
öğrenci yorum bıraktı/güncelledi, yorum ipuçları); test/kurs; grup dersi; kurumsal; platform
duyuruları. ~70 buton türü (dersi onayla, saat öner, rezervasyon penceresini genişlet,
yorumlara yanıt ver, teşekkür gönder, abonelik dondur…).

**Mesaj içinden planlama**:
1. Eğitmen "Hızlı işlemler" menüsünden hazır mesaj seçer (saat öner, ilk dersten önce, planlanmış
   ders yok, onaylanmamış ders, haftalık saat, öğrenme ihtiyacını sor).
2. Öğrenci sohbette müsaitlik widget'ı görür ("{tarih aralığı} için müsaitlik", "# seçenek daha",
   "Programın tamamını gör", boşsa "Bu hafta boş saat yok"); slota tıklayınca planlama sayfası
   o slot seçili açılır.
3. Öğrenci "başka saatin var mı?" isteği gönderir → eğitmen Kabul et / Reddet / Mesaj.

**Mesaj kuralları ve güvenlik**: 10.000 karakter sınırı (sayaç 9.500'de görünür); eğitmenin
ilk yanıtı kısaysa "Daha uzun yanıt yaz, ders verme şansını artırır"; öğrenci e-postasını
doğrulamadan mesaj atamaz; sabit dolandırıcılık bandı ("kişisel bilgi, şifre, kart bilgisi
paylaşma; Preply asla istemez; bildir ve engelle"); mesajdaki linke tıklayınca ara ekran
"Preply'den ayrılmak üzeresin" (iletişimi içeride tut / şifre-ödeme paylaşma / şüpheliyi bildir;
"Şüpheli etkinlik bildir" / "Yine de devam et"); ekler virüs taramalı ("güvensiz link içerebilir").

**Arşiv / engelleme / şikâyet**: Tümü / Okunmadı / Arşivlendi. Eğitmen öğrenciyi engelleyebilir —
nedenler: platform dışı ödeme teklifi, taciz, dolandırma, ders vermek istemiyorum, ücrette
anlaşamadık, anlaşamadık, dersleri sık kaçırıyor, diğer; öğrenci "{öğretmen} seninle derslere
devam edemiyor" + bakiye aktar / başka öğretmen bul görür. Mesaj başına "Mesajı ihbar et".

**Bildirim tercihleri**: e-posta her zaman açık (önemli güncellemeler ve mesajlar) · dersler ·
ipuçları/indirimler (eğitmende ipuçları/tavsiyeler) · anketler; push ders hatırlatıcısı 15 dk /
1 sa / 14 sa / ders günü 08:00 (en az biri zorunlu), eğitmen takviminde 15 / 60 dk / 24 sa / yok;
push ayarı yalnız mobil uygulamada, web'de QR ile uygulama önerisi. Zil: sertifika, davet,
ders ekle, "çocuğun için doğru öğretmeni mi arıyorsun?", dersi onayla, sorun bildir.

**Grup dersleri**: eğitmen iptal/saat değişikliğini doğrudan yapamaz, talep gönderir (nedenler:
grup istedi, sağlık, teknik, diğer), ekip onaylar; değişiklik için derse en az **72 saat**.

**Yorum**: yıldız + metin zorunlu, "20–60 kelime" yönlendirmesi, **yayından önce moderasyon**
("kontrolümüzden geçtikten sonra profilde yayınlanacak"); yorumsuz eğitmene "Yeni katıldı"
rozeti; ödeme sayfasında puana göre ilk 10 yorum, 170 karakterden uzunlar kırpılır; abonelik
sayfasında yorumlar alaka puanı, persona, "önce/sonra" sonucu ve "destek doğruladı" alanlarıyla.

**Güvenlik**: eğitmen para çekmek için kimlik doğrulaması (Veriff; pasaport/kimlik); telefonla
2 adımlı doğrulama (SMS kodu, numara değişiminde eski numaraya da kod, deneme sınırı, "öğrencilerden
gizli kalır"). Çocuk hesabı/ebeveyn onayı akışı yok; yalnız "çocuğuma öğretmen" hedefi ve
ebeveyne özel planlama ipuçları.

**Öğrenci onboarding**: deneme kontrol listesi — dersi al · görüntü ve sesini test et (1 dk) ·
hedeflerini öğretmenle paylaş (2 dk) · seviye testi; planlama ipuçları persona bazlı (ebeveyn,
çalışan, sınava hazırlanan, taşınan, sohbet); ilk ipucu balonları (mesaj tepkisi, ders planı yeri,
ilerleme merkezi).

---

## 18. Bize uyarlama önerisi

**Faz 1 — mevcut veriyle**
1. Pano = yapılacaklar: acil şeritler, sıradaki ders kartı (15 dk kuralı), onay bekleyen
   istekler, 3 günlük yaklaşan dersler, eylem satırları (kapat/tamamlandı).
2. "Neden görünmüyorsun" bandı: taslak, askıda, onay bekliyor, müsaitlik boş, belge eksik.
3. Bakiyem sekmesi kalkar: bakiye başlıkta, döküm Analizler'de, IBAN Ayarlar'da.
4. Öğrencilerim: liste, sonraki ders, toplam ders, bu öğrenciden kazanç, arşiv, önerilen eylem.

**Faz 2 — yeni uçlar**
5. Analizler: trendli genel bakış + hedef işaretli başarı etkenleri + bozan dersler listesi.
6. Takvim (FullCalendar): ders türü renkleri, izin + öğrencilere haber, bildirim süresi ayarları,
   12 saat iptal kuralı, "bunun yerine ertele".
7. İlk ders sonrası "hemen mesaj at" ekranı + eğitmenin hazır mesaj şablonları + sonraki adımlar kartı.
8. Ders onayı: öğrenci onaylar/sorun bildirir; yüz yüze derste otomatik onay süresi ayrı.

**Faz 3 — yeni kayıt gerektirir**
9. Profil görüntülenme, huni, aramadaki sıra.
10. Yanıt oranı/süresi (kabul/red anı kaydı), cevapsız mesaj uyarısı.
11. Yoğun saatler ısı haritası (arama + rezervasyon saatleri).
12. Başarı/dönüm noktası kartları, profil puanı kriterleri.

**Öğrenci tarafı**
13. SEO iniş sayfaları: `/adana/{ders}-ozel-ders`, ilçe ve yüz yüze/online ayrımı, canlı sayılar
    (öğretmen sayısı, ortalama fiyat), gerçek yorumlar, SSS, iç bağlantılar, yapılandırılmış veri;
    filtreli sayfalar `noindex, follow`. Preply'ın Adana sayfası yalnız online — yerel içerik boşluğu.
14. Arama kartı: fotoğraf, doğrulama, fiyat, puan (yorumsuzsa "Yeni"), öğrenci/ders sayısı,
    başlık + kırpılmış açıklama, ders şekli ve ilçe, "Ücretsiz ilk ders ayırt" + mesaj + favori;
    popülerlik etiketi yalnız gerçek rezervasyon sayısından.
15. Rezervasyon: ders şekli (yüz yüze/online) → süre → saat (sabah/öğleden sonra/akşam grupları)
    → kayıt (seçim korunur) → özet. **İlk dersin ücretsiz olduğu, ödemenin ders onaylanana kadar
    emanette kaldığı ve ücretsiz iptal süresi** özet ekranında açıkça yazılsın.
16. Öğrenci ana sayfası: tek "sıradaki eylem" kartı + 3 kartlı "Sıradaki" listesi; boş hesapta
    öğretmen keşfet kartı.
17. İptal öncesi "bunun yerine ertele", nedene göre alternatif saat; öğretmen değişikliğinde
    öğrenciye "bunu sen mi istedin?".
18. Hedef formu (LGS/YKS/okul/dil, hedef tarih, tempo, uygun saatler) → öğretmenle paylaşım →
    öğretmenin aylık planı → öğrencide "plan iste".
20. Mesaj güvenliği: ilk ders tamamlanmadan telefon/e-posta/link paylaşımını sunucuda tespit
    et ve uyar; sabit dolandırıcılık bandı; dış link ara ekranı; eğitmenin gerekçeli öğrenci
    engellemesi; mesaj ihbarı.
21. Sohbet içi planlama: eğitmen hazır mesajla müsait saat widget'ı gönderir, öğrenci tek tıkla
    rezervasyon sayfasına gider.
22. Yorumlar: yayından önce moderasyon; herkese açık yorum ile anonim ders puanı ayrı; profilde
    alt puanlar (ör. anlatım, hazırlık, motivasyon, ilerleme).
23. Çocuk öğrenciler Adana'da çoğunluk olacağı için Preply'da olmayan veli hesabı / veli onayı
    ayrı bir fırsat.
24. Paket/abonelik düşünülürse: 4 haftalık paket, ders başı fiyat, dondurma, nedene göre iptal
    akışı, kalan bakiyeyi başka öğretmene aktarma.
