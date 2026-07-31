// `AdminLayout` altındaki sayfalar kendi <h1>'ini basmaz — `AdminPageHeader` basar.
//
// `AdminPayoutsPage` bu kuralı deliyordu: `AdminPageHeader` zaten nav öğesinin
// label'ından bir başlık bastığı için ekranda **iki** sayfa başlığı oluyordu
// (belge hiyerarşisi bozulur, ekran okuyucu iki kez "sayfa başlığı" duyurur) ve
// açıklama metni de iki kez yazılıyordu.
//
// Tek sayfayı düzeltmek yeterli değil; aynı hata yeni sayfada tekrar eder. Bu
// test kaynak ağacını tarayarak kuralı kalıcı kılar.
//
// KAPSAM: yalnız `AdminLayout` altında render edilen sayfalar. Operatör
// panelleri (`OperatorHome`, `OperatorLibrary`) `DashboardShell` kullanır ve
// kendi başlıklarını basmak ZORUNDADIR — onları kurala sokmak yanlış olurdu.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** `AdminLayout` altındaki sayfalar. */
const ADMIN_PAGE_GLOBS = [
  { dir: "src/pages/admin", match: /\.tsx$/ },
  // Legacy admin ekranları `pages/dashboards` altında ve Admin* önekiyle;
  // aynı klasördeki Operator*/Courier* sayfaları AdminLayout kullanmaz.
  { dir: "src/pages/dashboards", match: /^Admin.*\.tsx$/ },
];

function collect(dir: string, match: RegExp, out: string[] = []): string[] {
  const abs = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(rel, match, out);
    else if (match.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Yorumları çıkarır: açıklama metninde geçen `<h1` yanlış pozitif üretmesin. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("admin sayfa başlık hiyerarşisi", () => {
  const files = ADMIN_PAGE_GLOBS.flatMap((g) => collect(g.dir, g.match));

  it("taranacak dosya bulundu (test boşa düşmesin)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("hiçbir AdminLayout sayfası kendi <h1>'ini basmıyor", () => {
    const ihlaller = files.filter((f) =>
      /<h1[\s>]/.test(
        stripComments(fs.readFileSync(path.resolve(process.cwd(), f), "utf-8")),
      ),
    );
    expect(
      ihlaller,
      `Bu sayfalar kendi <h1>'ini basıyor; başlık AdminPageHeader'a bırakılmalı: ${ihlaller.join(", ")}`,
    ).toEqual([]);
  });

  it("operatör/kurye PANELLERİ kapsam DIŞINDA (kendi başlıklarını basmaları doğru)", () => {
    // Kapsamın yanlışlıkla genişletilmesini engeller. Dosya adında "Courier"
    // geçmesi yetmez: `admin/delivery/DeliveryCouriersPage` meşru bir admin
    // sayfasıdır — dışlanan şey `pages/dashboards` altındaki PANELLERdir.
    const disarida = [
      "src/pages/dashboards/OperatorHome.tsx",
      "src/pages/dashboards/OperatorLibrary.tsx",
      "src/pages/dashboards/OperatorSessions.tsx",
      "src/pages/dashboards/CourierHome.tsx",
    ];
    // Windows'ta `path.join` ters bölü üretir; karşılaştırma öncesi normalize.
    const normalized = files.map((x) => x.split(path.sep).join("/"));
    for (const f of disarida) {
      expect(normalized).not.toContain(f);
    }
  });
});
