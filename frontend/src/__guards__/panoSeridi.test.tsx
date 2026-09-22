/**
 * PANEL ŞERİDİ — eğitmenin kalıcı gezinme yüzeyi (kullanıcı kararı, 8 Eyl 2026).
 *
 * ## Karar
 *
 * Kullanıcı Superprof'un eğitmen panelini gösterdi: üst barın hemen altında
 * duran, sayfa değişse de yerinde kalan bir sekme satırı (Pano · Mesajlarım ·
 * İlanlarım · Değerlendirmeler · Hesabım).
 *
 * İLK DENEME BU DEĞİLDİ ve bu nöbetçi büyük ölçüde o denemenin dersidir:
 * şerit yerine avatar açılır menüsüne "Panom" adında bir satır eklendi, İlanım
 * ve Bakiyem ise menüden çıkarılıp panonun İÇİNE kısayol oldu. Sonuç: panele
 * giriş hâlâ tek bir açılırdı ve gezinme ÜÇ ayrı yere dağılmıştı (menü +
 * panonun içindeki kısayol satırı + `TutorAccountLayout`'un sol menüsü).
 * Kullanıcı: *"gerizekalı panom kısmı oluşturmasını istediğimi yapmadı."*
 *
 * Bu dosya, o üç yüzeyin yerine geçen şeridi çıpalar. Yerini aldığı nöbetçi
 * `panoKisayollari.test.ts`'ti; sözleşmesi (İlanım/Bakiyem menüde OLMASIN,
 * PANODA olsun) artık geçersiz — ikisi de şeritte.
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * Sekmelerin varlığı değil, **hiçbir eğitmen yüzeyinin erişilemez kalmaması**.
 * Gezinme üç yüzeyden bire toplandı; bu tür bir toplama sırasında bir ekranın
 * dışarıda kalması sessizdir: rota ayakta kalır, sayfa çalışır, tip kontrolü
 * geçer, yalnız kullanıcı oraya gidemez. Dördüncü düğüm tam olarak o gündür.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM'da çalışır (jsdom + gerçek `DashboardShell`), yani "şerit
 * gerçekten çiziliyor mu" iddiası davranışsaldır. Yerini aldığı test bunu
 * KAYNAK METNİNDEN okuyordu (`PANO.indexOf("<nav")`) — o yüzden bileşen
 * bölünse ya da etiket değişse doğru kodda bile kırılırdı. Ölçülmeyen şey
 * görsel yoğunluktur; ölçülen şey KİMLİK ve ERİŞİLEBİLİRLİK.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { DashboardShell } from "@/components/DashboardShell";
import {
  TUTOR_NAV,
  TUTOR_PANO_SEKMELERI,
  UYE_NAV,
  UYE_PANO_SEKMELERI,
  navForRole,
  panoSekmeleriForRole,
} from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import { useAuthStore } from "@/store/authStore";
import { ROLE_IDS } from "@/types";

const KOK = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
  ".."
);

function girisYap(roleId: number) {
  useAuthStore.setState({
    user: {
      id: 7,
      role_id: roleId,
      display_name: "Test",
      email: "t@example.com",
      email_verified: true,
    },
  } as never);
}

function kabuguCiz(roleId: number, baslangic = ROUTES.bookings) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[baslangic]}>
        {/* Gerçek öğretmen sayfaları `navItems`i açıkça geçer (şerit ise
            kabukta rolden türetilir); kurulum onu birebir taklit eder. */}
        <DashboardShell title="Test" navItems={navForRole(roleId)}>
          içerik
        </DashboardShell>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Şeritteki bağlantılar — üst bardan ve menüden AYRI okunur. */
function seritHedefleri(): string[] {
  const serit = screen.queryByRole("navigation", { name: "Panel bölümleri" });
  if (!serit) return [];
  return Array.from(serit.querySelectorAll("a[href]")).map(
    (a) => a.getAttribute("href") ?? ""
  );
}

afterEach(() => cleanup());

describe("panel şeridi · kimlik", () => {
  it("DOLULUK: yedi sekme, hepsi gerçek bir ROUTES hedefi", () => {
    // Bu olmadan aşağıdaki "şerit çiziliyor" iddiaları BOŞ bir listeyle de
    // geçerdi — hiçbir sekme çizilmez, hiçbir şey itiraz etmezdi.
    //
    // ALTI DEĞİL BEŞ (8 Eyl 2026, ikinci tur): "Hesabım" şeritten çıktı,
    // gerekçesi `lib/nav.ts`te. Sayı burada dondurulmuyor, ölçülüyor —
    // değişirse gerekçesiyle birlikte değişsin diye açık yazılı.
    //
    // DÖRT (17 Eyl 2026, kullanıcı kararı): "Bakiyem" şeritten kalktı. Kazanç
    // dökümü panodaki özet kartlarından açılan "Kazançlar" sayfasına taşındı;
    // erişilebilirliği aşağıdaki "Kazançlar" düğümü korur.
    // ÜÇ (17 Eyl 2026): "Değerlendirmeler" şeritten hesap menüsüne taşındı.
    // BEŞ (17 Eyl 2026, Modül 7, kullanıcı kararı): Takvim ve Analizler girdi.
    // ALTI (22 Eyl 2026, kullanıcı kararı): "İlanım" → "Profilim" yeniden
    // adlandırıldı, "Ayarlar" hesap menüsüyle BİLİNÇLİ tekrar olarak eklendi.
    // YEDİ (22 Eyl 2026, kullanıcı kararı): "Öğrenciler" girdi (Preply §4).
    // Sıra da karardır: Genel Bakış · Takvim · Mesajlar · Öğrenciler ·
    // Analizler · Profilim · Ayarlar.
    expect(TUTOR_PANO_SEKMELERI).toHaveLength(7);
    expect(TUTOR_PANO_SEKMELERI.map((s) => s.label)).toEqual([
      "Genel Bakış",
      "Takvim",
      "Mesajlar",
      "Öğrenciler",
      "Analizler",
      "Profilim",
      "Ayarlar",
    ]);
    const bilinen = new Set(
      Object.values(ROUTES).filter((v): v is string => typeof v === "string")
    );
    for (const sekme of TUTOR_PANO_SEKMELERI) {
      expect(sekme.label.length, "etiketsiz sekme").toBeGreaterThan(0);
      expect(bilinen.has(sekme.to), `${sekme.label} → ${sekme.to} ROUTES'ta yok`).toBe(true);
      expect(sekme.to, `${sekme.label} kök rotaya bağlı`).not.toBe("/");
    }
  });

  it("ÖĞRENCİ şeridi: dört sekme, sıra karardır, hepsi ROUTES hedefi", () => {
    // Modül 4 (18 Eyl 2026): öğrenci panosu açıldı ve şerit öğrenciye geldi.
    // Etiket gerekçeleri `lib/nav.ts::UYE_PANO_SEKMELERI`de. Favoriler bilerek
    // yok (üst bardaki kalp + menü taşıyor).
    expect(UYE_PANO_SEKMELERI.map((s) => s.label)).toEqual([
      "Genel Bakış",
      "Derslerim",
      "Mesajlar",
      "Ayarlar",
    ]);
    const bilinen = new Set(
      Object.values(ROUTES).filter((v): v is string => typeof v === "string")
    );
    for (const sekme of UYE_PANO_SEKMELERI) {
      expect(bilinen.has(sekme.to), `${sekme.label} → ${sekme.to} ROUTES'ta yok`).toBe(true);
      expect(sekme.to, `${sekme.label} kök rotaya bağlı`).not.toBe("/");
    }
    expect(UYE_PANO_SEKMELERI[0].to).toBe(ROUTES.bookings);
    expect(UYE_PANO_SEKMELERI[1].to).toBe(ROUTES.reservations);
    expect(UYE_PANO_SEKMELERI.some((s) => s.to === ROUTES.favorites)).toBe(false);
  });

  it("Pano sekmesi PANOYA gider, ana sayfaya değil", () => {
    // İlk denemede `to: "/"` yazılmıştı ve "Panom" eğitmen LİSTESİNİ açıyordu;
    // kullanıcı bunu hemen yakaladı. Düğüm o hatanın tekrarını engeller.
    const pano = TUTOR_PANO_SEKMELERI.find((s) => s.label === "Genel Bakış");
    expect(pano, "şeritte Pano sekmesi yok").toBeTruthy();
    expect(pano!.to).toBe(ROUTES.bookings);
  });
});

describe("panel şeridi · gerçekten çiziliyor", () => {
  it("öğretmende altı sekmenin hepsi DOM'da", () => {
    girisYap(ROLE_IDS.TUTOR);
    kabuguCiz(ROLE_IDS.TUTOR);
    expect(seritHedefleri().sort()).toEqual(
      TUTOR_PANO_SEKMELERI.map((s) => s.to).sort()
    );
  });

  it("aktif sekme `aria-current` taşır", () => {
    girisYap(ROLE_IDS.TUTOR);
    kabuguCiz(ROLE_IDS.TUTOR, ROUTES.tutorListing);
    const aktif = screen
      .getByRole("navigation", { name: "Panel bölümleri" })
      .querySelectorAll('a[aria-current="page"]');
    expect(aktif).toHaveLength(1);
    expect(aktif[0].getAttribute("href")).toBe(ROUTES.tutorListing);
  });

  it("öğrencide KENDİ dört sekmesi DOM'da (öğretmenin sekmeleri değil)", () => {
    // 8 Eyl'de "üye için şerit HİÇ çizilmez" yazıyordu; Modül 4'te (18 Eyl
    // 2026) öğrenci kendi şeridini aldı. Asıl tehlike aynı: eğitmen şeridi
    // öğrenciye sızarsa "İlanım"ı görür — o yüzden hedefler birebir ölçülür.
    girisYap(ROLE_IDS.CLIENT);
    kabuguCiz(ROLE_IDS.CLIENT);
    expect(seritHedefleri().sort()).toEqual(UYE_PANO_SEKMELERI.map((s) => s.to).sort());
    expect(panoSekmeleriForRole(ROLE_IDS.CLIENT)).toBe(UYE_PANO_SEKMELERI);
    expect(seritHedefleri()).not.toContain(ROUTES.tutorListing);
  });

  it.each([
    ["operatör", ROLE_IDS.LIBRARY_OPERATOR],
    ["yönetici", ROLE_IDS.ADMIN],
  ])("%s için şerit HİÇ çizilmez", (_ad, rol) => {
    // Operatörün kendi kabuğu (`OPERATOR_NAV`), yöneticinin `/yonetim`u var.
    girisYap(rol);
    kabuguCiz(rol);
    expect(seritHedefleri()).toEqual([]);
    expect(panoSekmeleriForRole(rol)).toBeUndefined();
  });
});

describe("panel şeridi · hiçbir yüzey erişilemez kalmadı", () => {
  it("şerit ∪ hesap menüsü — öğrencinin her yüzeyi bir yerden açılıyor", () => {
    // Modül 4: Mesajlar ve Rezervasyonlar menüden şeride taşındı. Taşımada
    // bir hedefin iki yüzeyden de düşmesi sessiz olur; burası konuşur.
    girisYap(ROLE_IDS.CLIENT);
    kabuguCiz(ROLE_IDS.CLIENT);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));
    const ulasilir = new Set(
      Array.from(document.body.querySelectorAll("a[href]")).map(
        (a) => a.getAttribute("href") ?? ""
      )
    );
    const beklenen = [...UYE_PANO_SEKMELERI, ...UYE_NAV.filter((i) => !i.yakinda)];
    const eksik = beklenen.filter((i) => !ulasilir.has(i.to));
    expect(eksik.map((i) => `${i.label} → ${i.to}`)).toEqual([]);
  });

  it("şerit ∪ hesap menüsü — öğretmenin her yüzeyi bir yerden açılıyor", () => {
    girisYap(ROLE_IDS.TUTOR);
    kabuguCiz(ROLE_IDS.TUTOR);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));

    const ulasilir = new Set(
      Array.from(document.body.querySelectorAll("a[href]")).map(
        (a) => a.getAttribute("href") ?? ""
      )
    );
    const beklenen = [
      ...TUTOR_PANO_SEKMELERI,
      ...TUTOR_NAV.filter((i) => !i.yakinda),
    ];
    const eksik = beklenen.filter((i) => !ulasilir.has(i.to));
    expect(
      eksik.map((i) => `${i.label} → ${i.to}`),
      "ne şeritte ne menüde: bu ekrana artık gidilemiyor"
    ).toEqual([]);
  });

  it("Kazançlar: Bakiyem şeritte yok, sayfa panodan açılıyor ve Pano sekmesi aktif kalıyor", () => {
    // Sekme kalktığında ekranın erişilemez kalması sessiz olur. Kazançlar'a
    // tek giriş panodaki özet kartlarıdır; kart bağlantısı düşerse burası konuşur.
    expect(TUTOR_PANO_SEKMELERI.map((s) => s.label)).not.toContain("Bakiyem");
    expect(TUTOR_PANO_SEKMELERI.map((s) => s.to)).not.toContain(ROUTES.balance);
    const ozet = readFileSync(
      join(KOK, "src", "components", "pano", "OzetKartlari.tsx"),
      "utf8"
    );
    expect(ozet).toContain("ROUTES.tutorEarnings");
    const pano = TUTOR_PANO_SEKMELERI.find((s) => s.label === "Genel Bakış");
    expect(pano?.altYollar).toContain(ROUTES.tutorEarnings);
  });

  it("şeritteki hedefler rol menüsünde TEKRARLANMAZ", () => {
    // Gezinmenin üç yüzeye dağılmasının sebebi tam olarak buydu: aynı
    // bağlantı hem menüde hem başka bir yerde duruyordu ve hangisinin asıl
    // olduğu belirsizleşiyordu.
    for (const [serit, menu] of [
      [TUTOR_PANO_SEKMELERI, TUTOR_NAV],
      [UYE_PANO_SEKMELERI, UYE_NAV],
    ] as const) {
      const seritte = new Set(serit.map((s) => s.to));
      const cakisan = menu.filter((i) => seritte.has(i.to));
      expect(cakisan.map((i) => i.label)).toEqual([]);
    }
  });

  it("öğretmen menüsünün ilk satırı PANOM ve panoya gider", () => {
    /*
     * Kullanıcı kararı (8 Eyl 2026): *"hesabım tıklamıcaz menüden Panom
     * yazıcak ona tıklayacağız."*
     *
     * Bu, şeritle bilinçli bir TEKRARDIR ve yukarıdaki "tekrarlanmaz"
     * kuralının tek istisnasıdır: eğitmen ana sayfadayken (Landing) şerit
     * çizilmez, yani panele dönüş yolu yalnız bu satırdır. Satır "Hesabım"a
     * geri dönerse eğitmen ana sayfadan panosuna gidemez — sayfa çalışır,
     * hiçbir test kırılmaz, yalnız yol kapanır.
     */
    girisYap(ROLE_IDS.TUTOR);
    kabuguCiz(ROLE_IDS.TUTOR);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));

    const panom = screen.getAllByRole("link", { name: /Genel Bakış/ });
    expect(panom.length, "menüde Panom satırı yok").toBeGreaterThan(0);
    expect(panom[0].getAttribute("href")).toBe(ROUTES.bookings);

    /*
     * HESABIN TEK GİRİŞİ MENÜDEKİ "Hesap ayarları" SATIRIDIR (ikinci tur).
     *
     * "Hesabım" sekmesi şeritten kalktı; eğer bu satır da menüden düşerse
     * eğitmen şifresini, telefonunu, ödeme bilgilerini ve hesap silmeyi
     * HİÇBİR YERDEN açamaz. Rota ayakta kalır, sayfa çalışır, tip kontrolü
     * geçer — yalnız yol kapanır. Sessiz kaybın tam tanımı.
     */
    const hesapAyarlari = screen.getAllByRole("link", { name: /^Ayarlar$/ });
    expect(hesapAyarlari.length, "menüde hesap ayarları girişi yok").toBeGreaterThan(0);
    expect(hesapAyarlari[0].getAttribute("href")).toBe(ROUTES.settings);

    // "Hesabım" eğitmende artık NE şeritte NE menüde.
    expect(
      screen.queryAllByRole("link", { name: "Hesabım" }).length,
      "Hesabım geri gelmiş — karar bu değildi"
    ).toBe(0);
  });

  it("öğrencide de menünün ilk satırı PANOM ve panoya gider", () => {
    /*
     * 8 Eyl'de burada "üyenin menüsü DEĞİŞMEDİ: ilk satır Hesabım" yazıyordu;
     * gerekçesi üyenin şeridi olmamasıydı. Modül 4'te (18 Eyl 2026) öğrenci
     * panosu ve şeridi geldi, eğitmenin gerekçesi öğrenci için de geçerli
     * oldu: ana sayfada (Landing) şerit çizilmez, panoya dönüş bu satırdır.
     * Hesap merkezi kaybolmadı — şeridin dördüncü sekmesi ("Ayarlar",
     * 22 Eyl 2026'ya kadar "Hesabım").
     */
    girisYap(ROLE_IDS.CLIENT);
    kabuguCiz(ROLE_IDS.CLIENT);
    fireEvent.click(screen.getByRole("button", { name: "Hesap menüsü" }));

    const panom = screen.getAllByRole("link", { name: /Genel Bakış/ });
    expect(panom[0].getAttribute("href")).toBe(ROUTES.bookings);
    const ayarlar = screen.getAllByRole("link", { name: "Ayarlar" });
    expect(ayarlar.some((a) => a.getAttribute("href") === ROUTES.settings)).toBe(true);
  });

  it("HESABIM'dan taşınan yüzeyler İlanım'da duruyor", () => {
    /*
     * "Hesabım" sekmesi kalkarken içindeki üç şey dağıtıldı: fotoğraf ve
     * eğitim/diploma İlanım'a, kimlik alanları zaten oldukları Ayarlar'a.
     *
     * Bu taşımanın sessiz kaybı şudur: fotoğraf ya da eğitim bloğu İlanım'dan
     * silinirse eğitmen profil fotoğrafını değiştiremez ve diploma
     * yükleyemez — ama hiçbir rota kırılmaz, hiçbir test kırılmazdı. Üstelik
     * diploma, ilan yayına girmenin ön koşulu olan doluluk ölçerinin sekiz
     * maddesinden biridir: kaybı doğrudan gelir kaybıdır.
     */
    const ilanim = readFileSync(
      join(KOK, "src", "pages", "TutorSettings.tsx"),
      "utf8"
    );
    // Adı değil AÇILIŞ ETİKETİNİ arar. İlk yazımda `includes("ProfilFotografi")`
    // yazılmıştı ve mutasyon provası kaçtı: bileşen JSX'ten silinse bile
    // `import` satırı kaynakta kalıyor ve eşleşme sağlıyordu.
    expect(
      ilanim.includes("<ProfilFotografi"),
      "profil fotoğrafı İlanım'dan düşmüş — öğretmen fotoğrafını değiştiremez"
    ).toBe(true);
    expect(
      ilanim.includes("<EducationSection"),
      "eğitim/diploma bloğu İlanım'dan düşmüş — belge yüklenemez, ilan yayına giremez"
    ).toBe(true);
    expect(
      ilanim.includes("withDocument"),
      "belge yükleme kapalı — EducationSection var ama diploma alanı yok"
    ).toBe(true);
  });

  it("`/pano/hesabim` öğretmende 404 DEĞİL, ayarlara yönlendirir", () => {
    // Rota üretimde canlıydı ve eski bildirim satırları (ad değişikliği) hâlâ
    // onu taşıyor. Sekme kalktı diye rotanın düşmesi, o bildirimlere tıklayan
    // eğitmene 404 gösterirdi.
    const app = readFileSync(join(KOK, "src", "App.tsx"), "utf8");
    const dagitici = app.slice(
      app.indexOf("function AccountDispatcher"),
      app.indexOf("function BookingsHome")
    );
    expect(dagitici, "AccountDispatcher bulunamadı").not.toBe("");
    expect(
      /ROLE_IDS\.TUTOR[\s\S]*?Navigate[\s\S]*?ROUTES\.settings/.test(dagitici),
      "öğretmen `/pano/hesabim`e giderse artık boş/ölü bir ekran görüyor"
    ).toBe(true);
  });

  it("ÖNE ÇIKAR sayfasının girişi duruyor", () => {
    /*
     * `/ilanimi-one-cikar`ın TEK girişi `TutorAccountLayout`'un sol menüsüydü.
     * O kabuk bu paketle silindi (üç bölümünden ikisi şeride taşınınca geriye
     * tek öğe kalmıştı). Bağlantı İlan Ayarları sayfasına taşındı; oradan da
     * silinirse sayfa hiçbir yerden açılamaz — rota ayakta, test yeşil,
     * kullanıcı kilitli. Kaynak sözleşmesi: bağlantının hangi koşulda
     * çizildiğini değil, sayfada DURDUĞUNU çıpalar.
     */
    const ilanAyarlari = readFileSync(
      join(KOK, "src", "pages", "TutorSettings.tsx"),
      "utf8"
    );
    expect(
      ilanAyarlari.includes("ROUTES.tutorPromotion"),
      "öne çıkarma sayfasına giden son bağlantı da silinmiş"
    ).toBe(true);
    // Şeritte olmadığını da yazıyoruz: biri şeride eklerse bu düğüm
    // gerekçesiyle birlikte gözden geçirilsin, sessizce fazlalık olmasın.
    expect(
      TUTOR_PANO_SEKMELERI.some((s) => s.to === ROUTES.tutorPromotion)
    ).toBe(false);
  });
});
