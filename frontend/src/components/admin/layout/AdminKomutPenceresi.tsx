import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { KomutPenceresi, type KomutGrubu } from "@/components/admin/ui2/komutPenceresi";
import { ADMIN_NAV_GROUPS, ADMIN_NAV_ITEMS } from "./adminNavigation";
import { useAuthStore } from "@/store/authStore";

/**
 * ── Panelin komut penceresi ve klavye kısayolları (İP-B1 · Görev 4) ──
 *
 * Mekanizma sıfırdan YAZILMADI: `ui2/komutPenceresi` görev modülünün
 * palet'inden taşındı (gerekçe orada). Buradaki dosya yalnız panelin VERİSİNİ
 * verir — izinden geçmiş gezinme öğeleri — ve iki klavye yolunu bağlar.
 *
 * ## Neden `G` + harf, tek harf değil
 *
 * Tek harfli bir kısayol metin alanında yazmayı bozar. İki tuşluk dizinin ilk
 * tuşu bir metin alanında yakalanmaz, dolayısıyla çakışma DOĞAL olarak çözülür.
 * Medusa da aynı deseni kullanıyor (`G P`, `G I`, `G R`).
 *
 * Yine de yetmez ve kırmızı matriste ayrı bir madde olarak duruyor: kullanıcı
 * komut penceresinin arama kutusuna "gk" yazarsa, `keydown` window'a kadar
 * çıkar ve dizi tetiklenirdi — yani kullanıcı yazarken panel altından kayardı.
 * Bu yüzden dizi, odak bir metin girdisindeyken HİÇ BAŞLAMAZ.
 *
 * Dizinin ömrü 2 saniyedir: `G`ye basıp vazgeçen kullanıcı, dakikalar sonra
 * bastığı bir `K` ile beklenmedik biçimde başka alana gitmemelidir.
 */

const DIZI_OMRU_MS = 2000;

function metinAlanindaMi(hedef: EventTarget | null): boolean {
  const el = hedef as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const etiket = el.tagName.toLowerCase();
  return (
    etiket === "input" ||
    etiket === "textarea" ||
    etiket === "select" ||
    el.isContentEditable === true
  );
}

export interface AdminKomutPenceresiProps {
  acik: boolean;
  onAc: () => void;
  onKapat: () => void;
}

export function AdminKomutPenceresi({ acik, onAc, onKapat }: AdminKomutPenceresiProps) {
  const navigate = useNavigate();
  const [sorgu, setSorgu] = useState("");
  const [etkin, setEtkin] = useState(0);
  const permissions = useAuthStore((s) => s.user?.admin_permissions);

  const ogeler = useMemo(
    () =>
      ADMIN_NAV_ITEMS.filter((i) => {
        if (!i.requiredPermission) return true;
        const kodlar = Array.isArray(i.requiredPermission) ? i.requiredPermission : [i.requiredPermission];
        return kodlar.some((kod) => permissions?.includes(kod) ?? false);
      }),
    [permissions]
  );

  // ── Ctrl/⌘ + K ──
  useEffect(() => {
    const isle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onAc();
      }
    };
    window.addEventListener("keydown", isle);
    return () => window.removeEventListener("keydown", isle);
  }, [onAc]);

  // ── `G` + harf ──
  useEffect(() => {
    let bekliyor = false;
    let zamanlayici = 0;
    const bitir = () => {
      bekliyor = false;
      window.clearTimeout(zamanlayici);
    };
    const isle = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Odak bir metin alanındaysa dizi HİÇ başlamaz ve devam etmez.
      if (metinAlanindaMi(e.target)) {
        bitir();
        return;
      }
      const harf = e.key.toLocaleUpperCase("tr");
      if (!bekliyor) {
        if (harf === "G") {
          bekliyor = true;
          zamanlayici = window.setTimeout(bitir, DIZI_OMRU_MS);
        }
        return;
      }
      bitir();
      const hedef = ogeler.find((i) => i.kisayol === harf);
      if (hedef) {
        e.preventDefault();
        navigate(hedef.to);
      }
    };
    window.addEventListener("keydown", isle);
    return () => {
      window.removeEventListener("keydown", isle);
      bitir();
    };
  }, [ogeler, navigate]);

  // Pencere her açılışta temiz başlar; kapalıyken sorgu tutulmaz.
  useEffect(() => {
    if (acik) {
      setSorgu("");
      setEtkin(0);
    }
  }, [acik]);

  const gruplar = useMemo<KomutGrubu[]>(() => {
    const q = sorgu.trim().toLocaleLowerCase("tr");
    const eslesir = (metin: string) => metin.toLocaleLowerCase("tr").includes(q);
    return ADMIN_NAV_GROUPS.map((grup) => ({
      baslik: grup,
      ogeler: ogeler
        .filter((i) => i.group === grup)
        .filter((i) => !q || eslesir(i.label) || eslesir(i.shortLabel ?? "") || eslesir(grup))
        .map((i) => ({
          anahtar: i.to,
          etiket: i.label,
          kisayol: i.kisayol ? `G ${i.kisayol}` : undefined,
          calistir: () => navigate(i.to),
        })),
    })).filter((g) => g.ogeler.length > 0);
  }, [ogeler, sorgu, navigate]);

  return (
    <KomutPenceresi
      acik={acik}
      onKapat={onKapat}
      baslik="Komut penceresi"
      aramaEtiketi="Panelde ara"
      yerTutucu="Alan ara veya komut yaz…"
      sorgu={sorgu}
      onSorgu={(v) => {
        setSorgu(v);
        setEtkin(0);
      }}
      gruplar={gruplar}
      bosMetin="Eşleşen alan yok."
      etkin={etkin}
      onEtkin={setEtkin}
    />
  );
}
