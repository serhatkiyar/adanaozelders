// Kısmi teslimat penceresi — "eldekini bugün gönder, kalanı temin edilince".
//
// Operatör hazırlarken stok eksiği görürse hangi kalemin SONRAYA kalacağını
// burada seçer. Pencere kendiliğinden açılmaz ve hiçbir şeyi varsaymaz: bölme
// bir karardır, operatör bölmezse sipariş tek teslimat olarak bekler.
//
// ## Karar sunucudadır
//
// Bu pencere yalnız kullanıcının niyetiyle çelişen iki şeyi engeller — hiç
// kalem seçilmemesi ve kaynağın tamamen boşaltılması. Adet tavanı, okutulmuş
// adet ve paket durumu kurallarını YENİDEN uygulamaz; onlar 409 olarak döner.
//
// ## Yazılan sormadan silinmez (SK-7 sınıfı)
//
// Adet girildikten sonra ESC/× ile kapatmak sessiz veri kaybıdır. `ReasonDialog`
// ile aynı çözüm: form react-hook-form'da yaşar ve `useYuzeyKirliFormBekcisi`
// kapatmayı kirliyken sorar.
import { useCallback, useMemo } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/admin/ui/Button";
import {
  DuzenlemePenceresi,
  HATA_TAKIBI_YOK,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiKapisi,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form } from "@/components/admin/ui2/form";
import type { PackageItem, PackageSplitLine } from "@/types/packing";

export interface SplitDialogProps {
  open: boolean;
  /** Kaynak paketin kodu — pencere başlığındaki hedef kimliği. */
  code: string;
  items: PackageItem[];
  isPending?: boolean;
  onClose: () => void;
  onConfirm: (lines: PackageSplitLine[], promisedDate: string | null) => void;
}

export function SplitDialog({
  open,
  code,
  items,
  isPending = false,
  onClose,
  onConfirm,
}: SplitDialogProps) {
  const kapat = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);

  const yuzey = useMemo<DuzenlemeYuzeyiKapisi>(
    () => ({ acik: open, kapat, hedef: code }),
    [open, kapat, code],
  );

  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik="Kalanı sonraki teslimata ayır"
      aciklama={
        "Bugün gönderilemeyecek kalemleri seç. Seçtiklerin ikinci bir " +
        "teslimata taşınır; kalanlar bu kutuda gider."
      }
    >
      <SplitIcerik
        items={items}
        isPending={isPending}
        onClose={kapat}
        onConfirm={onConfirm}
      />
    </DuzenlemePenceresi>
  );
}

type Degerler = { adetler: Record<string, number>; tarih: string };

/** Şema kaleme bağlıdır: her satırın tavanı kendi `expected_qty`sidir. */
function splitSemasi(items: PackageItem[]) {
  const kutudaki = items.reduce((toplam, satir) => toplam + satir.expected_qty, 0);
  const sekil: Record<string, z.ZodTypeAny> = {};
  for (const satir of items) {
    sekil[String(satir.order_item_id)] = z.coerce
      .number()
      .int()
      .min(0, "Adet negatif olamaz.")
      .max(satir.expected_qty, `Bu kalemde en fazla ${satir.expected_qty} adet var.`);
  }
  return z
    .object({ adetler: z.object(sekil), tarih: z.string() })
    .superRefine((deger, ctx) => {
      const adetler = deger.adetler as Record<string, number>;
      const ayrilan = Object.values(adetler).reduce(
        (toplam, adet) => toplam + (Number(adet) || 0),
        0,
      );
      if (ayrilan <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["adetler"],
          message: "Sonraki teslimata ayrılacak en az bir kalem seç.",
        });
      } else if (ayrilan >= kutudaki) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["adetler"],
          message:
            "Kutuda hiç kalem kalmıyor: bu bölme değil, teslimatı tamamen ertelemek olur.",
        });
      }
    });
}

function SplitIcerik({
  items,
  isPending,
  onClose,
  onConfirm,
}: {
  items: PackageItem[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: (lines: PackageSplitLine[], promisedDate: string | null) => void;
}) {
  const form = useForm<Degerler>({
    resolver: zodResolver(splitSemasi(items)) as unknown as Resolver<Degerler>,
    defaultValues: {
      adetler: Object.fromEntries(items.map((s) => [String(s.order_item_id), 0])),
      tarih: "",
    },
    mode: "onChange",
    // Odağı hata dalında ELLE veriyoruz (A7d2 · C-1).
    shouldFocusError: false,
  });

  const bekci = useYuzeyKirliFormBekcisi({ form, sunucuHatasi: HATA_TAKIBI_YOK });

  const adetler = form.watch("adetler");
  const ayrilan = items.reduce(
    (toplam, satir) => toplam + Number(adetler?.[String(satir.order_item_id)] ?? 0),
    0,
  );
  const kutudaki = items.reduce((toplam, satir) => toplam + satir.expected_qty, 0);
  const kalan = kutudaki - ayrilan;

  const iptal = () => {
    if (isPending) return;
    bekci.kapatmayiDene(onClose);
  };

  const ilkAd = items.length > 0 ? `adetler.${items[0].order_item_id}` : "tarih";

  const gonder = form.handleSubmit(
    (deger) => {
      const lines = items
        .map((satir) => ({
          order_item_id: satir.order_item_id,
          quantity: Number(deger.adetler[String(satir.order_item_id)] ?? 0),
        }))
        .filter((satir) => satir.quantity > 0);
      onConfirm(lines, deger.tarih.trim() === "" ? null : deger.tarih);
    },
    () => form.setFocus(ilkAd as keyof Degerler),
  );

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {items.map((satir) => (
          <li key={satir.order_item_id} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900 ">{satir.title}</p>
              <p className="text-xs text-slate-500 ">
                Kutuda {satir.expected_qty} adet
                {satir.scanned_qty > 0 && (
                  <span className="text-slate-400"> · {satir.scanned_qty} okutuldu</span>
                )}
              </p>
            </div>
            <Form.Field
              control={form.control}
              name={`adetler.${satir.order_item_id}` as keyof Degerler}
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>
                    <span className="text-xs font-normal text-slate-500 ">Sonraya</span>
                  </Form.Label>
                  <Form.Control>
                    <input
                      type="number"
                      min={0}
                      max={satir.expected_qty}
                      disabled={isPending}
                      className="input w-20 text-right tabular-nums"
                      {...field}
                      value={String(field.value ?? 0)}
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm text-slate-600 ">
        {kalan <= 0
          ? "Kutuda hiç kalem kalmıyor."
          : `Bu kutuda ${kalan} adet gidecek, ${ayrilan} adet sonraki teslimata kalacak.`}
      </p>
      {/* Toplam kuralının (hiç seçilmedi / hepsi ayrıldı) hatası `adetler`
          kökünde durur; satır hataları kendi alanlarında çıkar. */}
      {form.formState.errors.adetler?.root?.message && (
        <p role="alert" className="mt-2 text-sm font-medium text-rose-600 ">
          {form.formState.errors.adetler.root.message}
        </p>
      )}

      <Form.Field
        control={form.control}
        name="tarih"
        render={({ field }) => (
          <Form.Item className="mt-4">
            <Form.Label>
              İkinci teslimat için tahmini tarih
              <span className="ml-1 font-normal text-slate-400">(isteğe bağlı)</span>
            </Form.Label>
            <Form.Control>
              <input type="date" disabled={isPending} className="input" {...field} />
            </Form.Control>
            {/* Tutturulamayan tarih şikâyet üretir; bilinmiyorsa boş bırakmak
                müşteriye "temin ediliyor" demektir ve bu dürüst cevaptır. */}
            <span className="mt-1 block text-xs text-slate-400">
              Tedarik tarihini bilmiyorsan boş bırak: müşteri &quot;temin ediliyor&quot;
              görür.
            </span>
          </Form.Item>
        )}
      />

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" disabled={isPending} onClick={iptal}>
          Vazgeç
        </Button>
        {/* Düğme geçerlilikle KAPANMAZ (kilitli karar): geçersizse gönderim
            yapılmaz, sebep alanda çıkar ve odak oraya taşınır. */}
        <Button variant="primary" isPending={isPending} onClick={gonder}>
          Sonraki teslimata ayır
        </Button>
      </div>
    </>
  );
}
