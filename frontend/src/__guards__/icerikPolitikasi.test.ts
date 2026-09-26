// @vitest-environment node
/**
 * Canlı ders (Zoom Video SDK) — içerik güvenlik politikası nöbetçisi.
 *
 * CSP artık iki kollu: `nginx.conf`taki `map $request_uri $icerik_politikasi`
 * `/canli-ders/` yolu için script-src'yi Zoom'a açar, geri kalan her yol
 * bugünkü katı dizeyi alır; başlık `nginx-security-headers.conf`ta tek satırdan
 * çıkar. Buradaki iş, gevşetmenin sessizce varsayılan kola (yani bütün siteye)
 * sızamaması ve kolların script-src dışında ayrışamaması.
 *
 * KAYNAK SÖZLEŞMESİ testidir: nginx'in gerçekten doğru başlığı döndürdüğünü
 * kanıtlamaz (o, imaj build edilip `curl -I` ile ölçülür).
 *
 * Eski dize burada düz yazılmaz, SHA-256'sı tutulur: dize dış yazı tipi
 * konaklarını içerir ve `disFont.test.ts` her `.ts` dosyasını tarar.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FRONTEND = join(__dirname, "..", "..");
const oku = (ad: string) =>
  readFileSync(join(FRONTEND, ad), "utf-8").replace(/\r\n/g, "\n");

const nginx = oku("nginx.conf");
const basliklar = oku("nginx-security-headers.conf");

/** Varsayılan CSP dizesinin SHA-256'sı. 26 Eyl 2026: script-src'ye Google
 *  Analytics, Meta Pixel ve Microsoft Clarity eklendi (kurucu kararı); değişiklik bilinçli olsun
 *  diye özet sabitlenir. */
const ESKI_DIZE_SHA256 =
  "1ba1504a0a514d3d8344b8c5bbc733b2007d925dc4caea8d87de9e0187e0cb2b";

const VARSAYILAN_SCRIPT_SRC =
  "script-src 'self' https://www.googletagmanager.com https://connect.facebook.net " +
  "https://www.clarity.ms https://scripts.clarity.ms;";

const CANLI_SCRIPT_SRC =
  "script-src 'self' 'wasm-unsafe-eval' https://source.zoom.us https://zoom.us " +
  "https://*.zoom.us https://dmogdx0jrul3u.cloudfront.net blob:;";

function mapBlogu(): string {
  const m = nginx.match(/^map \$request_uri \$icerik_politikasi \{\n([\s\S]*?)\n\}/m);
  expect(m, "nginx.conf'ta `map $request_uri $icerik_politikasi` yok").not.toBeNull();
  return m![1];
}

function kollar(): Record<string, string> {
  const satirlar = mapBlogu()
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
  const sonuc: Record<string, string> = {};
  for (const satir of satirlar) {
    const m = satir.match(/^(\S+) "([^"]*)";$/);
    expect(m, `çözülemeyen map satırı: ${satir}`).not.toBeNull();
    sonuc[m![1]] = m![2];
  }
  return sonuc;
}

const scriptSrc = (dize: string) => dize.match(/script-src [^;]*;/)?.[0] ?? "";

describe("içerik güvenlik politikası · canlı ders kolu", () => {
  it("map yalnız iki kol taşır: `~^/canli-ders/` ve `default`", () => {
    expect(Object.keys(kollar()).sort()).toEqual(["default", "~^/canli-ders/"]);
  });

  it("varsayılan kol sabitlenmiş dizeyle birebir aynı", () => {
    const sha = createHash("sha256").update(kollar().default).digest("hex");
    expect(sha, "varsayılan CSP değişti — bütün site etkilenir").toBe(ESKI_DIZE_SHA256);
  });

  it("varsayılan kolda script-src katı: 'self' + yalnız GA, Meta Pixel ve Clarity", () => {
    const d = kollar().default;
    expect(scriptSrc(d)).toBe(VARSAYILAN_SCRIPT_SRC);
    expect(d).not.toMatch(/zoom|wasm-unsafe-eval|unsafe-eval/);
  });

  it("canlı ders kolu = varsayılan kol, YALNIZ script-src genişletilmiş", () => {
    const { default: varsayilan, "~^/canli-ders/": canli } = kollar();
    expect(canli).toBe(varsayilan.replace(VARSAYILAN_SCRIPT_SRC, CANLI_SCRIPT_SRC));
  });

  it("hiçbir kolda script için 'unsafe-eval' / 'unsafe-inline' yok", () => {
    for (const dize of Object.values(kollar())) {
      expect(scriptSrc(dize)).not.toMatch(/'unsafe-eval'|'unsafe-inline'/);
    }
  });

  it("gevşetme kelimeleri map'in canlı ders satırı dışında hiçbir değerde geçmez", () => {
    const disarida = (nginx + "\n" + basliklar)
      .split("\n")
      .filter((s) => !s.trim().startsWith("#"))
      .filter((s) => !s.trim().startsWith("~^/canli-ders/ "));
    expect(disarida.filter((s) => /zoom|wasm-unsafe-eval/.test(s))).toEqual([]);
  });

  it("CSP başlığı tek yerden, map değişkeniyle çıkar", () => {
    const tum = (nginx + "\n" + basliklar)
      .split("\n")
      .filter((s) => !s.trim().startsWith("#"))
      .filter((s) => /Content-Security-Policy/.test(s));
    expect(tum.map((s) => s.trim())).toEqual([
      "add_header Content-Security-Policy $icerik_politikasi always;",
    ]);
  });
});
