// "Araçlar" — filo yönetimi (İP-19: araçlar enum'dan tabloya taşındı).
// CourierManager deseni: hafif liste + satır içi ekleme/düzenleme, kart
// enflasyonu yok — satır ritmi + saç-teli çizgi. Ayrıca turların başlangıç
// (BASE) noktası da burada yönetilir (K-9: depo .env sabiti yerine veri).
import { useState } from "react";
import { useForm, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { isAxiosError } from "axios";

import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog } from "@/components/admin/ui";
import {
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import {
  useCreatePickupPoint,
  useCreateVehicle,
  useDeleteVehicle,
  usePickupPoints,
  useUpdateVehicle,
  useVehicles,
  useUpdatePickupPoint,
} from "@/hooks/useDelivery";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { PickupPoint, Vehicle } from "@/types";

/** "HH:MM:SS" (backend time) → time input değeri "HH:MM". */
const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Vardiya özeti — ikisi de doluysa aralık, yoksa boş. */
function shiftText(v: Vehicle): string | null {
  if (!v.shift_start && !v.shift_end) return null;
  return `${hhmm(v.shift_start) || "…"}–${hhmm(v.shift_end) || "…"}`;
}

/**
 * Alan yerleşimi — küçük etiket + hata slotu.
 *
 * ## Neden render-prop bir sarmalayıcı DEĞİL
 *
 * İlk yazımda alanlar `<Alan form ad etiket>{(alan) => <input …/>}</Alan>`
 * biçiminde tek bir sarmalayıcıdan geçiyordu. Çalışma zamanında kusursuzdu
 * (dal testi 13 alanı adlı buldu) ama **nöbetçi sayacı 13 borç raporladı**:
 * sayaç kaynakta YAZILANI okur ve `Form.Control` içindeki `<input>`u bir
 * fonksiyon gövdesinin ardında göremez.
 *
 * Bu, İP-A6b'nin M-A kaçışının aynadaki hâlidir (orada alan fabrikası gerçek
 * borcu GİZLİYORDU, burada sahte borç ÜRETİYORDU) ve ikisi de aynı şeyi
 * söyler: sayacın gördüğü yazım ile kullanıcının gördüğü sonuç ayrılırsa
 * ölçüm kanıt olmaktan çıkar. Alanlar bu yüzden açık `Form.Field` blokları
 * olarak yazıldı — panelin geri kalanıyla da aynı yazım.
 */
const ALAN_ETIKET = "mb-1 block text-[11px] font-medium text-slate-500 ";

/**
 * Satır içi formların ortak "ilk hatalı alana odaklan" yardımcısı.
 *
 * Gönder düğmesi geçerlilikle KAPANMAZ (kilitli karar).
 */
function ilkHatayaOdaklan<T extends FieldValues>(
  form: UseFormReturn<T>,
  sira: readonly Path<T>[]
) {
  // Hatalar `handleSubmit`in `onInvalid` ARGÜMANINDAN okunur.
  //
  // İlk yazım `form.formState.errors`e bakıyordu ve gerçek tarayıcı turu
  // ölçtü: gönderim anında o anlık görüntü HENÜZ BOŞ — odak hiçbir yere
  // taşınmıyordu (`document.activeElement` = `<body>`). jsdom testleri
  // yalnız `aria-invalid`e baktığı için bunu görmemişti.
  return (hatalar: Record<string, unknown>) => {
    const alan = sira.find((a) => hatalar[a as string]);
    if (alan) form.setFocus(alan);
  };
}

/** Sunucu hatasını alanlara dağıt, kalanı şeride yaz. */
function sunucuHatasiniDagit<T extends FieldValues>(
  form: UseFormReturn<T>,
  alanlar: readonly string[],
  hata: unknown
) {
  const kalan = sunucuHatasiniUygula(hata, form, [...alanlar]);
  form.setError("root.sunucu" as Path<T>, {
    type: "server",
    message: kalan ?? undefined,
  });
}

/** Şerit — alanlara düşmeyen sunucu hatası. */
function GenelHata({ mesaj }: { mesaj?: string }) {
  if (!mesaj) return null;
  return (
    <p role="alert" className="mb-1.5 text-xs text-rose-600 ">
      {mesaj}
    </p>
  );
}

/** Boş bırakılabilen, en az `enAz` olan sayı alanı. */
function sayiAlani(etiket: string, enAz: number) {
  return z
    .string()
    .refine(
      (v) => v.trim() === "" || Number.isFinite(Number(v)),
      `${etiket} bir sayı olmalı.`
    )
    .refine(
      (v) => v.trim() === "" || Number(v) >= enAz,
      `${etiket} en az ${enAz} olmalı.`
    );
}

/**
 * Araç formu şeması. `kodlu` ayrımı bir DAL değil bir SÖZLEŞME farkıdır: kod
 * yalnız oluşturmada girilir, düzenlemede alan hiç render edilmez (değişmez).
 */
function aracSemasi(kodlu: boolean) {
  return z.object({
    label: z.string().trim().min(1, "Araç adı (etiket) gerekli."),
    code: kodlu
      ? z
          .string()
          .trim()
          .regex(
            /^[A-Z0-9_-]+$/,
            "Kod yalnız BÜYÜK harf, rakam, _ ve - içerebilir (örn. DOBLO)."
          )
      : z.string(),
    plate: z.string(),
    maxStops: sayiAlani("Durak tavanı", 1),
    shiftStart: z.string(),
    shiftEnd: z.string(),
    fixedCost: sayiAlani("Sabit maliyet", 0),
    sortOrder: z.string().refine(
      (v) => v.trim() === "" || Number.isFinite(Number(v)),
      "Sıra bir sayı olmalı."
    ),
  });
}

type VehicleFormState = z.infer<ReturnType<typeof aracSemasi>>;

const ARAC_SIRA = [
  "label",
  "code",
  "plate",
  "maxStops",
  "shiftStart",
  "shiftEnd",
  "fixedCost",
  "sortOrder",
] as const;

function formFrom(v?: Vehicle): VehicleFormState {
  return {
    label: v?.label ?? "",
    code: v?.code ?? "",
    plate: v?.plate ?? "",
    maxStops: v?.max_stops != null ? String(v.max_stops) : "",
    shiftStart: hhmm(v?.shift_start),
    shiftEnd: hhmm(v?.shift_end),
    fixedCost: v != null ? String(v.fixed_cost) : "0",
    sortOrder: v != null ? String(v.sort_order) : "0",
  };
}

/** Formdan PATCH/POST gövdesine (code hariç — o yalnız oluşturmada).
 *  Dönen şekil hem `VehicleUpdate` hem (code eklenince) `VehicleCreate` olur. */
function payloadFrom(f: VehicleFormState) {
  return {
    label: f.label.trim(),
    plate: f.plate.trim() || null,
    max_stops: f.maxStops.trim() === "" ? null : Number(f.maxStops),
    shift_start: f.shiftStart || null,
    shift_end: f.shiftEnd || null,
    fixed_cost: f.fixedCost.trim() === "" ? 0 : Number(f.fixedCost),
    sort_order: f.sortOrder.trim() === "" ? 0 : Number(f.sortOrder),
  };
}

/* Alan satırı — ekleme ve düzenleme aynı yerleşimi paylaşır. */
function VehicleFields({
  form,
  withCode,
}: {
  form: UseFormReturn<VehicleFormState>;
  withCode: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2.5">
      <Form.Field
        control={form.control}
        name="label"
        render={({ field }) => (
          <Form.Item className="flex w-36 flex-col">
            <Form.Label className={ALAN_ETIKET}>Araç adı</Form.Label>
            <Form.Control>
              <input className="input" placeholder="Doblo" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      {withCode && (
        <Form.Field
          control={form.control}
          name="code"
          render={({ field }) => (
            <Form.Item className="flex w-28 flex-col">
              <Form.Label className={ALAN_ETIKET}>Kod (değişmez)</Form.Label>
              <Form.Control>
                <input
                  className="input font-mono uppercase"
                  placeholder="DOBLO"
                  {...field}
                  onChange={(e) =>
                    field.onChange(e.target.value.toUpperCase().replace(/\s/g, ""))
                  }
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
      )}
      <Form.Field
        control={form.control}
        name="plate"
        render={({ field }) => (
          <Form.Item className="flex w-28 flex-col">
            <Form.Label optional className={ALAN_ETIKET}>
              Plaka
            </Form.Label>
            <Form.Control>
              <input
                className="input font-mono"
                placeholder="01 ABC 123"
                {...field}
                onChange={(e) => field.onChange(e.target.value.toLocaleUpperCase("tr"))}
              />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="maxStops"
        render={({ field }) => (
          <Form.Item className="flex w-24 flex-col">
            <Form.Label optional className={ALAN_ETIKET}>
              Durak tavanı
            </Form.Label>
            <Form.Control>
              <input type="number" min={1} className="input" placeholder="sınırsız" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="shiftStart"
        render={({ field }) => (
          <Form.Item className="flex w-28 flex-col">
            <Form.Label optional className={ALAN_ETIKET}>
              Vardiya başlangıç
            </Form.Label>
            <Form.Control>
              <input type="time" className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="shiftEnd"
        render={({ field }) => (
          <Form.Item className="flex w-28 flex-col">
            <Form.Label optional className={ALAN_ETIKET}>
              Vardiya bitiş
            </Form.Label>
            <Form.Control>
              <input type="time" className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="fixedCost"
        render={({ field }) => (
          <Form.Item className="flex w-24 flex-col">
            <Form.Label className={ALAN_ETIKET}>Sabit maliyet (₺/gün)</Form.Label>
            <Form.Control>
              <input type="number" min={0} className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="sortOrder"
        render={({ field }) => (
          <Form.Item className="flex w-16 flex-col">
            <Form.Label className={ALAN_ETIKET}>Sıra</Form.Label>
            <Form.Control>
              <input type="number" className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
    </div>
  );
}

/** Araç satırının düzenleme formu — satır içi, PENCERESİZ. */
function AracDuzenlemeFormu({ v, onBitti }: { v: Vehicle; onBitti: () => void }) {
  const update = useUpdateVehicle();
  const form = useForm<VehicleFormState>({
    resolver: zodResolver(aracSemasi(false)),
    defaultValues: formFrom(v),
    mode: "onChange",
    shouldFocusError: false,
  });

  // PENCERESİZ beyanı (İP-A7d2 · Görev 1): bu form satır içinde yaşıyor.
  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: update.error, pencereSiz: true });

  const calistir = form.handleSubmit((deger) => {
    form.clearErrors("root.sunucu");
    update.mutate(
      { vehicleId: v.id, payload: payloadFrom(deger) },
      {
        onSuccess: () => {
          form.reset(deger);
          onBitti();
        },
        onError: (e) => sunucuHatasiniDagit(form, ARAC_SIRA, e),
      }
    );
  }, ilkHatayaOdaklan(form, ARAC_SIRA));

  return (
    <li className="py-3">
      <GenelHata mesaj={form.formState.errors.root?.sunucu?.message} />
      <VehicleFields form={form} withCode={false} />
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" isPending={update.isPending} onClick={calistir}>
          Kaydet
        </Button>
        <Button size="sm" variant="ghost" onClick={onBitti}>
          Vazgeç
        </Button>
      </div>
    </li>
  );
}

function VehicleRow({ v }: { v: Vehicle }) {
  const update = useUpdateVehicle();
  const remove = useDeleteVehicle();
  const [editing, setEditing] = useState(false);
  const silme = useDuzenlemeYuzeyi<Vehicle, void>();

  if (editing) {
    return <AracDuzenlemeFormu v={v} onBitti={() => setEditing(false)} />;
  }

  const meta = [
    v.plate,
    v.max_stops != null ? `${v.max_stops} durak` : null,
    shiftText(v),
    v.fixed_cost > 0 ? `₺${v.fixed_cost} sabit` : null,
  ].filter(Boolean);

  return (
    <>
      <li className="flex flex-wrap items-center gap-3 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-medium text-slate-900 ">
            {v.label}
            <span className="ml-2 font-mono text-xs font-normal text-slate-400 ">
              {v.code}
            </span>
            {!v.is_active && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ">
                pasif
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500 ">
            {meta.length > 0 ? meta.join(" · ") : "-"}
          </p>
        </div>
        {/* Aksiyon şeridi ARTIK HOVER'A BAĞLI DEĞİL (İP-A7d2): dokunmatik
            ekranda hover yoktur ve şerit görünmüyordu. */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Düzenle
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isPending={update.isPending}
            onClick={() =>
              update.mutate(
                { vehicleId: v.id, payload: { is_active: !v.is_active } },
                { onError: (e) => toast.error(getErrorMessage(e, "Güncellenemedi.")) }
              )
            }
          >
            {v.is_active ? "Pasifleştir" : "Aktifleştir"}
          </Button>
          <Button size="sm" variant="danger" onClick={() => silme.ac(v)}>
            Sil
          </Button>
        </div>
      </li>
      <ConfirmDialog
        open={silme.acik}
        title="Aracı sil"
        description={`${v.label} filodan kaldırılacak. Geçmiş turların kaydı bozulmaz.`}
        confirmLabel="Aracı sil"
        danger
        isPending={remove.isPending}
        onClose={silme.kapat}
        onConfirm={() =>
          remove.mutate(v.id, {
            onSuccess: () => silme.kapat(),
            onError: (e) => {
              // 409: açık (PLANNED/ACTIVE) turu olan araç silinemez.
              if (isAxiosError(e) && e.response?.status === 409) {
                toast.error(
                  getErrorMessage(
                    e,
                    "Aracın açık turu var: önce turları kapatın veya iptal edin."
                  )
                );
              } else {
                toast.error(getErrorMessage(e, "Araç silinemedi."));
              }
              silme.kapat();
            },
          })
        }
      />
    </>
  );
}

/** "Araç ekle" satır içi formu — PENCERESİZ. */
function AracEklemeFormu({ onBitti }: { onBitti: () => void }) {
  const create = useCreateVehicle();
  const form = useForm<VehicleFormState>({
    resolver: zodResolver(aracSemasi(true)),
    defaultValues: formFrom(),
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: create.error, pencereSiz: true });

  const calistir = form.handleSubmit((deger) => {
    form.clearErrors("root.sunucu");
    create.mutate(
      { code: deger.code.trim(), ...payloadFrom(deger) },
      {
        onSuccess: () => {
          form.reset(formFrom());
          onBitti();
          toast.success("Araç eklendi.");
        },
        onError: (e) => sunucuHatasiniDagit(form, ARAC_SIRA, e),
      }
    );
  }, ilkHatayaOdaklan(form, ARAC_SIRA));

  return (
    <div className="border-b border-slate-100 py-3.5 ">
      <GenelHata mesaj={form.formState.errors.root?.sunucu?.message} />
      <VehicleFields form={form} withCode />
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" isPending={create.isPending} onClick={calistir}>
          Ekle
        </Button>
        <Button size="sm" variant="ghost" onClick={onBitti}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

function VehicleSection() {
  const { canManage } = useAdminAreaAccess("delivery");
  const { data: vehicles = [], isLoading } = useVehicles();
  const [adding, setAdding] = useState(false);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white ">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
        <div>
          <h2 className="text-base font-bold text-slate-900 ">Araçlar</h2>
          <p className="mt-0.5 text-xs text-slate-500 ">
            Tur kurma ve Günü Optimize Et bu filoyu kullanır: durak tavanı ve
            vardiya rota planına girer.
          </p>
        </div>
        {canManage && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            Araç ekle
          </Button>
        )}
      </div>
      <div className="px-6">
        {adding && <AracEklemeFormu onBitti={() => setAdding(false)} />}
        {isLoading ? (
          <div className="space-y-2 py-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 " />
            ))}
          </div>
        ) : vehicles.length === 0 && !adding ? (
          <p className="py-6 text-center text-sm text-slate-400 ">
            Filoda araç yok: tur kurabilmek için en az bir araç ekleyin.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 ">
            {vehicles.map((v) =>
              canManage ? (
                <VehicleRow key={v.id} v={v} />
              ) : (
                <li key={v.id} className="py-3">
                  <p className="text-sm font-medium text-slate-900 ">
                    {v.label}
                    <span className="ml-2 font-mono text-xs font-normal text-slate-400 ">
                      {v.code}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 ">
                    {[v.plate, v.max_stops != null ? `${v.max_stops} durak` : null, shiftText(v)]
                      .filter(Boolean)
                      .join(" · ") || "-"}
                  </p>
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ── Başlangıç noktası (BASE) ── */

/**
 * Nokta formu şeması.
 *
 * Koordinat kuralı eskiden tek bir toast cümlesiydi ("Koordinat aralık dışı —
 * enlem ±90, boylam ±180 olmalı."): hangi alanın hatalı olduğu yazmıyordu.
 * Kural artık ALANIN kendi şemasında ve mesaj o alanın altında çıkıyor.
 */
const koordinat = (etiket: string, sinir: number) =>
  z
    .string()
    .refine((v) => v.trim() !== "", `${etiket} gerekli.`)
    .refine(
      (v) => v.trim() === "" || Number.isFinite(Number(v)),
      `${etiket} sayı olmalı (örn. 36.98550).`
    )
    .refine(
      (v) => v.trim() === "" || Math.abs(Number(v)) <= sinir,
      `${etiket} ±${sinir} aralığında olmalı.`
    );

const noktaSemasi = z.object({
  name: z.string().trim().min(1, "Nokta adı gerekli."),
  address: z.string(),
  lat: koordinat("Enlem", 90),
  lng: koordinat("Boylam", 180),
  sortOrder: z
    .string()
    .refine((v) => v.trim() === "" || Number.isFinite(Number(v)), "Sıra bir sayı olmalı."),
});

type NoktaFormDegerleri = z.infer<typeof noktaSemasi>;

const NOKTA_SIRA = ["name", "address", "lat", "lng", "sortOrder"] as const;

function noktaDegerleri(p?: PickupPoint): NoktaFormDegerleri {
  return {
    name: p?.name ?? "",
    address: p?.address ?? "",
    lat: p != null ? String(p.lat) : "",
    lng: p != null ? String(p.lng) : "",
    sortOrder: p != null ? String(p.sort_order) : "0",
  };
}

function noktaGovdesi(d: NoktaFormDegerleri) {
  return {
    name: d.name.trim(),
    address: d.address.trim() || null,
    lat: Number(d.lat),
    lng: Number(d.lng),
    sort_order: d.sortOrder.trim() === "" ? 0 : Number(d.sortOrder),
  };
}

function NoktaAlanlari({ form }: { form: UseFormReturn<NoktaFormDegerleri> }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2.5">
      <Form.Field
        control={form.control}
        name="name"
        render={({ field }) => (
          <Form.Item className="flex w-44 flex-col">
            <Form.Label className={ALAN_ETIKET}>Nokta adı</Form.Label>
            <Form.Control>
              <input className="input" placeholder="Depo: Seyhan" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="address"
        render={({ field }) => (
          <Form.Item className="flex w-56 flex-col">
            <Form.Label optional className={ALAN_ETIKET}>
              Adres
            </Form.Label>
            <Form.Control>
              <input className="input" placeholder="Cadde, mahalle…" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="lat"
        render={({ field }) => (
          <Form.Item className="flex w-28 flex-col">
            <Form.Label className={ALAN_ETIKET}>Enlem</Form.Label>
            <Form.Control>
              <input
                className="input tabular-nums"
                inputMode="decimal"
                placeholder="36.98550"
                {...field}
              />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="lng"
        render={({ field }) => (
          <Form.Item className="flex w-28 flex-col">
            <Form.Label className={ALAN_ETIKET}>Boylam</Form.Label>
            <Form.Control>
              <input
                className="input tabular-nums"
                inputMode="decimal"
                placeholder="35.32530"
                {...field}
              />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
      <Form.Field
        control={form.control}
        name="sortOrder"
        render={({ field }) => (
          <Form.Item className="flex w-16 flex-col">
            <Form.Label className={ALAN_ETIKET}>Sıra</Form.Label>
            <Form.Control>
              <input type="number" className="input" {...field} />
            </Form.Control>
            <Form.ErrorMessage />
          </Form.Item>
        )}
      />
    </div>
  );
}

function NoktaDuzenlemeFormu({ p, onBitti }: { p: PickupPoint; onBitti: () => void }) {
  const update = useUpdatePickupPoint();
  const form = useForm<NoktaFormDegerleri>({
    resolver: zodResolver(noktaSemasi),
    defaultValues: noktaDegerleri(p),
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: update.error, pencereSiz: true });

  const calistir = form.handleSubmit((deger) => {
    form.clearErrors("root.sunucu");
    update.mutate(
      { pointId: p.id, payload: noktaGovdesi(deger) },
      {
        onSuccess: () => {
          form.reset(deger);
          onBitti();
          toast.success("Başlangıç noktası güncellendi.");
        },
        onError: (e) => sunucuHatasiniDagit(form, NOKTA_SIRA, e),
      }
    );
  }, ilkHatayaOdaklan(form, NOKTA_SIRA));

  return (
    <li className="py-3.5">
      <GenelHata mesaj={form.formState.errors.root?.sunucu?.message} />
      <NoktaAlanlari form={form} />
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" isPending={update.isPending} onClick={calistir}>
          Kaydet
        </Button>
        <Button size="sm" variant="ghost" onClick={onBitti}>
          Vazgeç
        </Button>
      </div>
    </li>
  );
}

function BasePointRow({ p, isDefault }: { p: PickupPoint; isDefault: boolean }) {
  // Düzenleme, K-9'un gerekçesinin ikinci yarısıdır (denetim B-9): nokta
  // "deploy'suz düzenlenebilir" diye veriye taşındı ama düzenleme yolu
  // yazılmamıştı. Koordinat müşteriye gösterilen varış penceresinin de
  // başlangıcı olduğu için yanlış girilmiş bir değer sessizce yaşayamaz.
  const { canManage } = useAdminAreaAccess("delivery");
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <NoktaDuzenlemeFormu p={p} onBitti={() => setEditing(false)} />;
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium text-slate-900 ">
          {p.name}
          {isDefault && (
            <span className="ml-2 rounded-full bg-panel-accent-soft px-2 py-0.5 text-[11px] font-semibold text-panel-accent-text">
              varsayılan
            </span>
          )}
        </p>
        <p className="truncate text-xs text-slate-500 ">
          {p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
        </p>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-slate-400 ">
        sıra {p.sort_order}
      </span>
      {canManage && (
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setEditing(true)}>
          Düzenle
        </Button>
      )}
    </li>
  );
}

function NoktaEklemeFormu({ onBitti }: { onBitti: () => void }) {
  const create = useCreatePickupPoint();
  const form = useForm<NoktaFormDegerleri>({
    resolver: zodResolver(noktaSemasi),
    defaultValues: noktaDegerleri(),
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: create.error, pencereSiz: true });

  const calistir = form.handleSubmit((deger) => {
    form.clearErrors("root.sunucu");
    create.mutate(
      { kind: "BASE", ...noktaGovdesi(deger) },
      {
        onSuccess: () => {
          form.reset(noktaDegerleri());
          onBitti();
          toast.success("Başlangıç noktası eklendi.");
        },
        onError: (e) => sunucuHatasiniDagit(form, NOKTA_SIRA, e),
      }
    );
  }, ilkHatayaOdaklan(form, NOKTA_SIRA));

  return (
    <div className="border-b border-slate-100 py-3.5 ">
      <GenelHata mesaj={form.formState.errors.root?.sunucu?.message} />
      <NoktaAlanlari form={form} />
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" isPending={create.isPending} onClick={calistir}>
          Ekle
        </Button>
        <Button size="sm" variant="ghost" onClick={onBitti}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

function BasePointSection() {
  const { canManage } = useAdminAreaAccess("delivery");
  const { data: points = [], isLoading } = usePickupPoints();
  const [adding, setAdding] = useState(false);

  // Varsayılan başlangıç = aktif BASE kayıtlarından sırası en küçük (backend kuralı).
  const basePoints = points.filter((p) => p.kind === "BASE" && p.is_active);
  const defaultId = basePoints[0]?.id;

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white ">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
        <div>
          <h2 className="text-base font-bold text-slate-900 ">Başlangıç Noktası</h2>
          <p className="mt-0.5 text-xs text-slate-500 ">
            Turlar buradan yola çıkar; rota ve ETA&apos;lar bu noktaya göre hesaplanır.
            Sırası en küçük aktif nokta varsayılandır.
          </p>
        </div>
        {canManage && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            Nokta ekle
          </Button>
        )}
      </div>
      <div className="px-6">
        {adding && <NoktaEklemeFormu onBitti={() => setAdding(false)} />}
        {isLoading ? (
          <div className="my-3 h-10 animate-pulse rounded-lg bg-slate-100 " />
        ) : basePoints.length === 0 && !adding ? (
          <p className="py-6 text-center text-sm text-slate-400 ">
            Tanımlı başlangıç noktası yok: rota optimizasyonu için bir nokta ekleyin.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 ">
            {basePoints.map((p) => (
              <BasePointRow key={p.id} p={p} isDefault={p.id === defaultId} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function DeliveryVehiclesPage() {
  return (
    <div>
      <VehicleSection />
      <BasePointSection />
    </div>
  );
}
