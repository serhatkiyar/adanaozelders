/**
 * Ürün görselleri: kapak + galeri (çoklu yükleme, sıralama, alt metin, silme).
 *
 * ## NEDEN VAR
 *
 * Çoklu görsel uçları (`POST .../images`, `DELETE .../images/{id}`) API
 * katmanında yazılmıştı ama HİÇBİR YERDEN ÇAĞRILMIYORDU: yönetici bir ürüne
 * yalnız TEK kapak görseli koyabiliyordu. Vitrindeki galeri, lens-zoom ve
 * lightbox hazırdı ve besleyecek veriden yoksundu.
 *
 * ## NEDEN FORMUN İÇİNDE DEĞİL
 *
 * Görsel işlemleri ANINDA sunucuya yazar; formun "kaydet"ine bağlı değildir.
 * Forma gömülseydi kirli form bekçisi yüklenmiş bir görseli "kaydedilmemiş
 * değişiklik" sanardı ve kullanıcı vazgeçtiğinde geri alınamayan bir işlem
 * için onay isterdi. `StockLedgerPanel` aynı gerekçeyle formun kardeşidir.
 *
 * ## NÖBETÇİ KISITLARI (uiBaseline)
 *
 *   - Ham `<button>` tavanı **100 ve dolu** → burada ham düğme YOK; hepsi
 *     `admin/ui::Button` veya `ui/PlainButton`.
 *   - Adsız kontrol tavanı **7 ve dolu** → görünen her kontrol ad taşır.
 *     Dosya seçiciler `hidden`dır (erişilebilirlik ağacında yoklar); adı
 *     görünen tetikleyici taşır.
 *   - `modalDurumu = 0` → silme onayı PENCERE DEĞİL, satır içi iki adımdır.
 *     Yerel `useState`'i bir `*Dialog`a bağlamak sayacı 0'dan çıkarırdı.
 *   - Panel ağacında `indigo-` yasak → renkler `--panel-*` token'larından.
 */
import { useRef, useState } from "react";

import { Button } from "@/components/admin/ui";
import { PlainButton } from "@/components/ui/PlainButton";
import { useProductMedia } from "@/hooks/useStore";
import { compressImage } from "@/lib/compressImage";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { ProductDetailOut, ProductImageOut } from "@/types";

export function ProductMediaManager({ product }: { product: ProductDetailOut }) {
  const { uploadCover, uploadImages, removeImage, reorder, updateMeta } =
    useProductMedia(product.id);
  const [onayBekleyen, setOnayBekleyen] = useState<number | null>(null);

  const images = product.images ?? [];
  const hata = (e: unknown) => toast.error(getErrorMessage(e, "Görsel işlemi başarısız."));

  async function kapakSec(file: File) {
    uploadCover.mutate(await compressImage(file), {
      onSuccess: () => toast.success("Kapak güncellendi."),
      onError: hata,
    });
  }

  async function galeriEkle(files: File[]) {
    const hazir = await Promise.all(files.map(compressImage));
    uploadImages.mutate(hazir, {
      onSuccess: () => toast.success(`${hazir.length} görsel eklendi.`),
      onError: hata,
    });
  }

  /** Komşu iki görselin yerini değiştirir; sunucuya TAM sıra gönderilir. */
  function tasi(index: number, yon: -1 | 1) {
    const hedef = index + yon;
    if (hedef < 0 || hedef >= images.length) return;
    const ids = images.map((im) => im.id);
    [ids[index], ids[hedef]] = [ids[hedef], ids[index]];
    reorder.mutate(ids, { onError: hata });
  }

  function altMetinKaydet(image: ProductImageOut, deger: string) {
    if (deger.trim() === (image.alt_text ?? "").trim()) return;
    updateMeta.mutate({ imageId: image.id, alt_text: deger }, { onError: hata });
  }

  return (
    <section className="space-y-6">
      <h3 className="font-display text-base font-semibold text-panel-fg">Görseller</h3>

      {/* ── Kapak ── */}
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-panel-border bg-white">
          {product.cover_url ? (
            <img
              src={product.cover_url}
              alt="Ürün kapağı"
              className="h-full w-full object-contain mix-blend-multiply"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[11px] text-panel-fg-subtle">
              Kapak yok
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-panel-fg">Kapak görseli</p>
          <p className="mt-0.5 text-xs text-panel-fg-muted">
            Listelerde ve arama sonuçlarında görünen tek görsel.
          </p>
          <div className="mt-2">
            <DosyaSecici
              etiket={product.cover_url ? "Kapağı değiştir" : "Kapak yükle"}
              busy={uploadCover.isPending}
              onSec={(files) => kapakSec(files[0])}
            />
          </div>
        </div>
      </div>

      {/* ── Galeri ── */}
      <div className="border-t border-panel-border pt-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-panel-fg">
              Galeri{images.length > 0 ? ` · ${images.length} görsel` : ""}
            </p>
            <p className="mt-0.5 text-xs text-panel-fg-muted">
              Ürün sayfasında kapağın ardından bu sırayla gösterilir.
            </p>
          </div>
          <DosyaSecici
            etiket="Görsel ekle"
            coklu
            busy={uploadImages.isPending}
            onSec={galeriEkle}
          />
        </div>

        {images.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-panel-border py-8 text-center text-xs text-panel-fg-subtle">
            Henüz galeri görseli yok. Arka kapak, iç sayfa örneği, ölçek
            karşılaştırması… ekleyin.
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {images.map((im, i) => (
              <GaleriOgesi
                key={im.id}
                image={im}
                sira={i}
                ilk={i === 0}
                son={i === images.length - 1}
                onayBekliyor={onayBekleyen === im.id}
                onSolaAl={() => tasi(i, -1)}
                onSagaAl={() => tasi(i, 1)}
                onSilIste={() => setOnayBekleyen(im.id)}
                onSilVazgec={() => setOnayBekleyen(null)}
                onSilOnayla={() =>
                  removeImage.mutate(im.id, {
                    onSuccess: () => {
                      toast.success("Görsel silindi.");
                      setOnayBekleyen(null);
                    },
                    onError: hata,
                  })
                }
                onAltMetin={(deger) => altMetinKaydet(im, deger)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ── Dosya seçici ─────────────────────────────────────────────────────────── */

/**
 * Gizli `<input type="file">` + görünen tetikleyici.
 *
 * Girdi `hidden`dır: erişilebilirlik ağacında yoktur, adı görünen düğme
 * taşır. Ölçüm aracı bu kalıbı bilerek muaf tutar; `className`de "hidden"
 * yazmak YETMEZ, öznitelik olması gerekir.
 */
function DosyaSecici({
  etiket,
  busy,
  coklu = false,
  onSec,
}: {
  etiket: string;
  busy: boolean;
  coklu?: boolean;
  onSec: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        isPending={busy}
        onClick={() => ref.current?.click()}
      >
        {etiket}
      </Button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple={coklu}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onSec(files);
          // Aynı dosya art arda seçilebilsin diye değer temizlenir.
          e.target.value = "";
        }}
      />
    </>
  );
}

/* ── Galeri ögesi ─────────────────────────────────────────────────────────── */

function GaleriOgesi({
  image,
  sira,
  ilk,
  son,
  onayBekliyor,
  onSolaAl,
  onSagaAl,
  onSilIste,
  onSilVazgec,
  onSilOnayla,
  onAltMetin,
}: {
  image: ProductImageOut;
  sira: number;
  ilk: boolean;
  son: boolean;
  onayBekliyor: boolean;
  onSolaAl: () => void;
  onSagaAl: () => void;
  onSilIste: () => void;
  onSilVazgec: () => void;
  onSilOnayla: () => void;
  onAltMetin: (deger: string) => void;
}) {
  const altId = `gorsel-alt-${image.id}`;
  return (
    <li className="space-y-2">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-panel-border bg-white">
        <img
          src={image.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain mix-blend-multiply"
        />
        <span className="absolute left-1.5 top-1.5 rounded-md bg-panel-fg/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          {sira + 1}
        </span>
      </div>

      {onayBekliyor ? (
        // Satır içi onay: pencere açmak hem bu ekranda aşırı, hem de nöbetçinin
        // "ekranda yaşayan pencere durumu = 0" tabanını bozardı.
        <div className="flex items-center gap-1.5">
          <span className="mr-auto text-xs text-panel-fg-muted">Silinsin mi?</span>
          <Button variant="danger" size="sm" onClick={onSilOnayla}>
            Sil
          </Button>
          <Button variant="ghost" size="sm" onClick={onSilVazgec}>
            Vazgeç
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <SiraDugmesi
            etiket={`${sira + 1}. görseli sola al`}
            disabled={ilk}
            onClick={onSolaAl}
          >
            ←
          </SiraDugmesi>
          <SiraDugmesi
            etiket={`${sira + 1}. görseli sağa al`}
            disabled={son}
            onClick={onSagaAl}
          >
            →
          </SiraDugmesi>
          <span className="ml-auto">
            <Button variant="ghost" size="sm" onClick={onSilIste}>
              Sil
            </Button>
          </span>
        </div>
      )}

      <label htmlFor={altId} className="sr-only">
        {sira + 1}. görselin alt metni
      </label>
      <input
        id={altId}
        type="text"
        defaultValue={image.alt_text ?? ""}
        maxLength={200}
        placeholder="Alt metin (ör. arka kapak)"
        onBlur={(e) => onAltMetin(e.target.value)}
        className="w-full rounded-lg border border-panel-border bg-white px-2.5 py-1.5 text-xs text-panel-fg placeholder:text-panel-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus"
      />
    </li>
  );
}

function SiraDugmesi({
  etiket,
  disabled,
  onClick,
  children,
}: {
  etiket: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <PlainButton
      aria-label={etiket}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-panel-border bg-white text-sm text-panel-fg transition hover:bg-panel-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-focus disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden="true">{children}</span>
    </PlainButton>
  );
}
