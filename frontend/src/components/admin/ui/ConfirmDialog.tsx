import { useEffect, useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

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
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const trimmed = reason.trim();
  // `maxLength` attribute'u yazmayı keser ama yapıştırma/otomasyon yollarında
  // tek başına güvenilmez; sınır burada da uygulanır. Ölçüm HAM uzunluktadır:
  // sunucu da alanı kırpmadan doğrular.
  const asildi = reason.length > maxLength;

  return (
    <Dialog open={open} title={title} description={description} onClose={() => !isPending && onClose()}>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <textarea
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={maxLength}
          minLength={minLength}
          rows={4}
          placeholder={placeholder}
          className="input min-h-24 resize-y"
        />
        <span
          className={`mt-1 block text-right text-xs ${asildi ? "font-semibold text-rose-600 dark:text-rose-400" : "text-slate-400"}`}
        >
          {reason.length}/{maxLength}
        </span>
        {asildi && (
          <span role="alert" className="mt-1 block text-xs font-semibold text-rose-600 dark:text-rose-400">
            En fazla {maxLength} karakter yazılabilir; {reason.length - maxLength} karakter fazla.
          </span>
        )}
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" disabled={isPending} onClick={onClose}>{cancelLabel}</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={trimmed.length < minLength || asildi} isPending={isPending} onClick={() => onConfirm(trimmed)}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
