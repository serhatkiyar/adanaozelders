import { useMemo, useState } from "react";
import { Button, Flex, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { PlusOutlined, ImportOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { ListePage } from "@/panel/components/ListePage";
import { UrunOlusturCekmecesi } from "@/panel/pages/urunler/UrunOlusturCekmecesi";
import {
  BOS_FILTRE,
  DurumRozeti,
  EnvanterHucresi,
  FiltrePaneli,
  IceAktarCekmecesi,
  KAPATILABILIR_KOLONLAR,
  KolonAyariPaneli,
  MaliyetHucresi,
  UrunIzgarasi,
  UrunSatirAksiyonlari,
  filtreSayisi,
  kapatilabilirKolonlar,
} from "@/panel/pages/urunler/UrunAracCubugu";
import type { UrunFiltresi } from "@/panel/pages/urunler/UrunAracCubugu";
import { useAdminProducts, useStoreConfig } from "@/hooks/useStore";
import { useDebounce } from "@/hooks/useDebounce";
import { formatTL } from "@/lib/money";
import { ROUTES } from "@/lib/routes";
import type { ProductSearchOut } from "@/types";

/** `AdminProductQuery.sort` ile birebir — bkz. `backend/api/routers/store.py` `list_products_admin`. */
type UrunSiralamaAlani = "title" | "price" | "stock" | "created_at";
const SIRALANABILIR_ALANLAR: readonly UrunSiralamaAlani[] = ["title", "price", "stock", "created_at"];

type UrunSiralama = { alan: UrunSiralamaAlani; yon: "asc" | "desc" } | undefined;

type Gorunum = "liste" | "izgara";

/**
 * Görünüm ve kolon tercihi KİŞİSEL tercihtir, veri seçimi değil — bu yüzden
 * URL'de değil `localStorage`'da yaşar. (Aynı ayrım eski panelin
 * `lib/storeProductQuery.ts` dosya başı notunda da yazılı: "veri seçimi
 * URL'de yaşar... kişisel tercih ileride kalıcı depoya gidebilir".)
 *
 * Her okuma/yazma `try/catch` içinde: gizli pencerede, site verisi
 * engellenmişken ya da kota dolduğunda `localStorage` erişimi FIRLATIR.
 * Depo çalışmazsa ekran yine çalışır, tercih sadece hatırlanmaz.
 */
const GORUNUM_ANAHTARI = "panel.urunler.gorunum";
const KOLON_ANAHTARI = "panel.urunler.kolonlar";

function depodanOku(anahtar: string): string | null {
  try {
    return window.localStorage.getItem(anahtar);
  } catch {
    return null;
  }
}

function depoyaYaz(anahtar: string, deger: string): void {
  try {
    window.localStorage.setItem(anahtar, deger);
  } catch {
    /* tercih hatırlanmaz; ekran çalışmaya devam eder */
  }
}

function kayitliGorunum(): Gorunum {
  return depodanOku(GORUNUM_ANAHTARI) === "izgara" ? "izgara" : "liste";
}

/**
 * Kayıtlı kolon tercihi. Bilinmeyen anahtarlar SESSİZCE düşer (kolon adı
 * değişirse eski kayıt ekranı bozmaz); kayıt hiç yoksa hepsi görünür.
 */
function kayitliKolonlar(): string[] {
  const tumu = KAPATILABILIR_KOLONLAR.map((k) => k.value);
  const ham = depodanOku(KOLON_ANAHTARI);
  if (ham === null) return tumu;
  try {
    const cozulen: unknown = JSON.parse(ham);
    if (!Array.isArray(cozulen)) return tumu;
    return tumu.filter((k) => cozulen.includes(k));
  } catch {
    return tumu;
  }
}

/**
 * Liste "Ürün" hücresi — ölçülen ikas kalıbı: solda 36×36 kare görsel,
 * sağında tek satır ellipsis ad. Ölçüler `docs/ikas-panel-referans.md`
 * "Ürün hücresi — ÖLÇÜLEN" bölümünden; renkler tema token'larından
 * (`colorBorder`, `colorFillTertiary`) okunur — bu dosya hex TUTMAZ,
 * panelin tek renk kaynağı `panel/theme.ts`tir.
 */
function UrunHucresi({
  baslik,
  kapakUrl,
  kunye,
}: {
  baslik: string;
  kapakUrl?: string | null;
  /** Yazar · yayınevi · ISBN — eski panelin başlık altı künye satırı. */
  kunye?: string;
}) {
  const { token } = theme.useToken();
  const kare = {
    width: 36,
    height: 36,
    flex: "0 0 36px",
    borderRadius: token.borderRadius,
    border: `1px solid ${token.colorBorder}`,
    background: token.colorFillQuaternary,
    objectFit: "cover" as const,
  };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      {kapakUrl ? (
        <img src={kapakUrl} alt="" style={kare} />
      ) : (
        // Görseli olmayan ürün: aynı ölçüde boş kare. `aria-hidden` —
        // hücrenin erişilebilir adı ürün adından gelir, kare dekoratif.
        <span aria-hidden style={kare} />
      )}
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Typography.Text ellipsis={{ tooltip: baslik }} style={{ minWidth: 0 }}>
          {baslik}
        </Typography.Text>
        {kunye ? (
          <Typography.Text type="secondary" ellipsis style={{ minWidth: 0, fontSize: 12 }}>
            {kunye}
          </Typography.Text>
        ) : null}
      </span>
    </span>
  );
}

export function UrunListesi() {
  const [arama, setArama] = useState("");
  const [sayfa, setSayfa] = useState(1);
  const [boyut, setBoyut] = useState(20);
  // `TipSecimi` (Basit/Varyantlı seçim modalı) KALDIRILDI — ikas referansında
  // (`docs/ikas-panel-referans.md` §4) böyle bir soru YOK, "Ürün Ekle"
  // doğrudan "Ürün Oluştur" çekmecesini açar. `TipSecimi.tsx` dosyası
  // SİLİNMEDİ (components/** dışarıda kalıyor) ama artık burada tüketilmiyor
  // — bu ekran onun tek tüketicisiydi.
  const [olusturAcik, setOlusturAcik] = useState(false);
  const [siralama, setSiralama] = useState<UrunSiralama>(undefined);
  // Araç çubuğu yüzeyleri (`ListePage`in dört düğmesinin arkası) — pencere
  // içerikleri AYRI dosyada (`UrunAracCubugu.tsx`); gerekçe orada yazılı.
  const [filtre, setFiltre] = useState<UrunFiltresi>(BOS_FILTRE);
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [kolonAyariAcik, setKolonAyariAcik] = useState(false);
  const [iceAktarAcik, setIceAktarAcik] = useState(false);
  const [gorunum, setGorunum] = useState<Gorunum>(kayitliGorunum);
  const [gorunurKolonlar, setGorunurKolonlar] = useState<string[]>(kayitliKolonlar);
  const navigate = useNavigate();
  // `products.view` kapısı kabukta (`PanelShell`); burada yalnız YÖNETME
  // ayrımı: `canManage` yoksa Ürün Ekle / İçe Aktar / satır mutasyonları hiç
  // sunulmaz (eski panelin `ReadOnlyNotice` + `canManage` deseni).
  const { canManage } = useAdminAreaAccess("products");
  // Maliyet kolonu ve tedarikçi bilgisi AYRI izin duvarının arkasında (D-6).
  const tedarikciGorebilir = useAdminAreaAccess("suppliers").canView;
  // Düşük stok eşiği SUNUCUDAN; gelmediyse envanter nötr basılır.
  const esik = useStoreConfig().data?.low_stock_threshold;

  const uygulananFiltre = filtreSayisi(filtre);
  const izgaraMi = gorunum === "izgara";

  // Filtre listenin İÇERİĞİNİ değiştirir: kullanıcı sayfa 5'teyken daraltılmış
  // sonuçta o sayfa boş kalabilir. Arama ve sıralamayla AYNI emsal.
  const filtreUygula = (yeni: UrunFiltresi) => {
    setFiltre(yeni);
    setSayfa(1);
    setFiltreAcik(false);
  };
  const filtreyiTemizle = () => {
    setFiltre(BOS_FILTRE);
    setSayfa(1);
  };

  const gorunumSec = (secilen: Gorunum) => {
    setGorunum(secilen);
    depoyaYaz(GORUNUM_ANAHTARI, secilen);
  };
  const kolonlariSec = (secilen: string[]) => {
    setGorunurKolonlar(secilen);
    depoyaYaz(KOLON_ANAHTARI, JSON.stringify(secilen));
  };

  // Girdi anında güncellenir (aramaDegeri); API'ye giden değer gecikmelidir —
  // yoksa her tuş vuruşu bir /store/admin/products isteği demek olur.
  const gecikmisArama = useDebounce(arama);

  // `isLoading` DEĞİL: React Query v5'te `isLoading = isPending && isFetching`.
  // `isPending`, veri hiç gelmemişken (henüz çekilmedi/yeniden deneniyor/
  // iptal edildi) `fetchStatus`un anlık durumundan bağımsız true kalan
  // sinyaldir — "boş" (İlk Ürününüzü Yükleyin!) yalnız gerçekten veri
  // GELDİĞİNDE (success + 0 kayıt) veya hata OLUŞMADIĞINDA çıkmalı, ara bir
  // fetch/retry durumunda değil. Bkz. task-4-report.md "Düzeltme turu 2".
  const { data, isPending, isError, refetch } = useAdminProducts({
    q: gecikmisArama || undefined,
    // Sıralama seçili değilken `sort`/`order` anahtarları hiç GÖNDERİLMEZ
    // (`undefined` değerle değil) — backend zaten `created_at desc`
    // varsayılanına düşüyor, ayrıca üçüncü tıklamada "sıralamayı kaldır"ın
    // temiz bir karşılığı bu (bkz. `siralamaDegisti` aşağıda).
    ...(siralama ? { sort: siralama.alan, order: siralama.yon } : {}),
    // Filtre alanları da AYNI kuralla gider: seçili olmayan filtre anahtarı
    // isteğe HİÇ girmez (`undefined` değerle değil). `listProductsAdmin` boş
    // değerleri zaten ayıklıyor ama React Query anahtarı ham sorgu nesnesi —
    // `{stok: undefined}` ile `{}` farklı anahtarlar üretip gereksiz bir
    // önbellek girdisi açardı. Sunucu adları burada eşlenir:
    // `yayinevi→publisher`, `yazar→author`, `tedarikci→supplier`.
    ...(filtre.stok ? { stok: filtre.stok } : {}),
    ...(filtre.yayinevi ? { publisher: filtre.yayinevi } : {}),
    ...(filtre.yazar ? { author: filtre.yazar } : {}),
    ...(filtre.tedarikci ? { supplier: filtre.tedarikci } : {}),
    limit: boyut,
    offset: (sayfa - 1) * boyut,
  });

  const satirlar = data?.items ?? [];
  // Toplam bilinmiyorsa (`X-Total-Count` yoksa) API -1 döner; sayfalama o
  // durumda toplamı göstermemeli — bkz. store.ts listProductsAdmin notu.
  const toplam = data && data.total >= 0 ? data.total : undefined;

  // AntD `Table`, `ListePage` içinde sarmalı; satır tıklaması için `onRow`
  // orada açılmıyor (15 modülü etkileyen prop sözleşmesi değişikliği olurdu).
  // Bunun yerine her veri hücresine `onCell` ile aynı tıklamayı veriyoruz.
  // Satır menüsü düğmesi kendi tıklamasında olayı durdurur, böylece satır
  // gezinmesi tetiklenmez. Yardımcılar `useMemo` İÇİNDE tanımlı — dışarıda
  // olsalardı her render'da yeni referans üretip bağımlılık kuralını
  // susturmayı gerektiriyordu.
  const kolonlar: TableProps<ProductSearchOut>["columns"] = useMemo(
    () => {
    const duzenlemeyeGit = (kayit: ProductSearchOut) =>
      navigate(ROUTES.adminNewProductEdit(kayit.id));
    const satirTiklama = (kayit: ProductSearchOut) => ({
      onClick: () => duzenlemeyeGit(kayit),
      style: { cursor: "pointer" },
    });
    return [
      {
        title: "Ürün",
        dataIndex: "title",
        key: "title",
        sorter: true,
        // ikas'ın ürün hücresi: 36×36 kare görsel + tek satır ellipsis ad
        // (`docs/ikas-panel-referans.md` "Ürün hücresi — ÖLÇÜLEN").
        // Görsel yoksa aynı ölçüde boş kare durur — hücre hizası bozulmasın.
        render: (baslik: string, kayit) => (
          <UrunHucresi
            baslik={baslik}
            kapakUrl={kayit.cover_url}
            kunye={[kayit.author, kayit.publisher, kayit.isbn].filter(Boolean).join(" · ")}
          />
        ),
        onCell: satirTiklama,
      },
      // Kapatılabilir iki kolon (`KAPATILABILIR_KOLONLAR`) — kapatılmışsa
      // diziye HİÇ girmez, `ListePage`e gizli bir kolon geçip CSS ile
      // saklamak yerine. Böylece tablonun `scroll`/genişlik hesabı da
      // gerçekten daralır.
      ...(gorunurKolonlar.includes("price")
        ? [
            {
              title: "Satış Fiyatı",
              dataIndex: "price",
              key: "price",
              // Sıralanabilirlik kararı burada verilir — `ListePage` yalnız
              // AntD'nin ürettiği olayı taşır, hangi kolonun sıralanabilir
              // olduğuna karışmaz.
              sorter: true,
              render: (v: string | number) => formatTL(v),
              onCell: satirTiklama,
            } as const,
          ]
        : []),
      ...(gorunurKolonlar.includes("stock")
        ? [
            {
              title: "Envanter",
              dataIndex: "stock",
              key: "stock",
              sorter: true,
              render: (_: unknown, kayit: ProductSearchOut) => (
                <EnvanterHucresi urun={kayit} esik={esik} />
              ),
              onCell: satirTiklama,
            } as const,
          ]
        : []),
      // Maliyet/marj: kolon tercihi açık VE `suppliers.view` izni var (D-6).
      ...(tedarikciGorebilir && gorunurKolonlar.includes("maliyet")
        ? [
            {
              title: "Maliyet / Marj",
              key: "maliyet",
              render: (_: unknown, kayit: ProductSearchOut) => <MaliyetHucresi urun={kayit} />,
              onCell: satirTiklama,
            } as const,
          ]
        : []),
      ...(gorunurKolonlar.includes("status")
        ? [
            {
              title: "Durum",
              dataIndex: "status",
              key: "status",
              render: (v?: string | null) => <DurumRozeti durum={v} />,
              onCell: satirTiklama,
            } as const,
          ]
        : []),
      {
        title: "",
        key: "aksiyonlar",
        width: 48,
        render: (_, kayit) => (
          <UrunSatirAksiyonlari
            urun={kayit}
            yonetebilir={canManage}
            duzenle={() => duzenlemeyeGit(kayit)}
          />
        ),
      },
    ];
    },
    [navigate, gorunurKolonlar, canManage, tedarikciGorebilir, esik],
  );


  // AntD `Table.onChange`'in HAM sorter'ını (`ascend`/`descend`) API'nin
  // gerçek `order` sözleşmesine (`asc`/`desc`) çevirir. Yalnız bilinen bir
  // alan + geçerli bir yön geldiğinde `siralama` kurulur; üçüncü tıklamada
  // AntD `order`ı `undefined` yollar — o zaman sıralama tamamen kaldırılır
  // (varsayılan `created_at desc`'e döner). Arama değişince sayfanın 1'e
  // dönmesiyle AYNI emsal: sıralama da sonuç kümesinin SIRASINI değiştirir,
  // kullanıcı sayfa 5'teyken yeni sırada o sayfa tutarsız/boş kalabilir.
  const tabloDegisti: TableProps<ProductSearchOut>["onChange"] = (_sayfalama, _filtreler, sorter) => {
    const tek = Array.isArray(sorter) ? sorter[0] : sorter;
    const alan = tek?.columnKey ?? tek?.field;
    const yon = tek?.order === "ascend" ? "asc" : tek?.order === "descend" ? "desc" : undefined;
    setSiralama(
      yon && typeof alan === "string" && (SIRALANABILIR_ALANLAR as readonly string[]).includes(alan)
        ? { alan: alan as UrunSiralamaAlani, yon }
        : undefined,
    );
    setSayfa(1);
  };

  // "Kayıt yok" ile "sonuç yok" AYRI şeylerdir: filtreli/aramalı bir listede
  // "İlk Ürününüzü Yükleyin!" yazmak, katalogda ürün olduğu hâlde kullanıcıya
  // katalog boş dedirtirdi (eski panelin `filtreVarMi` ayrımının aynısı).
  const daraltilmis = Boolean(gecikmisArama) || uygulananFiltre > 0;

  return (
    <>
      <ListePage<ProductSearchOut>
        baslik="Ürünler"
        // ikas'ın başlık yanı bilgi ikonu (§2). Uydurma "Detaylı Bilgi"
        // metni değil, ucun GERÇEK davranışı: `list_products_admin` vitrin
        // aramasından farklı olarak `status` filtresi uygulamaz.
        detayliBilgiIpucu="Bu liste katalogun tamamıdır: taslak ve gizli ürünler de görünür."
        aksiyonlar={
          <>
            {/* Rozet `ListePage`in `Filtre` düğmesine KONAMADI: o düğmenin
                etiketi bileşenin içinde sabit ve sayı geçirecek bir prop'u
                yok (bkz. rapor — eksik `filtreRozeti`). Sayı ve temizleme
                bu yüzden başlık satırındaki aksiyon alanında duruyor;
                düğmeyle aynı ekran bölgesi, kaybolmayan bir gösterge. */}
            {uygulananFiltre > 0 ? (
              <Flex align="center" gap={4}>
                <Typography.Text type="secondary">
                  {uygulananFiltre} filtre uygulandı
                </Typography.Text>
                <Button type="link" onClick={filtreyiTemizle}>
                  Temizle
                </Button>
              </Flex>
            ) : null}
            {canManage ? (
              <>
                <Button icon={<ImportOutlined aria-hidden="true" />} onClick={() => setIceAktarAcik(true)}>
                  İçe Aktar
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setOlusturAcik(true)}>
                  Ürün Ekle
                </Button>
              </>
            ) : null}
          </>
        }
        uyari={canManage ? undefined : "Bu alanda yalnız görüntüleme yetkiniz var; değişiklik yapamazsınız."}
        filtreSayisi={uygulananFiltre}
        // Pencere içeriği her açılışta uygulanmış filtreden yeniden kurulsun
        // diye `key` açık/kapalı durumuna bağlı: kapatıp açınca taslak
        // sıfırlanır (ikas'la aynı).
        filtreIcerigi={
          <FiltrePaneli key={filtreAcik ? "acik" : "kapali"} filtre={filtre} uygula={filtreUygula} />
        }
        filtreAcik={filtreAcik}
        filtreAcikDegisti={setFiltreAcik}
        kolonAyariIcerigi={
          <KolonAyariPaneli
            secenekler={kapatilabilirKolonlar(tedarikciGorebilir)}
            gorunurler={gorunurKolonlar}
            degisti={kolonlariSec}
          />
        }
        kolonAyariAcik={kolonAyariAcik}
        kolonAyariAcikDegisti={setKolonAyariAcik}
        gorunum={gorunum}
        listeGorunumuTiklandi={() => gorunumSec("liste")}
        izgaraGorunumuTiklandi={() => gorunumSec("izgara")}
        birimEtiket="Ürün"
        aramaDegeri={arama}
        aramaDegisti={(v) => {
          setArama(v);
          setSayfa(1);
        }}
        kolonlar={kolonlar}
        tabloDegisti={tabloDegisti}
        // Izgara görünümü tabloyu DEVRALIR (`ListePage.govde`): başlık
        // satırı, arama, filtre, "Satır Adedi:" ve boş/hata durumları
        // iskeletten aynen gelir, yalnız gövde kart ızgarası olur. Sıralama
        // okları ızgarada anlamsız olduğu için `kolonlar` yine geçilir ama
        // çizilmez.
        govde={izgaraMi ? <UrunIzgarasi urunler={satirlar} esik={esik} /> : undefined}
        veri={satirlar}
        yukleniyor={isPending}
        hata={isError ? "Ürünler yüklenemedi." : null}
        hataAksiyon={<Button onClick={() => refetch()}>Tekrar dene</Button>}
        toplam={toplam}
        sayfa={sayfa}
        sayfaBoyutu={boyut}
        sayfaDegisti={(s, b) => {
          setSayfa(s);
          setBoyut(b);
        }}
        bosBaslik={daraltilmis ? "Sonuç bulunamadı" : "İlk Ürününüzü Yükleyin!"}
        bosAciklama={
          daraltilmis
            ? uygulananFiltre > 0
              ? "Seçtiğiniz filtrelerle eşleşen ürün yok."
              : "Aramanızla eşleşen ürün yok."
            : "Ürünlerinizi yükleyin ve hemen satışa başlayın."
        }
        bosAksiyon={
          uygulananFiltre > 0 ? (
            <Button onClick={filtreyiTemizle}>Filtreleri temizle</Button>
          ) : daraltilmis || !canManage ? undefined : (
            <Button type="primary" onClick={() => setOlusturAcik(true)}>
              Ürün Ekle
            </Button>
          )
        }
        rowKey={(k) => k.id}
      />
      <UrunOlusturCekmecesi acik={olusturAcik} kapat={() => setOlusturAcik(false)} />
      <IceAktarCekmecesi acik={iceAktarAcik} kapat={() => setIceAktarAcik(false)} />
    </>
  );
}
