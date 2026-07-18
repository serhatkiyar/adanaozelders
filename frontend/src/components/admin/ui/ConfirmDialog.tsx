import { useEffect, useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
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
  danger = false,
  isPending = false,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} title={title} description={description} onClose={() => !isPending && onClose()}>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={isPending} onClick={onClose}>Vazgeç</Button>
        <Button variant={danger ? "danger" : "primary"} isPending={isPending} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

interface ReasonDialogProps extends Omit<ConfirmDialogProps, "onConfirm"> {
  label: string;
  placeholder?: string;
  required?: boolean;
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
        <span className="mt-1 block text-right text-xs text-slate-400">{reason.length}/{maxLength}</span>
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" disabled={isPending} onClick={onClose}>Vazgeç</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={trimmed.length < minLength} isPending={isPending} onClick={() => onConfirm(trimmed)}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
