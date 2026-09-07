// F30 paket etiketi — tek paketin basılabilir kâğıdı.
//
// Neden ayrı bir bileşen (LabelSheet varken): `LabelSheet` bir TURUN duraklarını
// basar ve durak QR'ını (`"{stopId}:{token}"`) taşır. Durak token'ı tur iptal
// edilince kayboluyordu (boşluk G3) — basılı etiket ikinci teslim denemesinde
// geçersizleşiyordu. Paket QR'ı (`PKG1:{id}:{token}`) pakete aittir ve paket
// yaşadığı sürece geçerlidir; bu yüzden kutunun üstüne BU basılır.
//
// ## Veri KAYNAĞI: `GET /packing/packages/{id}/label`
//
// Bileşen commit 6'da yazıldığında hiçbir ekrandan çağrılamıyordu, sebebi
// tembellik değil veriydi: etiket alıcı + adres + teslimat tercihi ister, bunlar
// **siparişte** yaşar ve `PackageOut` şemasında YOKTUR. Backend artık kâğıdın
// tamamını tek istekte veren ayrı bir uç sunuyor (`PackageLabel` tipi); bileşen
// o sözleşmeyi birebir tüketir. Eksik alanlarla bağlamak en kötü seçenekti:
// kâğıt "—" basar ve F26'daki "etiket bomboş çıktı, kimse fark etmedi" hatası
// birebir tekrarlanırdı.
//
// **Telefon basılmaz** (backend de göndermez): kurye numarayı saha ekranından
// taze ve yetki denetimli alır; kâğıt teslimattan sonra da yaşadığı için
// (kutunun üstünde çöpe/kapıya/komşuya gider) geri alınamayan tek kopyaya
// kişisel veri basmamak veri minimizasyonunun kendisidir.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

import { Button, ErrorState } from "@/components/admin/ui";
import { usePackageLabel } from "@/hooks/usePacking";
import { getErrorMessage } from "@/lib/errors";
import { OPERATOR } from "@/lib/legalContent";
import { SITE_NAME } from "@/lib/seo";
import {
  MISSING_ITEMS_TEXT,
  formatItemLine,
  hasItemDetail,
  totalQuantity,
} from "@/lib/orderItems";

/** Etikete basılan kalem. Alan adları `PackageLabelItemOut` ile birebirdir. */
export interface PackageLabelItem {
  order_item_id: number;
  sku?: string | null;
  title: string;
  expected_qty: number;
}

/**
 * Etiketin ihtiyaç duyduğu ALANLAR — `Package` tipinin kendisi DEĞİL.
 *
 * Yapısal bir arayüz, `types/packing.ts::PackageLabel` yanıtını olduğu gibi
 * kabul eder; `Package`'ı doğrudan istemek adres alanlarını paket şemasına
 * sızdırmayı gerektirirdi (etiket uçtan ayrı durmasının bütün gerekçesi bu).
 */
export interface PackageLabelData {
  package_id: number;
  code: string;
  order_id: number;
  /** `PKG1:{id}:{token}` — QR'a basılan GERÇEK yük. */
  qr_payload: string;
  status?: string;
  recipient?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  delivery_pref?: string | null;
  delivery_pref_note?: string | null;
  items?: readonly PackageLabelItem[];
}

/* ════════════════════════ Basılabilirlik ════════════════════════ */

/**
 * Etiketi hangi durumlarda basmaya izin veriyoruz? — **kapalı küme**.
 *
 * Kural iki koşulun kesişimi:
 *
 * 1. **Kutu işletmenin elinde olmalı** (`lib/packing.ts::PACKAGE_LOCATION`'da
 *    `ON_PREMISE`: `OPEN` · `PACKED` · `RETURNED`). Elde olmayan kutuya kâğıt
 *    yapıştırılamaz; `HANDED_OVER` ve `RETURN_PENDING` araçtadır, `DELIVERED`
 *    müşteridedir. Oralarda basılan ikinci bir etiket ancak YANLIŞ bir kutunun
 *    üstüne gidebilir.
 * 2. **İçerik doğrulanmış olmalı** — bu yüzden `OPEN` dışarıda. Açık paketin
 *    kalemleri henüz tek tek okutulmadı; etiket "kutu bunları içerir" diyen bir
 *    beyandır ve yarım kutuya yapıştırıldığında beyan yalan olur. F26'daki
 *    hatanın kalbi tam olarak buydu: doğrulanmamış bir işi "hazır" göstermek.
 *
 * `VOID` de dışarıdadır ama sebebi farklı: paket dağılmıştır ve QR'ı
 * geçersizdir (`packing_rules.TERMINAL_STATUSES`).
 *
 * Küme AÇIK yazılır, `isOnPremise`'ten türetilmez: türetilseydi backend yarın
 * yeni bir `ON_PREMISE` durumu eklediğinde etiket basımı kendiliğinden açılırdı
 * (fail-open). Tanınmayan durumda doğru cevap "basma"dır.
 */
const BASILABILIR_DURUMLAR: ReadonlySet<string> = new Set(["PACKED", "RETURNED"]);

export function canPrintLabel(status: string | null | undefined): boolean {
  return status != null && BASILABILIR_DURUMLAR.has(status);
}

/* ════════════════════════ Baskı sözleşmesi ════════════════════════ */

/** Kuryenin kâğıttan okuyabilmesi için tercihin baskı karşılığı. */
const PREF_PRINT: Record<string, string> = {
  KAPIYA_BIRAK: "KAPIYA BIRAK",
  KOMSUYA_BIRAK: "KOMŞUYA BIRAK",
  BENI_ARA: "TESLİMDE ARA",
};

/**
 * QR kenar uzunluğu (px).
 *
 * Paket yükü (`PKG1:{id}:{token}`) durak yükünden uzundur, yani QR matrisi daha
 * yoğundur; 96 px'te modül boyutu depo yazıcısının nokta çözünürlüğüne fazla
 * yaklaşıyor. 128 px hem `LabelSheet`'in ölçülmüş 96 px tabanının üstünde kalır
 * hem de aşağıdaki sessiz bölge payını (`QR_MARGIN` modül) matrisin kendisini
 * küçültmeden karşılar.
 */
const QR_SIZE = 128;

/**
 * Sessiz bölge (quiet zone) — **modül** cinsinden, ISO/IEC 18004 asgarisi 4.
 *
 * `qrcode.react@4` bunu varsayılan olarak **0** verir. Sıfır sessiz bölge,
 * etiketin çerçevesi ya da komşu metin karekodun ilk modülüne değdiği anda
 * okumayı bozar — depo etiketinde çerçeve ZATEN var (`border`). Ayrıca CSS
 * dolgusu (`p-2`) ile ikinci bir güvenlik payı bırakılır: `marginSize` görüntüye
 * gömülüdür ve kâğıt kesilse de kalır, CSS dolgusu ise yerleşim kaymalarına
 * karşı korur.
 */
const QR_MARGIN = 4;

/**
 * `@media print` kuralı — **görünürlüğü AÇIKÇA geri verir**.
 *
 * `index.css`'teki fatura kuralı `body * { visibility: hidden }` yapıp yalnız
 * `#order-invoice`'i geri açıyor. Etiket portal ile `body`'ye basıldığı için o
 * kuralın kapsamına giriyor; görünürlük geri verilmezse baskı bomboş çıkar
 * (F26'da gerçek Chrome önizlemesinde yaşandı: 1 KB'lık boş PDF).
 *
 * `break-inside: avoid` etiketin sayfa arasında ikiye bölünmesini engeller —
 * yarısı bir sayfada kalan QR okunamaz.
 */
export const LABEL_PRINT_CSS =
  "@media print {" +
  " body > #root { display: none !important; }" +
  " .package-label, .package-label * { visibility: visible !important; }" +
  " .package-label-noprint { display: none !important; }" +
  " .package-label { box-shadow: none !important; border-width: 1px !important;" +
  " break-inside: avoid !important; page-break-inside: avoid !important; }" +
  "}";

/* ════════════════════════ Kâğıdın kendisi ════════════════════════ */

/**
 * Tek etiketin basılan gövdesi — tek başına ekran DEĞİL.
 *
 * Hem tek paketlik pencerede hem çoklu etiket sayfasında (`PackingLabelSheet`)
 * aynı kâğıt basılır; ikisi ayrı yazılsaydı biri düzeltilirken öteki eskirdi
 * (F26'da etiket kusurları tam olarak böyle çoğaldı).
 */
export function PackageLabelCard({ package: paket }: { package: PackageLabelData }) {
  const kalemler = paket.items ?? [];
  // Etikette BEKLENEN adet yazar, taranan değil: kâğıt kutunun ne İÇERMESİ
  // gerektiğini söyler ve paket kapandıktan sonra ikisi zaten eşittir. Taranan
  // adedi basmak, yarım paketin etiketi alınırsa eksik içeriği "doğru"muş gibi
  // gösterirdi. (Uç zaten `scanned_qty` göndermiyor.)
  const gosterilecek = kalemler.map((k) => ({
    title: k.title,
    quantity: k.expected_qty,
  }));
  const tercih = paket.delivery_pref ? PREF_PRINT[paket.delivery_pref] : undefined;
  // İl/ilçe ayrı kolonlarda gelir ve adresin içinde tekrar etmeyebilir; kurye
  // kâğıttan hangi ilçeye gideceğini görmeli.
  const ilIlce = [paket.district, paket.city].filter(Boolean).join(" / ");

  return (
    <section
      role="region"
      aria-label={`Paket etiketi ${paket.code}, sipariş ${paket.order_id}`}
      className="package-label break-inside-avoid rounded-lg border border-slate-300 bg-white p-4 text-slate-900"
    >
      <div className="flex gap-4">
        {/* shrink-0 ZORUNLU ve **flex öğesinin kendisinde** olmalı: sarmalayıcı
            div flex çocuğudur, SVG onun içindedir. Yalnız SVG'ye verildiğinde
            sarmalayıcı büzülüyor ve uzun başlıklı kardeş karekodu YATAY olarak
            eziyordu (F26'da gerçek Chrome ölçümü: 96 px → 36 px, yükseklik 96
            kalıyor) — kare bozulunca karekod okunamaz. */}
        <div
          role="img"
          aria-label={`Paket karekodu ${paket.code}`}
          // `p-2` + beyaz zemin: sessiz bölgenin CSS tarafındaki payı. QR'ın
          // kendi `marginSize`'ı görüntüye gömülüdür, bu ise etiket çerçevesine
          // değmesini engeller.
          className="shrink-0 self-start bg-white p-2"
        >
          <QRCodeSVG
            value={paket.qr_payload}
            // "M" (%15 tolerans): varsayılan "L" %7 verir, depo ortamında
            // etiket buruşur/lekelenir ve okutma başarısız olur.
            level="M"
            size={QR_SIZE}
            marginSize={QR_MARGIN}
            className="shrink-0"
          />
        </div>

        <div className="min-w-0 text-xs leading-5">
          {/* QR okunamazsa operasyon durmasın: insan okunur kod ve sipariş
              numarası kâğıtta AYRICA bulunur (sözleşme, F30 kural 2). Kod bir
              metre uzaktan okunacak kadar büyük ve tek boşlukta durur. */}
          <p className="break-all text-xl font-black leading-tight tracking-tight">
            {paket.code}
          </p>
          <p className="mt-0.5 text-sm font-semibold">Sipariş #{paket.order_id}</p>
          {/* Baskıda kırpma YOK — `truncate`/`line-clamp` yasak: kesilen bir
              adres kuryeyi yanlış kapıya götürür, kesildiğini de göstermez. */}
          <p className="mt-1 break-words font-semibold">{paket.recipient ?? "-"}</p>
          <p className="whitespace-pre-line break-words">{paket.address ?? "-"}</p>
          {ilIlce ? <p className="break-words">{ilIlce}</p> : null}
          {/* Sunucu yer tutucu üretmez; boş değerler `null`'a indirgenir. Yani
              "-" GERÇEKTEN veri yok demektir ve kâğıt bunu saklamamalı. */}
          {paket.recipient == null || paket.address == null ? (
            <p className="mt-1 font-bold">⚠ Adres bilgisi eksik: siparişi açıp kontrol edin</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 border-t border-slate-200 pt-2 text-xs leading-5">
        <p className="text-slate-500">{totalQuantity(gosterilecek)} parça</p>
        {hasItemDetail(gosterilecek) ? (
          <ul className="mt-0.5 font-medium">
            {kalemler.map((k, i) => (
              <li key={k.order_item_id ?? i} className="break-words">
                <span className="font-mono text-[11px] text-slate-500">
                  {k.sku ?? "SKU yok"}
                </span>{" "}
                {formatItemLine(gosterilecek[i])}
              </li>
            ))}
          </ul>
        ) : (
          // Sessiz boşluk hatayı gizler: F26'da etiket bomboş basılmıştı ve
          // kimse fark etmedi. Eksik veri AÇIKÇA yazılır.
          <p className="mt-0.5 font-semibold">{MISSING_ITEMS_TEXT}</p>
        )}
      </div>

      {tercih ? (
        <p className="mt-2 border-t border-slate-200 pt-2 text-sm font-bold">⚑ {tercih}</p>
      ) : null}
      {paket.delivery_pref_note ? (
        <p className="mt-0.5 break-words text-xs font-semibold">
          {paket.delivery_pref_note}
        </p>
      ) : null}
    </section>
  );
}


/* ═══════════════════ 100 × 150 mm TERMAL ETİKET ═══════════════════
 *
 * Kullanıcı isteği (7 Eyl 2026): kargo etiketi standardı olan 100×150 mm
 * termal etiket tasarımı. Önceki kâğıt A4'e göre yazılmıştı ve FİZİKSEL bir
 * ölçüsü yoktu; etiket yazıcısına basıldığında ölçek yazıcının kendi
 * yorumuna kalıyordu.
 *
 * ## Termal baskının yazılı kuralları
 *
 * 1. **Gri YOK.** Termal kafa gri tonu nokta seyreltmesiyle taklit eder;
 *    sonuç lekeli ve okunmaz olur. Bu yüzden burada `text-slate-500` gibi
 *    ara tonlar kullanılmaz — her şey saf siyah, ayrım ÇİZGİ ve PUNTOyladır.
 * 2. **Ölçü `mm`.** `px` yazıcının DPI'ına göre kayar (203 vs 300 dpi),
 *    milimetre fiziksel gerçektir.
 * 3. **Kenar payı 4 mm.** Etiket yazıcıları kenarda 1-2 mm kayabilir;
 *    kritik bilgi kenara yapışmaz.
 * 4. **Kırpma YOK.** Adres asla `truncate` edilmez (A4 kâğıdıyla aynı
 *    kural): kesilen adres kuryeyi yanlış kapıya götürür ve kesildiğini de
 *    göstermez. Bu yüzden yükseklik `min-height`tır, sabit değil: içerik
 *    taşarsa etiket uzar, bilgi GİZLENMEZ.
 * 5. **Tek etiket = tek sayfa.** `break-after: page`.
 */

/** Etiketin fiziksel ölçüsü — tek kaynak. */
export const TERMAL_EN_MM = 100;
export const TERMAL_BOY_MM = 150;

export const TERMAL_PRINT_CSS =
  `@page { size: ${TERMAL_EN_MM}mm ${TERMAL_BOY_MM}mm; margin: 0; }` +
  "@media print {" +
  " body > #root { display: none !important; }" +
  " .termal-etiket, .termal-etiket * { visibility: visible !important; }" +
  " .package-label-noprint { display: none !important; }" +
  " .termal-etiket { box-shadow: none !important; border: none !important;" +
  " break-inside: avoid !important; page-break-inside: avoid !important;" +
  " break-after: page !important; }" +
  " .termal-etiket:last-child { break-after: auto !important; }" +
  "}";

/** Termal etiketin QR'ı: 34 mm ≈ 128 px @96dpi. Daha küçüğü buruşmuş
 *  etikette okunmuyor, daha büyüğü adres alanını yiyor. */
const TERMAL_QR = 128;

export function TermalEtiketKarti({ package: paket }: { package: PackageLabelData }) {
  const kalemler = paket.items ?? [];
  const gosterilecek = kalemler.map((k) => ({
    title: k.title,
    quantity: k.expected_qty,
  }));
  const tercih = paket.delivery_pref ? PREF_PRINT[paket.delivery_pref] : undefined;
  const ilIlce = [paket.district, paket.city].filter(Boolean).join(" / ");
  const eksikAdres = paket.recipient == null || paket.address == null;

  return (
    <section
      role="region"
      aria-label={`Paket etiketi ${paket.code}, sipariş ${paket.order_id}`}
      className="termal-etiket flex flex-col bg-white text-black"
      style={{
        width: `${TERMAL_EN_MM}mm`,
        minHeight: `${TERMAL_BOY_MM}mm`,
        padding: "4mm",
      }}
    >
      {/* ── Üst şerit: LOGO + sipariş ──
          Logo `yatay-siyah` sürümdür: termal kafa renk basmaz, gri tonu da
          lekeye çevirir. Renkli logo basılsaydı gri lekeye dönerdi. */}
      <div className="flex items-center justify-between gap-[3mm] border-b-2 border-black pb-[2mm]">
        <img
          src="/logo-yatay-siyah.svg"
          alt={SITE_NAME}
          style={{ width: "46mm" }}
          className="shrink-0"
        />
        <p className="shrink-0 text-[3.2mm] font-bold">#{paket.order_id}</p>
      </div>

      {/* ── Kod: bir metre uzaktan okunur ── */}
      <p className="mt-[2mm] break-all text-center text-[7mm] font-black leading-none tracking-tight">
        {paket.code}
      </p>

      {/* ── QR: sessiz bölge CSS'te de var (kenara değmesin) ── */}
      <div className="mt-[2mm] flex justify-center">
        <div role="img" aria-label={`Paket karekodu ${paket.code}`} className="bg-white p-[1.5mm]">
          <QRCodeSVG value={paket.qr_payload} level="M" size={TERMAL_QR} marginSize={QR_MARGIN} />
        </div>
      </div>

      {/* ── ALICI: etiketin ASIL işi ── */}
      <div className="mt-[2mm] border-t-2 border-black pt-[2mm]">
        <p className="text-[2.8mm] font-bold uppercase tracking-widest">Alıcı</p>
        <p className="mt-[1mm] break-words text-[4.6mm] font-black leading-tight">
          {paket.recipient ?? "-"}
        </p>
        <p className="mt-[1mm] whitespace-pre-line break-words text-[3.4mm] font-semibold leading-snug">
          {paket.address ?? "-"}
        </p>
        {ilIlce ? (
          <p className="mt-[0.5mm] break-words text-[3.8mm] font-black uppercase">{ilIlce}</p>
        ) : null}
        {eksikAdres ? (
          <p className="mt-[1mm] text-[3.4mm] font-black">
            ⚠ Adres bilgisi eksik: siparişi açıp kontrol edin
          </p>
        ) : null}
      </div>

      {/* ── Teslimat tercihi: kuryenin kapıda okuyacağı not ── */}
      {tercih ? (
        <div className="mt-[2mm] border-2 border-black p-[1.5mm]">
          <p className="text-[3.6mm] font-black">⚑ {tercih}</p>
          {paket.delivery_pref_note ? (
            <p className="mt-[0.5mm] break-words text-[3mm] font-semibold">
              {paket.delivery_pref_note}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── GÖNDERİCİ ──
          Gerçek kargo etiketlerinin değişmezi: paket teslim edilemezse geri
          döneceği adres kâğıdın üstünde yazar. Veri uydurulmuyor, işletme
          kimliğinin TEK kaynağından (`legalContent.ts::OPERATOR`) geliyor —
          aynı bilgi yasal metinlerde de yazılı, ikisi ayrışamaz. */}
      <div className="mt-[2mm] border-t border-black pt-[1.5mm]">
        <p className="text-[2.8mm] font-bold uppercase tracking-widest">Gönderici</p>
        <p className="mt-[0.5mm] text-[3mm] font-semibold leading-snug">
          {OPERATOR.entity} · {OPERATOR.phone}
        </p>
        <p className="text-[2.8mm] leading-snug">{OPERATOR.address}</p>
      </div>

      {/* ── İçerik: en altta, alan artarsa büyür ── */}
      <div className="mt-[2mm] flex-1 border-t border-black pt-[1.5mm]">
        <p className="text-[2.8mm] font-bold uppercase tracking-widest">
          İçerik · {totalQuantity(gosterilecek)} parça
        </p>
        {hasItemDetail(gosterilecek) ? (
          <ul className="mt-[1mm] space-y-[0.5mm] text-[3mm] font-semibold leading-snug">
            {kalemler.map((k, i) => (
              <li key={k.order_item_id ?? i} className="break-words">
                <span className="font-mono">{k.sku ?? "SKU yok"}</span>{" "}
                {formatItemLine(gosterilecek[i])}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-[1mm] text-[3mm] font-black">{MISSING_ITEMS_TEXT}</p>
        )}
      </div>

      {/* ── Alt satır: basım tarihi ──
          Kargo etiketlerinin değişmezi. Paket verisinde bir tarih YOK, bu
          yüzden basım anı yazılır ve "Basım" diye ADLANDIRILIR — "sipariş
          tarihi" sanılmasın. Uydurulmuş bir alan değil, ne olduğu yazılı. */}
      <p className="mt-[2mm] border-t border-black pt-[1mm] text-[2.6mm]">
        Basım: {new Date().toLocaleDateString("tr-TR")}
      </p>
    </section>
  );
}

/* ════════════════════════ Tek paketlik pencere ════════════════════════ */

export function PackageLabel({
  // `package` strict mod'da (ES modülleri her zaman strict) ayrılmış bir
  // sözcüktür; prop adı sözleşme gereği `package` kalır, bağlanan ad değişir.
  package: paket,
  onClose,
}: {
  package: PackageLabelData;
  onClose: () => void;
}) {
  useEffect(() => {
    const kapat = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", kapat);
    return () => window.removeEventListener("keydown", kapat);
  }, [onClose]);

  return createPortal(
    <div className="package-label-overlay fixed inset-0 z-[100] overflow-auto bg-slate-100 p-6 text-slate-900">
      <style>{
        // Tek paket = tek etiket: kâğıt 100×150 mm termal (kullanıcı isteği,
        // 7 Eyl 2026). A4 sayfası ÇOKLU etiket dökümünde yaşamaya devam eder.
        TERMAL_PRINT_CSS +
        // Kaplama katmanı baskıda akıştan çıkarılır; `fixed` kalsaydı yalnız
        // ilk ekran dolusu basılırdı.
        "@media print { .package-label-overlay { position: static !important;" +
        " inset: auto !important; overflow: visible !important;" +
        " background: white !important; padding: 0 !important; }" +
        " .termal-etiket { margin: 0 !important; } }"
      }</style>

      <div className="package-label-noprint mx-auto mb-4 flex max-w-md items-center justify-between">
        <p className="text-sm font-semibold">Paket etiketi: {paket.code}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            aria-label={`${paket.code} etiketini yazdır`}
            className="rounded-lg bg-panel-accent px-4 py-1.5 text-sm font-semibold text-panel-accent-fg hover:bg-panel-accent/90"
          >
            Yazdır
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            Kapat
          </button>
        </div>
      </div>

      {/* Ekranda da GERÇEK ölçüsünde gösterilir: 100×150 mm. "Ekranda başka,
          kâğıtta başka" durumu, F26'daki boş etiket kusurunun sınıfıdır. */}
      <div className="mx-auto w-fit shadow-lg ring-1 ring-slate-300">
        <TermalEtiketKarti package={paket} />
      </div>
    </div>,
    document.body,
  );
}

/* ════════════════════════ Veriyi getiren kapı ════════════════════════ */

/**
 * Kaplama iskeleti — yükleme / hata / eksik veri hâllerinin ortak kabuğu.
 *
 * Bu üç hâlde de kâğıt AÇILMAZ. Boş bir etiket göstermektense sebebi yazmak,
 * F26'nın tek satırlık dersi.
 */
function EtiketKabuk({ baslik, onClose, children }: {
  baslik: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const kapat = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", kapat);
    return () => window.removeEventListener("keydown", kapat);
  }, [onClose]);

  return createPortal(
    <div className="package-label-overlay fixed inset-0 z-[100] overflow-auto bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto flex max-w-md items-center justify-between">
        <p className="text-sm font-semibold">{baslik}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Kapat
        </button>
      </div>
      <div className="mx-auto mt-4 max-w-md">{children}</div>
    </div>,
    document.body,
  );
}

/**
 * "Etiketi yazdır" tıklandığında açılan pencere — veriyi kendisi getirir.
 *
 * ## Bu bileşen hiçbir YAZMA isteği atmaz
 *
 * Etiket basmak (ve YENİDEN basmak) paket durumunu da QR token'ını da
 * değiştirmez; tek istek `GET .../label`'dır. Yeniden basımın yan etkisiz
 * olması operasyonel bir gerekliliktir: `repack` sonrası kutunun üstündeki eski
 * etiket geçerli kalır (boşluk G3), yani kâğıt yırtıldığında aynı kâğıdı
 * yeniden basmak sistemi hiçbir yere taşımamalıdır.
 *
 * ## `qr_payload` yoksa pencere AÇILMAZ
 *
 * Şema `qr_payload`'ı zorunlu tutar, ama istemci bunu VARSAYAMAZ: eski bir
 * sunucu sürümü ya da bozuk bir yanıt boş dizgi getirirse `QRCodeSVG` sessizce
 * boş bir kare çizer ve kutunun üstüne okunamayan bir etiket yapıştırılır.
 * Sessiz boş etiket yasak (F26); sebebi ekranda yazılır.
 */
export function PackageLabelDialog({
  packageId,
  code,
  onClose,
}: {
  packageId: number;
  /** Yükleme/hata başlığında gösterilecek insan okunur kod (biliniyorsa). */
  code?: string;
  onClose: () => void;
}) {
  const sorgu = usePackageLabel(packageId);
  const baslik = `Paket etiketi: ${code ?? `#${packageId}`}`;

  if (sorgu.isError) {
    return (
      <EtiketKabuk baslik={baslik} onClose={onClose}>
        <ErrorState
          description={getErrorMessage(sorgu.error, "Etiket verisi alınamadı.")}
          onRetry={sorgu.refetch}
        />
      </EtiketKabuk>
    );
  }
  if (sorgu.isLoading || !sorgu.data) {
    return (
      <EtiketKabuk baslik={baslik} onClose={onClose}>
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Etiket hazırlanıyor…
        </p>
      </EtiketKabuk>
    );
  }
  if (!sorgu.data.qr_payload) {
    return (
      <EtiketKabuk baslik={baslik} onClose={onClose}>
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          <p className="font-bold">Etiket basılamıyor</p>
          <p className="mt-1">
            Bu paketin karekod bilgisi sunucudan gelmedi. Karekodsuz etiket
            kutunun üstünde işe yaramaz ve kurye paketi okutamaz. Sayfayı
            yenileyin; sorun sürerse paketi yöneticinize bildirin.
          </p>
        </div>
      </EtiketKabuk>
    );
  }

  return <PackageLabel package={sorgu.data} onClose={onClose} />;
}

/**
 * Etiket açma düğmesi + penceresi — üç ekranın ortak girişi.
 *
 * Düğme yalnız `canPrintLabel` doğruysa çıkar; karar tek yerdedir ki istasyon,
 * paket listesi ve ileride eklenecek yüzeyler ayrışmasın.
 */
export function PackageLabelButton({
  packageId,
  code,
  status,
  label = "Etiketi yazdır",
  size = "sm",
  variant = "secondary",
}: {
  packageId: number;
  code?: string;
  status: string | null | undefined;
  label?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
}) {
  // Kanca erken dönüşten ÖNCE çağrılır: `canPrintLabel` durum değiştikçe farklı
  // cevap verir (paket kapanınca `PACKED` olur) ve kancayı dönüşün altına
  // koymak, aynı bileşenin iki render'ında farklı kanca sırası üretirdi.
  const [acik, setAcik] = useState(false);

  if (!canPrintLabel(status)) return null;

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setAcik(true)}>
        {label}
      </Button>
      {acik && (
        <PackageLabelDialog
          packageId={packageId}
          code={code}
          onClose={() => setAcik(false)}
        />
      )}
    </>
  );
}
