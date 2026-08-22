/**
 * İP-B2 · kırmızı matris ve mutasyon provası SÜRÜCÜSÜ.
 *
 * ## Ne yapar
 *
 * `--geri-al` : Bu paketin ÜRETİM dosyalarını paket öncesi hâline döndürür
 *               (değişenler `git show <taban>:<yol>`den, yeni olanlar geçici
 *               bir kasaya taşınarak). Test dosyaları YERİNDE KALIR — böylece
 *               "üretim kodu yokken testler gerçekten düşüyor mu" ölçülebilir.
 * `--geri-yukle` : Kasadan bayt bayt geri yükler ve SHA-256 doğrular.
 * `--ozet`    : Kasadaki manifestoyu yazdırır.
 *
 * ## Neden `git stash` KULLANILMIYOR
 *
 * Bu makinede stash yığını worktree'ler arasında PAYLAŞILIYOR ve başka bir
 * oturum aynı anda push/pop yapabiliyor. Kök CLAUDE.md §D'nin kuralı da net:
 * mutasyon sürücüsü kullanıcının değişikliklerini SİLMEMELİ, `git checkout --`
 * ile dosya kaybettirmemeli. Bu yüzden burada tek yön var: **önce kasaya
 * kopyala, sonra değiştir**; geri yüklemede de `git`e değil KASAYA güvenilir
 * ve her dosya SHA-256 ile doğrulanır.
 *
 * Kasa: `.ip-b2-kasa/` (repo dışında değil, ama `.gitignore` dışı olduğu için
 * `git status --porcelain` çıktısında görünür — sürücü işini bitirince onu da
 * siler ve çalışma ağacının başlangıç durumuna döndüğü RAPORLANIR).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FRONTEND, "..");
const KASA = join(REPO, ".ip-b2-kasa");
const TABAN = "13d17a6";

/** Paket ÖNCESİ hâli olan (değişmiş) üretim dosyaları — repo köküne göreli. */
const DEGISENLER = [
  "frontend/index.html",
  "frontend/src/index.css",
  "frontend/tailwind.config.js",
  "frontend/src/components/admin/ProductPicker.tsx",
  "frontend/src/components/admin/data-table/DataTable.tsx",
  "frontend/src/components/admin/delivery/CapacityStrip.tsx",
  "frontend/src/components/admin/delivery/LabelSheet.tsx",
  "frontend/src/components/admin/delivery/bits.tsx",
  "frontend/src/components/admin/layout/AdminLayout.tsx",
  "frontend/src/components/admin/layout/AdminPageHeader.tsx",
  "frontend/src/components/admin/packing/PackageLabel.tsx",
  "frontend/src/components/admin/packing/PackingLabelSheet.tsx",
  "frontend/src/components/admin/store/OrdersPanel.tsx",
  "frontend/src/components/admin/store/ProductForm.tsx",
  "frontend/src/components/admin/store/ProductsPanel.tsx",
  "frontend/src/components/admin/store/ReturnsPanel.tsx",
  "frontend/src/components/admin/ui/Badge.tsx",
  "frontend/src/components/admin/ui/Button.tsx",
  "frontend/src/components/admin/ui/Dialog.tsx",
  "frontend/src/pages/admin/AdminAccessPage.tsx",
  "frontend/src/pages/admin/AdminBookingsPage.tsx",
  "frontend/src/pages/admin/AdminDashboardPage.tsx",
  "frontend/src/pages/admin/AdminDemandsPage.tsx",
  "frontend/src/pages/admin/AdminPayoutsPage.tsx",
  "frontend/src/pages/admin/AdminUserDetailPage.tsx",
  "frontend/src/pages/admin/AdminUsersPage.tsx",
  "frontend/src/pages/admin/delivery/DeliveryOrdersPage.tsx",
  "frontend/src/pages/admin/delivery/DeliveryRunDetailPage.tsx",
  "frontend/src/pages/admin/delivery/DeliveryVehiclesPage.tsx",
  "frontend/src/pages/admin/inventory/InventoryOverviewPage.tsx",
  "frontend/src/pages/admin/packing/PackagesPage.tsx",
  "frontend/src/pages/admin/packing/PackingQueuePage.tsx",
  "frontend/src/pages/admin/packing/PackingStationPage.tsx",
];

/** Bu pakette DOĞAN üretim dosyaları (test dosyaları burada YOK — yerinde kalırlar). */
const YENILER = [
  "frontend/src/components/admin/layout/baslikAksiyonu.tsx",
  "frontend/src/components/admin/ui2/liste/menu.tsx",
  "frontend/src/components/admin/ui2/liste/bosDurum.tsx",
  "frontend/src/components/admin/ui2/liste/satirAksiyonlari.tsx",
  "frontend/src/components/admin/ui2/liste/aracCubugu.tsx",
  "frontend/src/components/admin/ui2/liste/index.ts",
  "frontend/public/fonts/inter-latin.woff2",
  "frontend/public/fonts/inter-latin-ext.woff2",
  "frontend/public/fonts/figtree-latin.woff2",
  "frontend/public/fonts/figtree-latin-ext.woff2",
];

const sha = (yol) => createHash("sha256").update(readFileSync(yol)).digest("hex");

function kasayaKoy() {
  if (existsSync(KASA)) {
    throw new Error(`${KASA} zaten var — önceki bir koşum yarım kalmış olabilir. ` +
      "Önce --geri-yukle çalıştırın.");
  }
  const manifest = { degisenler: {}, yeniler: {} };
  for (const yol of [...DEGISENLER, ...YENILER]) {
    const kaynak = join(REPO, yol);
    if (!existsSync(kaynak)) throw new Error(`yok: ${yol}`);
    const hedef = join(KASA, yol);
    mkdirSync(dirname(hedef), { recursive: true });
    copyFileSync(kaynak, hedef);
    const h = sha(kaynak);
    if (DEGISENLER.includes(yol)) manifest.degisenler[yol] = h;
    else manifest.yeniler[yol] = h;
  }
  writeFileSync(join(KASA, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

function geriAl() {
  const manifest = kasayaKoy();
  // Değişenleri paket öncesi hâline döndür.
  for (const yol of DEGISENLER) {
    const icerik = execFileSync("git", ["show", `${TABAN}:${yol}`], {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "buffer",
    });
    writeFileSync(join(REPO, yol), icerik);
  }
  // Yenileri kaldır (kasada duruyorlar).
  for (const yol of YENILER) rmSync(join(REPO, yol), { force: true });
  console.log(
    `geri alındı: ${DEGISENLER.length} değişen + ${YENILER.length} yeni dosya ` +
      `(kasa: ${KASA})`
  );
  return manifest;
}

function geriYukle() {
  const manifest = JSON.parse(readFileSync(join(KASA, "manifest.json"), "utf8"));
  const hepsi = { ...manifest.degisenler, ...manifest.yeniler };
  let hata = 0;
  for (const [yol, beklenen] of Object.entries(hepsi)) {
    const hedef = join(REPO, yol);
    mkdirSync(dirname(hedef), { recursive: true });
    copyFileSync(join(KASA, yol), hedef);
    const simdiki = sha(hedef);
    const durum = simdiki === beklenen ? "OK " : "BOZUK";
    if (simdiki !== beklenen) hata++;
    console.log(`${durum} ${simdiki.slice(0, 16)} ${yol}`);
  }
  if (hata > 0) {
    throw new Error(`${hata} dosya SHA-256 doğrulamasından geçemedi — KASA SİLİNMEDİ`);
  }
  rmSync(KASA, { recursive: true, force: true });
  console.log(`\n${Object.keys(hepsi).length} dosya bayt bayt geri yüklendi; kasa silindi.`);
}

const komut = process.argv[2];
if (komut === "--geri-al") geriAl();
else if (komut === "--geri-yukle") geriYukle();
else if (komut === "--ozet") console.log(readFileSync(join(KASA, "manifest.json"), "utf8"));
else {
  console.error("kullanım: node scripts/ip-b2-kirmizi-matris.mjs --geri-al|--geri-yukle|--ozet");
  process.exit(2);
}
