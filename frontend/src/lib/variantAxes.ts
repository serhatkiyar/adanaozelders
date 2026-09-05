// Varyant seçicisinin eksen mantığı — SAF, test edilebilir.
//
// ## Neden ayrı modül
//
// Seçici bugüne dek DÜZ BİR LİSTEYDİ: iki eksenli üründe kartezyen çarpımın
// tamamı ("Kırmızı / S", "Kırmızı / M", "Mavi / S"…) tek satırda diziliyordu.
// Ebadı sabit olan müşteri — kırtasiye ve giyimde çoğunluk odur — her rengi tek
// tek denemek zorunda kalıyordu.
//
// Doğru sunum eksen bazlı ızgaradır ve o ızgaranın kuralları düz mantıktır.
// Kurallar DOM'suz sınanabilir; ekran bileşeni yalnız çizer.
//
// ## Davranış kuralları (hepsi kabul kriteri)
//
//   - **Gizleme yok.** Bir değer bu seçimde üretilmiyorsa da listede kalır.
//     Gizlemek "bu renk hiç yok" ile "şu an tükendi"yi ayırt edilemez kılar ve
//     ızgaradaki deliği kullanıcı arıza sanar.
//   - **İki tür "yok" AYRIDIR.** `tukendi` = kombinasyon var, stok sıfır →
//     "gelince haber ver" teklif edilebilir. `yok` = bu kombinasyon hiç
//     üretilmemiş → haber vermek boş vaat olurdu.
//   - **Sıra dayatması yok.** İki eksen bağımsızdır; kullanıcı renkten de
//     ebattan da başlayabilir.
//   - **Çıkmaz sokak yok.** `yok` bir değer TIKLANABİLİR kalır: kullanıcı o
//     değere sahip en yakın kardeşe gider (Amazon'un soluk-ama-tıklanabilir
//     kalıbı). Aksi hâlde "Mavi" hiç ulaşılamaz olurdu.
//   - **Seçim sessizce DEĞİŞMEZ.** Diğer eksen korunamıyorsa hedef bağlantı
//     `istenen` ipucunu taşır ve varış sayfası ne olduğunu YAZAR
//     ("M ebadı bu renkte yok. Mevcut: S, L").

import type { ProductVariantMember, ProductVariants } from "@/types";

export type EksenDurumu = "secili" | "secilebilir" | "tukendi" | "yok";

export interface EksenDegeri {
  value: string;
  durum: EksenDurumu;
  /** Tıklanınca gidilecek kardeş. Yalnız veri tutarsızsa null olur. */
  hedef: ProductVariantMember | null;
  /**
   * `true` ise diğer eksendeki seçim KORUNAMIYOR; hedef, bu değere sahip en
   * yakın kardeştir.
   */
  digerEksenDegisecek: boolean;
  /**
   * Bağlantıya konacak ipucu: `Eksen:Değer` biçiminde, KAYBEDİLEN seçimi
   * taşır (tıklananı değil).
   *
   * Kullanıcı Kırmızı/M'deyken "Mavi"ye tıklıyor ve Mavi/M üretilmiyorsa
   * kaybedilen şey **Ebat: M**'dir; varış sayfası "M ebadı bu seçimde yok"
   * diyebilmek için bunu bilmek zorunda. Tıklanan değeri taşımak işe
   * yaramazdı: varışta o değer zaten seçilidir ve hiçbir şey yazılmazdı.
   */
  kayipIpucu: string | null;
  /** Renk örneği (yönetilen nitelik sözlüğünden); yoksa metin butonu çizilir. */
  swatchHex?: string | null;
  swatchImageUrl?: string | null;
}

export interface Eksen {
  name: string;
  /** Mevcut ürünün bu eksendeki değeri — başlıkta HER ZAMAN yazılır. */
  secili: string | null;
  values: EksenDegeri[];
}

/** Kullanıcının istediği ama karşılanamayan seçim (URL ipucundan). */
export interface IstenenSecim {
  axisName: string;
  value: string;
}

/** Değerleri ilk görülme sırasında toplar (üye sırası = variant_sort). */
function eksenDegerleri(
  members: ProductVariantMember[],
  al: (m: ProductVariantMember) => string | null | undefined
): string[] {
  const sonuc: string[] = [];
  for (const m of members) {
    const d = al(m);
    if (d && !sonuc.includes(d)) sonuc.push(d);
  }
  return sonuc;
}

/**
 * Düz kardeş listesini eksen bazlı ızgaraya çevirir.
 *
 * `currentId` mevcut sayfadaki ürünün id'sidir; seçili değerler ondan okunur.
 */
export function buildAxes(variants: ProductVariants, currentId: number): Eksen[] {
  const uyeler = variants.members;
  const mevcut = uyeler.find((m) => m.id === currentId) ?? null;

  const swatchAl = (axisName: string, value: string) =>
    (variants.swatches ?? []).find(
      (s) => s.axis_name === axisName && s.value === value
    );

  const tanimlar: {
    name: string;
    al: (m: ProductVariantMember) => string | null | undefined;
    secili: string | null;
  }[] = [
    {
      name: variants.option1_name,
      al: (m) => m.option1_value,
      secili: mevcut?.option1_value ?? null,
    },
  ];
  if (variants.option2_name) {
    tanimlar.push({
      name: variants.option2_name,
      al: (m) => m.option2_value,
      secili: mevcut?.option2_value ?? null,
    });
  }

  return tanimlar.map((tanim, i) => {
    // Diğer eksendeki seçim sabit tutulmaya ÇALIŞILIR: kullanıcının ebadını
    // değiştirmeden rengini değiştirmesi beklenen davranıştır.
    const diger = tanimlar[i === 0 ? 1 : 0];
    const digerSecili = diger?.secili ?? null;

    const values = eksenDegerleri(uyeler, tanim.al).map<EksenDegeri>((value) => {
      const tamEslesme =
        diger && digerSecili !== null
          ? uyeler.find((m) => tanim.al(m) === value && diger.al(m) === digerSecili)
          : uyeler.find((m) => tanim.al(m) === value);

      const swatch = swatchAl(tanim.name, value);
      const ortak = {
        value,
        swatchHex: swatch?.hex ?? null,
        swatchImageUrl: swatch?.image_url ?? null,
      };

      if (tamEslesme) {
        return {
          ...ortak,
          durum: tanim.secili === value ? "secili" : tamEslesme.in_stock ? "secilebilir" : "tukendi",
          hedef: tamEslesme,
          digerEksenDegisecek: false,
          kayipIpucu: null,
        };
      }

      // Bu kombinasyon HİÇ ÜRETİLMEMİŞ. Değer gizlenmez ve çıkmaz sokak
      // olmasın diye tıklanabilir kalır: en yakın kardeşe gidilir ve
      // KAYBEDİLEN seçim bağlantıda taşınır.
      const yedek = uyeler.find((m) => tanim.al(m) === value) ?? null;
      return {
        ...ortak,
        durum: "yok",
        hedef: yedek,
        digerEksenDegisecek: !!yedek,
        kayipIpucu:
          yedek && diger && digerSecili !== null
            ? `${diger.name}:${digerSecili}`
            : null,
      };
    });

    return { name: tanim.name, secili: tanim.secili, values };
  });
}

/**
 * Kaybedilen seçimin açıklaması.
 *
 * Kullanıcı "M" ebadındayken "Mavi"ye geçtiyse ve mavi M üretilmiyorsa varış
 * sayfası sessiz KALMAZ: kaybedilen ebadı ve hangilerinin mevcut olduğunu
 * yazar. Bilgi bağlantıdaki `kayipIpucu`ndan gelir.
 *
 * Kayıp gerçekleşmemişse (o eksende zaten istenen değer seçiliyse) hiçbir şey
 * yazılmaz — eski bir URL paylaşıldığında yanlış uyarı çıkmasın.
 */
export function karsilanmayanSecim(
  axes: Eksen[],
  istenen: IstenenSecim | null
): string | null {
  if (!istenen) return null;
  const eksen = axes.find((a) => a.name === istenen.axisName);
  if (!eksen || eksen.secili === istenen.value) return null;

  const mevcutlar = eksen.values
    .filter((v) => v.durum !== "yok")
    .map((v) => v.value);
  return mevcutlar.length
    ? `${istenen.value} ${eksen.name.toLocaleLowerCase("tr")} bu seçimde yok. Mevcut: ${mevcutlar.join(", ")}`
    : `${istenen.value} ${eksen.name.toLocaleLowerCase("tr")} bu seçimde yok.`;
}

/** URL'deki `istenen=Eksen:Değer` ipucunu çözer. */
export function istenenCoz(ham: string | null): IstenenSecim | null {
  if (!ham) return null;
  const ayrac = ham.indexOf(":");
  if (ayrac <= 0 || ayrac === ham.length - 1) return null;
  return {
    axisName: ham.slice(0, ayrac),
    value: ham.slice(ayrac + 1),
  };
}

/** Seçicinin hiç çizilmemesi gereken hâl: tek üyeli grup. */
export function seciciGosterilsin(
  variants: ProductVariants | null | undefined
): boolean {
  return !!variants && variants.members.length > 1;
}
