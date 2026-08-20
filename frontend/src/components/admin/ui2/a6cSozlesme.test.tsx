/**
 * İP-A6c — sözleşme onarımının kırmızı matrisi (denetim #2 · BULGU-4/5/7/8).
 *
 * ## Neden tek dosya
 *
 * Dört bulgu üç ayrı modülde yaşıyor (`useUrlDurumu`, `duzenlemeYuzeyi`,
 * `gezinmeBekcisi`) ama **tek bir sınıfın** örnekleri: sözleşmenin henüz
 * kimsenin yazmadığı biçimde kullanıldığı anda sessizce yanlış davranması.
 * Dördü de sessiz — hata yok, uyarı yok, kullanıcı kaybettiğini fark etmiyor.
 * A7'nin 21 ekranı tam olarak o "henüz yazılmamış biçimleri" yazacak; bu
 * dosya onların ilk yazılışta doğru çalışacağının kanıtıdır.
 *
 * Dosyalarına dağıtılsalardı matrisin **birlikte** kırmızı olduğu (ve
 * birlikte yeşile döndüğü) tek koşumda gösterilemezdi.
 *
 * ## Her onarımın bir NEGATİF KONTROLÜ var
 *
 * Bir onarım "kör çekiç" olabilir: T3 her yazımı birleştirirse dış değişimi
 * ezer, T6 her kayıtta patlarsa tek içerikli pencereyi de kırar, T4 her
 * tıklamayı `navigate`e çevirirse temiz yolu bozar, T7 her onayı düşürürse
 * bekçi hiç çalışmaz. Negatif kontroller onarımın **yalnız kusuru**
 * kapattığını gösterir (İP-A6b'nin M-A⁻/M-C⁻ deseni).
 *
 * Gerçek DOM + gerçek router; hiçbir şey mock'lanmaz.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Component, useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import {
  BrowserRouter,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Button } from "@/components/admin/ui";
import { Form } from "@/components/admin/ui2/form";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";

import {
  DuzenlemePenceresi,
  DuzenlemeYuzeyi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
} from "./duzenlemeYuzeyi";
import { GezinmeBaglantisi, gezinmeKaydiniSifirla } from "./gezinmeBekcisi";
import { HATA_TAKIBI_YOK, useKirliFormBekcisi } from "./kirliFormBekcisi";

const ONAY_BASLIK = "Kaydedilmemiş değişiklikler var";
const CIK = "Çık";
const AYRIL = "Sayfadan ayrıl";

/**
 * Onay penceresindeki düğmeye adıyla basar.
 *
 * İKİ ayrı pencere türü var ve karıştırmak testi "hiç koşmadı" hâline sokar
 * (bu dosyanın ilk yazımında T4'ün dördü tam olarak böyle düştü):
 *
 * | Yol | Bileşen | Rol |
 * |---|---|---|
 * | pencere kapatma (`kirliFormBekcisi`) | Medusa `usePrompt` | `alertdialog` |
 * | rota gezinmesi (`gezinmeBekcisi`) | panelin `ConfirmDialog`u | `dialog` |
 */
async function onayda(ad: string, rol: "alertdialog" | "dialog" = "alertdialog") {
  const pencere = await waitFor(() => {
    const p = document.querySelector(`[role="${rol}"]`);
    if (!p) throw new Error(`onay penceresi açılmadı (role=${rol})`);
    return p as HTMLElement;
  });
  fireEvent.click(within(pencere).getByRole("button", { name: ad }));
  await waitFor(() =>
    expect(document.querySelector(`[role="${rol}"]`)).toBeNull()
  );
}

/** Testten kalan açık onay penceresi sonrakini kirletmesin. */
async function acikOnayiKapat() {
  const pencere = document.querySelector('[role="alertdialog"]');
  if (!pencere) return;
  const dugmeler = within(pencere as HTMLElement).getAllByRole("button");
  fireEvent.click(dugmeler[0]);
  await waitFor(() =>
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  );
}

/* ══════════════ T3 · BULGU-4 · useUrlDurumu ══════════════ */

function UrlEkran() {
  const u = useUrlDurumu({ q: "", sayfa: 1 }, { sayfaAnahtari: "sayfa" });
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="degerler">{JSON.stringify(u.degerler)}</span>
      <span data-testid="adres">{window.location.search}</span>
      <button
        onClick={() => {
          // A7'nin en sık yazımı: "filtreyi uygula VE sayfayı başa al".
          u.ayarla({ q: "a" });
          u.ayarla({ sayfa: 3 });
        }}
      >
        İki yazma
      </button>
      <button onClick={() => u.ayarla({ q: "b" })}>Tek yazma</button>
      <button onClick={() => navigate("?disaridan=1")}>Dışarıdan yaz</button>
    </div>
  );
}

const urlDegerler = () => JSON.parse(screen.getByTestId("degerler").textContent ?? "{}");
const urlAdres = () => screen.getByTestId("adres").textContent ?? "";
const bas = (ad: string) => fireEvent.click(screen.getByRole("button", { name: ad }));

describe("T3 · BULGU-4 · aynı olayda iki `ayarla` çağrısı", () => {
  beforeEach(() => window.history.replaceState({}, "", "/a6c"));

  it("T3 — ikisi de yazılır (ilk yazım yutulmaz)", () => {
    render(
      <BrowserRouter>
        <UrlEkran />
      </BrowserRouter>
    );

    bas("İki yazma");

    expect(urlDegerler(), "ilk `ayarla` çağrısı sessizce kayboldu").toEqual({
      q: "a",
      sayfa: 3,
    });
    expect(urlAdres()).toContain("q=a");
    expect(urlAdres()).toContain("sayfa=3");
  });

  it("T3 — aynı olaydaki iki yazım TEK geçmiş girdisi üretir", () => {
    // Tek kullanıcı hareketi = tek geçmiş girdisi. İkinci yazım da `push`
    // olsaydı geri tuşu, kullanıcının hiç görmediği ara duruma dönerdi.
    render(
      <BrowserRouter>
        <UrlEkran />
      </BrowserRouter>
    );
    const once = window.history.length;

    bas("İki yazma");

    expect(window.history.length, "ara durum geçmişe yazıldı").toBe(once + 1);
  });

  it("T3⁻ — sonraki OLAYDA sayfa sıfırlama kuralı hâlâ işler", () => {
    // Kör çekiç kontrolü (a): birleştirme olay sınırını aşarsa `sayfa=3`
    // sonraki filtre değişiminde de yapışık kalırdı.
    render(
      <BrowserRouter>
        <UrlEkran />
      </BrowserRouter>
    );

    bas("İki yazma");
    bas("Tek yazma");

    expect(urlDegerler()).toEqual({ q: "b", sayfa: 1 });
    expect(urlAdres()).not.toContain("sayfa=3");
  });

  it("T3⁻ — DIŞARIDAN gelen adres değişimi ezilmez", () => {
    // Kör çekiç kontrolü (b): "önceki yazım" hatırlanırken konumun kendisi
    // unutulursa, başka bir bileşenin (ya da geri tuşunun) yazdığı adres bir
    // sonraki `ayarla`da geri alınırdı.
    render(
      <BrowserRouter>
        <UrlEkran />
      </BrowserRouter>
    );

    bas("İki yazma");
    bas("Dışarıdan yaz");
    bas("Tek yazma");

    expect(urlAdres(), "dışarıdan yazılan parametre silindi").toContain("disaridan=1");
    expect(urlAdres()).toContain("q=b");
    expect(urlAdres(), "bayat yazım geri geldi").not.toContain("q=a");
  });
});

/* ══════════════ T6 · BULGU-5 · DuzenlemePenceresi ══════════════ */

/**
 * Efektte fırlatılan hatayı yakalayan sınır.
 *
 * `expect(() => render(…)).toThrow()` BURADA ÇALIŞMAZ ve bu ilk yazımda
 * öğrenildi: hata bir passive effect içinde doğuyor, React onu `render`
 * çağrısından senkron olarak dışarı vermiyor — en yakın hata sınırına
 * gönderiyor. Uygulamanın kendisinde de yol budur (`App.tsx` → ErrorBoundary),
 * yani test gerçek yolu ölçüyor.
 */
class HataSiniri extends Component<
  { children: ReactNode; yakalandi: (h: Error) => void },
  { patladi: boolean }
> {
  state = { patladi: false };
  static getDerivedStateFromError() {
    return { patladi: true };
  }
  componentDidCatch(hata: Error) {
    this.props.yakalandi(hata);
  }
  render() {
    return this.state.patladi ? <p>patladı</p> : this.props.children;
  }
}

function KorumaliIcerik({ ad }: { ad: string }) {
  const form = useForm<{ deger: string }>({ defaultValues: { deger: "" } });
  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: HATA_TAKIBI_YOK });
  return <input aria-label={ad} {...form.register("deger")} />;
}

function PencereEkrani({ ikinci = false }: { ikinci?: boolean }) {
  const yuzey = useDuzenlemeYuzeyi<{ id: number }, void>();
  return (
    <div>
      <span data-testid="pencere-durum">{yuzey.acik ? "açık" : "kapalı"}</span>
      <button data-testid="ac" onClick={() => yuzey.ac({ id: 1 })}>
        Aç
      </button>
      <DuzenlemePenceresi yuzey={yuzey} baslik="Ürünü düzenle">
        <KorumaliIcerik ad="A alanı" />
        {ikinci && <KorumaliIcerik ad="B alanı" />}
      </DuzenlemePenceresi>
    </div>
  );
}

describe("T6 · BULGU-5 · pencerede iki korumalı içerik", () => {
  afterEach(acikOnayiKapat);

  it("T6 — ikinci korumalı içerik GELİŞTİRMEDE patlar (sessiz veri kaybı yerine)", () => {
    // Bugün ikinci bekçi birincinin kaydını eziyor ve A'daki veri hiçbir soru
    // sorulmadan gidiyor. Küme yapmak "hangi bekçi sorar, biri iptal ederse ne
    // olur" tasarımını açar; bu paket veri kaybını DURDURUR, tasarımı A7'ye
    // bırakır (`Form.Control`da seçilen yolun aynısı).
    const hatalar: Error[] = [];
    render(
      <HataSiniri yakalandi={(h) => hatalar.push(h)}>
        <PencereEkrani ikinci />
      </HataSiniri>
    );

    // Pencere KAPALIYKEN `Dialog` çocuklarını hiç render etmez; dolayısıyla
    // kayıt da olmaz. Koruma tam olarak veri kaybının mümkün olduğu anda —
    // pencere açıkken — ateşlenmelidir.
    expect(hatalar, "kapalı pencerede boşuna patladı").toEqual([]);
    fireEvent.click(screen.getByTestId("ac"));

    expect(hatalar.map((h) => h.message).join(" | ")).toMatch(
      /ikinci korumalı içerik/i
    );
    // Mesaj ne yapılması gerektiğini SÖYLEMELİ; "geçersiz durum" demek
    // geliştiriciyi kaynağa bakmaya zorlar.
    expect(hatalar[0].message).toMatch(/ayrı pencerelere ayırın/i);
  });

  it("T6⁻ — TEK korumalı içerik patlamaz ve korur", async () => {
    // Kör çekiç kontrolü: bugünkü tek üretim çağrı yeri (`EditProductModal`)
    // aynen çalışmaya devam etmeli.
    render(<PencereEkrani />);
    fireEvent.click(screen.getByTestId("ac"));
    expect(screen.getByTestId("pencere-durum").textContent).toBe("açık");

    fireEvent.change(screen.getByLabelText("A alanı"), { target: { value: "x" } });
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByText(ONAY_BASLIK)).toBeTruthy();
    expect(screen.getByTestId("pencere-durum").textContent, "onaysız kapandı").toBe(
      "açık"
    );
  });

  it("T6⁻ — ARDIŞIK içerik değişimi patlamaz (kayıt birikmiyor)", () => {
    // Kör çekiç kontrolü: kayıtlar kümülatif sayılsaydı, aynı pencerede
    // içeriği değiştiren (sekmeli/adımlı) her yüzey ikinci render'da patlardı.
    const { rerender } = render(<PencereEkrani />);
    fireEvent.click(screen.getByTestId("ac"));
    expect(() => {
      rerender(<PencereEkrani />);
      rerender(<PencereEkrani />);
    }).not.toThrow();
  });
});

/* ══════════════ T4 · BULGU-7 · GezinmeBaglantisi ══════════════ */

function UrunFormu() {
  const form = useForm<{ ad: string }>({ defaultValues: { ad: "" } });
  useKirliFormBekcisi({ form, sunucuHatasi: HATA_TAKIBI_YOK });
  return <input aria-label="Ad" {...form.register("ad")} />;
}

function Konum() {
  const loc = useLocation();
  return (
    <span data-testid="konum">
      {loc.pathname}|{JSON.stringify(loc.state ?? null)}
    </span>
  );
}

function GezinmeKabuk({
  formVar,
  baglanti,
}: {
  formVar: boolean;
  baglanti: React.ReactNode;
}) {
  return (
    <MemoryRouter initialEntries={["/kok", "/magaza/detay"]} initialIndex={1}>
      <Konum />
      <GeriDugmesi />
      <Routes>
        <Route path="/kok" element={<h1>Kök sayfası</h1>} />
        <Route path="/magaza" element={<h1>Mağaza üst sayfası</h1>} />
        <Route
          path="/magaza/detay"
          element={
            <div>
              <h1>Detay sayfası</h1>
              {/* Bağlantı rotanın İÇİNDE: `relative="path"` rota bağlamına
                  göre çözülür, konum yoluna göre değil. İlk yazımda bağlantı
                  `<Routes>` dışındaydı ve `..` her iki yolda da "/" veriyordu
                  — yani testin beklentisi yanlıştı, üretim kodu değil. */}
              <nav>{baglanti}</nav>
              {formVar && <UrunFormu />}
            </div>
          }
        />
        <Route path="/siparisler" element={<h1>Siparişler sayfası</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

function GeriDugmesi() {
  const navigate = useNavigate();
  return (
    <button data-testid="geri" onClick={() => navigate(-1)}>
      Geri
    </button>
  );
}

const konum = () => screen.getByTestId("konum").textContent ?? "";

/** Kirli formda bağlantıya basar ve "Sayfadan ayrıl"ı onaylar. */
async function kirliGezin() {
  fireEvent.change(screen.getByLabelText("Ad"), { target: { value: "Kurşun Kalem" } });
  fireEvent.click(screen.getByText("Git"));
  await onayda(AYRIL, "dialog");
}

describe("T4 · BULGU-7 · kirli yolda NavLink sözleşmesi", () => {
  beforeEach(gezinmeKaydiniSifirla);
  afterEach(acikOnayiKapat);

  it("T4 — `state` kirli yolda da taşınır", async () => {
    render(
      <GezinmeKabuk
        formVar
        baglanti={
          <GezinmeBaglantisi to="/siparisler" state={{ kaynak: "denetim" }}>
            Git
          </GezinmeBaglantisi>
        }
      />
    );

    await kirliGezin();

    await screen.findByText("Siparişler sayfası");
    expect(konum(), "onaydan sonra `state` düştü").toBe(
      '/siparisler|{"kaynak":"denetim"}'
    );
  });

  it("T4 — `replace` kirli yolda da uygulanır", async () => {
    render(
      <GezinmeKabuk
        formVar
        baglanti={
          <GezinmeBaglantisi to="/siparisler" replace>
            Git
          </GezinmeBaglantisi>
        }
      />
    );

    await kirliGezin();
    await screen.findByText("Siparişler sayfası");

    fireEvent.click(screen.getByTestId("geri"));

    // `replace` uygulandıysa /magaza/detay geçmişten SİLİNMİŞ olmalı.
    expect(await screen.findByText("Kök sayfası")).toBeTruthy();
  });

  it("T4 — `relative=\"path\"` kirli yolda da uygulanır", async () => {
    render(
      <GezinmeKabuk
        formVar
        baglanti={
          <GezinmeBaglantisi to=".." relative="path">
            Git
          </GezinmeBaglantisi>
        }
      />
    );

    await kirliGezin();

    // relative="path" → "/magaza"; düşerse rota hiyerarşisine göre "/" olur.
    expect(await screen.findByText("Mağaza üst sayfası")).toBeTruthy();
    expect(konum()).toBe("/magaza|null");
  });

  it("T4⁻ — `relative` TEMİZ yolda aynı yere gider", async () => {
    // Bulgunun kendisi "aynı bağlantı forma göre farklı davranıyor"du; bu
    // yüzden asıl iddia iki yolun EŞİTLİĞİDİR.
    render(
      <GezinmeKabuk
        formVar={false}
        baglanti={
          <GezinmeBaglantisi to=".." relative="path">
            Git
          </GezinmeBaglantisi>
        }
      />
    );

    fireEvent.click(screen.getByText("Git"));

    expect(await screen.findByText("Mağaza üst sayfası")).toBeTruthy();
    expect(konum()).toBe("/magaza|null");
  });

  it("T4⁻ — TEMİZ yol aynı sonucu verir (sözleşme forma göre değişmez)", async () => {
    // Kör çekiç kontrolü: onarım `NavLink` yolunu bozmamalı. Bulgunun kendisi
    // zaten "aynı bağlantı forma göre farklı davranıyor"du.
    render(
      <GezinmeKabuk
        formVar={false}
        baglanti={
          <GezinmeBaglantisi to="/siparisler" state={{ kaynak: "denetim" }}>
            Git
          </GezinmeBaglantisi>
        }
      />
    );

    fireEvent.click(screen.getByText("Git"));

    await screen.findByText("Siparişler sayfası");
    expect(konum()).toBe('/siparisler|{"kaynak":"denetim"}');
    expect(screen.queryByText(ONAY_BASLIK)).toBeNull();
  });

  it("T4⁻ — onay REDDEDİLİRSE gezinme hiç olmaz", async () => {
    // Kör çekiç kontrolü: `navigate`i seçeneklerle çağırmak, onayı beklemeden
    // gezinmeye dönüşmemeli.
    render(
      <GezinmeKabuk
        formVar
        baglanti={
          <GezinmeBaglantisi to="/siparisler" state={{ kaynak: "denetim" }}>
            Git
          </GezinmeBaglantisi>
        }
      />
    );

    fireEvent.change(screen.getByLabelText("Ad"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("Git"));
    await onayda("Vazgeç", "dialog");

    expect(screen.getByText("Detay sayfası")).toBeTruthy();
    expect(konum()).toBe("/magaza/detay|null");
  });
});

/* ══════════════ T7 · BULGU-8 · onay beklerken hedef değişimi ══════════════ */

function HedefEkrani() {
  const yuzey = useDuzenlemeYuzeyi<{ id: number }, void>();
  const form = useForm<{ ad: string }>({ defaultValues: { ad: "" } });

  return (
    <div>
      <span data-testid="hedef">
        {yuzey.acik ? `kayit:${yuzey.kayit?.id}` : "kapalı"}
      </span>
      <button data-testid="ac-1" onClick={() => yuzey.ac({ id: 1 })}>
        Bir
      </button>
      <button data-testid="ac-2" onClick={() => yuzey.ac({ id: 2 })}>
        İki
      </button>
      <DuzenlemeYuzeyi
        yuzey={yuzey}
        baslik="Kayıt düzenle"
        form={form}
        sunucuHatasi={HATA_TAKIBI_YOK}
        aksiyonlar={<Button>Kaydet</Button>}
      >
        <label>
          Ad
          <input {...form.register("ad")} />
        </label>
      </DuzenlemeYuzeyi>
    </div>
  );
}

const hedef = () => screen.getByTestId("hedef").textContent;

describe("T7 · BULGU-8 · onay beklerken hedef değişimi", () => {
  afterEach(acikOnayiKapat);

  it("T7 — hedef değişirse onay ESKİ hedefe uygulanmaz", async () => {
    render(<HedefEkrani />);
    fireEvent.click(screen.getByTestId("ac-1"));
    fireEvent.change(screen.getByLabelText(/ad/i), { target: { value: "x" } });

    fireEvent.click(screen.getByRole("button", { name: /vazgeç/i }));
    expect(await screen.findByText(ONAY_BASLIK)).toBeTruthy();

    // Alttaki hedef değişti (WS push'u / query invalidation / satır değişimi).
    fireEvent.click(screen.getByTestId("ac-2"));
    expect(hedef()).toBe("kayit:2");

    await onayda(CIK);

    expect(hedef(), "onay, kullanıcının sormadığı kaydı kapattı").toBe("kayit:2");
  });

  it("T7⁻ — hedef DEĞİŞMEDİYSE onay normal uygulanır", async () => {
    // Kör çekiç kontrolü: damga her onayı düşürseydi bekçi hiç çalışmazdı.
    render(<HedefEkrani />);
    fireEvent.click(screen.getByTestId("ac-1"));
    fireEvent.change(screen.getByLabelText(/ad/i), { target: { value: "x" } });

    fireEvent.click(screen.getByRole("button", { name: /vazgeç/i }));
    expect(await screen.findByText(ONAY_BASLIK)).toBeTruthy();

    await onayda(CIK);

    await waitFor(() => expect(hedef()).toBe("kapalı"));
  });
});

/* ══════════════ Görev 6 · iki görsel kusur ══════════════ */

function AlanEkrani({ tur }: { tur: "number" | "text" }) {
  const form = useForm<{ miktar: string }>({ defaultValues: { miktar: "" } });
  return (
    <Form.Field
      control={form.control}
      name="miktar"
      render={({ field }) => (
        <Form.Item>
          <Form.Label>Miktar</Form.Label>
          <Form.Control>
            <input type={tur} className="input w-full" {...field} />
          </Form.Control>
        </Form.Item>
      )}
    />
  );
}

describe("Görev 6 · görsel kusurlar", () => {
  it("6a — hata mesajı `rose-700` kullanır (açık temadaki dar marj)", () => {
    // Gerçek kontrast gerçek tarayıcıda ölçüldü (4,70 → 6,29;
    // `docs/ip-a6c/gorsel-olcum.json`). Bu test onarımın sessizce geri
    // alınmasına karşı nöbetçidir — kontrast ölçmez, KARARI sabitler.
    render(<HataliAlan />);
    const hata = screen.getByRole("alert");
    expect(hata.className).toContain("text-rose-700");
    expect(hata.className, "koyu tema tonu değişmemeliydi").toContain(
      "dark:text-rose-400"
    );
  });

  it("6b — sayı girdisi koyu temada yerel şemayı alır", () => {
    // jsdom yerel widget çizmez; ölçülebilen şey kararın alana İNDİĞİDİR.
    // Görsel doğrulama gerçek Chrome'da yapıldı (docs/ip-a6c/a6c-koyu.png).
    render(<AlanEkrani tur="number" />);
    const alan = screen.getByLabelText("Miktar");
    expect(alan.className).toContain("dark:[color-scheme:dark]");
    expect(alan.className, "alanın kendi sınıfı silindi").toContain("input");
  });

  it("6b⁻ — metin girdisine dokunulmaz (kör çekiç değil)", () => {
    render(<AlanEkrani tur="text" />);
    expect(screen.getByLabelText("Miktar").className).not.toContain("color-scheme");
  });

  it.each(["date", "datetime-local", "time", "month", "week", "color"])(
    "6b⁺ — '%s' girdisi de koyu temada yerel şemayı alır (İP-A7d2 · SK-6)",
    (tur) => {
      // A6c bu düzeltmeyi YALNIZ `number` için kurmuştu; o pakette ölçülen
      // tek yerel widget artır/azalt oklarıydı. Tarih ve saat girdileri de
      // yerel widget çizer (takvim/saat ikonu) ve koyu panelde beyaz kalıyordu.
      //
      // A7d2'nin gerçek tarayıcı turu bunu ÖLÇTÜ: oturum editöründe
      // `Tarih & saat` ve araç formunda `Vardiya başlangıç/bitiş` alanlarının
      // `color-scheme` değeri koyu temada `normal` idi.
      render(<AlanEkrani tur={tur} />);
      expect(screen.getByLabelText("Miktar").className).toContain(
        "dark:[color-scheme:dark]"
      );
    }
  );
});

/** Hata mesajını doğuran asgari alan. */
function HataliAlan() {
  const form = useForm<{ ad: string }>({ defaultValues: { ad: "" } });
  useEffect(() => {
    form.setError("ad", { message: "Zorunlu alan." });
  }, [form]);
  return (
    <Form.Field
      control={form.control}
      name="ad"
      render={({ field }) => (
        <Form.Item>
          <Form.Label>Ad</Form.Label>
          <Form.Control>
            <input {...field} />
          </Form.Control>
          <Form.ErrorMessage />
        </Form.Item>
      )}
    />
  );
}
