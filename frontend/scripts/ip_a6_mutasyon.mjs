/**
 * İP-A6 · Mutasyon provası.
 *
 * Üç küme:
 *
 *   A. **Eşik nöbetçileri** — dördü de bu pakette AŞAĞI çekildi
 *      (158→131, 56→30, 35→29, 5→4). Düşen bir eşik, yükselen bir eşikten
 *      daha kolay yanlış-yeşil üretir: sayı zaten düştüğü için "≤" bol marj
 *      taşıyor sanılır. Her biri gerçek JSX ile kırılır.
 *
 *   B. **Ölçüm kaçışı** (Görev 1 / TB-A5-1) — taban listesi artık ölçümün
 *      KAYNAĞI. Dosyayı ağacın dışına taşımak, listeden çıkarmak ve ağaca
 *      listelenmemiş dosya eklemek AYRI AYRI sınanır.
 *
 *   C. **Yeni davranışlar** — rota gezinmesi bekçisi, dal testi, gönder
 *      kapısının yokluğu ve odak kurtarması. Bunların hepsi "bir koruma
 *      söküldüğünde test gerçekten kırılıyor mu" sorusudur.
 *
 * GÜVENLİK (kök CLAUDE.md §D): sürücü `git checkout --` KULLANMAZ. Dosyanın
 * ham baytları bellekte tutulur ve aynen geri yazılır; başlangıçta ve sonda
 * `git status --porcelain` karşılaştırılır. Dosya TAŞIMA mutasyonu için de
 * aynı kural geçerlidir: dosya geri taşınır ve oluşturulan dizin silinir.
 *
 * Kullanım (frontend/ dizininden):  node scripts/ip_a6_mutasyon.mjs
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const NOBETCILER = "src/__guards__";
const DAL_TEST = "src/pages/dashboards/adminStoreDalAdlari";
const GEZINME_TEST = "src/components/admin/ui2/gezinmeBekcisi.test.tsx";

const URUN_FORM = "src/components/admin/store/ProductForm.tsx";
const KUPON = "src/components/admin/store/CouponsPanel.tsx";
const KATEGORI = "src/components/admin/store/CategoriesPanel.tsx";
const IADE = "src/components/admin/store/ReturnsPanel.tsx";
const DUZENLEME = "src/components/admin/store/EditProductModal.tsx";
const BEKCI = "src/components/admin/ui2/kirliFormBekcisi.tsx";
const SAYAC = "scripts/ui-baseline-sayim.mjs";

/**
 * Satır sonu bağımsız arama/değiştirme.
 *
 * Bu depoda dosyaların bir kısmı CRLF, bir kısmı LF. Sürücünün desenleri LF
 * yazılıyor ve CRLF dosyalarda SESSİZCE eşleşmiyordu — mutasyon uygulanmıyor,
 * "yakalanmadı" gibi okunuyordu (ilk koşuda üç kalemde yaşandı). Artık desen
 * hedefin satır sonuna uyarlanır; uymazsa `uygula` değişmemiş metin döndürür
 * ve sürücü bunu AÇIKÇA "uygulanamadı" diye raporlar.
 */
function degistir(kaynak, ara, koy) {
  if (kaynak.includes(ara)) return kaynak.replace(ara, koy);
  const araCrlf = ara.replace(/\n/g, "\r\n");
  const koyCrlf = koy.replace(/\n/g, "\r\n");
  if (kaynak.includes(araCrlf)) return kaynak.replace(araCrlf, koyCrlf);
  return kaynak;
}

/** Kupon ızgarasının kapanışı — JSX eklemek için güvenli ayraç. */
const KUPON_AYRAC = "          </div>\n\n          {/* YALNIZ genel/sunucu hatası";

const MUTASYONLAR = [
  /* ═══════════════ A · eşik nöbetçileri ═══════════════ */
  {
    ad: "A1 · ham <button> eklenirse (eşik 131)",
    dosya: KUPON,
    hedef: NOBETCILER,
    uygula: (s) =>
      degistir(
        s,
        KUPON_AYRAC, `          </div>\n          <button type="button">Ham</button>\n\n          {/* YALNIZ genel/sunucu hatası`),
    beklenen: /ham <button sayısı artamaz/,
  },
  {
    ad: "A2 · etiketsiz form kontrolü eklenirse (eşik 30)",
    dosya: KUPON,
    hedef: NOBETCILER,
    uygula: (s) =>
      degistir(
        s,
        KUPON_AYRAC, `          </div>\n          <input className="input" placeholder="Serbest not" />\n\n          {/* YALNIZ genel/sunucu hatası`),
    beklenen: /erişilebilir adı olmayan form kontrolü artamaz/,
  },
  {
    ad: "A3 · ekranda pencere durumu geri gelirse (eşik 29)",
    dosya: IADE,
    hedef: NOBETCILER,
    uygula: (s) => {
      const bir = degistir(
        s,
        "  const [onlyPending, setOnlyPending] = useState(true);",
        "  const [onlyPending, setOnlyPending] = useState(true);\n" +
          "  const [ekPencere, setEkPencere] = useState(false);"
      );
      return degistir(
        bir,
        '      <ConfirmDialog\n        open={kararYuzeyi.kayit?.action === "approve"}',
        '      <ConfirmDialog open={ekPencere} title="x" description="" confirmLabel="x" onClose={() => setEkPencere(false)} onConfirm={() => setEkPencere(false)} />\n' +
          '      <ConfirmDialog\n        open={kararYuzeyi.kayit?.action === "approve"}'
      );
    },
    beklenen: /ekranda yaşayan pencere durumu artamaz|pencere durumu tutan dosya listesi/,
  },
  {
    ad: "A4 · etiketsiz overlay geri gelirse (eşik 4)",
    dosya: KUPON,
    hedef: NOBETCILER,
    uygula: (s) =>
      degistir(
        s,
        
        '    <div className="space-y-6">',
        '    <div className="space-y-6">\n      <div className="fixed inset-0 z-50" />'
      ),
    beklenen: /overlay sayısı artamaz|etiketsiz overlay'i olan dosya listesi/,
  },

  /* ═══════════════ B · ölçüm kaçışı (Görev 1) ═══════════════ */
  {
    ad: "B1 · KAÇIŞ: ölçülen dosya ağacın DIŞINA taşınırsa",
    hedef: NOBETCILER,
    // İP-A5'te bu kaçış dört eşiğin dördünü de GEÇİYORDU (158→151, 56→39).
    tasima: { kaynak: URUN_FORM, hedefYol: "src/pages/kacis/ProductForm.tsx" },
    beklenen: /listesindeki HER dosya diskte durur/,
  },
  {
    ad: "B2 · KAÇIŞ: dosya taban listesinden çıkarılırsa",
    dosya: SAYAC,
    hedef: NOBETCILER,
    uygula: (s) => degistir(s, '  "src/components/admin/store/ProductForm.tsx",\n', ""),
    beklenen: /ölçülen dosya kümesi listenin TA KENDİSİDİR|listede yazılıdır/,
  },
  {
    ad: "B3 · KAÇIŞ: listelenmemiş yeni panel dosyası eklenirse",
    hedef: NOBETCILER,
    yeniDosya: {
      yol: "src/components/admin/store/OlculmeyenPanel.tsx",
      icerik: 'export function OlculmeyenPanel() {\n  return <button type="button">Ham</button>;\n}\n',
    },
    beklenen: /listede yazılıdır/,
  },

  /* ═══════════════ C · yeni davranışlar ═══════════════ */
  {
    ad: "C1 · rota gezinmesi: kirli form kaydı kurulmazsa",
    dosya: BEKCI,
    hedef: GEZINME_TEST,
    uygula: (s) => degistir(s, "  useGezinmeKorumasi(korumali);", "  useGezinmeKorumasi(false);"),
    beklenen: /G2|G8/,
  },
  {
    ad: "C2 · rota gezinmesi: form sökülünce kayıt temizlenmezse",
    dosya: "src/components/admin/ui2/gezinmeBekcisi.tsx",
    hedef: GEZINME_TEST,
    uygula: (s) =>
      degistir(
        s,
        
        "    return () => {\n      korumaliYuzeyler.delete(kimlik);\n    };",
        "    return () => {};"
      ),
    beklenen: /G5/,
  },
  {
    ad: "C3 · dal testi: koşullu bir alanın etiketi kaldırılırsa",
    dosya: URUN_FORM,
    hedef: DAL_TEST,
    // "Stok değişikliği açıklaması" YALNIZ `DIGER` gerekçesinde render edilir:
    // dal testi olmasaydı bu alan üretime adsız çıkar ve sayaç 0 borç derdi
    // (statik olarak hâlâ `Form.Control` içinde görünüyor).
    uygula: (s) =>
      degistir(
        s,
        
        "                    <Form.Label>Stok değişikliği açıklaması</Form.Label>\n",
        ""
      ),
    beklenen: /erişilebilir adı olmayan kontrol|Stok değişikliği açıklaması/,
  },
  {
    ad: "C4 · gönder kapısı geri konursa (düğme geçerlilikte kapanırsa)",
    dosya: URUN_FORM,
    hedef: DAL_TEST,
    uygula: (s) =>
      degistir(
        s,
        
        '      <Button className="sm:col-span-2" isPending={mutation.isPending} onClick={gonder}>',
        '      <Button className="sm:col-span-2" disabled={!form.formState.isValid} isPending={mutation.isPending} onClick={gonder}>'
      ),
    beklenen: /düğme AÇIK|disabled/i,
  },
  {
    ad: "C5 · odak ilk hatalı alana taşınmazsa",
    dosya: URUN_FORM,
    hedef: DAL_TEST,
    uygula: (s) => degistir(s, "      setOdakAlani(ilk);", "      void ilk;"),
    beklenen: /odak ilk hatalı alanda|D-4/,
  },
  {
    ad: "C6 · katlanmış bölüm hata varken AÇILMAZSA",
    dosya: URUN_FORM,
    hedef: DAL_TEST,
    uygula: (s) =>
      degistir(
        s,
        
        "      if (KUNYE_ALANLARI.has(ilk)) setShowSpecs(true);",
        "      if (false) setShowSpecs(true);"
      ),
    beklenen: /KATLANMIŞ künye|Sayfa sayısı/,
  },
  {
    ad: "C7 · geçersiz veri sunucuya GİDERSE (handleSubmit kapısı kesilirse)",
    dosya: URUN_FORM,
    hedef: DAL_TEST,
    uygula: (s) =>
      degistir(
        s,
        
        "  const gonder = form.handleSubmit(",
        "  const gonder = ((f) => () => f(form.getValues()))("
      ),
    beklenen: /postSayisi|istek GİTMEZ|expected 1 to be 0/i,
  },
  {
    ad: "C8 · düzenleme penceresi ortak yüzeyden çıkarılırsa (ham overlay'e döner)",
    dosya: DUZENLEME,
    hedef: NOBETCILER,
    uygula: (s) => {
      const bir = degistir(
        s,
        '    <DuzenlemePenceresi yuzey={yuzey} baslik="Ürünü düzenle">',
        '    <div className="fixed inset-0 z-[100]">'
      );
      return degistir(bir, "    </DuzenlemePenceresi>", "    </div>");
    },
    beklenen: /overlay/i,
  },
  {
    ad: "C9 · BULGU: etiket kalkınca SAYAÇ görmez, DAL TESTİ görür",
    dosya: KATEGORI,
    // Hedef bilinçli olarak dal testi: `Form.Control` sayaç için bir
    // SARMALAYICIDIR ve içindeki kontrolü koşulsuz "adlandırılmış" sayar.
    // `Form.Label` silinince statik sayı DEĞİŞMEZ (ölçüldü: eşik geçti);
    // gerçek erişilebilir adı yalnız dal testi okur. İP-A4'ün dal testini
    // zorunlu kılma gerekçesinin canlı kanıtı budur.
    hedef: DAL_TEST,
    uygula: (s) =>
      degistir(s, "                  <Form.Label>Kategori adı</Form.Label>\n", ""),
    beklenen: /erişilebilir adı olmayan kontrol|Kategori adı/,
  },
  {
    ad: "C10 · sıralama göstergesi ekran okuyucudan gizlenirse",
    dosya: "src/components/admin/data-table/DataTable.tsx",
    hedef: DAL_TEST,
    uygula: (s) => degistir(s, "                      aria-sort={", "                      data-sort={"),
    beklenen: /aria-sort|D-5/,
  },
];

function gitDurumu() {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd: "..",
    encoding: "utf8",
  });
}

function testKos(hedef) {
  try {
    const cikti = execFileSync(
      "npx",
      ["vitest", "run", hedef, "--reporter=basic"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true }
    );
    return { gecti: true, cikti };
  } catch (e) {
    return { gecti: false, cikti: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const baslangicDurumu = gitDurumu();

const hedefler = [...new Set(MUTASYONLAR.map((m) => m.hedef))];
for (const h of hedefler) {
  const ilk = testKos(h);
  if (!ilk.gecti) {
    console.error(`HATA: ${h} mutasyondan ÖNCE zaten kırmızı. Prova anlamsız.`);
    process.exit(1);
  }
}
console.log(`Taban: ${hedefler.length} hedef kümesinin hepsi YEŞİL.\n`);

let hepsiYakalandi = true;

for (const m of MUTASYONLAR) {
  let geriAl;

  if (m.tasima) {
    const { kaynak, hedefYol } = m.tasima;
    const dizin = hedefYol.slice(0, hedefYol.lastIndexOf("/"));
    const dizinVarmis = existsSync(dizin);
    if (!dizinVarmis) mkdirSync(dizin, { recursive: true });
    renameSync(kaynak, hedefYol);
    geriAl = () => {
      renameSync(hedefYol, kaynak);
      if (!dizinVarmis) rmSync(dizin, { recursive: true, force: true });
    };
  } else if (m.yeniDosya) {
    writeFileSync(m.yeniDosya.yol, m.yeniDosya.icerik, "utf8");
    geriAl = () => rmSync(m.yeniDosya.yol, { force: true });
  } else {
    const orijinal = readFileSync(m.dosya, "utf8");
    const bozuk = m.uygula(orijinal);
    if (bozuk === orijinal) {
      console.error(`✗ ${m.ad}: mutasyon UYGULANAMADI (desen bulunamadı).`);
      hepsiYakalandi = false;
      continue;
    }
    writeFileSync(m.dosya, bozuk, "utf8");
    geriAl = () => writeFileSync(m.dosya, orijinal, "utf8");
  }

  const sonuc = testKos(m.hedef);
  geriAl();

  const yakalandi = !sonuc.gecti && m.beklenen.test(sonuc.cikti);
  hepsiYakalandi &&= yakalandi;
  console.log(
    `${yakalandi ? "✓" : "✗"} ${m.ad}: mutasyon ${
      sonuc.gecti ? "YAKALANMADI (nöbetçi geçti!)" : "yakalandı"
    }`
  );

  const geri = testKos(m.hedef);
  if (!geri.gecti) {
    console.error("  ✗ geri alma sonrası test hâlâ kırmızı — DUR.");
    process.exit(1);
  }
}

const sonDurum = gitDurumu();
if (sonDurum !== baslangicDurumu) {
  console.error("\n✗ ÇALIŞMA AĞACI DEĞİŞTİ — sürücü temiz kapanmadı.");
  console.error(`önce:\n${baslangicDurumu}\nsonra:\n${sonDurum}`);
  process.exit(1);
}
console.log("\nÇalışma ağacı başlangıçtaki hâline döndü.");
process.exit(hepsiYakalandi ? 0 : 1);
