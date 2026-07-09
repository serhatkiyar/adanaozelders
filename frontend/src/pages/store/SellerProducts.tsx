import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DashboardShell } from "@/components/DashboardShell";
import { TUTOR_NAV } from "@/lib/nav";
import { Seo } from "@/components/Seo";
import { formatTL } from "@/lib/money";
import {
  createSellerProduct,
  deleteSellerProduct,
  updateSellerProduct,
  uploadSellerAsset,
  uploadSellerCover,
} from "@/api/store";
import {
  useSellerProducts,
  useSellerEarnings,
  useInvalidateSellerStore,
} from "@/hooks/useStore";
import { toast } from "@/store/toastStore";
import type { ProductSearchOut, SellerProductStat } from "@/types";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Onay bekliyor",
  ACTIVE: "Yayında",
  HIDDEN: "Gizli",
  DRAFT: "Taslak",
};

export default function SellerProducts() {
  const { data: products, isLoading } = useSellerProducts();
  const { data: earnings } = useSellerEarnings();
  const invalidate = useInvalidateSellerStore();
  const [showForm, setShowForm] = useState(false);

  const statByProduct = new Map<number, SellerProductStat>();
  for (const s of earnings?.products ?? []) {
    if (s.product_id != null) statByProduct.set(s.product_id, s);
  }

  return (
    <DashboardShell title="Dijital Ürünlerim" navItems={TUTOR_NAV}>
      <Seo title="Dijital Ürünlerim" noindex />
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
              Dijital Ürünlerim
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Ders notu, PDF ve çözüm paketlerini mağazada sat. Ürünler admin
              onayından sonra yayına girer.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
          >
            {showForm ? "Kapat" : "Yeni ürün"}
          </button>
        </div>

        {showForm && (
          <NewProductForm
            onDone={() => {
              setShowForm(false);
              invalidate();
            }}
          />
        )}

        {earnings && earnings.total_units > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <EarningStat label="Net kazanç" value={formatTL(earnings.total_earnings)} accent />
            <EarningStat label="Ciro" value={formatTL(earnings.total_gross)} />
            <EarningStat label="Satılan adet" value={String(earnings.total_units)} />
            <EarningStat label="Sipariş" value={String(earnings.total_orders)} />
          </div>
        )}

        <div className="mt-6 space-y-3">
          {isLoading ? (
            <p className="text-sm text-slate-400">Yükleniyor…</p>
          ) : products && products.length > 0 ? (
            products.map((p) => (
              <SellerRow key={p.id} product={p} stat={statByProduct.get(p.id)} onChange={invalidate} />
            ))
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">
              Henüz ürünün yok.
            </p>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}

function EarningStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ? "text-indigo-600 dark:text-indigo-400" : "text-slate-900 dark:text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function NewProductForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createSellerProduct({
        title,
        description: description || null,
        price,
      }),
    onSuccess: () => {
      toast.success("Ürün oluşturuldu. Kapak + dosya yükleyip yayına gönder.");
      onDone();
    },
    onError: () => toast.error("Ürün oluşturulamadı"),
  });

  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Ürün adı"
        className="input"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Açıklama"
        rows={3}
        className="input mt-3"
      />
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Fiyat (TL)"
        inputMode="decimal"
        className="input mt-3"
      />
      <button
        type="button"
        disabled={create.isPending || !title || !price}
        onClick={() => create.mutate()}
        className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        Oluştur
      </button>
    </div>
  );
}

function SellerRow({
  product,
  stat,
  onChange,
}: {
  product: ProductSearchOut;
  stat?: SellerProductStat;
  onChange: () => void;
}) {
  const cover = useMutation({
    mutationFn: (file: File) => uploadSellerCover(product.id, file),
    onSuccess: () => {
      toast.success("Kapak yüklendi");
      onChange();
    },
  });
  const asset = useMutation({
    mutationFn: (file: File) => uploadSellerAsset(product.id, file),
    onSuccess: () => {
      toast.success("Dosya yüklendi");
      onChange();
    },
    onError: () => toast.error("Dosya yüklenemedi"),
  });
  const submit = useMutation({
    mutationFn: () => updateSellerProduct(product.id, { status: "PENDING" }),
    onSuccess: () => {
      toast.success("Onaya gönderildi");
      onChange();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteSellerProduct(product.id),
    onSuccess: () => {
      toast.success("Ürün silindi");
      onChange();
    },
  });

  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-100 p-3 dark:border-slate-800">
      <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
        {product.cover_url && (
          <img src={product.cover_url} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
          {product.title}
        </p>
        <p className="text-sm text-slate-500">{formatTL(product.price)}</p>
        <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800">
          {STATUS_LABEL[product.status ?? ""] ?? product.status}
        </span>
        {stat && stat.units_sold > 0 && (
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {stat.units_sold} adet satıldı ·{" "}
            <span className="font-medium text-indigo-600 dark:text-indigo-400">
              {formatTL(stat.earnings)}
            </span>{" "}
            kazanç
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 text-xs">
        <label className="cursor-pointer font-medium text-slate-600 hover:underline dark:text-slate-300">
          Kapak
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && cover.mutate(e.target.files[0])}
          />
        </label>
        <label className="cursor-pointer font-medium text-slate-600 hover:underline dark:text-slate-300">
          Dosya
          <input
            type="file"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && asset.mutate(e.target.files[0])}
          />
        </label>
        <button
          type="button"
          onClick={() => submit.mutate()}
          className="font-medium text-emerald-600 hover:underline"
        >
          Onaya gönder
        </button>
        <button
          type="button"
          onClick={() => remove.mutate()}
          className="font-medium text-rose-500 hover:underline"
        >
          Sil
        </button>
      </div>
    </div>
  );
}
