# iyzico Pazaryeri — Netleşmesi Gereken Sorular (PK-2 ön koşulu)

> **Durum:** PK-2 (Pazaryeri entegrasyonu) **başlamadı ve bu cevaplar gelmeden
> başlamayacak.** Bu belge varsayım içermez; her madde "cevaba göre kodda ne
> değişir" bilgisiyle birlikte durur ki cevaplar geldiğinde plan doğrudan
> yazılabilsin.

## Bizim tarafın özeti (iyzico'ya verilecek bağlam)

- **İşletme:** şahıs şirketi (Adana), Temmuz 2026'da kuruldu; unvan + VKN hazır,
  MERSİS onay sürecinde.
- **Mevcut entegrasyon:** iyzico **Checkout Form** tam çalışıyor (SDK'sız, IYZWSv2
  imzalı, 3DS + sunucu-doğrulamalı callback). Sandbox'ta uçtan uca doğrulandı.
- **Üç ödeme yüzeyi:** özel ders, kütüphane deneme sınavı bileti, kütüphane
  saatlik çalışma alanı rezervasyonu. Ayrıca kitap satışı (bu **kendi malımız**,
  pazaryeri değil).
- **Para akışı ihtiyacı:** ders/bilet/rezervasyon ücreti hizmet gerçekleşene
  kadar **bloke** kalmalı; gerçekleştiğinde **%10 komisyon** platformda kalıp
  kalan tutar hizmet sağlayıcıya (eğitmen / kütüphane) geçmeli. İptalde tam ya
  da **kısmi** iade.
- **Hacim:** lansman öncesi. Beklenen ilk aylar: düşük hacim, ders başına
  tipik 200–600 TL.
- **Bugünkü durum:** parayı kendi hesabımızda toplayıp **elle havale** etme yolu
  koddan **tamamen kapatıldı**; alt üye işyeri modeli devreye girmeden pazaryeri
  ödemesi alınmıyor (ürün kolu bazlı kapılar, PK-1).

---

## Sorular

### 1. Hesabımıza Pazaryeri ürünü açılacak mı?
Açılacaksa: hangi evraklar, ne kadar sürede, hangi onay adımları? Şahıs şirketi
için ek bir kısıt var mı? Reddedilme sebepleri neler olabilir?

**Kodda ne değişir:** Cevap "hayır/şartlı" ise PK-2 hiç yazılmaz ve pazaryeri
kolları kapalı kalır — ders/bilet satışı lansmana giremez. "Evet" ise
`store_payments_live` dışındaki kolların açılma takvimi buna bağlanır.

---

### 2. Bireysel eğitmen hangi `subMerchantType` ile kaydedilecek?
Eğitmenlerin çoğu **vergi mükellefi olmayan bireysel kişiler** (üniversite
öğrencisi / öğretmen). Kütüphaneler ise genelde işletme.

- Bireysel kişi için `PERSONAL` mi, başka bir tip mi?
- Vergi mükellefi olmayan bireye alt üye işyeri açılabiliyor mu, yoksa
  mükellefiyet şart mı?
- Kütüphaneler için ayrı tip mi (`LIMITED_OR_JOINT_STOCK_COMPANY` /
  `PRIVATE_COMPANY`)?

**Kodda ne değişir:** `SubMerchantInfo` alanları ve onboarding formunun zorunlu
alanları tipe göre değişir. "Mükellefiyet şart" cevabı **ürün kararını** da
etkiler (eğitmen arzının bir kısmı platforma giremez) ve vergi/stopaj kurgusuyla
(SMMM konusu) birleşir.

---

### 3. Eğitmenden hangi kimlik, adres, IBAN ve vergi bilgileri istenecek?
Tip başına **zorunlu / opsiyonel** alan listesi:
- Kimlik: TCKN? Ad-soyad hesap adıyla birebir eşleşmek zorunda mı?
- Adres: serbest metin yeterli mi, il/ilçe ayrı mı?
- IBAN: kimin adına olmalı (TCKN sahibiyle aynı kişi zorunlu mu)?
- Vergi: vergi numarası / vergi dairesi zorunlu mu (mükellef olmayanda ne olur)?
- MERNIS / IBAN / MASAK kontrollerini **iyzico mu** yapıyor, sonucu bize nasıl
  dönüyor (senkron mu, webhook mu)?

**Kodda ne değişir:** Onboarding formu, `SubMerchantInfo` şeması, KVKK aydınlatma
metni (hangi veriyi neden topluyoruz) ve `PayoutMixin` alanları. Şu an TCKN
şifreli tutuluyor ve yalnız son 4 hanesi saklanıyor — bu yeterli mi, yoksa
tamamını saklamamız gerekiyor mu?

---

### 4. `approve` / `disapprove` süreci hesabımızda aktif mi?
- Ödeme sonrası tutar **otomatik bloke** mi kalıyor, yoksa blokeyi biz mi
  ayarlıyoruz (`installment`/`hold` parametresi)?
- Bloke süresi üst sınırı var mı (kaç gün sonra otomatik serbest bırakılır)?
- `approve` **kısmi** yapılabiliyor mu, yoksa yalnız tam mı?
- `disapprove` sonrası tutar otomatik iade mi ediliyor, ayrı `refund` gerekiyor mu?

**Kodda ne değişir:** Escrow durum makinesinin (`services/escrow.py`) HELD→RELEASED
ve HELD→REFUNDING geçişlerinin hangi sağlayıcı çağrısına bağlanacağı. Bloke süresi
üst sınırı varsa **uyuşmazlık/itiraz penceresi** (PK-4: yüz yüze derste 72 saat)
o sınırın altında kalmak zorunda — aksi halde dispute sürerken para serbest kalır.

---

### 5. Kısmi iadede `subMerchantPrice` güncelleme sırası nasıl olmalı?
Somut senaryo: 400 TL ders, pencere içinde iptal → 200 TL öğrenciye iade,
kalan 200 TL'nin **%10'u platform komisyonu**, 180 TL eğitmene.

- Doğru sıra hangisi: **(a)** `updateSubMerchantPrice` → `refund` → `approve`,
  **(b)** `refund` → `updateSubMerchantPrice` → `approve`, **(c)** başka?
- `approve` sonrası hakediş **güncellenebiliyor mu**, yoksa kilitleniyor mu?
- Kısmi `refund` sonrası `subMerchantPrice` **otomatik yeniden hesaplanıyor mu**,
  yoksa biz mi güncellemek zorundayız?
- Ara adım başarısız olursa (ör. `updateSubMerchantPrice` geçti, `refund` düştü)
  işlem hangi durumda kalır ve nasıl toparlanır?

**Kodda ne değişir:** Bu, PK-2'nin **en riskli** kısmı. Planda (a) sırası
"sandbox'ta kanıtlanacak varsayım" olarak işaretlendi ve tek yerde
(`services/split_settlement.py`) tutulacak. Cevap farklıysa sıra ve toparlama
tablosu tümüyle değişir.

---

### 6. Settlement / mutabakat bilgisi hangi kanaldan gelecek?
- **API** mi (hangi uç, hangi alanlar: brüt, iyzico komisyonu, net, alt üye
  hakedişi, `paymentTransactionId` eşlemesi)?
- **Panel CSV** mi (indirilebilir dosya; sütun şeması nedir)?
- **SFTP** mi (adres, dosya adı deseni, frekans)?
- Hangi periyotta üretiliyor (günlük/haftalık) ve **ne zaman kesinleşiyor**?
- Bir işlemi `paymentTransactionId` ile mutabakat satırına **birebir**
  eşleyebiliyor muyuz?

**Kodda ne değişir:** PK-2'de `SettlementSource` adaptörü **bu cevaba göre**
seçilecek. Planda PaymentProvider'a hayalî bir HTTP metodu konmaması bilinçli
karardı; kanal netleşene kadar yalnız "panelden indirilen dosyayı admin yükler"
implementasyonu yazılabilir. **Bu soru cevaplanmadan PK-2'ye başlanmıyor.**

---

### 7. Test ve canlı ortam anahtarları ne zaman verilecek?
- Pazaryeri özelliği **sandbox'ta** ayrı bir anahtar mı gerektiriyor, mevcut
  sandbox anahtarlarıyla mı çalışıyor?
- Canlı anahtarlar hangi onay adımından sonra veriliyor?
- Sandbox ile canlı arasında **davranış farkı** var mı (özellikle bloke/approve
  ve kısmi iade)?

**Kodda ne değişir:** Uçtan uca doğrulamanın (§EK-6 senaryoları) ne zaman
koşulabileceği ve `tutor_marketplace_payments_live` bayrağının açılma takvimi.
Davranış farkı varsa sandbox'ta yeşil olan bir akış canlıda kırılabilir — bunu
önceden bilmemiz gerekir.

---

### 8. Şahıs şirketi bu pazaryeri modelinde **ana üye işyeri** olabilir mi?
- Ana üye işyeri (marketplace merchant) için şirket türü kısıtı var mı
  (A.Ş./Ltd. şartı)?
- Şahıs şirketi olarak alt üye işyeri açıp hakediş dağıtabiliyor muyuz?
- İleride A.Ş./Ltd.'ye dönüşürsek **yeniden onboarding** gerekiyor mu (alt üye
  kayıtları taşınıyor mu)?

**Kodda ne değişir:** Cevap "hayır" ise PK-2'nin tamamı **şirket türü
değişikliğine** bağlanır ve pazaryeri kolları lansmana giremez; yol haritasının
sırası değişir. "Evet ama dönüşümde yeniden onboarding" ise `sub_merchant_key`
alanının taşınabilirliği ve payout geçmişinin sürekliliği tasarıma girer.

---

## Cevaplar geldiğinde

1. Cevaplar bu belgeye işlenir (soru başlıklarının altına, tarih + kaynak kişi).
2. **Ayrıca ödeme hukuku avukatının yazılı görüşü** beklenir (6493 nitelendirmesi
   — plan §14b-1). İki cevap birlikte gelmeden PK-2 planı yazılmaz.
3. PK-2 planı bu cevaplara göre hazırlanır; onaydan sonra kod yazılır.

## İlgili kayıtlar

- Yol haritası: `C:\Users\kiyar\.claude\plans\mevcut-da-t-m-y-netimi-aray-z-n-tingly-quail.md` (§EK-1 PK-2 tasarımı, §14b dış teyit listesi)
- PK-1 dağıtım kontrol listesi: `docs/pk1-deployment-checklist.md`
- Doğrulanmış PK-1 noktası: etiket `pk1-verified-8c87321` (origin'de)
