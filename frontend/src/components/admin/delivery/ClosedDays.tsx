// Teslimat takvimi (kapalı günler) — tek runtime-yönetilebilir operasyon ayarı.
// Söz motoru bu tarihlere teslimat sözü vermez. Resmî tatiller tek tıkla
// yüklenir (yalnız 2026 verisi mevcut); admin istemediğini siler, ek gün ekler.
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useAdminAreaAccess } from "@/components/admin/AccessState";
import { Button, ConfirmDialog, EmptyState, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi, useYuzeyKirliFormBekcisi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import {
  useAddClosedDay,
  useClosedDays,
  useRemoveClosedDay,
  useSeedHolidays,
} from "@/hooks/useDelivery";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";

const CLOSED_DAY_FMT = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  weekday: "long",
});

/**
 * -- IP-A7d4 - goc dalgasi 4 --
 *
 * Iki borc birden kapandi:
 *   - `seedOpen` pencere durumu ekranda yasiyordu -> `useDuzenlemeYuzeyi`.
 *   - "Gunu kapat" dugmesi `disabled={!newDay}` ile GECERLILIKLE KAPANIYORDU
 *     (kilitli kararin acik ihlali). Gun secmeden basan kullanici dugmenin
 *     neden olu oldugunu goremiyordu; artik hata alanin altinda cikiyor.
 */
const gunSemasi = z.object({
  day: z.string().min(1, "Kapatılacak günü seçin."),
  label: z.string().max(120, "Açıklama en fazla 120 karakter olabilir."),
});

type GunDegerleri = z.infer<typeof gunSemasi>;

export function ClosedDays() {
  const { canManage } = useAdminAreaAccess("delivery");
  const query = useClosedDays();
  const add = useAddClosedDay();
  const remove = useRemoveClosedDay();
  const seed = useSeedHolidays();
  // Pencere durumu ekranda YASAMAZ (IP-A4 sozlesmesi).
  const seedYuzeyi = useDuzenlemeYuzeyi<void, void>();
  const days = query.data ?? [];
  const year = new Date().getFullYear();

  const form = useForm<GunDegerleri>({
    resolver: zodResolver(gunSemasi),
    defaultValues: { day: "", label: "" },
    mode: "onChange",
    shouldFocusError: false,
  });
  // Satir ici form: pencere yok, bekci yalniz rota/sekme korumasini kurar.
  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: add.error, pencereSiz: true });

  const doAdd = form.handleSubmit(
    (deger) => {
      add.mutate(
        { day: deger.day, label: deger.label.trim() || undefined },
        {
          onSuccess: () => {
            toast.success("Gün teslimata kapatıldı.");
            form.reset({ day: "", label: "" });
          },
          onError: (e) => {
            const kalan = sunucuHatasiniUygula(e, form, ["day", "label"], undefined, (h) =>
              getErrorMessage(h, "Eklenemedi.")
            );
            if (kalan) toast.error(kalan);
          },
        }
      );
    },
    (hatalar) => form.setFocus(hatalar.day ? "day" : "label")
  );

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div className="mr-auto">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Teslimat Takvimi</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Kapalı günler — söz motoru bu tarihlere teslimat sözü vermez. Hafta 7 gün açık.
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => seedYuzeyi.yeniAc()} isPending={seed.isPending}>
            Resmî tatilleri yükle
          </Button>
        )}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <Form.Field
            control={form.control}
            name="day"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Kapatılacak gün</Form.Label>
                <Form.Control>
                  {/* Koyu temada yerel tarih widget'i (SK-6): sema kok
                      ogeden (`html.dark { color-scheme: dark }`, index.css)
                      miras alinir. ESKI YORUM YANLISTI — ortak `.input`
                      sinifi `color-scheme` TASIMIYORDU ve o yanlis inanc
                      dokuz widget'in korumasiz kalmasinin koku oldu
                      (bagimsiz denetim #3 - B-15/B-9). */}
                  <input type="date" className="input w-auto" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="label"
            render={({ field }) => (
              <Form.Item className="min-w-[10rem] flex-1">
                <Form.Label optional>Açıklama</Form.Label>
                <Form.Control>
                  <input
                    type="text"
                    placeholder="ör. Kurban Bayramı, yıllık bakım…"
                    maxLength={120}
                    className="input w-full"
                    {...field}
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          {/* Dugme gecerlilikle KAPANMAZ (kilitli karar). */}
          <Button size="sm" variant="secondary" onClick={doAdd} isPending={add.isPending}>
            Günü kapat
          </Button>
        </div>
      )}

      {query.isError ? (
        <div className="p-6">
          <ErrorState
            description={getErrorMessage(query.error, "Takvim yüklenemedi.")}
            onRetry={() => query.refetch()}
          />
        </div>
      ) : query.isLoading ? (
        <div className="p-6">
          <PageSkeleton rows={2} />
        </div>
      ) : days.length === 0 ? (
        <div className="p-6">
          <EmptyState
            title="Yaklaşan kapalı gün yok"
            description="Teslimat her gün açık. Resmî tatilleri yükleyebilir ya da elle gün kapatabilirsiniz."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 px-6 dark:divide-slate-800">
          {days.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3">
              <span className="w-52 shrink-0 text-sm font-medium text-slate-900 dark:text-white">
                {CLOSED_DAY_FMT.format(new Date(`${d.day}T00:00:00`))}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">
                {d.label ?? (d.source === "holiday" ? "Resmî tatil" : "Kapalı")}
              </span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    remove.mutate(d.id, {
                      onError: (e) => toast.error(getErrorMessage(e, "Açılamadı.")),
                    })
                  }
                  disabled={remove.isPending}
                  title="Bu günü yeniden aç"
                  aria-label={CLOSED_DAY_FMT.format(new Date(d.day + "T00:00:00")) + " gününü yeniden aç"}
                  className="min-h-9 min-w-9 shrink-0 px-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={seedYuzeyi.acik}
        title={`${year} resmî tatillerini yükle`}
        description="Yılın resmî tatilleri teslimata kapalı olarak işaretlenir (yinelenenler atlanır). İstemediğiniz günü listeden silebilirsiniz. Not: tatil verisi şimdilik yalnız 2026 için tanımlı."
        confirmLabel="Yükle"
        isPending={seed.isPending}
        onClose={seedYuzeyi.kapat}
        onConfirm={() =>
          seed.mutate(year, {
            onSuccess: (r) => {
              toast.success(
                r.length > 0 ? `${r.length} resmî tatil yüklendi.` : "Bu yıl için tatil verisi yok."
              );
              seedYuzeyi.kapat();
            },
            onError: (e) => toast.error(getErrorMessage(e, "Yüklenemedi.")),
          })
        }
      />
    </section>
  );
}
