import type { ReactNode } from "react";
import { formatResponseTime } from "@/lib/datetime";
import type { TutorSearchOut } from "@/types";

// Eğitmen güven sinyalleri: hem public (PublicTutorProfile) hem panel
// (TutorProfile) görünümünde paylaşılır. Tüm veriler backend'den gerçek;
// public profilde yalnız APPROVED eğitmenler döndüğü için "Onaylı" her zaman geçerli.

/** İsmin yanına gelen "Onaylı Eğitmen" rozeti (yönetici onayından geçmiştir). */
export function VerifiedTutorBadge() {
  return (
    <span
      title="Bu eğitmen yönetici onayından geçti"
      className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 "
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
        <path
          fillRule="evenodd"
          d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.883l-3.236 4.53-1.766-1.767a.75.75 0 0 0-1.06 1.06l2.4 2.4a.75.75 0 0 0 1.137-.089l3.739-5.234Z"
          clipRule="evenodd"
        />
      </svg>
      Onaylı
    </span>
  );
}

/** "Kimliği Doğrulanmış" rozeti — ödeme hesabı (iyzico alt üye işyeri) onaylı,
 *  yani TCKN/IBAN iyzico'nun MERNIS/IBAN kontrolünden geçti. */
export function IdentityVerifiedBadge() {
  return (
    <span
      title="Kimliği iyzico üzerinden doğrulandı (TCKN/IBAN)"
      className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200 "
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
      Kimliği Doğrulanmış
    </span>
  );
}

/** "Diploması Doğrulandı" rozeti — en az bir eğitimde belge DOĞRULANMIŞ (admin
 *  e-Devlet barkodunu teyit etmiş). Yalnız yüklenmiş (doğrulanmamış) belge yetmez. */
/**
 * Diploması doğrulanmış eğitmen — NİŞAN, cümle değil.
 *
 * Önce "Diploması Doğrulandı" yazan yeşil bir çipti ve eğitmenin adının hemen
 * yanında durduğu için ismi eziyordu. Rozetin işi bilgi vermek değil, bir
 * ayrıcalığı İŞARET ETMEK; açıklaması zaten profilin eğitim bölümünde yazılı.
 *
 * Şekil kullanıcının seçtiği madalya (kullanıcı dosyayı gönderdi, 8 Eyl):
 * dolu daire üstüne beyaz çember + kurdele ucu. Akademik nişanın yerleşik
 * görsel dili ve 20px'e indiğinde de siluet olarak okunuyor. 3B/gradyanlı bir
 * görsel yerine düz çizgi tercih edildi çünkü site başka hiçbir yerde öyle bir
 * öğe kullanmıyor.
 *
 * Renk sabit değil `currentColor`: sarmalayıcı `text-emerald-600` veriyor,
 * yani rozet site paletine bağlı kalıyor. Gelen dosyadaki `#60C78F` doğrudan
 * gömülseydi palete kaçak bir yeşil daha girerdi.
 *
 * Metin kalktı ama ERİŞİLEBİLİRLİK kalmadı sayılmaz: `role="img"` +
 * `aria-label` ikonun süs değil ANLAM taşıdığını söyler, `title` fareyle
 * açıklamayı verir. Yalnız `title` bırakılsaydı rozet dokunmatik ekranda ve
 * ekran okuyucuda sessiz kalırdı.
 */
export function DocumentedBadge() {
  const aciklama = "Diploması e-Devlet üzerinden doğrulandı";
  return (
    <span
      title={aciklama}
      role="img"
      aria-label={aciklama}
      className="inline-flex shrink-0 text-emerald-600"
    >
      <svg viewBox="0 0 512 512" className="h-5 w-5" aria-hidden>
        <circle cx="256" cy="256" r="256" fill="currentColor" />
        <g
          fill="none"
          stroke="#fff"
          strokeWidth={24.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="256" cy="208.4" r="86.3" />
          <path d="M306 278.8 316.4 390 256 353 195.6 390 206 278.8" />
        </g>
      </svg>
    </span>
  );
}

function StatCell({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  // Sakin, kutusuz satır: küçük ikon + değer + açıklama.
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-slate-400 ">{icon}</span>
      <p className="min-w-0 text-sm text-slate-600 ">
        <span className="font-semibold text-slate-900 ">{value}</span>{" "}
        {label}
      </p>
    </div>
  );
}

/**
 * Eğitmen güven istatistikleri şeridi: tamamlanan ders, değerlendirme ve üyelik
 * başlangıcı. Yalnız anlamlı veri olan hücreler gösterilir; hiçbiri yoksa gizlenir.
 */
export function TutorTrustBar({
  tutor,
  vertical = false,
}: {
  tutor: TutorSearchOut;
  /** Dar kolon (yan sticky kart) için hücreleri tek sütunda diz. */
  vertical?: boolean;
}) {
  const cells: { icon: React.ReactNode; value: string; label: string }[] = [];

  const completed = tutor.completed_lessons ?? 0;
  if (completed > 0) {
    cells.push({
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5zm0 0v6m0-6l6.16-3.42A12 12 0 0 1 12 21a12 12 0 0 1-6.16-10.42L12 14z" />
        </svg>
      ),
      value: String(completed),
      label: "tamamlanan ders",
    });
  }

  // NOT: Değerlendirme puanı bilerek burada gösterilmez — profil resminin hemen
  // altında zaten yıldız+puan var (tekrar etmemek için).
  // Ortalama yanıt süresi — mesajlaşma verisinden hesaplanır; veri yoksa gizlenir.
  if (tutor.avg_response_seconds != null) {
    cells.push({
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
        </svg>
      ),
      value: formatResponseTime(tutor.avg_response_seconds),
      label: "Ortalama yanıt süresi",
    });
  }

  if (cells.length === 0) return null;

  return (
    <div
      className={`mt-5 grid grid-cols-1 gap-2.5 border-t border-slate-100 pt-5 ${
        vertical ? "" : "sm:grid-cols-3"
      }`}
    >
      {cells.map((c) => (
        <StatCell key={c.label + c.value} icon={c.icon} value={c.value} label={c.label} />
      ))}
    </div>
  );
}

/** Eğitimlerde diploma/belge var mı? (yalnız yükleme — zayıf sinyal). */
export function hasDocumentedEducation(
  educations: { document_url?: string | null }[] | undefined
): boolean {
  return !!educations?.some((e) => e.document_url);
}

/** Eğitimlerde DOĞRULANMIŞ diploma var mı? ("Diploması Doğrulandı" rozeti için). */
export function hasVerifiedEducation(
  educations: { verification_status?: string | null }[] | undefined
): boolean {
  return !!educations?.some((e) => e.verification_status === "VERIFIED");
}

/* ─────────────────────────────────────────────────────────────────────────
   Sabit kartın ÖZET TABLOSU (kullanıcı kararı, 7 Eyl 2026 · Superprof deseni)

   Kart 632 pikseldi ve 1366x768, 1280x720, 1100x700 ekranlarının üçünde de
   taşıyordu; kullanıcı kartın tamamını görmek için sayfayı sonuna kadar
   kaydırmak zorunda kalıyordu. Ölçüldü: Superprof'un aynı kartı yaklaşık
   yarı boyda çünkü ücreti ve güven sinyallerini AYRI BLOKLAR hâlinde değil
   tek bir etiket/değer tablosunda veriyor.

   Bu bileşen o tabloyu kurar: solda etiket, sağda değer, aralarında saç-teli
   çizgi. `TutorTrustBar`ın dikey hâli + ayrı ücret bloğu bunun yerine geçti.
   Veri yoksa satır BASILMAZ — "Belirtilmemiş" yazmak yokluğu ilan etmektir.
   ──────────────────────────────────────────────────────────────────────── */

export function TutorOzetTablosu({
  tutor,
  ucret,
}: {
  tutor: TutorSearchOut;
  /** Biçimlendirilmiş saatlik ücret; `null` ise satır basılmaz. */
  ucret: string | null;
}) {
  const satirlar: { etiket: string; deger: string }[] = [];

  if (ucret) satirlar.push({ etiket: "Ücret", deger: ucret });

  if (tutor.avg_response_seconds != null) {
    satirlar.push({
      etiket: "Yanıt süresi",
      deger: formatResponseTime(tutor.avg_response_seconds),
    });
  }

  const tamamlanan = tutor.completed_lessons ?? 0;
  if (tamamlanan > 0) {
    satirlar.push({ etiket: "Tamamlanan ders", deger: String(tamamlanan) });
  }

  if (satirlar.length === 0) return null;

  return (
    <dl className="mt-4 divide-y divide-slate-100 border-y border-slate-100 ">
      {satirlar.map((s) => (
        <div key={s.etiket} className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-sm text-slate-500 ">{s.etiket}</dt>
          <dd className="text-sm font-semibold text-slate-900 ">{s.deger}</dd>
        </div>
      ))}
    </dl>
  );
}
