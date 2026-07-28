// Sıkça Sorulan Sorular — TEK kaynak. Saf veri (JSX yok) → Vitest'lenebilir.
// Düzen `pages/FaqPage.tsx`'tedir; metin değişiklikleri yalnız burada yapılır.
//
// Kapsam kararı: burası pazarlama metni değil, DESTEK YÜKÜNÜ AZALTAN yerdir.
// Her cevap, işletmeye e-posta yazılmasını önleyecek kadar somut olmalı ve
// mümkünse ilgili sayfaya yönlendirmelidir.

export interface FaqItem {
  /** URL fragment'ı (anchor) — doğrudan paylaşılabilsin. */
  id: string;
  question: string;
  /** Düz metin paragraflar (JSX yok). */
  answer: string[];
}

export interface FaqCategory {
  id: string;
  title: string;
  items: FaqItem[];
}

export const FAQ: readonly FaqCategory[] = [
  {
    id: "siparis",
    title: "Sipariş ve teslimat",
    items: [
      {
        id: "teslimat-suresi",
        question: "Siparişim ne zaman elime ulaşır?",
        answer: [
          "Adana içi (Seyhan, Yüreğir, Çukurova, Sarıçam) siparişlerini kendi ekibimiz teslim ediyor. Saat 16.00'dan önce verilen ve ödemesi tamamlanan siparişler aynı gün, sonrasındakiler ertesi gün teslim edilir.",
          "Sipariş verirken ürün sayfasında ve sepette teslimat sözünü geri sayımla birlikte görürsün. Kesin gün, ödeme tamamlandığı anda sipariş detayına yazılır.",
        ],
      },
      {
        id: "kargo-ucreti",
        question: "Kargo ücreti ne kadar?",
        answer: [
          "500 TL ve üzeri fiziksel siparişlerde teslimat ücretsizdir. Altındaki siparişlerde sabit 49,90 TL teslimat ücreti uygulanır.",
          "Dijital ürünlerde (ders notu, PDF) teslimat ücreti yoktur; ödeme tamamlanır tamamlanmaz indirme bağlantın açılır.",
        ],
      },
      {
        id: "kargo-takip",
        question: "Siparişimi nasıl takip ederim?",
        answer: [
          "Siparişlerim sayfasından siparişinin durumunu görebilirsin. Kuryemiz yola çıktığında sana SMS ile bir takip bağlantısı gönderiyoruz; o bağlantıda kuryenin kaç durak uzakta olduğunu ve tahmini varış aralığını canlı görürsün.",
          "Takip bağlantısı için giriş yapman gerekmez.",
        ],
      },
      {
        id: "teslimat-tercihi",
        question: "Evde olmayacağım, ne yapmalıyım?",
        answer: [
          "Sipariş detayından teslimat tercihini değiştirebilirsin: kapıya bırakma, komşuya bırakma veya seni arayarak teslim. Kapıya ve komşuya bırakmada kurye fotoğraf çekerek teslim eder.",
          "Teslimatı bir sonraki güne de erteleyebilirsin (en fazla iki kez).",
        ],
      },
      {
        id: "bolge-disi",
        question: "Adana dışına gönderim yapıyor musunuz?",
        answer: [
          "Şu an fiziksel ürünlerde yalnızca Adana ve çevre ilçelere kendi ekibimizle teslimat yapıyoruz. Bölge dışı adreslerde sipariş oluşturamazsın.",
          "Dijital ürünler her yerden satın alınabilir.",
        ],
      },
    ],
  },
  {
    id: "iade",
    title: "İade ve iptal",
    items: [
      {
        id: "cayma-hakki",
        question: "Aldığım ürünü iade edebilir miyim?",
        answer: [
          "Evet. Fiziksel ürünlerde teslim tarihinden itibaren 14 gün içinde hiçbir gerekçe göstermeden cayma hakkını kullanabilirsin. Sipariş detayındaki “İade talebi” bağlantısından, hangi üründen kaç adet iade edeceğini seçmen yeterli.",
          "Cayma hakkı taleplerinde onay beklemene gerek yoktur; talep anında kabul edilir ve iade süreci başlar.",
        ],
      },
      {
        id: "kismi-iade",
        question: "Siparişimin sadece bir ürününü iade edebilir miyim?",
        answer: [
          "Evet. İade formunda her üründen kaç adet iade edeceğini ayrı ayrı seçebilirsin.",
          "Tüm siparişi iade edersen teslimat ücreti de geri ödenir. Kısmi iadede teslimat ücreti iade edilmez, çünkü teslimat gerçekleşmiştir. Kupon kullandıysan indirimin iade edilen ürünlere düşen kısmı hesaba katılır.",
        ],
      },
      {
        id: "dijital-iade",
        question: "Dijital ürünü iade edebilir miyim?",
        answer: [
          "Hayır. İndirme bağlantısı açıldıktan sonra dijital içerikte cayma hakkı kullanılamaz (Mesafeli Sözleşmeler Yönetmeliği m.15). Satın almadan önce ürün açıklamasını ve örnek sayfaları incelemeni öneririz.",
        ],
      },
      {
        id: "iade-suresi",
        question: "Param ne zaman hesabıma geçer?",
        answer: [
          "İade onaylandığında ödemeyi yaptığın karta iade talimatı aynı gün verilir. Tutarın kartına yansıması bankana bağlı olarak birkaç iş günü sürebilir.",
        ],
      },
      {
        id: "ders-iptal",
        question: "Ders rezervasyonumu iptal edebilir miyim?",
        answer: [
          "Ders başlamadan önce iptal edebilirsin; ödemen iade edilir. Ders tamamlandıktan sonra iptal yapılamaz.",
          "Deneme sınavı bileti ve çalışma alanı rezervasyonunda ödeme tamamlandıktan sonra iptal yapılamaz (katılmama durumunda iade yoktur).",
        ],
      },
    ],
  },
  {
    id: "ders",
    title: "Ders ve eğitmenler",
    items: [
      {
        id: "rezervasyon",
        question: "Nasıl ders alırım?",
        answer: [
          "Eğitmenler sayfasından branşa, fiyata ve konuma göre arama yapabilir, eğitmenin takviminden uygun saati seçerek rezervasyon oluşturabilirsin. Eğitmen talebini onayladıktan sonra ödeme adımı açılır.",
        ],
      },
      {
        id: "odeme-guvenlik",
        question: "Ödediğim para doğrudan eğitmene mi gidiyor?",
        answer: [
          "Hayır. Ders ücreti, ders tamamlanana kadar platformda emanette tutulur. Ders gerçekleştikten sonra eğitmene aktarılır. Ders iptal edilirse ödemen iade edilir.",
        ],
      },
      {
        id: "egitmen-secimi",
        question: "Eğitmenler nasıl seçiliyor?",
        answer: [
          "Platformda ilan açmak isteyen her eğitmen başvuru yapar; kimlik ve eğitim belgeleri incelendikten sonra yayına alınır. Onaylanmamış eğitmenler arama sonuçlarında görünmez.",
        ],
      },
      {
        id: "iletisim-kurallari",
        question: "Eğitmenle nasıl iletişim kurarım?",
        answer: [
          "Onaylanmış bir rezervasyonun varsa mesajlar bölümünden eğitmenle yazışabilirsin. Güvenliğin için mesajlarda telefon ve e-posta gibi iletişim bilgileri otomatik gizlenir.",
        ],
      },
    ],
  },
  {
    id: "hesap",
    title: "Hesap ve gizlilik",
    items: [
      {
        id: "hesap-silme",
        question: "Hesabımı nasıl silerim?",
        answer: [
          "Ayarlar → Oturum açma ve güvenlik → “Verilerim ve hesabım” bölümünden hesabını kapatabilirsin. İşlem geri alınamaz: adın, e-postan, telefonun ve adreslerin silinir.",
          "Devam eden siparişin veya yaklaşan onaylı dersin varsa silme işlemi, bunlar tamamlanana kadar bekletilir.",
        ],
      },
      {
        id: "verilerim",
        question: "Hakkımda tuttuğunuz verileri görebilir miyim?",
        answer: [
          "Evet. Ayarlar → “Verilerim ve hesabım” bölümünden verilerinin makine-okunur (JSON) kopyasını indirebilirsin.",
        ],
      },
      {
        id: "fatura-kayitlari",
        question: "Hesabımı silersem sipariş kayıtlarım da siliniyor mu?",
        answer: [
          "Sipariş ve ödeme kayıtları vergi mevzuatı gereği belirli bir süre saklanmak zorundadır; bu kayıtlar kimlik bilgilerinden arındırılmış olarak kalır. Seni tanımlayan veriler silinir.",
        ],
      },
      {
        id: "sifre",
        question: "Şifremi unuttum, ne yapmalıyım?",
        answer: [
          "Giriş sayfasındaki “Şifremi unuttum” bağlantısından e-posta adresine sıfırlama bağlantısı gönderebilirsin. Bağlantı kısa süre geçerlidir ve yalnızca bir kez kullanılabilir.",
          "Şifreni değiştirdiğinde diğer tüm cihazlardaki oturumların güvenlik için kapatılır.",
        ],
      },
    ],
  },
];

/** Tüm soruların düz listesi (arama/sayaç için). */
export function allFaqItems(): FaqItem[] {
  return FAQ.flatMap((c) => c.items);
}

export function getFaqCategory(id: string): FaqCategory | undefined {
  return FAQ.find((c) => c.id === id);
}
