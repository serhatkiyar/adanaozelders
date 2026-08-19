// İP-A6c · Görev 8 — mutasyon sürücüsü.
//
// `git checkout --` KULLANMAZ (kök CLAUDE.md §D: sürücü kullanıcının
// değişikliklerini silmemelidir). Ham baytlar bellekte tutulur, mutasyondan
// sonra aynen geri yazılır; CRLF'e dokunulmaz.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const agac = () => execSync("git status --porcelain", { cwd: "..", encoding: "utf8" });
const BASLANGIC = agac();

const MUTASYONLAR = [
  {
    ad: "M1 · BULGU-4 · bekleyen yazım unutulsun (ilk yazım yine yutulur)",
    dosya: "src/hooks/useUrlDurumu.ts",
    eski: "      const taban = bekleyen?.yazilan ?? params;",
    yeni: "      const taban = params;",
    test: "src/components/admin/ui2/a6cSozlesme.test.tsx",
    filtre: "T3 — ikisi de yazılır",
  },
  {
    ad: "M2 · BULGU-5 · ikinci bekçi kaydında patlamasın",
    dosya: "src/components/admin/ui2/duzenlemeYuzeyi.tsx",
    eski: "if (GELISTIRME && bekcilerRef.current.size > 1) {",
    yeni: "if (GELISTIRME && bekcilerRef.current.size > 99) {",
    test: "src/components/admin/ui2/a6cSozlesme.test.tsx",
    filtre: "T6 — ikinci korumalı içerik",
  },
  {
    ad: "M3 · BULGU-7 · onaydan sonra NavLink seçenekleri düşsün",
    dosya: "src/components/admin/ui2/gezinmeBekcisi.tsx",
    eski: "navigate(to, gezinmeSecenekleri);",
    yeni: "navigate(to);",
    test: "src/components/admin/ui2/a6cSozlesme.test.tsx",
    filtre: "T4 — ",
  },
  {
    ad: "M4 · BULGU-8 · hedef damgası kontrol edilmesin",
    dosya: "src/components/admin/ui2/kirliFormBekcisi.tsx",
    eski: "        if (hedefRef.current !== damga) return;",
    yeni: "        if (false) return;",
    test: "src/components/admin/ui2/a6cSozlesme.test.tsx",
    filtre: "T7 — hedef değişirse",
  },
  {
    ad: "M5 · Görev 6a · hata kırmızısı eski tona dönsün",
    dosya: "src/components/admin/ui2/form.tsx",
    eski: 'className = "text-rose-700 dark:text-rose-400",',
    yeni: 'className = "text-rose-600 dark:text-rose-400",',
    test: "src/components/admin/ui2/a6cSozlesme.test.tsx",
    filtre: "6a — ",
  },
  {
    ad: "M6 · Görev 6b · sayı girdisine şema uygulanmasın",
    dosya: "src/components/admin/ui2/form.tsx",
    eski: 'const sayiAlani = cocuk.type === "input" && cocukProps.type === "number";',
    yeni: "const sayiAlani = false;",
    test: "src/components/admin/ui2/a6cSozlesme.test.tsx",
    filtre: "6b — ",
  },
];

const sonuc = [];
for (const m of MUTASYONLAR) {
  const ham = readFileSync(m.dosya);
  const metin = ham.toString("utf8");
  if (!metin.includes(m.eski)) {
    console.error(`ATLANDI (hedef bulunamadı): ${m.ad}`);
    process.exit(3);
  }
  writeFileSync(m.dosya, Buffer.from(metin.replace(m.eski, m.yeni), "utf8"));
  let kirildi = false;
  let cikti = "";
  try {
    cikti = execSync(
      `npx vitest run ${m.test} -t ${JSON.stringify(m.filtre)} --reporter=dot`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e) {
    kirildi = true;
    cikti = (e.stdout ?? "") + (e.stderr ?? "");
  } finally {
    writeFileSync(m.dosya, ham); // ham baytlar aynen geri
  }
  const ozet = (cikti.match(/Tests\s+.*/) ?? ["(özet yok)"])[0].replace(/\u001b\[[0-9;]*m/g, "");
  sonuc.push({ ad: m.ad, kirildi, ozet: ozet.trim() });
  console.log(`${kirildi ? "KIRILDI  " : "KIRILMADI"} | ${m.ad} | ${ozet.trim()}`);
}

const BITIS = agac();
console.log("\nAGAC BASTA==SONDA:", BASLANGIC === BITIS);
const yakalanmayan = sonuc.filter((s) => !s.kirildi);
if (yakalanmayan.length || BASLANGIC !== BITIS) process.exit(1);
console.log(`Mutasyon: ${sonuc.length}/${sonuc.length} yakalandı.`);
