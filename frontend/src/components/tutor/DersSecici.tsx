import { useMemo, useState } from "react";

import { PlainButton } from "@/components/ui/PlainButton";
import type { Ders, SeviyeMerdiveni } from "@/api/subjects";
import { dersAra, dersinSeviyeleri } from "@/lib/dersArama";

/**
 * Eğitmenin branş + seviye seçimi.
 *
 * Eskiden burada 24 kalemlik, aranamaz, düz bir çip ızgarası vardı ve listesi
 * koda gömülüydü. Katalog artık 846 ders taşıyor; düz ızgara okunamaz olurdu.
 * Bu yüzden: yazarak süz, gruplu göster, seçilenleri üstte tut.
 *
 * Seviyeler derse göre değişir — okul dersinde kademe, dilde A1–C2, müzikte
 * konservatuvar basamakları. Hangi merdivenin geçerli olduğunu sunucu söyler
 * (`Ders.scales`); istemci kural üretmez.
 */
export function DersSecici({
  katalog,
  merdivenler,
  secili,
  seviyeler,
  duzenlenebilir,
  onToggle,
  onSeviye,
}: {
  katalog: Ders[] | undefined;
  merdivenler: SeviyeMerdiveni[] | undefined;
  /** Seçili ders adları (DB'ye giden değer — geriye uyum için metin). */
  secili: string[];
  /** {subject_id: [level_id]} */
  seviyeler: Record<number, number[]>;
  duzenlenebilir: boolean;
  onToggle: (ders: Ders) => void;
  onSeviye: (dersId: number, levelId: number) => void;
}) {
  const [sorgu, setSorgu] = useState("");

  const adaGore = useMemo(
    () => new Map((katalog ?? []).map((d) => [d.name, d])),
    [katalog],
  );
  const seciliDersler = useMemo(
    () => secili.map((ad) => adaGore.get(ad)).filter((d): d is Ders => Boolean(d)),
    [secili, adaGore],
  );
  const sonuclar = useMemo(() => dersAra(katalog, sorgu), [katalog, sorgu]);

  if (!katalog) {
    return (
      <p className="text-sm text-slate-400">Ders listesi yükleniyor…</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Seçilenler + seviyeleri */}
      {seciliDersler.length > 0 && (
        <ul className="space-y-3">
          {seciliDersler.map((ders) => {
            const uygun = dersinSeviyeleri(ders, merdivenler);
            const secilenSeviyeler = seviyeler[ders.id] ?? [];
            return (
              <li
                key={ders.id}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium text-slate-900">{ders.name}</span>
                  <PlainButton
                    onClick={() => onToggle(ders)}
                    disabled={!duzenlenebilir}
                    aria-label={`${ders.name} dersini kaldır`}
                    className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                  >
                    Kaldır
                  </PlainButton>
                </div>
                {uygun.map((merdiven) => (
                  <div key={merdiven.code} className="mt-2">
                    <span className="text-xs text-slate-500">{merdiven.name}</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {merdiven.levels.map((seviye) => {
                        const acik = secilenSeviyeler.includes(seviye.id);
                        return (
                          <PlainButton
                            key={seviye.id}
                            onClick={() => onSeviye(ders.id, seviye.id)}
                            disabled={!duzenlenebilir}
                            aria-pressed={acik}
                            className={`inline-flex min-h-[44px] items-center rounded-full px-3 text-xs transition disabled:opacity-50 ${
                              acik
                                ? "bg-indigo-600 font-medium text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            {seviye.name}
                          </PlainButton>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      {/* Arama + sonuçlar */}
      <div>
        <input
          type="search"
          value={sorgu}
          disabled={!duzenlenebilir}
          onChange={(e) => setSorgu(e.target.value)}
          placeholder="Ders ara — matematik, gitar, python…"
          aria-label="Ders ara"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
        />

        {sorgu.trim() === "" ? (
          <p className="mt-2 text-xs text-slate-400">
            Verdiğin dersleri aratıp ekle. {katalog.length} ders arasından
            seçebilirsin.
          </p>
        ) : sonuclar.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            “{sorgu}” için ders bulunamadı. Başka bir yazım dene.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {sonuclar.map((grup) => (
              <div key={grup.grup}>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {grup.baslik}
                </span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {grup.dersler.map((ders) => {
                    const acik = secili.includes(ders.name);
                    return (
                      <PlainButton
                        key={ders.id}
                        onClick={() => onToggle(ders)}
                        disabled={!duzenlenebilir}
                        aria-pressed={acik}
                        className={`inline-flex min-h-[44px] items-center rounded-full px-3.5 text-sm font-medium transition active:scale-95 disabled:opacity-50 ${
                          acik
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {ders.name}
                      </PlainButton>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
