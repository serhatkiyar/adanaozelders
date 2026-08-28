// Kurye profilleri yönetimi (ADMIN) — hafif liste + satır içi ekleme/düzenleme.
// Müşteri takip sayfasındaki kimlik kartını (isim + vesikalık) besler.
// İP-19: plaka kuryeden kalktı — araç kimliği Araçlar sekmesinde yaşar.
import { useRef, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog } from "@/components/admin/ui";
import {
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";

import {
  useCloseCourierAccount,
  useCourierAccount,
  useCouriers,
  useCreateCourier,
  useCreateCourierAccount,
  useDeleteCourier,
  useResetCourierPassword,
  useUpdateCourier,
  useUploadCourierPhoto,
} from "@/hooks/useDelivery";
import { toast } from "@/store/toastStore";
import type { Courier } from "@/types";

/* ══════════ Şemalar (İP-A7d2 · Görev 4) ══════════
 *
 * Bu ekranın DÖRT satır içi formu vardı ve dördünün de doğrulaması
 * `toast.error` ile ekranın köşesindeydi ("İsim en az 2 karakter olmalı.",
 * "Geçerli bir e-posta gir." …). Alanların hiçbirinin etiketi yoktu —
 * `placeholder` etiket yerine kullanılıyordu (nöbetçi sayacında
 * `CourierManager: 9`, tabanın en büyük kalemi).
 */

const kuryeSemasi = z.object({
  name: z.string().trim().min(2, "İsim en az 2 karakter olmalı."),
  phone: z.string(),
});
type KuryeFormDegerleri = z.infer<typeof kuryeSemasi>;

const hesapSemasi = z.object({
  first_name: z.string().trim().min(1, "Ad gerekli."),
  last_name: z.string().trim().min(1, "Soyad gerekli."),
  email: z.string().trim().email("Geçerli bir e-posta girin."),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});
type HesapFormDegerleri = z.infer<typeof hesapSemasi>;

const sifreSemasi = z.object({
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});
type SifreFormDegerleri = z.infer<typeof sifreSemasi>;

/**
 * Satır içi formların ortak "ilk hatalı alana odaklan" yardımcısı.
 *
 * Gönder düğmesi geçerlilikle KAPANMAZ (kilitli karar): geçersiz formda
 * basılır, gönderim yapılmaz, hata alanda belirir, odak oraya gider.
 */
function ilkHatayaOdaklan<T extends Record<string, unknown>>(
  form: UseFormReturn<T>,
  sira: readonly (keyof T & string)[]
) {
  // Hatalar `onInvalid` ARGÜMANINDAN okunur; `form.formState.errors` gönderim
  // anında henüz boştur ve odak hiçbir yere taşınmaz (İP-A7d2, gerçek
  // tarayıcı turunda ölçüldü).
  return (hatalar: Record<string, unknown>) => {
    const alan = sira.find((a) => hatalar[a]);
    if (alan) form.setFocus(alan as never);
  };
}

function CourierAvatar({ c, size = "h-10 w-10" }: { c: Courier; size?: string }) {
  if (c.photo_url) {
    return (
      <img
        src={c.photo_url}
        alt={c.name}
        className={`${size} shrink-0 rounded-full object-cover ring-1 ring-slate-200 `}
      />
    );
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500 `}
    >
      {c.name.charAt(0).toLocaleUpperCase("tr")}
    </span>
  );
}

/** Kuryenin giriş hesabı (rol 5) — satır altında açılan yaşam döngüsü bölümü.
 *  Hesap sorgusu yalnız bölüm açıkken atılır (satır başına otomatik istek yok). */
function CourierAccountPanel({ c }: { c: Courier }) {
  const kapatma = useDuzenlemeYuzeyi<{ id: number }, void>();
  const { data: account, isLoading } = useCourierAccount(c.id);
  const createAccount = useCreateCourierAccount();
  const closeAccount = useCloseCourierAccount();
  const [resetting, setResetting] = useState(false);

  if (isLoading) {
    return <div className="mb-3 h-9 animate-pulse rounded-lg bg-slate-100 " />;
  }

  if (account?.is_active) {
    return (
      <>
        <div className="mb-3 space-y-2 border-t border-slate-100 pt-3 ">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs text-slate-500 ">
              <span className="font-semibold text-slate-700 ">
                Giriş hesabı:
              </span>{" "}
              {account.email}
            </p>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={resetting}
              onClick={() => setResetting((v) => !v)}
            >
              Şifre sıfırla
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={closeAccount.isPending}
              onClick={() => kapatma.ac({ id: account.id })}
            >
              Hesabı kapat
            </Button>
          </div>
          {resetting && (
            <SifreSifirlamaFormu
              accountId={account.id}
              onBitti={() => setResetting(false)}
            />
          )}
        </div>
        <ConfirmDialog
          open={kapatma.acik}
          title="Kurye giriş hesabını kapat"
          description={`${c.name} için açık oturumlar anında sonlandırılacak.`}
          confirmLabel="Hesabı kapat"
          danger
          isPending={closeAccount.isPending}
          onClose={kapatma.kapat}
          onConfirm={() => {
            const hedef = kapatma.kayit;
            if (!hedef) return;
            closeAccount.mutate(hedef.id, {
              onSuccess: () => {
                toast.success("Hesap kapatıldı — oturumları sonlandırıldı.");
                kapatma.kapat();
              },
              onError: (e: any) =>
                toast.error(e?.response?.data?.detail ?? "Hesap kapatılamadı."),
            });
          }}
        />
      </>
    );
  }

  return (
    <div className="mb-3 space-y-2 border-t border-slate-100 pt-3 ">
      <p className="text-xs text-slate-500 ">
        Giriş hesabı yok — kurye saha ekranına kendi hesabıyla girsin diye oluşturun.
      </p>
      <HesapOlusturmaFormu
        c={c}
        gonderiliyor={createAccount.isPending}
        gonder={(deger, hataYaz, temizle) =>
          createAccount.mutate(
            {
              courierId: c.id,
              email: deger.email.trim().toLowerCase(),
              password: deger.password,
              first_name: deger.first_name.trim(),
              last_name: deger.last_name.trim(),
            },
            {
              onSuccess: () => {
                temizle();
                toast.success("Giriş hesabı oluşturuldu.");
              },
              onError: hataYaz,
            }
          )
        }
      />
    </div>
  );
}

const HESAP_SIRA = ["first_name", "last_name", "email", "password"] as const;

function HesapOlusturmaFormu({
  c,
  gonderiliyor,
  gonder,
}: {
  c: Courier;
  gonderiliyor: boolean;
  gonder: (
    deger: HesapFormDegerleri,
    hataYaz: (h: unknown) => void,
    temizle: () => void
  ) => void;
}) {
  const parcalar = c.name.trim().split(/\s+/);
  const form = useForm<HesapFormDegerleri>({
    resolver: zodResolver(hesapSemasi),
    defaultValues: {
      first_name: parcalar.slice(0, -1).join(" ") || c.name,
      last_name: parcalar.length > 1 ? parcalar[parcalar.length - 1] : "",
      email: "",
      password: "",
    },
    mode: "onChange",
    shouldFocusError: false,
  });

  // PENCERESİZ beyanı (İP-A7d2 · Görev 1): bu form bir pencerede DEĞİL,
  // kurye satırının altında yaşıyor. Beyan olmadan bekçi geliştirmede patlar
  // — çünkü sağlayıcısızlık sessizce "koruma yok" demek olurdu.
  useYuzeyKirliFormBekcisi({
    form,
    sunucuHatasi: form.formState.errors.root?.sunucu ?? null,
    pencereSiz: true,
  });

  const calistir = form.handleSubmit((deger) => {
    form.clearErrors("root.sunucu");
    gonder(
      deger,
      (hata) => {
        const kalan = sunucuHatasiniUygula(hata, form, [...HESAP_SIRA]);
        form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
      },
      () => form.reset({ ...form.getValues(), password: "" })
    );
  }, ilkHatayaOdaklan(form, HESAP_SIRA));

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="space-y-2">
      {genelHata && (
        <p role="alert" className="text-xs text-rose-600 ">
          {genelHata}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Form.Field
          control={form.control}
          name="first_name"
          render={({ field }) => (
            <Form.Item className="w-28">
              <Form.Label className="mb-1 block text-xs font-semibold text-slate-600 ">
                Ad
              </Form.Label>
              <Form.Control>
                <input className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="last_name"
          render={({ field }) => (
            <Form.Item className="w-28">
              <Form.Label className="mb-1 block text-xs font-semibold text-slate-600 ">
                Soyad
              </Form.Label>
              <Form.Control>
                <input className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="email"
          render={({ field }) => (
            <Form.Item className="w-52">
              <Form.Label className="mb-1 block text-xs font-semibold text-slate-600 ">
                E-posta
              </Form.Label>
              <Form.Control>
                <input type="email" autoComplete="off" className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="password"
          render={({ field }) => (
            <Form.Item className="w-44">
              <Form.Label className="mb-1 block text-xs font-semibold text-slate-600 ">
                Şifre
              </Form.Label>
              <Form.Control>
                <input type="password" autoComplete="new-password" className="input" {...field} />
              </Form.Control>
              <Form.Hint className="text-xs text-slate-400">En az 8 karakter.</Form.Hint>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Button size="sm" isPending={gonderiliyor} onClick={calistir}>
          Hesap oluştur
        </Button>
      </div>
    </div>
  );
}

function SifreSifirlamaFormu({
  accountId,
  onBitti,
}: {
  accountId: number;
  onBitti: () => void;
}) {
  const resetPassword = useResetCourierPassword();
  const form = useForm<SifreFormDegerleri>({
    resolver: zodResolver(sifreSemasi),
    defaultValues: { password: "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  // Satır içi form — beyan zorunlu (bkz. `HesapOlusturmaFormu`).
  useYuzeyKirliFormBekcisi({
    form,
    sunucuHatasi: resetPassword.error,
    pencereSiz: true,
  });

  const calistir = form.handleSubmit((deger) => {
    resetPassword.mutate(
      { accountId, newPassword: deger.password },
      {
        onSuccess: () => {
          form.reset({ password: "" });
          onBitti();
          toast.success("Şifre güncellendi.");
        },
        onError: (e: any) => {
          const kalan = sunucuHatasiniUygula(e, form, ["password"]);
          form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
        },
      }
    );
  }, ilkHatayaOdaklan(form, ["password"]));

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="space-y-1">
      {genelHata && (
        <p role="alert" className="text-xs text-rose-600 ">
          {genelHata}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Form.Field
          control={form.control}
          name="password"
          render={({ field }) => (
            <Form.Item className="w-48">
              <Form.Label className="mb-1 block text-xs font-semibold text-slate-600 ">
                Yeni şifre
              </Form.Label>
              <Form.Control>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  autoFocus
                  {...field}
                />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Button size="sm" isPending={resetPassword.isPending} onClick={calistir}>
          Şifreyi kaydet
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            form.reset({ password: "" });
            onBitti();
          }}
        >
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

const KURYE_SIRA = ["name", "phone"] as const;

/** Kurye satırının düzenleme formu — satır içi, PENCERESİZ. */
function KuryeSatirFormu({ c, onBitti }: { c: Courier; onBitti: () => void }) {
  const update = useUpdateCourier();
  const form = useForm<KuryeFormDegerleri>({
    resolver: zodResolver(kuryeSemasi),
    defaultValues: { name: c.name, phone: c.phone ?? "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: update.error, pencereSiz: true });

  const calistir = form.handleSubmit((deger) => {
    update.mutate(
      { courierId: c.id, payload: { name: deger.name.trim(), phone: deger.phone.trim() || null } },
      {
        onSuccess: () => {
          form.reset(deger);
          onBitti();
        },
        onError: (e: any) => {
          const kalan = sunucuHatasiniUygula(e, form, [...KURYE_SIRA]);
          form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
        },
      }
    );
  }, ilkHatayaOdaklan(form, KURYE_SIRA));

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <li className="py-3">
      {genelHata && (
        <p role="alert" className="mb-1 text-xs text-rose-600 ">
          {genelHata}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <CourierAvatar c={c} />
        <Form.Field
          control={form.control}
          name="name"
          render={({ field }) => (
            <Form.Item className="w-36">
              <Form.Label className="mb-1 block text-xs font-semibold text-slate-600 ">
                Kurye adı
              </Form.Label>
              <Form.Control>
                <input className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="phone"
          render={({ field }) => (
            <Form.Item className="w-36">
              <Form.Label
                optional
                className="mb-1 block text-xs font-semibold text-slate-600 "
              >
                Telefon
              </Form.Label>
              <Form.Control>
                <input className="input" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
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

function CourierRow({ c }: { c: Courier }) {
  const update = useUpdateCourier();
  const remove = useDeleteCourier();
  const uploadPhoto = useUploadCourierPhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const silme = useDuzenlemeYuzeyi<Courier, void>();

  if (editing) {
    return <KuryeSatirFormu c={c} onBitti={() => setEditing(false)} />;
  }

  return (
    <>
      <li>
        <div className="flex items-center gap-3 py-3">
          <button
            type="button"
            aria-label={`${c.name} için fotoğraf yükle`}
            onClick={() => fileRef.current?.click()}
            className="group/foto relative"
          >
            <CourierAvatar c={c} />
            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white opacity-0 transition group-hover/foto:opacity-100 ">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-2.5 w-2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            // Görsel olarak gizli ama GERÇEK bir kontrol: adı olmadan ekran
            // okuyucuda "file upload" diye çıkar. `hidden` ÖZNİTELİĞİ
            // kullanılmadı — o, alanı ölçümün dışına çıkarır ve borç
            // kapanmadan sayaçtan düşerdi.
            aria-label={`${c.name} için vesikalık dosyası`}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                uploadPhoto.mutate(
                  { courierId: c.id, file: f },
                  {
                    onSuccess: () => toast.success("Fotoğraf güncellendi."),
                    onError: () => toast.error("Fotoğraf yüklenemedi."),
                  }
                );
              e.target.value = "";
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900 ">
              {c.name}
              {!c.is_active && (
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ">
                  pasif
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500 ">{c.phone || "—"}</p>
          </div>
          {/* Aksiyon şeridi ARTIK HOVER'A BAĞLI DEĞİL (İP-A7d2).
              Eskiden `opacity-0 … group-hover:opacity-100` idi: dokunmatik
              ekranda hover yoktur, yani tablette bu satır düzenlenemiyordu.
              Projenin yazılı kuralı zaten "hover-only aksiyon YOK". */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={showAccount}
              onClick={() => setShowAccount((v) => !v)}
            >
              Hesap
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Düzenle
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isPending={update.isPending}
              onClick={() =>
                update.mutate({ courierId: c.id, payload: { is_active: !c.is_active } })
              }
            >
              {c.is_active ? "Pasifleştir" : "Aktifleştir"}
            </Button>
            <Button size="sm" variant="danger" onClick={() => silme.ac(c)}>
              Sil
            </Button>
          </div>
        </div>
        {showAccount && <CourierAccountPanel c={c} />}
      </li>
      <ConfirmDialog
        open={silme.acik}
        title="Kurye profilini sil"
        description={`${c.name} kurye profili silinecek.`}
        confirmLabel="Kuryeyi sil"
        danger
        isPending={remove.isPending}
        onClose={silme.kapat}
        onConfirm={() =>
          remove.mutate(c.id, {
            onSuccess: () => silme.kapat(),
            onError: () => toast.error("Silinemedi."),
          })
        }
      />
    </>
  );
}

export function CourierManager() {
  const { canManage } = useAdminAreaAccess("delivery");
  const { data: couriers = [], isLoading } = useCouriers();
  const [adding, setAdding] = useState(false);

  return (
    <section className="mt-6 rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 ">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 ">
        <div>
          <h2 className="text-base font-bold text-slate-900 ">Kuryeler</h2>
          <p className="mt-0.5 text-xs text-slate-500 ">
            Müşteri takip kimliği (isim, fotoğraf) + saha ekranı giriş hesabı.
          </p>
        </div>
        {canManage && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            Kurye ekle
          </Button>
        )}
      </div>
      <div className="px-6">
        {adding && <KuryeEklemeFormu onBitti={() => setAdding(false)} />}
        {isLoading ? (
          <div className="space-y-2 py-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 " />
            ))}
          </div>
        ) : couriers.length === 0 && !adding ? (
          <p className="py-6 text-center text-sm text-slate-400 ">
            Henüz kurye yok — takip sayfasında kimlik göstermek için ekleyin.
          </p>
        ) : !canManage ? (
          // Salt-okunur rol: kimlik listesi görünür, düzenleme/hesap yüzeyi açılmaz.
          <ul className="divide-y divide-slate-100 ">
            {couriers.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <CourierAvatar c={c} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 ">{c.name}</p>
                  {c.phone && (
                    <p className="text-xs text-slate-500 ">{c.phone}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-slate-100 ">
            {couriers.map((c) => (
              <CourierRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** "Kurye ekle" satır içi formu — PENCERESİZ. */
function KuryeEklemeFormu({ onBitti }: { onBitti: () => void }) {
  const create = useCreateCourier();
  const form = useForm<{ name: string }>({
    resolver: zodResolver(kuryeSemasi.pick({ name: true })),
    defaultValues: { name: "" },
    mode: "onChange",
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: create.error, pencereSiz: true });

  const calistir = form.handleSubmit((deger) => {
    create.mutate(
      { name: deger.name.trim() },
      {
        onSuccess: () => {
          form.reset({ name: "" });
          onBitti();
          toast.success("Kurye eklendi.");
        },
        onError: (e: any) => {
          const kalan = sunucuHatasiniUygula(e, form, ["name"]);
          form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
        },
      }
    );
  }, ilkHatayaOdaklan(form, ["name"]));

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="border-b border-slate-100 py-3 ">
      {genelHata && (
        <p role="alert" className="mb-1 text-xs text-rose-600 ">
          {genelHata}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Form.Field
          control={form.control}
          name="name"
          render={({ field }) => (
            <Form.Item className="w-44">
              <Form.Label className="mb-1 block text-xs font-semibold text-slate-600 ">
                Kurye adı
              </Form.Label>
              <Form.Control>
                <input className="input" autoFocus placeholder="İsim Soyisim" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />
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
