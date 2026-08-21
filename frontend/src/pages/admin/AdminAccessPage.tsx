import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Badge, Button, ErrorState, PageSkeleton } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
  type DuzenlemeYuzeyiDurumu,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import {
  useAdminPermissions,
  useAdminRoleAssignments,
  useAdminRoles,
  useAssignAdminRole,
  useCreateAdminRole,
  useUpdateAdminRole,
} from "@/hooks/useAdmin";
import { getErrorMessage } from "@/lib/errors";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/store/toastStore";
import type { AdminPermissionOut, AdminRoleOut } from "@/types";

/**
 * ── İP-A7d4 · göç dalgası 4 ──
 *
 * Bu ekran, göçün SON canlı SK-4 sınıfı kusurunu taşıyordu ve onu bulan
 * **elle arama değil, bu pakette yazılan nöbetçi** oldu
 * (`__guards__/korumasizPencere.test.ts`).
 *
 * Eski hâl: ekran kendi `Dialog`ını kuruyor, içinde rol kodu + rol adı +
 * 500 karakterlik açıklama + izin kutuları taşıyor, kirli form bekçisini HİÇ
 * çağırmıyordu. ×/ESC/dış tıklama yazılan her şeyi sormadan siliyordu — bir
 * YETKİ tanımının ortasında.
 *
 * Ayrıca doğrulama tarayıcının `required`/`pattern` özniteliklerine
 * bırakılmıştı: hata mesajı tarayıcı diline ve baloncuğuna bağlıydı,
 * ekran okuyucuya `aria-invalid` olarak inmiyordu ve alan başına gerekçe
 * yazılamıyordu.
 */
interface RolHedefi {
  rol: AdminRoleOut | null;
}

const KOD_DESENI = /^[A-Z][A-Z0-9_]*$/;

const rolSemasi = z.object({
  code: z
    .string()
    .trim()
    .min(3, "Rol kodu en az 3 karakter olmalı.")
    .max(50, "Rol kodu en fazla 50 karakter olabilir.")
    .regex(KOD_DESENI, "Rol kodu büyük harfle başlamalı; yalnız A-Z, 0-9 ve _ içerebilir."),
  name: z
    .string()
    .trim()
    .min(2, "Rol adı en az 2 karakter olmalı.")
    .max(100, "Rol adı en fazla 100 karakter olabilir."),
  description: z.string().max(500, "Açıklama en fazla 500 karakter olabilir."),
  permissionCodes: z.array(z.string()),
});

type RolDegerleri = z.infer<typeof rolSemasi>;

export default function AdminAccessPage() {
  const permissionsQuery = useAdminPermissions();
  const rolesQuery = useAdminRoles();
  const assignmentsQuery = useAdminRoleAssignments();
  const assignRole = useAssignAdminRole();
  const canManage = useAuthStore((state) => state.user?.admin_permissions?.includes("admin_roles.manage")) ?? false;
  // Pencere durumu ekranda YAŞAMAZ (İP-A4 sözleşmesi).
  const yuzey = useDuzenlemeYuzeyi<RolHedefi, void>();

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, AdminPermissionOut[]>();
    for (const permission of permissionsQuery.data ?? []) {
      const current = groups.get(permission.group) ?? [];
      current.push(permission);
      groups.set(permission.group, current);
    }
    return [...groups.entries()];
  }, [permissionsQuery.data]);

  const changeAssignment = (adminId: number, roleId: number) => {
    assignRole.mutate(
      { adminId, roleId },
      {
        onSuccess: () => toast.success("Yönetici rolü atandı."),
        onError: (error) => toast.error(getErrorMessage(error, "Rol atanamadı.")),
      }
    );
  };

  if (permissionsQuery.isLoading || rolesQuery.isLoading || assignmentsQuery.isLoading) {
    return <PageSkeleton rows={5} />;
  }
  const error = permissionsQuery.error ?? rolesQuery.error ?? assignmentsQuery.error;
  if (error) {
    return <ErrorState description={getErrorMessage(error, "Yetki bilgileri yüklenemedi.")} onRetry={() => {
      permissionsQuery.refetch();
      rolesQuery.refetch();
      assignmentsQuery.refetch();
    }} />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-12">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">Yönetici rolleri</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Her yönetici tek bir görev rolüne atanır. Kesin izin kontrolü API tarafında uygulanır.</p>
          </div>
          {canManage && <Button onClick={() => yuzey.ac({ rol: null })}>Yeni rol</Button>}
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {(rolesQuery.data ?? []).map((role) => (
            <article key={role.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-white">{role.name}</h3>
                    {role.is_system && <Badge tone="info">Sistem</Badge>}
                  </div>
                  <p className="mt-1 font-mono text-xs text-slate-500">{role.code}</p>
                </div>
                {canManage && role.code !== "SUPER_ADMIN" && <Button size="sm" variant="secondary" onClick={() => yuzey.ac({ rol: role })}>Düzenle</Button>}
              </div>
              {role.description && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{role.description}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge tone="neutral">{role.permission_codes.length} izin</Badge>
                <Badge tone="neutral">{role.assignment_count} yönetici</Badge>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-bold text-slate-950 dark:text-white">Yönetici atamaları</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Son Super Admin başka bir role indirilemez.</p>
        <div className="mt-5 divide-y divide-slate-100 dark:divide-slate-800">
          {(assignmentsQuery.data ?? []).map((assignment) => (
            <div key={assignment.admin_id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{assignment.admin_name}</p>
                <p className="text-xs text-slate-500">{assignment.admin_email}</p>
              </div>
              <label className="sm:w-72">
                <span className="sr-only">{assignment.admin_name} için yönetici rolü</span>
                <select
                  className="input"
                  value={assignment.role_id ?? ""}
                  disabled={!canManage || assignRole.isPending}
                  onChange={(event) => changeAssignment(assignment.admin_id, Number(event.target.value))}
                >
                  {!assignment.role_id && <option value="" disabled>Rol seçin</option>}
                  {(rolesQuery.data ?? []).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
            </div>
          ))}
        </div>
      </section>

      <RolPenceresi yuzey={yuzey} gruplar={permissionGroups} />
    </div>
  );
}

function RolPenceresi({
  yuzey,
  gruplar,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<RolHedefi, void>;
  gruplar: [string, AdminPermissionOut[]][];
}) {
  const rol = yuzey.kayit?.rol ?? null;
  return (
    <DuzenlemePenceresi
      yuzey={yuzey}
      baslik={rol ? "Yönetici rolünü düzenle" : "Yeni yönetici rolü"}
      aciklama="İzinler en az yetki ilkesine göre seçilmelidir."
    >
      {/* İçerik hedef başına yeniden kurulur: `key` olmadan bir rolden
          diğerine geçerken `useForm`un varsayılanları taşınırdı. */}
      {yuzey.acik && <RolIcerik key={rol?.id ?? "yeni"} yuzey={yuzey} rol={rol} gruplar={gruplar} />}
    </DuzenlemePenceresi>
  );
}

function RolIcerik({
  yuzey,
  rol,
  gruplar,
}: {
  yuzey: DuzenlemeYuzeyiDurumu<RolHedefi, void>;
  rol: AdminRoleOut | null;
  gruplar: [string, AdminPermissionOut[]][];
}) {
  const createRole = useCreateAdminRole();
  const updateRole = useUpdateAdminRole();
  const sunucuHatasi = createRole.error ?? updateRole.error;
  const islemSuruyor = createRole.isPending || updateRole.isPending;

  const form = useForm<RolDegerleri>({
    resolver: zodResolver(rolSemasi),
    defaultValues: {
      // Düzenlemede kod alanı basılmaz ama şema onu ister; mevcut kod
      // taşınır ki "kod geçersiz" diye bir hayalet hata doğmasın.
      code: rol?.code ?? "",
      name: rol?.name ?? "",
      description: rol?.description ?? "",
      permissionCodes: rol?.permission_codes ?? [],
    },
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi });

  const gonder = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      const payload = {
        name: deger.name.trim(),
        description: deger.description.trim() || null,
        permission_codes: deger.permissionCodes,
      };
      const secenekler = {
        onSuccess: () => {
          toast.success(rol ? "Yönetici rolü güncellendi." : "Yönetici rolü oluşturuldu.");
          yuzey.kapat();
        },
        onError: (hata: unknown) => {
          const kalan = sunucuHatasiniUygula(
            hata,
            form,
            ["code", "name", "description"],
            { permission_codes: "permissionCodes" },
            (h) => getErrorMessage(h, "Rol kaydedilemedi.")
          );
          form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
        },
      };
      if (rol) updateRole.mutate({ id: rol.id, payload }, secenekler);
      else createRole.mutate({ ...payload, code: deger.code.trim().toUpperCase() }, secenekler);
    },
    (hatalar) => {
      // Odak İLK hatalı alana: `shouldFocusError` kapalı çünkü pencere
      // açılışındaki odak yönetimiyle yarışırdı.
      const sira: (keyof RolDegerleri)[] = ["code", "name", "description"];
      const ilk = sira.find((ad) => hatalar[ad]);
      if (ilk) form.setFocus(ilk);
    }
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;
  const secili = form.watch("permissionCodes");

  return (
    <div className="space-y-4">
      {genelHata && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {genelHata}
        </p>
      )}

      {!rol && (
        <Form.Field
          control={form.control}
          name="code"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Rol kodu</Form.Label>
              <Form.Control>
                <input
                  className="input"
                  maxLength={50}
                  placeholder="ICERIK_EDITORU"
                  {...field}
                  onChange={(event) =>
                    field.onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))
                  }
                />
              </Form.Control>
              <Form.Hint>Oluşturulduktan sonra değiştirilemez.</Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      )}

      <Form.Field
        control={form.control}
        name="name"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Rol adı</Form.Label>
            <Form.Control>
              <input className="input" maxLength={100} {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <Form.Field
        control={form.control}
        name="description"
        render={({ field }) => (
          <Form.Item>
            <Form.Label optional>Açıklama</Form.Label>
            <Form.Control>
              <textarea className="input min-h-20 resize-y" maxLength={500} {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />

      <div className="space-y-4">
        {gruplar.map(([grup, izinler]) => (
          <fieldset key={grup}>
            <legend className="text-sm font-bold text-slate-800 dark:text-slate-100">{grup}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {izinler.map((izin) => (
                <label
                  key={izin.code}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-indigo-600"
                    checked={secili.includes(izin.code)}
                    onChange={(event) =>
                      form.setValue(
                        "permissionCodes",
                        event.target.checked
                          ? [...secili, izin.code]
                          : secili.filter((kod) => kod !== izin.code),
                        { shouldDirty: true }
                      )
                    }
                  />
                  <span>
                    <span className="block font-semibold">{izin.name}</span>
                    <span className="font-mono text-[10px] text-slate-500">{izin.code}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex justify-end">
        {/* Düğme geçerlilikle KAPANMAZ (kilitli karar): boş bırakan kullanıcı
            NEDEN gönderemediğini alanın altında görür. */}
        <Button isPending={islemSuruyor} onClick={gonder}>
          Kaydet
        </Button>
      </div>
    </div>
  );
}
