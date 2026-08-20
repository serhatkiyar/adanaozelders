/**
 * İP-A6c · Görev 6 — iki görsel kusurun gerçek tarayıcı sondası.
 *
 * jsdom ne renk hesaplar ne de yerel widget çizer; ikisi de ancak gerçek
 * Chrome'da görülür. Sayfa hiçbir sunucuya bağlanmaz, gerçek veri kullanmaz.
 *
 *   6a — hata kırmızısının iki temadaki kontrastı (`rose-600` → `rose-700`).
 *   6b — `<input type="number">`ın yerel artır/azalt oklarının koyu temada
 *        beyaz blok gibi çizilmesi. Sayfa aynı alanı İKİ kez basar: solda
 *        `Form.Control`dan geçen (onarımlı), sağda ham `<input>` (onarımsız).
 *        Fark ekran görüntüsünde yan yana görülür.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Form } from "@/components/admin/ui2/form";
import "@/index.css";

const sema = z.object({ miktar: z.coerce.number().min(1, "Miktar en az 1 olmalı.") });

function Sonda() {
  const form = useForm<{ miktar: number }>({
    resolver: zodResolver(sema),
    defaultValues: { miktar: 1 },
    mode: "onChange",
  });
  return (
    <div className="min-h-screen bg-white p-8 dark:bg-slate-900">
      {/* Chrome yerel artır/azalt oklarını YALNIZ hover/odakta çizer; ekran
          görüntüsünde görülebilmeleri için sondaya özel olarak sabitleniyor.
          Bu stil yalnız bu ölçüm sayfasındadır, üretime girmez. */}
      <style>{`input[type="number"]::-webkit-inner-spin-button { opacity: 1; }`}</style>
      <div className="flex w-[560px] gap-8 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex-1">
          <Form.Field
            control={form.control}
            name="miktar"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>Miktar (onarımlı)</Form.Label>
                <Form.Control>
                  <input
                    type="number"
                    data-sonda="onarimli"
                    className="input w-full"
                    {...field}
                  />
                </Form.Control>
                <Form.Hint>Depodan düşülecek adet.</Form.Hint>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Miktar (onarımsız)
          </label>
          <input type="number" data-sonda="onarimsiz" defaultValue={1} className="input w-full" />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Sonda />);
