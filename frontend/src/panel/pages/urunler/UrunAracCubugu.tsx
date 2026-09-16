/**
 * Ürün listesi araç çubuğunun YÜZEYLERİ — filtre penceresi, kolon ayarı
 * penceresi, içe aktarma çekmecesi, ızgara görünümü — ve listenin
 * hücreleri/satır menüsü (envanter, maliyet, durum rozeti,
 * Düzenle/Gizle/Kapak/Sil). Filtre ve kolon ayarı, canlı ikas'taki gibi
 * düğmelerin ALTINDA açılan pencerelerdir (`ListePage.filtreIcerigi` /
 * `kolonAyariIcerigi`); açık/kapalı durumu `UrunListesi`de yaşar.
 *
 * Referans: `docs/ikas-panel-referans.md` §3 (liste ekranı araç çubuğu) ve §7
 * "Başlık satırı ve araç çubuğu — ÖLÇÜLEN". `ListePage` bu düğmeleri zaten
 * çiziyordu (`filtreTiklandi`, `kolonAyariTiklandi`, `listeGorunumuTiklandi`,
 * `izgaraGorunumuTiklandi`) ama tüketici hiçbirini geçmediği için düğmeler
 * ekranda YOKTU — bu dosya o dört düğmenin arkasındaki gerçek yüzeyi taşır.
 *
 * ## Neden AYRI dosya (UrunListesi.tsx'in İÇİNE gömülmedi)
 *
 * `UrunOlusturCekmecesi.tsx`'in dosya başındaki gerekçenin AYNISI:
 * `uiBaseline.test.ts::modalDurumu` eşiği `toBe(0)` ve sayaç, pencere
 * durumunun AYNI DOSYADA yaşamasını borç sayıyor ("başka DOSYADAN import
 * edilen bir bileşene inen durum görünmez", bkz. `scripts/ui-baseline-
 * sayim.mjs`). `<Drawer open={filtreAcik}>` `UrunListesi.tsx`e yazılsaydı o
 * nöbetçi kırılırdı. Panelin kendi öncül deseni de bu:
 * `UrunOlusturCekmecesi` ve `VaryantPenceresi` de ayrı dosyalardadır.
 *
 * ## Kapı notu (çalışma zamanı kapısı)
 *
 * `calismaZamaniKapisi.test.tsx` panel ağacındaki her dosyayı PROPSUZ mount
 * eder ve modülün ilk büyük harfli export'unu render eder (alfabetik: bu
 * dosyada `DurumRozeti`). Bu yüzden bütün export'lar propsuz render'da
 * FIRLATMAYACAK biçimde yazıldı (`DurumRozeti` → null, `FiltrePaneli` boş
 * filtre, `KolonAyariPaneli` hepsi açık). Mount edilen ilk export hiçbir
 * kontrol render etmediği için dosya kapıda `KONTROLSUZ_EKRANLAR`'a
 * "pencere-kabugu" gerekçesiyle yazılıdır.
 *
 * ## KOPYALANMAYAN iki denetim (bilinçli boşluk)
 *
 * 1. **"Dışa Aktar" düğmesi YOK.** ikas'ta var (§2) ama backend'de ürün dışa
 *    aktarma ucu yok (`backend/api/routers/store.py`'de ürün için CSV indirme
 *    yok) ve uç eklemek bu paketin kapsamı dışı. Hiçbir şey yapmayan düğme
 *    kullanıcıya yalan söyler.
 * 2. **Satır seçimi checkbox'ı YOK** (`ListePage.satirSecimi` geçilmiyor):
 *    toplu aksiyon ucu yok, seçim tek başına ölü denetim olur.
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  App,
  Button,
  Dropdown,
  Flex,
  List,
  Select,
  Switch,
  Tag,
  Typography,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { DeleteOutlined, MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { YanPencere } from "@/panel/components/YanPencere";
import { deleteProduct, updateProduct, uploadProductCover } from "@/api/store";
import { useBookFacets, useBulkImportProducts, useInvalidateAdminStore } from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import { CSV_COLUMNS, buildCsvTemplate } from "@/lib/productCsvTemplate";
import { ROUTES } from "@/lib/routes";
import type { StokFiltresi, TedarikciFiltresi } from "@/lib/storeProductQuery";
import type { BulkImportResult, ProductSearchOut } from "@/types";
import { onayAc } from "@/panel/components/onayPenceresi";

/* ────────────────────────────── Filtre ────────────────────────────── */

/**
 * Ekranda yaşayan filtre durumu — alan adları TÜRKÇE, sunucu adlarına çeviri
 * `UrunListesi`'nde yapılır (`yayinevi` → `publisher`, `yazar` → `author`,
 * `tedarikci` → `supplier`). Aynı ayrım eski panelin `lib/storeProductQuery`
 * dosyasında da var; kovaların TİPİ oradan (tek kaynak) import edilir ki
 * sunucunun `Literal` beyaz listesiyle ayrışmasın.
 */
export type UrunFiltresi = {
  stok?: StokFiltresi;
  yayinevi?: string;
  yazar?: string;
  tedarikci?: TedarikciFiltresi;
};

export const BOS_FILTRE: UrunFiltresi = {};

type FiltreAlani = keyof UrunFiltresi;

/** Rozet sayısı: kaç filtre listeyi daraltıyor (arama BURADA sayılmaz). */
export function filtreSayisi(filtre: UrunFiltresi): number {
  return [filtre.stok, filtre.yayinevi, filtre.yazar, filtre.tedarikci].filter(Boolean).length;
}

/**
 * Stok kovaları — etiketler eski panelin (`components/admin/store/
 * ProductsPanel.tsx`) insan adlarıyla BİREBİR aynı, değerler sunucunun
 * `Literal["tukendi","azalan","var","kritik"]` beyaz listesi
 * (`backend/core/stock_policy.py::stok_kovasi_yuklemi`).
 *
 * `kritik` = `tukendi` + `azalan` (dashboard kartının kümesi) — bu yüzden
 * "Tükendi + azalan" diye anılır, uydurma bir üçüncü kova değildir.
 */
const STOK_SECENEKLERI: { value: StokFiltresi; label: string }[] = [
  { value: "tukendi", label: "Tükendi" },
  { value: "azalan", label: "Azalan" },
  { value: "kritik", label: "Tükendi + azalan" },
  { value: "var", label: "Stokta" },
];

/**
 * Tedarikçi kovaları — anlamları `store_service.py::_admin_filtreleri`'den
 * DOĞRULANDI (tahmin değil):
 *   `linked`     → ürünün silinmemiş bir tedarikçi satırına bağlı olması
 *   `backed`     → `Product.supplier_backed` bayrağının açık olması (bağ
 *                  olmadan da açık olabilir; o hâl bir uyarıdır)
 *   `below_cost` → tedarikçi maliyeti satış fiyatına eşit/üstünde, yani para
 *                  kaybı. Bir süzgeç değil ALARM listesidir; etiketi de öyle.
 */
const TEDARIKCI_SECENEKLERI: { value: TedarikciFiltresi; label: string }[] = [
  { value: "linked", label: "Bağlı" },
  { value: "backed", label: "Tedarikçiden temin" },
  { value: "below_cost", label: "Zararına satılan" },
];

const ALAN_ETIKETI: Record<FiltreAlani, string> = {
  stok: "Stok durumu",
  yayinevi: "Yayınevi",
  yazar: "Yazar",
  tedarikci: "Tedarikçi",
};

/** Pencerede düzenlenen satır: alan + (henüz seçilmemiş olabilen) değer. */
type FiltreSatiri = { alan: FiltreAlani; deger?: string };

function filtredenSatirlar(filtre: UrunFiltresi): FiltreSatiri[] {
  return (Object.keys(ALAN_ETIKETI) as FiltreAlani[])
    .filter((alan) => filtre[alan])
    .map((alan) => ({ alan, deger: filtre[alan] as string }));
}

function satirlardanFiltre(satirlar: FiltreSatiri[]): UrunFiltresi {
  const sonuc: UrunFiltresi = {};
  for (const s of satirlar) {
    if (!s.deger) continue;
    if (s.alan === "stok") sonuc.stok = s.deger as StokFiltresi;
    else if (s.alan === "tedarikci") sonuc.tedarikci = s.deger as TedarikciFiltresi;
    else sonuc[s.alan] = s.deger;
  }
  return sonuc;
}

export type FiltrePaneliProps = {
  /** Uygulanmış (listeyi daraltan) filtre — pencere açılınca satırlar bundan kurulur. */
  filtre?: UrunFiltresi;
  /** "Uygula": satırların tamamı tek seferde uygulanır; sayfayı 1'e döndürmek çağıranın işi. */
  uygula?: (filtre: UrunFiltresi) => void;
};

/**
 * Filtre penceresi — canlı ikas anatomisi (11 Eyl 2026 ölçümü): `Filtre`
 * düğmesinin ALTINDA 740px pencere; her satır `[alan seçici 162px] [değer
 * seçici] [çöp]`, altında `+ Filtre Ekle` bağlantısı, sağ altta `Uygula`.
 * Boşken "Henüz filtre eklemediniz." ikas'ta bir de OPERATÖR seçicisi var
 * ("içeren" vb.); bizim uçların hepsi tam eşleşme kabul ettiği için o
 * seçici KOPYALANMADI — tek seçenekli bir seçici ölü denetim olurdu.
 *
 * Seçim ikas'taki gibi `Uygula` ile uygulanır (anında değil): satırlar
 * yerel taslakta yaşar, pencere kapanıp açılınca uygulanmış filtreden
 * yeniden kurulur.
 *
 * `yayinevi`/`yazar` seçenekleri GERÇEK bir kaynaktan gelir: `/store/book-
 * facets` (`useBookFacets`) yayınevi ve yazar değerlerini ürün sayılarıyla
 * döndürür; eski panelin ürün listesi de AYNI kaynağı kullanıyor. Bilinen
 * sınır: bu uç vitrin (ACTIVE) katalogunu özetler; yalnız taslak/gizli
 * üründe geçen bir yayınevi listede görünmez.
 *
 * Kapı notu: propsuz mount edilir (`calismaZamaniKapisi`) — `filtre`
 * verilmezse boş sayılır, hiçbir şey fırlatmaz.
 */
export function FiltrePaneli({ filtre, uygula }: FiltrePaneliProps) {
  const { token } = theme.useToken();
  const facets = useBookFacets();
  // Tedarikçi süzgeci maliyet kolonuyla AYNI izin duvarının arkasında (D-6):
  // `suppliers.view` izni olmayan yöneticiye sunucu tedarikçi bloğunu hiç
  // doldurmaz, filtre ona boş liste döndürürdü. Eski panel de aynı kapıyı
  // uyguluyor (`ProductsPanel.tsx`).
  const tedarikciGorebilir = useAdminAreaAccess("suppliers").canView;
  const [satirlar, setSatirlar] = useState<FiltreSatiri[]>(() => filtredenSatirlar(filtre ?? BOS_FILTRE));

  const alanlar = (Object.keys(ALAN_ETIKETI) as FiltreAlani[]).filter(
    (a) => a !== "tedarikci" || tedarikciGorebilir,
  );
  const kullanilan = new Set(satirlar.map((s) => s.alan));
  const bosAlan = alanlar.find((a) => !kullanilan.has(a));

  const kunyeSecenekleri = (kovalar?: { value: string; count: number }[]) =>
    (kovalar ?? []).map((k) => ({ value: k.value, label: `${k.value} (${k.count})` }));

  const degerSecenekleri = (alan: FiltreAlani): { value: string; label: string }[] => {
    if (alan === "stok") return STOK_SECENEKLERI;
    if (alan === "tedarikci") return TEDARIKCI_SECENEKLERI;
    if (alan === "yayinevi") return kunyeSecenekleri(facets.data?.publisher);
    return kunyeSecenekleri(facets.data?.author);
  };

  const satiriDegistir = (i: number, yama: Partial<FiltreSatiri>) =>
    setSatirlar((onceki) => onceki.map((s, j) => (j === i ? { ...s, ...yama } : s)));

  return (
    <Flex vertical gap={12}>
      {satirlar.length === 0 ? (
        <Typography.Text type="secondary">Henüz filtre eklemediniz.</Typography.Text>
      ) : null}
      {satirlar.map((satir, i) => (
        <Flex key={satir.alan} gap={8} align="center" wrap>
          <Select<FiltreAlani>
            aria-label="Filtre alanı"
            value={satir.alan}
            style={{ width: 162 }}
            options={alanlar
              .filter((a) => a === satir.alan || !kullanilan.has(a))
              .map((a) => ({ value: a, label: ALAN_ETIKETI[a] }))}
            onChange={(alan) => satiriDegistir(i, { alan, deger: undefined })}
          />
          <Select<string>
            aria-label="Filtre değeri"
            placeholder="Seçiniz"
            showSearch={satir.alan === "yayinevi" || satir.alan === "yazar"}
            optionFilterProp="label"
            loading={(satir.alan === "yayinevi" || satir.alan === "yazar") && facets.isPending}
            value={satir.deger}
            style={{ flex: "1 1 200px" }}
            options={degerSecenekleri(satir.alan)}
            onChange={(deger) => satiriDegistir(i, { deger })}
          />
          <Button
            type="text"
            icon={<DeleteOutlined />}
            aria-label={`${ALAN_ETIKETI[satir.alan]} filtresini kaldır`}
            onClick={() => setSatirlar((onceki) => onceki.filter((_, j) => j !== i))}
          />
        </Flex>
      ))}
      <Flex justify="space-between" align="center" gap={8} wrap>
        {bosAlan ? (
          <Button
            type="link"
            icon={<PlusOutlined aria-hidden="true" />}
            style={{ padding: 0, fontWeight: 500 }}
            onClick={() => setSatirlar((onceki) => [...onceki, { alan: bosAlan }])}
          >
            Filtre Ekle
          </Button>
        ) : (
          <Typography.Text type="secondary" style={{ color: token.colorTextTertiary }}>
            Tüm filtre alanları eklendi.
          </Typography.Text>
        )}
        <Button type="primary" onClick={() => uygula?.(satirlardanFiltre(satirlar))}>
          Uygula
        </Button>
      </Flex>
    </Flex>
  );
}

/* ──────────────────────────── İçe aktarma ──────────────────────────── */

/**
 * CSV ile ürün içe aktarma — gerçek uç `POST /store/admin/products/bulk`
 * (`api/store.ts::bulkImportProducts`, `hooks/useStore.ts::
 * useBulkImportProducts`; mutation önbelleği kendisi geçersizleştiriyor).
 *
 * Sonuç TOAST'la GÖSTERİLMEZ: sunucu satır satır hata döndürüyor
 * (`BulkImportResult.errors: {row, message}[]`) ve üç saniyede kaybolan bir
 * bildirimde bunlar okunamaz. Çekmece yüklemeden sonra AÇIK kalır, özet
 * (eklendi/atlandı) + hata satırları listelenir; kullanıcı kapatana kadar
 * durur.
 *
 * Dosya seçici ham `<input type="file" hidden>` + görünür bir `Button`
 * ile tetiklenir — `MedyaSekmesi.tsx`/`LibraryMediaManager.tsx`'teki aynı
 * desen (AntD `Upload`, `hidden` yerine `display:none` yazdığı için
 * erişilebilirlik sayacında ADSIZ bir kontrol bırakıyordu).
 */
export function IceAktarCekmecesi({ acik, kapat }: { acik: boolean; kapat: () => void }) {
  const girdi = useRef<HTMLInputElement>(null);
  const [dosya, setDosya] = useState<File | null>(null);
  const [sonuc, setSonuc] = useState<BulkImportResult | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const iceAktar = useBulkImportProducts();

  const kapatVeSifirla = () => {
    setDosya(null);
    setSonuc(null);
    setHata(null);
    kapat();
  };

  // Eski panelin `BulkImportPanel`i ile AYNI şablon (`lib/productCsvTemplate`,
  // kolon sırası nöbetçiyle korunuyor). BOM Excel'in Türkçe karakterleri
  // doğru açması için.
  const sablonIndir = () => {
    const blob = new Blob([`﻿${buildCsvTemplate()}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "urun-sablonu.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const yukle = async () => {
    // Gönder düğmesi geçerlilikle KAPANMAZ (kilitli karar): dosya seçilmeden
    // basılınca sebebi alanda okunur.
    if (!dosya) {
      setHata("Önce içe aktarılacak CSV dosyasını seçin.");
      return;
    }
    setHata(null);
    setSonuc(null);
    try {
      setSonuc(await iceAktar.mutateAsync(dosya));
    } catch (e) {
      // Sunucu 400'lerde konuşuyor ("Yalnızca .csv dosyası yükleyin.",
      // "CSV boş (başlık satırı + en az bir ürün gerekli).") — mesaj
      // yutulmaz, kullanıcıya aynen gösterilir.
      setHata(getErrorDetail(e, "Dosya içe aktarılamadı."));
    }
  };

  return (
    <YanPencere
      acik={acik}
      baslik="Ürünleri İçe Aktar"
      kapat={kapatVeSifirla}
      kaydet={yukle}
      kaydediyor={iceAktar.isPending}
      kaydetMetni="Yükle"
    >
      <Flex vertical gap={16}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Başlık satırı içeren bir .csv dosyası seçin. <b>title</b>, <b>price</b> ve{" "}
          <b>tax_rate</b> zorunludur; KDV oranı oran olarak yazılır (0.20 = %20). Aynı ISBN
          varsa satır atlanır. Dosya sunucuda satır satır işlenir; eklenemeyen satırlar
          aşağıda satır numarasıyla listelenir.
        </Typography.Paragraph>
        <Flex vertical gap={4} align="flex-start">
          <Button type="link" style={{ padding: 0 }} onClick={sablonIndir}>
            Şablon CSV indir
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12, wordBreak: "break-word" }}>
            Sütunlar: {CSV_COLUMNS}
          </Typography.Text>
        </Flex>

        <input
          ref={girdi}
          hidden
          type="file"
          accept=".csv,text/csv"
          aria-label="İçe aktarılacak CSV dosyası"
          onChange={(e) => {
            setDosya(e.target.files?.[0] ?? null);
            setSonuc(null);
            setHata(null);
          }}
        />
        <Flex align="center" gap={12} wrap>
          <Button onClick={() => girdi.current?.click()}>Dosya Seç</Button>
          <Typography.Text type={dosya ? undefined : "secondary"}>
            {dosya ? dosya.name : "Dosya seçilmedi"}
          </Typography.Text>
        </Flex>

        {hata ? <Alert type="error" showIcon message={hata} /> : null}

        {sonuc ? (
          <Flex vertical gap={12}>
            <Alert
              type={sonuc.errors.length > 0 ? "warning" : "success"}
              showIcon
              message={`${sonuc.created} ürün eklendi, ${sonuc.skipped} satır atlandı, ${sonuc.errors.length} satır hatalı.`}
            />
            {sonuc.errors.length > 0 ? (
              <List
                size="small"
                bordered
                header={<Typography.Text strong>Hatalı satırlar</Typography.Text>}
                dataSource={sonuc.errors}
                rowKey={(h) => `${h.row}-${h.message}`}
                renderItem={(h) => (
                  <List.Item>
                    <Typography.Text>
                      {h.row}. satır: {h.message}
                    </Typography.Text>
                  </List.Item>
                )}
              />
            ) : null}
          </Flex>
        ) : null}
      </Flex>
    </YanPencere>
  );
}

/* ───────────────────────────── Kolon ayarı ───────────────────────────── */

/**
 * Kapatılabilir kolonlar — "Ürün" BİLEREK yok: ikas'ta da liste ürün
 * hücresinden ibaret olamaz, adı gizlenen satır tıklanamaz bir boşluğa
 * dönüşürdü. Satır aksiyonları kolonu da (`aksiyonlar`) kapatılamaz: tek
 * gezinme yolu odur.
 *
 * `maliyet` kolonu `suppliers.view` izninin arkasındadır (D-6): izni olmayan
 * yöneticiye seçenek olarak da SUNULMAZ (`kapatilabilirKolonlar`).
 */
export const KAPATILABILIR_KOLONLAR: { value: string; label: string }[] = [
  { value: "price", label: "Satış Fiyatı" },
  { value: "stock", label: "Envanter" },
  { value: "status", label: "Durum" },
  { value: "maliyet", label: "Maliyet / Marj" },
];

/** İzne göre daraltılmış seçenek listesi — tek kaynak, iki tüketici. */
export function kapatilabilirKolonlar(tedarikciGorebilir: boolean) {
  return KAPATILABILIR_KOLONLAR.filter((k) => k.value !== "maliyet" || tedarikciGorebilir);
}

/**
 * Kolon ayarı penceresi — canlı ikas anatomisi: kolon ayarı düğmesinin
 * altında, her satırda `etiket + anahtar (Switch)`; seçim ANINDA uygulanır,
 * ayrı bir "Kaydet" yok. ikas'ta satır başında sürükleme tutamacı da var
 * (kolon sırası); bizde kolon sırası tercihi tutulmadığı için tutamaç
 * KOPYALANMADI (ölü denetim olurdu).
 *
 * Kapı notu: propsuz mount edilir — `gorunurler` yoksa hepsi açık sayılır.
 */
export function KolonAyariPaneli({
  secenekler,
  gorunurler,
  degisti,
}: {
  /** Sunulacak kapatılabilir kolonlar (izne göre daraltılmış). */
  secenekler?: { value: string; label: string }[];
  /** Açık (görünür) kapatılabilir kolon anahtarları. */
  gorunurler?: string[];
  degisti?: (gorunurler: string[]) => void;
}) {
  const liste = secenekler ?? KAPATILABILIR_KOLONLAR;
  const acik = gorunurler ?? liste.map((k) => k.value);
  const satir = (etiket: string, kontrol: ReactNode) => (
    <Flex key={etiket} justify="space-between" align="center" gap={16} style={{ minHeight: 24 }}>
      <Typography.Text>{etiket}</Typography.Text>
      {kontrol}
    </Flex>
  );
  return (
    <Flex vertical gap={16} style={{ minWidth: 232 }}>
      {/* "Ürün" kolonu kapatılamaz — anahtar görünür ama açık ve kilitli;
          gizlemek "neden kapatamıyorum" sorusunu cevapsız bırakırdı. */}
      {satir("Ürün", <Switch checked disabled aria-label="Ürün" size="small" />)}
      {liste.map((k) =>
        satir(
          k.label,
          <Switch
            size="small"
            aria-label={k.label}
            checked={acik.includes(k.value)}
            onChange={(v) =>
              degisti?.(v ? [...acik, k.value] : acik.filter((a) => a !== k.value))
            }
          />,
        ),
      )}
    </Flex>
  );
}

/* ──────────────────────────── Hücreler ──────────────────────────── */

/** Envanter metni — liste ve ızgara AYNI kuralı kullanır (dijitalde `—`). */
export function envanterMetni(stok?: number | null): string {
  return stok == null ? "—" : `${stok} adet`;
}

/**
 * Envanter hücresi — eski panelin `StokHucresi`si ile aynı kurallar:
 *   • dijital (`null`) → `—`
 *   • 0 → kırmızı "Tükendi" (eşikten bağımsız)
 *   • ≤ eşik → amber (eşik SUNUCUDAN, `/store/config`; gelmediyse nötr)
 *   • tedarikçi karşılıyorsa ve kendi rafı boşsa "Kendi stoğu 0" + tedarikçi
 *     stoğu ayrı satırda (D-1: iki sayı asla karıştırılmaz)
 */
export function EnvanterHucresi({ urun, esik }: { urun: ProductSearchOut; esik?: number }) {
  const tedarikci = urun.supplier;
  const tedarikciKarsiliyor =
    !!urun.supplier_backed && !!tedarikci && Number(tedarikci.stock_qty) >= 1;
  const stok = urun.stock;

  let ana: ReactNode;
  if (stok == null) ana = <Typography.Text type="secondary">—</Typography.Text>;
  else if (stok <= 0 && tedarikciKarsiliyor) ana = <Tag>Kendi stoğu 0</Tag>;
  else if (stok <= 0) ana = <Tag color="error">Tükendi</Tag>;
  else if (esik !== undefined && stok <= esik) ana = <Tag color="warning">{stok} adet</Tag>;
  else ana = <span>{envanterMetni(stok)}</span>;

  return (
    <Flex vertical gap={2} align="flex-start">
      {ana}
      {urun.supplier_backed && tedarikci ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          Tedarikçide {tedarikciStogu(tedarikci.stock_qty)}
          {tedarikci.unit_name ? ` ${tedarikci.unit_name}` : ""}
        </Typography.Text>
      ) : null}
    </Flex>
  );
}

/** Tedarikçi stoğu kesirli olabilir (`"12.500"` → `"12,5"`). */
function tedarikciStogu(deger: string): string {
  const sayi = Number(deger);
  if (!Number.isFinite(sayi)) return deger;
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(sayi);
}

/**
 * Maliyet / marj hücresi — YALNIZ `suppliers.view` izniyle çizilir (D-6).
 * "Zararına" rozeti para kaybettiren satırı işaretler.
 */
export function MaliyetHucresi({ urun }: { urun: ProductSearchOut }) {
  const tedarikci = urun.supplier;
  if (!tedarikci || !tedarikci.cost_gross) {
    return <Typography.Text type="secondary">—</Typography.Text>;
  }
  const marj = tedarikci.margin_percent == null ? null : Number(tedarikci.margin_percent);
  return (
    <Flex align="center" gap={8} wrap>
      <span style={{ whiteSpace: "nowrap" }}>{formatTL(tedarikci.cost_gross)}</span>
      {marj != null && Number.isFinite(marj) ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          %{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(marj)}
        </Typography.Text>
      ) : null}
      {tedarikci.below_cost ? <Tag color="error">Zararına</Tag> : null}
    </Flex>
  );
}

const URUN_DURUM_ETIKETI: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Yayında", color: "success" },
  HIDDEN: { label: "Gizli", color: "default" },
  DRAFT: { label: "Taslak", color: "warning" },
};

/** Durum rozeti — bilinmeyen durum HAM basılır, sessizce gizlenmez. */
export function DurumRozeti({ durum }: { durum?: string | null }) {
  if (!durum) return null;
  const esleme = URUN_DURUM_ETIKETI[durum];
  return <Tag color={esleme?.color ?? "default"}>{esleme?.label ?? durum}</Tag>;
}

/* ───────────────────────── Satır aksiyonları ───────────────────────── */

/**
 * Satır menüsü — eski panelin `UrunAksiyonlari`si ile aynı dört işlem:
 * Düzenle · Gizle/Yayınla · Kapak görseli yükle · Sil. Hepsi gerçek uçlara
 * gider (`updateProduct`, `uploadProductCover`, `deleteProduct`).
 *
 * `yonetebilir` değilse (yalnız `products.view`) menüde SADECE "Düzenle"
 * kalır; mutasyonlar hiç sunulmaz.
 *
 * Silme onayı `App.useApp().modal.confirm` ile (imperatif): dosyada
 * `<Modal open={...}>` durumu doğmaz (`uiBaseline::modalDurumu`).
 */
export function UrunSatirAksiyonlari({
  urun,
  yonetebilir,
  duzenle,
}: {
  urun: ProductSearchOut;
  yonetebilir: boolean;
  duzenle: () => void;
}) {
  const { message, modal } = App.useApp();
  const yenile = useInvalidateAdminStore();
  const dosyaRef = useRef<HTMLInputElement>(null);

  const kapak = useMutation({
    mutationFn: (dosya: File) => uploadProductCover(urun.id, dosya),
    onSuccess: () => {
      message.success("Kapak güncellendi.");
      yenile();
    },
    onError: (hata: unknown) => message.error(getErrorDetail(hata, "Kapak yüklenemedi.")),
  });
  const durumDegistir = useMutation({
    mutationFn: () =>
      updateProduct(urun.id, { status: urun.status === "ACTIVE" ? "HIDDEN" : "ACTIVE" }),
    onSuccess: yenile,
    onError: (hata: unknown) => message.error(getErrorDetail(hata, "Durum değiştirilemedi.")),
  });
  const sil = useMutation({
    mutationFn: () => deleteProduct(urun.id),
    onSuccess: () => {
      message.success("Ürün silindi.");
      yenile();
    },
    onError: (hata: unknown) => message.error(getErrorDetail(hata, "Ürün silinemedi.")),
  });

  const bekliyor = kapak.isPending || durumDegistir.isPending || sil.isPending;

  const ogeler: MenuProps["items"] = [
    { key: "duzenle", label: "Düzenle" },
    ...(yonetebilir
      ? [
          { key: "durum", label: urun.status === "ACTIVE" ? "Gizle" : "Yayınla" },
          { key: "kapak", label: "Kapak görseli yükle" },
          { type: "divider" as const },
          { key: "sil", label: "Sil", danger: true },
        ]
      : []),
  ];

  const sec: MenuProps["onClick"] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === "duzenle") duzenle();
    else if (key === "durum") durumDegistir.mutate();
    else if (key === "kapak") dosyaRef.current?.click();
    else if (key === "sil") {
      onayAc(modal, {
        title: "Ürünü sil",
        content: `"${urun.title}" katalogdan kaldırılacak.`,
        okText: "Ürünü sil",
        okButtonProps: { danger: true },
        cancelText: "Vazgeç",
        // Kapanış `onayAc`ta: mutasyon reddi AntD'ye çıkmaz, pencere açık kalır.
        mesgulMu: () => sil.isPending,
        calistir: () => sil.mutateAsync(),
      });
    }
  };

  return (
    <>
      {yonetebilir ? (
        <input
          ref={dosyaRef}
          hidden
          type="file"
          accept="image/*"
          aria-label={`${urun.title} için kapak görseli`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const dosya = e.target.files?.[0];
            if (dosya) kapak.mutate(dosya);
            e.target.value = "";
          }}
        />
      ) : null}
      <Dropdown trigger={["click"]} menu={{ items: ogeler, onClick: sec }}>
        <Button
          type="text"
          icon={<MoreOutlined />}
          loading={bekliyor}
          aria-label="satır aksiyonları"
          onClick={(e) => e.stopPropagation()}
        />
      </Dropdown>
    </>
  );
}

/* ──────────────────────────── Izgara görünümü ──────────────────────────── */

/**
 * Izgara görünümü: ürün kartları (kapak + ad + fiyat + envanter + durum).
 *
 * ## Kart bir BAĞLANTI (div+onClick DEĞİL)
 *
 * Kart `Link`tir: odaklanabilir, Enter çalışır, orta tuşla yeni sekmede
 * açılır. Liste görünümündeki satır tıklaması (`onCell` + `navigate`) klavye
 * için satır menüsündeki "Düzenle"ye dayanıyor; ızgarada satır menüsü yok, bu
 * yüzden kartın KENDİSİ klavyeyle erişilebilir olmak zorunda.
 *
 * ## `width: 0` + `minWidth: 100%` NEDEN
 *
 * Uzun bir ürün adının kartın intrinsic genişliğini büyütüp ızgarayı
 * container'dan taşırmaması için: `width: 0` kesin bir değer olduğundan kartın
 * intrinsic katkısı 0 olur; gerçek genişlik `minWidth: 100%` ile yerleşim
 * anında geri gelir. Böylece `auto-fill` masaüstünde çok kolon, ≤768px'te
 * tek/iki kolon üretir ve MOBİLDE yatay kaydırma doğmaz.
 */
export function UrunIzgarasi({ urunler, esik }: { urunler: ProductSearchOut[]; esik?: number }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "grid",
        // Canlı ikas kartı ≈238px geniş; `auto-fill` masaüstünde çok kolon,
        // dar ekranda tek/iki kolon üretir.
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 16,
      }}
    >
      {urunler.map((urun) => (
        <Link
          key={urun.id}
          to={ROUTES.adminNewProductEdit(urun.id)}
          style={{
            display: "block",
            width: 0,
            minWidth: "100%",
            overflow: "hidden",
            padding: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
            color: token.colorText,
          }}
        >
          <div
            style={{
              aspectRatio: "1 / 1",
              marginBottom: 12,
              overflow: "hidden",
              borderRadius: 4,
              background: token.colorBgLayout,
            }}
          >
            {urun.cover_url ? (
              // Dekoratif: kartın erişilebilir adı ürün adı + fiyat + envanter
              // metinlerinden geliyor.
              <img
                src={urun.cover_url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : null}
          </div>
          <Typography.Text strong ellipsis={{ tooltip: urun.title }} style={{ display: "block" }}>
            {urun.title}
          </Typography.Text>
          <Typography.Text style={{ display: "block" }}>{formatTL(urun.price)}</Typography.Text>
          {/* ikas: kartın altında kesik çizgili ayırıcı + envanter satırı. */}
          <Flex
            align="center"
            justify="space-between"
            gap={8}
            wrap
            style={{ marginTop: 12, paddingTop: 8, borderTop: `1px dashed ${token.colorBorderSecondary}` }}
          >
            <EnvanterHucresi urun={urun} esik={esik} />
            <DurumRozeti durum={urun.status} />
          </Flex>
        </Link>
      ))}
    </div>
  );
}
