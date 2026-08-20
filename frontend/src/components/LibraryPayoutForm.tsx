import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { fetchLibraryPayout, submitLibraryPayout } from "@/api/libraries";
import { Button } from "@/components/admin/ui";
import {
  useYuzeyKirliFormBekcisi,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Form, sunucuHatasiniUygula } from "@/components/admin/ui2/form";
import { getErrorMessage } from "@/lib/errors";
import { toast } from "@/store/toastStore";
import type { PayoutStatus } from "@/types";

const STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  NONE: { label: "Bilgi yok", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  PENDING: { label: "Doğrulama bekleniyor", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  ACTIVE: { label: "Doğrulandı ✓", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  REJECTED: { label: "Reddedildi", cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

/**
 * İP-A7d3 · göç dalgası 3.
 *
 * Beş alanın beşi de `placeholder`ı etiket yerine kullanıyordu ve doğrulama
 * `toast.error` ile veriliyordu: kullanıcı "Geçerli TR IBAN girin." yazısını
 * ekranın altında görüyor, HANGİ alanın yanlış olduğunu formdan okuyamıyordu.
 * Beş borcun beşi de bu ekranın kalemiydi ve `CALISMA_ZAMANI_ADSIZ` tabanında
 * isimle yazılıydı.
 *
 * Alanların şeması SUNUCUNUN kabul ettiği biçimdir; IBAN boşlukları kırpılıp
 * büyük harfe çevrilerek doğrulanır — kullanıcı IBAN'ı bankadan boşluklu
 * kopyalar.
 */
const semasi = z.object({
  contact_name: z
    .string()
    .refine((v) => v.trim().length >= 2, "Sorumlu kişinin adını soyadını yazın."),
  contact_email: z
    .string()
    .refine((v) => v.trim().length >= 3, "E-posta adresi gerekli.")
    .refine((v) => v.includes("@"), "E-posta adresi geçerli görünmüyor."),
  iban: z
    .string()
    .refine(
      (v) => /^TR\d{24}$/.test(v.replace(/\s+/g, "").toUpperCase()),
      "TR ile başlayan 26 karakterli bir IBAN girin."
    ),
  tckn: z.string().refine((v) => /^\d{11}$/.test(v.trim()), "TCKN 11 haneli olmalı."),
  gsm: z.string().max(20, "Telefon en fazla 20 karakter olabilir."),
});

type FormDegerleri = z.infer<typeof semasi>;

/** Odak sırası = ekrandaki görsel sıra (gönderimde ilk hatalı alana gidilir). */
const SIRA = ["contact_name", "contact_email", "iban", "tckn", "gsm"] as const;

/**
 * Kütüphane ödeme hesabı (alt üye işyeri) formu — admin penceresinde ve
 * operatör panelinde PAYLAŞILIR.
 *
 * `pencereSiz: true` beyanı KOŞULSUZ yazılır ve bu bilinçlidir: bileşen hem
 * satır içi (`Balance`, `Settings`) hem pencere içinde (`AdminLibraries`'in
 * ödeme yüzeyi) yaşıyor. Beyan pencereli kullanımda zararsızdır — bekçi
 * pencereye yine bildirilir, ×/ESC/dış tıklama yine sorar (İP-A7d2 · SK-3
 * tablosu: "sağlayıcı var + beyan var → geçer"). `ProductForm`daki gibi
 * `mode`dan türetilemez, çünkü bu bileşen nerede olduğunu bilmiyor ve
 * bilmemeli.
 */
export function LibraryPayoutForm({ libraryId }: { libraryId: number }) {
  const qc = useQueryClient();
  const { data: payout } = useQuery({
    queryKey: ["library-payout", libraryId],
    queryFn: () => fetchLibraryPayout(libraryId),
  });
  const submit = useMutation({
    mutationFn: (payload: {
      iban: string;
      tckn: string;
      gsm?: string | null;
      contact_name: string;
      contact_email: string;
    }) => submitLibraryPayout(libraryId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library-payout", libraryId] });
      toast.success("Ödeme bilgisi alındı.");
    },
  });

  const form = useForm<FormDegerleri>({
    resolver: zodResolver(semasi),
    defaultValues: { contact_name: "", contact_email: "", iban: "", tckn: "", gsm: "" },
    mode: "onChange",
    // Odak `onInvalid` argümanından verilir: `formState.errors` gönderim anında
    // HENÜZ BOŞTUR ve odak `<body>`ye düşerdi (İP-A7d2 · C-1).
    shouldFocusError: false,
  });

  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: submit.error, pencereSiz: true });

  const status: PayoutStatus = payout?.payout_status ?? "NONE";
  const meta = STATUS_META[status];

  const gonder = form.handleSubmit(
    (deger) => {
      form.clearErrors("root.sunucu");
      submit.mutate(
        {
          iban: deger.iban.replace(/\s+/g, "").toUpperCase(),
          tckn: deger.tckn.trim(),
          gsm: deger.gsm.trim() || null,
          contact_name: deger.contact_name.trim(),
          contact_email: deger.contact_email.trim(),
        },
        {
          onError: (hata) => {
            const kalan = sunucuHatasiniUygula(hata, form, [...SIRA], undefined, (h) =>
              getErrorMessage(h, "Kaydedilemedi.")
            );
            form.setError("root.sunucu", { type: "server", message: kalan ?? undefined });
          },
        }
      );
    },
    (hatalar) => {
      const alan = SIRA.find((a) => hatalar[a]);
      if (alan) form.setFocus(alan);
    }
  );

  const genelHata = form.formState.errors.root?.sunucu?.message;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Deneme/çalışma ücretleri iyzico üzerinden doğrudan bu IBAN&apos;a yatar; sorumlu kişinin
          kimliğini iyzico doğrular.
        </p>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
          {meta.label}
        </span>
      </div>
      {payout?.iban_masked && (
        <p className="font-mono text-sm text-slate-700 dark:text-slate-200">
          {payout.iban_masked}
        </p>
      )}

      {genelHata && (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {genelHata}
        </p>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Form.Field
            control={form.control}
            name="contact_name"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Sorumlu kişi adı soyadı</Form.Label>
                <Form.Control>
                  <input className="input" autoComplete="name" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="contact_email"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>E-posta</Form.Label>
                <Form.Control>
                  <input className="input" type="email" autoComplete="email" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>

        <Form.Field
          control={form.control}
          name="iban"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>IBAN</Form.Label>
              <Form.Control>
                <input className="input font-mono" placeholder="TR00 0000 …" {...field} />
              </Form.Control>
              <Form.ErrorMessage />
            </Form.Item>
          )}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Form.Field
            control={form.control}
            name="tckn"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Sorumlu TCKN (11 hane)</Form.Label>
                <Form.Control>
                  <input
                    className="input"
                    maxLength={11}
                    inputMode="numeric"
                    {...field}
                    onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))}
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
          <Form.Field
            control={form.control}
            name="gsm"
            render={({ field }) => (
              <Form.Item>
                <Form.Label optional>Telefon</Form.Label>
                <Form.Control>
                  <input className="input" maxLength={20} inputMode="tel" {...field} />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>

        <div className="flex justify-end">
          {/* Düğme geçerlilikle KAPANMAZ (kilitli karar). */}
          <Button isPending={submit.isPending} onClick={gonder}>
            Kaydet &amp; Doğrula
          </Button>
        </div>
      </div>
    </div>
  );
}
