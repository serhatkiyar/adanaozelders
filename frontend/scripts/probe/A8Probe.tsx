/**
 * İP-A8 · Görev 6 — kontrast + yerel widget şeması sondası (gerçek Chrome).
 *
 * Bağımsız denetim #3 iki şey ölçtü ve ikisi de bu sondanın konusu:
 *
 *   • **B-8** — `Button variant="success"` (emerald-600 + beyaz) **3,77:1**;
 *     AA eşiği 4,5 ve metin 14 px. İki temada da eşik altı, 10 çağrı yeri.
 *     Kusurun kaçma sebebi: bu projenin kontrast sondaları bugüne dek YALNIZ
 *     hata metnine bakıyordu; **hiçbir tur raporunda düğme metni kontrastı
 *     yoktu**. Bu sonda beş varyantın ve beş rozetin HEPSİNİ iki temada
 *     ölçer — biri kaçtıysa başkası da kaçmış olabilir.
 *   • **B-9** — `Form.Control` dışındaki yerel widget'lar koyu temada
 *     `color-scheme: normal` çiziliyordu (dokuz yer). Düzeltme kök öğeye
 *     taşındı (`html.dark { color-scheme: dark }`); sonda bunu `Form.Control`
 *     İÇİNDE ve DIŞINDA ayrı ayrı doğrular — çünkü eski koruma yalnız içeride
 *     çalışıyordu ve fark ancak böyle görülür.
 *
 * Ayrıca odak göstergesi (B-11) gerçek `:focus-visible` altında ölçülür.
 *
 * **Canlı `ceyhandb`ye BAĞLANILMAZ**: sayfa hiçbir sunucuya istek atmaz,
 * yalnız gerçek bileşenleri ve gerçek `index.css`i render eder.
 */
import { createRoot } from "react-dom/client";

import { Badge, Button } from "@/components/admin/ui";
import "@/index.css";

const VARYANTLAR = ["primary", "secondary", "success", "danger", "ghost"] as const;
const ROZETLER = ["neutral", "info", "success", "warning", "danger"] as const;

function Sonda() {
  const koyu = new URLSearchParams(location.search).get("koyu") === "1";
  document.documentElement.classList.toggle("dark", koyu);

  return (
    <div className="min-h-screen bg-slate-50 p-8 dark:bg-slate-900">
      <div className="mx-auto max-w-3xl space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Düğmeler</h2>
          <div className="flex flex-wrap gap-3" data-sonda="dugmeler">
            {VARYANTLAR.map((v) => (
              <Button key={v} variant={v} data-varyant={v}>
                {v}
              </Button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Rozetler</h2>
          <div className="flex flex-wrap gap-3" data-sonda="rozetler">
            {ROZETLER.map((t) => (
              <span key={t} data-ton={t}>
                <Badge tone={t}>{t}</Badge>
              </span>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
            Yerel widget şeması
          </h2>
          <div className="flex flex-wrap gap-3" data-sonda="widgetlar">
            {/* `.input` sınıflı ve sınıfsız — ikisi de kök şemayı miras almalı. */}
            <input type="date" className="input w-auto" data-widget="date-input" aria-label="tarih" />
            <input type="number" className="input w-auto" data-widget="number-input" aria-label="sayi" />
            <input type="time" data-widget="time-ciplak" aria-label="saat" />
            <input type="datetime-local" data-widget="dtl-ciplak" aria-label="tarihsaat" />
            <select data-widget="select-ciplak" aria-label="secim">
              <option>bir</option>
            </select>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Odak göstergesi</h2>
          <input className="input w-64" data-odak="input" aria-label="odak kutusu" />
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Sonda />);
