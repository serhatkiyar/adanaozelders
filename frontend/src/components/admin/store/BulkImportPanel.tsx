/**
 * CSV ile toplu ürün içe aktarma paneli.
 *
 * ## İP-A6 · Görev 4a/4c — göç
 *
 *   - Dosya seçici gerçek bir etiket taşıyor (eskiden adsızdı: ekran okuyucu
 *     "dosya seç" düğmesini neyin dosyası olduğunu söylemeden okuyordu).
 *   - İki ham `<button>` ortak `Button`a geçti.
 *   - "İçe aktar" düğmesi dosya seçilmediği için KAPANMIYOR (kalıcı kural):
 *     basılınca ne eksik olduğu yazıyla söyleniyor. Kapalı düğme "neden
 *     kapalı" sorusunu cevaplamıyordu.
 */
import { useState } from "react";

import { Button } from "@/components/admin/ui";
import { Form } from "@/components/admin/ui2/form";
import { useBulkImportProducts } from "@/hooks/useStore";
import { CSV_COLUMNS, buildCsvTemplate } from "@/lib/productCsvTemplate";
import { toast } from "@/store/toastStore";
import type { BulkImportResult } from "@/types";

export function BulkImportPanel({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const importer = useBulkImportProducts();

  function downloadTemplate() {
    // Başlık + örnek satır TEK KAYNAKTA (`lib/productCsvTemplate`): ikisi
    // burada ayrı string olarak dururken aralarında bir kolon kayması oluştu
    // (`tax_rate` atlanmış, sonraki her değer bir sola kaymıştı) ve şablonu
    // indiren herkes geçersiz veri gönderiyordu. Hizayı Vitest nöbetçisi korur.
    const sample = buildCsvTemplate();
    // BOM (﻿) → Excel Türkçe karakterleri doğru açar.
    const blob = new Blob([`﻿${sample}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "urun-sablonu.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Dosya seçilmeden basılan düğme SESSİZ kalmaz: kapalı düğme yerine
  // görünen bir uyarı (kalıcı kural — geçerlilik düğmeyi kapatmaz).
  const [dosyaUyarisi, setDosyaUyarisi] = useState(false);

  function run() {
    if (!file) {
      setDosyaUyarisi(true);
      return;
    }
    setDosyaUyarisi(false);
    importer.mutate(file, {
      onSuccess: (r) => {
        setResult(r);
        toast.success(`${r.created} ürün eklendi${r.skipped ? `, ${r.skipped} atlandı` : ""}`);
        onDone();
      },
      onError: (err: unknown) => {
        const detail =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "İçe aktarma başarısız";
        toast.error(detail);
      },
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm ">
      <p className="text-slate-600 ">
        CSV ile toplu ürün ekle. İlk satır başlık olmalı; <b>title</b>, <b>price</b> ve{" "}
        <b>tax_rate</b> zorunlu. KDV oranını <b>oran</b> olarak yazın (0.20 = %20);
        oransız satırlar oluşturulmaz ve aşağıda tek tek raporlanır. Aynı ISBN varsa
        atlanır. Platform (fiziksel/dijital) ürünü oluşturur.
      </p>
      <Button className="mt-2" variant="ghost" size="sm" onClick={downloadTemplate}>
        Şablon CSV indir
      </Button>
      <p className="mt-2 break-words text-xs text-slate-400">Sütunlar: {CSV_COLUMNS}</p>

      <div className="mt-3 flex flex-wrap items-start gap-3">
        {/* `Form.Field` YOK: bu tek alanlık seçici bir `react-hook-form`
            formu değil, tek atımlık bir dosya kutusu. `Form.Item` yine de
            `id`/etiket bağını ve mesaj slotunu kurar. */}
        <Form.Item>
          <Form.Label>Yüklenecek CSV dosyası</Form.Label>
          <Form.Control>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
                setDosyaUyarisi(false);
              }}
              className="text-sm text-slate-600 "
            />
          </Form.Control>
        </Form.Item>
        <Button className="mt-7" isPending={importer.isPending} onClick={run}>
          {importer.isPending ? "İçe aktarılıyor…" : "İçe aktar"}
        </Button>
      </div>
      {dosyaUyarisi && (
        <p role="alert" className="mt-1 text-xs text-rose-600 ">
          Önce içe aktarılacak CSV dosyasını seçin.
        </p>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 ">
          <p className="font-medium text-slate-800 ">
            {result.created} eklendi · {result.skipped} atlandı · {result.errors.length} hata
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-rose-600 ">
              {result.errors.map((er) => (
                <li key={er.row}>
                  Satır {er.row}: {er.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
