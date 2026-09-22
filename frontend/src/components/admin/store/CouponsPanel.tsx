/**
 * Mağaza "Kuponlar" sekmesi.
 *
 * ## İP-A6 · Görev 4a — göç
 *
 * Değişen:
 *
 *   - Altı alanın hepsi `Form.Item` + `Form.Label` + `Form.Control` içinde.
 *     Eskiden hepsi `placeholder`la "adlandırılmıştı" (`KOD`, `Değer`,
 *     `Min sepet`…) — `placeholder` erişilebilir ad değildir ve alan
 *     doldurulunca kaybolur; ekran okuyucu altı kutuyu da adsız okuyordu.
 *   - Yerel `inputCls` sabiti SİLİNDİ (A5'in "yedi tekrar eden desen"
 *     listesinin biri). Ortak `.input` sınıfına devredildi.
 *   - Elle `useState<CouponCreate>` → `react-hook-form` + zod
 *     (`lib/storeCouponForm`). Eski doğrulama TEK kuraldı ("kod boş mu") ve
 *     sonucu bir toast'a iniyordu; hangi alanın yanlış olduğu görünmüyordu.
 *   - Gönder düğmesi geçerlilik yüzünden KAPANMAZ (kalıcı kural): geçersizse
 *     istek gitmez, hatalar alanların altında belirir ve odak ilk hatalı
 *     alana taşınır.
 *   - Ham `<button>`ler ortak `Button`a; silme onayının pencere durumu
 *     ekrandan `ui2/duzenlemeYuzeyi`ne.
 *
 * Değişmeyen: yetki kapıları, hata≠boş durum ayrımı, aktif/pasif anahtarı,
 * silmenin onay penceresinden geçmesi, sunucu gövdesinin alanları.
 */
import { useEffect, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { AccessDenied, ReadOnlyNotice, useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, ErrorState } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/yuzeyDurumu";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import {
  useCoupons,
  useCreateCoupon,
  useDeleteCoupon,
  useUpdateCoupon,
} from "@/hooks/useStore";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import {
  BOS_KUPON,
  kuponFormSemasi,
  kuponGovdesi,
  type KuponFormDegerleri,
} from "@/lib/storeCouponForm";
import { toast } from "@/store/toastStore";

/** `sunucuHatasiniUygula` için BEYAZ LİSTE — formda karşılığı olan alanlar. */
const ALANLAR = [
  "kod",
  "indirimTuru",
  "indirimDegeri",
  "minSepet",
  "maksKullanim",
  "kisiBasi",
] as const;

/** Sunucu alan adı → form alan adı (422 `loc` eşlemesi). */
const SUNUCU_ALAN_ESLEMESI: Record<string, string> = {
  code: "kod",
  discount_type: "indirimTuru",
  discount_value: "indirimDegeri",
  min_subtotal: "minSepet",
  max_uses: "maksKullanim",
  per_user_limit: "kisiBasi",
};

/** Alanların GÖRSEL sırası; "ilk hatalı alan" bu sıradan okunur. */
const GORSEL_SIRA = [
  "kod",
  "indirimTuru",
  "indirimDegeri",
  "minSepet",
  "maksKullanim",
  "kisiBasi",
] as const;

export function CouponsPanel() {
  const { canView, canManage } = useAdminAreaAccess("coupons");
  const { data: coupons, isLoading, isError, error, refetch } = useCoupons();
  const create = useCreateCoupon();
  const update = useUpdateCoupon();
  const del = useDeleteCoupon();
  // Pencere durumu EKRANDA yaşamaz (İP-A4 sözleşmesi): silme onayının hedefi
  // düzenleme yüzeyinde tutulur, böylece rota tabanlı yüzeylere geçiş kararı
  // bu dosyayı ilgilendirmez.
  const silmeYuzeyi = useDuzenlemeYuzeyi<{ id: number; code: string }>();

  const form = useForm<KuponFormDegerleri>({
    resolver: zodResolver(kuponFormSemasi),
    defaultValues: BOS_KUPON,
    mode: "onChange",
    // Odaklamayı kendimiz yapıyoruz; RHF'inki `onInvalid`ten sonra çalışıp
    // bizimkini ezer (İP-A3c pilotunda ölçüldü).
    shouldFocusError: false,
  });

  // Sunucu hatasını alanlara dağıt; alana düşmeyen kısım şeritte kalır.
  const [genelHata, setGenelHata] = useState<string | null>(null);
  useEffect(() => {
    const hata = create.error;
    if (!hata) {
      setGenelHata(null);
      return;
    }
    setGenelHata(
      sunucuHatasiniUygula(hata, form, ALANLAR, SUNUCU_ALAN_ESLEMESI, (h) =>
        getErrorDetail(h, "Kupon oluşturulamadı")
      )
    );
    // `form` kimliğini korur; bağımlılığa eklemek aynı hatayı iki kez dağıtırdı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create.error]);

  const gonder = form.handleSubmit(
    (degerler) => {
      create.mutate(kuponGovdesi(degerler), {
        onSuccess: () => {
          toast.success("Kupon oluşturuldu");
          form.reset(BOS_KUPON);
        },
        // Hata alanlara yukarıdaki efektte dağıtılır; toast'a GİTMEZ
        // (İP-A2 hata yönlendirme sözleşmesi).
      });
    },
    (hatalar: FieldErrors<KuponFormDegerleri>) => {
      const ilk = GORSEL_SIRA.find((a) => hatalar[a]);
      if (ilk) form.setFocus(ilk);
    }
  );

  if (!canView) return <AccessDenied area="Kuponlar" />;
  if (isError) {
    return (
      <ErrorState
        description={getErrorDetail(error, "Kuponlar yüklenemedi.")}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {!canManage && <ReadOnlyNotice />}
      {/* Oluştur */}
      {canManage && (
        <div className="rounded-2xl border border-slate-200 p-4 ">
          <h3 className="mb-3 text-sm font-semibold text-slate-900 ">Yeni kupon</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Form.Field
              control={form.control}
              name="kod"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Kod</Form.Label>
                  <Form.Control>
                    {/* Büyük harfe çevirme GÖRSELdir (`uppercase`); gövdedeki
                        dönüşüm `kuponGovdesi`de yapılır. İkisini de girişte
                        yapmak, kullanıcının yazdığı imleci zıplatıyordu. */}
                    <input className="input uppercase" placeholder="KOD" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="indirimTuru"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>İndirim türü</Form.Label>
                  <Form.Control>
                    <select className="input" {...field}>
                      <option value="PERCENT">Yüzde %</option>
                      <option value="FIXED">Sabit TL</option>
                    </select>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="indirimDegeri"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Değer</Form.Label>
                  <Form.Control>
                    <input className="input" type="number" inputMode="decimal" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="minSepet"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Min sepet</Form.Label>
                  <Form.Control>
                    <input className="input" type="number" inputMode="decimal" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="maksKullanim"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Maks kullanım</Form.Label>
                  <Form.Control>
                    <input className="input" type="number" inputMode="numeric" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            <Form.Field
              control={form.control}
              name="kisiBasi"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label optional>Kişi başı</Form.Label>
                  <Form.Control>
                    <input className="input" type="number" inputMode="numeric" {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>

          {/* YALNIZ genel/sunucu hatası; alan hataları kendi alanlarının
              altında durur ve buraya asla düşmez. */}
          {genelHata && (
            <p
              role="alert"
              className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 "
            >
              {genelHata}
            </p>
          )}

          {/* Geçerlilik kapısı YOK: `isPending` yalnız çift gönderimi engeller. */}
          <Button className="mt-3" isPending={create.isPending} onClick={gonder}>
            Kupon oluştur
          </Button>
        </div>
      )}

      {/* Liste */}
      {isLoading ? (
        <p className="text-sm text-slate-400">Yükleniyor…</p>
      ) : !coupons || coupons.length === 0 ? (
        <p className="text-sm text-slate-400">Henüz kupon yok.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 "
            >
              <div className="text-sm">
                <span className="font-semibold text-slate-900 ">{c.code}</span>
                <span className="ml-2 text-slate-500">
                  {c.discount_type === "PERCENT" ? `%${c.discount_value}` : formatTL(c.discount_value)} indirim
                </span>
                <span className="ml-2 text-xs text-slate-400">
                  min {formatTL(c.min_subtotal)} · kullanım {c.used_count}
                  {c.max_uses ? `/${c.max_uses}` : ""}
                </span>
              </div>
              {canManage && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={c.is_active ? "success" : "secondary"}
                    onClick={() => update.mutate({ id: c.id, payload: { is_active: !c.is_active } })}
                  >
                    {c.is_active ? "Aktif" : "Pasif"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => silmeYuzeyi.ac({ id: c.id, code: c.code })}>
                    Sil
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={silmeYuzeyi.acik}
        title="Kuponu sil"
        description={silmeYuzeyi.kayit ? `${silmeYuzeyi.kayit.code} kuponu silinecek.` : ""}
        confirmLabel="Kuponu sil"
        danger
        isPending={del.isPending}
        onClose={silmeYuzeyi.kapat}
        onConfirm={() =>
          silmeYuzeyi.kayit &&
          del.mutate(silmeYuzeyi.kayit.id, { onSuccess: silmeYuzeyi.kapat })
        }
      />
    </div>
  );
}
