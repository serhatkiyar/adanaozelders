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
  // ── İP-A8 · Görev 3: ÜÇ YENİ GİRİŞ, hepsi ölçümün dürüstleşmesi ──
  //
  // Bu üç pencere eskiden hiç görünmüyordu: `bekciVar` bayrağı DOSYA
  // KAPSAMLIYDI ve dosyada herhangi bir bekçi kancası varsa bütün pencereler
  // taranmadan geçiyordu (kör nokta 3). Üçü de ortak katmanda:
  //
  //   • `ConfirmDialog:53`  — onay penceresi, içinde yalnız `Button`. Girdi yok.
  //   • `ConfirmDialog:139` — `ReasonDialog`; içeriği `GerekceIcerik` ve bekçiyi
  //                           KENDİ çağırır (A7d3 · SK-7 düzeltmesi).
  //   • `duzenlemeYuzeyi:183` — `DuzenlemeYuzeyi`nin kendi `Dialog`u; bu yüzey
  //                           bekçiyi zaten kendi bağlar (sözleşme gereği).
  "src/components/admin/ui/ConfirmDialog.tsx",
  "src/components/admin/ui/ConfirmDialog.tsx",
  "src/components/admin/ui2/duzenlemeYuzeyi.tsx",
  // Salt-okunur denetim kaydı detayı: `DetailRow`/`Badge`/`JsonBlock`.
  // Korunacak bir girdi yok.
  "src/pages/admin/AdminAuditLogsPage.tsx",
  // ÜÇ pencere: oturum/operatör yönetimi, ödeme formu ve (İP-A8 · B-1)
  // operatör hesabı formunun KENDİ penceresi. Üçünün de içeriği bekçisini
  // kendi çağırır ya da hiç girdi taşımaz; doğrulaması çalışma zamanındadır
  // (`korumasizIcerik.test.tsx` + `adminKutuphaneOperator.acceptance`).
  "src/pages/dashboards/AdminLibraries.tsx",
  "src/pages/dashboards/AdminLibraries.tsx",
  "src/pages/dashboards/AdminLibraries.tsx",
  // Yeni panelin kütüphane listesi, eski `AdminLibraries` penceresiyle AYNI İKİ
  // yüzeyi (oturum/operatör yönetimi ve ödeme formu) aynı içerik bileşenleriyle
  // açar; ikisi de başka dosyada ve bekçilerini KENDİLERİ çağırıyor:
  //   • `OperatorsManager` (AdminLibraries.tsx:435) ve `ExamSessionsManager`
  //     (ExamSessionsManager.tsx:762) kendi iç pencerelerine kaydoluyor,
  //   • `LibraryPayoutForm` (LibraryPayoutForm.tsx:100) `pencereSiz: true` ile
  //     doğrudan dış pencereye kaydoluyor.
  // Statik tarama dosya sınırını geçemediği için bunlar BELİRSİZ sayılır;
  // doğrulaması çalışma zamanındadır (`ui2/korumasizIcerik.test.tsx` +
  // `adminKutuphaneOperator.acceptance`).
  "src/panel/pages/kutuphaneler/KutuphaneListesi.tsx",
  "src/panel/pages/kutuphaneler/KutuphaneListesi.tsx",
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

  /* ── İP-A8 · Görev 3: kapatılan ÜÇ kör nokta ──
   *
   * Üçü de bağımsız denetim #3'te doğrudan çağrıyla ölçüldü ve üçü de
   * **sessizce temiz** geçiyordu (ne bulgu ne belirsiz). Aşağıdaki üç test
   * onların ters provasıdır: taramanın eski hâli hepsinde `[]` döndürürdü.
   */

  it("`korumasiz={false}` beyan SAYILMAZ — pencere taranır", () => {
    const kaynak = PENCERE_ICI_FORM.replace("<Dialog open", "<Dialog korumasiz={false} open");
    const sonuc = korumasizPencereler(kaynak, "a.tsx");
    expect(sonuc.bulgular).toHaveLength(1);
    expect(sonuc.bulgular[0].kontroller).toEqual(["input", "textarea"]);
  });

  it("`korumasiz={true}` (açık yazım) beyandır — GEÇER", () => {
    const kaynak = PENCERE_ICI_FORM.replace("<Dialog open", "<Dialog korumasiz={true} open");
    expect(korumasizPencereler(kaynak, "a.tsx").bulgular).toEqual([]);
  });

  it("DEĞİŞKENE alınmış içerik satır içi alınır — YAKALANIR", () => {
    const kaynak = `
      export function Ekran() {
        const govde = <input value={a} onChange={x} />;
        return (
          <Dialog open title="Rol" onClose={kapat}>{govde}</Dialog>
        );
      }
    `;
    const sonuc = korumasizPencereler(kaynak, "a.tsx");
    expect(sonuc.bulgular).toHaveLength(1);
    expect(sonuc.bulgular[0].kontroller).toEqual(["input"]);
  });

  it("AYNI DOSYADAKİ ikinci pencere bekçiden pay ALMAZ — belirsize düşer", () => {
    // Eskiden `bekciVar` dosya kapsamlıydı: bir korumalı + bir korumasız
    // pencere varsa ikincisi taranmadan geçiyordu. Artık bekçi ancak dosyada
    // TEK pencere varken atfedilebilir; çoklu pencerede kontrol taşıyan her
    // pencere `belirsiz`e düşer ve nöbetçinin kimlik listesi onu kırmızı yapar.
    const kaynak = `
      export function A() {
        const b = useYuzeyKirliFormBekcisi({ form, sunucuHatasi });
        return (<Dialog open title="korumali" onClose={k}><input value={a} onChange={x} /></Dialog>);
      }
      export function B() {
        return (<Dialog open title="korumasiz" onClose={k}>
          <input value={c} onChange={z} /><textarea value={d} onChange={w} /></Dialog>);
      }
    `;
    const sonuc = korumasizPencereler(kaynak, "a.tsx");
    expect(sonuc.bulgular).toEqual([]);
    expect(sonuc.belirsiz.map((b) => b.sebep)).toEqual([
      "atfedilemez-bekci",
      "atfedilemez-bekci",
    ]);
  });

  it("bekçili TEK pencereli dosya hâlâ GEÇER (aşırı sıkılaşma yok)", () => {
    // Ters yön: düzeltme meşru yazımı kırmamalı. Dosyada tek pencere varsa
    // bekçi ona atfedilebilir ve tarama sessiz kalır.
    const kaynak = "const b = useKirliFormBekcisi({ form, sunucuHatasi });" + PENCERE_ICI_FORM;
    const sonuc = korumasizPencereler(kaynak, "a.tsx");
    expect(sonuc.bulgular).toEqual([]);
    expect(sonuc.belirsiz).toEqual([]);
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
