/**
 * Duyuru şeridi (İP-C2) — panel CRUD.
 *
 * İP-B1/B2 liste anatomisine uyar: `DataTable` + `SatirAksiyonlari` (Ç-2 —
 * satır başına en fazla 2 açık düğme, silme menüde + onay diyaloğu).
 * `ListeAracCubugu` BİLEREK yok — kayıt sayısı küçük (admin küratörlüğünde
 * bir avuç duyuru), arama/filtre/sunucu sıralaması gerekmiyor.
 *
 * Ç-3 paletine sadık: `#1A365D` (bilgi) / `#F6AD55` (dikkat) rozetleri —
 * `ProductForm.tsx`'in indigo süpürgesine düşülmedi, yalnız `ui2/` üzerinden.
 */
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Badge, Button, ErrorState } from "@/components/admin/ui";
import { DataTable } from "@/components/admin/data-table";
import { PanelBaslikAksiyonu } from "@/components/admin/layout/baslikAksiyonu";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import { DuzenlemeYuzeyi, HATA_TAKIBI_YOK } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import {
  KayitYokDurumu,
  SatirAksiyonlari,
  type SatirAksiyonu,
} from "@/components/admin/ui2/liste";
import {
  useCreateDuyuruSeridi,
  useDeleteDuyuruSeridi,
  useDuyuruSeridiList,
  useUpdateDuyuruSeridi,
} from "@/hooks/useDuyuru";
import { getErrorDetail } from "@/lib/errors";
import { formatDateTime } from "@/lib/datetime";
import { toast } from "@/store/toastStore";
import type { DuyuruSeridiOut, DuyuruVaryant } from "@/types";

/** ISO → `datetime-local` girdi değeri (yerel saat). */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIsoOrNull(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

const duyuruSemasi = z
  .object({
    metin: z.string().trim().min(1, "Metin zorunlu.").max(160, "En fazla 160 karakter."),
    linkUrl: z.string().trim().max(2000, "En fazla 2000 karakter."),
    linkMetni: z.string().trim().max(40, "En fazla 40 karakter."),
    varyant: z.enum(["bilgi", "dikkat"]),
    aktif: z.boolean(),
    baslangic: z.string(),
    bitis: z.string(),
    sira: z
      .string()
      .trim()
      .refine((v) => v === "" || Number.isInteger(Number(v)), "Tam sayı olmalı."),
  })
  .refine((v) => !!v.linkUrl === !!v.linkMetni, {
    message: "Bağlantı adresi doluysa bağlantı metni de dolu olmalı (ya da ikisi de boş).",
    path: ["linkMetni"],
  })
  .refine(
    (v) => !v.baslangic || !v.bitis || new Date(v.bitis).getTime() > new Date(v.baslangic).getTime(),
    { message: "Bitiş, başlangıçtan sonra olmalı.", path: ["bitis"] }
  );

type DuyuruFormDegerleri = z.infer<typeof duyuruSemasi>;

const BOS_DUYURU: DuyuruFormDegerleri = {
  metin: "",
  linkUrl: "",
  linkMetni: "",
  varyant: "bilgi",
  aktif: false,
  baslangic: "",
  bitis: "",
  sira: "0",
};

function kayittanForm(k: DuyuruSeridiOut): DuyuruFormDegerleri {
  return {
    metin: k.metin,
    linkUrl: k.link_url ?? "",
    linkMetni: k.link_metni ?? "",
    varyant: k.varyant,
    aktif: k.aktif,
    baslangic: isoToLocalInput(k.baslangic_at),
    bitis: isoToLocalInput(k.bitis_at),
    sira: String(k.sira),
  };
}

function formGovdesi(v: DuyuruFormDegerleri) {
  return {
    metin: v.metin.trim(),
    link_url: v.linkUrl.trim() || null,
    link_metni: v.linkMetni.trim() || null,
    varyant: v.varyant,
    aktif: v.aktif,
    baslangic_at: localInputToIsoOrNull(v.baslangic),
    bitis_at: localInputToIsoOrNull(v.bitis),
    sira: v.sira.trim() === "" ? 0 : Number(v.sira),
  };
}

const VARYANT_ETIKETI: Record<DuyuruVaryant, { label: string; tone: "info" | "warning" }> = {
  bilgi: { label: "Bilgi", tone: "info" },
  dikkat: { label: "Dikkat", tone: "warning" },
};

export default function AdminAnnouncementsPage() {
  const { canView, canManage } = useAdminAreaAccess("announcements");
  const { data, isLoading, isError, error, refetch } = useDuyuruSeridiList();
  const create = useCreateDuyuruSeridi();
  const update = useUpdateDuyuruSeridi();

  const [showForm, setShowForm] = useState(false);
  const duzenlemeYuzeyi = useDuzenlemeYuzeyi<DuyuruSeridiOut, void>();

  if (!canView) return <AccessDenied area="Duyuru şeridi" />;
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Duyuru şeridi yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }

  const duyurular = data ?? [];

  const kolonlar: ColumnDef<DuyuruSeridiOut, unknown>[] = [
    {
      id: "metin",
      accessorFn: (d) => d.metin,
      header: "Metin",
      cell: ({ row }) => (
        <p className="max-w-sm truncate text-sm text-panel-fg">{row.original.metin}</p>
      ),
    },
    {
      id: "varyant",
      header: "Varyant",
      cell: ({ row }) => {
        const e = VARYANT_ETIKETI[row.original.varyant];
        return <Badge tone={e.tone}>{e.label}</Badge>;
      },
    },
    {
      id: "aktif",
      header: "Durum",
      cell: ({ row }) => (
        <Badge tone={row.original.aktif ? "success" : "neutral"}>
          {row.original.aktif ? "Aktif" : "Pasif"}
        </Badge>
      ),
    },
    {
      id: "tarih",
      header: "Tarih aralığı",
      cell: ({ row }) => {
        const b = row.original.baslangic_at;
        const s = row.original.bitis_at;
        if (!b && !s) return <span className="text-panel-fg-subtle">Süresiz</span>;
        return (
          <span className="whitespace-nowrap text-xs text-panel-fg-muted">
            {b ? formatDateTime(b) : "—"} → {s ? formatDateTime(s) : "—"}
          </span>
        );
      },
    },
    {
      id: "sira",
      accessorFn: (d) => d.sira,
      header: "Sıra",
      cell: ({ row }) => <span className="tabular-nums">{row.original.sira}</span>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DuyuruAksiyonlari duyuru={row.original} canManage={canManage} yuzey={duzenlemeYuzeyi} />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {canManage ? (
        <PanelBaslikAksiyonu>
          <Button size="sm" aria-expanded={showForm} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Kapat" : "Yeni duyuru"}
          </Button>
        </PanelBaslikAksiyonu>
      ) : (
        <ReadOnlyNotice />
      )}

      {canManage && showForm && (
        <div className="rounded-2xl border border-panel-border p-4">
          <DuyuruFormIcerik
            baslangicDegerleri={BOS_DUYURU}
            gonder={(govde) =>
              create.mutate(govde, {
                onSuccess: () => {
                  toast.success("Duyuru oluşturuldu");
                  setShowForm(false);
                },
              })
            }
            isPending={create.isPending}
            sunucuHatasi={create.error}
          />
        </div>
      )}

      <DataTable
        columns={kolonlar}
        data={duyurular}
        getRowId={(d) => String(d.id)}
        isLoading={isLoading}
        page={1}
        pageSize={Math.max(duyurular.length, 1)}
        total={duyurular.length}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        bos={{
          filtreli: false,
          kayitYok: (
            <KayitYokDurumu
              baslik="Henüz duyuru eklenmemiş"
              aciklama="İlk duyuruyu ekleyerek storefront şeridini kullanmaya başlayın."
              aksiyon={
                canManage ? (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    Yeni duyuru
                  </Button>
                ) : undefined
              }
            />
          ),
          sonucYok: null,
        }}
      />

      {duzenlemeYuzeyi.acik && duzenlemeYuzeyi.kayit && (
        <DuzenlemeDuyuruPenceresi
          kayit={duzenlemeYuzeyi.kayit}
          yuzey={duzenlemeYuzeyi}
          gonder={(id, govde) =>
            update.mutate(
              { id, payload: govde },
              {
                onSuccess: () => {
                  toast.success("Duyuru güncellendi");
                  duzenlemeYuzeyi.kapat();
                },
              }
            )
          }
          isPending={update.isPending}
          sunucuHatasi={update.error}
        />
      )}
    </div>
  );
}

/** Form alanları — hem satır içi oluşturmada hem düzenleme penceresinde AYNI. */
function DuyuruFormIcerik({
  baslangicDegerleri,
  gonder,
  isPending,
  sunucuHatasi,
}: {
  baslangicDegerleri: DuyuruFormDegerleri;
  gonder: (govde: ReturnType<typeof formGovdesi>) => void;
  isPending: boolean;
  sunucuHatasi: unknown;
}) {
  const form = useForm<DuyuruFormDegerleri>({
    resolver: zodResolver(duyuruSemasi),
    defaultValues: baslangicDegerleri,
    mode: "onChange",
    shouldFocusError: false,
  });

  const [genelHata, setGenelHata] = useState<string | null>(null);

  const onGonder = form.handleSubmit(
    (degerler) => gonder(formGovdesi(degerler)),
    () => form.setFocus("metin")
  );

  // Sunucu hatasını alanlara dağıt (İP-A2 sözleşmesi); alana düşmeyen kısım şeritte.
  useEffect(() => {
    if (!sunucuHatasi) {
      setGenelHata(null);
      return;
    }
    setGenelHata(
      sunucuHatasiniUygula(
        sunucuHatasi,
        form,
        ["metin", "linkUrl", "linkMetni", "varyant", "aktif", "baslangic", "bitis", "sira"],
        { link_url: "linkUrl", link_metni: "linkMetni", baslangic_at: "baslangic", bitis_at: "bitis" },
        (h) => getErrorDetail(h, "Duyuru kaydedilemedi")
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunucuHatasi]);

  return (
    <div className="space-y-3">
      <Form.Field
        control={form.control}
        name="metin"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Metin</Form.Label>
            <Form.Control>
              <input className="input w-full" maxLength={160} {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <div className="grid grid-cols-2 gap-3">
        <Form.Field
          control={form.control}
          name="linkUrl"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Bağlantı adresi</Form.Label>
              <Form.Control>
                <input className="input w-full" placeholder="https://…" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="linkMetni"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Bağlantı metni</Form.Label>
              <Form.Control>
                <input className="input w-full" maxLength={40} {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Form.Field
          control={form.control}
          name="varyant"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Varyant</Form.Label>
              <Form.Control>
                <select className="input" {...field}>
                  <option value="bilgi">Bilgi</option>
                  <option value="dikkat">Dikkat</option>
                </select>
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="sira"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Sıra</Form.Label>
              <Form.Control>
                <input type="number" className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="baslangic"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Başlangıç</Form.Label>
              <Form.Control>
                <input type="datetime-local" className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="bitis"
          render={({ field }) => (
            <Form.Item>
              <Form.Label optional>Bitiş</Form.Label>
              <Form.Control>
                <input type="datetime-local" className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      </div>
      <Form.Field
        control={form.control}
        name="aktif"
        render={({ field: { value, onChange, ...alan } }) => (
          <Form.Item className="flex items-center gap-2">
            <Form.Control>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={value}
                onChange={(e) => onChange(e.target.checked)}
                {...alan}
              />
            </Form.Control>
            <Form.Label className="mb-0">Aktif</Form.Label>
          </Form.Item>
        )}
      />

      {genelHata && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100"
        >
          {genelHata}
        </p>
      )}

      <Button isPending={isPending} onClick={onGonder}>
        Kaydet
      </Button>
    </div>
  );
}

function DuzenlemeDuyuruPenceresi({
  kayit,
  yuzey,
  gonder,
  isPending,
  sunucuHatasi,
}: {
  kayit: DuyuruSeridiOut;
  yuzey: ReturnType<typeof useDuzenlemeYuzeyi<DuyuruSeridiOut, void>>;
  gonder: (id: number, govde: ReturnType<typeof formGovdesi>) => void;
  isPending: boolean;
  sunucuHatasi: unknown;
}) {
  const form = useForm<DuyuruFormDegerleri>({
    resolver: zodResolver(duyuruSemasi),
    defaultValues: kayittanForm(kayit),
    mode: "onChange",
    shouldFocusError: false,
  });

  const onGonder = form.handleSubmit((degerler) => gonder(kayit.id, formGovdesi(degerler)));

  return (
    <DuzenlemeYuzeyi
      yuzey={yuzey}
      baslik="Duyuruyu düzenle"
      form={form}
      sunucuHatasi={sunucuHatasi ?? HATA_TAKIBI_YOK}
      islemSuruyor={isPending}
      aksiyonlar={
        <Button isPending={isPending} onClick={onGonder}>
          Kaydet
        </Button>
      }
    >
      <DuyuruFormIcerik
        baslangicDegerleri={kayittanForm(kayit)}
        gonder={(govde) => gonder(kayit.id, govde)}
        isPending={isPending}
        sunucuHatasi={sunucuHatasi}
      />
    </DuzenlemeYuzeyi>
  );
}

/** Satır aksiyonları — Ç-2: Düzenle + Aktif/Pasif AÇIKTA, Sil menüde+onaylı. */
function DuyuruAksiyonlari({
  duyuru,
  canManage,
  yuzey,
  yerlesim = "satir",
}: {
  duyuru: DuyuruSeridiOut;
  canManage: boolean;
  yuzey: ReturnType<typeof useDuzenlemeYuzeyi<DuyuruSeridiOut, void>>;
  yerlesim?: "satir" | "kart";
}) {
  const update = useUpdateDuyuruSeridi();
  const del = useDeleteDuyuruSeridi();

  if (!canManage) return null;

  const aksiyonlar: SatirAksiyonu[] = [
    { etiket: "Düzenle", acik: true, onSec: () => yuzey.ac(duyuru) },
    {
      etiket: duyuru.aktif ? "Pasifleştir" : "Aktifleştir",
      acik: true,
      bekliyor: update.isPending,
      onSec: () =>
        update.mutate({ id: duyuru.id, payload: { aktif: !duyuru.aktif } }),
    },
    {
      etiket: "Sil",
      yikici: true,
      bekliyor: del.isPending,
      onay: {
        baslik: "Duyuruyu sil",
        aciklama: `"${duyuru.metin}" duyurusu kalıcı olarak silinecek.`,
        onayEtiketi: "Duyuruyu sil",
      },
      onSec: (kapat) =>
        del.mutate(duyuru.id, {
          onSuccess: () => {
            toast.success("Duyuru silindi");
            kapat();
          },
          onError: (err: unknown) => toast.error(getErrorDetail(err, "Duyuru silinemedi")),
        }),
    },
  ];

  return (
    <SatirAksiyonlari
      aksiyonlar={aksiyonlar}
      yerlesim={yerlesim}
      menuEtiketi={`${duyuru.metin} — diğer işlemler`}
    />
  );
}
