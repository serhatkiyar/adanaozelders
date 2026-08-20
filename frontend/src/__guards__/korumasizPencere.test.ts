/**
 * İP-A7d4 · Görev 1 — korumasız pencere nöbetçisi (statik yarı).
 *
 * ## Bu nöbetçi neden VAR — ölçülmüş gerekçe
 *
 * Bu pakette önce çalışma zamanı dedektörü yazıldı (`ui2/icerikKorumasi.ts`,
 * `ui/Dialog`ta bağlı) ve tam suite koşuldu: **1507 testte hiçbir şey
 * yakalanmadı.** Oysa aynı anda `AdminAccessPage` üretimde korumasız bir rol
 * formu taşıyordu — rol kodu, rol adı, açıklama ve izin kutuları; ×/ESC
 * hepsini sormadan siliyordu.
 *
 * Sebep A3c'nin `Form.Control` sınırının aynısıdır: **çalışma zamanı yalnız
 * RENDER EDİLEN yüzeyi görür** ve o pencereyi açan bir test yoktu. Yani
 * "dedektör yazıldı" ile "kusur CI'da görünür" aynı şey değil.
 *
 * Bu tarama o deliği kapatır: kaynağa bakar, render gerektirmez, ölçüm
 * tabanındaki HER pencereyi görür.
 *
 * ## Ama tek başına da yetmez (CLAUDE.md §C)
 *
 * Kaynak sözleşmesi testi DÜŞÜK GÜÇLÜDÜR ve bu taramanın sınırı somuttur:
 * yalnız tek dosya içini görür. SK-4'te (A7d2) pencere `EditProductModal`,
 * alanlar `ProductForm`daydı — bu tarama onu göremezdi, çalışma zamanı
 * dedektörü görür (`ui2/korumasizIcerik.test.tsx` bunu sentetik olarak
 * kanıtlıyor).
 *
 * İkisi birbirinin kör noktasını kapatıyor. Rapor bunu böyle yazar; hiçbiri
 * "kusur sınıfı kapandı" iddiasının tek dayanağı değildir.
 */
import { describe, expect, it } from "vitest";

import { korumasizPencereler, tabanTaramasi } from "../../scripts/korumasiz-pencere.mjs";

/**
 * Çapraz dosyalı pencereler: alanları başka dosyada olabilir, statik tarama
 * karar VEREMEZ ve bu yüzden sessizce "temiz" yazmaz — belirsiz sayar.
 *
 * Liste KİMLİKLE sabittir: yeni bir belirsiz pencere doğarsa da, buradaki
 * biri kaybolursa da test kırılır. Her birinin korumasının nerede olduğu
 * yanına yazılıdır; doğrulaması çalışma zamanındadır.
 */
const BELIRSIZ = [
  // `ProductForm` kendi `useYuzeyKirliFormBekcisi`sini çağırır (A7d2 · SK-4
  // düzeltmesi). `StockLedgerPanel` salt okunur defter listesidir.
  "src/components/admin/store/EditProductModal.tsx",
  // Salt-okunur denetim kaydı detayı: `DetailRow`/`Badge`/`JsonBlock`.
  // Korunacak bir girdi yok.
  "src/pages/admin/AdminAuditLogsPage.tsx",
  // İki ayrı pencere: operatör/oturum yönetimi ve ödeme formu. İkincisinin
  // içeriği `LibraryPayoutForm`dur ve bekçiyi kendi çağırır (A7d3).
  "src/pages/dashboards/AdminLibraries.tsx",
  "src/pages/dashboards/AdminLibraries.tsx",
];

describe("İP-A7d4 · korumasız pencere nöbetçisi", () => {
  it("ölçüm tabanında korumasız pencere YOK", () => {
    const { bulgular } = tabanTaramasi();
    expect(
      bulgular.map((b) => `${b.dosya}:${b.satir} <${b.pencere}> [${b.kontroller.join(",")}]`)
    ).toEqual([]);
  });

  it("çapraz dosyalı (belirsiz) pencerelerin listesi KİMLİKLE sabittir", () => {
    // Sayı değil kimlik: biri çıkıp biri girerse sayı sabit kalır ve nöbetçi
    // sessizce başka bir kümeyi affetmeye başlardı (A6c · Görev 7'nin dersi).
    const { belirsiz } = tabanTaramasi();
    expect(belirsiz.map((b) => b.dosya)).toEqual(BELIRSIZ);
  });
});

/* ── Ters prova: taramanın kendisi ayırt ediyor mu ── */

const PENCERE_ICI_FORM = `
  export function Ekran() {
    return (
      <Dialog open title="Rol" onClose={kapat}>
        <input value={a} onChange={x} />
        <textarea value={b} onChange={y} />
      </Dialog>
    );
  }
`;

describe("İP-A7d4 · statik taramanın ters provası", () => {
  it("bekçisiz + beyansız pencere YAKALANIR", () => {
    const { bulgular } = korumasizPencereler(PENCERE_ICI_FORM, "a.tsx");
    expect(bulgular).toHaveLength(1);
    expect(bulgular[0].kontroller).toEqual(["input", "textarea"]);
  });

  it("`korumasiz` beyanı taşıyan AYNI pencere GEÇER", () => {
    const kaynak = PENCERE_ICI_FORM.replace("<Dialog open", "<Dialog korumasiz open");
    expect(korumasizPencereler(kaynak, "a.tsx").bulgular).toEqual([]);
  });

  it("bekçi kancasını çağıran dosya GEÇER", () => {
    const kaynak = "const b = useYuzeyKirliFormBekcisi({ form, sunucuHatasi });" + PENCERE_ICI_FORM;
    expect(korumasizPencereler(kaynak, "a.tsx").bulgular).toEqual([]);
  });

  it("girdisiz pencere (onay) GEÇER", () => {
    const kaynak = `
      export function Ekran() {
        return (
          <Dialog open title="Sil" onClose={kapat}>
            <p>Emin misiniz?</p>
            <button type="button">Vazgeç</button>
          </Dialog>
        );
      }
    `;
    const sonuc = korumasizPencereler(kaynak, "a.tsx");
    expect(sonuc.bulgular).toEqual([]);
    expect(sonuc.belirsiz).toEqual([]);
  });

  it("veri taşımayan `<input type>` sayılmaz", () => {
    const kaynak = `
      export function Ekran() {
        return (
          <Dialog open title="Sil" onClose={kapat}>
            <input type="hidden" name="csrf" />
            <input type="submit" value="Gonder" />
          </Dialog>
        );
      }
    `;
    expect(korumasizPencereler(kaynak, "a.tsx").bulgular).toEqual([]);
  });

  it("YORUMDA ve DİZEDE geçen etiketler sayılmaz (AST, metin değil)", () => {
    // §C: kaynak sözleşmesi testi kendi yorumunu/dizesini yakalamamalı.
    const kaynak = `
      // <Dialog open><textarea /></Dialog> — bu bir yorumdur
      const ornek = "<Dialog open><input /></Dialog>";
      export function Ekran() { return <p>{ornek}</p>; }
    `;
    const sonuc = korumasizPencereler(kaynak, "a.tsx");
    expect(sonuc.bulgular).toEqual([]);
    expect(sonuc.belirsiz).toEqual([]);
  });

  it("`DuzenlemeYuzeyi` taranmaz (bekçiyi kendi bağlar)", () => {
    const kaynak = `
      export function Ekran() {
        return (
          <DuzenlemeYuzeyi yuzey={y} baslik="X" form={f} sunucuHatasi={h} aksiyonlar={a}>
            <input value={v} onChange={o} />
          </DuzenlemeYuzeyi>
        );
      }
    `;
    expect(korumasizPencereler(kaynak, "a.tsx").bulgular).toEqual([]);
  });

  it("çapraz dosyalı içerik SESSİZCE temiz sayılmaz — belirsiz olur", () => {
    const kaynak = `
      export function Ekran() {
        return (
          <DuzenlemePenceresi yuzey={y} baslik="Ürünü düzenle">
            <ProductForm mode="edit" />
          </DuzenlemePenceresi>
        );
      }
    `;
    const sonuc = korumasizPencereler(kaynak, "a.tsx");
    expect(sonuc.bulgular).toEqual([]);
    expect(sonuc.belirsiz).toHaveLength(1);
    expect(sonuc.belirsiz[0].bilesenler).toEqual(["ProductForm"]);
  });
});
