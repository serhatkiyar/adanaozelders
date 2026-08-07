// Hasar işlemi formu — dört işlemin ortak penceresi.
//
// Kullanıcı API'nin `kind` enum'unu bilmez: pencere dört FİİLDEN biriyle
// açılır. Etki (hangi raftan ne kadar düşer, hangi rafa ne kadar eklenir)
// onaydan ÖNCE rakamla yazılır.
//
// İdempotency anahtarı pencerenin açılışında üretilir ve **tek gönderim
// niyeti boyunca değişmez**; işlem başarıyla bitince yenilenir. Her render'da
// yenilenseydi ağ tekrarında sunucu iki ayrı iş görür ve stok iki kez düşerdi.
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, Dialog } from "@/components/admin/ui";
import { ProductPicker } from "@/components/admin/ProductPicker";
import {
  DAMAGE_KINDS,
  DAMAGE_REASON_OPTIONS,
  damageEffect,
  damageKindLabel,
  newIdempotencyKey,
  requiresDamageNote,
  validateDamageForm,
  type Bucket,
  type DamageKind,
  type DamageReason,
} from "@/lib/inventory";

import type { DamagePayload } from "@/api/inventory";
import type { ProductSearchOut } from "@/types";

export interface DamageDialogProps {
  kind: DamageKind | null;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: DamagePayload) => void;
}

const GONDER_ETIKET: Record<DamageKind, string> = {
  TRANSFER: "Hasara ayır",
  RECOVERY: "Satılabilir duruma döndür",
  DISPOSAL: "İmha et",
  SUPPLIER_RETURN: "Tedarikçiye iade et",
};

export function DamageDialog({ kind, isPending, error, onClose, onSubmit }: DamageDialogProps) {
  // Ham ID metni değil SEÇİLMİŞ ÜRÜN: ekranda adıyla görünen şeyle gövdeye
  // giden ID aynı kaynaktan okunur.
  const [secilenUrun, setSecilenUrun] = useState<ProductSearchOut | null>(null);
  const [miktar, setMiktar] = useState("");
  const [neden, setNeden] = useState<DamageReason | "">("");
  const [aciklama, setAciklama] = useState("");
  const [kova, setKova] = useState<Bucket | "">("");
  const [onaylandi, setOnaylandi] = useState(false);
  const anahtarRef = useRef<string>(newIdempotencyKey());
  const gonderildiRef = useRef(false);

  // Pencere her açıldığında form ve anahtar sıfırlanır.
  useEffect(() => {
    if (kind) {
      setSecilenUrun(null);
      setMiktar("");
      setNeden("");
      setAciklama("");
      setKova("");
      setOnaylandi(false);
      anahtarRef.current = newIdempotencyKey();
      gonderildiRef.current = false;
    }
  }, [kind]);

  const adet = Number(miktar);
  const etki = useMemo(
    () => (kind ? damageEffect(kind, adet, (kova || null) as Bucket | null) : null),
    [kind, adet, kova]
  );

  if (!kind) return null;

  const dogrulama = validateDamageForm({
    productId: secilenUrun?.id ?? null,
    kind,
    qty: Number.isInteger(adet) ? adet : NaN,
    reason: (neden || null) as DamageReason | null,
    note: aciklama,
    bucket: (kova || null) as Bucket | null,
    idempotencyKey: anahtarRef.current,
  });

  const geriAlinamaz = etki?.irreversible ?? false;
  // Ek onay kutusu YALNIZ imhada: mal tamamen yok edilir ve hiçbir rafa
  // dönmez. Tedarikçi iadesi de fiziksel çıkıştır ama karşılığında bir
  // muhatap vardır; orada kapı "kaynak kovanın açıkça seçilmesi"dir.
  const onayGerekli = kind === "DISPOSAL";
  const gonderilebilir = dogrulama.ok && (!onayGerekli || onaylandi);

  const gonder = () => {
    if (gonderildiRef.current || !dogrulama.payload) return;
    gonderildiRef.current = true;
    onSubmit(dogrulama.payload);
    // Kilit sunucu yanıtından SONRA açılır; hata hâlinde kullanıcı formu
    // düzeltip yeniden gönderebilsin diye burada bırakılır.
    window.setTimeout(() => {
      gonderildiRef.current = false;
    }, 0);
  };

  return (
    <Dialog
      open
      title={damageKindLabel(kind)}
      description={DAMAGE_KINDS.find((k) => k.value === kind)?.description}
      onClose={() => !isPending && onClose()}
    >
      <div className="space-y-4">
        {/* Ham ürün numarası yerine arama: hasar kaydı stoktan düşen ve geri
            alınamaz bir defter satırı üretir; yanlış numaraya yazılan bir
            hasar sessizce yanlış kitabı eksiltir. Seçilen ürün adıyla teyit
            edilebilmeli. */}
        <ProductPicker
          selected={secilenUrun ? [secilenUrun] : []}
          onChange={(secilenler) => setSecilenUrun(secilenler[0] ?? null)}
          multiple={false}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Miktar
            </span>
            <input
              className="input"
              type="number"
              min="1"
              step="1"
              value={miktar}
              onChange={(e) => setMiktar(e.target.value)}
            />
          </label>
        </div>

        {kind === "SUPPLIER_RETURN" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Kaynak kova
            </span>
            <select className="input" value={kova} onChange={(e) => setKova(e.target.value as Bucket)}>
              <option value="">Seçin…</option>
              <option value="SALEABLE">Satılabilir</option>
              <option value="DAMAGED">Hasarlı</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Adet yalnız seçtiğiniz raftan düşer; diğer rafa aktarılmaz.
            </span>
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Neden
          </span>
          <select
            className="input"
            value={neden}
            onChange={(e) => setNeden(e.target.value as DamageReason)}
          >
            <option value="">Seçin…</option>
            {DAMAGE_REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {requiresDamageNote((neden || null) as DamageReason | null) && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Açıklama
            </span>
            <input
              className="input"
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              placeholder="Ne olduğunu kısaca yazın"
            />
          </label>
        )}

        <p
          data-testid="damage-effect"
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
        >
          {etki?.text}
        </p>

        {onayGerekli && (
          <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={onaylandi}
              onChange={(e) => setOnaylandi(e.target.checked)}
            />
            <span>
              Bu işlem <strong>geri alınamaz</strong>: mal fiziksel olarak çıkar ve stoğa
              kendiliğinden dönmez. Onaylıyorum.
            </span>
          </label>
        )}

        {geriAlinamaz && !onayGerekli && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Bu işlem geri alınamaz: mal fiziksel olarak çıkar.
          </p>
        )}

        {!dogrulama.ok && dogrulama.error && (secilenUrun || miktar || neden) && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{dogrulama.error}</p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={isPending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant={geriAlinamaz ? "danger" : "primary"}
            disabled={!gonderilebilir}
            isPending={isPending}
            onClick={gonder}
          >
            {GONDER_ETIKET[kind]}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
