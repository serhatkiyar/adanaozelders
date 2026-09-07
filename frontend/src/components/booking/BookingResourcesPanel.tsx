import { useRef, useState } from "react";
import {
  useAddBookingResource,
  useDeleteBookingResource,
  useUploadBookingResource,
} from "@/hooks/useBookings";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { BookingResourceOut } from "@/types";

type Role = "TUTOR" | "CLIENT" | null;

function formatSize(bytes?: number | null): string | null {
  if (bytes == null || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

interface Props {
  bookingId: number;
  resources: BookingResourceOut[];
  role: Role;
  userId?: number;
  /** Pending/Accepted ders ise ekleme/silme açık. */
  canEdit: boolean;
  /** Başlık göster (varsayılan true). */
  showHeading?: boolean;
}

export function BookingResourcesPanel({
  bookingId,
  resources,
  role,
  userId,
  canEdit,
  showHeading = true,
}: Props) {
  const [resTitle, setResTitle] = useState("");
  const [resUrl, setResUrl] = useState("");
  const [showAddResource, setShowAddResource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addRes = useAddBookingResource();
  const delRes = useDeleteBookingResource();
  const uploadRes = useUploadBookingResource();

  const handleAddResource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resTitle.trim() || !resUrl.trim()) return;
    addRes.mutate(
      { id: bookingId, title: resTitle.trim(), url: resUrl.trim() },
      {
        onSuccess: () => {
          toast.success("Kaynak eklendi.");
          setResTitle("");
          setResUrl("");
          setShowAddResource(false);
        },
        onError: (err) => toast.error(getErrorMessage(err, "Kaynak eklenemedi.")),
      }
    );
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // aynı dosya tekrar seçilebilsin
    if (!file) return;
    uploadRes.mutate(
      { id: bookingId, file },
      {
        onSuccess: () => toast.success("Dosya yüklendi."),
        onError: (err) => toast.error(getErrorMessage(err, "Dosya yüklenemedi.")),
      }
    );
  };

  return (
    <div>
      {showHeading && (
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 ">
          Ders Kaynakları
        </h2>
      )}
      <div className={showHeading ? "mt-4 space-y-3" : "space-y-3"}>
        {resources && resources.length > 0 ? (
          resources.map((res) => {
            const canDelete = res.uploader_id === userId && res.uploader_role === role;
            const isFile = res.kind === "file";
            const size = formatSize(res.size_bytes);
            return (
              <div
                key={res.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 "
              >
                <div className="flex min-w-0 items-center gap-2.5 pr-3">
                  <span className="shrink-0 text-base" aria-hidden>
                    {isFile ? "📎" : "🔗"}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <a
                      href={res.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-semibold text-marka-metin hover:underline "
                    >
                      {res.title}
                    </a>
                    <span className="truncate text-xs text-slate-400 ">
                      {isFile
                        ? [res.file_name, size].filter(Boolean).join(" · ")
                        : res.url}
                    </span>
                  </div>
                </div>
                {canDelete && (
                  <button
                    disabled={delRes.isPending}
                    onClick={() => delRes.mutate({ id: bookingId, resourceId: res.id })}
                    className="shrink-0 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Sil
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-slate-500 ">
            Henüz kaynak eklenmemiş.
          </p>
        )}

        {/* Ekleme aksiyonları */}
        {canEdit && !showAddResource && (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row">
            <button
              onClick={() => setShowAddResource(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-marka-mid hover:bg-marka-soft hover:text-marka-soft-fg "
            >
              <span aria-hidden>🔗</span> Link Ekle
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadRes.isPending}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-marka-mid hover:bg-marka-soft hover:text-marka-soft-fg disabled:opacity-60 "
            >
              <span aria-hidden>📎</span>
              {uploadRes.isPending ? "Yükleniyor…" : "Dosya Yükle"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFilePicked}
            />
          </div>
        )}

        {canEdit && showAddResource && (
          <form
            onSubmit={handleAddResource}
            className="flex flex-col gap-3 border-t border-slate-100 pt-4 "
          >
            <input
              type="text"
              placeholder="Başlık giriniz"
              value={resTitle}
              onChange={(e) => setResTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-marka-mid focus:ring-1 focus:ring-marka-focus "
            />
            <input
              type="url"
              placeholder="Kaynak Linki (https://…)"
              value={resUrl}
              onChange={(e) => setResUrl(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-marka-mid focus:ring-1 focus:ring-marka-focus "
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddResource(false);
                  setResTitle("");
                  setResUrl("");
                }}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 "
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={addRes.isPending || !resTitle.trim() || !resUrl.trim()}
                className="rounded-xl bg-marka px-5 py-2 text-sm font-semibold text-marka-fg transition hover:bg-marka-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Kaydet
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
