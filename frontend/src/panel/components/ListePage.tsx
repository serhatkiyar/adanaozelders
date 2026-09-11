import {
  AppstoreOutlined,
  FilterOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Alert, Badge, Button, Flex, Input, Pagination, Popover, Select, Spin, Table, theme as antdTheme, Tooltip, Typography } from "antd";
import type { TableProps } from "antd";
import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { BosDurumu, HataDurumu } from "@/panel/components/Durum";
import { useMobil } from "@/hooks/useMedyaSorgusu";

/**
 * ikas referansı §7 "Liste — İKİNCİ TUR ÖLÇÜM": başlık hücresi dolgusu
 * `0 12px`, yüksekliği 40px, `fontWeight 500` — veri hücresinden (16px 12px,
 * organik yükseklik) FARKLI. AntD `Table`in `cellPaddingBlock`/
 * `cellPaddingInline` component token'ları (`theme.ts` → `components.Table`)
 * ise başlık ve veri hücreleri arasında PAYLAŞILIR (rc-table aynı
 * `tablePaddingVertical/Horizontal`ı `thead > tr > th`ye de `tbody > tr >
 * td`ye de uygular) — token'lar bu yüzden veri satırına göre ayarlı, başlık
 * farkı burada `onHeaderCell` ile satır-içi (`style`) eklenir.
 *
 * Bir CSS sınıfı/`<style>` yerine `onHeaderCell` (rc-table'ın kendi genişleme
 * noktası) seçildi: `PanelProvider` `StyleProvider hashPriority="high"`
 * kullanıyor (Tailwind preflight'ına karşı) — bu mod AntD'nin kendi hash
 * sınıfını özgüllüğe katıyor, yani panel içinde yazılacak bir
 * `.sinifAdi .ant-table-thead > tr > th` kuralı AntD'nin kendi kuralına
 * özgüllükte YENİLEBİLİR (ve `!important` bu paket için yasak). Satır içi
 * stil özgüllük tartışmasından bağımsız kazanır.
 */
function basligaOlcumStiliEkle<T>(
  kolonlar: TableProps<T>["columns"],
): TableProps<T>["columns"] {
  // `ColumnGroupType<T> | ColumnType<T>` birleşimi `onHeaderCell`in kolon
  // parametresini spread sonrası union'a geri sokamıyor (rc-table'ın kendi
  // `title: ReactNode | ColumnTitle<T>` çatallanması yüzünden) — dönüş tipi
  // zaten yukarıda `TableProps<T>["columns"]` olarak sabitlendiği için tek
  // noktada güvenli bir daralatma (cast) yapılıyor, satır içindeki mantık
  // (önceki `onHeaderCell`i koru + ölçülen stili ekle) tam tipli kalıyor.
  return kolonlar?.map((kolon) => ({
    ...kolon,
    onHeaderCell: (col: typeof kolon) => {
      // rc-table'ın `ColumnGroupType | ColumnType` birleşimi `title` alanında
      // çatallandığı için `kolon.onHeaderCell`i union'un KENDİ parametresiyle
      // çağırmak tip denetiminde çakışıyor — burada TEK noktada, yalnızca
      // çağrılan fonksiyon referansı gevşetiliyor (davranış aynı: varsa
      // önceki `onHeaderCell`i çağır, sonucu koru).
      const onceki = kolon.onHeaderCell as
        | ((...args: unknown[]) => { style?: CSSProperties } & Record<string, unknown>)
        | undefined;
      const oncekiProps = onceki?.(col) ?? {};
      return {
        ...oncekiProps,
        style: { padding: "0 12px", height: 40, fontWeight: 500, ...oncekiProps.style },
      };
    },
  })) as TableProps<T>["columns"];
}

/**
 * Sayfa boyutu seçicide her zaman görünecek sabit seçenekler — ikas'ın
 * "Satır Adedi:" seçicisiyle aynı fikir. Tüketicinin o an geçtiği
 * `sayfaBoyutu` bu listede yoksa (ör. 45) seçili değer kaybolmasın diye
 * render sırasında listeye eklenir (bkz. bileşen gövdesi).
 */
const SABIT_SAYFA_BOYUTU_SECENEKLERI = [10, 20, 50, 100];

export type ListePageProps<T> = {
  baslik: string;
  aksiyonlar?: ReactNode;
  /**
   * ikas referansı §2: başlığın yanında bir bilgi ikonu ("Detaylı Bilgi")
   * duruyor. Bizde karşılığı olan bir yardım içeriği yok — bu yüzden ikon
   * OPSİYONEL: yalnız tüketici gerçek bir ipucu metni verirse çıkar,
   * uydurma "Detaylı Bilgi" içeriği basılmaz (15 modülün 3'ü şu an bunu
   * vermiyor, davranış aynen sürer).
   */
  detayliBilgiIpucu?: ReactNode;
  aramaDegeri: string;
  aramaDegisti: (v: string) => void;
  /**
   * ikas referansı §3: aramanın yanında ikonlu/outline bir `Filtre`
   * düğmesi var. Çekmecenin İÇERİĞİ bu paketin kapsamı DIŞINDA (YAGNI,
   * spec §5) — bu yüzden `ListePage` filtreyi KENDİSİ açmaz, yalnız
   * tıklamayı dışarı taşır. Verilmezse düğme hiç render edilmez: "tıklanan
   * ama etkisi olmayan kontrol" (bkz. `Input.Search` yorumu aşağıda) aynı
   * gerekçeyle burada da geçerli.
   */
  filtreTiklandi?: () => void;
  /** Uygulanan filtre sayısı — `Filtre` düğmesine rozet olarak basılır (0/undefined: rozet yok). */
  filtreSayisi?: number;
  /**
   * Canlı ikas: `Filtre` düğmesi sağdan çekmece DEĞİL, düğmenin ALTINDA
   * açılan bir pencere (740px, 16px dolgu, 8px köşe) açar. İçerik tüketiciden
   * gelir; açık/kapalı durumu da tüketicide yaşar (`filtreAcik` +
   * `filtreAcikDegisti`). `filtreTiklandi` ile birlikte verilirse tıklama
   * yine tüketiciye gider, pencereyi açmak tüketicinin işidir.
   */
  filtreIcerigi?: ReactNode;
  filtreAcik?: boolean;
  filtreAcikDegisti?: (acik: boolean) => void;
  /** Kolon ayarı düğmesinin altında açılan pencere (ikas: etiket + anahtar listesi). */
  kolonAyariIcerigi?: ReactNode;
  kolonAyariAcik?: boolean;
  kolonAyariAcikDegisti?: (acik: boolean) => void;
  /** Etkin görünüm — anahtar grubunda etkin düğme koyu, diğeri gri basılır. */
  gorunum?: "liste" | "izgara";
  /** ikas referansı §3 sağdaki üç ikon düğmesinden "kolon ayarı". Opsiyonel — bkz. `filtreTiklandi` gerekçesi. */
  kolonAyariTiklandi?: () => void;
  /** ikas referansı §3 — "liste görünümü". Opsiyonel — bkz. `filtreTiklandi` gerekçesi. */
  listeGorunumuTiklandi?: () => void;
  /** ikas referansı §3 — "ızgara görünümü". Opsiyonel — bkz. `filtreTiklandi` gerekçesi. */
  izgaraGorunumuTiklandi?: () => void;
  /**
   * ikas referansı §3: ilk kolonda satır seçimi checkbox'ı, başlıkta
   * tümünü seç. AntD'nin kendi `rowSelection` şeklini AYNEN taşır —
   * `tabloDegisti`nin AntD `onChange`i taşıma gerekçesiyle aynı: AntD zaten
   * seçili anahtarlar + değişim olayını tek nesnede veriyor, burada yeniden
   * modellemek yüzeyi büyütür. Opsiyonel — verilmezse `Table`e
   * `rowSelection={undefined}` gider, checkbox hiç çıkmaz (bugünkü
   * davranış: 15 modülün hiçbiri şu an satır seçimi kullanmıyor).
   */
  satirSecimi?: TableProps<T>["rowSelection"];
  kolonlar: TableProps<T>["columns"];
  /**
   * Tablonun YERİNE çizilecek gövde (ör. ızgara/kart görünümü). Verilirse
   * `kolonlar`/`satirSecimi`/`tabloDegisti` KULLANILMAZ; başlık satırı, araç
   * çubuğu, uyarı şeridi, hata/boş durumları ve "Satır Adedi:" alt bilgisi
   * aynen kalır — yani görünüm değişir, iskelet değişmez.
   *
   * Bu prop OLMADAN ızgara görünümü tabloyu taklit etmek zorunda kalıyordu
   * (tek kolon + `display:none` başlık + veriyi tek satıra kırpmak); o çözüm
   * çalışıyordu ama `rowKey`, sıralama ve boş durum mantığıyla aynı yerde
   * yaşadığı için kırılgandı. Gövdeyi devretmek doğru sınır.
   */
  govde?: ReactNode;
  veri: T[] | undefined;
  yukleniyor: boolean;
  /**
   * `hata` doluyken bunun anlamı "liste VERİSİ hiç gelmedi" (ör. sorgu
   * başarısız oldu) — bir SATIR AKSİYONUNUN (silme, durum değiştirme,
   * dışa aktarma vb.) başarısız olması DEĞİLDİR. `hata` doluyken tablo
   * ve boş durum hiç render edilmez (aşağıdaki `bos` hesaplamasına bkz.),
   * yalnız `HataDurumu` durur; `hataAksiyon` genelde "Tekrar dene"
   * düğmesidir. Satır aksiyonu hataları kendi geri bildirimini
   * (bildirim/toast) modülün kendisi gösterir — bu prop'a KONMAZ (aynı
   * ayrım `FormPage.hata`'da da var: "kaydetme hatası buraya konmaz").
   */
  hata?: string | null;
  hataAksiyon?: ReactNode;
  /**
   * `hata`dan FARKLI bir kanal — karıştırılmasın: `hata` doluyken gövdenin
   * YERİNE geçer (tablo hiç render edilmez, yukarıdaki `hata` yorumuna
   * bkz.); `uyari` ise gövdeyle BİRLİKTE görünür — liste yine render
   * edilir, üstüne bir bilgi şeridi eklenir. Örnek: tüketici sunucudan
   * `q`/`offset` desteği olmadan elinde tuttuğu bir PARTİ gösteriyor ve o
   * parti sunucu tavanını doldurduysa (bkz. `SiparisListesi`) — bu bir HATA
   * değildir, liste yine doğru ve kullanılabilir, yalnız TAM olmayabilir.
   * Yalnız veri render edilirken gösterilir (hata/yükleniyor/boş dallarında
   * DEĞİL) — "uyarı, gösterilen bir şeyin yanına eklenir" sözleşmesi bunu
   * gerektirir. Opsiyonel — verilmezse davranış hiç değişmez (geriye dönük
   * uyum, 15 modülün 13'ü bunu vermez).
   *
   * Gösterim `Durum.tsx`'e DEĞİL burada AntD `Alert type="warning"
   * showIcon`e konur: bu dosyayı yazan ajanın kapsamı `Durum.tsx`'i
   * kapsamıyordu (eşzamanlı başka bir ajan orada çalışıyordu) — üçüncü bir
   * tüketici çıkarsa oraya (bir `UyariDurumu` olarak) taşınabilir.
   *
   * Duyuru rolü `role="status"`tur (`role="alert"` DEĞİL) — bir hata değil,
   * ekran okuyucunun assertive değil polite duyurması gereken bir bilgi
   * notudur (bkz. aşağıdaki render'daki kaynak yorumu).
   */
  uyari?: ReactNode;
  toplam?: number;
  sayfa: number;
  sayfaBoyutu: number;
  sayfaDegisti: (sayfa: number, boyut: number) => void;
  /**
   * ikas referansı §3 alt bilgi: `1 - 1 / 1 Ürün` — birim tüketiciye göre
   * değişir (Ürün/Sipariş/Müşteri). `ListePage` bir birim İCAT ETMEZ,
   * varsayılanı nötr `"kayıt"` (bugüne kadarki sabit metinle aynı) —
   * opsiyonel, verilmezse davranış hiç değişmez.
   */
  birimEtiket?: string;
  bosBaslik: string;
  bosAciklama: string;
  bosAksiyon?: ReactNode;
  rowKey: (kayit: T) => string | number;
  /**
   * AntD `Table.onChange` kanalının HAM geçişi (sayfalama hariç — o zaten
   * `sayfaDegisti` ile taşınıyor). `ListePage` sıralama/filtre semantiğine
   * karar vermez: hangi kolonun sıralanabilir/filtrelenebilir olduğu
   * tüketicinin `kolonlar` tanımından (`sorter`/`filters`) gelir, burada
   * yalnız olay dışarı aktarılır. Opsiyonel — verilmezse davranış hiç
   * değişmez (geriye dönük uyum): AntD `onChange` prop'u `undefined`
   * geçtiğinde no-op'tur.
   *
   * Tek prop'ta (ayrı `siralamaDegisti`/`filtreDegisti` yerine) tutulmasının
   * nedeni: AntD zaten sorter+filters+extra'yı TEK olayda birlikte veriyor;
   * burada onu yeniden modelleyip iki prop'a bölmek yüzeyi büyütür ve
   * `ListePage`'e (kullanmadığı) bir normalize sözleşmesi yükler. Tüketici
   * kendi normalize ettiği alanları kendi sorgusuna çevirir (bkz.
   * `UrunListesi`).
   */
  tabloDegisti?: TableProps<T>["onChange"];
};

export function ListePage<T extends object>({
  baslik, aksiyonlar, detayliBilgiIpucu, aramaDegeri, aramaDegisti,
  filtreTiklandi, filtreSayisi, filtreIcerigi, filtreAcik, filtreAcikDegisti,
  kolonAyariTiklandi, kolonAyariIcerigi, kolonAyariAcik, kolonAyariAcikDegisti, gorunum = "liste",
  listeGorunumuTiklandi, izgaraGorunumuTiklandi,
  satirSecimi, kolonlar, govde, veri, yukleniyor,
  hata, hataAksiyon, uyari, toplam, sayfa, sayfaBoyutu, sayfaDegisti, birimEtiket = "kayıt",
  bosBaslik, bosAciklama, bosAksiyon, rowKey,
  tabloDegisti,
}: ListePageProps<T>) {
  const { token } = antdTheme.useToken();
  const mobil = useMobil();
  const bos = !hata && !yukleniyor && (veri?.length ?? 0) === 0;
  const kolonAyariVar = Boolean(kolonAyariTiklandi || kolonAyariIcerigi);
  const gorunumDugmesiVar = Boolean(kolonAyariVar || listeGorunumuTiklandi || izgaraGorunumuTiklandi);
  const filtreVar = Boolean(filtreTiklandi || filtreIcerigi);
  // Canlı ikas pencere kabuğu (filtre + kolon ayarı): 8px köşe, 0.8px
  // #EEF2F6 kenarlık, iki katmanlı gölge, 16px iç dolgu.
  const pencereStili: CSSProperties = {
    borderRadius: 8,
    border: `1px solid ${token.colorBorderSecondary}`,
    boxShadow: "0 12px 16px -4px rgba(16, 24, 40, 0.08), 0 4px 6px -2px rgba(16, 24, 40, 0.03)",
    padding: 16,
  };
  // Görünüm anahtarı (liste/ızgara): 32×32, 2px köşe, dolgu 8; etkin koyu,
  // etkin olmayan üçüncül gri — canlı ölçüm.
  const anahtarStili = (etkin: boolean): CSSProperties => ({
    width: 32,
    height: 32,
    padding: 8,
    borderRadius: 2,
    color: etkin ? token.colorText : token.colorTextTertiary,
  });
  const olculenKolonlar = useMemo(() => basligaOlcumStiliEkle(kolonlar), [kolonlar]);

  // Tüketicinin geçtiği `sayfaBoyutu` sabit listede yoksa (ör. 45) seçiciye
  // eklenir — yoksa AntD `Select` seçili değeri gösteremez.
  const sayfaBoyutuSecenekleri = SABIT_SAYFA_BOYUTU_SECENEKLERI.includes(sayfaBoyutu)
    ? SABIT_SAYFA_BOYUTU_SECENEKLERI
    : [...SABIT_SAYFA_BOYUTU_SECENEKLERI, sayfaBoyutu].sort((a, b) => a - b);

  return (
    <Flex vertical gap={0}>
      {/* Canlı ikas başlık satırı: 40px yüksek (düğmelerle aynı), başlık
          20px/500, satır ile araç çubuğu arası 40px. */}
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40, marginBottom: 40 }}>
        <Flex align="center" gap={6}>
          <Typography.Title
            level={3}
            style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}
          >
            {baslik}
          </Typography.Title>
          {detayliBilgiIpucu ? (
            <Tooltip title={detayliBilgiIpucu}>
              <InfoCircleOutlined
                aria-label="Detaylı Bilgi"
                style={{ color: token.colorTextTertiary }}
              />
            </Tooltip>
          ) : null}
        </Flex>
        <Flex gap={8} wrap>{aksiyonlar}</Flex>
      </Flex>

      {/* ikas referansı §2: içerik kartın İÇİNDE değil, düz beyaz yüzeyde
          durur (renk kartın kendi border/shadow'unu değil, `theme.ts`'in
          `token.colorBgContainer`ını kullanır — dosyaya yeni bir hex
          YAZILMADI, AntD'nin kendi tema token'ı okunuyor). Satır ayırıcı
          çizgisi §7 "Liste — İKİNCİ TUR ÖLÇÜM"e göre GÖRÜNMEZ (ikas'ta
          `border-bottom: 0.8px solid transparent`) — `theme.ts` →
          `components.Table.borderColor: "transparent"` bunu karşılıyor,
          burada ayrıca bir stil eklenmedi. */}
      <div>
        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
          <Flex gap={8} wrap style={{ flex: mobil ? "1 1 100%" : undefined }}>
            {/* `Input.Search` DEĞİL: onSearch verilmediği için tıklanabilir ama
                hiçbir şey yapmayan bir büyüteç düğmesi basıyordu. Etkisi olmayan
                kontrol kullanıcıyı yanıltır (aynı gerekçeyle VaryantPenceresi'nden
                "Seçim Stili" söküldü). Arama zaten her tuşta tüketiciye gidiyor.
                Erişilebilir ad başlıktan türetilir: 15 modülün her biri "Ürünler
                içinde ara" gibi anlamlı bir ad alır; placeholder tek başına
                güvenilir bir erişilebilir ad değildir. ikas'ın büyüteç ikonu
                burada salt DEKORATİF bir `prefix` — tıklanamaz, ikinci bir
                ölü düğme getirmez. */}
            <Input
              aria-label={`${baslik} içinde ara`}
              placeholder="Tabloda arama yapın"
              allowClear
              prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
              value={aramaDegeri}
              onChange={(e) => aramaDegisti(e.target.value)}
              // Canlı ikas: 397px SABİT genişlik (esnek değil); mobilde tam satır.
              style={{ width: mobil ? "100%" : 397 }}
            />
            {/* ikas referansı §3: arama yanında `Filtre` düğmesi — çekmecenin
                İÇERİĞİ kapsam dışı (YAGNI, spec §5). Yalnız tıklama dışarı
                taşınır; tüketici vermezse düğme hiç yok (ölü düğme yok). */}
            {filtreVar ? (
              // İkon `aria-hidden`: AntD icon'un varsayılan `aria-label`ı
              // ("filter") düğmenin görünür metniyle ("Filtre") birleşip
              // erişilebilir adı "filter Filtre" yapardı — dekoratif ikon
              // metnin ÖNÜNE geçmesin diye gizlendi.
              // Canlı ikas: pencerenin sol kenarı ARAÇ ÇUBUĞUNUN sol kenarıyla
              // hizalı (x=247 ↔ içerik 264), düğmeyle değil. Masaüstünde düğme
              // aramanın (397px) 8px sağında durduğu için pencere 405px sola
              // kaydırılır; mobilde düğme kendi satırına iner, kaydırma yok.
              // `autoAdjustOverflow` kapalı: 740px pencere sağa sığmadığında
              // AntD'nin ters çevirmesi pencereyi ekran dışına (x<0) atıyordu.
              <Popover
                open={filtreIcerigi ? Boolean(filtreAcik) : false}
                onOpenChange={filtreAcikDegisti}
                trigger="click"
                placement="bottomLeft"
                arrow={false}
                autoAdjustOverflow={false}
                align={{ offset: [mobil ? 0 : -405, 4] }}
                content={filtreIcerigi}
                styles={{
                  body: {
                    ...pencereStili,
                    width: mobil ? "calc(100vw - 32px)" : 740,
                    maxWidth: "calc(100vw - 32px)",
                  },
                }}
              >
                <Badge count={filtreSayisi ?? 0} size="small" color={token.colorPrimary}>
                  <Button
                    icon={<FilterOutlined aria-hidden="true" />}
                    aria-expanded={filtreIcerigi ? Boolean(filtreAcik) : undefined}
                    onClick={filtreTiklandi}
                  >
                    Filtre
                  </Button>
                </Badge>
              </Popover>
            ) : null}
          </Flex>
          {gorunumDugmesiVar ? (
            <Flex gap={8} align="center">
              {kolonAyariVar ? (
                // Canlı ikas: 42×42, #F8FAFC zemin, 0.8px #E3E8EF kenarlık,
                // 4px köşe; altında etiket + anahtar listesi penceresi.
                <Popover
                  open={kolonAyariIcerigi ? Boolean(kolonAyariAcik) : false}
                  onOpenChange={kolonAyariAcikDegisti}
                  trigger="click"
                  placement="bottomRight"
                  arrow={false}
                  content={kolonAyariIcerigi}
                  styles={{ body: pencereStili }}
                >
                  <Tooltip title="Kolon Ayarı">
                    <Button
                      icon={<SettingOutlined />}
                      aria-label="Kolon Ayarı"
                      aria-expanded={kolonAyariIcerigi ? Boolean(kolonAyariAcik) : undefined}
                      onClick={kolonAyariTiklandi}
                      style={{ width: 42, height: 42, padding: 0, background: token.colorBgLayout }}
                    />
                  </Tooltip>
                </Popover>
              ) : null}
              {listeGorunumuTiklandi || izgaraGorunumuTiklandi ? (
                // Anahtar grubu: #F8FAFC zemin, 0.8px #EEF2F6 kenarlık, 4px
                // köşe, 4px dolgu, 6px aralık (canlı ölçüm).
                <Flex
                  gap={6}
                  style={{
                    background: token.colorBgLayout,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 4,
                    padding: 4,
                  }}
                >
                  {listeGorunumuTiklandi ? (
                    <Tooltip title="Liste Görünümü">
                      <Button
                        type="text"
                        icon={<UnorderedListOutlined />}
                        aria-label="Liste Görünümü"
                        aria-pressed={gorunum === "liste"}
                        onClick={listeGorunumuTiklandi}
                        style={anahtarStili(gorunum === "liste")}
                      />
                    </Tooltip>
                  ) : null}
                  {izgaraGorunumuTiklandi ? (
                    <Tooltip title="Izgara Görünümü">
                      <Button
                        type="text"
                        icon={<AppstoreOutlined />}
                        aria-label="Izgara Görünümü"
                        aria-pressed={gorunum === "izgara"}
                        onClick={izgaraGorunumuTiklandi}
                        style={anahtarStili(gorunum === "izgara")}
                      />
                    </Tooltip>
                  ) : null}
                </Flex>
              ) : null}
            </Flex>
          ) : null}
        </Flex>

        {hata ? (
          <HataDurumu hata={hata} hataAksiyon={hataAksiyon} />
        ) : bos ? (
          <BosDurumu baslik={bosBaslik} aciklama={bosAciklama} aksiyon={bosAksiyon} />
        ) : (
          <>
            {/* `Alert` (5.29.3) kök `div`'e VARSAYILAN `role="alert"` bağlar
                (bkz. `Durum.tsx`'teki aynı doğrulama) — ama `uyari` bir hata
                değil, veriyle BİRLİKTE duran bir bilgi notu; `role="alert"`
                örtük `aria-live="assertive"` demektir ve her veri çekiminde
                agresif bir duyuru yapar. `AlertProps.role` (`antd/es/alert/
                Alert.d.ts`) AÇIKÇA `string` tipli ve `rc-util` `pickAttrs`
                `role` anahtarını `aria: true` altında topluyor — yani
                `role="status"` buraya verildiğinde AntD'nin sabit değerinin
                ÜZERİNE yazar (kaynaktan doğrulandı). `aria-live` ayrıca
                verilmez: `AlertProps` onu tipe almıyor (verilse `tsc`
                kırılır) ve zaten GEREKMEZ — WAI-ARIA'da `status` rolünün
                varsayılanı `aria-live="polite"`tir, `Durum.tsx`teki
                `BosDurumu`nun çıplak `div`e elle eklediği açık
                `aria-live="polite"` orada rolün kendisi native olmadığı
                içindi, burada rolün kendisi zaten polite. İkinci bir rol
                sarmalayıcı EKLENMEZ, çakışır. */}
            {uyari ? (
              <Alert
                type="warning"
                showIcon
                role="status"
                message={uyari}
                style={{ marginBottom: 16 }}
              />
            ) : null}
            {govde ? (
              // Devredilen gövde: yükleme göstergesi `Table`in kendi
              // `loading`i yerine `Spin` ile verilir (aynı gecikme/erişim
              // davranışı, tabloya bağımlı değil).
              <Spin spinning={yukleniyor}>{govde}</Spin>
            ) : (
              <Table<T>
                columns={olculenKolonlar}
                dataSource={veri}
                loading={yukleniyor}
                rowKey={rowKey}
                rowSelection={satirSecimi}
                scroll={{ x: "max-content" }}
                onChange={tabloDegisti}
                pagination={false}
              />
            )}
            {/* ikas referansı §3 alt bilgi: solda "Satır Adedi:" + boyut
                seçici, sağda `X - Y / Z <birim>` aralık/toplam + sayfalayıcı.
                AntD `Table`in varsayılan `pagination.showSizeChanger`
                yerleşimi (sağ uçta, tek bir metinle) bunu VEREMEZ — bu yüzden
                `Table.pagination` kapatılıp aynı AntD `Pagination`
                bileşeni burada elle, ikas'ın iki-uçlu yerleşiminde kuruldu.
                Sayfa TIKLAMA/geri çağrı sözleşmesi (`sayfaDegisti(sayfa,
                boyut)`) DEĞİŞMEDİ — yalnız yerleşim değişti. */}
            {/* Canlı ikas alt bilgi: görünüm alanının ALTINA YAPIŞIK, 72px
                yüksek, üstte 0.8px #EEF2F6 çizgi, beyaz zemin — liste uzunken
                sayfalayıcı hep görünür. */}
            <Flex
              justify="space-between"
              align="center"
              wrap
              gap={12}
              style={{
                position: "sticky",
                bottom: 0,
                minHeight: 72,
                marginTop: 16,
                background: token.colorBgContainer,
                borderTop: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Flex align="center" gap={8}>
                <Typography.Text type="secondary">Satır Adedi:</Typography.Text>
                <Select<number>
                  size="small"
                  aria-label="Satır Adedi"
                  value={sayfaBoyutu}
                  style={{ width: 76 }}
                  options={sayfaBoyutuSecenekleri.map((deger) => ({ value: deger, label: deger }))}
                  onChange={(deger) => sayfaDegisti(1, deger)}
                />
              </Flex>
              <Pagination
                size="small"
                current={sayfa}
                pageSize={sayfaBoyutu}
                total={toplam ?? 0}
                showSizeChanger={false}
                onChange={sayfaDegisti}
                showTotal={(t, [bas, son]) => `${bas} - ${son} / ${t} ${birimEtiket}`}
              />
            </Flex>
          </>
        )}
      </div>
    </Flex>
  );
}
