// @vitest-environment node
/**
 * Sayacın kendisinin testi (İP-A2).
 *
 * `uiBaseline.test.ts` eşikleri tutar; bu dosya **eşiği ölçen aletin** doğru
 * ölçtüğünü tutar. İkisi ayrı: alet bozulursa eşik testi sessizce geçer
 * (yalancı yeşil), çünkü sayı düşer ve "artamaz" yönü memnun olur.
 *
 * Ölçülen kusur gerçekti: İP-A1 sürümü ham metinde regex ile sayıyordu ve
 * `AdminStore.tsx`'te bir YORUM satırında geçen `<label>` sözcüğünü gerçek
 * etiket sanıyordu (58 yerine 59). Yön "artamaz" olduğu için bu bir sessiz
 * geçiş üretmiyordu; ama eşikler A6-A7'de aşağı çekilecek ve yorumda kalmış
 * bir etiket MEŞRU bir düşüşü bloklardı.
 */
import { describe, expect, it } from "vitest";
import { dosyaOlcumu } from "../../scripts/ui-baseline-sayim.mjs";

describe("İP-A2 sayaç: yorum ve string sayılmaz", () => {
  it("satır yorumundaki <button sayılmaz", () => {
    const kaynak = `
      export function X() {
        // eskiden burada bir <button vardı, Button'a çevrildi
        return <Button>Tamam</Button>;
      }
    `;
    expect(dosyaOlcumu(kaynak).rawButton).toBe(0);
  });

  it("JSX içine gömülü blok yorumdaki <button sayılmaz", () => {
    const kaynak = `
      export function X() {
        return (
          <div>
            {/* TODO: <button className="x" /> yerine Button kullan */}
            <Button>Tamam</Button>
          </div>
        );
      }
    `;
    expect(dosyaOlcumu(kaynak).rawButton).toBe(0);
  });

  it("string ve şablon içindeki <label sayılmaz", () => {
    const kaynak = [
      "const ornek = '<label htmlFor=\"a\">Ad</label>';",
      "const sablon = `<label>${x}</label>`;",
      "export const Y = () => <div>{ornek}{sablon}</div>;",
    ].join("\n");
    const o = dosyaOlcumu(kaynak);
    expect(o.labels).toBe(0);
    expect(o.labelsWithHtmlFor).toBe(0);
  });

  it("gerçek JSX bozulmadan sayılır (ters prova: sayaç her şeyi 0'lamıyor)", () => {
    // Yukarıdaki üç test tek başına, `dosyaOlcumu` daima 0 dönse de geçerdi.
    // Bu test o yalancı yeşili kapatır.
    const kaynak = `
      export function X() {
        return (
          <form>
            <label htmlFor="ad">Ad</label>
            <input id="ad" />
            <label>Soyad<input /></label>
            <button type="submit">Gönder</button>
            <button />
          </form>
        );
      }
    `;
    const o = dosyaOlcumu(kaynak);
    expect(o.rawButton).toBe(2);
    expect(o.labels).toBe(2);
    expect(o.labelsWithHtmlFor).toBe(1);
  });

  it("Türkçe kesme işareti JSX metnini string sanıp yutmuyor", () => {
    // Elle yazılmış bir tarayıcının battığı yer burasıydı: `Medusa'nın`daki
    // kesme işareti string başlangıcı sanılırsa sonraki JSX'in tamamı kaybolur.
    const kaynak = `
      export function X() {
        return (
          <div>
            <p>Medusa'nın preset'i alındı; ekranların hiçbiri bozulmadı.</p>
            <button>Kapat</button>
          </div>
        );
      }
    `;
    expect(dosyaOlcumu(kaynak).rawButton).toBe(1);
  });

  it("<ButtonGroup> ham <button sayılmaz (etiket adı tam eşleşir)", () => {
    const kaynak = `export const X = () => <ButtonGroup><Button /></ButtonGroup>;`;
    expect(dosyaOlcumu(kaynak).rawButton).toBe(0);
  });

  it("overlay sınıfı yalnız string içinde sayılır, yorumda değil", () => {
    const yorum = `
      // fixed inset-0 kullanan eski overlay kaldırıldı
      export const X = () => <div className="relative" />;
    `;
    expect(dosyaOlcumu(yorum).overlays).toBe(0);

    const gercek = `
      export const X = () => (
        <div className="fixed inset-0 bg-black/40" role="dialog" aria-modal="true" />
      );
    `;
    const o = dosyaOlcumu(gercek);
    expect(o.overlays).toBe(1);
    expect(o.dialogRoles).toBe(1);
    expect(o.ariaModals).toBe(1);
  });

  it("İP-A3c — React.createElement(\"button\") de ham buton sayılır", () => {
    // Denetim P3-1: JSX olmayan ham buton sayaçtan kaçıyordu (mutasyon M2
    // GEÇMİŞTİ). Bugün kod tabanında yok; kapatma sebebi kaza riski.
    expect(
      dosyaOlcumu(`export const X = () => React.createElement("button", null, "Tamam");`)
        .rawButton
    ).toBe(1);
    expect(
      dosyaOlcumu(`export const X = () => createElement("button", null);`).rawButton
    ).toBe(1);
    // TERS PROVA: başka etiket ya da bileşen sayılmaz.
    expect(
      dosyaOlcumu(`export const X = () => createElement("div", null);`).rawButton
    ).toBe(0);
    expect(
      dosyaOlcumu(`export const X = () => createElement(Button, null);`).rawButton
    ).toBe(0);
  });

  it("İP-A3c — @medusajs/ui ALT YOL importu da ihlaldir", () => {
    // Denetim P3-1: `@medusajs/ui/dist/esm/components/button` mimari kuralı
    // aynen çiğner ama eski kontrol yalnız tam eşitliğe bakıyordu (M5 GEÇMİŞTİ).
    expect(
      dosyaOlcumu(
        `import { Button } from "@medusajs/ui/dist/esm/components/button";`
      ).medusaImport
    ).toBe(true);
    // TERS PROVA: adı benzeyen başka bir paket ihlal değildir.
    expect(
      dosyaOlcumu(`import x from "@medusajs/ui-preset";`).medusaImport
    ).toBe(false);
  });

  it("@medusajs/ui importu import/export/dinamik biçimlerinde görülür", () => {
    expect(dosyaOlcumu(`import { Button } from "@medusajs/ui";`).medusaImport).toBe(
      true
    );
    expect(dosyaOlcumu(`export { Button } from "@medusajs/ui";`).medusaImport).toBe(
      true
    );
    expect(
      dosyaOlcumu(`const m = await import("@medusajs/ui");`).medusaImport
    ).toBe(true);
    // Yorumda geçen ad bağımlılık değildir.
    expect(
      dosyaOlcumu(`// "@medusajs/ui" buraya asla import edilmez`).medusaImport
    ).toBe(false);
  });
});

/**
 * İP-A3a metriği: erişilebilir adı olmayan form kontrolü.
 *
 * Bu testlerin YARISI (adlandırma biçimleri) tek başına, `adsizKontrol` daima
 * 0 dönse de geçerdi. Bu yüzden ilk test bir TERS PROVADIR: gerçekten adsız
 * kontroller doğru sayıyla yakalanır. İkisi birlikte olmadan metrik kanıtsız.
 */
describe("İP-A3a sayaç: adsız form kontrolü", () => {
  it("TERS PROVA — adsız kontroller gerçekten sayılır (sayaç 0'lamıyor)", () => {
    const kaynak = `
      export function X() {
        return (
          <div>
            <input className="input" placeholder="Yazar" />
            <select className="input"><option value="">Seçin…</option></select>
            <textarea className="input" />
          </div>
        );
      }
    `;
    const o = dosyaOlcumu(kaynak);
    expect(o.kontrolToplam).toBe(3);
    expect(o.adsizKontrol).toBe(3);
    // Satır numaraları raporlanabilir olmalı: "41 borç var" demek yetmez,
    // göç eden kişi nereye bakacağını bilmeli.
    expect(o.adsizKontrolSatirlari).toHaveLength(3);
  });

  it("placeholder erişilebilir ad DEĞİLDİR — borç sayılmaya devam eder", () => {
    // Bilinçli karar: placeholder yazılınca kaybolur, ekran okuyucuda
    // güvenilmez, kontrast kuralına uymaz. Kabul edilseydi metrik bu kod
    // tabanında neredeyse boşalır ve hiçbir şey ölçmezdi.
    const o = dosyaOlcumu(`export const X = () => <input placeholder="Ad" />;`);
    expect(o.adsizKontrol).toBe(1);
  });

  it("dört adlandırma biçiminin HİÇBİRİ borç saymaz", () => {
    const kaynak = `
      export function X() {
        return (
          <form>
            {/* 1 — Form.Control (id/htmlFor bağını Form.Item kurar) */}
            <Form.Control><input className="input" /></Form.Control>

            {/* 2 — htmlFor ile kendisine bağlanan <label> */}
            <label htmlFor="ad">Ad</label>
            <input id="ad" />

            {/* 3 — aria-label / aria-labelledby */}
            <input aria-label="Ara" />
            <select aria-labelledby="baslik"><option /></select>

            {/* 4 — <label> içinde sarmalanmış */}
            <label>Soyad<input /></label>
          </form>
        );
      }
    `;
    const o = dosyaOlcumu(kaynak);
    expect(o.kontrolToplam).toBe(5);
    expect(o.adsizKontrol).toBe(0);
  });

  it("htmlFor↔id eşleşmesi DEĞER üzerinden kurulur, varlık üzerinden değil", () => {
    // `id` var ama hiçbir etiket ona bağlanmıyor: bu adlandırma değildir.
    // Bu ayrım olmadan "id yazan herkes borçtan kurtulur" hâli doğardı.
    const kaynak = `
      export const X = () => (
        <div>
          <label htmlFor="baska">Başka</label>
          <input id="ad" />
        </div>
      );
    `;
    expect(dosyaOlcumu(kaynak).adsizKontrol).toBe(1);
  });

  it("ifade biçimli bağ da eşleşir: htmlFor={uid} ↔ id={uid}", () => {
    const kaynak = `
      export const X = ({ uid }) => (
        <div>
          <label htmlFor={uid}>Ad</label>
          <input id={uid} />
        </div>
      );
    `;
    expect(dosyaOlcumu(kaynak).adsizKontrol).toBe(0);
  });

  it("yerel <label> sarmalayıcısı (Field deseni) adlandırma sayılır", () => {
    // Gerçek bulgu: `DeliveryVehiclesPage`'in 18 alanı bu desendedir ve
    // ÇALIŞMA ZAMANINDA <label> içindedir. Tespit olmadan sayaç 18 sahte
    // borç raporluyordu.
    const kaynak = `
      function Field({ label, children }) {
        return <label className="flex flex-col">{label}{children}</label>;
      }
      export const X = () => (
        <Field label="Araç adı"><input className="input" /></Field>
      );
    `;
    const o = dosyaOlcumu(kaynak);
    expect(o.kontrolToplam).toBe(1);
    expect(o.adsizKontrol).toBe(0);
  });

  it("children AKTARMAYAN bir bileşen sarmalayıcı sayılmaz", () => {
    // Ters prova: yukarıdaki tespit "adı Field olan her şeyi affet" değildir.
    const kaynak = `
      function Baslik({ label }) {
        return <label className="x">{label}</label>;
      }
      export const X = () => (
        <div><Baslik label="Ad" /><input className="input" /></div>
      );
    `;
    expect(dosyaOlcumu(kaynak).adsizKontrol).toBe(1);
  });

  it("ölçüm dışı tipler ve hidden özniteliği borç saymaz, ayrı sayılır", () => {
    const kaynak = `
      export const X = () => (
        <form>
          <input type="hidden" name="csrf" />
          <input type="submit" value="Gönder" />
          <input ref={r} type="file" hidden onChange={f} />
        </form>
      );
    `;
    const o = dosyaOlcumu(kaynak);
    expect(o.olcumDisiKontrol).toBe(3);
    expect(o.kontrolToplam).toBe(0);
    expect(o.adsizKontrol).toBe(0);
  });

  it("ÖLÇÜM İÇİ tipler ayıklanmaz: checkbox/radio/file(görünür) borç sayılır", () => {
    // Ters prova: ölçüm dışı listesi "type yazan her şeyi affet" değildir.
    const kaynak = `
      export const X = () => (
        <form>
          <input type="checkbox" />
          <input type="radio" />
          <input type="file" />
        </form>
      );
    `;
    const o = dosyaOlcumu(kaynak);
    expect(o.olcumDisiKontrol).toBe(0);
    expect(o.adsizKontrol).toBe(3);
  });

  it("yorumdaki ve string'deki <input sayılmaz", () => {
    const kaynak = [
      "// eskiden burada <input className='input' /> vardi",
      "const ornek = '<input placeholder=\"Ad\" />';",
      "export const X = () => <div>{ornek}</div>;",
    ].join(String.fromCharCode(10));
    const o = dosyaOlcumu(kaynak);
    expect(o.kontrolToplam).toBe(0);
    expect(o.adsizKontrol).toBe(0);
  });
});

/* ══════════════ İP-A4: ekranda yaşayan pencere durumu ══════════════ */

describe("İP-A4 sayaç: modal durumu", () => {
  it("TERS PROVA — pencere durumu gerçekten sayılır (sayaç 0'lamıyor)", () => {
    const kaynak = `
      export function Ekran() {
        const [acik, setAcik] = useState(false);
        const [secili, setSecili] = useState<X | null>(null);
        return (
          <>
            <XDialog open={acik} onClose={() => setAcik(false)} />
            <YModal kind={secili} />
          </>
        );
      }
    `;
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual(["acik", "secili"]);
  });

  it("aynı bağ iki pencerede geçse de BİR kez sayılır", () => {
    const kaynak = `
      export function Ekran() {
        const [acik, setAcik] = useState(false);
        return (<><ADialog open={acik} /><BDialog open={acik} /></>);
      }
    `;
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual(["acik"]);
  });

  it("türetilmiş ifade de sayılır: open={!!acik}, open={secili !== null}", () => {
    const kaynak = `
      export function Ekran() {
        const [acik, setAcik] = useState(false);
        const [secili, setSecili] = useState(null);
        return (<><ADialog open={!!acik} /><BDialog open={secili !== null} /></>);
      }
    `;
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual(["acik", "secili"]);
  });

  it("pencere OLMAYAN bileşene verilen durum sayılmaz (yanlış pozitif yok)", () => {
    // `open` özniteliği `<details>`te ve akordeon bileşenlerinde de var;
    // metrik yalnız PENCERE bileşenlerini ölçer.
    const kaynak = `
      export function Ekran() {
        const [acik, setAcik] = useState(false);
        const [sayfa, setSayfa] = useState(1);
        return (
          <>
            <Accordion open={acik} />
            <details open={acik} />
            <DataTable page={sayfa} />
          </>
        );
      }
    `;
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual([]);
  });

  it("durum OLMAYAN değer sayılmaz: prop/sabit pencereye verilebilir", () => {
    // Göçün hedefi tam olarak bu: pencere durumu ekranın `useState`'inde
    // değil, dışarıdan gelen bir yüzeyde yaşasın.
    const kaynak = `
      export function Ekran({ yuzey }) {
        const acik = true;
        return (<><XDialog yuzey={yuzey} /><YDialog open={acik} /></>);
      }
    `;
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual([]);
  });

  // ── İP-A5: sayaç dosya sınırına DUYARSIZ olmalı ──
  //
  // Aşağıdaki iki test bir çifttir ve tek bir şeyi kanıtlar: aynı JSX,
  // bir dosyada da iki dosyada da AYNI sayıyı vermelidir. Bu özellik olmadan
  // büyük bir ekranı bölmek (davranışı değiştirmeyen mekanik iş) metriği
  // oynatır ve eşik "ilerleme"/"gerileme" gibi okunur.
  it("aynı dosyadaki İKİ AYRI bileşenin aynı adlı bağı İKİ kez sayılır", () => {
    const kaynak = `
      function Urunler() {
        const [deleting, setDeleting] = useState(null);
        return <ConfirmDialog open={deleting !== null} />;
      }
      function Kuponlar() {
        const [deleting, setDeleting] = useState(null);
        return <ConfirmDialog open={deleting !== null} />;
      }
    `;
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual(["deleting", "deleting"]);
  });

  it("aynı bileşenin TEK bağı iki pencerede geçse yine BİR sayılır", () => {
    // Üstteki testin ikizi: düzeltme "her kullanımı say" demek DEĞİL.
    const kaynak = `
      function Urunler() {
        const [deleting, setDeleting] = useState(null);
        return (
          <>
            <ConfirmDialog open={deleting !== null} />
            <ReasonDialog open={deleting !== null} />
          </>
        );
      }
    `;
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual(["deleting"]);
  });

  it("iç içe fonksiyonda kullanılan dış bağ HÂLÂ çözülür (kapsam yukarı bakar)", () => {
    // Panelde yaygın: `cell: ({ row }) => <XDialog open={acik} />`.
    const kaynak = `
      function Ekran() {
        const [acik, setAcik] = useState(false);
        const kolonlar = [{ cell: () => <XDialog open={acik} /> }];
        return <Table columns={kolonlar} />;
      }
    `;
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual(["acik"]);
  });

  it("yorumdaki pencere kullanımı sayılmaz", () => {
    const kaynak = [
      "export function Ekran() {",
      "  const [acik, setAcik] = useState(false);",
      "  // eskiden: <XDialog open={acik} />",
      "  return <div>{String(acik)}</div>;",
      "}",
    ].join(String.fromCharCode(10));
    expect(dosyaOlcumu(kaynak).modalDurumAdlari).toEqual([]);
  });
});
