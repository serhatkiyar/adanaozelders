/**
 * Harita döşeme kaynağı — tek kaynak ve güvenlik değişmezleri.
 *
 * Bu testin asıl işi bir regresyonu kapatmak: döşeme adresleri altı bileşende
 * gömülüydü ve biri `http://` idi. HTTPS sayfada karışık içerik (mixed content)
 * ve CSP'deki `img-src https:` kuralı yüzünden üretimde SESSİZCE boş harita
 * verirdi — kütüphane haritası, checkout adres pin'i ve kurye takibi aynı anda.
 */
import { describe, expect, it } from "vitest";

import { TILE_SOURCES, tileSource } from "./mapTiles";

describe("tileSource", () => {
  it("varsayılan katman sokak haritasıdır", () => {
    expect(tileSource()).toEqual(TILE_SOURCES.street);
  });

  it("uydu katmanı ayrı bir kaynaktır", () => {
    expect(tileSource("satellite").url).not.toBe(tileSource("street").url);
  });
});

describe("güvenlik değişmezleri", () => {
  it("hiçbir döşeme adresi http:// DEĞİLDİR", () => {
    for (const [layer, source] of Object.entries(TILE_SOURCES)) {
      expect(source.url, `${layer} katmanı düz HTTP kullanıyor`).not.toMatch(
        /^http:\/\//
      );
    }
  });

  it("tüm adresler mutlak ve https'tir", () => {
    for (const source of Object.values(TILE_SOURCES)) {
      expect(source.url).toMatch(/^https:\/\//);
    }
  });

  it("her katmanın atıf (attribution) bilgisi vardır", () => {
    // Döşeme sağlayıcılarının lisansı görünür atıf zorunlu kılar.
    for (const [layer, source] of Object.entries(TILE_SOURCES)) {
      expect(source.attribution.length, `${layer} katmanında atıf yok`).toBeGreaterThan(0);
    }
  });

  it("adres şablonu z/x/y yer tutucularını içerir", () => {
    for (const source of Object.values(TILE_SOURCES)) {
      expect(source.url).toContain("{z}");
      expect(source.url).toContain("{x}");
      expect(source.url).toContain("{y}");
    }
  });
});
