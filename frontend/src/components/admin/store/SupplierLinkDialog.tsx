/**
 * Tedarikçi satırını bir mağaza ürününe BAĞLAMA penceresi.
 *
 * ## Neden elle bağlama var
 *
 * Otomatik bağ yalnız **tek** ve **geçerli** barkod eşleşmesinde kurulur
 * (D-7). Barkodu bozuk, hiç olmayan ya da birden çok ürüne düşen satırlar
 * bayraklanıp bekler; kararı insan verir. Bu pencere o kararın yüzeyidir ve
 * bu yüzden **gerekçe zorunludur** (D-10: karar `audit_logs`'a düşer).
 *
 * ## Ürün ID'si elle YAZILMAZ
 *
 * Ortak `ProductPicker` yeniden kullanılıyor: yönetici başlık, yazar,
 * yayınevi, ISBN, SKU veya barkodla arar ve listeden seçer. Ham ID yazmak,
 * numarayı başka bir ekrandan not etmeyi gerektirir ve yanlış numara SESSİZCE
 * yanlış ürünü tedarikçiye bağlar — üstelik o ürün vitrinde "tedarikçiden
 * temin edilebilir" sayılmaya başlar.
 *
 * ## Pencere sözleşmesi
 *
 * İçerik AYRI bir bileşendir (`BaglaIcerik`) çünkü kirli form bekçisi
 * pencerenin İÇİNDE çağrılmalıdır (İP-A7d1 · SK-3): dışarıda çağrılırsa
 * ×/ESC/dış tıklama yazılan gerekçeyi sormadan siler.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { ProductPicker } from "@/components/admin/ProductPicker";
import { Button } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { useLinkSupplierProduct } from "@/hooks/useSuppliers";
import { toast } from "@/store/toastStore";

import type { ProductSearchOut } from "@/types";
import type { SupplierProductOut } from "@/types/supplier";

const GEREKCE_ENUZUN = 500;

const baglaSemasi = z.object({
  // `refine((v) => v !== null)` KULLANILMAZ: zod 4 tip yüklemini görüp çıktı
  // tipini `number`a daraltır ve şemanın girdi/çıktı tipleri ayrışır — RHF
  // `Resolver` uyumsuzluğu verir. `superRefine` yalnız hata üretir, tip
  // daraltmaz; alanın boş hâli formda temsil edilebilir kalır.
  urunId: z
    .number()
    .int()
    .positive()
    .nullable()
    .superRefine((v, ctx) => {
      if (v === null) {
        ctx.addIssue({ code: "custom", message: "Bağlanacak ürünü seçin." });
      }
    }),
  gerekce: z
    .string()
    .refine((v) => v.trim().length >= 3, "Gerekçe en az 3 karakter olmalı.")
    .refine(
      (v) => v.length <= GEREKCE_ENUZUN,
      `En fazla ${GEREKCE_ENUZUN} karakter yazılabilir.`,
    ),
});

type BaglaDegerleri = z.infer<typeof baglaSemasi>;

export function SupplierLinkDialog({
  yuzey,
  supplierId,
}: {
  /** Bağlanacak tedarikçi satırını taşıyan yüzey; kapalıyken `kayit` null. */
  yuzey: DuzenlemeYuzeyiDurumu<SupplierProductOut, void>;
  supplierId: number;
}) {
  const satir = yuzey.kayit;
  if (!yuzey.acik || !satir) return null;

  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik="Ürüne bağla"
      aciklama={`${satir.external_code} · ${satir.name}`}
    >
      {/* `key` satır kimliğinden: pencere kapanmadan başka bir satıra
          geçilirse form SIFIRLANIR. Aksi hâlde önceki satır için seçilmiş
          ürün ve yazılmış gerekçe yeni satıra taşınırdı. */}
      <BaglaIcerik key={satir.id} satir={satir} supplierId={supplierId} onBitti={yuzey.kapat} />
    </DuzenlemePenceresi>
  );
}

function BaglaIcerik({
  satir,
  supplierId,
  onBitti,
}: {
  satir: SupplierProductOut;
  supplierId: number;
  onBitti: () => void;
}) {
  const link = useLinkSupplierProduct(supplierId);
  // Seçilen ürünün KENDİSİ (başlık/SKU göstermek için) ekranda, kimliği
  // formda yaşar: doğrulama ve kirli-form takibi kimliğe bakar.
  const [secilen, setSecilen] = useState<ProductSearchOut | null>(null);

  const form = useForm<BaglaDegerleri>({
    resolver: zodResolver(baglaSemasi),
    defaultValues: { urunId: null, gerekce: "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  const bekci = useYuzeyKirliFormBekcisi({ form, sunucuHatasi: link.error });

  function urunSec(secilenler: ProductSearchOut[]) {
    const ilk = secilenler[0] ?? null;
    setSecilen(ilk);
    form.setValue("urunId", ilk?.id ?? null, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  const gonder = form.handleSubmit(
    (deger) => {
      link.mutate(
        { spId: satir.id, product_id: deger.urunId!, reason: deger.gerekce.trim() },
        {
          onSuccess: () => {
            toast.success("Tedarikçi satırı ürüne bağlandı");
            form.reset(deger);
            onBitti();
          },
          onError: (hata: unknown) => {
            const kalan = sunucuHatasiniUygula(hata, form, ["urunId", "gerekce"], {
              product_id: "urunId",
              reason: "gerekce",
            });
            form.setError("root.sunucu", {
              type: "server",
              message: kalan ?? undefined,
            });
          },
        },
      );
    },
    () => form.setFocus("gerekce"),
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;
  const urunHatasi = form.formState.errors.urunId?.message;

  return (
    <div className="space-y-4">
      {genelHata && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
        >
          {genelHata}
        </p>
      )}

      {/* Tedarikçi satırının künyesi: yönetici neyi bağladığını görmeden
          karar veremez (barkod ve birim, yanlış eşleşmenin en sık iki
          kaynağı). */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-slate-200 py-3 text-xs dark:border-slate-800">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Tedarikçi kodu</dt>
          <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
            {satir.external_code}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Barkod</dt>
          <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
            {satir.barcode || "—"}
            {satir.barcode && !satir.barcode_valid && (
              <span className="ml-1 font-normal text-amber-700 dark:text-amber-400">
                (geçersiz)
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Birim</dt>
          <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
            {satir.unit_name || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Marka</dt>
          <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
            {satir.brand || "—"}
          </dd>
        </div>
      </dl>

      <div>
        <ProductPicker
          selected={secilen ? [secilen] : []}
          onChange={urunSec}
          multiple={false}
          label="Bağlanacak ürünü ara"
        />
        {/* Hata `ProductPicker`ın DIŞINDA: seçici ortak bir bileşendir ve
            form bağlamını bilmez. */}
        {urunHatasi && (
          <p role="alert" className="mt-1 text-xs text-rose-700 dark:text-rose-400">
            {urunHatasi}
          </p>
        )}
      </div>

      <Form.Field
        control={form.control}
        name="gerekce"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Bağlama gerekçesi</Form.Label>
            <Form.Control>
              <textarea
                rows={3}
                maxLength={GEREKCE_ENUZUN}
                className="input min-h-20 resize-y"
                placeholder="Ör. barkod tedarikçide eksik, künye elle doğrulandı"
                {...field}
              />
            </Form.Control>
            <Form.Hint>
              Denetim kaydına yazılır; bağın neden elle kurulduğunu açıklayın.
            </Form.Hint>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={link.isPending}
          onClick={() => bekci.kapatmayiDene(onBitti)}
        >
          Vazgeç
        </Button>
        {/* Düğme geçerlilikle KAPANMAZ (kilitli karar): geçersizse istek
            gitmez, hata alanda çıkar ve odak oraya taşınır. */}
        <Button isPending={link.isPending} onClick={gonder}>
          Bağla
        </Button>
      </div>
    </div>
  );
}
