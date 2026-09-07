import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/admin/ui";

import { Menu, MenuAyraci, MenuOgesi } from "./menu";

/**
 * ── Liste araç çubuğu (İP-B2 · docs/tasarim-dili.md §5.1) ──
 *
 * Sözleşme tek cümle: **ekran "hangi filtreler" der, düzen kurmaz.**
 *
 * Bugün panelin 22 liste ekranının her biri kendi filtre şeridini elle
 * yazıyor: kimi `<select>` yan yana diziyor, kimi çip kullanıyor, kimi hiç
 * filtre sunmuyor. Aynı işin 22 farklı yerleşimi demek, 22 farklı klavye
 * davranışı, 22 farklı mobil kırılma noktası ve 22 kez unutulabilecek bir
 * "sayfayı sıfırla" kuralı demek.
 *
 * Burada toplananlar:
 *
 *   - **Arama** — 300 ms gecikmeli, URL'e yazılır. Gecikme neden 300:
 *     150 ms'te her tuş vuruşunda istek gidiyor, 500 ms'te yazmayı bitirip
 *     beklemek gerekiyor (İP-12'de ölçüldü, `ProductsPanel` bugün 300
 *     kullanıyor ve doğru).
 *   - **"Filtre ekle"** — önce kriter, sonra değer (Medusa deseni).
 *   - **Sıralama** — ayrı bir düğme (alan + yön). Medusa'nın ana listelerinde
 *     sıralama HİÇ yok; bizde `manualSorting` ile sunucu taraflı ve bu bizim
 *     ARTIMIZ (Ç-6). Tablo başlığındaki gösterge de korunur — ikisi aynı URL
 *     durumunu okur, yani asla çelişemezler.
 *   - **Uygulanan filtre çipleri** — her biri tek tek kaldırılabilir, ayrıca
 *     "Tümünü temizle".
 *   - **Sayfa sıfırlama** — filtre/arama değişince `sayfa` DÜŞER. Bu kural
 *     ekran başına yazılsaydı bir yerde unutulurdu ve sonuç şu olurdu:
 *     4. sayfadayken arama yapan kullanıcı boş bir liste görür ve "kayıt yok"
 *     sanır.
 *
 * ## Filtreler neden URL'de yaşıyor
 *
 * Kilitli karar. Sayfa yenilenince, bağlantı paylaşılınca ve geri tuşuna
 * basılınca aynı liste açılır. Kişisel tercih (kolon görünürlüğü gibi)
 * ileride kalıcı depoya gidebilir; o ayrım korunmalı.
 */

export interface FiltreSecenegi {
  deger: string;
  etiket: string;
  /** Yüz (facet) sayısı — biliniyorsa menüde gösterilir. */
  sayi?: number;
}

export interface FiltreTanimi {
  /** URL parametresi adı (`stok`, `yayinevi`…). */
  anahtar: string;
  /** İnsan adı — çipte ve menüde geçer ("Stok durumu"). */
  etiket: string;
  secenekler: FiltreSecenegi[];
  /** Seçenek listesi hâlâ yükleniyorsa menüde bunu söyler. */
  yukleniyor?: boolean;
}

export interface SiralamaTanimi {
  /** Alan parametresi (`sirala`). */
  anahtar: string;
  /** Yön parametresi (`yon`). */
  yonAnahtari: string;
  varsayilan: string;
  varsayilanYon: "asc" | "desc";
  secenekler: { deger: string; etiket: string }[];
}

export interface AramaTanimi {
  /** URL parametresi; varsayılan `q`. */
  anahtar?: string;
  /** Erişilebilir ad ("Ürün ara"). Görsel olarak gizlidir. */
  etiket: string;
  ipucu?: string;
}

export interface ListeAracCubuguProps {
  arama?: AramaTanimi;
  filtreler?: FiltreTanimi[];
  siralama?: SiralamaTanimi;
  /** Sayfa numarasını taşıyan parametre; filtre değişince silinir. */
  sayfaAnahtari?: string;
  /**
   * Araç çubuğunun sağ ucundaki ek denetimler (ör. "Toplu içe aktar").
   *
   * Birincil aksiyon ("Yeni ürün") BURAYA DEĞİL, üst başlık şeridine gider
   * (tasarım dili §4.2): her ekranda aynı yerde durması, aramanın yanında
   * durmasından daha değerli.
   */
  ekDenetimler?: React.ReactNode;
}

const ARAMA_GECIKMESI_MS = 300;

/**
 * Filtre/arama parametrelerini silen, ama listenin OKUMA biçimini (sıralama,
 * sayfa boyu) koruyan temizleyici.
 *
 * Neden sıralama korunuyor: "filtreleri temizle" diyen kullanıcı listeyi
 * genişletmek ister, sıralamasını kaybetmek değil. `setParams({})` yazan eski
 * hâl ikisini birden siliyordu.
 */
export function useListeTemizleme(korunacakAnahtarlar: string[]): () => void {
  const [, setParams] = useSearchParams();
  return useCallback(() => {
    setParams((onceki) => {
      const sonraki = new URLSearchParams();
      for (const anahtar of korunacakAnahtarlar) {
        const deger = onceki.get(anahtar);
        if (deger !== null) sonraki.set(anahtar, deger);
      }
      return sonraki;
    });
    // `korunacakAnahtarlar` çağrı yerinde sabit bir dizi literali olarak
    // yazılıyor; kimliği her render'da değişse de içeriği değişmiyor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams, korunacakAnahtarlar.join("|")]);
}

export function ListeAracCubugu({
  arama,
  filtreler = [],
  siralama,
  sayfaAnahtari = "sayfa",
  ekDenetimler,
}: ListeAracCubuguProps) {
  const [params, setParams] = useSearchParams();
  const aramaAnahtari = arama?.anahtar ?? "q";
  const aramaId = useId();
  const urlQ = params.get(aramaAnahtari) ?? "";

  const [aramaTaslak, setAramaTaslak] = useState(urlQ);
  const [acikKriter, setAcikKriter] = useState<string | null>(null);

  /** Bir ya da birkaç parametreyi yazar; sayfa numarasını DÜŞÜRÜR. */
  const yaz = useCallback(
    (degisiklikler: Record<string, string | undefined>, replace = false) => {
      setParams(
        (onceki) => {
          const sonraki = new URLSearchParams(onceki);
          for (const [anahtar, deger] of Object.entries(degisiklikler)) {
            if (deger === undefined || deger === "") sonraki.delete(anahtar);
            else sonraki.set(anahtar, deger);
          }
          // Daralan bir listede eski sayfa numarası geçersizdir.
          sonraki.delete(sayfaAnahtari);
          return sonraki;
        },
        { replace }
      );
    },
    [setParams, sayfaAnahtari]
  );

  // URL dışarıdan değişirse (geri tuşu, çip kaldırma, "tümünü temizle")
  // taslak onu izler.
  useEffect(() => setAramaTaslak(urlQ), [urlQ]);

  useEffect(() => {
    if (aramaTaslak === urlQ) return;
    const zamanlayici = setTimeout(
      // `replace: true`: her tuş vuruşu bir geçmiş kaydı bırakmamalı, yoksa
      // geri tuşu harf harf geri sarar.
      () => yaz({ [aramaAnahtari]: aramaTaslak || undefined }, true),
      ARAMA_GECIKMESI_MS
    );
    return () => clearTimeout(zamanlayici);
  }, [aramaTaslak, urlQ, aramaAnahtari, yaz]);

  const temizle = useListeTemizleme(
    useMemo(
      () => (siralama ? [siralama.anahtar, siralama.yonAnahtari, "limit"] : ["limit"]),
      [siralama]
    )
  );

  /** Uygulanmış filtreler → çip verisi. */
  const cipler = filtreler
    .map((f) => {
      const deger = params.get(f.anahtar);
      if (!deger) return null;
      const secenek = f.secenekler.find((s) => s.deger === deger);
      return { tanim: f, deger, etiket: secenek?.etiket ?? deger };
    })
    .filter((c): c is { tanim: FiltreTanimi; deger: string; etiket: string } => c !== null);

  const aramaCipi = urlQ ? urlQ : null;
  const cipVar = cipler.length > 0 || aramaCipi !== null;

  const suankiSiralama = siralama
    ? (params.get(siralama.anahtar) ?? siralama.varsayilan)
    : null;
  const suankiYon = siralama
    ? params.get(siralama.yonAnahtari) === "asc"
      ? "asc"
      : params.get(siralama.yonAnahtari) === "desc"
        ? "desc"
        : siralama.varsayilanYon
    : null;
  const siralamaEtiketi = siralama
    ? (siralama.secenekler.find((s) => s.deger === suankiSiralama)?.etiket ?? suankiSiralama)
    : null;

  /** Henüz uygulanmamış kriterler — uygulanmış olan menüde tekrar sunulmaz. */
  const uygulanabilirFiltreler = filtreler.filter((f) => !params.get(f.anahtar));
  const acikTanim = filtreler.find((f) => f.anahtar === acikKriter) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {arama && (
          <div className="min-w-0 flex-1">
            {/* Etiket GÖRSEL OLARAK gizli ama erişilebilirlik ağacında VAR:
                `placeholder` bir ad değildir (kullanıcı yazmaya başlayınca
                kaybolur) ve bu depoda 26 kontrolün borcu tam olarak buydu
                (İP-A6 · Görev 4d). */}
            <label htmlFor={aramaId} className="sr-only">
              {arama.etiket}
            </label>
            <input
              id={aramaId}
              type="search"
              value={aramaTaslak}
              onChange={(olay) => setAramaTaslak(olay.target.value)}
              placeholder={arama.ipucu ?? arama.etiket}
              className="w-full rounded-xl border border-panel-border-strong bg-panel-surface px-3 py-2 text-sm text-panel-fg outline-none transition placeholder:text-panel-fg-subtle focus:border-panel-accent focus:ring-2 focus:ring-panel-accent/20"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          {filtreler.length > 0 && (
            <Menu
              etiket="Filtre ekle"
              hizala="sol"
              tetikleyiciVaryant="secondary"
              tetikleyiciIcerik={<span>Filtre ekle</span>}
              genislikSinifi="w-64"
            >
              {(kapat) =>
                acikTanim ? (
                  <>
                    <MenuOgesi
                      onSec={() => setAcikKriter(null)}
                    >{`‹ ${acikTanim.etiket}`}</MenuOgesi>
                    <MenuAyraci />
                    {acikTanim.yukleniyor && (
                      <p className="px-3 py-2 text-xs text-panel-fg-subtle">Yükleniyor…</p>
                    )}
                    {!acikTanim.yukleniyor && acikTanim.secenekler.length === 0 && (
                      <p className="px-3 py-2 text-xs text-panel-fg-subtle">
                        Seçenek yok.
                      </p>
                    )}
                    {acikTanim.secenekler.map((secenek) => (
                      <MenuOgesi
                        key={secenek.deger}
                        ipucu={secenek.sayi === undefined ? undefined : `${secenek.sayi} kayıt`}
                        onSec={() => {
                          yaz({ [acikTanim.anahtar]: secenek.deger });
                          setAcikKriter(null);
                          kapat();
                        }}
                      >
                        {secenek.etiket}
                      </MenuOgesi>
                    ))}
                  </>
                ) : uygulanabilirFiltreler.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-panel-fg-subtle">
                    Tüm filtreler uygulanmış.
                  </p>
                ) : (
                  uygulanabilirFiltreler.map((f) => (
                    <MenuOgesi key={f.anahtar} onSec={() => setAcikKriter(f.anahtar)}>
                      {f.etiket}
                    </MenuOgesi>
                  ))
                )
              }
            </Menu>
          )}

          {siralama && (
            <Menu
              etiket="Sıralama"
              hizala="sol"
              tetikleyiciVaryant="secondary"
              tetikleyiciIcerik={
                <span>
                  Sırala: {siralamaEtiketi} {suankiYon === "asc" ? "↑" : "↓"}
                </span>
              }
              genislikSinifi="w-60"
            >
              {(kapat) =>
                siralama.secenekler.map((secenek) => {
                  const secili = secenek.deger === suankiSiralama;
                  return (
                    <MenuOgesi
                      key={secenek.deger}
                      ipucu={
                        secili
                          ? suankiYon === "asc"
                            ? "Artan: tıkla, azalana çevir"
                            : "Azalan: tıkla, artana çevir"
                          : undefined
                      }
                      onSec={() => {
                        // Aynı alana ikinci tıklama YÖNÜ çevirir; başka bir
                        // alana tıklama o alanın varsayılan yönüyle başlar.
                        const yeniYon = secili
                          ? suankiYon === "asc"
                            ? "desc"
                            : "asc"
                          : siralama.varsayilanYon;
                        yaz({
                          [siralama.anahtar]: secenek.deger,
                          [siralama.yonAnahtari]: yeniYon,
                        });
                        kapat();
                      }}
                    >
                      {secili ? `✓ ${secenek.etiket}` : secenek.etiket}
                    </MenuOgesi>
                  );
                })
              }
            </Menu>
          )}

          {ekDenetimler}
        </div>
      </div>

      {cipVar && (
        <div className="flex flex-wrap items-center gap-2">
          {aramaCipi !== null && (
            // Çipin KENDİSİ kaldırma düğmesidir: iç içe düğme yok, dokunma
            // hedefi tam, erişilebilir ad ne olduğunu ve ne yapacağını söyler.
            <Button
              size="sm"
              variant="secondary"
              className="!min-h-8 rounded-full !px-3 !text-xs font-medium"
              aria-label={`Arama filtresini kaldır: ${aramaCipi}`}
              onClick={() => yaz({ [aramaAnahtari]: undefined })}
            >
              <span className="text-panel-fg-subtle">Arama:</span> {aramaCipi}
              <span aria-hidden="true" className="text-panel-fg-subtle">
                ✕
              </span>
            </Button>
          )}
          {cipler.map((cip) => (
            <Button
              key={cip.tanim.anahtar}
              size="sm"
              variant="secondary"
              className="!min-h-8 rounded-full !px-3 !text-xs font-medium"
              aria-label={`${cip.tanim.etiket} filtresini kaldır: ${cip.etiket}`}
              onClick={() => yaz({ [cip.tanim.anahtar]: undefined })}
            >
              <span className="text-panel-fg-subtle">{cip.tanim.etiket}:</span> {cip.etiket}
              <span aria-hidden="true" className="text-panel-fg-subtle">
                ✕
              </span>
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="!text-xs" onClick={temizle}>
            Tümünü temizle
          </Button>
        </div>
      )}
    </div>
  );
}
