import type { ReactNode } from "react";

import { Button } from "@/components/admin/ui";

/**
 * ── İKİ AYRI boş durum (İP-B2 · docs/tasarim-dili.md §5.3) ──
 *
 * "Hiç kayıt yok" ile "filtre eşleşmedi" **aynı bileşen değildir** ve bu bir
 * biçim tercihi değil, bir kullanıcı niyeti ayrımıdır:
 *
 *   - "Henüz ürün eklenmemiş" diyen kişi bir şey **yaratmak** ister →
 *     birincil aksiyon bir DAVETTİR ("İlk ürünü ekle").
 *   - "Eşleşen ürün yok" diyen kişi filtresini **gevşetmek** ister →
 *     aksiyon bir DÜZELTME TALİMATIDIR ("Filtreleri temizle").
 *
 * Tek bileşenle yapılırsa ikisinden birine yanlış aksiyon sunulur; daha
 * kötüsü, boş katalog ile sonuçsuz filtre aynı metni gösterirse yönetici
 * **katalogun boşaldığını sanır**. `adminStorePanel.acceptance` (E-3) bu
 * iddiayı zaten taşıyordu; buradaki ayrım onu yapısal hâle getirir.
 *
 * Medusa aynı ayrımı `NoRecords` / `NoResults` olarak yapar.
 *
 * ## Neden `SonucYokDurumu`nun aksiyonu bir YUVA değil
 *
 * `KayitYokDurumu.aksiyon` serbest bir `ReactNode`dur (her ekranın "yarat"
 * aksiyonu farklıdır: ürün ekle, tur kur, oturum aç). `SonucYokDurumu` ise
 * aksiyonu KENDİ basar ve yalnız `onTemizle` alır. Sebep: burada doğru
 * aksiyon tektir ve yuva bırakmak onu unutmayı ya da yanlışını koymayı
 * serbest bırakırdı. Aynı gerekçe `DataTable`ın `satirAdi` propunda da
 * yazılıydı (İP-A7d2 · SK-5): sessiz varsayılan yerine açık beyan, ama
 * beyanı ZORUNLU kılarak.
 *
 * ## Görsel: kutu değil boşluk
 *
 * Eski `EmptyState` kesik çizgili bir kutuydu. Kaldırıldı: boş durum zaten
 * tablonun çerçevesinin İÇİNDE duruyor ve ikinci bir çerçeve "kart
 * enflasyonu" üretiyordu (kalıcı karar: kutu yerine boşluk).
 */

export interface KayitYokDurumuProps {
  /** "Henüz ürün eklenmemiş" — kayıt YOKLUĞUNU söyler, filtreyi değil. */
  baslik: string;
  aciklama?: string;
  /** Yaratma daveti. Yetkisi olmayan kullanıcıda verilmez. */
  aksiyon?: ReactNode;
}

export function KayitYokDurumu({ baslik, aciklama, aksiyon }: KayitYokDurumuProps) {
  return (
    <div data-bos-durum="kayit-yok" className="px-6 py-16 text-center">
      <h2 className="text-sm font-semibold text-panel-fg">{baslik}</h2>
      {aciklama && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-panel-fg-muted">{aciklama}</p>
      )}
      {aksiyon && <div className="mt-5 flex justify-center">{aksiyon}</div>}
    </div>
  );
}

export interface SonucYokDurumuProps {
  /** "Eşleşen ürün bulunamadı" — kaydın yokluğunu DEĞİL, eşleşmeyi söyler. */
  baslik: string;
  aciklama?: string;
  /** Filtreleri sıfırlar. Aksiyonun kendisi bu bileşene aittir. */
  onTemizle: () => void;
}

export function SonucYokDurumu({ baslik, aciklama, onTemizle }: SonucYokDurumuProps) {
  return (
    <div data-bos-durum="sonuc-yok" className="px-6 py-16 text-center">
      <h2 className="text-sm font-semibold text-panel-fg">{baslik}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-panel-fg-muted">
        {aciklama ?? "Arama ve filtreleri gevşetmeyi deneyin."}
      </p>
      <div className="mt-5 flex justify-center">
        <Button size="sm" variant="secondary" onClick={onTemizle}>
          Filtreleri temizle
        </Button>
      </div>
    </div>
  );
}
