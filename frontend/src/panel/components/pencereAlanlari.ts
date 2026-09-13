// YanPencere formlarının ortak alan-hatası altyapısı: sunucu 422 dağıtımı (hasOwnProperty beyaz listesi), yerel +
// sunucu hatalarının tek çatıda tutulması (alan değişince yalnız o alanın hatası silinir), ilk hatalı alana odak ve
// kirli-kapatma onayı. Kuryeler ve Araçlar pencereleri bunu paylaşır.
import { useEffect, useState } from "react";
import type { App, InputRef } from "antd";
import { getErrorDetail } from "@/lib/errors";

export type Hatalar = Record<string, string | undefined>;

/** 422 alan hatalarını YALNIZ kendi alanlarına (hasOwnProperty) dağıtır; kalanlar genel hata metnidir. */
export function sunucuHatasiniDagit<A extends string>(e: unknown, varsayilan: string, alanlar: readonly A[]): { alan: Partial<Record<A, string>>; genel: string | null } {
  const yanit = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
  const detay = yanit?.data?.detail;
  if (yanit?.status !== 422 || !Array.isArray(detay)) return { alan: {}, genel: getErrorDetail(e, varsayilan) };
  const izinli: Record<string, true> = Object.fromEntries(alanlar.map((a) => [a, true]));
  const alan: Partial<Record<A, string>> = {};
  const kalanlar: string[] = [];
  for (const oge of detay as { loc?: unknown; msg?: unknown }[]) {
    const mesaj = typeof oge?.msg === "string" && oge.msg.trim() ? oge.msg : "Bu alan geçersiz.";
    const parcalar = Array.isArray(oge?.loc) ? oge.loc.filter((p): p is string => typeof p === "string") : [];
    const ham = parcalar.filter((p) => !["body", "query", "path", "header", "cookie"].includes(p)).at(-1);
    if (ham && Object.prototype.hasOwnProperty.call(izinli, ham)) alan[ham as A] = mesaj;
    else kalanlar.push(mesaj);
  }
  const alanVar = Object.keys(alan).length > 0;
  return { alan, genel: kalanlar.length ? kalanlar.join(" ") : alanVar ? null : "Gönderilen bilgi geçersiz." };
}

export const kirliOnayi = (modal: ReturnType<typeof App.useApp>["modal"], onOk: () => void) =>
  modal.confirm({
    title: "Kaydedilmemiş değişiklikler var",
    content: "Pencereyi kapatırsanız yazdıklarınız silinecek.",
    okText: "Değişiklikleri sil",
    okButtonProps: { danger: true },
    cancelText: "Düzenlemeye devam et",
    onOk,
  });

/** İlk hatalı alana kaydır ve odakla (hata dalında elle odak). */
export function ilkHatayaOdaklan(sira: readonly string[], hatalar: Hatalar, refler: Record<string, InputRef | null>) {
  const alan = sira.find((a) => hatalar[a]);
  if (!alan) return;
  const ref = refler[alan];
  ref?.input?.scrollIntoView?.({ block: "center" });
  ref?.focus();
}

/**
 * Yerel doğrulama + sunucu alan hataları tek çatı altında. Sunucu hataları prop'tan KOPYALANIR: kullanıcı bir
 * alanı değiştirince yalnız o alanın (yerel + sunucu) hatası silinir, ebeveyndeki bayat 422 geri sızmaz.
 */
export function useAlanHatalari(acik: boolean | undefined, alanHatalari: Hatalar | undefined, sira: readonly string[], refler: React.MutableRefObject<Record<string, InputRef | null>>) {
  const [yerel, setYerel] = useState<Hatalar>({});
  const [sunucu, setSunucu] = useState<Hatalar>({});
  useEffect(() => {
    if (acik) setYerel({});
  }, [acik]);
  useEffect(() => {
    const gelen = alanHatalari ?? {};
    setSunucu(gelen);
    if (Object.values(gelen).some(Boolean)) ilkHatayaOdaklan(sira, gelen, refler.current);
    // `sira`/`refler` sabit kimliklidir; yalnız sunucu hatası değişince çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alanHatalari]);
  const temizle = (alan: string) => {
    setYerel((h) => (h[alan] ? { ...h, [alan]: undefined } : h));
    setSunucu((h) => (h[alan] ? { ...h, [alan]: undefined } : h));
  };
  const gosterilen = (alan: string) => yerel[alan] ?? sunucu[alan];
  /** Yerel doğrulama sonucunu yazar; hata varsa ilk hatalıya odaklar ve true döner. */
  const yerelHatalariUygula = (hatalar: Hatalar) => {
    setYerel(hatalar);
    const hataVar = Object.values(hatalar).some(Boolean);
    if (hataVar) ilkHatayaOdaklan(sira, hatalar, refler.current);
    return hataVar;
  };
  return { gosterilen, temizle, yerelHatalariUygula };
}
