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
  const bekci = useKirliFormBekcisi({ form, sunucuHatasi, etkin: yuzey.acik });

  // İşlem sürerken kapatma yolu kapalı: yarıda kesilen bir gönderimde
  // kullanıcı sonucu göremez.
  const kapatmayiDene = useCallback(() => {
    if (islemSuruyor) return;
    bekci.kapatmayiDene(yuzey.kapat);
  }, [bekci, islemSuruyor, yuzey.kapat]);

  return (
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
  );
}

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
const BekciBildirimCtx = createContext<((bekci: KirliFormBekcisi | null) => void) | null>(
  null
);

/**
 * `useKirliFormBekcisi`nin yüzey farkındalığı olan hâli.
 *
 * Bekçiyi kurar VE (bir `DuzenlemePenceresi` içindeyse) pencereye bildirir;
 * böylece ×/ESC/dış tıklama yolları da kirli formu sorar.
 */
export function useYuzeyKirliFormBekcisi<TFieldValues extends FieldValues>(
  secenekler: KirliFormBekcisiSecenekleri<TFieldValues>
): KirliFormBekcisi {
  const bekci = useKirliFormBekcisi(secenekler);
  const bildir = useContext(BekciBildirimCtx);
  // Bağımlılık dizisi YOK: `bekci` her render'da yeni bir nesnedir ve
  // pencere onu bir REF'te tutar (durum değil) — yani bu bildirim yeniden
  // render tetiklemez ve döngü kurulamaz.
  useEffect(() => {
    bildir?.(bekci);
    return () => bildir?.(null);
  });
  return bekci;
}

export interface DuzenlemePenceresiProps {
  yuzey: DuzenlemeYuzeyiKapisi;
  baslik: string;
  aciklama?: string;
  children: ReactNode;
}

export function DuzenlemePenceresi({
  yuzey,
  baslik,
  aciklama,
  children,
}: DuzenlemePenceresiProps) {
  const bekciRef = useRef<KirliFormBekcisi | null>(null);
  const bildir = useCallback((bekci: KirliFormBekcisi | null) => {
    bekciRef.current = bekci;
  }, []);

  const kapatmayiDene = useCallback(() => {
    const bekci = bekciRef.current;
    if (!bekci) {
      yuzey.kapat();
      return;
    }
    bekci.kapatmayiDene(yuzey.kapat);
  }, [yuzey]);

  return (
    <BekciBildirimCtx.Provider value={bildir}>
      <Dialog
        open={yuzey.acik}
        title={baslik}
        description={aciklama}
        onClose={kapatmayiDene}
      >
        {children}
      </Dialog>
    </BekciBildirimCtx.Provider>
  );
}
