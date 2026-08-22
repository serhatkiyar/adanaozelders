import { Button, ConfirmDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";

import { Menu, MenuAyraci, MenuOgesi } from "./menu";

/**
 * ── Satır aksiyonu kuralı — Ç-2 · Seçenek D (İP-B2) ──
 *
 * Kilitlenen karar üç maddedir ve üçü de BURADA zorlanır, ekranlarda değil:
 *
 *   1. Satır başına **en fazla 2 açık düğme**; fazlası üç nokta menüsünde.
 *   2. Masaüstü ve mobilde **aynı desen** (C seçeneğinin "aynı yetenek iki
 *      farklı yerde" sorunu üretilmez).
 *   3. Açıktaki düğmelerin hiçbiri **yıkıcı olamaz** (sil/iptal/iade);
 *      yıkıcı aksiyon her zaman menüde ve **onay adımlıdır**.
 *
 * ## Neden kural bileşende ZORLANIYOR (ve neden gürültülü)
 *
 * İP-B1'in `Form.Control` dersi: bir sözleşme yalnız yazıyla korunuyorsa
 * çürür. O turda `Form.Control` içindeki `<input>`u bir render-prop'un
 * ardına koymak, sayacı sessizce kandırıyordu (İP-A7d2 · Görev 4) ve düzeltme
 * "sessiz kalamasın" oldu.
 *
 * Aynı ilaç burada: kural ihlali **sessizce düzeltilmez**. Geliştirmede ve
 * testte `throw` edilir (ekran açılmaz, kırmızı ekranda gerekçesi yazar),
 * üretimde `console.error` + güvenli bozunma (fazlalar menüye iner) uygulanır.
 * Üretimde `throw` etmemek bilinçlidir: bir tasarım kuralı yüzünden
 * yöneticinin sipariş ekranı beyaz kalmamalı.
 *
 * Ters provası `satirAksiyonlari.test.tsx`te: üçüncü açık düğme verildiğinde
 * GERÇEKTEN patlıyor mu, ve açıktaki yıkıcı aksiyon GERÇEKTEN reddediliyor mu.
 *
 * ## "Hangi ikisi birincil" kararı EKRANINDIR
 *
 * Bileşen sayıyı ve yıkıcılığı zorlar, seçimi yapmaz: hangi iki aksiyonun
 * açıkta duracağı ekrana göre değişir (üründe "Düzenle" + "Yayınla/Gizle";
 * pakette "Yeniden paketle" + "Etiket"). Ekran `acik: true` yazarak seçer.
 */

/** Yıkıcı aksiyonun onay penceresi — metinler çağırandan gelir. */
export interface OnayMetni {
  baslik: string;
  aciklama?: string;
  onayEtiketi: string;
}

interface SatirAksiyonuOrtak {
  /** Görünen etiket; erişilebilir ad da budur. */
  etiket: string;
  /**
   * Aksiyonun kendisi. **Yıkıcı aksiyonlarda `kapat` argümanı önemlidir.**
   *
   * ## Onay penceresi neden kendiliğinden kapanmıyor
   *
   * İlk yazımda `onConfirm` önce `kapat()` çağırıyor, sonra aksiyonu
   * çalıştırıyordu. Bu, mevcut bir kabul testinin yakaladığı GERÇEK BİR
   * REGRESYONDU (`adminSafetyStates.acceptance` · C-2): pencere anında
   * kapanınca onay düğmesi DOM'dan kalkıyor ve **çift tıklama koruması yok
   * oluyordu** — istek uçarken ikinci bir DELETE gönderilebilirdi.
   *
   * Doğru yaşam döngüsü (İP-A6'dan beri yürürlükteydi, korundu):
   *   1. Onay → aksiyon çalışır, pencere AÇIK kalır,
   *   2. `bekliyor` boyunca onay düğmesi `disabled` (ikinci tıklama istek
   *      üretmez) ve pencere kapatılamaz,
   *   3. **BAŞARIDA** çağıran `kapat()` der; hatada pencere açık kalır ve
   *      kullanıcı gerekçeyi görüp yeniden deneyebilir.
   *
   * Yıkıcı olmayan aksiyonlar argümanı yok sayabilir (0 argümanlı fonksiyon
   * tip düzeyinde uyumludur).
   */
  onSec: (kapat: () => void) => void;
  /** Yetki yoksa aksiyon hiç üretilmez — `false` yerine `gizli` yazmak, "kim
   *  görmüyor" bilgisini çağrı yerinde tutar. */
  gizli?: boolean;
  bekliyor?: boolean;
  /** Menüde etiketin altına yazılan kısa açıklama. */
  ipucu?: string;
}

/**
 * Yıkıcı aksiyon TİP DÜZEYİNDE açıkta duramaz (`acik?: never`) ve onay metni
 * TİP DÜZEYİNDE zorunludur.
 *
 * Çalışma zamanı kontrolü yine de var: aksiyon dizileri koşullu ifadelerden
 * (`...(canManage ? [...] : [])`) üretiliyor ve TypeScript orada birleşimi
 * genişletebiliyor.
 */
export type SatirAksiyonu =
  | (SatirAksiyonuOrtak & { yikici?: false; acik?: boolean; onay?: OnayMetni })
  | (SatirAksiyonuOrtak & { yikici: true; acik?: never; onay: OnayMetni });

export const ACIK_AKSIYON_TAVANI = 2;

/**
 * Kural ihlalini ANLATAN metin; ihlal yoksa `null`.
 *
 * Saf fonksiyon olarak ayrıldı ki DOM olmadan da sınanabilsin ve mesajın
 * kendisi test edilebilsin — "patladı" yetmez, DOĞRU SEBEPLE patlamalı.
 */
export function aksiyonKuralIhlali(aksiyonlar: SatirAksiyonu[]): string | null {
  const gorunur = aksiyonlar.filter((a) => !a.gizli);
  const acikOlanlar = gorunur.filter((a) => a.acik);

  const acikYikici = acikOlanlar.filter((a) => a.yikici);
  if (acikYikici.length > 0) {
    return (
      `Ç-2 ihlali: yıkıcı aksiyon açıkta olamaz (${acikYikici
        .map((a) => `"${a.etiket}"`)
        .join(", ")}). Yıkıcı aksiyonlar her zaman üç nokta menüsünde ve ` +
      "onay adımlıdır — yanlış satıra dokunmak geri alınamaz bir sonuç üretmemeli."
    );
  }

  if (acikOlanlar.length > ACIK_AKSIYON_TAVANI) {
    return (
      `Ç-2 ihlali: satır başına en fazla ${ACIK_AKSIYON_TAVANI} açık düğme olabilir, ` +
      `${acikOlanlar.length} verildi (${acikOlanlar.map((a) => `"${a.etiket}"`).join(", ")}). ` +
      "Fazlası üç nokta menüsüne alınır; hangi ikisinin birincil olduğu ekranın kararıdır."
    );
  }

  const onaysizYikici = gorunur.filter((a) => a.yikici && !a.onay);
  if (onaysizYikici.length > 0) {
    return (
      `Ç-2 ihlali: yıkıcı aksiyonun onay metni zorunludur (${onaysizYikici
        .map((a) => `"${a.etiket}"`)
        .join(", ")}).`
    );
  }

  return null;
}

export interface SatirAksiyonlariProps {
  aksiyonlar: SatirAksiyonu[];
  /**
   * Nerede duruyor: tablo hücresinde mi, mobil kartın altında mı.
   *
   * Fark yalnız DOKUNMA HEDEFİ ve genişliktir — desen aynıdır (Ç-2 · D: iki
   * genişlikte AYNI düzen). Tasarım dili §5.5 mobil kart aksiyonları için
   * "tam genişlik, min 44px" diyor; tablo hücresinde ise satır yüksekliğini
   * büyütmemek için `sm` (36px) doğru boy.
   *
   * Bu ayrım gerçek tarayıcı turunda ÖLÇÜLDÜ: `kart` yerleşimi olmadan
   * 380 px'te en küçük dokunma hedefi 36 px kalıyordu.
   */
  yerlesim?: "satir" | "kart";
  /**
   * Üç nokta düğmesinin erişilebilir adı — satırı TANITMALIDIR.
   *
   * "İşlemler" yazılırsa bir tabloda otuz tane aynı adlı düğme doğar ve ekran
   * okuyucu ile otomasyon hangisinin hangi satır olduğunu ayırt edemez
   * (İP-A7d2 · SK-5'in aynısı). Doğrusu: "Geometri Soru Bankası — işlemler".
   */
  menuEtiketi: string;
}

export function SatirAksiyonlari({
  aksiyonlar,
  menuEtiketi,
  yerlesim = "satir",
}: SatirAksiyonlariProps) {
  const kart = yerlesim === "kart";
  // Onay penceresinin durumu EKRANDA yaşamaz (İP-A4 sözleşmesi): hedef, dizi
  // içindeki aksiyonun indeksidir.
  const onayYuzeyi = useDuzenlemeYuzeyi<number, void>();

  const ihlal = aksiyonKuralIhlali(aksiyonlar);
  if (ihlal) {
    // GÜRÜLTÜLÜ: sessiz kabul yok. Geliştirme/test → patla; üretim → logla ve
    // güvenli bozunmayla devam et (aşağıdaki bölümleme zaten tavanı uygular).
    console.error(`[SatirAksiyonlari] ${ihlal}`);
    if (import.meta.env.DEV) throw new Error(ihlal);
  }

  const gorunur = aksiyonlar.filter((a) => !a.gizli);
  // Güvenli bozunma: kural ihlal edilmişse bile açıkta yalnız yıkıcı OLMAYAN
  // ilk iki aksiyon kalır. Sıra çağıranın verdiği sıradır (belirlenimci).
  const acik = gorunur.filter((a) => a.acik && !a.yikici).slice(0, ACIK_AKSIYON_TAVANI);
  const menude = gorunur.filter((a) => !acik.includes(a));

  if (gorunur.length === 0) return null;

  const yikiciBaslangici = menude.findIndex((a) => a.yikici);

  const calistir = (aksiyon: SatirAksiyonu, indeks: number) => {
    if (aksiyon.yikici) onayYuzeyi.ac(indeks);
    else aksiyon.onSec(onayYuzeyi.kapat);
  };

  const onaylananAksiyon =
    onayYuzeyi.kayit === null ? null : (gorunur[onayYuzeyi.kayit] ?? null);

  return (
    <div
      className={
        kart
          ? "flex items-center gap-2 pt-1"
          : "flex items-center justify-end gap-1.5 whitespace-nowrap"
      }
    >
      {acik.map((aksiyon) => (
        <Button
          key={aksiyon.etiket}
          size={kart ? "md" : "sm"}
          variant="secondary"
          isPending={aksiyon.bekliyor}
          onClick={() => aksiyon.onSec(onayYuzeyi.kapat)}
          className={kart ? "min-h-11 flex-1" : undefined}
        >
          {aksiyon.etiket}
        </Button>
      ))}

      {menude.length > 0 && (
        <Menu etiket={menuEtiketi} tetikleyiciSinif={kart ? "min-h-11 !px-3" : undefined}>
          {(kapat) =>
            menude.map((aksiyon, i) => (
              <div key={aksiyon.etiket}>
                {/* Yıkıcı blok bir ayraçla ayrılır: "Sil"in hemen üstündeki
                    öğeye yanlışlıkla basmak ile "Sil"e basmak arasındaki fark
                    bir piksel olmamalı. */}
                {i === yikiciBaslangici && i > 0 && <MenuAyraci />}
                <MenuOgesi
                  yikici={aksiyon.yikici}
                  bekliyor={aksiyon.bekliyor}
                  ipucu={aksiyon.ipucu}
                  onSec={() => {
                    kapat();
                    calistir(aksiyon, gorunur.indexOf(aksiyon));
                  }}
                >
                  {aksiyon.etiket}
                </MenuOgesi>
              </div>
            ))
          }
        </Menu>
      )}

      {onaylananAksiyon?.onay && (
        <ConfirmDialog
          open={onayYuzeyi.acik}
          title={onaylananAksiyon.onay.baslik}
          description={onaylananAksiyon.onay.aciklama ?? ""}
          confirmLabel={onaylananAksiyon.onay.onayEtiketi}
          danger={onaylananAksiyon.yikici}
          isPending={onaylananAksiyon.bekliyor}
          onClose={onayYuzeyi.kapat}
          // KAPATMA BURADA DEĞİL: pencere aksiyon boyunca AÇIK kalır ki onay
          // düğmesi `isPending` ile devre dışı kalsın (çift tıklama koruması).
          // Kapatmayı çağıran BAŞARIDA yapar; gerekçe `onSec`in dokümanında.
          onConfirm={() => onaylananAksiyon.onSec(onayYuzeyi.kapat)}
        />
      )}
    </div>
  );
}
