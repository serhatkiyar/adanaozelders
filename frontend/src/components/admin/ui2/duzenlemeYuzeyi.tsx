/**
 * Düzenleme yüzeyi (İP-A4 · Görev 2) — **göçün en önemli sözleşmesi.**
 *
 * ## Ne çözüyor
 *
 * Bugün panelde her ekran kendi pencere durumunu tutuyor:
 *
 *     const [acik, setAcik] = useState(false);          // ya da
 *     const [duzenlenen, setDuzenlenen] = useState<X | null>(null);
 *     …
 *     <XDialog open={acik} onClose={() => setAcik(false)} />
 *
 * Bu desen 71 dosyaya kopyalanırsa, ileride **rota tabanlı düzenleme
 * yüzeylerine** (`/yonetim/.../:id/duzenle`) geçme kararı 71 dosyayı
 * ilgilendirir — ve o göç, her ekranın pencere durumunu ayrı ayrı yeniden
 * yazmak demektir. Aynı sebeple, pencereye bağlı ortak davranışlar (kirli form
 * bekçisi, odak yönetimi, başlık/aksiyon yerleşimi) her ekranda yeniden
 * yazılıyor ve **her ekranda ayrı ayrı unutulabiliyor**.
 *
 * Bu modül pencere yönetimini `ui2/` altına taşır. Ekran artık "modal açık mı"
 * durumu TUTMAZ; bir düzenleme yüzeyi açar.
 *
 * ## Sözleşme
 *
 * Üç parça:
 *
 *   1. **Ne düzenleniyor** — `useDuzenlemeYuzeyi()` hedefi tutar: bir KAYIT
 *      (`ac(kayit)`) ya da YENİ (`yeniAc(baglam?)`). Kapalıyken hedef `null`.
 *   2. **Kapatma isteği** — `DuzenlemeYuzeyi` bileşeni bütün kapatma
 *      yollarını (× düğmesi, ESC, dış tıklama, "Vazgeç") TEK noktadan kirli
 *      form bekçisine bağlar. Ekran bunu yeniden yazmaz.
 *   3. **İçerik** — form alanları `children`, gönder düğmesi `aksiyonlar`.
 *      "Vazgeç" yüzeyin kendisindedir; her ekranda tekrar yazılmaz.
 *
 * ### Kullanım (pilot: `DamageEventsPage` + `DamageDialog`)
 *
 * Ekran — pencere durumu YOK:
 *
 *     const yuzey = useDuzenlemeYuzeyi<DamageEventOut, DamageKind>();
 *     …
 *     <Button onClick={() => yuzey.yeniAc(k.value)}>{k.label}</Button>
 *     <DamageDialog yuzey={yuzey} … />
 *
 * Form bileşeni — pencereyi yüzey çizer:
 *
 *     <DuzenlemeYuzeyi
 *       yuzey={yuzey}
 *       baslik={damageKindLabel(kind)}
 *       form={form}
 *       sunucuHatasi={error}
 *       islemSuruyor={isPending}
 *       aksiyonlar={<Button onClick={gonder}>Hasara ayır</Button>}
 *     >
 *       …alanlar…
 *     </DuzenlemeYuzeyi>
 *
 * Başarı sonrası ekran `yuzey.kapat()` çağırır: bu KOŞULSUZ kapatmadır (veri
 * kaydedildi, sorulacak bir şey yok). Kullanıcı kaynaklı kapatma yollarının
 * hepsi bekçiden geçer.
 *
 * ## Router göçüne hazırlık
 *
 * İçeride bugün `useState` var. Rota tabanlı yüzeylere geçilirse **bu
 * dosyanın içi** değişir (`useState` → `useNavigate`/`useParams`), ekranlar
 * değişmez: `ac`/`yeniAc`/`kapat`/`acik` sözleşmesi aynı kalır. Sözleşmenin
 * bilinçli olarak dar tutulmasının sebebi budur — hedef nesnesi dışarı
 * `null`/kayıt olarak verilir, iç temsili (state mi, URL mi) dışarı sızmaz.
 *
 * ## Bilinen sınır
 *
 * Ekran `yuzey.kapat()`'ı bir yan etkiyle (WebSocket push'u, query
 * invalidation) çağırırsa bekçi devreye GİRMEZ — bu bilinçlidir: `kapat`
 * "koşulsuz kapat" demektir. Kullanıcının yazdığını koruması gereken her yol
 * `kapatmayiDene`den geçmelidir; yüzeyin kendi çizdiği yolların hepsi geçer.
 * (İP-A3c'de belgelenen P2-9 sınırının bu katmandaki karşılığı.)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import { Button, Dialog } from "@/components/admin/ui";

import { IcerikKorumasiCtx } from "./icerikKorumasi";
import {
  HATA_TAKIBI_YOK,
  useKirliFormBekcisi,
  type KirliFormBekcisi,
  type KirliFormBekcisiSecenekleri,
} from "./kirliFormBekcisi";
import type { DuzenlemeYuzeyiKapisi } from "./yuzeyDurumu";

// Durum kancası İP-A6'da `yuzeyDurumu.ts`ye ayrıldı (döngü kırma —
// gerekçesi o dosyanın başında). Sözleşme değişmediği için buradan da
// dışa aktarılır: mevcut çağrı yerleri `duzenlemeYuzeyi`den almaya devam eder.
export {
  useDuzenlemeYuzeyi,
  type DuzenlemeHedefi,
  type DuzenlemeYuzeyiDurumu,
  type DuzenlemeYuzeyiKapisi,
} from "./yuzeyDurumu";

/**
 * Yüzeyin İÇİNDEN kapatma isteği. Form içindeki özel bir "Vazgeç"/"Kapat"
 * bağlantısı bunu kullanır; bekçiden geçer.
 */
const KapatmaCtx = createContext<(() => void) | null>(null);

export function useYuzeyKapatmaIstegi(): () => void {
  const kapatmayiDene = useContext(KapatmaCtx);
  if (!kapatmayiDene) {
    throw new Error(
      "useYuzeyKapatmaIstegi yalnız <DuzenlemeYuzeyi> içinde kullanılabilir."
    );
  }
  return kapatmayiDene;
}

export interface DuzenlemeYuzeyiProps<TFieldValues extends FieldValues> {
  yuzey: DuzenlemeYuzeyiKapisi;
  baslik: string;
  aciklama?: string;
  /** Bekçinin izlediği form. */
  form: UseFormReturn<TFieldValues>;
  /**
   * Ekranın elindeki sunucu hatası. ZORUNLU — hata takibi olmayan çağrı yeri
   * `HATA_TAKIBI_YOK` yazar (İP-A3c · P1-3 kuralının bu katmandaki devamı).
   */
  sunucuHatasi: unknown | typeof HATA_TAKIBI_YOK;
  /** Gönderim sürüyor mu — "Vazgeç" bu sırada kapanır. */
  islemSuruyor?: boolean;
  /** Gönder/uygula düğmeleri. "Vazgeç" yüzeyin kendisindedir. */
  aksiyonlar: ReactNode;
  /** "Vazgeç" düğmesini gizle (ör. yalnız bilgilendiren yüzey). */
  vazgecGizle?: boolean;
  vazgecEtiketi?: string;
  children: ReactNode;
}

export function DuzenlemeYuzeyi<TFieldValues extends FieldValues>({
  yuzey,
  baslik,
  aciklama,
  form,
  sunucuHatasi,
  islemSuruyor = false,
  aksiyonlar,
  vazgecGizle = false,
  vazgecEtiketi = "Vazgeç",
  children,
}: DuzenlemeYuzeyiProps<TFieldValues>) {
  // Kirli form bekçisi TEK yerde bağlanır: ekran bunu yeniden yazmaz ve
  // unutamaz. `etkin` yüzeyin kendi durumundan gelir — kapalı pencerede
  // bekçinin `beforeunload` kaydı olmamalı.
  const bekci = useKirliFormBekcisi({
    form,
    sunucuHatasi,
    etkin: yuzey.acik,
    hedef: yuzey.hedef,
  });

  // İşlem sürerken kapatma yolu kapalı: yarıda kesilen bir gönderimde
  // kullanıcı sonucu göremez.
  const kapatmayiDene = useCallback(() => {
    if (islemSuruyor) return;
    bekci.kapatmayiDene(yuzey.kapat);
  }, [bekci, islemSuruyor, yuzey.kapat]);

  // Bu yüzey bekçiyi KENDİ bağlar (yukarıda): içeriğin hiçbir şey yapması
  // gerekmez, dolayısıyla koruma her zaman vardır (İP-A7d4 · Görev 1).
  return (
    <IcerikKorumasiCtx.Provider value={KORUMA_VAR}>
    <KapatmaCtx.Provider value={kapatmayiDene}>
      {/* `onClose`a satır içi ok fonksiyonu vermek ARTIK GÜVENLİ: `useModalA11y`
          işleyiciyi ref'te tutuyor (İP-A4 · Görev 1). Önceden her render'da
          odak panelin ilk öğesine sıçrardı ve çağıran tarafın kimliği elle
          sabitlemesi gerekiyordu. */}
      <Dialog open={yuzey.acik} title={baslik} description={aciklama} onClose={kapatmayiDene}>
        <div className="space-y-4">
          {children}
          <div className="flex justify-end gap-2">
            {!vazgecGizle && (
              <Button variant="ghost" disabled={islemSuruyor} onClick={kapatmayiDene}>
                {vazgecEtiketi}
              </Button>
            )}
            {aksiyonlar}
          </div>
        </div>
      </Dialog>
    </KapatmaCtx.Provider>
    </IcerikKorumasiCtx.Provider>
  );
}

/** Sabit kimlik: her render'da yeni bir fonksiyon bağlamı boşuna tazelerdi. */
const KORUMA_VAR = () => true;

export { HATA_TAKIBI_YOK };

/* ══════════ İçeriği KENDİ formunu yöneten yüzey (İP-A6 · Görev 4b) ══════════ */

/**
 * `DuzenlemeYuzeyi` formu DIŞARIDAN alır: ekran `useForm`u kurar, yüzeye
 * verir, yüzey bekçiyi bağlar. Bu, alanları yüzeyle aynı bileşende yazılan
 * formlar için doğru şekildir (pilot: `DamageDialog`).
 *
 * Ama panelde ikinci bir desen daha var ve İP-A6'nın hedefi `EditProductModal`
 * tam olarak o: **pencere, kendi formunu kendi yöneten bir bileşeni sarar**.
 * `ProductForm` 25 alanıyla birlikte hem oluşturmada (satır içi) hem
 * düzenlemede (pencere içinde) kullanılıyor; formu pencereye çıkarmak, satır
 * içi kullanımı da pencereye bağlamlı hâle getirirdi.
 *
 * `DuzenlemePenceresi` bu ikinci deseni karşılar: pencereyi ve kapatma
 * yollarını o çizer, formu içerik yönetir, ikisi bir BEKÇİ üzerinden
 * buluşur. İçerik `useYuzeyKirliFormBekcisi` çağırır; sağlayıcı yoksa hiçbir
 * şey değişmez (satır içi kullanım) ve bekçi yalnız rota/sekme korumasını
 * kurar.
 *
 * Kazanç: `role="dialog"` + `aria-modal` + odak tuzağı + ESC + arka plan
 * kilidi (hepsi `Dialog`/`useModalA11y`ten) ve kirli formda kapatma onayı —
 * içeriğin tek satır bile yazmadan.
 */
type BekciBildirimi = (kimlik: symbol, bekci: KirliFormBekcisi | null) => void;

const BekciBildirimCtx = createContext<BekciBildirimi | null>(null);

/**
 * Penceredeki hedef — içeriğin bilmediği, pencerenin bildiği şey.
 *
 * `useYuzeyKirliFormBekcisi` bunu bekçiye geçirir; onay beklerken hedef
 * değişirse onay eski hedefe uygulanmaz (İP-A6c · BULGU-8).
 */
const HedefCtx = createContext<unknown>(undefined);

/** Geliştirmede patlayan koruma; üretim derlemesinde elenir. */
const GELISTIRME: boolean = !!import.meta.env?.DEV;

/**
 * `useKirliFormBekcisi`nin yüzey farkındalığı olan hâli.
 *
 * Bekçiyi kurar VE (bir `DuzenlemePenceresi` içindeyse) pencereye bildirir;
 * böylece ×/ESC/dış tıklama yolları da kirli formu sorar.
 */
/**
 * ⚠️ KESKİN KENAR (İP-A7d1 · SK-3): kanca, pencerenin İÇİNDE çağrılmalıdır.
 *
 * Bildirim `BekciBildirimCtx` üzerinden yapılır ve o bağlamı
 * `DuzenlemePenceresi` açar. Kancayı, pencereyi RENDER EDEN bileşende çağırmak
 * (yani `<DuzenlemePenceresi>`in kardeşi/ebeveyni olarak) bağlamın DIŞINDA
 * kalmaktır: `bildir` `null` gelir, pencere bekçiyi hiç tanımaz ve ×/ESC/dış
 * tıklama kirli formu SORMADAN kapatır — kullanıcının yazdığı veri gider.
 *
 * İP-A7d1'de bu tuzağa düşüldü ve ancak kabul testi yakaladı; tip hatası da
 * uyarı da yoktu.
 *
 * ## İP-A7d2 · Görev 1 — sessizlik kaldırıldı: MEŞRU KULLANIM KENDİNİ BEYAN EDER
 *
 * A7d1 otomatik uyarı eklememeyi seçmişti: sağlayıcısız çağrı MEŞRU bir
 * kullanımdır (satır içi form — pencere yokken bekçi yalnız rota/sekme
 * korumasını kurar), yani "sağlayıcı yok" tek başına hata değildir.
 *
 * **Tespit doğruydu, sonuç yanlıştı.** Meşru bir durumun varlığı dedektörden
 * vazgeçmeyi değil, meşru durumu BEYAN ETTİRMEYİ gerektirir. Bu projede aynı
 * yol iki kez seçildi: `sunucuHatasi` zorunlu yapıldı (takip etmeyen çağrı
 * yeri `HATA_TAKIBI_YOK` yazar) ve `Form.Control` sessiz yazımlarda
 * geliştirmede patlatıldı (İP-A3c). İkisinde de sessiz varsayılanın yerine
 * açık beyan kondu.
 *
 * Kural artık şudur:
 *
 *   | Sağlayıcı | Beyan | Sonuç |
 *   |---|---|---|
 *   | var | yok | geçer — pencereli, doğru yazım |
 *   | var | var  | geçer — beyan zararsızdır (içerik nerede olduğunu bilmez) |
 *   | yok | var  | geçer — satır içi form, bilinçli |
 *   | yok | yok  | **geliştirmede `throw`** (üretimde elenir) |
 *
 * Doğru yazımlar:
 *
 *     <DuzenlemePenceresi yuzey={yuzey} baslik="…">
 *       <Icerik />          // ← `useYuzeyKirliFormBekcisi` BURADA çağrılır
 *     </DuzenlemePenceresi>
 *
 *     // satır içi (pencere yok) — beyan zorunlu:
 *     useYuzeyKirliFormBekcisi({ form, sunucuHatasi, pencereSiz: true });
 */
export interface YuzeyBekcisiSecenekleri<TFieldValues extends FieldValues>
  extends KirliFormBekcisiSecenekleri<TFieldValues> {
  /**
   * "Bu form bilerek pencere DIŞINDA yaşıyor" beyanı (İP-A7d2 · Görev 1).
   *
   * Beyan yazan çağrı yeri sağlayıcısız çalışabilir: bekçi yalnız rota ve
   * sekme korumasını kurar, pencere kapatma yolları zaten yoktur. Beyansız ve
   * sağlayıcısız çağrı geliştirmede patlar.
   *
   * `false` yazılamaz: "penceresizim ama değilim" diye bir durum yok; beyan ya
   * vardır ya yoktur.
   */
  pencereSiz?: true;
}

export function useYuzeyKirliFormBekcisi<TFieldValues extends FieldValues>(
  { pencereSiz, ...secenekler }: YuzeyBekcisiSecenekleri<TFieldValues>
): KirliFormBekcisi {
  const pencereHedefi = useContext(HedefCtx);
  const bekci = useKirliFormBekcisi({
    // Hedef AÇIKÇA verilmediyse pencereninki kullanılır: içerik hedefi
    // bilmek zorunda değildir, ama onay beklerken değişirse onay düşmelidir.
    hedef: pencereHedefi,
    ...secenekler,
  });
  const bildir = useContext(BekciBildirimCtx);

  // Her içeriğin KENDİ kimliği var. Eskiden kayıt kimliksizdi ve pencere onu
  // tek bir ref'te tutuyordu: iki içerik varsa en son render eden kazanıyor,
  // diğerinin koruması sessizce yok oluyordu (İP-A6c · BULGU-5).
  const kimlikRef = useRef<symbol>();
  if (!kimlikRef.current) kimlikRef.current = Symbol("yuzey-bekcisi");

  // Bağımlılık dizisi YOK: `bekci` her render'da yeni bir nesnedir ve
  // pencere onu bir REF'te tutar (durum değil) — yani bu bildirim yeniden
  // render tetiklemez ve döngü kurulamaz.
  useEffect(() => {
    const kimlik = kimlikRef.current!;
    bildir?.(kimlik, bekci);
    return () => bildir?.(kimlik, null);
  });

  // Beyansız + sağlayıcısız = SESSİZ VERİ KAYBI. Kontrol bütün kancalardan
  // SONRA yapılır: erken `throw` kanca sırasını bozar ve asıl hatayı React'in
  // "rendered fewer hooks than expected" hatasının altına gömerdi.
  if (GELISTIRME && !bildir && !pencereSiz) {
    throw new Error(
      "useYuzeyKirliFormBekcisi bir <DuzenlemePenceresi> DIŞINDA çağrıldı ve " +
        "`pencereSiz` beyanı yok. Bu hâliyle bekçi pencereye hiç bildirilmez: " +
        "×/ESC/dış tıklama kirli formu SORMADAN kapatır ve kullanıcının " +
        "yazdığı veri gider (İP-A7d1 · SK-3). İki doğru yazımdan birini seç: " +
        "(1) kancayı pencerenin İÇİNDEKİ içerik bileşenine taşı " +
        "<DuzenlemePenceresi><Icerik/></DuzenlemePenceresi> ve çağrı " +
        "<Icerik> içinde olsun; (2) form gerçekten satır içiyse (pencere yok) " +
        "seçeneklere `pencereSiz: true` yaz."
    );
  }
  return bekci;
}

export interface DuzenlemePenceresiProps {
  yuzey: DuzenlemeYuzeyiKapisi;
  baslik: string;
  aciklama?: string;
  /** Panel genişliği — gerekçesi `admin/ui/Dialog.tsx`te. */
  genislik?: "dar" | "genis";
  children: ReactNode;
}

export function DuzenlemePenceresi({
  yuzey,
  baslik,
  aciklama,
  genislik,
  children,
}: DuzenlemePenceresiProps) {
  // Küme DEĞİL, kimlikli kayıt + geliştirmede `throw` (İP-A6c · BULGU-5).
  //
  // Küme yapmak "hangi bekçi sorar, sırayla mı sorar, biri iptal ederse ne
  // olur, iki onay penceresi üst üste mi açılır" tasarım sorularını açar ve bu
  // paketin işi sözleşmeyi ONARMAK, genişletmek değil. `throw` bugün veri
  // kaybını durdurur ve tasarımı A7'ye erteler — `Form.Control`da seçilen
  // yolun aynısı.
  const bekcilerRef = useRef(new Map<symbol, KirliFormBekcisi>());
  const bildir = useCallback<BekciBildirimi>((kimlik, bekci) => {
    if (!bekci) {
      bekcilerRef.current.delete(kimlik);
      return;
    }
    bekcilerRef.current.set(kimlik, bekci);
    if (GELISTIRME && bekcilerRef.current.size > 1) {
      throw new Error(
        "DuzenlemePenceresi tek bir korumalı içerik taşıyabilir: ikinci " +
          "korumalı içerik birincinin kirli form korumasını sessizce yok " +
          "ederdi (kullanıcının yazdığı veri soru sorulmadan giderdi). " +
          "Bölümleri ayrı pencerelere ayırın ya da tek bir form kurup " +
          "`useYuzeyKirliFormBekcisi`yi bir kez çağırın."
      );
    }
  }, []);

  const kapatmayiDene = useCallback(() => {
    const bekci = bekcilerRef.current.values().next().value;
    if (!bekci) {
      yuzey.kapat();
      return;
    }
    bekci.kapatmayiDene(yuzey.kapat);
  }, [yuzey]);

  // Dedektöre cevap veren taraf (İP-A7d4 · Görev 1): kayıt defteri boşsa
  // içerik korumasızdır ve `Dialog` panelde girdi görürse patlar.
  const korumaVarMi = useCallback(() => bekcilerRef.current.size > 0, []);

  return (
    <IcerikKorumasiCtx.Provider value={korumaVarMi}>
    <BekciBildirimCtx.Provider value={bildir}>
      <HedefCtx.Provider value={yuzey.hedef}>
        <Dialog
          open={yuzey.acik}
          title={baslik}
          description={aciklama}
          genislik={genislik}
          onClose={kapatmayiDene}
        >
          {children}
        </Dialog>
      </HedefCtx.Provider>
    </BekciBildirimCtx.Provider>
    </IcerikKorumasiCtx.Provider>
  );
}
