# Cıncık Teslimat 2.0 — Product Design Specification (v2)

**Doküman türü:** UX Design Document / Product Design Specification
**Kapsam:** Kendi-filo e-ticaret teslimat deneyiminin uçtan uca tasarımı — müşteri, kurye ve operasyon yüzeyleri
**Sürüm:** v2 — hakem revizyonu sonrası (değişiklikler §15 CHANGELOG'da)
**Statü:** Tasarım referansı (implementasyon sözleşmesi değil)
**Tarih:** Temmuz 2026

---

## 0. Vizyon ve Tasarım İlkeleri

### Vizyon

> **"Paketin nerede?" sorusunun hiç sorulmadığı teslimat deneyimi.**

E-ticarette müşteri kaygısının tek kaynağı belirsizliktir: *Ne zaman gelecek? Evde olmam gerekiyor mu? Kim getirecek? Gelmezse ne olacak?* Dünyanın en iyi teslimat deneyimi, bu soruların her birini **müşteri sormadan önce** cevaplayan deneyimdir.

### Beş Tasarım İlkesi

**İ1 — Belirsizliği öldür.** Her durumun bir cevabı, her gecikmenin bir açıklaması, her adımın bir zaman penceresi vardır. Sessiz gecikme yasaktır: sistem kötü haberi müşteri fark etmeden önce kendisi verir.

**İ2 — Kontrol müşteridedir.** Teslimat müşteriye *yapılan* değil, müşteriyle *birlikte yürütülen* bir işlemdir. Tercihler teslim anına kadar değiştirilebilir ve kuryeye anında yansır.

**İ3 — Kurye bir insandır, barkod değil.** Müşteri kuryesinin adını ve aracını görür; kurye müşterinin talimatını ve kapı tarifini görür. İki taraf birbirine hazırlıklı gelir. (Güven etkisi hipotezdir — bkz. §11/H7.)

**İ4 — Sessiz güven.** Bildirim koreografisi az sayıda kritik andan oluşur; gerisi çekilebilir (pull) bilgidir. Renk yalnız aksiyon ve istisna içindir; "her şey yolunda" hâli sakin ve nötrdür.

**İ5 — Yalnız tutulabilecek söz verilir.** *(v2'de yükseltildi — eski "her durum tasarlanmıştır" ilkesi bunun altına girer.)* Söz motoru kapasiteyi bilir: verilen her teslim günü ve pencere, o günün gerçek araç/durak kapasitesine dayanır. Tutulamayacak sözü hiç vermemek, tutulamayan sözü telafi etmekten her zaman ucuzdur. Ve her istisna durumu (loading, offline, edge case) tasarlanmıştır — teslimat, mutlu yolun değil istisnaların ürünüdür.

---

## 1. Benchmark Sentezi — Kimden Ne Alıyoruz, Neyi Reddediyoruz

Hiçbir platformu kopyalamıyoruz; her birinden **kanıtlanmış tek bir fikri** alıp tek bir sistemde birleştiriyoruz.

> **Yöntem notu (v2):** Bu tablo, 2026 ilk yarısında Türkiye tüketici akışlarının deneyimsel gözlemine dayanır; kontrollü bir gözlem protokolü yoktur. Tartışmalı hücreler revize edildi; tablo *ilham envanteri* olarak okunmalı, rekabet analizi olarak değil.

| Platform | Aldığımız fikir | Sınırı / bizde farklılaşan |
|---|---|---|
| **Amazon** | Son duraklarda açılan canlı durak sayacı; fotoğraflı teslim kanıtının müşteriye anında gösterimi; "bugün geliyor" günü bildirimi | Amazon ağırlıkla gün/pencere sözü verir ("bugün 22:00'a kadar") — zayıf yönü nokta ETA değil, takibin sipariş detayına gömülü olmasıdır |
| **Trendyol** | Sipariş kartında durumun net okunması; teslim sonrası değerlendirme akışı | Teslimat bildirimleri görece disiplinli; enflasyon kampanya kanalındadır — bizim dersimiz: iki kanalı asla karıştırma |
| **HepsiJET** | Saat aralığı sözü; kapıya/komşuya bırak; kurye kimlik kartı; token'lı public takip | Pencere verilir ama gün içinde daraltılmaz; tercih yönetimi yalnız SMS linkinde |
| **Hepsiburada** | Randevulu teslimat fikri; "yarın kapında" sözünün checkout'ta verilmesi | Söz kaçtığında proaktif iletişim yok |
| **Shop (Shopify)** | Tek "Yolda" ekranı: harita + timeline + her şey tek yerde | Agregatör: tasarımı gereği aksiyon sunamaz — biz sunarız, fark buradadır |
| **Getir** | Canlı haritada akıcı kurye hareketi; teslim anının hissedilir kapanışı | Dakika hassasiyeti şehir-içi kargoya ölçeklenmez — bizde pencere + daralma |
| **Yemeksepeti** | Durum şeridinin basitliği | Kurye iletişimi maskesiz çıplak numarayla |
| **Uber Eats** | Rota çizgisi + marker interpolasyonu; ETA'nın dürüst güncellenmesi | Sürücü değişkenliği deneyimi dalgalandırır |
| **DoorDash** | Kurye tarafında tek-kart "sıradaki durak" odağı; gün sonu özeti | Parça-başı ödeme modeli hız baskısı üretir — bizde bordrolu kurye + başarı metriği, hız metriği yok |
| **Deliveroo** | Sipariş aşamalarının tek bakışta okunması | Marka animasyonu yer yer erişilebilirliğin önüne geçer |

**Sentezin özü:** HepsiJET'in *sözü* + Amazon'un *durak sayacı* + Getir'in *canlılığı* + Shop'un *tek ekranı* + DoorDash'in *kurye odağı* — tek omurgada: **Kapasiteli Söz Motoru** (§2).

---

## 2. Omurga: Kapasiteli Söz Motoru

Sistemin tamamı tek kavram üzerine kurulur: **teslimat bir söz dizisidir; her söz bir öncekinden daha kesindir ve hiçbir söz kapasitesiz verilmez.**

### 2.1 Kapasite modeli

Söz, üç kısıtın kesişiminden üretilir:

```
söz_günü(sipariş) = min { d ≥ bugün :
    d çalışma günü                          (tatil/Pazar takvimi)
  ∧ cutoff kuralı sağlanır                  (bugün için: sipariş ≤ 16:00)
  ∧ planlanan_durak(d) < kapasite(d)        (KAPASİTE KISITI) }
```

- **Kapasite(d)** = araç sayısı × araç başına durak kapasitesi × doluluk tamponu (varsayılan 0,9). Araç başına durak kapasitesi başlangıçta operasyon ayarıdır (ör. 22 durak/araç/gün); veri biriktikçe gerçekleşen `durak/saat` ölçümünden türetilir.
- **planlanan_durak(d)**: o güne söz verilmiş, henüz sonuçlanmamış fiziksel siparişler + o güne ertelenen/başarısız yeniden denemeler. Yeniden denemeler kapasitede **önceliklidir** (söz borcu yeni satıştan önce gelir).
- Ödeme tamamlandığı anda sipariş o günün sayacına yazılır. Checkout rozeti her görüntülemede güncel kapasiteye bakar: gün dolduysa rozet **otomatik bir sonraki uygun güne düşer** — müşteri hiçbir zaman dolu bir güne söz almaz.
- Bölge kontrolü sözden öncedir: adres pini bölge dışındaysa söz motoru hiç çalışmaz, dış kargo bilgilendirmesi devreye girer.

*Neden merkez:* Kapasiteyi bilmeyen söz motoru, yoğun günde *tasarımı gereği* yalan söyler. Sözün güvenilirliği bir UX süsü değil, envanter problemi gibi yönetilen bir kaynaktır.

### 2.2 Kademeli daralan pencere

```
Sipariş anı          →  "Çarşamba kapında."                (gün sözü — kapasiteli)
Teslim günü sabahı   →  "Bugün 13:00–18:00 arası."         (blok pencere)
[V2] Kurye yola çıkınca →  "17:10–17:50 arası."            (dar pencere + canlı takip)
[V2] Son duraklara gelince → "Önünde 3 durak var."         (durak sayacı)
Kapıda               →  Teslim + fotoğraflı kanıt anında cebinde.
```

**Pencere matematiği veri kaynağına bağlıdır** (el sallama yok):

| Veri durumu | Verilebilecek en dar söz |
|---|---|
| Plan yok (sipariş anı) | Gün |
| Gün planı var, rota sırası elle (MVP) | Yarım-gün blok (09:00–13:00 / 13:00–18:00) |
| Rota motoru ETA'sı var (V2) | Nokta ETA ± tolerans, uçlar 15 dk'ya yuvarlı (ör. 40 dk pencere) |
| Canlı konum + kalan durak (V2) | Son 3 durakta ± 20 dk'ya kadar daralır |
| Rota motoru düşük/fallback modunda | Pencere otomatik genişler (± 60 dk) ve daha dar söz **verilmez** |

**Kurallar:**

1. **Pencere yalnız daralır, asla sessizce kaymaz.** Kayma gerekiyorsa müşteriye nedeniyle birlikte bildirilir: "Yoğunluk nedeniyle pencereni 17:40–18:20'ye aldık — kuryen hâlâ yolda."
2. **Nokta ETA müşteriye asla gösterilmez**; yalnız operasyon panelinde yaşar.
3. **Erken varış müşteri aleyhine sayılmaz** *(v2'de değişti)*: kurye pencereden önce varıp ulaşamazsa bu deneme müşterinin erteleme hakkından düşmez ve kurye FAILED metriğinde "erken deneme" olarak ayrışır. Kurye bekletilmez — rota bir müşteri için durmaz; kapıya-bırak tercihi varsa erken teslim sorunsuzdur.
4. **Söz kaçarsa** sistem otomatik özür bildirimi üretir ve vakayı operasyonun **telafi öneri kuyruğuna** yazar — telafinin kendisi (kupon, öncelik) insan onayıyla verilir, otomatik değil *(v2'de değişti: otomatik kupon suistimale açıktır)*.

---

## 3. Deneyim Tasarımı

### 3.1 Müşteri: Checkout ve bekleme

- **Pin otoritedir.** Adres seçimi harita pinlidir; pin bırakılınca ters-geocode adres metnini doldurur, müşteri "kapı tarifi" ekler ("zil bozuk — arayın", "kat 3, asansör yok"). Kapı tarifi adres kaydında kalıcıdır.
- **Söz rozeti** ürün/sepet/checkout'ta: "Bugün 16:00'ya kadar sipariş ver, **Çarşamba** kapında" + geri sayım. Rozet kapasiteye bakar (§2.1); cutoff geçince veya gün dolunca dürüstçe sonraki güne kayar.
- **Teslimat tercihi** checkout'ta ön seçim olarak alınır; son tercih bir sonraki siparişte hatırlanır. Değiştirilebilirliği açıkça yazar: "Fikrini teslim anına kadar değiştirebilirsin."
- **Bekleme dönemi sessizdir** (İ4): sipariş detayında timeline + söz kartı; bildirim yalnız teslim günü sabahı gelir. Adres/tercih değişikliği serbesttir (adres: bölge kontrolü, F6).
- **İptal:** kargoya çıkmamış sipariş tek akışla iptal edilir (M7 ekranı) — neden seçimi + iade bilgilendirmesi. *(v2'de eklendi: v1'in unuttuğu en sıradan akış.)*

### 3.2 Takip deneyimi: "Yolda" ekranı, harita ve sayaç

*(v1'in üç ayrı bölümü — takip, harita, durak sayacı — tek deneyim oldukları için birleştirildi.)*

**Tek URL, tek ekran; durum ne olursa olsun aynı yer.** Ekran duruma göre şekil değiştirir: kurye yola çıkmadıysa söz kartı büyüktür; yola çıktıysa (V2) canlı bölüm devralır; teslimden sonra kanıt kartı ekranı devralır.

- **Timeline:** dikey; tamamlanan adımlar dolu nokta + saat; gelecek adımlar soluk ve tarih tahminli ("Çarşamba bekleniyor"). Kötü olaylar (teslim edilemedi) silinmez, amber işaretle çizelgede kalır — geçmişi silmek güveni siler. Meraklısı için katlanır "tüm hareketler" bölümü (varsayılan kapalı).
- **Canlı harita (V2):** yalnız kurye **son ~8 durağa girince** görünür *(v2'de değişti: tur başından itibaren açık harita, saatlerce obsesif izleme ve "kurye neden ters yöne gidiyor" destek talebi davet eder)*. İçerik: ev pini, kurye aracı, gerçek yol geometrisi varsa rota çizgisi (yoksa çizgi çizilmez — kuş uçuşu çizgi ETA ile çelişir, yalan söyler). Marker konumlar arası interpolasyonla kayar; son sinyal yaşı görünür; sinyal 90 sn'yi aşarsa marker soluklaşır + dürüst mesaj ("muhtemelen kapalı alanda, teslimatlar devam ediyor"). Kalıcı iz tutulmaz.
- **Durak sayacı (V2):** "önünde **3** durak var" — yalnız **N ≤ 8** iken gösterilir. **Sayı artabilir** (kurye bir durağı sona attı, aynı turda geri dönüş): bu durumda sayaç sessizce büyümez, "teslimat sırası güncellendi" mikro-metni eşlik eder *(v2'de eklendi — sayacı artıran senaryolar sistemin kendi özellikleridir ve tasarlanmamışsa güveni tek hamlede bozar)*.
- **Public takip** (`/takip/:token`): oturumsuz; alıcı adı maskeli, adres gizli, kanıt fotoğrafı yok. Aksiyonlar: izleme + erteleme + "beni ara". **Kapıya-bırak public token'la değiştirilemez** — SMS linkini ele geçiren biri paketi kapıya yönlendirememeli; teslim şekli değişikliği oturum veya OTP ister *(v2'de daraltıldı)*. Token teslimle pasifleşir.

### 3.3 Teslimat tercihleri, güvenlik doğrulaması ve kanıt

*(v1'in üç bölümü birleştirildi — tercih, kanıt seviyesini belirler; ikisi tek karardır.)*

**Tercihler:**

| Tercih | Faz | Kanıt |
|---|---|---|
| Adresteyim (elden) | MVP | SMS OTP (hash'li, süreli, deneme limitli) |
| Kapıya bırak | MVP | Konum damgalı **foto zorunlu** |
| Komşuya ver (isim/daire zorunlu) | V2 | Foto + komşu adı/dairesi kanıt kaydına ve müşteri bildirimine geçer |
| Beni ara | V2 | Kurye araması + OTP |

- Tercih siparişte yaşar, teslim anına kadar değiştirilebilir, kurye kartına amber talimat bandı olarak düşer. "Ertele" ve "adres değiştir" tercih değil **aksiyondur** (ayrı akış, ayrı kural).
- **Yüksek değerli sipariş** (eşik operasyon ayarı): kapıya/komşuya bırak **kapatılır**, elden+OTP zorunlu olur. *(v2'de sadeleşti: v1'in "L3 kimlik beyanı" basamağı, ortalama sepeti kitap olan bir platformda yılda birkaç kez tetiklenecek bir tören üretiyordu.)*
- **İki katmanlı doğrulama:** kurye her durakta önce **paket QR'ını** okutur ("doğru paket mi?"), sonra alıcı doğrulaması yapılır ("doğru kişi mi?"). Yanlış paket yanlış kapıya fiziksel olarak gidemez.
- **Kanıt müşterinin hakkıdır:** teslim bildiriminin içinde foto, saat, teslim alan (maskeli), konum teyidi ("adresinin 8 m yakınında") vardır ve sipariş detayında kalıcıdır. Public takipte kanıt fotoğrafı gösterilmez (kapı önü fotoğrafı PII'dır).
- Kurye kamera ekranında **statik çerçeve kılavuzu + tek satır ipucu** ("paketi kapı numarasıyla birlikte çek"); karanlıkta otomatik flaş. *(v2'de sadeleşti: v1'in bulanıklık tespiti/yeniden-çekim analizi, değerinin çok üstünde mühendislikti.)*
- **OTP güvenlik cümlesi** her OTP SMS'inde: "Bu kodu yalnız kapındaki kuryeye söyle — kuryemiz seni arayıp kod istemez."

### 3.4 Başarısız teslimat ve erteleme

**Kurye kapıda, müşteri yok (F4):**

1. Kurye "ulaşamıyorum" akışını başlatır → müşteriye anında push/SMS: "Kuryen kapında!"
2. Kurye müşteriyi arar (maskeli numaradan; müşteri bu numarayı onboarding'de "kuryem" olarak kaydetmeye teşvik edilir — bilinmeyen numara çağında aranmadan önce bildirim + kayıtlı numara, aramanın açılma şansıdır).
3. Müşteri telefonda "kapıya bırakın" derse: **sözlü onay tek başına yeterli değildir** *(v2'de değişti — sözlü onayın kaydını suçlanacak taraf tutamaz)*. İki mekanizmadan biri şarttır:
   - **OTP devri:** müşteri, cebindeki teslim OTP'sini telefonda kuryeye okur (kod sahipliği = kimlik + niyet kanıtı) → kurye kodu girer, "telefonla kapıya çevrildi" işaretlenir → foto kanıtla teslim.
   - **Onay linki:** OTP yoksa/okuyamıyorsa müşteriye anlık push/SMS onay linki gider; 90 sn içinde müşteri kendi cihazından onaylar.
   - İkisi de gerçekleşmezse teslim **yapılmaz**.
4. Ulaşılamadıysa: 2 dk sayaç → kapı önü foto ("geldik" kanıtı) + neden seçimi → durak FAILED → müşteriye dürüst bildirim: "Bugün ulaşamadık — yarın yeniden geleceğiz. Uygun değilsen ertele →". **Aynı gün geri dönüş yoktur** *(v2'de netleşti: rota bütünlüğü tek müşteriden önce gelir)*; yeniden deneme ertesi günün kapasitesinde önceliklidir.
5. 2. başarısızlıkta operasyon müşteriyi arar; 3.'de "şubeden al / iade" istisna akışı.

**Adres bulunamadı:** kurye "adres sorunu" işaretler → müşteriye pin-doğrulama linki → operasyon istisna kuyruğunda görür. Pin düzeltilirse durak listede sona itilir ve aynı turda yeniden denenebilir (durak sona itme bir liste işlemidir; rota motoru yeniden koşmaz, ETA'lar yeniden hesaplanır).

**Erteleme (müşteri isteğiyle):** self-servis, limit 2; RESCHEDULED kurye metriğine yazılmaz (FAILED'dan ayrı). Limit dolunca "bizi ara / şubeden al" yolu. Erteleme MVP'dedir: tek uçlu ucuz bir özelliktir ve FAILED'ın en ucuz önleyicisidir.

### 3.5 Teslim sonrası

1. **Teslim anı:** push + "Yolda" ekranı kanıt kartına dönüşür — sakin onay işareti, foto, saat, teslim alan. Konfeti yok (İ4).
2. **Teslimat puanı (V2):** 👍/👎 + etiket çipleri (zamanında / kibardı / paket sağlam / geç kaldı / hasarlı). "Kibardı" etiketi kuryenin gün sonu özetine olumlu geri bildirim olarak düşer — *(v2'de birleşti: v1'in ayrı "kuryene teşekkür et" butonu bu etiketle aynı işi yapıyordu.)* 👎 operasyonun günlük geri bildirim kuyruğuna düşer (istisna kuyruğuna değil — istisna kuyruğu acil operasyon işleri içindir).
3. **"Bir sorun var" (V2):** 24 saat penceresi; hasarlı (foto) / eksik / yanlış ürün / teslim edilmedi iddiası → her biri hazır çözüm yoluna bağlanır. Serbest metin form son çaredir.
4. Ürün değerlendirme daveti **mağaza bildirim kanalından** gider, teslimat kanalından değil *(v2'de taşındı: teslimat kanalı yalnız teslimat konuşur — v1 kendi kuralını çiğniyordu)*.

*(v1'in "Teslimatlarım" lojistik arşiv ekranı kaldırıldı: kanıtlar sipariş detayında zaten kalıcı; "bu adrese 6 teslimat" bilgisi müşteri yüzeyi değil, akıllı-varsayılan girdisidir.)*

### 3.6 Kurye deneyimi

Kurye uygulaması bir akış aracıdır: her bakış 3 saniyeden kısa sürmelidir.

- **Tek elle, eldivenle:** birincil hedefler ≥56 px, ekranın alt yarısında. Teslim onayı **swipe-to-complete** (buton değil — yanlış dokunma koruması fizikseldir).
- **Tek kart odağı:** "Şimdi ne yapacağım?" — sıradaki durak kartı: alıcı, adres + kapı tarifi, paket sayısı, tercih (amber bant), navigasyon. Diğer duraklar kaydırma altında, asla eşit ağırlıkta değil.
- **Navigasyon devri:** uygulama içi adım-adım navigasyon yazılmaz; deep-link (Google Maps/Yandex). Dönüşte state kaybolmaz.
- **Offline-first:** kanıt, foto, durum değişikliği önce cihaza yazılır; bağlantı gelince sırayla senkronlanır. Teslim saati = işlem anı (senkron anı değil — dürüst damga). Tepe şeridi: "Çevrimdışısın — işlemlerin kaydediliyor."
- **"Sona at":** kurye bir durağı listede sona itebilir (B2 — müşteri "15 dk sonra evdeyim" dedi). Liste işlemi + ETA yeniden hesabı; rota motoru koşmaz.
- **Saha güvenliği** *(v2'de eklendi)*: durak kartında güvenlik notu alanı (agresif köpek, tekinsiz giriş — kurye işler, kalıcıdır); kurye tehdit hissederse "güvenli değil" ile durağı sonlandırır → FAILED (özel neden koduyla, kurye metriğine yazılmaz), operasyon vakası.
- **Gün başı / gün sonu:** başta tur özeti (durak, ~süre, km); sonda teslim/başarısız/ertelenen + söz tutma. **Hız metriği gösterilmez** — hız baskısı güvenlik düşmanıdır.
- **Sesli + haptik sonuç:** QR başarı (kısa titreşim), hata (uzun) — kurye ekrana bakmadan bilir.

### 3.7 Operasyon paneli ve depo

İlke: **"her şey yolunda"yı gösterme, istisnayı göster** (exception-first).

- **Hazırlama istasyonu** *(v2'de eklendi — v1 "PAID → pakete hazır" arasını atlamıştı)*: ödenen fiziksel siparişler toplama listesine düşer; paket hazırlanır, **etiket (QR) basılır**, "hazır" işaretlenir. Yalnız "hazır" siparişler tura eklenebilir. Bu ekran depo görevlisinin tek yüzeyidir.
- **Dispatch Board:** sol gün kuyruğu (söze göre sıralı; yeniden denemeler işaretli ve öncelikli), sağ harita. MVP'de sıralama elle (sürükle); V2'de "Günü Optimize Et" tek butonu (rota motoru sıralar, ETA üretir, sapma eşiğini aşan "rotayı bozan" durakları işaretler). Üstte sağlık şeridi: `2 araç · 34/41 durak · 1 istisna · söz riski: 0 · kapasite yarın: 7/22`.
- **İstisna kuyruğu:** panelin kalbi — başarısız teslim, söz riski (ETA pencereyi taşıyor), sinyal kesik (>10 dk), OTP ulaşmıyor, adres sorunu, saha güvenliği. Her satırda tek-dokunuş aksiyon. Müşteri memnuniyeti (👎) ayrı günlük kuyrukta.
- **Kurye sağlığı:** son sinyal yaşı, batarya, uzun hareketsizlik. Amaç gözetim değil operasyonun kör kalmaması; kalıcı iz yok.
- **Telafi öneri kuyruğu:** söz kaçan siparişler buraya düşer; operasyon önerilen telafiyi onaylar/değiştirir/reddeder.
- **Raporlar:** KPI seti §14'ten beslenir. *(v1'in "rapor satırları karar önerisiyle biter" fikri kaldırıldı: veri olgunluğu olmadan öneri üreten rapor yanlış öneri üretir.)*

### 3.8 Bildirim sistemi

**Koreografi + kanal ekonomisi** *(v2'de eklendi: SMS'in birim maliyeti vardır ve düşük marjlı üründe modellenmeden koreografi onaylanmaz)*.

| # | An | Faz | Push | SMS |
|---|---|---|---|---|
| 1 | Ödeme onayı + gün sözü | MVP | ✓ (+e-posta makbuz) | — |
| 2 | Teslim günü sabahı + blok pencere | MVP | ✓ | — |
| 3 | Kurye yola çıktı + pencere + takip linki | MVP | ✓ | ✓ (SMS #1) |
| 4 | Yaklaşıyor (≤2 durak, V2) | V2 | ✓ | — |
| 5 | Teslim + kanıt | MVP | ✓ | Yalnız kapıya-bırakta ✓ (paket dışarıda — güvenlik) |
| — | İstisnalar (teslim edilemedi, pencere kaydı, ertelendi) | MVP | ✓ | ✓ (aksiyon gerektirir) |

- **Kanal fallback:** push kanalı olmayan müşteride 2 ve 4 SMS'e düşer; sipariş başına SMS tavanı 3. Ortalama hedef ≤2 SMS/sipariş — §14'te unit-economics metriğidir.
- **Sessiz saat: 21:00–08:30** *(v2'de düzeltildi: v1'de sessiz saat 09:00'da biterken "bugün geliyor" bildirimi 08:30'da gidiyordu — kendi kuralını çiğneyen koreografi)*. Teslim-günü bildirimleri 08:30'dan önce asla gönderilmez.
- Bildirim ayarı hesap ayarlarında **tek satırdır**: "Yalnız kritik bildirimler" toggle'ı (3 ve teslim + istisnalar kalır). *(v1'in an × kanal matris sayfası, 5 bildirim gönderen bir sistem için ayar enflasyonuydu.)*
- Her bildirim derin bağlantıyla ilgili ekrana iner. Pazarlama bu kanala **asla** karışmaz.

### 3.9 İade

*(v2'de yeniden fazlandı: kitap kategorisinde iade hacmi düşüktür; kapıdan toplama altyapısını V2'de kurmak, maliyetin değeri aştığı yerdi.)*

- **V2 — Kargo ile ücretsiz iade:** müşteri sipariş detayından başlatır (neden + hasarsa foto) → iade kodu → anlaşmalı kargoya bırakır → `ReturnTimeline`: alındı → depoda → kontrol → onay → **"₺X kartına iade edildi"** (en kritik satır para satırıdır; banka süresi dürüstçe yazılır: "bankana göre 1–5 iş günü"). Red durumunda foto + gerekçe + itiraz yolu.
- **V3 — Kapıdan toplama:** iade, dağıtım turuna pickup durağı olarak eklenir; kurye iade QR'ını okutur → "iaden kuryede". Aynı üründe **kapıdan değişim**: kurye yenisini bırakıp eskisini aynı durakta alır.

### 3.10 Çoklu paket

- **Sipariş ≠ paket.** Her paketin kendi QR'ı vardır; müşteri **sipariş seviyesinde tek deneyim** görür: birleşik timeline, olaylar paket rozetiyle ("Paket 1/2 teslim edildi").
- Aynı tura düşen paketler tek durakta birleşir; **tüm QR'lar okutulmadan teslim kapanmaz** — eksik paket teslimi teknik olarak imkânsızdır. Eksik paket varsa kısmi teslim + otomatik yeni söz + özür.
- **Sipariş birleştirme (V2):** aynı müşterinin aynı güne sözlü iki siparişi tek durakta birleştirilir — maliyet/durak metriğinin en ucuz iyileştirmesi. *(v2'de eklendi.)*
- Hibrit sepette dijital kalem anında teslim edilir ve timeline'da kendi satırını alır; fiziksel akışı bloklamaz.

### 3.11 KVKK ve veri saklama *(v2'de eklendi)*

| Veri | Politika |
|---|---|
| Kurye canlı konumu | Yalnız SON konum, TTL'li; kalıcı iz tutulmaz; tur bitince silinir |
| Teslim kanıtı fotoğrafı | Sipariş sahibine kalıcı görünür; sistemde saklama süresi: teslimden 12 ay (ihtilaf zamanaşımı penceresi), sonra otomatik silinir |
| Fotoğrafta üçüncü kişiler | Çekim kılavuzu insan yüzü çerçevelemez ("paketi ve kapıyı çek"); komşu teslimde paket + kapı çekilir, kişi değil |
| Public takip | Alıcı maskeli, adres yok, kanıt yok; token teslimle pasifleşir |
| Telefon/OTP kayıtları | OTP hash'li; arama içerikleri kayıt edilmez, yalnız arama olayı (zaman damgası) loglanır |
| Müşteri iletişim tercihi | Teslimat bildirimleri hizmet gereği; pazarlama izni ayrı ve bağımsızdır |

---

## 4. Uçtan Uca Yolculuklar

*(v2'de ikiye ayrıldı: v1 tek yolculukta MVP ile V2 özelliklerini harmanlıyor, okuyana MVP'nin o deneyimi vereceği izlenimini satıyordu.)*

### 4.1 MVP yolculuğu — lansman günü gerçeği

| Zaman | 👤 Müşteri | 🚚 Kurye | 🖥️ Operasyon |
|---|---|---|---|
| Salı 14:32 | Checkout: pin + kapı tarifi + "kapıya bırak"; rozet: "Çarşamba kapında" (kapasite: 14/20) | — | Sipariş Çarşamba sayacına yazılır; hazırlama listesine düşer |
| Salı 15:10 | — | — | Depo: paket hazır, etiket basıldı |
| Salı 16:00 | — | — | Cutoff: Çarşamba kuyruğu donar |
| Çrş 08:35 | Bildirim: "Bugün geliyor: 13:00–18:00 arası" | Gün başı: 18 durak, elle sıralı | Kuyruk gözden geçirildi, tur kuruldu |
| Çrş 13:05 | Bildirim + SMS: "Kuryen yola çıktı — takip et →" | Tur başladı; sıradaki kart | Tur ACTIVE; istisna kuyruğu boş |
| Çrş 16:48 | — | Kapıda: paket QR → foto (kapı no ile) → swipe | Durak DELIVERED (14/18) |
| Çrş 16:48 | Bildirim + SMS: "Teslim edildi — kapı fotoğrafı ekte" | Sonraki kart | — |
| Çrş 18:30 | — | Gün sonu: 18/18 | Gün raporu; telafi kuyruğu boş |

MVP'de müşteri canlı harita ve durak sayacı **görmez**; blok pencere + 3 bildirim + fotoğraflı kanıt görür. Bu deneyim hâlâ Türkiye kargo ortalamasının üstündedir ve verdiği her sözü tutabilir.

### 4.2 V2 hedef yolculuğu — farklar

MVP yolculuğunun üstüne binen anlar: sabah bildirimi blok yerine **dar pencere** taşır ("14:00–18:00" → rota ETA'sından "16:30–17:10"); kurye son 8 durağa girince müşteride **canlı harita + sayaç** açılır; ≤2 durakta **"yaklaşıyor"** bildirimi; teslim sonrası **👍/👎 + sorun-var** akışı; kurye kartında **kimlik** (foto/araç/plaka). Geri kalan omurga aynıdır — V2, MVP'nin verdiği sözü daraltır, değiştirmez.

---

## 5. Kullanıcı Akışları (User Flows)

Gösterim: `→` adım, `◇` karar, `↪` dallanma, `⚑` bildirim.

**F0 — Söz üretimi (checkout rozeti)** *(v2'de eklendi)*
```
Rozet görüntülenir → bölge? ↪ dışı → dış kargo bilgilendirmesi (söz yok)
→ ◇ bugün cutoff öncesi VE yarının kapasitesi açık mı?
   ↪ evet → "Çarşamba kapında" + geri sayım
   ↪ hayır (cutoff geçti YA DA gün dolu) → sonraki uygun gün gösterilir
→ ödeme tamamlanır → gün sayacı +1 → söz siparişe mühürlenir
```

**F1 — Mutlu yol (MVP)**
```
Sepet → adres/pin → tercih ön-seçimi → ödeme → ⚑ onay+söz
→ [gün sabahı 08:35+] ⚑ blok pencere → tur başlar → ⚑+SMS "yolda"
→ kapıda: paket QR → kanıt (OTP | foto) → swipe → ⚑ "teslim edildi + kanıt"
```

**F2 — Tercih değiştirme (teslim günü)**
```
Yolda ekranı → çip "Kapıya bırak" → sheet onay
→ ◇ kurye bu durağa ≤2 durak mı? (V2 — canlı sıra verisi varsa)
   ↪ hayır → güncellenir; kurye kartına amber bant; sessiz toast
   ↪ evet → "kuryen çok yakın — iletiyoruz" + kurye ekranında zorunlu-onay banner'ı
NOT: public token'dan kapıya-bırak yapılamaz (oturum/OTP ister)
```

**F3 — Erteleme (MVP)**
```
Sipariş/Yolda → "Ertele" → ◇ hak? (limit 2)
   ↪ var → gün seç → RESCHEDULED → ⚑ "isteğinle Perşembe'ye alındı"
           → ertesi gün kapasitesinde öncelikli
   ↪ yok → "bizi ara / şubeden al"
```

**F4 — Başarısız teslim (MVP, revize mekanizma)**
```
Kurye kapıda → yanıt yok → "ulaşamıyorum" → ⚑ "kuryen kapında!" → maskeli arama
→ ◇ telefonda cevap?
   ↪ "kapıya bırakın" → ◇ doğrulama:
        OTP'yi telefonda okudu → kod girildi → foto → teslim ✓
        okuyamadı → 90 sn onay linki → ◇ onayladı? ↪ evet → foto → teslim ✓
        hiçbiri → teslim YAPILMAZ → aşağıya düşer
   ↪ cevapsız → 2 dk sayaç → kapı önü foto + neden → FAILED
        → ⚑ "bugün ulaşamadık — yarın geliyoruz. Ertele →"
        → yarının kapasitesinde öncelikli → ◇ 3. kez? → operasyon arar
```

**F5 — İade (V2: kargo / V3: kapıdan)**
```
Sipariş detay → "İade et" → neden (+foto) → iade kodu
→ [V2] kargoya bırak | [V3] yarının turuna pickup durağı
→ depoda kontrol → ◇ onay? ↪ evet → ⚑ "₺X kartına iade — bankana göre 1–5 iş günü"
                            ↪ hayır → foto + gerekçe + itiraz yolu
```

**F6 — Adres değişikliği**
```
Sipariş detay (oturumlu; dağıtıma çıkmadıysa) → adres seç / yeni pin
→ ◇ bölge içinde mi?
   ↪ evet → güncellenir → söz yeniden hesaplanır → ◇ gün değişti mi?
            ↪ evet → ⚑ dürüst bildirim ("yeni adresinle söz Perşembe oldu")
   ↪ hayır → "bölge dışı" → eski adreste kal / iptal   (dış kargo: ayrı yol haritası)
```

**F7 — Kurye günü (MVP)**
```
Giriş → gün başı → yükleme (etiket QR toplu okutma; eksik varsa tur başlamaz)
→ [her durak] kart → deep-link navigasyon → varış → paket QR
   → tercih akışı (OTP | foto) → swipe | F4 | "sona at" (1 kez) | güvenli-değil
→ son durak → tur bitir → gün sonu özeti
```

**F8 — Operasyon günü (MVP)**
```
Sabah: hazırlama istasyonu (paket+etiket) → dispatch: kuyruk → elle sırala →
etiket kontrol → turu başlat → [gün boyu] yalnız istisna kuyruğu →
akşam: gün raporu → telafi öneri kuyruğu onayı → yarın kapasite ön-izleme
(V2: "elle sırala" yerine "Günü Optimize Et")
```

---

## 6. Bilgi Mimarisi

### 6.1 Müşteri

```
Mağaza
├── Ürün / Sepet / Checkout ─ söz rozeti (kapasiteli) + adres pin + tercih
└── Hesabım
    ├── Siparişlerim → Sipariş detayı
    │   ├── "Yolda" bloğu (adaptif; V2: canlı harita+sayaç)
    │   ├── Timeline (+ katlanır tüm hareketler)
    │   ├── Aksiyon çipleri (tercih / ertele / adres / tarif)  + İptal
    │   ├── Paketler (rozetli) · Teslim kanıtı (kalıcı) · İade başlat/takip
    ├── Adreslerim (pin + kapı tarifi)
    └── Ayarlar ─ "Yalnız kritik bildirimler" satırı
[Oturumsuz] /takip/:token ─ maskeli izleme + erteleme (+beni-ara V2)
```

### 6.2 Kurye

```
Kurye
├── Gün başı (tur özeti + yükleme QR)
├── Aktif tur ─ Sıradaki durak (TEK KART) · durak listesi (ikincil)
│   └── Durak akışı: QR → kanıt → sonuç (teslim | F4 | sona at | güvenli değil)
└── Gün sonu özeti
```

### 6.3 Operasyon

```
Dağıtım
├── Hazırlama istasyonu (PAID → paket + etiket → hazır)
├── Dispatch Board (kuyruk ⇄ harita; MVP elle sıralama, V2 optimize)
├── İstisna kuyruğu (varsayılan uyanış ekranı)
├── Turlar (canlı/geçmiş) · Siparişler (iç görünüm: tam geçmiş + kanıt)
├── İadeler (V2) · Kuryeler & araçlar · Telafi öneri kuyruğu
└── Raporlar & Ayarlar (kapasite/araç, cutoff, bölge, pencere toleransı,
    değer eşiği, erteleme limiti, sessiz saat, SMS tavanı)
```

---

## 7. Design System — Bileşen Kütüphanesi (16)

*(v1'deki 23 bileşen 16'ya indirildi; birleştirmeler bileşen satırlarında.)*

### 7.1 Token'lar

| Grup | Değerler | Not |
|---|---|---|
| Durum renkleri | `--dlv-ok` · `--dlv-active` · `--dlv-warn` · `--dlv-fail` · `--dlv-muted` | Renk tek taşıyıcı değil: her durumda ikon + metin (a11y) |
| Hareket | `--motion-fast: 150ms` · `--motion-base: 250ms` · `--motion-slow: 600ms`; easing `cubic-bezier(0.2,0,0,1)` | `prefers-reduced-motion`: tümü 0 ms |
| Dokunma | müşteri ≥44 px · kurye ≥56 px | Eldiven toleransı |
| Yükseklik | kart = saç-teli çizgi; yalnız sheet/harita-üstü kart gölgeli | Kart enflasyonu yok |

### 7.2 Bileşenler

| # | Bileşen | İş | Not / birleştirme |
|---|---|---|---|
| 1 | `StatusPill` | Durum: ikon + metin + renk | Paket rozeti ("1/2") bunun varyantıdır *(v1 `PackageBadge` birleşti)* |
| 2 | `PromiseDisplay` | Sözün TÜM seviyeleri: gün rozeti / blok pencere / dar pencere / "kaydırıldı" (nedenli) | *(v1 `PromiseBadge` + `EtaWindowCard` birleşti — söz tek omurgadır, iki bileşen olamaz)* |
| 3 | `DeliveryTimeline` | Dikey çizelge: done / active / future(tahminli) / exception(amber, silinmez) | İade timeline'ı varyanttır *(v1 `ReturnTimeline` birleşti)* |
| 4 | `LiveMapCanvas` (V2) | Ev pini + kurye marker + rota; sayaç satırı ("önünde 3 durak" + "sıra güncellendi") gömülü | *(v1 `StopsAheadTicker` içine alındı)* |
| 5 | `CourierIdentityCard` (V2) | Foto, ad, araç/plaka | kompakt / geniş |
| 6 | `ActionChipRow` | Tercih/ertele/adres/tarif çipleri | kilitli hâl (kurye yakın) + nedenli disabled |
| 7 | `PrefBottomSheet` | Tercih onayı | KOMSUYA (V2): isim/daire zorunlu |
| 8 | `OtpInput` | Kod girişi (kurye) | `one-time-code`; deneme limiti hâli |
| 9 | `ProofCard` | Kanıt: foto + saat + alan + konum teyidi | fotolu / OTP'li / komşu (V2) / yönetici teslimi |
| 10 | `AddressPinEditor` | Pin + ters-geocode + kapı tarifi | pin-doğrulama modu (F4 adres sorunu) |
| 11 | `DriverStopCard` | Kuryenin tek-kart odağı | amber talimat bandı / güvenlik notu / 2 dk sayaç / pickup (V3) |
| 12 | `SwipeToComplete` | Teslim onay kaydırıcısı | idle / tamam (haptik) / offline-kuyruklandı |
| 13 | `ExceptionRow` | Operasyon istisna satırı + tek-dokunuş aksiyon | 7 tip (saha güvenliği dahil) |
| 14 | `RouteBoard` | Kuyruk ⇄ harita split | MVP elle-sıralama / V2 optimize diff'i + söz-riski |
| 15 | `ThumbRating` (V2) | 👍/👎 + etiketler | 👎 → sorun akışına köprü; olumlu etiket → kurye özetine |
| 16 | `SystemState` | Boş / hata / offline kalıpları tek ailede | *(v1 `EmptyState`+`ErrorState`+`OfflineBanner` birleşti)*; offline varyantı senkron sayaçlı |

*(v1 `ProofCameraGuide` bileşen olmaktan çıktı: K4 akışında statik çerçeve + ipucu satırıdır.)*

---

## 8. Figma Ekran Envanteri (28)

Müşteri 13 · Kurye 7 · Operasyon 8. Durumlar için **global kalıplar** (ekranlar yalnız farkını belirtir): **L**oading = skeleton, layout kaymaz · **E**mpty = `SystemState` (ikon + tek cümle + tek aksiyon) · **Er**ror = satır-içi + tekrar dene; sayfa-kırıcıda `SystemState` · **S**uccess = varsayılan · **O**ffline = `SystemState` offline şeridi + son veri soluk ("son güncelleme 14:32").

### 8.1 Müşteri (13)

| # | Ekran | Faz | Ana bileşenler | Duruma özgü |
|---|---|---|---|---|
| M1 | Ürün — teslimat bloğu | MVP | `PromiseDisplay` | Er: rozet gizlenir (yanlış söz > söz yok); kapasite dolu: sonraki gün |
| M2 | Checkout — adres | MVP | `AddressPinEditor` | Er: geocode düşerse elle adres + pin zorunlu |
| M3 | Checkout — teslimat | MVP | tercih seçimi, `PromiseDisplay` | bölge-dışı: dış kargo bilgilendirmesi |
| M4 | Sipariş onayı | MVP | `PromiseDisplay`(büyük), `DeliveryTimeline`(ilk adım) | sonraki adım anlatılır |
| M5 | Siparişlerim | MVP | `StatusPill` + söz satırı | E: "henüz siparişin yok" |
| M6 | Sipariş detayı | MVP | `DeliveryTimeline`, `ActionChipRow`, `ProofCard` | adaptif blok sırası |
| M7 | İptal akışı (sheet) | MVP | neden seçimi + iade bilgilendirmesi | *(v2'de eklendi)* kargoya çıktıysa: neden iptal edilemediği + ertele önerisi |
| M8 | "Yolda" canlı takip | V2 | `LiveMapCanvas`, `PromiseDisplay`, `CourierIdentityCard`, `ActionChipRow` | O: harita yerine metin eşdeğeri; sinyal-bayat hâli ayrı |
| M9 | Tercih sheet | MVP | `PrefBottomSheet` | kilitli hâl (kurye yakın, V2) |
| M10 | Erteleme sheet | MVP | gün seçici + hak sayacı | hak bitti: istisna yolu |
| M11 | Teslim kanıtı / kapanış | MVP (👍/👎 V2) | `ProofCard`, `ThumbRating` | "bir sorun var" girişi (V2) |
| M12 | İade başlat + takip | V2 | neden+foto, iade kodu, `DeliveryTimeline`(iade varyantı) | para satırı her durumda görünür |
| M13 | Public takip `/takip/:token` | MVP | M6/M8'in kısıtlısı — maskeli, kanıtsız | Er: token geçersiz → nazik açıklama + giriş |

*(v1 M12 "bildirim tercihleri" ekranı kaldırıldı → hesap ayarlarında tek toggle satırı.)*

### 8.2 Kurye (7)

| # | Ekran | Faz | Ana bileşenler | Duruma özgü |
|---|---|---|---|---|
| K1 | Gün başı + yükleme | MVP | tur özeti, etiket QR okuyucu | eksik paket: tur başlamaz |
| K2 | Sıradaki durak | MVP | `DriverStopCard`, deep-link | O: tam çalışır, işlemler kuyruklanır |
| K3 | Durak listesi | MVP | sıra no + `StatusPill` mini | "sona at" buradan; tamamlananlar soluk |
| K4 | Teslim akışı | MVP | QR, `OtpInput`, statik çerçeve kılavuzu, `SwipeToComplete` | Er: yanlış paket → kırmızı tam-ekran + doğru durak |
| K5 | Başarısız teslim | MVP | 2 dk sayaç, maskeli arama, OTP-devri/onay-linki, neden+foto | "güvenli değil" çıkışı buradan |
| K6 | İade pickup | V3 | iade QR okuyucu | Er: eşleşmedi → operasyona işaretle |
| K7 | Gün sonu özeti | MVP | teslim/başarısız/ertelenen + söz tutma | hız metriği YOK |

*(v1 K7 "tam ekran rota haritası" ve K9 "geçmiş turlarım" kaldırıldı: navigasyon deep-link'te, genel bakış durak listesinde; performans arşivi saha aracı değil.)*

### 8.3 Operasyon (8)

| # | Ekran | Faz | Ana bileşenler | Duruma özgü |
|---|---|---|---|---|
| O1 | Hazırlama istasyonu | MVP | toplama listesi, etiket yazdırma, "hazır" işareti | *(v2'de eklendi)* yazıcı hatası: yeniden bas + elle no |
| O2 | Dispatch Board | MVP (optimize V2) | `RouteBoard`, sağlık şeridi, kapasite göstergesi | L(optimize): ilerleme+iptal; Er(motor düştü): fallback "yaklaşık" rozeti |
| O3 | İstisna kuyruğu | MVP | `ExceptionRow` ×7 | E: tek sakin satır "her şey yolunda" |
| O4 | Tur detayı (canlı) | MVP (canlı konum V2) | durak listesi + harita + zaman çizgisi | sinyal-bayat uyarısı |
| O5 | Sipariş/durak detayı | MVP | tam iç geçmiş ↔ müşteri projeksiyonu yan yana, kanıt, iletişim logu | — |
| O6 | İade kuyruğu | V2 | iade listesi, kontrol akışı, onay/red (nedenli) | red gerekçesi müşteri diline çevrilir |
| O7 | Kuryeler & araçlar | MVP | kimlik CRUD (foto zorunlu), araç atama | — |
| O8 | Raporlar & Ayarlar | MVP | KPI kartları (§14), eşik ayarları, telafi öneri kuyruğu | — |

---

## 9. Mikro Etkileşimler

Hepsi `--motion-*` token'lı; `prefers-reduced-motion` hepsini kapatır.

| # | An | Etkileşim | Gerekçe |
|---|---|---|---|
| 1 | Timeline adımı tamamlanınca | Nokta dolar, çizgi yukarıdan aşağı çizilir (600ms, tek sefer) | İlerleme hissettirilir — sürekli değil, olay anında |
| 2 | Aktif timeline adımı | **Statik** vurgu (renk + ikon) — sürekli pulse YOK | *(v2'de değişti: saatlerce açık ekranda sonsuz nabız yorar + batarya yer)* |
| 3 | Durak sayacı değişimi (V2) | Ticker (250ms); sayı ARTARSA animasyonsuz + "sıra güncellendi" metni | Azalış ödül, artış bilgidir — ikisi aynı dille kutlanmaz |
| 4 | Kurye marker (V2) | Konumlar arası interpolasyon + yön rotasyonu | Işınlanan marker güvensizlik verir |
| 5 | Harita kamerası (V2) | Yaklaştıkça kademeli zoom; **kullanıcı haritaya dokunduğu anda otomatik kamera KAPANIR**, "konuma dön" butonu çıkar | *(v2'de eklendi: kullanıcının pan'iyle savaşan kamera klasik harita hatasıdır)* |
| 6 | Tercih çipi | Optimistic: anında işaretlenir, hata olursa geri döner + toast (150ms) | Beklemeyen arayüz = kontrol hissi |
| 7 | Teslim anı | Onay işareti tek kalemde çizilir, kanıt kartı yerleşir (600ms) | Sakin ama hissedilir kapanış; konfeti yok |
| 8 | `SwipeToComplete` | Sürükleme direnci + eşikte haptik | Yanlış dokunma koruması fiziksel |
| 9 | QR sonucu | Başarı: yeşil flaş + kısa titreşim; hata: kırmızı + uzun | Ekrana bakmadan sonuç |
| 10 | Skeleton | Düşük kontrastlı parıltı; layout kaymaz | Spinner belirsizlik, iskelet beklenti verir |
| 11 | İstisna çözülünce | Yeşil onayla kısa durur, yumuşak çıkar | "Bitirdim" tatmini; ani kaybolma güvensizlik |
| 12 | Pencere güncellenince | Animasyon yok: yeni pencere + "güncellendi" rozeti + bildirim | *(v2'de değişti: eski pencerenin üstü çizili diff'i hatayı vitrine koyuyordu)* |
| 13 | Offline geçişi | Şerit iner, içerik hafif soluklaşır; dönüşte "senkronlandı" | Panik değil bilgi |

---

## 10. Accessibility (WCAG 2.2 AA — iki temada)

1. **Renk asla tek taşıyıcı değil:** her durum ikon + metin taşır. Operasyon haritasındaki **çoklu araç rotaları renk + çizgi deseni + etiketle** ayrışır *(v2'de eklendi — v1 kendi kuralını operasyon haritasında çiğniyordu)*.
2. **Kontrast:** metin ≥4.5:1, büyük metin/ikon ≥3:1 — light/dark ayrı ayrı denetlenir.
3. **Canlı bölgeler:** sayaç/durum değişimi `aria-live="polite"`, teslim anı `assertive`.
4. **Haritanın metin eşdeğeri:** harita görünürken aynı bilgi metin olarak DOM'da ("kurye 2,4 km uzakta, önünde 3 durak"); harita yüklenmezse deneyim eksilmez.
5. **Dokunma:** müşteri ≥44 px, kurye ≥56 px, hedef arası ≥8 px.
6. **Klavye:** tüm akışlar klavyeyle biter; sheet'lerde focus trap + `Esc` + odak iadesi.
7. **`prefers-reduced-motion`:** tüm animasyonlar kapanır; marker anlık konuma döner.
8. **Ekran okuyucu dili:** Türkçe insan cümleleri; saatler `<time>` ile.
9. **Zaman baskısı yalnız kuryede** (2 dk sayacı — titreşimle de bildirir); müşteri tarafında zaman sınırlı zorunlu aksiyon yok. Tek istisna F4 onay linki (90 sn): süresi dolarsa sonuç "bugün teslim edilemedi"dir, hak kaybı değildir.
10. **Form hataları:** metinle + `aria-describedby`; yalnız kırmızı çerçeve yasak.
11. **OTP:** `autocomplete="one-time-code"`.
12. **Kanıt fotoğrafı `alt`:** anlamlı şablon ("paketin kapı önünde fotoğrafı, kapı no 12 görünüyor").
13. **İşitme engelli müşteri** *(v2'de eklendi)*: "Beni ara" tercihinin yanında **"SMS ile haber ver"** alternatifi; F4'te arama yerine onay-linki yolu zaten mevcut — arama hiçbir akışta tek kanal değildir.
14. **200% metin ölçekleme** *(v2'de eklendi)*: tüm ekranlar %200 zoom'da yatay kaydırmasız reflow olur (WCAG 1.4.4/1.4.10); tablolar kendi kaydırma kabında.
15. **Bilinmeyen numara gerçeği** *(v2'de eklendi)*: kurye araması öncesi her zaman push ("kuryen şimdi arayacak"); maskeli numara tektir ve onboarding'de rehbere kaydettirilir.
16. **Kurye saha modu:** yüksek parlaklık teması, alt-bölge yerleşimi, sesli+haptik sonuçlar.

---

## 11. Hipotezler ve Ölçüm Planı

*(v2'de eklendi. v1 bu iddiaları kaynaksız sayılarla "kanıt" gibi sunuyordu; hepsi hipoteze çevrildi. Hiçbir hipotez, doğrulanmadan yol haritası gerekçesi olarak kullanılamaz.)*

| # | Hipotez | Ölçüm | Karar eşiği |
|---|---|---|---|
| H1 | Fotoğraflı kanıtın müşteriye gösterimi "teslim edilmedi" ihtilaflarını azaltır | ihtilaf / 1000 teslim (kanıt-gösterimli vs öncesi dönem) | ihtilaf ≥ %50 düşerse V2'de kanıt yüzeyi genişletilir |
| H2 | F4 OTP-devri/onay-linki mekanizması FAILED oranını anlamlı düşürür | F4 dallanma oranları (arandı → çevrildi → teslim) | çevrilme > %25 ise akış korunur; < %10 ise sadeleştirilir |
| H3 | 👍/👎 tek-dokunuş, form tabanlı ankete göre daha yüksek cevap oranı alır | cevap oranı | < %30 kalırsa istem zamanlaması değişir |
| H4 | "Yaklaşıyor" bildirimi (V2) durak servis süresini kısaltır | bildirimli/bildirimsiz durak süresi A/B | anlamlı fark yoksa bildirim 5'ten 4 ana iner |
| H5 | Pin-doğrulama linki adres kaynaklı FAILED'ları düşürür | adres-nedenli FAILED oranı | — |
| H6 | Timeline + pencere görünürlüğü WISMO destek talebini düşürür | WISMO / sipariş trendi | MVP'nin 90 gün baseline'ı V2 yatırım kararını verir |
| H7 | Kurye kimliği + kanıt, kapıya-bırak benimsemesini artırır | temassız tercih oranı trendi | — |

---

## 12. Edge Case Kataloğu (57 senaryo)

Her senaryo: **durum → sistemin cevabı**. Cevapsız senaryo yayına çıkamaz (İ5). *(v2'de: 5 dolgu senaryo çıkarıldı — form validasyonu, İK konusu ve müşteriyi hiç etkilemeyen iç vakalar edge case değildir; 6 kritik eksik eklendi; F4/B7/E4 cevapları yeni mekanizmalara göre güncellendi.)*

### A. Adres & Konum (9)

| # | Senaryo | Sistemin cevabı |
|---|---|---|
| A1 | Pin ile metin adres çelişiyor | Pin otoritedir; mesafe >300 m ise checkout uyarısı: "Pinin yazdığın adresten uzakta — kontrol et" |
| A2 | Pin yanlış binada | Kurye "adres sorunu" → müşteriye pin-doğrulama linki → düzeltilirse durak sona itilir, aynı turda yeniden denenir |
| A3 | Adres bölge sınırında | Tolerans bandında checkout notu: "Adresin bölge sınırında — teslim 1 gün uzayabilir" |
| A4 | Adres sipariş sonrası bölge dışına değişti | 409: eski adreste kal / iptal — sessizce kabul edilmez (F6) |
| A5 | Site/kampüs, araç giremiyor | Kapı tarifi + "buluşma noktası" önerisi; operasyon adres notuna kalıcı işler |
| A6 | Aynı binaya aynı gün 2 sipariş (farklı müşteri) | Duraklar ardışık sıralanır; kurye kartında "bu binada 2 teslimat" |
| A7 | Konum izni yok | Pin elle konur; arama+sürükleme akışı tam çalışır |
| A8 | Yeni bina, haritada yok | Pin yine konur (pin ≠ POI); ters-geocode boşsa elle adres zorunlu |
| A9 | Müşteri il dışına taşındı | F6 bölge-dışı akışı + varsayılan adres güncelleme önerisi |

### B. Müşteriye Ulaşılamıyor (8)

| # | Senaryo | Sistemin cevabı |
|---|---|---|
| B1 | Zil bozuk, telefon kapalı | F4: push → arama → 2 dk → kapı önü foto + FAILED + "yarın geliyoruz" |
| B2 | "15 dk sonra evdeyim" | Kurye "sona at" (liste işlemi, 1 kez; rota motoru koşmaz, ETA'lar güncellenir) |
| B3 | Kapıya bırak seçili, site güvenliği kabul etmiyor | "Güvenliğe teslim" varyantı: görevli adı + foto → kanıta ve bildirime geçer |
| B4 | Komşuya bırak (V2) seçili, komşu da yok | Tercih zinciri kırılınca varsayılana döner: ara → cevapsızsa FAILED |
| B5 | OTP SMS'i ulaşmıyor (operatör arızası) | Kurye "kod ulaşmıyor" → operasyon onaylı notlu teslim (denetim kayıtlı) + istisna kuyruğu |
| B6 | Yüksek değerli siparişte kapıyı reşit olmayan açtı | Yüksek-değer kuralı: elden+OTP zorunlu; OTP sahibi yoksa teslim edilmez → FAILED |
| B7 | Müşteri eve geldi, kurye 5 dk önce FAILED yazdı | **Aynı gün geri dönüş yoktur** — rota bütünlüğü tek müşteriden önce gelir. Sipariş yarının kapasitesinde önceliklidir; müşteriye bu öncelik bildirilir |
| B8 | Erteleme limiti dolu, yine erteleme istiyor | "Bizi ara / şubeden al"; 7 gün askıda kalırsa iade akışı önerilir |

### C. Paket (6)

| # | Senaryo | Sistemin cevabı |
|---|---|---|
| C1 | Yanlış paketin QR'ı okutuldu | Kırmızı tam-ekran: "Bu paket 14. durağın!" — akış kilitli |
| C2 | Paket araçta hasar gördü | Kurye "hasar" + foto → operasyon karar; müşteriye proaktif bildirim + yeni gönderim sözü |
| C3 | Çoklu paketin biri eksik | Tüm QR'lar okutulmadan teslim kapanmaz → kısmi teslim + eksik için otomatik yeni söz + özür |
| C4 | Etiket okunmuyor (ıslak/yırtık) | Elle sipariş no + operasyon teyidi |
| C5 | "Paket açılmış" iddiası (teslim sonrası) | 24 saat sorun akışı → foto + vaka; teslim anı kanıtı hakemdir |
| C6 | Hibrit sepette dijital teslim hatası | Dijital satır kendi hatasını taşır; fiziksel akışı bloklamaz |

### D. Kurye & Araç (8)

| # | Senaryo | Sistemin cevabı |
|---|---|---|
| D1 | Araç arızası, 12 durak kaldı | "Turu devret": kalanlar yedek araca; pencere güncellemeleri nedenli otomatik gider |
| D2 | Kurye telefonu kapandı | Sinyal-bayat (>10 dk) → operasyon arar; müşteri haritasında dürüst mesaj; işlemler offline kuyrukta, şarjla senkron |
| D3 | Kaza | Acil protokol: tek dokunuş "devret + tüm müşterilere gecikme bildirimi"; güvenlik metrikten önce |
| D4 | 40 dk hareketsizlik | Anomali operasyona düşer (körlük önleme); ETA'lar yeniden hesaplanır, pencere taşarsa bildirim |
| D5 | Bir durak iki turda | Teknik engel: durak tek aktif turda yaşar |
| D6 | Gün bitirilemedi (hava/trafik) | Kalanlar "bizden kaynaklı" koduyla yarına (kapasitede öncelikli) + özür + telafi öneri kuyruğu |
| D7 | Uygulama çöktü | Sunucu + yerel kuyruktan state geri yüklenir; yarım akış kaldığı adımdan sürer |
| D8 | Adreste tehdit (köpek, saldırgan davranış) | *(v2'de eklendi)* Kurye "güvenli değil" → durak özel neden koduyla kapanır (kurye metriğine yazılmaz), operasyon vakası; adres notuna kalıcı uyarı |

### E. Zaman, Söz & Kapasite (8)

| # | Senaryo | Sistemin cevabı |
|---|---|---|
| E1 | Cutoff'a 30 sn kala sipariş | Sunucu saati otoritedir; ödeme cutoff'u aşarsa söz sonraki güne — rozet son 15 dk "bugün garantisi az kaldı" uyarısı verir |
| E2 | Gün kapasitesi cutoff'tan ÖNCE doldu | *(v2'de eklendi — omurganın ana vakası)* Rozet otomatik sonraki uygun güne düşer; müşteri dolu güne asla söz almaz; operasyona "kapasite erken doldu" sinyali (kapasite ayarı/araç kararı girdisi) |
| E3 | ETA penceresi söz gününü taşıyor | Pencere kaydırma bildirimi (nedenli) + telafi öneri kuyruğu; istisna gün ortasında görünür, gece değil |
| E4 | Kurye pencereden erken geldi | Erken deneme müşteri aleyhine sayılmaz (hak yanmaz, metrik ayrışır); kurye bekletilmez; kapıya-bırakta erken teslim sorunsuz |
| E5 | Resmî tatil/Pazar | Söz motoru tatil takvimini bilir; rozet tatile söz vermez |
| E6 | "Bugün değil, 19:00'dan sonra" | V3 slot seçimi; o zamana dek erteleme + kapı tarifi kombinasyonu taşır |
| E7 | Optimizasyon sonrası aynı güne yeni sipariş (V2) | Kapasite açıksa artımlı yerleştirme; pencere taşarsa operasyona seçenek (kabul / yarına) |
| E8 | Durak sayacı ARTTI (sona-at / geri dönüş) | *(v2'de eklendi)* Sayaç animasyonsuz güncellenir + "teslimat sırası güncellendi" metni; pencere hâlâ geçerliyse başka mesaj gitmez, taşarsa pencere bildirimi |

### F. Ödeme & İade (5)

| # | Senaryo | Sistemin cevabı |
|---|---|---|
| F1 | 3 kez teslim edilemedi, müşteri kayıp | Askı → otomatik iade akışı + stok geri alımı |
| F2 | İade kodu yanlış pakete | Eşleşme hatası → devir gerçekleşmez, operasyona işaret |
| F3 | İade kontrolde "kullanılmış" çıktı | Nedenli red → foto + gerekçe + itiraz yolu + geri gönderim seçeneği |
| F4 | "Teslim edilmedi" iddiası (23. saat) | Kanıt sayfası (foto+saat+konum) sunulur; sürerse operasyon vakası |
| F5 | Para iadesi bildirimi gitti, banka 4 gün sürdü | *(v2'de eklendi)* İade bildirimi banka süresini baştan söyler ("bankana göre 1–5 iş günü"); "param gelmedi" destek şablonu hazır cevaplıdır |

### G. Teknik & Offline (7)

| # | Senaryo | Sistemin cevabı |
|---|---|---|
| G1 | Takip ekranında bağlantı koptu | Offline şeridi + son veri soluk + "son güncelleme 14:32"; dönüşte sessiz tazeleme |
| G2 | Konum altyapısı düştü | Fail-open: teslimat akışı etkilenmez; harita "sinyal alınamıyor" hâline düşer; operasyona altyapı uyarısı |
| G3 | Rota motoru çökük (V2) | Haversine fallback + "yaklaşık" rozeti; pencereler otomatik genişler, dar söz verilmez (§2.2) |
| G4 | SMS sağlayıcısı çökük | OTP → B5 yolu; bildirimler push/e-posta'ya düşer; sağlık şeridinde uyarı |
| G5 | Kurye kapsama dışında işlem yaptı | Offline-first kuyruk; teslim saati = işlem anı (dürüst damga); müşteri bildirimi senkronda gider |
| G6 | İki cihazdan eşzamanlı tercih değişikliği | Son yazan kazanır + diğer cihaza anında güncelleme; kurye hep son tercihi görür |
| G7 | Takip token'ı sızdı | Tasarım gereği maskeli/adressiz/kanıtsız; teslim şekli değişikliği oturum/OTP ister; token teslimle pasifleşir |

### H. Güvenlik & Suistimal (6)

| # | Senaryo | Sistemin cevabı |
|---|---|---|
| H1 | OTP 5 kez yanlış | Durak kilitlenir → istisna; yeni kod operasyon onayıyla |
| H2 | Komşu teslimi inkâr ediyor (V2) | Kanıtta ad+daire+foto (paket+kapı, yüz değil); vaka operasyonda; adrese kapıya/komşuya-bırak kapatılır |
| H3 | Sürekli "hasarlı geldi" örüntüsü | Örüntü sayacı; eşikte adres elden+OTP'ye zorlanır + inceleme |
| H4 | Kurye fotosuz teslim kapatmaya çalışıyor | Kapıya/komşuya akışında foto olmadan swipe aktifleşmez (teknik zorlama) |
| H5 | Sahte "kurye" araması (sosyal mühendislik) | OTP SMS'inde sabit cümle: "kuryemiz seni arayıp kod istemez" — kod yalnız kapıda yüz yüze ya da müşterinin kendi başlattığı F4 telefonunda söylenir |
| H6 | PoD fotoğrafında üçüncü kişi/yüz | *(v2'de eklendi)* Çekim kılavuzu insan çerçevelemez; yüz içeren kanıt operasyon kontrolünde yeniden çekim/kırpma gerektirir; 12 ay saklama (§3.11) |

---

## 13. Yol Haritası — MVP / V2 / V3

Ölçek: **UX etkisi · İş değeri · Maliyet** (D/O/Y). *(v2'de MVP bilinçli olarak inceltildi: MVP'nin işi en dar kapsamla verilen her sözü tutmaktır; canlı harita olmadan yaşanır, tutulmayan sözle yaşanmaz.)*

### MVP — "Sözünü tutan omurga"

| Özellik | UX | İş | Maliyet |
|---|---|---|---|
| **Kapasiteli söz motoru** (gün sözü + blok pencere + rozet) | Y | Y | O |
| Durum makinesi + müşteri projeksiyonlu timeline | Y | Y | O |
| 3-an bildirim + istisna bildirimleri (kanal fallback, SMS tavanı) | Y | Y | O |
| 2 tercih (elden OTP / kapıya bırak foto) + kapı tarifi | Y | Y | O |
| Erteleme self-servisi (limit 2) | O | Y | D |
| Kurye tek-kart akışı + çift QR katmanı + offline kuyruk | Y | Y | Y |
| Başarısız teslim F4 (OTP-devri / onay-linki) | Y | Y | O |
| Foto PoD + kanıtın müşteriye gösterimi | Y | Y | D |
| Hazırlama istasyonu + elle sıralı dispatch + istisna kuyruğu | O | Y | O |
| İptal akışı (M7) | O | O | D |
| Public token'lı izleme (+erteleme) | O | O | D |
| `SystemState` durum kalıpları | O | O | O |

**MVP'de bilinçli YOK:** canlı harita, durak sayacı, dar pencere, rota motoru, komşuya/beni-ara, 👍/👎, iade self-servisi (destek üzerinden yürür), kurye kimlik kartı.

### V2 — "Canlı ve kişisel"

| Özellik | UX | İş | Maliyet |
|---|---|---|---|
| Rota motoru + "Günü Optimize Et" + dar pencere | Y | Y | Y |
| Canlı harita + durak sayacı (son ~8 durak) + "yaklaşıyor" bildirimi | Y | O | Y |
| Kurye kimlik kartı + 👍/👎 + etiketler | Y | O | D |
| Komşuya bırak + Beni ara tercihleri | O | O | O |
| "Bir sorun var" 24s akışı + hazır çözüm yolları | Y | Y | O |
| Kargo ile ücretsiz iade + iade timeline'ı | Y | Y | O |
| Çoklu paket birleşik timeline + sipariş birleştirme | O | Y | O |
| Son tercihi hatırlama (checkout ön-seçimi) | D | O | D |
| A11y AA denetimi + 200% reflow doğrulaması | O | O | O |

### V3 — "Öngörülü ve ölçekli"

| Özellik | UX | İş | Maliyet |
|---|---|---|---|
| Saat-dilimi slot seçimi (kapasite bazlı — kapasitesiz slot boş sözdür) | Y | O | Y |
| Kapıdan iade toplama + kapıdan değişim | Y | O | Y |
| Telafi öneri kuyruğu otomasyonu (öneri otomatik, onay insan) | O | Y | O |
| Çoklu araç gün-içi canlı dispatch (E7 artımlı yerleştirme) | O | Y | Y |
| Öngörülü istisna (ETA sapma tahmini) | O | Y | Y |

---

## 14. KPI ve Unit Economics

*(v2'de yeniden kuruldu: vanity metrik çıkarıldı, birim ekonomi eklendi, hedef disiplini kondu.)*

**Hedef disiplini:** İlk 90 gün hedefsiz **baseline ölçümü** yapılır; mutlak hedefler baseline + çeyrek olarak konur. Aşağıdaki tablo hedef değil **izleme yönü** verir.

### Deneyim metrikleri

| Metrik | Tanım | Yön |
|---|---|---|
| **Sorunsuz sipariş oranı** (kuzey yıldızı) | Şu olayların HİÇBİRİ olmayan siparişler: destek teması, FAILED durak, pencere dışı teslim, hasar/eksik bildirimi, iade-ihtilafı | ↑ |
| Söz tutma | teslim ≤ söz günü / tüm teslimler | ↑ |
| Pencere isabeti | pencere içinde teslim / pencere verilenler | ↑ |
| İlk denemede teslim | ilk durakta DELIVERED / ilk denemeler | ↑ |
| WISMO oranı | "siparişim nerede" desteği / sipariş | ↓ |
| Teslimat 👍 oranı (V2) | 👍 / (👍+👎) | ↑ |
| Erteleme oranı | müşteri ertelemesi / planlanan durak | izlenir — yüksekse pencere/blok yanlış kurgulanmıştır |
| Ortalama pencere genişliği | verilen pencerelerin dk cinsinden ortalaması | ↓ (sözün "sıkılığı"; isabetle birlikte okunur) |

### Unit economics

| Metrik | Tanım | Yön |
|---|---|---|
| Maliyet / durak | (kurye saat maliyeti × tur süresi + km × yakıt&amortisman) / teslim edilen durak | ↓ |
| SMS / sipariş | gönderilen SMS adedi / sipariş (tavan 3, hedef ort. ≤2) | ↓ |
| Durak / saat | teslim edilen durak / saha saati | ↑ (güvenlik ihlalsiz) |
| Destek maliyeti / sipariş | teslimat kaynaklı destek teması × ort. işlem maliyeti / sipariş | ↓ |
| Yeniden deneme maliyeti | (FAILED + RESCHEDULED) durak oranı × maliyet/durak | ↓ |
| İade lojistik maliyeti / iade (V2) | kargo iade bedeli + kontrol işçiliği | ↓ |
| Kapasite kullanımı | planlanan durak / kapasite (gün) | 0,75–0,90 bandı (düşük = israf, >0,90 = söz riski) |

*(Çıkarılanlar: "bildirim → ekran dönüşü" — dönüşü artırmanın en kolay yolu daha kaygı verici bildirimdir, İ4'ü baltalayan vanity metrikti; "kapıya-bırak benimseme = güven göstergesi" — karıştırıcı değişkenlerle dolu; H7 hipotezi olarak izlenir, KPI değil.)*

---

## 15. Kapanış ve CHANGELOG

### Kapanış

Bu spesifikasyonun iddiası tek cümledir: **teslimat bir kargo operasyonu değil, bir güven ürünüdür — ve güven, yalnız tutulabilecek sözler vermekle başlar.** v2, v1'in anlatı gücünü korurken üç şeyi değiştirdi: sözün altına kapasite matematiği koydu, MVP'yi "verdiği her sözü tutabilen en dar kapsam"a indirdi ve her iddiayı kanıt/hipotez olarak etiketledi. Figma'ya girecek 28 ekran, 16 bileşen ve 57 edge case ile ekip çizmeye başlayabilir.

### CHANGELOG — v1 → v2

**Omurga ve model**
1. **Kapasiteli söz motoru eklendi ve merkeze kondu** (§2.1): söz = f(cutoff, bölge, kalan kapasite); rozet dolu güne asla söz vermez; yeniden denemeler kapasitede öncelikli. v1'in en büyük deliği buydu.
2. Pencere matematiği somutlaştı (§2.2): veri kaynağı → verilebilecek en dar söz tablosu; fallback'te pencere otomatik genişler.
3. İ5 ilkesi "yalnız tutulabilecek söz verilir" olarak yeniden yazıldı.
4. Telafi otomasyonu (otomatik kupon) → **operasyon onaylı telafi öneri kuyruğu** (suistimal + marj riski).
5. Erken varış kuralı değişti: kurye bekletme yasağı yerine "müşteri aleyhine saymama" muhasebesi.

**Akışlar**
6. F4 yeniden tasarlandı: sözlü onay tek başına geçersiz; **OTP-devri** (müşteri kodu telefonda okur) veya **90 sn onay linki** şart.
7. B7 netleşti: aynı gün geri dönüş YOK; ertesi gün kapasite önceliği var.
8. F0 (söz üretimi) akışı eklendi.
9. "Sona at" sadeleşti: liste işlemi, rota motoru koşmaz.
10. Müşteri **iptal akışı** eklendi (v1 unutmuştu).

**Kapsam ve fazlar**
11. MVP inceltildi: 2 tercih (komşu/beni-ara → V2), rota motoru → V2, canlı harita + sayaç → V2, 👍/👎 → V2; erteleme MVP'de KALDI (ucuz, FAILED önleyici).
12. İade: kapıdan toplama V3'e; V2 = anlaşmalı kargo + iade timeline'ı (kitapta iade hacmi pickup altyapısını taşımaz).
13. Bölüm 3 ikiye ayrıldı: **MVP yolculuğu** (blok pencere, haritasız) + **V2 hedef yolculuğu** — v1 ikisini harmanlayıp MVP'yi olduğundan zengin gösteriyordu.
14. Sipariş birleştirme (aynı müşteri aynı gün → tek durak) V2'ye eklendi.
15. L3 "kimlik beyanı" kaldırıldı → yüksek değerli siparişte kapıya-bırak kapatılır (elden+OTP).

**Tutarlılık düzeltmeleri**
16. Sessiz saat 21:00–08:30 yapıldı; sabah bildirimi 08:30 sonrası (v1: kural 09:00 derken bildirim 08:30'da gidiyordu).
17. Ürün değerlendirme daveti teslimat kanalından mağaza kanalına taşındı (v1 kendi "kutsal kanal" kuralını çiğniyordu).
18. F2'nin "kurye yakınken kilit" kuralı ile F4'ün telefonda tercih değişikliği çelişkisi, F4'ün OTP-devri mekanizmasıyla giderildi (ikisi de artık doğrulama ister).
19. Canlı harita kuralı: tur başından değil **son ~8 duraktan itibaren** (tüm gün açık harita obsesif izleme + destek talebi üretir); "yola çıktı" bildirimi kaldı ama linki blok pencereye iner, canlı bölüm geç açılır.
20. Public token'dan kapıya-bırak değişikliği kapatıldı (hırsızlık vektörü); token yetkisi: izleme + erteleme + beni-ara.

**Kanıt hijyeni**
21. Tüm kaynaksız sayılar ("10x cevap oranı", "%95 açılma", "başarısızların yarısı", "30-60 sn/durak") ve pop-psikoloji atıfları (Zeigarnik) kaldırıldı → **§11 Hipotezler ve Ölçüm Planı** (H1–H7) eklendi.
22. Benchmark tablosu düzeltildi (Amazon pencere/gün sözü verir; Trendyol'un enflasyonu kampanya kanalındadır; Shop agregatördür — kusur değil kategori; DoorDash baskısı ödeme modelindendir) + yöntem dürüstlük notu eklendi.

**Ekranlar, bileşenler, sistem**
23. Ekranlar 29 → 28: eklendi M7 iptal + O1 hazırlama istasyonu; kaldırıldı K7 rota haritası, K9 geçmiş turlar, M12 bildirim matrisi (→ tek toggle satırı).
24. Bileşenler 23 → 16: `PromiseBadge`+`EtaWindowCard`→`PromiseDisplay`; `StopsAheadTicker`→`LiveMapCanvas` içi; `ReturnTimeline`→`DeliveryTimeline` varyantı; `PackageBadge`→`StatusPill` varyantı; `EmptyState`+`ErrorState`+`OfflineBanner`→`SystemState`; `ProofCameraGuide` bileşenlikten çıktı.
25. "Kuryene teşekkür et" butonu `ThumbRating` etiketiyle birleştirildi.
26. "Teslimatlarım" arşiv ekranı ve rapor "karar önerileri" kaldırıldı.
27. Kanıt fotoğrafı bulanıklık analizi → statik çerçeve kılavuzu + ipucu satırı.

**Motion ve a11y**
28. Sürekli pulse kaldırıldı (statik aktif vurgu); ETA üstü-çizili diff kaldırıldı ("güncellendi" rozeti); harita kamerasına "kullanıcı dokununca otomatik kamera kapanır" kuralı eklendi; sayaç artışı animasyonsuz + açıklamalı.
29. A11y eklendi: işitme engelli alternatifi ("SMS ile haber ver"; arama hiçbir akışta tek kanal değil), 200% reflow, çoklu rota renk+desen+etiket, "kuryen şimdi arayacak" ön-bildirimi + kayıtlı numara.

**Yeni bölümler**
30. §3.11 KVKK ve veri saklama (PoD 12 ay, üçüncü kişi yüzü politikası, arama logu politikası).
31. §14 unit economics (maliyet/durak, SMS/sipariş, kapasite kullanım bandı 0,75–0,90) + 90 gün baseline disiplini; "bildirim→ekran dönüşü" ve "kapıya-bırak=güven" metrikleri çıkarıldı.
32. Edge kataloğu 56 → 57: çıkarıldı A8 (form validasyonu), D8-eski (İK), F5-eski (iç vaka), H6-eski (jenerik admin), C4-kuyruğu; eklendi E2 kapasite erken doldu, E8 sayaç artışı, D8 saha güvenliği, F5 banka iade gecikmesi, H6 PoD'de üçüncü kişi, sipariş birleştirme (§3.10).
33. Tekrar eden bölümler birleştirildi: takip+harita+sayaç tek bölüm (§3.2); tercih+güvenlik+kanıt tek bölüm (§3.3); 16 deneyim alanı 11 alt bölüme indi.



