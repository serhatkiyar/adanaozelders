// Yasal sayfa içerikleri — TEK kaynak. Saf veri (JSX yok) → Vitest'lenebilir.
// Sayfa düzeni `pages/LegalPage.tsx`'tedir; metin değişiklikleri yalnız burada yapılır.
//
// NOT: Bu metinler lansman öncesi bir avukat tarafından gözden geçirilmelidir.
import { SITE_NAME } from "@/lib/seo";

/**
 * Platform işletmecisi kimlik/iletişim sabitleri (yasal metinlerde geçer).
 *
 * İşletme **şahıs şirketi** olarak kuruldu ve vergi kaydı aktif (29 Tem 2026).
 * Önceki plan limited şirketti; metinlerde bir süre var olmayan bir tüzel kişi
 * (`… Ltd. Şti.`) satıcı ve veri sorumlusu olarak görünüyordu — düzeltildi.
 *
 * TODO(lansman): boş alanlar Mesafeli Sözleşmeler Yönetmeliği m.5 uyarınca
 * ZORUNLUDUR, lansmandan önce doldurulmalı:
 *   - `address`: vergi kaydındaki AÇIK adres (kayıt hangi adresteyse o; farklı
 *     bir adres göstermek yanlış beyandır — adres değişecekse önce vergi
 *     dairesine bildirilmeli)
 *   - `phone`: erişilebilir telefon (mesafeli satışta zorunlu)
 *   - `mersis`: ticaret sicili tescili ONAY SÜRECİNDE; numara gelince yazılacak
 *   - `taxOffice`: vergi dairesi adı
 * `kep` şahıs şirketi için ZORUNLU DEĞİLDİR (sermaye şirketlerine zorunlu);
 * alınırsa `@…kep.tr` uzantılı gerçek KEP adresi yazılmalı — normal e-posta değil.
 */
export const OPERATOR = {
  name: SITE_NAME,
  entity: "Serhat Kıyar Çukurova Dijital Pazarlama ve Yazılım",
  address: "Adana, Türkiye",
  email: "bilgi@adanaozelders.com.tr",
  phone: "",
  taxNumber: "5590521517",
  taxOffice: "",
  mersis: "",
  kep: "",
} as const;

/**
 * Satıcı/aracı hizmet sağlayıcı kimlik satırı — yalnız DOLU alanları yazar.
 *
 * Mesafeli satış sözleşmesinde bu bilgiler zorunludur; eksik olanı boş
 * göstermek yerine hiç yazmıyoruz ki metin "MERSİS: —" gibi yarım ifadelerle
 * yayımlanmasın.
 */
export function operatorIdentity(): string {
  const parts = [
    `Unvan: ${OPERATOR.entity}`,
    OPERATOR.address && `Adres: ${OPERATOR.address}`,
    OPERATOR.mersis && `MERSİS: ${OPERATOR.mersis}`,
    OPERATOR.taxNumber &&
      `Vergi No: ${OPERATOR.taxNumber}${OPERATOR.taxOffice ? ` (${OPERATOR.taxOffice})` : ""}`,
    OPERATOR.phone && `Telefon: ${OPERATOR.phone}`,
    `E-posta: ${OPERATOR.email}`,
    OPERATOR.kep && `KEP: ${OPERATOR.kep}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] };

export interface LegalSection {
  /** URL fragment'ı (anchor) — sayfa içi gezinmede kullanılır. */
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

export type LegalDocId =
  | "kvkk"
  | "privacy"
  | "terms"
  | "distance-sales"
  | "refund"
  | "cookies";

export interface LegalDoc {
  id: LegalDocId;
  title: string;
  /** SEO meta açıklaması (~160 karakter). */
  description: string;
  /** "YYYY-MM-DD" — sayfada "Son güncelleme" olarak gösterilir. */
  updatedAt: string;
  sections: LegalSection[];
}

const p = (text: string): LegalBlock => ({ type: "p", text });
const list = (...items: string[]): LegalBlock => ({ type: "list", items });

/* ─────────────────────────── KVKK Aydınlatma Metni ─────────────────────────── */

const KVKK: LegalDoc = {
  id: "kvkk",
  title: "KVKK Aydınlatma Metni",
  description:
    "6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında Adana Özel Ders platformunda işlenen kişisel verilere ilişkin aydınlatma metni.",
  updatedAt: "2026-06-11",
  sections: [
    {
      id: "veri-sorumlusu",
      heading: "1. Veri Sorumlusu",
      blocks: [
        p(
          `Bu aydınlatma metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca, ${OPERATOR.name} platformunu (\"Platform\") işleten ${OPERATOR.entity} (\"İşletme\") tarafından veri sorumlusu sıfatıyla hazırlanmıştır. İletişim: ${OPERATOR.email} — ${OPERATOR.address}.`
        ),
      ],
    },
    {
      id: "islenen-veriler",
      heading: "2. İşlenen Kişisel Veri Kategorileri",
      blocks: [
        p("Platforma üye olduğunuzda ve Platformu kullandığınızda aşağıdaki kişisel veri kategorileri işlenir:"),
        list(
          "Kimlik bilgileri: ad, soyad, kullanıcı adı, doğum tarihi, cinsiyet (isteğe bağlı).",
          "İletişim bilgileri: e-posta adresi.",
          "Eğitmen profil bilgileri (eğitmenler için): eğitim geçmişi, verilen dersler, saatlik ücret, biyografi, profil fotoğrafı, ders verilen konum.",
          "Konum bilgileri: \"yakınımda\" araması yaptığınızda tarayıcınızın paylaştığı yaklaşık konum (sunucuda saklanmaz, yalnız arama için kullanılır); eğitmen/kütüphane konumları (ilan amaçlı, ilgili kullanıcının kendi girdisidir).",
          "Eğitim ve kullanım verileri: ders rezervasyonları, deneme sınavı kayıtları ve sonuçları, çalışma alanı rezervasyonları, soru-cevaplar, değerlendirme ve yorumlar, çalışma araçları verileri (görevler, kelime kartları, alışkanlıklar).",
          "Mesajlaşma içerikleri: Platform üzerinden eğitmen-öğrenci yazışmaları (hizmet güvenliği ve uyuşmazlık çözümü amacıyla saklanır).",
          "Finansal işlem bilgileri: ödeme tutarı, ödeme durumu ve ödeme kuruluşu işlem referansı. Kart bilgileriniz Platform tarafından GÖRÜLMEZ ve SAKLANMAZ; ödeme sayfası doğrudan iyzico Ödeme Hizmetleri A.Ş. tarafından sunulur.",
          "Kimlik ve ödeme doğrulama verileri (yalnızca ödeme alan eğitmen ve kütüphane sorumluları için): T.C. Kimlik Numarası, IBAN ve diploma/denklik/öğrenci belgesi ile e-Devlet doğrulama (barkod) kodu. T.C. Kimlik Numarası veritabanında şifreli (kriptolu) saklanır; arayüzde yalnızca son dört hanesi gösterilir. Ödeme alıcısı hesabının kurulması için ad-soyad, T.C. Kimlik Numarası ve IBAN bilgisi ödeme kuruluşuna (iyzico) aktarılır.",
          "İşlem güvenliği bilgileri: IP adresi, oturum kayıtları, hata/erişim logları."
        ),
      ],
    },
    {
      id: "amaclar",
      heading: "3. İşleme Amaçları",
      blocks: [
        p("Kişisel verileriniz aşağıdaki amaçlarla işlenir:"),
        list(
          "Üyelik sözleşmesinin kurulması ve ifası (hesap oluşturma, kimlik doğrulama, oturum yönetimi).",
          "Eğitmen-öğrenci eşleştirme, rezervasyon, deneme sınavı ve çalışma alanı hizmetlerinin sunulması.",
          "Ödeme ve emanet (escrow) süreçlerinin yürütülmesi, komisyon hesaplanması, mali yükümlülüklerin yerine getirilmesi.",
          "Para alan tarafların (eğitmen, kütüphane) kimlik ve diploma/öğrenim belgesi doğrulaması ile ödeme alıcısı (alt üye işyeri) hesabının ödeme kuruluşu nezdinde kurulması.",
          "Platform güvenliğinin sağlanması, kötüye kullanımın önlenmesi ve uyuşmazlıkların çözümü.",
          "Yasal yükümlülüklerin yerine getirilmesi ve yetkili kurum taleplerinin karşılanması.",
          "Hizmet kalitesinin ölçülmesi ve geliştirilmesi."
        ),
      ],
    },
    {
      id: "hukuki-sebepler",
      heading: "4. Hukuki Sebepler",
      blocks: [
        p(
          "Verileriniz KVKK m.5/2 uyarınca; (c) bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması, (ç) veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi, (e) bir hakkın tesisi, kullanılması veya korunması ve (f) temel hak ve özgürlüklerinize zarar vermemek kaydıyla meşru menfaat hukuki sebeplerine dayanılarak işlenir. Bu sebeplerin kapsamadığı haller için açık rızanız alınır."
        ),
      ],
    },
    {
      id: "aktarim",
      heading: "5. Verilerin Aktarılması",
      blocks: [
        p("Kişisel verileriniz, yalnızca hizmetin gerektirdiği ölçüde aşağıdaki alıcı gruplarına aktarılabilir:"),
        list(
          "Ödeme kuruluşu: iyzico Ödeme Hizmetleri A.Ş. — ödeme işlemleri ve 6493 sayılı Kanun kapsamındaki yükümlülükler için; ayrıca ödeme alan eğitmen/kütüphane için alt üye işyeri (sub-merchant) kurulumu amacıyla ad-soyad, T.C. Kimlik Numarası ve IBAN bilgisi aktarılır. Kimlik doğrulaması (MERNIS/IBAN kontrolü) mevzuat gereği ödeme kuruluşunca yapılır.",
          "Barındırma ve bulut altyapı sağlayıcıları (sunucu, veritabanı, dosya depolama).",
          "E-posta gönderim altyapısı (doğrulama ve bilgilendirme e-postaları).",
          "Hizmetin doğası gereği diğer kullanıcılar: eğitmen profiliniz öğrencilere; rezervasyon yaptığınızda ad-soyadınız ilgili eğitmene/kütüphaneye gösterilir.",
          "Yetkili kamu kurum ve kuruluşları (yasal talep hâlinde)."
        ),
        p("Verileriniz ticari amaçla üçüncü kişilere satılmaz veya kiralanmaz."),
      ],
    },
    {
      id: "saklama",
      heading: "6. Saklama Süreleri",
      blocks: [
        p(
          "Verileriniz üyeliğiniz süresince ve ilgili mevzuatta öngörülen zamanaşımı süreleri boyunca saklanır. Hesabınızı sildiğinizde verileriniz, yasal saklama yükümlülüğü bulunanlar (ör. finansal işlem kayıtları) hariç olmak üzere silinir, yok edilir veya anonim hâle getirilir."
        ),
      ],
    },
    {
      id: "haklar",
      heading: "7. KVKK m.11 Kapsamındaki Haklarınız",
      blocks: [
        p("KVKK'nın 11. maddesi uyarınca veri sorumlusuna başvurarak:"),
        list(
          "Kişisel verilerinizin işlenip işlenmediğini öğrenme,",
          "İşlenmişse buna ilişkin bilgi talep etme,",
          "İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,",
          "Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,",
          "Eksik veya yanlış işlenmişse düzeltilmesini isteme,",
          "KVKK m.7'deki şartlar çerçevesinde silinmesini veya yok edilmesini isteme,",
          "Düzeltme/silme işlemlerinin aktarılan üçüncü kişilere bildirilmesini isteme,",
          "Münhasıran otomatik sistemlerle analiz sonucu aleyhinize bir sonucun ortaya çıkmasına itiraz etme,",
          "Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme haklarına sahipsiniz."
        ),
      ],
    },
    {
      id: "basvuru",
      heading: "8. Başvuru Yöntemi",
      blocks: [
        p(
          `Haklarınıza ilişkin taleplerinizi ${OPERATOR.email} adresine, kimliğinizi tevsik edici bilgilerle birlikte yazılı olarak iletebilirsiniz. Başvurunuz en geç 30 gün içinde ücretsiz olarak sonuçlandırılır. Başvurunuzun reddedilmesi hâlinde Kişisel Verileri Koruma Kurulu'na şikâyette bulunma hakkınız saklıdır.`
        ),
      ],
    },
  ],
};

/* ─────────────────────────── Gizlilik Politikası ─────────────────────────── */

const PRIVACY: LegalDoc = {
  id: "privacy",
  title: "Gizlilik Politikası",
  description:
    "Adana Özel Ders'in kişisel verilerinizi nasıl topladığını, kullandığını, koruduğunu ve kimlerle paylaştığını açıklayan gizlilik politikası.",
  updatedAt: "2026-06-11",
  sections: [
    {
      id: "kapsam",
      heading: "1. Kapsam",
      blocks: [
        p(
          `Bu politika, ${OPERATOR.name} platformunu kullanırken paylaştığınız ve kullanımınız sırasında oluşan bilgilerin gizliliğine ilişkin esasları açıklar. KVKK kapsamındaki ayrıntılı bilgilendirme için KVKK Aydınlatma Metni'ni inceleyiniz.`
        ),
      ],
    },
    {
      id: "toplanan-bilgiler",
      heading: "2. Topladığımız Bilgiler",
      blocks: [
        list(
          "Doğrudan sizden: kayıt bilgileri, profil içerikleri, rezervasyon ve ödeme talepleri, mesajlar, yorum ve değerlendirmeler.",
          "Otomatik olarak: IP adresi, cihaz/tarayıcı bilgisi, erişim logları ve hata kayıtları.",
          "İzninizle: \"yakınımda\" araması için anlık konumunuz (sunucuda saklanmaz)."
        ),
      ],
    },
    {
      id: "kullanim",
      heading: "3. Bilgilerin Kullanımı",
      blocks: [
        p(
          "Bilgileriniz; hesabınızı yönetmek, ders/oturum/rezervasyon süreçlerini yürütmek, ödemeleri gerçekleştirmek, sizinle iletişim kurmak (doğrulama, bildirim ve işlem e-postaları), Platform güvenliğini sağlamak ve hizmeti geliştirmek için kullanılır. Pazarlama amaçlı ticari elektronik ileti, yalnızca ayrıca onay vermeniz hâlinde gönderilir."
        ),
      ],
    },
    {
      id: "paylasim",
      heading: "4. Üçüncü Taraflarla Paylaşım",
      blocks: [
        p(
          "Ödemeler iyzico altyapısıyla gerçekleştirilir; kart bilgileriniz Platforma hiç ulaşmaz. Barındırma, dosya depolama ve e-posta altyapısı sağlayıcıları yalnızca hizmetin gerektirdiği veriye, sözleşmesel gizlilik yükümlülükleri altında erişir. Canlı ders (görüntülü görüşme) ve harita gibi gömülü içerikler ilgili üçüncü taraf servislerden yüklenir; bu servisler kendi gizlilik politikalarına tabidir."
        ),
      ],
    },
    {
      id: "guvenlik",
      heading: "5. Veri Güvenliği",
      blocks: [
        list(
          "Parolalar geri döndürülemez şekilde özetlenerek (hash) saklanır; düz metin parola tutulmaz.",
          "Oturumlar kısa ömürlü erişim jetonları ve sunucu tarafında iptal edilebilen yenileme jetonlarıyla yönetilir.",
          "İletişim HTTPS üzerinden şifrelenir; kritik yönetici işlemleri denetim kaydına (audit log) yazılır.",
          "Erişim, görev gereği bilmesi gerekenlerle sınırlıdır."
        ),
      ],
    },
    {
      id: "cocuklar",
      heading: "6. Çocukların Gizliliği",
      blocks: [
        p(
          "Platform, sınavlara hazırlanan öğrencilere hizmet verir. 18 yaşından küçük kullanıcıların Platformu veli/vasi bilgisi ve onayı dâhilinde kullanması gerekir. Veli/vasiler, çocuklarına ait hesap ve veriler hakkında bilgi ve silme talebiyle bize başvurabilir."
        ),
      ],
    },
    {
      id: "degisiklikler",
      heading: "7. Değişiklikler",
      blocks: [
        p(
          "Bu politika gerektiğinde güncellenebilir. Önemli değişiklikler Platform üzerinden duyurulur; güncel sürüm her zaman bu sayfada yayımlanır."
        ),
      ],
    },
    {
      id: "iletisim",
      heading: "8. İletişim",
      blocks: [p(`Gizlilikle ilgili sorularınız için: ${OPERATOR.email}`)],
    },
  ],
};

/* ─────────────────────────── Kullanım Koşulları ─────────────────────────── */

const TERMS: LegalDoc = {
  id: "terms",
  title: "Kullanım Koşulları",
  description:
    "Adana Özel Ders platformunun üyelik, rezervasyon, ödeme ve kullanım esaslarını düzenleyen kullanım koşulları.",
  updatedAt: "2026-06-11",
  sections: [
    {
      id: "kabul",
      heading: "1. Taraflar ve Kabul",
      blocks: [
        p(
          `Bu Kullanım Koşulları ("Koşullar"), ${OPERATOR.entity} tarafından işletilen ${OPERATOR.name} platformu ile Platforma üye olan veya Platformu ziyaret eden kullanıcılar arasında geçerlidir. Üyelik oluşturarak veya Platformu kullanarak bu Koşulları kabul etmiş sayılırsınız.`
        ),
      ],
    },
    {
      id: "platformun-rolu",
      heading: "2. Platformun Rolü",
      blocks: [
        p(
          "Platform, 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun kapsamında ARACI HİZMET SAĞLAYICIDIR: özel ders hizmeti eğitmenler, deneme sınavı oturumu ve çalışma alanı hizmeti kütüphaneler/etüt merkezleri tarafından sunulur. Platform; eşleştirme, rezervasyon, mesajlaşma ve güvenli ödeme (emanet/escrow) altyapısı sağlar; ders içeriğinin ve hizmetin ifasının tarafı değildir. Eğitmen ve kurum profillerindeki bilgilerin doğruluğu ilgili hizmet sağlayıcının sorumluluğundadır; Platform makul bir ön inceleme (onay) süreci uygular ancak garanti vermez."
        ),
      ],
    },
    {
      id: "uyelik",
      heading: "3. Üyelik",
      blocks: [
        list(
          "Kayıt sırasında doğru, güncel ve eksiksiz bilgi vermekle yükümlüsünüz.",
          "Hesap bilgilerinizin gizliliğinden ve hesabınız üzerinden yapılan işlemlerden siz sorumlusunuz.",
          "18 yaşından küçükler Platformu veli/vasi onayı ile kullanabilir.",
          "Bir kişi adına birden fazla hesap açılması ve hesabın üçüncü kişilere devri yasaktır."
        ),
      ],
    },
    {
      id: "egitmenler",
      heading: "4. Eğitmenlere İlişkin Esaslar",
      blocks: [
        list(
          "Eğitmen profilleri yayına alınmadan önce Platform onayından geçer; Platform başvuruyu gerekçe göstermeksizin reddedebilir veya yayını askıya alabilir.",
          "Eğitmen; profilinde beyan ettiği eğitim, deneyim ve ücret bilgilerinin doğruluğundan sorumludur.",
          "Eğitmen, Platform üzerinden elde ettiği kazanca ilişkin vergi ve diğer yasal yükümlülüklerini kendisi yerine getirir.",
          "Ders ücreti, eğitmenin ilan ettiği saatlik ücret esas alınarak Platform tarafından hesaplanır."
        ),
      ],
    },
    {
      id: "rezervasyon-ve-odeme",
      heading: "5. Rezervasyon, Ödeme ve Emanet (Escrow)",
      blocks: [
        p(
          "Rezervasyon eğitmen tarafından kabul edildiğinde öğrenciden ödeme alınır ve tutar Platform nezdinde emanette tutulur. Ders tamamlandığında platform hizmet komisyonu düşülerek kalan tutar eğitmene aktarılır; ders gerçekleşmeden iptal edilirse ödeme iade edilir. Ödemeler iyzico altyapısıyla alınır; tüm fiyatlar sunucu tarafında hesaplanır. Ayrıntılar İptal ve İade Politikası ile Mesafeli Satış Sözleşmesi'nde düzenlenmiştir."
        ),
      ],
    },
    {
      id: "kutuphane-hizmetleri",
      heading: "6. Deneme Sınavı Oturumları ve Çalışma Alanı",
      blocks: [
        p(
          "Kütüphane/etüt merkezlerinin açtığı ücretli deneme sınavı oturumlarına kayıt ve saatlik çalışma alanı rezervasyonları da emanet modeliyle çalışır: ödeme önce emanete alınır, hizmet günü QR kod doğrulamasıyla katılım teyit edildiğinde kuruma aktarılır. Ödeme yapıldıktan sonra, oturum/rezervasyon başlangıcına 24 SAATTEN FAZLA süre varsa kayıt iptal edilebilir ve ücretin tamamı iade edilir. Bu süreden sonra hizmet belirli bir tarihte ifa edileceğinden iptal edilemez ve KATILIM SAĞLANMAMASI (no-show) hâlinde ücret iadesi yapılmaz. Oturumun kurum veya Platform tarafından iptali hâlinde ücretin tamamı iade edilir."
        ),
      ],
    },
    {
      id: "yasakli-davranislar",
      heading: "7. Yasaklı Davranışlar",
      blocks: [
        list(
          "Platform üzerinden tanışılan kullanıcılarla ödemeyi Platform dışına taşımak amacıyla iletişim bilgisi paylaşmak veya talep etmek (komisyondan kaçınma).",
          "Sahte profil, yanıltıcı ilan, başkası adına hesap veya yapay değerlendirme/yorum oluşturmak.",
          "Hakaret, taciz, ayrımcılık içeren veya hukuka aykırı içerik paylaşmak.",
          "Platformun güvenliğini test etmeye çalışmak, tersine mühendislik yapmak, otomatik veri kazımak (scraping).",
          "Başka kullanıcıların kişisel verilerini izinsiz toplamak veya paylaşmak."
        ),
        p(
          "İhlal hâlinde Platform; içeriği kaldırma, hesabı askıya alma veya kalıcı olarak kapatma ve gerektiğinde yasal yollara başvurma hakkını saklı tutar."
        ),
      ],
    },
    {
      id: "fikri-mulkiyet",
      heading: "8. Fikri Mülkiyet",
      blocks: [
        p(
          "Platformun yazılımı, tasarımı, markası ve içeriği İşletmeye aittir; izinsiz kopyalanamaz ve çoğaltılamaz. Kullanıcıların Platforma yüklediği içerikler (profil, kaynak, yorum) üzerindeki haklar kullanıcıda kalır; kullanıcı, bu içeriklerin hizmetin sunulması amacıyla Platformda yayımlanmasına izin verir."
        ),
      ],
    },
    {
      id: "sorumluluk",
      heading: "9. Sorumluluğun Sınırlandırılması",
      blocks: [
        p(
          "Platform \"olduğu gibi\" sunulur; kesintisiz veya hatasız çalışacağı garanti edilmez. Platform; eğitmen veya kurumların sunduğu hizmetin kalitesinden, ders sonuçlarından ve kullanıcılar arasındaki uyuşmazlıklardan — aracı hizmet sağlayıcı sıfatının gerektirdiği sınırlar içinde — sorumlu değildir. Zorunlu tüketici mevzuatı hükümleri saklıdır."
        ),
      ],
    },
    {
      id: "fesih",
      heading: "10. Üyeliğin Sona Ermesi",
      blocks: [
        p(
          "Hesabınızı dilediğiniz zaman kapatabilirsiniz; devam eden rezervasyon ve emanetteki ödemelere ilişkin süreçler tamamlanmadan kapatma işlemi sonuçlandırılmaz. Platform, Koşulları ihlal eden hesapları askıya alabilir veya kapatabilir."
        ),
      ],
    },
    {
      id: "uygulanacak-hukuk",
      heading: "11. Değişiklikler ve Uygulanacak Hukuk",
      blocks: [
        p(
          "Platform bu Koşulları güncelleyebilir; güncel sürüm yayımlandığı anda yürürlüğe girer ve önemli değişiklikler duyurulur. Bu Koşullar Türk hukukuna tabidir. Tüketici işlemlerinde tüketicinin yerleşim yerindeki Tüketici Hakem Heyetleri ve Tüketici Mahkemeleri; diğer uyuşmazlıklarda Adana (Ceyhan) Mahkemeleri ve İcra Daireleri yetkilidir."
        ),
      ],
    },
  ],
};

/* ─────────────────────── Mesafeli Satış Sözleşmesi ─────────────────────── */

const DISTANCE_SALES: LegalDoc = {
  id: "distance-sales",
  title: "Mesafeli Satış Sözleşmesi",
  description:
    "Adana Özel Ders üzerinden satın alınan özel ders, deneme sınavı oturumu ve çalışma alanı hizmetlerine ilişkin mesafeli satış sözleşmesi.",
  updatedAt: "2026-06-11",
  sections: [
    {
      id: "taraflar",
      heading: "1. Taraflar",
      blocks: [
        list(
          "ALICI: Platform üzerinden hizmet satın alan öğrenci (18 yaşından küçükse veli/vasisi).",
          "HİZMET SAĞLAYICI (SATICI): Hizmeti fiilen sunan, Platformda ilanı yayımlanan eğitmen veya kütüphane/etüt merkezi.",
          `ARACI HİZMET SAĞLAYICI: ${OPERATOR.name} platformu işletmecisi. ${operatorIdentity()}. Platform, satışa aracılık eder ve ödemeyi emanet (escrow) modeliyle güvence altına alır.`
        ),
      ],
    },
    {
      id: "konu",
      heading: "2. Sözleşmenin Konusu",
      blocks: [
        p(
          "Bu sözleşme; ALICI'nın Platform üzerinden elektronik ortamda sipariş verdiği aşağıdaki hizmetlerin satışı ve ifası ile tarafların 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği'nden doğan hak ve yükümlülüklerini düzenler:"
        ),
        list(
          "Özel ders hizmeti (online veya yüz yüze; süre ve tarih rezervasyonda belirtilir).",
          "Deneme sınavı oturumu katılım hakkı (oturum tarihi, türü ve yeri ilanda belirtilir).",
          "Kütüphane çalışma alanı saatlik kullanım hakkı (tarih ve saat aralığı rezervasyonda belirtilir)."
        ),
      ],
    },
    {
      id: "bedel-ve-odeme",
      heading: "3. Hizmet Bedeli ve Ödeme",
      blocks: [
        p(
          "Hizmet bedeli, sipariş anında Platformda gösterilen ve tüm vergiler dâhil nihai tutardır: özel derste eğitmenin saatlik ücreti × ders süresi; deneme oturumunda ilan edilen katılım ücreti; çalışma alanında saatlik ücret × rezervasyon süresi. Ödeme, iyzico ödeme altyapısı üzerinden kredi/banka kartı ile peşin alınır ve hizmet ifa edilene kadar Platform nezdinde emanette tutulur. Kart bilgileri Platform tarafından saklanmaz."
        ),
      ],
    },
    {
      id: "ifa",
      heading: "4. Hizmetin İfası",
      blocks: [
        list(
          "Özel ders: rezervasyonda belirtilen tarih ve saatte, online ise Platform içindeki görüntülü görüşme penceresiyle, yüz yüze ise kararlaştırılan buluşma noktasında ifa edilir.",
          "Deneme sınavı oturumu: ilanda belirtilen tarihte ilgili kurumda gerçekleşir; ALICI, girişte Platformdaki QR biletini okutarak katılımını doğrular.",
          "Çalışma alanı: rezerve edilen saat aralığında ilgili kurumda kullanılır; girişte QR kod doğrulaması yapılır.",
          "Hizmet ifa edildikten sonra bedel, platform komisyonu düşülerek HİZMET SAĞLAYICI'ya aktarılır."
        ),
      ],
    },
    {
      id: "cayma-hakki",
      heading: "5. Cayma Hakkı ve İstisnaları",
      blocks: [
        p(
          "Mesafeli Sözleşmeler Yönetmeliği m.15/1-g uyarınca; BELİRLİ BİR TARİHTE veya dönemde yapılması gereken, konaklama, eşya taşıma, araba kiralama, yiyecek-içecek tedariki ve eğlence veya dinlenme amacıyla yapılan BOŞ ZAMANIN DEĞERLENDİRİLMESİNE İLİŞKİN hizmetlere dair sözleşmelerde cayma hakkı kullanılamaz. Bu kapsamda, belirli tarih ve saate bağlanan deneme sınavı oturumu katılım hakkı ve çalışma alanı rezervasyonlarında cayma hakkı BULUNMAZ. Bununla birlikte SATICI, kanuni bir zorunluluk olmaksızın kendi ticari politikası gereği, oturum/rezervasyon başlangıcına 24 SAATTEN FAZLA süre kalması hâlinde iptal ve tam iade imkânı tanır; bu süreden sonra iptal yapılamaz ve katılım sağlanmaması (no-show) hâlinde iade yapılmaz."
        ),
        p(
          "Özel ders rezervasyonlarında ders henüz ifa edilmeden yapılan iptallerde ödeme emanetten iade edilir. Hizmetin ifasına ALICI onayı ile başlanmış ve hizmet tamamlanmışsa cayma hakkı kullanılamaz (Yönetmelik m.15/1-h). Ayrıntılı iptal/iade kuralları İptal ve İade Politikası'nda yer alır ve bu sözleşmenin ayrılmaz parçasıdır."
        ),
      ],
    },
    {
      id: "iade",
      heading: "6. İade Usulü",
      blocks: [
        p(
          "İade hakkının doğduğu hâllerde tutar, ödemenin yapıldığı karta iyzico aracılığıyla iade edilir. İade, iadenin onaylanmasından itibaren makul süre içinde başlatılır; tutarın karta yansıması bankanıza bağlı olarak 7-14 iş günü sürebilir."
        ),
      ],
    },
    {
      id: "uyusmazlik",
      heading: "7. Uyuşmazlıkların Çözümü",
      blocks: [
        p(
          "Bu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığı'nca ilan edilen parasal sınırlar dâhilinde ALICI'nın yerleşim yerindeki Tüketici Hakem Heyetleri, sınırı aşan uyuşmazlıklarda Tüketici Mahkemeleri yetkilidir."
        ),
      ],
    },
    {
      id: "yururluk",
      heading: "8. Yürürlük",
      blocks: [
        p(
          "ALICI, Platform üzerinden ödemeyi başlatmadan önce bu sözleşmeyi ve ön bilgilendirmeyi okuduğunu ve kabul ettiğini beyan eder. Sözleşme, ödemenin tamamlanmasıyla kurulur; sipariş özeti ve ödeme kaydı Platform hesabınızda saklanır."
        ),
      ],
    },
  ],
};

/* ─────────────────────── İptal ve İade Politikası ─────────────────────── */

const REFUND: LegalDoc = {
  id: "refund",
  title: "İptal ve İade Politikası",
  description:
    "Adana Özel Ders'te özel ders, deneme sınavı oturumu ve çalışma alanı rezervasyonlarının iptal ve iade kuralları.",
  updatedAt: "2026-06-11",
  sections: [
    {
      id: "genel",
      heading: "1. Genel Esaslar — Emanet (Escrow) Modeli",
      blocks: [
        p(
          "Platformdaki tüm ödemeler önce emanete alınır; hizmet ifa edildiğinde hizmet sağlayıcıya aktarılır. Bu sayede hizmeti almadığınız durumlarda iade süreci basittir: emanetteki tutar hizmet sağlayıcıya hiç aktarılmadan size geri döner."
        ),
      ],
    },
    {
      id: "ozel-dersler",
      heading: "2. Özel Dersler",
      blocks: [
        list(
          "Eğitmen talebi henüz kabul etmemişse: ödeme alınmamıştır, talebi serbestçe iptal edebilirsiniz.",
          "Ödeme yapıldı ancak ders henüz gerçekleşmediyse: dersin iptali hâlinde (öğrenci veya eğitmen tarafından) emanetteki tutarın TAMAMI iade edilir.",
          "Eğitmen derse gelmezse veya ders gerçekleşmezse: destek üzerinden bildirmeniz hâlinde tutar iade edilir.",
          "Ders tamamlandıktan sonra: bedel eğitmene aktarılır; hizmete ilişkin itirazlarınızı 48 saat içinde destek ekibine iletebilirsiniz, Platform itirazı inceleyerek karara bağlar."
        ),
      ],
    },
    {
      id: "deneme-oturumlari",
      heading: "3. Deneme Sınavı Oturumları",
      blocks: [
        list(
          "Kayıt yaptırdınız ancak henüz ödemediniz: kaydı serbestçe iptal edebilirsiniz.",
          "Ödeme tamamlandıysa ve oturum başlangıcına 24 SAATTEN FAZLA süre varsa: kaydı iptal edebilirsiniz, ücretin TAMAMI iade edilir.",
          "Oturum başlangıcına 24 saatten az kaldıysa: kayıt İPTAL EDİLEMEZ. Oturum belirli bir tarihte ifa edilen bir hizmettir ve bu aşamadan sonra cayma hakkı bulunmaz (Mesafeli Sözleşmeler Yönetmeliği m.15/1-g).",
          "Oturuma katılmazsanız (no-show): ücret İADE EDİLMEZ.",
          "Oturum kurum veya Platform tarafından iptal edilirse: ücretin TAMAMI otomatik olarak iade edilir."
        ),
      ],
    },
    {
      id: "calisma-rezervasyonlari",
      heading: "4. Çalışma Alanı Rezervasyonları",
      blocks: [
        list(
          "Ödeme tamamlandıysa ve rezervasyon başlangıcına 24 SAATTEN FAZLA süre varsa: rezervasyonu iptal edebilirsiniz, ücretin TAMAMI iade edilir.",
          "Başlangıca 24 saatten az kaldıysa: rezervasyon İPTAL EDİLEMEZ. Belirli saat aralığına bağlı bir hizmet olduğundan bu aşamadan sonra cayma hakkı bulunmaz.",
          "Rezerve ettiğiniz saatte gelmezseniz (no-show): ücret İADE EDİLMEZ.",
          "Kütüphane rezervasyonu karşılayamazsa (kapanma, mücbir sebep vb.): ücretin TAMAMI iade edilir."
        ),
      ],
    },
    {
      id: "iade-suresi",
      heading: "5. İade Süresi ve Yöntemi",
      blocks: [
        p(
          "İadeler her zaman ödemenin yapıldığı karta, iyzico aracılığıyla yapılır. İade onaylandıktan sonra tutarın kartınıza yansıması, bankanızın süreçlerine bağlı olarak genellikle 7-14 iş günü sürer. Nakit veya farklı bir hesaba iade yapılmaz."
        ),
      ],
    },
    {
      id: "itiraz",
      heading: "6. İtiraz ve Destek",
      blocks: [
        p(
          `İptal/iade süreçlerine ilişkin itirazlarınız için ${OPERATOR.email} adresine işlem bilgilerinizle (rezervasyon/bilet numarası) başvurabilirsiniz. Tüketici Hakem Heyetlerine ve Tüketici Mahkemelerine başvuru hakkınız saklıdır.`
        ),
      ],
    },
  ],
};

/* ─────────────────────────── Çerez Politikası ─────────────────────────── */

const COOKIES: LegalDoc = {
  id: "cookies",
  title: "Çerez Politikası",
  description:
    "Adana Özel Ders'in çerez (cookie) ve yerel depolama kullanımına ilişkin politika: yalnızca zorunlu/işlevsel kayıtlar, reklam ve takip çerezi yok.",
  updatedAt: "2026-06-11",
  sections: [
    {
      id: "cerez-nedir",
      heading: "1. Çerez ve Yerel Depolama Nedir?",
      blocks: [
        p(
          "Çerezler ve tarayıcı yerel depolaması (localStorage), bir web sitesinin tarayıcınızda sakladığı küçük veri kayıtlarıdır. Oturumunuzu hatırlamak ve tercihinizi korumak gibi temel işlevler için kullanılır."
        ),
      ],
    },
    {
      id: "kullandiklarimiz",
      heading: "2. Platformda Kullanılan Kayıtlar",
      blocks: [
        p("Platform, reklam veya pazarlama amaçlı takip çerezi KULLANMAZ. Tarayıcınızda yalnızca aşağıdaki zorunlu/işlevsel kayıtlar tutulur:"),
        list(
          "Oturum jetonları: giriş yaptığınızda kimliğinizi doğrulamak için (zorunlu).",
          "Tema ve kişiselleştirme tercihleri: açık/koyu mod, üst bar bileşeni gibi görünüm ayarları (işlevsel).",
          "Yerel kullanım kolaylıkları: son görüntülenen ilanlar, son aramalar gibi yalnız sizin cihazınızda tutulan listeler (işlevsel)."
        ),
      ],
    },
    {
      id: "ucuncu-taraf",
      heading: "3. Üçüncü Taraf İçerikler",
      blocks: [
        p(
          "Canlı ders penceresi (görüntülü görüşme), harita görüntüleri ve hava durumu gibi gömülü içerikler ilgili üçüncü taraf servislerden yüklenir. Bu servisler, yalnızca ilgili içeriği kullandığınızda kendi çerezlerini bırakabilir ve kendi politikalarına tabidir."
        ),
      ],
    },
    {
      id: "yonetim",
      heading: "4. Kayıtları Yönetme",
      blocks: [
        p(
          "Tarayıcınızın ayarlarından çerezleri ve site verilerini silebilir veya engelleyebilirsiniz. Zorunlu kayıtların silinmesi hâlinde oturumunuz kapanır ve bazı özellikler çalışmayabilir."
        ),
      ],
    },
    {
      id: "degisiklik",
      heading: "5. Değişiklikler",
      blocks: [
        p(
          `Bu politika gerektiğinde güncellenir; güncel sürüm her zaman bu sayfada yayımlanır. Sorularınız için: ${OPERATOR.email}`
        ),
      ],
    },
  ],
};

/** Tüm yasal belgeler — footer/menü sırası bu dizidir. */
export const LEGAL_DOCS: readonly LegalDoc[] = [
  KVKK,
  PRIVACY,
  TERMS,
  DISTANCE_SALES,
  REFUND,
  COOKIES,
];

export function getLegalDoc(id: LegalDocId): LegalDoc {
  const doc = LEGAL_DOCS.find((d) => d.id === id);
  if (!doc) throw new Error(`Bilinmeyen yasal belge: ${id}`);
  return doc;
}

/**
 * Kayıtta onaylanan metinlerin geçerli sürümü.
 *
 * Backend `user_consents.doc_version` alanına bunu yazar (KVKK ispat yükü).
 * Zorunlu üç belgenin (KVKK / kullanım koşulları / gizlilik) EN YENİ
 * `updatedAt` değeri kullanılır: biri güncellendiğinde sürüm ilerler ve
 * kullanıcıdan yeni onay istenebilir hale gelir.
 */
export const SIGNUP_CONSENT_DOCS: readonly LegalDocId[] = [
  "kvkk",
  "terms",
  "privacy",
];

export function currentConsentVersion(): string {
  const versions = SIGNUP_CONSENT_DOCS.map((id) => getLegalDoc(id).updatedAt);
  return versions.reduce((a, b) => (a > b ? a : b));
}
