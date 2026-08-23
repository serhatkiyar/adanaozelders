import { useEffect, useState, type FormEvent } from "react";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import {
  useAdminStoreHeroSlides,
  useClearStoreHeroMobileImage,
  useCreateStoreHeroSlide,
  useDeleteStoreHeroSlide,
  useReorderStoreHeroSlides,
  useReplaceStoreHeroSlideImage,
  useUpdateStoreHeroSlide,
} from "@/hooks/useStoreHero";
import { getErrorDetail } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { StoreHeroSlide, StoreHeroSlideUpdate } from "@/types";
import { StoreShowcaseManager } from "@/components/admin/store/StoreShowcaseManager";
import { StoreHomeLayoutManager } from "@/components/admin/store/StoreHomeLayoutManager";

const ACCEPTED_IMAGES = "image/jpeg,image/png,image/webp";

function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export default function AdminAnnouncementsPage() {
  const { canView, canManage } = useAdminAreaAccess("announcements");
  const { data: slides = [], isLoading, isError, error, refetch } = useAdminStoreHeroSlides();
  const reorder = useReorderStoreHeroSlides();
  const [showCreate, setShowCreate] = useState(false);

  if (!canView) return <AccessDenied area="Vitrin görselleri" />;
  if (isError) {
    return <ErrorState description={getErrorDetail(error, "Vitrin görselleri yüklenemedi.")} onRetry={() => void refetch()} />;
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= slides.length) return;
    const ids = slides.map((slide) => slide.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids, {
      onSuccess: () => toast.success("Görsel sırası güncellendi"),
      onError: (err) => toast.error(getErrorDetail(err, "Sıralama güncellenemedi")),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel-fg text-xs font-bold text-panel-card">1</span>
            <p className="text-sm font-semibold text-panel-fg">Üstte kayan büyük görseller</p>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-panel-fg-muted">
            Masaüstü görselini yükleyin; isterseniz telefonlar için ayrıca dikey bir görsel ekleyin.
            Metin görselin üzerinde hazırlanır, sistem ayrıca yazı basmaz.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? "Formu kapat" : "Yeni görsel yükle"}
          </Button>
        )}
      </div>

      {!canManage && <ReadOnlyNotice />}
      {canManage && showCreate && <CreateSlideForm onDone={() => setShowCreate(false)} />}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-label="Vitrin görselleri yükleniyor">
          {[0, 1].map((item) => <div key={item} className="h-80 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}
        </div>
      ) : slides.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-panel-border px-6 py-14 text-center">
          <p className="font-semibold text-panel-fg">Henüz vitrin görseli yok</p>
          <p className="mt-1 text-sm text-panel-fg-muted">İlk görseli yüklediğinizde mağazanın en üstünde görünür.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {slides.map((slide, index) => (
            <SlideCard
              key={slide.id}
              slide={slide}
              canManage={canManage}
              first={index === 0}
              last={index === slides.length - 1}
              reordering={reorder.isPending}
              onMove={(direction) => move(index, direction)}
            />
          ))}
        </div>
      )}
      <StoreShowcaseManager canManage={canManage} />
      <StoreHomeLayoutManager canManage={canManage} />
    </div>
  );
}

function CreateSlideForm({ onDone }: { onDone: () => void }) {
  const create = useCreateStoreHeroSlide();
  const [desktop, setDesktop] = useState<File | null>(null);
  const [mobile, setMobile] = useState<File | null>(null);
  const [active, setActive] = useState(true);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!desktop) {
      toast.error("Masaüstü görselini seçin");
      return;
    }
    const startsAt = String(form.get("starts_at") ?? "");
    const endsAt = String(form.get("ends_at") ?? "");
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      toast.error("Bitiş tarihi başlangıçtan sonra olmalı");
      return;
    }
    create.mutate({
      image: desktop,
      mobileImage: mobile,
      altText: String(form.get("alt_text") ?? "").trim(),
      linkUrl: String(form.get("link_url") ?? "").trim() || null,
      isActive: active,
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
      sortOrder: Number(form.get("sort_order") || 0),
    }, {
      onSuccess: () => {
        toast.success("Vitrin görseli eklendi");
        onDone();
      },
      onError: (err) => toast.error(getErrorDetail(err, "Görsel yüklenemedi")),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-panel-border bg-panel-card p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FileField label="Masaüstü görseli" required file={desktop} onChange={setDesktop} />
        <FileField label="Mobil görsel (isteğe bağlı)" file={mobile} onChange={setMobile} />
      </div>
      <p className="text-xs text-panel-fg-subtle">Öneri: masaüstü 1920×700, mobil 900×1100; JPG, PNG veya WebP, en fazla 12 MB.</p>
      <MetadataFields active={active} onActiveChange={setActive} />
      <div className="flex justify-end"><Button type="submit" isPending={create.isPending}>Görseli yükle</Button></div>
    </form>
  );
}

function MetadataFields({ slide, active, onActiveChange, disabled = false }: {
  slide?: StoreHeroSlide;
  active: boolean;
  onActiveChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-panel-fg">
          <span>Görsel açıklaması <span className="font-normal text-panel-fg-subtle">(erişilebilirlik)</span></span>
          <input name="alt_text" defaultValue={slide?.alt_text ?? ""} maxLength={180} disabled={disabled} className="input w-full" placeholder="Örn. Okula dönüş kampanyası" />
        </label>
        <label className="space-y-1 text-sm font-medium text-panel-fg">
          <span>Tıklanınca gidilecek adres <span className="font-normal text-panel-fg-subtle">(isteğe bağlı)</span></span>
          <input name="link_url" defaultValue={slide?.link_url ?? ""} disabled={disabled} className="input w-full" placeholder="/magaza?category=3 veya https://…" />
        </label>
        <label className="space-y-1 text-sm font-medium text-panel-fg">
          <span>Başlangıç <span className="font-normal text-panel-fg-subtle">(isteğe bağlı)</span></span>
          <input name="starts_at" type="datetime-local" defaultValue={isoToLocalInput(slide?.starts_at ?? null)} disabled={disabled} className="input w-full" />
        </label>
        <label className="space-y-1 text-sm font-medium text-panel-fg">
          <span>Bitiş <span className="font-normal text-panel-fg-subtle">(isteğe bağlı)</span></span>
          <input name="ends_at" type="datetime-local" defaultValue={isoToLocalInput(slide?.ends_at ?? null)} disabled={disabled} className="input w-full" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-5">
        <label className="flex items-center gap-2 text-sm font-medium text-panel-fg">
          <input type="checkbox" checked={active} onChange={(event) => onActiveChange(event.target.checked)} disabled={disabled} className="h-4 w-4 rounded border-slate-300" />
          Mağazada göster
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-panel-fg">
          <span>Sıra</span>
          <input name="sort_order" type="number" min={0} defaultValue={slide?.sort_order ?? 0} disabled={disabled} className="input w-24" />
        </label>
      </div>
    </>
  );
}

function SlideCard({ slide, canManage, first, last, reordering, onMove }: {
  slide: StoreHeroSlide;
  canManage: boolean;
  first: boolean;
  last: boolean;
  reordering: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const update = useUpdateStoreHeroSlide();
  const replace = useReplaceStoreHeroSlideImage();
  const clearMobile = useClearStoreHeroMobileImage();
  const remove = useDeleteStoreHeroSlide();
  const [active, setActive] = useState(slide.is_active);
  const deleteDialog = useDuzenlemeYuzeyi<StoreHeroSlide, void>();

  useEffect(() => setActive(slide.is_active), [slide.is_active]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startsAt = String(form.get("starts_at") ?? "");
    const endsAt = String(form.get("ends_at") ?? "");
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      toast.error("Bitiş tarihi başlangıçtan sonra olmalı");
      return;
    }
    const payload: StoreHeroSlideUpdate = {
      alt_text: String(form.get("alt_text") ?? "").trim(),
      link_url: String(form.get("link_url") ?? "").trim() || null,
      starts_at: localInputToIso(startsAt),
      ends_at: localInputToIso(endsAt),
      sort_order: Number(form.get("sort_order") || 0),
      is_active: active,
    };
    update.mutate({ id: slide.id, payload }, {
      onSuccess: () => toast.success("Vitrin görseli güncellendi"),
      onError: (err) => toast.error(getErrorDetail(err, "Görsel güncellenemedi")),
    });
  };

  const uploadReplacement = (slot: "desktop" | "mobile", file: File | undefined) => {
    if (!file) return;
    replace.mutate({ id: slide.id, slot, file }, {
      onSuccess: () => toast.success(slot === "desktop" ? "Masaüstü görseli değiştirildi" : "Mobil görsel değiştirildi"),
      onError: (err) => toast.error(getErrorDetail(err, "Görsel değiştirilemedi")),
    });
  };

  return (
    <article className="overflow-hidden rounded-2xl border border-panel-border bg-panel-card">
      <div className="relative aspect-[16/6] bg-slate-100 dark:bg-slate-900">
        <picture>
          {slide.mobile_image_url && <source media="(max-width: 767px)" srcSet={slide.mobile_image_url} />}
          <img src={slide.image_url} alt={slide.alt_text} className="h-full w-full object-cover" />
        </picture>
        <div className="absolute left-3 top-3 flex gap-2">
          <Badge tone={slide.is_active ? "success" : "neutral"}>{slide.is_active ? "Aktif" : "Pasif"}</Badge>
          {slide.mobile_image_url && <Badge tone="info">Mobil görsel var</Badge>}
        </div>
      </div>
      <form onSubmit={save} className="space-y-4 p-4">
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <UploadButton label="Masaüstünü değiştir" onFile={(file) => uploadReplacement("desktop", file)} />
            <UploadButton label="Mobil görsel yükle" onFile={(file) => uploadReplacement("mobile", file)} />
            {slide.mobile_image_url && (
              <Button variant="ghost" size="sm" isPending={clearMobile.isPending} onClick={() => clearMobile.mutate(slide.id, {
                onSuccess: () => toast.success("Mobil görsel kaldırıldı"),
                onError: (err) => toast.error(getErrorDetail(err, "Mobil görsel kaldırılamadı")),
              })}>Mobil görseli kaldır</Button>
            )}
          </div>
        )}
        <MetadataFields slide={slide} active={active} onActiveChange={setActive} disabled={!canManage} />
        {canManage && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-panel-border pt-3">
            <div className="flex gap-2">
              {!first && <Button size="sm" variant="secondary" isPending={reordering} onClick={() => onMove(-1)}>Yukarı</Button>}
              {!last && <Button size="sm" variant="secondary" isPending={reordering} onClick={() => onMove(1)}>Aşağı</Button>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => deleteDialog.ac(slide)}>Sil</Button>
              <Button size="sm" type="submit" isPending={update.isPending}>Kaydet</Button>
            </div>
          </div>
        )}
      </form>
      <ConfirmDialog
        open={deleteDialog.acik}
        title="Vitrin görselini sil"
        description="Bu görsel mağazadan kaldırılacak. İşlem geri alınamaz."
        confirmLabel="Görseli sil"
        danger
        isPending={remove.isPending}
        onClose={deleteDialog.kapat}
        onConfirm={() => remove.mutate(slide.id, {
          onSuccess: () => { toast.success("Vitrin görseli silindi"); deleteDialog.kapat(); },
          onError: (err) => toast.error(getErrorDetail(err, "Görsel silinemedi")),
        })}
      />
    </article>
  );
}

function FileField({ label, required = false, file, onChange }: {
  label: string;
  required?: boolean;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="block rounded-xl border border-dashed border-panel-border p-4 text-sm text-panel-fg">
      <span className="font-semibold">{label}</span>
      <input
        type="file"
        accept={ACCEPTED_IMAGES}
        required={required}
        className="mt-3 block w-full text-xs text-panel-fg-muted file:mr-3 file:rounded-lg file:border-0 file:bg-panel-accent file:px-3 file:py-2 file:font-semibold file:text-panel-accent-fg"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {file && <span className="mt-2 block truncate text-xs text-panel-fg-muted">{file.name}</span>}
    </label>
  );
}

function UploadButton({ label, onFile }: { label: string; onFile: (file: File | undefined) => void }) {
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
      {label}
      <input type="file" accept={ACCEPTED_IMAGES} className="sr-only" onChange={(event) => onFile(event.target.files?.[0])} />
    </label>
  );
}
