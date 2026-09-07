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
 * Mesafeli Sözleşmeler Yönetmeliği m.5'in zorunlu kıldığı alanlar (açık adres,
 * telefon, vergi dairesi/numarası) DOLDURULDU — bunlar vergi kaydındaki
 * bilgilerdir. Adres değişecekse önce vergi dairesine bildirilmeli; kayıttan
 * farklı bir adres göstermek yanlış beyandır.
 *
 * TODO(lansman): `mersis` ticaret sicili tescili ONAY SÜRECİNDE; numara gelince
 * yazılacak. Boş kaldığı sürece `operatorIdentity()` bu satırı hiç basmaz.
 * `kep` şahıs şirketi için ZORUNLU DEĞİLDİR (sermaye şirketlerine zorunlu);
 * alınırsa `@…kep.tr` uzantılı gerçek KEP adresi yazılmalı — normal e-posta değil.
 */
export const OPERATOR = {
  name: SITE_NAME,
  // Şahıs şirketinde tescilli unvan yalnız AD SOYAD'dır (31 Ağu düzeltmesi):
  // "Dijital Pazarlama ve Yazılım" eki alınmış bir ticaret unvanı DEĞİLDİ.
  entity: "Serhat Kıyar",
  address: "Emek Mah. Oktar Cirit Cad. No: 81 D: 201 Ceyhan/Adana",
  email: "bilgi@adanaozelders.com.tr",
  /** Ekranda ve yasal metinlerde okunacak biçim. */
  // İşletme sabit hattı (Netgsm, 30 Ağu) — kişisel cep BURADA KULLANILMAZ.
  phone: "+90 322 911 07 89",
  /** `tel:` bağlantısı için boşluksuz biçim — telefon uygulamaları boşluklu
   *  numarayı bazı platformlarda yanlış ayrıştırır, bu yüzden ayrı tutulur. */
  phoneHref: "+903229110789",
  taxNumber: "5590521517",
  taxOffice: "Ceyhan Vergi Dairesi Müdürlüğü",
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
  | "cookies"
  | "preliminary-info"
  | "ranking-criteria"
  | "about";

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
  updatedAt: "2026-09-06",
  sections: [
    {
      id: "veri-sorumlusu",
      heading: "1. Veri Sorumlusu",
      blocks: [
        p(
          `Bu aydınlatma metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca, ${OPERATOR.name} platformunu (\"Platform\") işleten ${OPERATOR.entity} (\"İşletme\") tarafından veri sorumlusu sıfatıyla hazırlanmıştır. İletişim: ${OPERATOR.email}: ${OPERATOR.address}.`
        ),
      ],
    },
    {
      id: "islenen-veriler",
      heading: "2. İşlenen Kişisel Veri Kategorileri",
      blocks: [
        p("Platforma üye olduğunuzda ve Platformu kullandığınızda aşağıdaki kişisel veri kategorileri işlenir:"),
        list(
          "Kimlik bilgileri: ad, soyad, doğum tarihi, cinsiyet (isteğe bağlı).",
          "İletişim bilgileri: e-posta adresi.",
          "Eğitmen profil bilgileri (eğitmenler için): eğitim geçmişi, verilen dersler, saatlik ücret, biyografi, profil fotoğrafı, ders verilen konum.",
          "Konum bilgileri: \"yakınımda\" araması yaptığınızda tarayıcınızın paylaştığı yaklaşık konum (sunucuda saklanmaz, yalnız arama için kullanılır); eğitmen/kütüphane konumları (ilan amaçlı, ilgili kullanıcının kendi girdisidir).",
          "Eğitim ve kullanım verileri: ders rezervasyonları, deneme sınavı kayıtları ve sonuçları, çalışma alanı rezervasyonları, soru-cevaplar, değerlendirme ve yorumlar, çalışma araçları verileri (görevler, aralıklı tekrar desteleri ve tekrar geçmişi, alışkanlıklar).",
          "Mesajlaşma içerikleri: Platform üzerinden eğitmen-öğrenci yazışmaları (hizmet güvenliği ve uyuşmazlık çözümü amacıyla saklanır).",
          "Finansal işlem bilgileri: ödeme tutarı, ödeme durumu ve ödeme kuruluşu işlem referansı. Kart bilgileriniz Platform tarafından GÖRÜLMEZ ve SAKLANMAZ; ödeme sayfası doğrudan iyzico Ödeme Hizmetleri A.Ş. tarafından sunulur.",
          "Kimlik ve ödeme doğrulama verileri (yalnızca ödeme alan eğitmen ve kütüphane sorumluları için): T.C. Kimlik Numarası, IBAN ve diploma/denklik/öğrenci belgesi ile e-Devlet doğrulama (barkod) kodu. T.C. Kimlik Numarası veritabanında şifreli (kriptolu) saklanır; arayüzde yalnızca son dört hanesi gösterilir. Ödeme alıcısı hesabının kurulması için ad-soyad, T.C. Kimlik Numarası ve IBAN bilgisi ödeme kuruluşuna (iyzico) aktarılır.",
          "Ön başvuru bilgileri (hesap açmadan iletilen): ad-soyad, cep telefonu, verdiğiniz dersler, isteğe bağlı e-posta, profil fotoğrafı, tanıtım metni, saatlik ücret, müsaitlik ve diploma/sertifika belgeleri. Bu veriler yalnızca başvurunuzun değerlendirilmesi ve sizinle iletişime geçilmesi için işlenir; üyelik açılmadığı sürece profil olarak yayımlanmaz.",
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
          "Eğitmen ön başvurularının değerlendirilmesi ve başvuru sahibiyle telefonla iletişime geçilmesi.",
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
          "Ödeme kuruluşu: iyzico Ödeme Hizmetleri A.Ş.: ödeme işlemleri ve 6493 sayılı Kanun kapsamındaki yükümlülükler için; ayrıca ödeme alan eğitmen/kütüphane için alt üye işyeri (sub-merchant) kurulumu amacıyla ad-soyad, T.C. Kimlik Numarası ve IBAN bilgisi aktarılır. Kimlik doğrulaması (MERNIS/IBAN kontrolü) mevzuat gereği ödeme kuruluşunca yapılır.",
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
          "Platform \"olduğu gibi\" sunulur; kesintisiz veya hatasız çalışacağı garanti edilmez. Platform; eğitmen veya kurumların sunduğu hizmetin kalitesinden, ders sonuçlarından ve kullanıcılar arasındaki uyuşmazlıklardan: aracı hizmet sağlayıcı sıfatının gerektirdiği sınırlar içinde: sorumlu değildir. Zorunlu tüketici mevzuatı hükümleri saklıdır."
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
    "Adana Özel Ders üzerinden satın alınan özel ders, deneme sınavı oturumu, çalışma alanı hizmetleri ve basılı kitap siparişlerine ilişkin mesafeli satış sözleşmesi.",
  updatedAt: "2026-08-17",
  sections: [
    {
      id: "taraflar",
      heading: "1. Taraflar",
      blocks: [
        list(
          "ALICI: Platform üzerinden hizmet veya ürün satın alan öğrenci/müşteri (18 yaşından küçükse veli/vasisi).",
          "HİZMET SAĞLAYICI (SATICI): Hizmeti fiilen sunan, Platformda ilanı yayımlanan eğitmen veya kütüphane/etüt merkezi.",
          `ARACI HİZMET SAĞLAYICI: ${OPERATOR.name} platformu işletmecisi. ${operatorIdentity()}. Platform, hizmet satışına aracılık eder ve ödemeyi emanet (escrow) modeliyle güvence altına alır.`,
          `SATICI (mağaza ürünleri): Platform mağazasında satışa sunulan basılı kitap ve benzeri fiziksel ürünlerde satıcı, aracı değil doğrudan ${OPERATOR.entity}'dır. Bu ürünlerde emanet modeli uygulanmaz; satış, işletmenin kendi ürününün doğrudan satışıdır.`
        ),
      ],
    },
    {
      id: "konu",
      heading: "2. Sözleşmenin Konusu",
      blocks: [
        p(
          "Bu sözleşme; ALICI'nın Platform üzerinden elektronik ortamda sipariş verdiği aşağıdaki hizmet ve ürünlerin satışı, ifası ve teslimi ile tarafların 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği'nden doğan hak ve yükümlülüklerini düzenler:"
        ),
        list(
          "Özel ders hizmeti (online veya yüz yüze; süre ve tarih rezervasyonda belirtilir).",
          "Deneme sınavı oturumu katılım hakkı (oturum tarihi, türü ve yeri ilanda belirtilir).",
          "Kütüphane çalışma alanı saatlik kullanım hakkı (tarih ve saat aralığı rezervasyonda belirtilir).",
          "Platform mağazasından sipariş edilen BASILI KİTAP ve benzeri fiziksel ürünler (ürün adı, adedi ve fiyatı sipariş özetinde belirtilir)."
        ),
        p(
          "Hizmetlerde Platform aracı hizmet sağlayıcı, basılı kitap satışında ise doğrudan satıcı sıfatıyla hareket eder. Her siparişte hangi sıfatla hareket edildiği sipariş özetinde görünür."
        ),
      ],
    },
    {
      id: "bedel-ve-odeme",
      heading: "3. Bedel ve Ödeme",
      blocks: [
        p(
          "Hizmet bedeli, sipariş anında Platformda gösterilen ve tüm vergiler dâhil nihai tutardır: özel derste eğitmenin saatlik ücreti × ders süresi; deneme oturumunda ilan edilen katılım ücreti; çalışma alanında saatlik ücret × rezervasyon süresi. Ödeme, iyzico ödeme altyapısı üzerinden kredi/banka kartı ile peşin alınır ve hizmet ifa edilene kadar Platform nezdinde emanette tutulur. Kart bilgileri Platform tarafından saklanmaz."
        ),
        p(
          "Mağaza ürünlerinde bedel, ürün sayfasında ve sipariş özetinde gösterilen tutardır. PLATFORMDA GÖSTERİLEN TÜM FİYATLAR KDV DÂHİLDİR; ALICI'dan sipariş özetinde yer alan tutar dışında ek bir vergi veya masraf talep edilmez. Varsa kargo/teslimat bedeli sipariş özetinde ayrı bir satır olarak gösterilir ve ödeme adımından önce toplam tutara dâhil edilir; sipariş özetinde kargo bedeli görünmüyorsa teslimat ücretsizdir."
        ),
      ],
    },
    {
      id: "ifa",
      heading: "4. Hizmetin İfası",
      blocks: [
        list(
          "Özel ders: rezervasyonda belirtilen tarih ve saatte, online ise Platform içindeki görüntülü görüşme penceresiyle, yüz yüze ise kararlaştırılan buluşma noktasında ifa edilir.",
          "Deneme sınavı oturumu: ilanda belirtilen tarihte ilgili kurumda gerçekleşir; ALICI, girişte Platformdaki rezervasyon kodunu görevliye ileterek katılımını doğrular.",
          "Çalışma alanı: rezerve edilen saat aralığında ilgili kurumda kullanılır; girişte rezervasyon kodu ile doğrulama yapılır.",
          "Hizmet ifa edildikten sonra bedel, platform komisyonu düşülerek HİZMET SAĞLAYICI'ya aktarılır."
        ),
      ],
    },
    {
      id: "teslimat",
      heading: "5. Fiziksel Ürünlerin Teslimatı",
      blocks: [
        p(
          "Basılı kitap siparişleri, teslimat adresine göre iki şekilde ulaştırılır:"
        ),
        list(
          "ADANA İÇİ: siparişler, Platformun KENDİ ARAÇ VE KURYELERİYLE elden teslim edilir. Teslimat günü kuryemiz adresinize gelir; teslim sırasında telefonunuza gönderilen tek kullanımlık doğrulama kodu ile teslim tamamlanır. Dilerseniz sipariş detayından teslimat tercihinizi (kapıya bırakma, komşuya bırakma, önce arama) belirtebilir veya teslimatı bir sonraki güne erteleyebilirsiniz.",
          "ADANA DIŞI: siparişler anlaşmalı kargo firmasıyla gönderilir; kargoya verildiğinde takip bilgisi hesabınıza işlenir.",
          "Teslimat adresi, sipariş sırasında seçtiğiniz adres ve harita konumudur. Adresin doğru ve eksiksiz olmasından ALICI sorumludur; hatalı adres nedeniyle teslim edilemeyen siparişlerde yeniden gönderim yapılabilir."
        ),
        p(
          "Siparişiniz onaylandığında, sipariş özetinde ve sipariş takip sayfasında TAHMİNİ TESLİM GÜNÜ gösterilir. Mesafeli Sözleşmeler Yönetmeliği uyarınca teslim süresi her hâlükârda siparişin SATICI'ya ulaşmasından itibaren OTUZ GÜNÜ geçemez. Bu süre içinde teslim yapılamazsa ALICI sözleşmeyi feshedebilir; fesih hâlinde varsa teslimat masrafları da dâhil olmak üzere tahsil edilen tüm ödemeler iade edilir."
        ),
        p(
          "Teslim aldığınız paketi kurye/kargo görevlisinin yanında kontrol etmeniz önerilir. Pakette gözle görülür hasar varsa teslim almadan tutanak tutturmanız ya da paketi teslim almayıp durumu bize bildirmeniz, sürecin hızlanmasını sağlar; bu, ALICI'nın ayıplı mala ilişkin kanuni haklarını ortadan kaldırmaz."
        ),
      ],
    },
    {
      id: "cayma-hakki",
      heading: "6. Cayma Hakkı ve İstisnaları",
      blocks: [
        p(
          "Mesafeli Sözleşmeler Yönetmeliği m.15/1-g uyarınca; BELİRLİ BİR TARİHTE veya dönemde yapılması gereken, konaklama, eşya taşıma, araba kiralama, yiyecek-içecek tedariki ve eğlence veya dinlenme amacıyla yapılan BOŞ ZAMANIN DEĞERLENDİRİLMESİNE İLİŞKİN hizmetlere dair sözleşmelerde cayma hakkı kullanılamaz. Bu kapsamda, belirli tarih ve saate bağlanan deneme sınavı oturumu katılım hakkı ve çalışma alanı rezervasyonlarında cayma hakkı BULUNMAZ. Bununla birlikte SATICI, kanuni bir zorunluluk olmaksızın kendi ticari politikası gereği, oturum/rezervasyon başlangıcına 24 SAATTEN FAZLA süre kalması hâlinde iptal ve tam iade imkânı tanır; bu süreden sonra iptal yapılamaz ve katılım sağlanmaması (no-show) hâlinde iade yapılmaz."
        ),
        p(
          "Özel ders rezervasyonlarında ders henüz ifa edilmeden yapılan iptallerde ödeme emanetten iade edilir. Hizmetin ifasına ALICI onayı ile başlanmış ve hizmet tamamlanmışsa cayma hakkı kullanılamaz (Yönetmelik m.15/1-h). Ayrıntılı iptal/iade kuralları İptal ve İade Politikası'nda yer alır ve bu sözleşmenin ayrılmaz parçasıdır."
        ),
        p(
          "FİZİKSEL ÜRÜNLERDE (basılı kitap) durum farklıdır: Mesafeli Sözleşmeler Yönetmeliği m.9 uyarınca ALICI, ürünü teslim aldığı günden itibaren ON DÖRT GÜN içinde hiçbir gerekçe göstermeksizin ve cezai şart ödemeksizin sözleşmeden cayabilir. Cayma hakkı, sözleşmenin kurulmasından teslime kadar olan sürede de kullanılabilir. Cayma bildirimini hesabınızdaki sipariş detayından iade talebi oluşturarak veya aşağıdaki iletişim kanallarından yazılı olarak iletebilirsiniz."
        ),
        p(
          "Basılı kitapta cayma hakkının ÖNEMLİ BİR İSTİSNASI vardır: Yönetmelik m.15/1-e uyarınca, malın tesliminden sonra ambalaj, bant, mühür, paket gibi koruyucu unsurları açılmış olması hâlinde maddi ortamda sunulan kitaplara ilişkin sözleşmelerde cayma hakkı kullanılamaz. Bu nedenle iade etmeyi düşündüğünüz kitabın koruyucu ambalajını açmamanız gerekir."
        ),
      ],
    },
    {
      id: "iade",
      heading: "7. İade Usulü ve Masraflar",
      blocks: [
        p(
          "İade hakkının doğduğu hâllerde tutar, ödemenin yapıldığı karta iyzico aracılığıyla iade edilir. İade, iadenin onaylanmasından itibaren makul süre içinde başlatılır; tutarın karta yansıması bankanıza bağlı olarak 7-14 iş günü sürebilir."
        ),
        p(
          "FİZİKSEL ÜRÜN İADESİNDE usul şöyledir: Cayma bildiriminizi ilettikten sonra ürünü, bildirim tarihinden itibaren ON DÖRT GÜN içinde bize geri göndermeniz gerekir. İADE MASRAFI SATICI'YA AİTTİR: iade gönderimini, iade talebinizi oluşturduğunuzda size bildirilen anlaşmalı taşıyıcı ile yaptığınız takdirde sizden herhangi bir iade kargo bedeli talep edilmez; Adana içinde iade edilecek ürün, talebiniz üzerine kendi kuryemizle adresinizden ücretsiz olarak alınabilir."
        ),
        p(
          `İade adresi: ${OPERATOR.entity}, ${OPERATOR.address}. İade paketine sipariş numaranızı eklemeniz süreci hızlandırır.`
        ),
        p(
          "Cayma hakkının usulüne uygun kullanılması hâlinde, varsa ürünün size teslim masrafları da dâhil olmak üzere tahsil edilen tüm ödemeler, ürünün anlaşmalı taşıyıcıya teslim edildiği tarihten (öngörülen taşıyıcı dışında bir taşıyıcı ile iade edilmişse ürünün bize ulaştığı tarihten) itibaren ON DÖRT GÜN içinde iade edilir. ALICI, cayma süresi içinde ürünü işleyişine, teknik özelliklerine ve kullanım talimatlarına uygun kullandığı takdirde meydana gelen değişiklik ve bozulmalardan sorumlu değildir."
        ),
      ],
    },
    {
      id: "ayipli-mal",
      heading: "8. Ayıplı, Eksik veya Yanlış Ürün",
      blocks: [
        p(
          "Teslim edilen ürün ayıplı (hasarlı, baskı hatalı, eksik sayfalı), eksik veya sipariş ettiğinizden farklı ise 6502 sayılı Tüketicinin Korunması Hakkında Kanun'un ayıplı mala ilişkin hükümleri uygulanır. Bu durumda ALICI; sözleşmeden dönme, ürünün ayıpsız misliyle değiştirilmesi, ücretsiz onarım veya bedelde indirim seçimlik haklarından birini kullanabilir."
        ),
        list(
          "Bu hak, ambalajın açılmış olmasından etkilenmez: ambalaj istisnası yalnız gerekçesiz CAYMA hakkı için geçerlidir.",
          `Bildirimi ${OPERATOR.email} adresine veya sipariş detayındaki iade talebi ekranından yapabilirsiniz; ürün fotoğrafı eklemeniz incelemeyi hızlandırır.`,
          "Ayıplı/eksik/yanlış üründe kargo ve iade masrafları ALICI'dan talep edilmez; değişim veya iade gönderimi SATICI tarafından karşılanır."
        ),
      ],
    },
    {
      id: "uyusmazlik",
      heading: "9. Uyuşmazlıkların Çözümü",
      blocks: [
        p(
          "Bu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığı'nca ilan edilen parasal sınırlar dâhilinde ALICI'nın yerleşim yerindeki Tüketici Hakem Heyetleri, sınırı aşan uyuşmazlıklarda Tüketici Mahkemeleri yetkilidir."
        ),
      ],
    },
    {
      id: "yururluk",
      heading: "10. Yürürlük",
      blocks: [
        p(
          "ALICI, Platform üzerinden ödemeyi başlatmadan önce bu sözleşmeyi ve Ön Bilgilendirme Formu'nu okuduğunu ve kabul ettiğini beyan eder. Sözleşme, ödemenin tamamlanmasıyla kurulur; sipariş özeti ve ödeme kaydı Platform hesabınızda saklanır."
        ),
      ],
    },
  ],
};

/* ─────────────────────── İptal ve İade Politikası ─────────────────────── */

const REFUND: LegalDoc = {
  id: "refund",
  title: "Teslimat, İptal ve İade Politikası",
  description:
    "Adana Özel Ders'te özel ders, deneme sınavı oturumu, çalışma alanı rezervasyonları ve basılı kitap siparişlerinin teslimat, iptal ve iade kuralları.",
  updatedAt: "2026-08-17",
  sections: [
    {
      // Bu bölüm, `lib/legalDebt.ts::escrow-tum-odemeler` kaydının konusuydu:
      // eski metin "Platformdaki TÜM ödemeler önce emanete alınır" diyordu ve
      // bu, ödeme kolları bağımsızlaştıktan sonra (PK-1) hiçbir kol için doğru
      // değildi. Sanal POS başvurusunda platformun üçüncü kişi adına tahsilat
      // yapmadığı beyan edildiği için cümle düzeltildi ve borç kaydı kapandı.
      //
      // İfadenin KAPSAMI bilinçli olarak MAĞAZA ile sınırlıdır. Ters yöndeki
      // hata da gerçekti: "Platform üzerinden yapılan satışlarda ... emanet
      // uygulanmaz" demek bu kez fazla geniş olurdu — ders (booking), deneme
      // bileti ve çalışma rezervasyonu akışlarında kod GERÇEKTEN emanet
      // uyguluyor (`backend/services/escrow.py`: PAYMENT_SPEC / EXAM_SPEC /
      // STUDY_SPEC). O kalemler lansmanda çevrimiçi ödemeye kapalı olduğu için
      // burada ödeme modelleri hiç tarif edilmiyor; kapalı bir akışın modelini
      // anlatmak, açıldığında güncellenmesi unutulacak bir taahhüt olurdu.
      id: "genel",
      heading: "1. Genel Esaslar: Ödeme ve İade Modeli",
      blocks: [
        p(
          "Mağazadan yapılan ürün satışlarında satıcı doğrudan işletmemizdir; ödeme doğrudan işletmemize yapılır, emanet uygulanmaz. İade hakkının doğduğu hâllerde tutar, ödemeyi aldığımız işletme hesabından doğrudan ödeme yaptığınız karta geri gönderilir."
        ),
        p(
          "İade koşulları satın aldığınız şeye göre değişir: fiziksel ürünlerde (basılı kitap) yasal cayma hakkı ve iade usulü 5. bölümde, hizmet niteliğindeki rezervasyonların iptal kuralları 2-4. bölümlerde açıklanmıştır."
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
      id: "fiziksel-urunler",
      heading: "5. Mağaza Ürünleri: Basılı Kitap Teslimatı ve İadesi",
      blocks: [
        p(
          "Mağazadan satın alınan basılı kitaplarda satıcı doğrudan işletmemizdir; ödeme işletmemize yapılır ve emanet modeli uygulanmaz (bkz. 1. bölüm)."
        ),
        p("TESLİMAT:"),
        list(
          "Adana içi siparişler kendi araç ve kuryelerimizle elden teslim edilir; teslimde telefonunuza gelen doğrulama kodu kullanılır.",
          "Adana dışı siparişler anlaşmalı kargo firmasıyla gönderilir ve takip bilgisi hesabınıza işlenir.",
          "Tahmini teslim günü sipariş özetinde gösterilir; teslim süresi her hâlükârda otuz günü geçemez. Bu sürede teslim yapılamazsa siparişi feshedip ödemenizin tamamını (varsa teslimat masrafı dâhil) geri alabilirsiniz.",
          "Kargo/teslimat bedeli varsa sipariş özetinde ayrıca gösterilir; gösterilmiyorsa teslimat ücretsizdir."
        ),
        p("SİPARİŞ İPTALİ VE CAYMA:"),
        list(
          "Sipariş henüz kargoya verilmediyse/yola çıkmadıysa hesabınızdan iptal edebilirsiniz; ödemenin tamamı iade edilir.",
          "Ürünü teslim aldıktan sonra ON DÖRT GÜN içinde gerekçe göstermeden cayabilirsiniz (Mesafeli Sözleşmeler Yönetmeliği m.9).",
          "ANCAK: koruyucu ambalajı, bandı veya mührü AÇILMIŞ kitaplarda cayma hakkı kullanılamaz (Yönetmelik m.15/1-e). İade etmeyi düşünüyorsanız ambalajı açmayın.",
          "İADE KARGO BEDELİ BİZE AİTTİR: iade talebinizde bildirilen anlaşmalı taşıyıcıyı kullandığınızda sizden iade masrafı alınmaz; Adana içinde ürünü kuryemizle adresinizden ücretsiz aldırabilirsiniz.",
          "Cayma bildiriminden sonra ürünü on dört gün içinde göndermeniz gerekir. İade tutarı, ürün taşıyıcıya teslim edildiği (öngörülen taşıyıcı dışında gönderildiyse bize ulaştığı) tarihten itibaren on dört gün içinde kartınıza iade edilir."
        ),
      ],
    },
    {
      id: "ayipli-eksik-urun",
      heading: "6. Ayıplı, Eksik veya Yanlış Gönderilen Ürün",
      blocks: [
        p(
          "Ürün hasarlı, baskı hatalı, eksik veya sipariş ettiğinizden farklı geldiyse 6502 sayılı Tüketicinin Korunması Hakkında Kanun'un ayıplı mala ilişkin hükümleri uygulanır: sözleşmeden dönme, ayıpsız misliyle değişim, ücretsiz onarım veya bedelde indirim haklarından birini seçebilirsiniz."
        ),
        list(
          "Bu haklar ambalaj açılmış olsa da geçerlidir; ambalaj istisnası yalnız gerekçesiz cayma içindir.",
          `Bildiriminizi sipariş detayındaki iade ekranından veya ${OPERATOR.email} adresinden yapın; ürün fotoğrafı incelemeyi hızlandırır.`,
          "Ayıplı/eksik/yanlış üründe hiçbir kargo veya iade masrafı sizden talep edilmez.",
          "Teslim sırasında pakette gözle görülür hasar varsa teslim almadan bildirmeniz süreci kolaylaştırır; bu, kanuni haklarınızı ortadan kaldırmaz."
        ),
      ],
    },
    {
      id: "iade-suresi",
      heading: "7. İade Süresi ve Yöntemi",
      blocks: [
        p(
          "İadeler her zaman ödemenin yapıldığı karta, iyzico aracılığıyla yapılır. İade onaylandıktan sonra tutarın kartınıza yansıması, bankanızın süreçlerine bağlı olarak genellikle 7-14 iş günü sürer. Nakit veya farklı bir hesaba iade yapılmaz."
        ),
      ],
    },
    {
      id: "itiraz",
      heading: "8. İtiraz ve Destek",
      blocks: [
        p(
          `İptal/iade süreçlerine ilişkin itirazlarınız için ${OPERATOR.email} adresine işlem bilgilerinizle (rezervasyon kodu) başvurabilirsiniz. Tüketici Hakem Heyetlerine ve Tüketici Mahkemelerine başvuru hakkınız saklıdır.`
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

/* ───────────────────────── Ön Bilgilendirme Formu ───────────────────────── */

/**
 * Mesafeli Sözleşmeler Yönetmeliği, sipariş verilmeden ÖNCE tüketicinin
 * bilgilendirilmesini zorunlu kılar. Mesafeli Satış Sözleşmesi bu forma atıf
 * yapar; iki metin ÇELİŞMEMELİDİR — süreler (on dört gün), istisnalar
 * (ambalajı açılmış kitap, anında ifa edilen dijital içerik), iade masrafının
 * satıcıya ait olduğu ve teslim süresi üst sınırı (otuz gün) burada da aynıdır.
 */
const PRELIMINARY_INFO: LegalDoc = {
  id: "preliminary-info",
  title: "Ön Bilgilendirme Formu",
  description:
    "Sipariş öncesi bilgilendirme: satıcı bilgileri, sipariş konusu, toplam bedel, teslimat, cayma hakkı ve istisnaları.",
  updatedAt: "2026-08-17",
  sections: [
    {
      id: "satici-bilgileri",
      heading: "1. Satıcı / Sağlayıcı Bilgileri",
      blocks: [
        p(operatorIdentity()),
        p(
          "Özel ders, deneme sınavı oturumu ve çalışma alanı rezervasyonlarında hizmeti fiilen sunan taraf, Platformda ilanı yayımlanan eğitmen veya kütüphane/etüt merkezidir; Platform bu satışlarda aracı hizmet sağlayıcıdır. Mağazadan satılan basılı kitaplarda ise satıcı doğrudan yukarıda kimliği verilen işletmedir."
        ),
      ],
    },
    {
      id: "siparis-konusu",
      heading: "2. Sipariş Konusu ve Temel Nitelikler",
      blocks: [
        p(
          "Satın aldığınız hizmet veya ürünün temel nitelikleri (ders süresi ve tarihi, oturum tarihi ve türü, rezervasyon saat aralığı; kitapta ürün adı, yazar/yayınevi ve adet) ilgili ilan sayfasında ve ödeme öncesi gösterilen SİPARİŞ ÖZETİNDE yer alır. Sipariş özetindeki bilgiler bu formun ayrılmaz parçasıdır."
        ),
      ],
    },
    {
      id: "toplam-bedel",
      heading: "3. Toplam Bedel ve Ödeme",
      blocks: [
        list(
          "Platformda gösterilen tüm fiyatlar KDV DÂHİLDİR.",
          "Varsa kargo/teslimat bedeli sipariş özetinde ayrı satır olarak gösterilir ve toplama eklenir; gösterilmiyorsa teslimat ücretsizdir.",
          "Ödeme, iyzico altyapısı üzerinden kredi/banka kartı ile peşin yapılır. Kart bilgileriniz Platform tarafından saklanmaz.",
          "Mağaza ürünlerinde satıcı doğrudan işletmemizdir; ödeme doğrudan işletmemize yapılır, emanet (escrow) uygulanmaz.",
          "Sipariş özetinde gösterilen tutar dışında sizden ek bir vergi veya masraf talep edilmez."
        ),
      ],
    },
    {
      id: "teslim-ve-ifa",
      heading: "4. Teslimat ve İfa",
      blocks: [
        list(
          "Adana içi kitap siparişleri kendi araç ve kuryelerimizle elden teslim edilir; teslimde telefonunuza gelen doğrulama kodu kullanılır.",
          "Adana dışı siparişler anlaşmalı kargo firmasıyla gönderilir.",
          "Tahmini teslim günü sipariş özetinde gösterilir; teslim süresi her hâlükârda siparişin ulaşmasından itibaren OTUZ GÜNÜ geçemez. Bu sürede teslim yapılmazsa sözleşmeyi feshedebilir, varsa teslim masrafları dâhil ödediğiniz tutarın tamamını geri alabilirsiniz.",
          "Hizmetler, rezervasyonda/ilanda belirtilen tarih ve saatte ifa edilir."
        ),
      ],
    },
    {
      id: "cayma",
      heading: "5. Cayma Hakkı",
      blocks: [
        p(
          "Fiziksel ürünlerde (basılı kitap), ürünü teslim aldığınız günden itibaren ON DÖRT GÜN içinde hiçbir gerekçe göstermeden ve cezai şart ödemeden sözleşmeden cayabilirsiniz (Mesafeli Sözleşmeler Yönetmeliği m.9). Cayma hakkı, sözleşmenin kurulmasından teslime kadar olan sürede de kullanılabilir."
        ),
        p(
          "Cayma bildirimini hesabınızdaki sipariş detayından iade talebi oluşturarak veya aşağıdaki iletişim kanallarımıza yazılı olarak iletebilirsiniz."
        ),
      ],
    },
    {
      id: "cayma-istisnalari",
      heading: "6. Cayma Hakkının Bulunmadığı Hâller",
      blocks: [
        list(
          "Koruyucu ambalajı, bandı veya mührü AÇILMIŞ basılı kitaplar (Yönetmelik m.15/1-e). İade etmeyi düşünüyorsanız ambalajı açmayın.",
          "Belirli bir tarih veya dönemde yapılması gereken, boş zamanın değerlendirilmesine ilişkin hizmetler; deneme sınavı oturumu ve çalışma alanı rezervasyonları bu kapsamdadır (Yönetmelik m.15/1-g). Buna rağmen ticari politikamız gereği, başlangıca 24 saatten fazla varsa iptal ve tam iade imkânı tanınır.",
          "Cayma süresi dolmadan, onayınızla ifasına başlanan ve tamamlanan hizmetler (Yönetmelik m.15/1-h): tamamlanmış özel ders bu kapsamdadır."
        ),
      ],
    },
    {
      id: "iade-usulu",
      heading: "7. İade Usulü ve Masraflar",
      blocks: [
        list(
          "Cayma bildiriminden sonra ürünü ON DÖRT GÜN içinde geri göndermeniz gerekir.",
          "İADE MASRAFI SATICIYA AİTTİR: iade talebinizde bildirilen anlaşmalı taşıyıcıyı kullandığınızda sizden iade kargo bedeli alınmaz. Adana içinde ürün, talebiniz üzerine kuryemizle adresinizden ücretsiz alınabilir.",
          `İade adresi: ${OPERATOR.entity}, ${OPERATOR.address}.`,
          "İade tutarı, ürünün anlaşmalı taşıyıcıya teslim edildiği (öngörülen taşıyıcı dışında gönderildiyse bize ulaştığı) tarihten itibaren ON DÖRT GÜN içinde, varsa teslim masrafları da dâhil olmak üzere ödemenin yapıldığı karta iade edilir.",
          "Ürünü cayma süresi içinde işleyişine ve kullanım talimatlarına uygun kullandığınız takdirde oluşan değişiklik ve bozulmalardan sorumlu tutulmazsınız."
        ),
      ],
    },
    {
      id: "sikayet",
      heading: "8. Şikâyet ve Uyuşmazlık",
      blocks: [
        p(
          `Talep ve şikâyetlerinizi ${OPERATOR.email} adresine veya ${OPERATOR.phone} numarasına iletebilirsiniz. Uyuşmazlık hâlinde, Ticaret Bakanlığı'nca her yıl ilan edilen parasal sınırlar dâhilinde yerleşim yerinizdeki Tüketici Hakem Heyetine, sınırı aşan uyuşmazlıklarda Tüketici Mahkemelerine başvurabilirsiniz.`
        ),
      ],
    },
    {
      id: "kayit",
      heading: "9. Kayıt ve Saklama",
      blocks: [
        p(
          "Bu formu ve Mesafeli Satış Sözleşmesi'ni ödeme adımından önce onaylarsınız; sipariş özetiniz ve ödeme kaydınız Platform hesabınızda saklanır ve dilediğiniz zaman görüntülenebilir."
        ),
      ],
    },
  ],
};

/* ──────────────────────────────── Hakkımızda ──────────────────────────────── */

/**
 * iyzico başvurusunun zorunlu tuttuğu kurumsal tanıtım sayfası.
 *
 * BİLİNÇLİ OLARAK ÖLÇÜLÜ: platform henüz canlıya alınmadığı için öğrenci/
 * eğitmen sayısı, "binlerce kullanıcı" gibi doğrulanamayacak hiçbir iddia
 * yazılmaz. Yalnız gerçekten var olan özellikler ve tescilli işletme kimliği
 * anlatılır.
 */
const ABOUT: LegalDoc = {
  id: "about",
  title: "Hakkımızda",
  description:
    "Adana Özel Ders; Adana'da özel ders eşleştirme, çalışma alanı rezervasyonu ve eğitim kitabı satışı yapan yerel bir eğitim platformudur.",
  updatedAt: "2026-08-17",
  sections: [
    {
      id: "kimiz",
      heading: "Kimiz?",
      blocks: [
        p(
          `${SITE_NAME}, Adana'da öğrenciler ile özel ders eğitmenlerini buluşturan, bölgedeki kütüphane ve etüt merkezlerini tek bir katalogda toplayan ve eğitim kitabı satışı yapan yerel bir eğitim platformudur. Platform, aşağıda kimliği verilen tescilli işletme tarafından işletilmektedir.`
        ),
        p(operatorIdentity()),
      ],
    },
    {
      id: "ne-yapiyoruz",
      heading: "Ne Yapıyoruz?",
      blocks: [
        list(
          "ÖZEL DERS EŞLEŞTİRME: Öğrenciler branşa, ilçeye, bütçeye ve ders biçimine (online / yüz yüze) göre eğitmen arar, uygun saati seçip rezervasyon oluşturur.",
          "KÜTÜPHANE VE ETÜT MERKEZİ KATALOĞU: Adana'daki çalışma mekânlarının konumu, çalışma saatleri ve olanakları (sessiz alan, wifi, kafeterya vb.) tek yerde listelenir.",
          "ÇALIŞMA ALANI REZERVASYONU: Anlaşmalı kütüphanelerde saatlik koltuk rezervasyonu yapılır; girişte QR kod okutularak kullanım başlar.",
          "DENEME SINAVI OTURUMLARI: Kütüphanelerin düzenlediği deneme sınavlarına çevrimiçi kayıt ve rezervasyon yapılır.",
          "EĞİTİM KİTABI SATIŞI: Mağazamızdan sipariş edilen basılı kitaplar, Adana içinde kendi araç ve kuryelerimizle elden teslim edilir.",
          "ÇALIŞMA ARAÇLARI: Görev takibi, aralıklı tekrar (flash kart), alışkanlık takibi ve deneme sonucu analizi gibi ücretsiz araçlar hesabınıza dâhildir."
        ),
      ],
    },
    {
      id: "nasil-calisiyor",
      heading: "Nasıl Çalışıyor?",
      blocks: [
        list(
          "Platformda ilan yayımlayan her eğitmen, yayına alınmadan önce başvurusu incelenerek onaylanır.",
          "Ders ücreti sunucu tarafında hesaplanır ve rezervasyon anında sabitlenir; ödeme adımında sürpriz tutar çıkmaz.",
          "Hizmet ödemeleri, hizmet gerçekleşene kadar emanette (escrow) tutulur; ders yapılmazsa ücret öğrenciye iade edilir.",
          "Ödemeler iyzico altyapısı üzerinden alınır; kart bilgileri Platform tarafından saklanmaz.",
          "Eğitmen ile öğrenci arasındaki mesajlaşma, güvenlik ve kayıt altına alınabilirlik için Platform içinde yürütülür."
        ),
      ],
    },
    {
      id: "iletisim-bilgileri",
      heading: "İletişim",
      blocks: [
        list(
          `E-posta: ${OPERATOR.email}`,
          `Telefon: ${OPERATOR.phone}`,
          `Adres: ${OPERATOR.address}`
        ),
        p(
          "Soru, talep ve şikâyetleriniz için İletişim sayfamızdaki formu da kullanabilirsiniz; başvurularınız aynı ekibe ulaşır."
        ),
      ],
    },
  ],
};

/** Tüm yasal belgeler — footer/menü sırası bu dizidir. */
/* ───────────────────────── Sıralama Ölçütleri ───────────────────────── */
//
// 6563 sayılı Kanun ve ETAHS Yönetmeliği, aracı hizmet sağlayıcının arama
// sonuçlarını hangi ölçütlere göre sıraladığını erişilebilir biçimde
// açıklamasını ister. Ticari Reklam ve Haksız Ticari Uygulamalar Yönetmeliği
// ise ücretli yerleşimin "Reklam" ibaresiyle ayırt edilmesini şart koşar.
// Bu belge ikisinin de karşılığıdır ve ÜRÜN DAVRANIŞIYLA BİRLİKTE değişir:
// sıralama mantığı değiştiğinde önce burası güncellenir.

const RANKING_CRITERIA: LegalDoc = {
  id: "ranking-criteria",
  title: "Sıralama Ölçütleri",
  description:
    "Adana Özel Ders'te eğitmen arama sonuçlarının hangi ölçütlere göre sıralandığı ve ücretli öne çıkarmanın nasıl çalıştığı.",
  updatedAt: "2026-08-29",
  sections: [
    {
      id: "ozet",
      heading: "Kısaca",
      blocks: [
        p(
          "Arama sonuçlarındaki sıralama satın alınamaz. Ücretli öne çıkarma ayrı bir bloktur, \"Reklam\" ibaresiyle gösterilir ve listenin geri kalanını hiçbir şekilde etkilemez."
        ),
      ],
    },
    {
      id: "organik-siralama",
      heading: "Organik sıralama neye göre yapılır",
      blocks: [
        p(
          "Filtrelerinize (ders, ilçe, eğitim şekli, fiyat aralığı, yaş, cinsiyet) uyan eğitmenler belirlendikten sonra sonuçlar şu ölçütlerle sıralanır:"
        ),
        list(
          "Değerlendirme puanı: öğrenci puanlarının ağırlıklı ortalaması. Az sayıda puanı olan eğitmenin ortalaması platform ortalamasına doğru dengelenir; böylece tek bir beş yıldız, yüzlerce dersi olan bir eğitmenin önüne geçmez.",
          "Konum: konumunuzu paylaştıysanız mesafe önceliklidir.",
          "Fiyat: fiyata göre sıralamayı siz seçerseniz o ölçüt öne alınır.",
          "Metin uyumu: arama kutusuna yazdığınız ifadenin ilan başlığı ve tanıtımıyla ne kadar örtüştüğü.",
          "Eşitlik hâlinde ilanın yayına giriş tarihi."
        ),
        p(
          "Eğitmenin platforma ödeme yapmış olması bu ölçütlerin hiçbirine girmez."
        ),
      ],
    },
    {
      id: "one-cikarma",
      heading: "Ücretli öne çıkarma",
      blocks: [
        p(
          "Eğitmenler ilanlarının arama sonuçlarının üstündeki ayrı blokta gösterilmesi için süreli bir paket satın alabilir. Bu blok her zaman \"Reklam\" ibaresi taşır."
        ),
        list(
          "Blokta aynı anda en fazla üç ilan gösterilir.",
          "Blok, aramanızla aynı filtrelere tabidir: Fizik ararken Matematik reklamı görmezsiniz.",
          "Uygun ilan sayısı üçten fazlaysa hangilerinin gösterileceği rastgele belirlenir; sıra, ödenen tutara veya satın alma zamanına göre değişmez.",
          "Eşleşen ücretli ilan yoksa blok hiç gösterilmez.",
          "Öne çıkarma yalnız görünürlük sağlar; eğitmenin puanını, yorumlarını veya organik sıradaki yerini değiştirmez."
        ),
      ],
    },
    {
      id: "egitmen-icin",
      heading: "Öne çıkarma satın alan eğitmenler için",
      blocks: [
        list(
          "Öne çıkarma yalnız onaylanmış ilanlar için satın alınabilir.",
          "Hizmet ödemenin onaylanmasıyla başlar ve satın alınan süre boyunca devam eder.",
          "Belirli sayıda görüntülenme, tıklanma veya öğrenci garantisi verilmez.",
          "Yürürlükteki paketiniz varken alınan yeni paket, mevcut paketin bitiminde başlar; süreler üst üste binmez.",
          "Hizmet anında ifa edildiğinden cayma hakkı istisnası kapsamındadır; satın alma sırasında bu istisna ayrıca onaylanır."
        ),
      ],
    },
    {
      id: "iletisim",
      heading: "Soru ve itiraz",
      blocks: [
        p(
          `Sıralama veya öne çıkarma hakkında sorunuz için ${OPERATOR.email} adresine yazabilirsiniz.`
        ),
        p(operatorIdentity()),
      ],
    },
  ],
};

export const LEGAL_DOCS: readonly LegalDoc[] = [
  ABOUT,
  KVKK,
  PRIVACY,
  TERMS,
  PRELIMINARY_INFO,
  DISTANCE_SALES,
  REFUND,
  COOKIES,
  RANKING_CRITERIA,
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
