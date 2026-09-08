# Ürün kararları — **ÜK-n**

Bu dosya, ürünün *nasıl davranacağına* dair alınmış kararların tek yeridir.
Her karar bir numara taşır (**ÜK-1**, **ÜK-2**, …) ve koddaki yorumlar bu
numaraya atıf yapar. Amaç şu: bir yorumda "ÜK-4 gereği" yazdığında, kararın
kendisinin, gerekçesinin ve nöbetçisinin nerede olduğu tek aramayla bulunsun.

## Neden ayrı bir namespace

`Ç-1…Ç-6` **İP-B1 raporunun açık sorularıdır** (`docs/ip-b1-rapor.md`), ürün
kararı değil. 5–6 Eylül 2026 turunda o namespace yanlışlıkla ürün kararları için
kullanıldı: `Ç-4` hem *"Ayarlar bölümü tek sayfa mı"* hem *"turuncu aksan"*
demeye başladı, `Ç-5` hem *"Google Fonts / KVKK"* hem *"öğrenci rol adı"*.
30 geçiş `ÜK-n`'e taşındı. **`Ç-n`'ye artık ürün kararı yazılmaz.**

Hâlâ geçerli `Ç-n` atıfları (dokunulmadı): `Ç-4` = ayarlar bölümü kararı
(`docs/ip-b1-rapor.md:235`), `Ç-5` = yazı tipi self-host / KVKK
(`frontend/src/index.css:7`, `__guards__/disFont.test.ts`).

---

## Özet

| # | Karar | Durum | Nöbetçi |
|---|---|---|---|
| **ÜK-1** | Site aksanı turuncu; dolgu PARLAK, yazı KOYU | uygulandı | `__guards__/markaAksani.test.ts`, `gecerliMarkaSinifi.test.ts` |
| **ÜK-2** | Üst barda tek kısayol; gerisi hesap menüsünde | uygulandı | `__guards__/ustBarSadeligi.test.tsx` |
| **ÜK-3** | Öğrenci ders talepleri donduruldu | uygulandı | `__guards__/bolumDondurma*.test.tsx` |
| **ÜK-4** | "Öğrenci" rol adı değildir → **"Üye"** | uygulandı | `__guards__/rolEtiketi.test.ts` |
| **ÜK-5** | Bir e-posta = bir hesap (çapraz tablo) | uygulandı | `tests/integration/test_ayni_eposta_iki_tablo_pg.py` |
| **ÜK-6** | Eğitmen de eğitmen/kütüphane favorileyebilir | uygulandı | `__guards__/favoriRolKapisi.test.tsx`, `test_tutor_shopper_pg.py` K-22..K-25 |
| **ÜK-7** | Arayüzde uzun tire (—) kullanılmaz | uygulandı | (kabul ölçütleri dört testte) |
| **ÜK-8** | Sosyal giriş: Google EVET, Facebook HAYIR | uygulandı | `test_google_oidc_dogrulama.py`, `test_google_oauth_pg.py`, `test_parolasiz_hesap.py` |
| **ÜK-9** | Soyad public yüzeylerde görünmez | uygulandı | `test_soyad_public_yuzeyde_yok.py` |

---

## ÜK-1 — Aksan rengi turuncu; dolgu parlak, yazı koyu

**Karar.** Marka aksanı **`#FF9900`** — Amazon'un kendi turuncusu.

7 Eyl 2026'da üç adımda buraya gelindi: `#E37200` → `#F0850F` → `#FA8C10` →
`#FF9900`. İlk üçü "biraz daha aç" kaydırmasıydı; sonuncusu farklı, çünkü
kullanıcı hedefi adlandırdı (*"daha Amazonvari bir renk"*) ve logodaki
turuncunun (`#F6AD55`) uzağında kalındığını söyledi. Değer artık keyfî
değil: sektörde yerleşik bir renge demirli.
Turuncu **dolgu** olarak parlak kullanılır,
**yazı** olarak asla; açık zeminde marka yazısı ayrı bir token taşır
(`--marka-metin`, `#96430A`).

**Gerekçe.** İlk sürüm turuncunun üstüne beyaz yazı koyuyordu. Beyaz metnin
AA eşiğini (4,5) geçmesi için turuncuyu ışıklılık ~0,18'e kadar karartmak
gerekiyor; o noktada turuncu kahverengi okunuyor. Kullanıcının tarifi: *"bok
rengi gibi"*. Renk seçimi elle hex denemekle değil, adlandırılmış paletlerin
(Tailwind orange/amber, Radix, Material) görsel karşılaştırmasıyla yapıldı.

**Ölçülen bedel.** Dolgu üstündeki yazı 8,33 · marka yazısı 6,77 · bilgi
rozeti 6,24 · uyarı çipi 8,15 · odak halkası 4,50 · kenarlık 3,58.

**7 Eyl 2026 · açıkça kabul edilen bedel.** Kullanıcı rengi daha açık istedi.
Dolgunun beyaz zemine karşı kontrastı 3,15 → **2,14**; yani SC 1.4.11'in
"kontrol sınırı görünür olsun" eşiği (3,0) bilerek terk edildi ve düğme beyaz
zeminde kenarını yitirdi. Alternatifler ölçülüp tükendi: bir adım açmak zaten
2,95, ton kaydırmak (28°-44° tarandı) eşiği koruyan daha parlak bir renk
üretmiyor, dolguya kenarlık eklemek 336 çağrı yerini etkiliyor. **Metin
okunurluğu (4,5) tartışmaya açık değil ve korundu** — dolgu üstündeki yazı
8,33 veriyor, yani Amazon'un kendi düğmesiyle aynı yaklaşım (parlak dolgu,
koyu yazı).

Alt eşik nöbetçide 2,1'e indi ve **hemen bu değerin altında duruyor**: bir
sonraki "biraz daha aç" isteği düğümü kırar ve yeniden karar verilmesini
zorlar. Kayma değil, demir.

Ton değişimi artık tek komut: `node frontend/scripts/marka-tonu.mjs "#RRGGBB"`
(`--olc` yalnız ölçer, yazmaz). Nöbetçideki çıpayı bilerek güncellemez —
o bir ürün kararıdır.

**Kapsam dışı.** `success`/`danger`/`neutral` ham Tailwind ölçeğinde kaldı —
bunlar marka değil **anlam** renkleridir ve marka değişse de değişmezler
(`components/admin/ui/Badge.tsx`).

**Tuzak.** Token köprüsü `rgb(var(--x) / <alpha-value>)` biçimindedir. Bir
sınıfa ikinci kez opaklık eklenirse (`shadow-marka/20/20`) Tailwind sınıfı
**sessizce üretmez** ve `npm run build` YEŞİL geçer. Beş dosyada bu olmuştu;
`__guards__/gecerliMarkaSinifi.test.ts` o sınıfı yakalamak için var.

Ayrıntı: `docs/tasarim-dili.md` §1.2/§1.4 · kanıt: `docs/ip-c4/README.md`.

---

## ÜK-2 — Üst barda tek kısayol

**Karar.** Üst barda yalnız **Favorilerim** durur. Rol kısayolları, bildirimler
ve panel bağlantıları hesap (avatar) menüsüne indi.

**Gerekçe.** Kullanıcı: *"navbarda bir ton gereksiz kısayol var … navbar böyle
çok gereksiz kalabalık oldu, sadece favoriler kalsın."*

**Bu turda çıkan kusur.** Bildirim zili kaldırılırken `/bildirimler` rotası
**hiçbir menüde kalmıyordu** — sayfa yaşıyor ama ulaşılamıyor: ölü uç. Zil
kaldırılmadan ÖNCE bağlantı hesap menüsüne taşındı. Kural olarak: *bir giriş
noktası kaldırılırken hedefin başka bir girişi olduğu kanıtlanır.*

---

## ÜK-3 — Öğrenci ders talepleri donduruldu

**Karar.** Öğrencinin ders talebi açması ve eğitmenin talep listesi arayüzden
kaldırıldı; kod, uçlar, tablolar ve testler **yerinde duruyor**.

**Gerekçe.** Kullanıcı: *"şu an kullanmak istemiyorum, kodları dursun, sonra
yayına almak istersek dursun bir yerde."*

**Nasıl.** Derleme zamanı bayrağı `lib/ozellikBayraklari.ts::TALEPLER_ACIK`.
Bu, veritabanındaki `feature_flags` kataloğu **değildir** — o katalog operasyon
anahtarlarını taşır, bu ise lansmana yetişmeyen arayüz bölümlerini.
Bayrağı `true` yapmak tek başına yeterlidir; nöbetçisi
`__guards__/bolumDondurmaBayrakAcik.test.tsx` bunu çıpalar.

---

## ÜK-4 — "Öğrenci" bir rol adı değildir

**Karar.** Talep tarafındaki rolün adı **"Üye"**. Etiketler tek kaynaktan gelir:
`frontend/src/lib/roles.ts` (`ROL_ETIKETI`, `rolEtiketi`).

**Kelime yasak değil.** Hedef kitleyi anlatan metinde "öğrenci" kalır
("ilanını gören öğrenciler sana ulaşır") — orada gerçekten öğrenci kastediliyor.
Nöbetçi kelimeyi değil **etiket biçiminde kullanımını** arar (dize sabiti,
`title=`/`label=`, JSX metin düğümü).

### Dışarıdan bakıldığında ne yapılıyor

| Platform | Model | Bizim için anlamı |
|---|---|---|
| **Airbnb** | TEK hesap; "hosting'e geç" ile mod değişimi | Arz ve talep aynı kişide olabilir; ayrı hesap zorunlu değil |
| **Preply** | Öğrenci ve öğretmen AYRI hesap | Kullanıcılar yıllardır "profiller arası geçiş" talebi açıyor — ayrı hesap modeli şikâyet üretiyor |
| **JetDers (TR)** | Ayrı **"Veli Hesabı"**: veli satın alır, öğrenciye atar | Talep tarafındaki kişi çoğu zaman öğrencinin kendisi değil |
| **Dersveren (TR)** | Ebeveyn olarak kayıt mümkün | Aynı sonuç |

### Depo içi kanıtlar

- `backend/core/flags.py:147` — 18 yaş altı rezervasyon KAPALI, gerekçe kodda
  yazılı: *"Veli (Guardian) modeli yazılana kadar kapalı."* Yani hesap sahibi
  **tanım gereği ödeyen yetişkin**; dersi alan kişi olmak zorunda değil.
- `frontend/src/lib/legalContent.ts:439` — Mesafeli Satış · Taraflar:
  `"ALICI: … öğrenci/müşteri"`. Hukuk metni tek ad seçememiş.
- `backend/api/deps.py:233 get_shopping_client` + `models/client.py:56
  shadow_of_tutor_id` — eğitmen mağazadan alışveriş yapabilsin diye **gölge
  Client** yansıtması yazılmış. Ayrım doğru yerde olsaydı gerekmezdi.

**Bu turda kapanan çelişki.** Etiket **yedi dosyada elle** yazılıydı ve ikisi
birbiriyle çelişiyordu: `AdminAuditLogsPage` rol 1 için "Admin", diğer iki ekran
"Yönetici" diyordu.

**Açık kalanlar** (kaybolmasın diye yazılı):

1. **Tek hesap + mod değişimi mimarisi.** `Tutor`/`Client` ayrı tablolar ve bu
   CLAUDE.md'de *değişmez sınır*. Dönüşüm ya satır taşımak ya iki satırı bir
   kimlik altında bağlamak demek — ikisi de para yoluna dokunur.
2. **Veli (Guardian) modeli.** Bugün `flags.py`'de borç olarak duruyor; 18 yaş
   altı rezervasyon bu yüzden kapalı.
3. **Yasal metinlerdeki "öğrenci"** — `legalContent.ts`'te 15 geçiş. Avukat
   onayı ve sanal POS beyanına bağlı; arayüz etiketiyle birlikte
   değiştirilmedi.

---

## ÜK-5 — Bir e-posta = bir hesap

**Karar.** Bir e-posta adresi beş kullanıcı tablosunun **tamamında** tektir
(`backend/services/auth_service.py::_email_taken`). Gölge Client satırları bu
kontrolün dışındadır.

**Gerekçe — bu bir tercih değil, üretim hatasıydı.** Aynı e-posta hem `tutors`
hem `clients` tablosunda varsa ve şifreler aynıysa, giriş sırası
(`_LOGIN_PRECEDENCE`: ADMIN→TUTOR→CLIENT→OPERATOR→COURIER) yüzünden **client
hesabına bir daha girilemiyordu**. Kullanıcı kendi hesabını kaybediyor ve neden
olduğunu göremiyordu. Gerçek Postgres üzerinde kanıtlandı:
`backend/tests/integration/test_ayni_eposta_iki_tablo_pg.py`.

**Değişen kabul ölçütü.** `test_tutor_shopper_pg.py` K-14, eğitmenin e-postasıyla
ayrı bir client hesabı **açılabildiğini** (201) çıpalıyordu. Artık 409. Ölçüt
gerekçesiyle yeniden yazıldı ve engelin **gölge satır değil eğitmenin kendi
satırı** olduğunu ayıran K-14b eklendi. `docs/egitmen-alici-sozlesme.md`
güncellendi.

---

## ÜK-7 — Arayüzde uzun tire (—) kullanılmaz

**Karar.** Kullanıcıya görünen hiçbir metinde uzun tire (em dash, `—`)
geçmez. Cümle içindeki açıklayıcı tire iki noktaya, boş değer göstergesi düz
tireye (`-`) döndü. Kod yorumları ve iç belgeler kapsam DIŞINDA — onları
kullanıcı görmez.

**Gerekçe (kullanıcı, 7 Eyl 2026).** *"Şu yapay zekanın kullandığı tire gibi
bir işaret var, her yerden kaldır. Yapay zeka yapmış falan deyip
güvenmemezlik yapacaklar sonra."* Karakterin kendisi yanlış değil; sorun
okuyanda bıraktığı izlenim. Güven, bir eğitim pazaryerinde ürünün kendisi
kadar önemli.

**Kapsam ve sayı.** 213 geçiş değişti: 80'i boş değer göstergesi
(`"—"` → `"-"`), 133'ü cümle içi bağlaç. Dört kabul ölçütü de gerekçesiyle
güncellendi (paket etiketi, sayım oturumu adı, operasyon metrikleri,
operatör paneli düzenleme düğmeleri).

**Tuzak.** İlk toplu değiştirme, JSDoc ve JSX yorumlarını regex sanıp
bozdu (`bileşen — value` → `bileşen : value`). Yorumlar `git show HEAD`
karşılaştırmasıyla geri alındı; ders: kullanıcıya görünen metin ile kod
yorumunu ayıran tarama, blok yorumları da tanımak zorunda.

---

## ÜK-6 — Eğitmen de favorileyebilir

**Karar.** Eğitmen hesabı da eğitmen ve kütüphane favorileyebilir.

**Önceki durum — kaza değil, beş katmanlı ve testli engeldi:**

| Katman | Yer |
|---|---|
| Arayüz | `BookmarkButton.tsx:30`, `LibraryBookmarkButton.tsx:29` — `role_id !== CLIENT` ise `null` |
| Uç | `bookmarks.py:19,29`, `library_bookmarks.py:22,33` — `require_roles(RoleType.CLIENT)` |
| Veri | `models/bookmark.py:14`, `library_bookmark.py:17` — birincil anahtar `clients.id` |
| Rota | `App.tsx:513` — `/favoriler` yalnız CLIENT |
| Menü | `lib/nav.ts:47` — "Favorilerim" yalnız `UYE_NAV`'da |

Kabul ölçütü olarak çıpalı: `test_tutor_shopper_pg.py:845` — eğitmene
`/api/v1/bookmarks/1` **403** dönmeli (K-20).

**Neden yine de açılmalı.** Kapsam dışı bırakma gerekçesi
(`docs/egitmen-alici-sozlesme.md:75`) *"'eğitmen eğitmenden ders alır' gibi
çözülmemiş ürün sorularını ve `_assert_party` gibi görmediği tarafları
doğurur"* diyor. Bu gerekçe favoriye **uymuyor**: favori özel bir listedir —
taraf ilişkisi kurmaz, para yolu yoktur, mesajlaşma açmaz. Gerekçe ders
rezervasyonu, koltuk/bilet ve talepler için geçerli; favori onların yanına
toptan `require_roles` yüzünden düşmüş.

Tutarsızlık ölçülü: eğitmen **mağazada ürün favorileyebiliyor**
(`store.py:1411`, `get_shopping_client`) ama ders verdiği kütüphaneyi
favorileyemiyor.

**Yapıldı (6 Eyl 2026).** Altı uçta `require_roles(RoleType.CLIENT)` →
`get_shopping_client`; eğitmen **kendi ilanını** favorileyemez (self-dealing
kuralının favori karşılığı); arayüzde rol kapıları kalkar, `/favoriler` rotası
CLIENT+TUTOR olur ve `TUTOR_NAV`'a "Favorilerim" girer — **üçü birlikte**,
yoksa ÜK-2'deki ölü uç tuzağı tekrarlanır. K-20 yalnız `bookmarks` için
daraltılır; booking/talep/kütüphane rezervasyonu listede kalır.

> **Ad borcu.** `get_shopping_client` favorileri de taşıyınca adı eksik
> kalıyor. Yeniden adlandırma ~25 çağrı yerini ve sözleşme maddelerini
> etkiliyor; bu turda YAPILMAZ.

---

## ÜK-8 — Sosyal giriş: Google var, Facebook yok

**Karar.** "Google ile devam et" eklendi. Facebook, Apple ve diğer sağlayıcılar
kapsam dışı. `oauth_identities.provider` kolonu yine de bugünden var: ikinci bir
sağlayıcı şema değişikliği değil, satır eklemesi olsun diye.

**Facebook neden yok.** Gerekçe "az kullanılıyor" değil, mimari. Facebook Login
e-posta **vermeyebiliyor** (kullanıcı gizlerse ya da hesap telefonla açılmışsa).
ÜK-5 *"bir e-posta = bir hesap"* bir üretim hatasından doğdu ve testle çıpalı;
e-postasız gelen bir kimlik o modeli kırar. Üstüne Meta'nın App Review süreci ve
yıllık Data Use Checkup yükü var: atlanırsa giriş bir sabah çalışmayı bırakır.
Apple ise gerekmiyor — App Store kuralı mobil uygulamaya bakar, web'de geçerli
değil.

**Google'ın kendi kütüphanesi (GSI / One Tap) KULLANILMIYOR.** O script sayfa
açılır açılmaz `accounts.google.com`a istek atar; yani kullanıcı hiçbir onay
vermeden üçüncü tarafa veri gider. Bu, deponun yazı tipini self-host'a taşıyan
KVKK kararıyla aynı sınıf (`__guards__/disFont.test.ts`) ve CSP'deki
`script-src 'self'`i de delerdi. Bunun yerine sunucu tarafı authorization-code +
PKCE akışı: hiçbir Google script'i yüklenmez, `client_secret` sunucuda kalır ve
güvenlik başlıklarına hiç dokunulmaz (yönlendirme, form gönderimi değil —
`nginx-security-headers.conf` bu ayrımı iyzico için zaten yazıyor).

**Hesap bağlama OTOMATİK.** Google `email_verified: true` döndüğünde ve e-posta
mevcut bir hesapla eşleştiğinde o hesaba bağlanır; ikinci hesap açılmaz (ÜK-5
korunur). Doğrulanmamış e-postalı bir hesaba bağlanırken `auth_version` artar ve
refresh token'lar iptal edilir: o hesabı doğrulanmamış bir adresle açan kişi
adresin sahibi olmayabilir, gerçek sahibi Google ile kanıtlayıp geldiğinde
kanıtsız oturumlar düşer.

**Giriş modu da hesap AÇAR — düzeltilmiş karar.** İlk sürüm giriş akışında
hesap açmıyor, *"Bu Google hesabıyla eşleşen bir üyelik yok, önce kayıt
olabilirsin"* diyordu. Gerekçe "kullanıcı hesabı olduğunu sanıyordur, sessizce
ikinci hesap yaratmayalım" idi ve YANLIŞ YERE uygulanmıştı: ikinci hesap riski
yalnız e-posta mevcut bir hesapla **eşleştiğinde** doğar, onu da otomatik
bağlama kolu çözüyor. O noktaya gelindiyse e-posta hiçbir tabloda yok demektir,
yani bölünecek bir hesap da yok.

Karşılığında ürettiği davranış her sosyal girişin sözleşmesine aykırıydı.
Kullanıcının sözleriyle: *"olum bu ne saçma sapan bir uyarı, yüzlerce siteye
girdim."* Haklı — Google ile giren birine "önce kayıt ol" denmez.

İki soru vardı, ikisi de çözüldü:
- **Rol**: varsayılan CLIENT (Üye). Eğitmen olmak ayrı ve bilinçli bir
  yolculuktur (`/kayit` → "Ders vermek" → ilan sihirbazı); seçilmemiş bir rolü
  atamak yanlış olurdu.
- **KVKK**: onay sürümü akışta taşınır ve `user_consents`a yazılır; sürüm
  yoksa hesap AÇILMAZ. Giriş düğmesinin altına bir bilgilendirme metni
  eklenmişti, **kaldırıldı**: kullanıcı rakiplerde böyle bir metin olmadığını
  söyledi ve haklıydı — o metin her düğmenin altında değil, olsa olsa sayfanın
  en altında tek satır olarak bulunur. Aydınlatma metni footer'da ve `/kvkk`
  adresinde erişilebilir, kayıt ekranındaki gerçek onay kutusu yerinde duruyor.
  Bilinen sınır: giriş akışından açılan hesapta onay, aydınlatma metni ekranda
  gösterilmeden kaydediliyor. Avukat incelemesinde bu maddeye bakılmalı
  (lansman öncesi yasal gözden geçirme zaten bekliyor).

**Yan etkisi bilinçli:** kayıt kapısı (`registration_open`) artık giriş modunda
da denetleniyor. Muafiyet ilk sürümde doğruydu (giriş hesap açmıyordu); karar
değişince arka kapıya dönüşürdü. Bedeli: kapı kapalıyken mevcut hesap sahipleri
de Google ile giremez, parolalarıyla girerler.

**Parolasız hesap ve ölçülmüş bir tuzak.** `hashed_password` beş tabloda da
nullable oldu. Alternatif, depoda zaten kullanılan sentinel hash'ti (`"!"`) ve
migration'dan kurtarıyordu. Ölçüm çürüttü: `bcrypt.checkpw(b"x", b"!")` →
`ValueError` ve `verify_password` onu yakalamıyordu. Sentinel bugün patlamıyor
çünkü onu taşıyan iki satır tipi de `authenticate`in sorgusundan zaten düşüyor;
Google hesabı ise tam da bulunacak satır. Sentinel seçilseydi parola denemesi
401 değil **500** dönerdi ve bu bir hesap-varlığı yan kanalı olurdu.

**KVKK.** Kayıt onayı Google kolunda da alınır: onay kutusu artık state tutuyor
(tam sayfa gezinme tarayıcının `required` kontrolünü tetiklemez) ve sürüm imzalı
`state` çerezinde taşınıp `user_consents`a yazılır. Ayrıca parolasız hesap da
hesabını silebiliyor — parola isteyen tek kol bırakılsaydı KVKK silme hakkı
kapanırdı.

**Açık kalan (lansman öncesi).** Google Cloud Console'da OAuth client açılması
ve consent screen'in PUBLISH edilmesi; ayrıntılar `backend/.env.example`
içindeki blokta.

---

## ÜK-9 — Soyad public yüzeylerde görünmez

**Karar.** Herkese açık yüzeylerde yalnız **ad** görünür. Yasal ad
(`full_name`) yerinde durur ve oturum içi akışlarda kullanılmaya devam eder.

**Kullanıcının sorusu.** *"soyisim göstermesek mi acaba."*

**Sektör.** Superprof ve Tutor Hunt yalnız adı gösteriyor, Wyzant ad + soyad
baş harfini, italki ise eğitmenlere tam yasal adlarını kullanmamalarını
öneriyor. Biçim olarak "yalnız ad" seçildi.

**Engel çıkmadı.** KVKK aydınlatma metni tam adı eğitmen profil veri
kategorisinde saymıyor ve "arayüzde yalnız son dört hane" (TCKN) zaten emsal
bir maskeleme deseni. Mesafeli satış sözleşmesi taraf tanımını *tip* düzeyinde
yapıyor. Ödeme/KYC/fatura `full_name`'i veritabanı ve iyzico katmanında
tüketiyor, ekrandan bağımsız. Karar ayrıca deponun yerleşik
anti-disintermediation felsefesiyle (`core/moderation.py`) aynı yönde: soyad +
ilçe, birini platform dışında bulmaya yeter.

### Kapsam bir GİZLEME değil, AYRIM

| Nerede | Ne görünür |
|---|---|
| Public: kart, profil, SEO/JSON-LD, slug, sitemap, yorum yazarı | yalnız ad |
| Oturum içi: rezervasyon, mesaj, sipariş, canlı ders | yasal ad |
| Admin/operatör panelleri, hesabın kendi ayarları | yasal ad |
| Ödeme, KYC (iyzico alt üye), fatura | yasal ad |

### Kesme SUNUCUDA yapılır

Arayüzde `split(" ")[0]` yazmak kozmetik kalır ve bu depoda tam olarak öyle
olmuştu: `TutorCard` yalnız adı basıyordu ama aynı bileşenin `alt` metni ve
avatar URL'i tam adı taşıyor, kartın gittiği adres `/egitmenler/ahmet-yilmaz-42`
oluyor, `sitemap_service` o slug'ı doğrudan Google'a veriyordu. Soyad ekranda
gizliydi ama her yerdeydi.

Bu yüzden `full_name` **public şemadan çıkarıldı** (`TutorSearchOut`) ve yerine
model property'si `display_name` kondu (`models/mixins.py::NameMixin`).
Slug, sitemap, bot meta (OG/Twitter) ve arama sorgusu da ada indirildi.

**Arama neden değişti:** soyadla eşleşme açık bırakılsaydı soyad gizli ama
SORGULANABİLİR kalırdı — bir soyadı yazıp sonuç dönüp dönmediğine bakarak o
kişinin platformda olup olmadığı öğrenilebilirdi.

**Yol üstünde kapanan sızıntı:** avatarı olmayan eğitmenin tam adı her kart
render'ında `ui-avatars.com`'a query parametresi olarak gidiyordu. Ortak
`Avatar` bileşeni baş harfi zaten YERELDE üretiyor; kart artık dış servise
istek atmıyor.

### Rozet bağı korundu

`docs/kimlik-ve-diploma-dogrulama-plani.md` §A6 şart koşuyor: *"görünen ad
olabilir ama kimlik iddiası taşımaz; 'Kimliği Doğrulanmış' rozeti yasal ada
bağlanır."* Çelişki yok: `IdentityVerifiedBadge` `payout_status`a (iyzico
MERNIS/IBAN kontrolü) bakıyor, gösterilen ada değil. Rozet kimliğin
DOĞRULANDIĞINI söyler, kimliğin ne olduğunu değil.

### Açık kalanlar (bilinçli)

- `lib/routes.ts::messageWith` tam adı URL query string'ine koyuyor
  (`/mesajlar?to=42&name=…`) — public değil ama gereksiz.
- `demand_service.py` öğrencinin tam adını, hiçbir rezervasyon olmadan
  eğitmenlerin talep listesinde gösteriyor. Talepler şu an dondurulmuş (ÜK-3);
  açılmadan önce ele alınmalı.

---

## İlgili belgeler

- `docs/tasarim-dili.md` — görsel kuralların kendisi (ÜK-1)
- `docs/egitmen-alici-sozlesme.md` — eğitmenin alıcı kimliği (ÜK-5, ÜK-6)
- `docs/ilan-ekrani-bulgular.md` — ilan düzenleme ekranı keşfi
- `docs/ip-b1-rapor.md` — `Ç-n` açık sorularının sahibi
