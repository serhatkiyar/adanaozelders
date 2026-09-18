import { Modal } from "@/components/ui/Modal";
import {
  DUGME_SATIR_BIRINCIL,
  DUGME_SATIR_IKINCIL,
  DUGME_SATIR_TEHLIKE,
  KUCUK_ACIKLAMA,
} from "@/components/pano/stil";

/**
 * Mesajdaki dış bağlantıya tıklanınca açılan ara uyarı (Modül 5).
 *
 * Bağlantı doğrudan açılmaz: kullanıcı nereye gittiğini tam adresiyle görür,
 * alan adı kalın yazılır (ör. `adanaozelders.com.kotu.site` gibi aldatıcı
 * adresler ancak böyle fark edilir). "Şüpheli durumu bildir" yalnız karşı
 * tarafın mesajında verilir; kendi mesajını şikâyet etmek anlamsız.
 */
function adresParcalari(href: string): { once: string; host: string; sonra: string } {
  try {
    const url = new URL(href);
    const i = href.toLowerCase().indexOf(url.host.toLowerCase());
    if (i >= 0) {
      return {
        once: href.slice(0, i),
        host: href.slice(i, i + url.host.length),
        sonra: href.slice(i + url.host.length),
      };
    }
  } catch {
    // Çözümlenemeyen adres olduğu gibi gösterilir.
  }
  return { once: "", host: href, sonra: "" };
}

export function DisBaglantiUyarisi({
  href,
  onKapat,
  onBildir,
}: {
  href: string;
  onKapat: () => void;
  onBildir?: () => void;
}) {
  const { once, host, sonra } = adresParcalari(href);

  const devam = () => {
    window.open(href, "_blank", "noopener,noreferrer");
    onKapat();
  };

  return (
    <Modal open onClose={onKapat} title="Adana Özel Ders'ten ayrılıyorsun" maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
          {once}
          <strong className="font-semibold text-slate-900">{host}</strong>
          {sonra}
        </p>
        <ul className={`list-disc space-y-1.5 pl-5 ${KUCUK_ACIKLAMA}`}>
          <li>İletişimi ve ödemeyi platformda tut; dışarıda yapılan anlaşmalarda seni koruyamayız.</li>
          <li>Parola, kart ya da ödeme bilgini hiçbir sayfaya girme.</li>
          <li>Olağan dışı bir istek ya da mesaj görürsen bize bildir.</li>
        </ul>
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
          {onBildir && (
            <button type="button" onClick={onBildir} className={`${DUGME_SATIR_TEHLIKE} sm:mr-auto`}>
              Şüpheli durumu bildir
            </button>
          )}
          <button type="button" onClick={onKapat} className={DUGME_SATIR_IKINCIL}>
            Vazgeç
          </button>
          <button type="button" onClick={devam} className={DUGME_SATIR_BIRINCIL}>
            Devam et
          </button>
        </div>
      </div>
    </Modal>
  );
}
