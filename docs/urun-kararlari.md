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

---

## ÜK-1 — Aksan rengi turuncu; dolgu parlak, yazı koyu

**Karar.** Marka aksanı `#F0850F` (7 Eyl 2026'da `#E37200`'den açıldı).
Turuncu **dolgu** olarak parlak kullanılır,
**yazı** olarak asla; açık zeminde marka yazısı ayrı bir token taşır
(`--marka-metin`, `#96430A`).

**Gerekçe.** İlk sürüm turuncunun üstüne beyaz yazı koyuyordu. Beyaz metnin
AA eşiğini (4,5) geçmesi için turuncuyu ışıklılık ~0,18'e kadar karartmak
gerekiyor; o noktada turuncu kahverengi okunuyor. Kullanıcının tarifi: *"bok
rengi gibi"*. Renk seçimi elle hex denemekle değil, adlandırılmış paletlerin
(Tailwind orange/amber, Radix, Material) görsel karşılaştırmasıyla yapıldı.

**Ölçülen bedel.** Dolgu üstündeki yazı 6,85 · marka yazısı 6,77 · bilgi
rozeti 6,24 · uyarı çipi 8,15 · odak halkası 4,50 · kenarlık 3,58.

**7 Eyl 2026 · açıkça kabul edilen bedel.** Kullanıcı rengi daha açık istedi.
Dolgunun beyaz zemine karşı kontrastı 3,15 → **2,60**; yani SC 1.4.11'in
"kontrol sınırı görünür olsun" eşiği (3,0) bilerek terk edildi ve düğme beyaz
zeminde kenarını yitirdi. Alternatifler ölçülüp tükendi: bir adım açmak zaten
2,95, ton kaydırmak (28°-44° tarandı) eşiği koruyan daha parlak bir renk
üretmiyor, dolguya kenarlık eklemek 336 çağrı yerini etkiliyor. **Metin
okunurluğu (4,5) tartışmaya açık değil ve korundu.**

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

## İlgili belgeler

- `docs/tasarim-dili.md` — görsel kuralların kendisi (ÜK-1)
- `docs/egitmen-alici-sozlesme.md` — eğitmenin alıcı kimliği (ÜK-5, ÜK-6)
- `docs/ilan-ekrani-bulgular.md` — ilan düzenleme ekranı keşfi
- `docs/ip-b1-rapor.md` — `Ç-n` açık sorularının sahibi
