import { DersSecici } from "@/components/tutor/DersSecici";
import { useLevelScales, useSubjects } from "@/hooks/useSubjects";
import type { Ders } from "@/api/subjects";

import type { AdimProps } from "./ortak";

/**
 * Adım 0 — ders ve seviye seçimi.
 *
 * Katalog `"secim"` kapsamıyla çekilir: eğitmen tarafında TÜM katalog görünür.
 * Vitrin kapsamı (küratörlü, arkasında eğitmen olan liste) burada kullanılsaydı
 * niş bir branş veren eğitmen kendi dersini bulamaz, arzı kendi elimizle
 * keserdik.
 */
export function AdimDersler({ d, guncelle }: AdimProps) {
  const { data: katalog } = useSubjects("secim");
  const { data: merdivenler } = useLevelScales();

  const dersiCevir = (ders: Ders) => {
    const secili = d.subjects.includes(ders.name);
    if (secili) {
      const kalan = { ...d.subjectLevels };
      delete kalan[ders.id];
      guncelle({
        subjects: d.subjects.filter((s) => s !== ders.name),
        subjectLevels: kalan,
      });
      return;
    }
    guncelle({ subjects: [...d.subjects, ders.name] });
  };

  const seviyeCevir = (dersId: number, levelId: number) => {
    const mevcut = d.subjectLevels[dersId] ?? [];
    guncelle({
      subjectLevels: {
        ...d.subjectLevels,
        [dersId]: mevcut.includes(levelId)
          ? mevcut.filter((x) => x !== levelId)
          : [...mevcut, levelId],
      },
    });
  };

  return (
    <div data-alan="dersler">
      <DersSecici
        katalog={katalog}
        merdivenler={merdivenler}
        secili={d.subjects}
        seviyeler={d.subjectLevels}
        duzenlenebilir
        onToggle={dersiCevir}
        onSeviye={seviyeCevir}
      />
    </div>
  );
}
