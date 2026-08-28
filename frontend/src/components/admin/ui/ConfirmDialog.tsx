import { useCallback, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import {
  DuzenlemePenceresi,
  HATA_TAKIBI_YOK,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiKapisi,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form } from "@/components/admin/ui2/form";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  /**
   * İptal düğmesinin adı.
   *
   * Çağrı noktasından ayarlanabilir olması bir erişilebilirlik düzeltmesidir:
   * "Paketten vazgeç" penceresinde onay düğmesinin adı da "Vazgeç"ti ve ekranda
   * **aynı erişilebilir ada sahip iki düğme** oluyordu — ekran okuyucu
   * kullanıcısı hangisinin işlemi yaptığını ayırt edemez, klavye/otomasyon
   * seçimi belirsizleşir. Varsayılan bilinçli olarak korunur: mevcut çağrı
   * noktalarının hiçbiri değişmesin.
   */
  cancelLabel?: string;
  danger?: boolean;
  isPending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Onayla",
  cancelLabel = "Vazgeç",
  danger = false,
  isPending = false,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  // `ConfirmDialog`ta yazılan bir şey YOKTUR: kirli form bekçisi burada
  // gerekmez ve eklenmesi anlamsız bir soru üretirdi. Ayrımı bilerek yazıyoruz
  // çünkü kardeşi `ReasonDialog`ta durum tam tersidir (aşağıya bak).
  return (
    <Dialog open={open} title={title} description={description} onClose={() => !isPending && onClose()}>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={isPending} onClick={onClose}>{cancelLabel}</Button>
        <Button variant={danger ? "danger" : "primary"} isPending={isPending} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

interface ReasonDialogProps extends Omit<ConfirmDialogProps, "onConfirm"> {
  label: string;
  placeholder?: string;
  required?: boolean;
  /**
   * Sunucudaki gerçek üst sınır. Varsayılan 2000 yalnız eski çağrı noktalarını
   * korumak içindir; **yeni çağrı noktaları backend sabitini geçirmelidir**
   * (`schemas/packing.py`: `REASON_MAX=200`, `NOTE_MAX=500`). Sayaç bu değeri
   * gösterir ve sınır aşılırsa gönderim ENGELLENİR — 422'yi kullanıcıya
   * yazdırmak, yazdığı metni kaybettikten sonra öğretmek demektir.
   */
  maxLength?: number;
  minLength?: number;
  onConfirm: (reason: string) => void;
}

/**
 * Gerekçe penceresi — İP-A7d3'te ortak sözleşmeye bağlandı (SK-7 + SK-8).
 *
 * ## Neden değişti
 *
 * Bu bileşen kendi `Dialog`ını kuruyordu ve içinde 2000 karaktere kadar metin
 * alan bir `textarea` taşıyordu ama `useYuzeyKirliFormBekcisi`yi **hiç
 * çağırmıyordu**. Yani ×/ESC/dış tıklama, yazılan gerekçeyi sormadan siliyordu.
 * A7d2'nin `ProductForm`da bulduğu SK-4 sınıfının aynısı — farkı, buranın
 * ORTAK KATMAN olması: kusur tek ekranda değil, **on üç çağrı yerinde** birden
 * canlıydı ve hepsi geri alınamaz kararların gerekçe alanıydı (sipariş iptali,
 * iade reddi, eğitmen reddi, sayım oturumu iptali, paketten vazgeçme).
 *
 * İkinci kusur da aynı bileşendeydi: onay düğmesi geçerlilikle kapanıyordu
 * (`disabled={trimmed.length < minLength || asildi}`). Kilitli karar açık:
 * gönder düğmesi geçerlilikle KAPANMAZ; geçersizse gönderim yapılmaz, hata
 * ALANDA çıkar, odak alana taşınır. Kullanıcı düğmeye basamadığında sebebini
 * göremiyordu.
 *
 * ## Yazım
 *
 * `open`/`onClose` sözleşmesi KORUNDU: on üç çağrı yerinin hiçbiri
 * değişmesin diye pencerenin ihtiyaç duyduğu `DuzenlemeYuzeyiKapisi` burada
 * türetiliyor. İçerik ayrı bir bileşendir (`GerekceIcerik`) çünkü bekçi
 * pencerenin İÇİNDE çağrılmalıdır (SK-3).
 *
 * İçerik yalnız pencere açıkken mount edilir (`Dialog` kapalıyken `null`
 * döner), dolayısıyla eski `useEffect(() => setReason(""))` sıfırlamasına
 * gerek kalmadı: yeniden açılan pencere yeni bir form kurar.
 */
export function ReasonDialog({
  open,
  title,
  description,
  label,
  placeholder,
  required = false,
  maxLength = 2000,
  minLength = required ? 1 : 0,
  confirmLabel = "Kaydet",
  cancelLabel = "Vazgeç",
  danger = false,
  isPending = false,
  onClose,
  onConfirm,
}: ReasonDialogProps) {
  // İşlem sürerken kapatma yolu kapalı: yarıda kesilen bir gönderimde
  // kullanıcı sonucu göremez (`DuzenlemeYuzeyi.islemSuruyor` ile aynı kural).
  const kapat = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);

  const yuzey = useMemo<DuzenlemeYuzeyiKapisi>(
    // `hedef` bekçinin damgasıdır: onay beklerken pencere başka bir kayda
    // geçerse onay ESKİ kayda uygulanmaz (İP-A6c · BULGU-8). Gerekçe
    // penceresinde hedefin gözlenebilir kimliği başlıktır.
    () => ({ acik: open, kapat, hedef: title }),
    [open, kapat, title]
  );

  return (
    <DuzenlemePenceresi yuzey={yuzey} baslik={title} aciklama={description}>
      <GerekceIcerik
        label={label}
        placeholder={placeholder}
        maxLength={maxLength}
        minLength={minLength}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        danger={danger}
        isPending={isPending}
        onClose={kapat}
        onConfirm={onConfirm}
      />
    </DuzenlemePenceresi>
  );
}

/** Şema çağrı yerine bağlıdır: alt/üst sınır çağıran taraftan gelir. */
function gerekceSemasi(minLength: number, maxLength: number) {
  return z.object({
    reason: z
      .string()
      .refine(
        (v) => v.trim().length >= minLength,
        minLength <= 1
          ? "Gerekçe yazılması gerekiyor."
          : `Gerekçe en az ${minLength} karakter olmalı.`
      )
      // Ölçüm HAM uzunluktadır: sunucu da alanı kırpmadan doğrular.
      .refine(
        (v) => v.length <= maxLength,
        `En fazla ${maxLength} karakter yazılabilir.`
      ),
  });
}

type GerekceDegerleri = { reason: string };

function GerekceIcerik({
  label,
  placeholder,
  maxLength,
  minLength,
  confirmLabel,
  cancelLabel,
  danger,
  isPending,
  onClose,
  onConfirm,
}: {
  label: string;
  placeholder?: string;
  maxLength: number;
  minLength: number;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const form = useForm<GerekceDegerleri>({
    resolver: zodResolver(gerekceSemasi(minLength, maxLength)),
    defaultValues: { reason: "" },
    mode: "onChange",
    // Odağı `handleSubmit`in hata dalında ELLE veriyoruz; `shouldFocusError`
    // gönderim anındaki anlık görüntüye bakar ve satır içi formlarda `<body>`ye
    // düşürüyordu (İP-A7d2 · C-1).
    shouldFocusError: false,
  });

  const bekci = useYuzeyKirliFormBekcisi({ form, sunucuHatasi: HATA_TAKIBI_YOK });

  const uzunluk = form.watch("reason").length;
  const asildi = uzunluk > maxLength;

  const iptal = () => {
    if (isPending) return;
    bekci.kapatmayiDene(onClose);
  };

  const gonder = form.handleSubmit(
    (deger) => onConfirm(deger.reason.trim()),
    () => form.setFocus("reason")
  );

  return (
    <>
      <Form.Field
        control={form.control}
        name="reason"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>{label}</Form.Label>
            <Form.Control>
              <textarea
                autoFocus
                rows={4}
                maxLength={maxLength}
                placeholder={placeholder}
                className="input min-h-24 resize-y"
                {...field}
              />
            </Form.Control>
            {/* Sayaç `Form.Label`ın DIŞINDA: eskiden sarmalayıcı `<label>`ın
                içindeydi ve alanın erişilebilir adına karışıyordu — ekran
                okuyucu alanı "İptal gerekçesi 0/2000" diye okuyordu. */}
            <span
              className={`mt-1 block text-right text-xs ${asildi ? "font-semibold text-rose-600 " : "text-slate-400"}`}
            >
              {uzunluk}/{maxLength}
            </span>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" disabled={isPending} onClick={iptal}>{cancelLabel}</Button>
        {/* Düğme geçerlilikle KAPANMAZ (kilitli karar). Geçersizse gönderim
            yapılmaz, hata alanda çıkar ve odak oraya taşınır. */}
        <Button variant={danger ? "danger" : "primary"} isPending={isPending} onClick={gonder}>{confirmLabel}</Button>
      </div>
    </>
  );
}
