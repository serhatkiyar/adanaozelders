/**
 * Formun ALTINDAKİ açıklayıcı bölüm.
 *
 * Eskiden sayfanın solunda, formla yan yanaydı; mobilde bu, formu ekranın
 * altına itiyordu. Sayfaya gelen kişinin ilk gördüğü şey form olmalı —
 * anlatı, karar vermeden önce soru sorana gerekir.
 */

const ADIMLAR = [
  {
    baslik: "Formu doldur",
    metin: "Ad, telefon ve verdiğin dersler yeterli.",
  },
  {
    baslik: "Telefonla tanışalım",
    metin:
      "En geç 24 saat içinde seni arıyoruz; soruların varsa bu aramada cevaplıyoruz.",
  },
  {
    baslik: "İlanın yayına çıksın",
    metin:
      "Uygunsa profilini birlikte açıyoruz; Adana'daki öğrenciler sana ulaşmaya başlıyor.",
  },
];

const SSS = [
  {
    soru: "Başvuru için ücret ödeyecek miyim?",
    cevap: "Hayır. Ön başvuru da, platformda ilan açmak da ücretsizdir.",
  },
  {
    soru: "Kimler başvurabilir?",
    cevap:
      "Öğretmenler, alanında deneyimli eğitmenler ve ders vermek isteyen üniversite öğrencileri. Uygunluğu telefon görüşmesinde birlikte netleştiriyoruz.",
  },
  {
    soru: "Verdiğim derslerin listede olması gerekiyor mu?",
    cevap:
      "Hayır. Ne veriyorsan kendi cümlelerinle yaz; uygun kategoriyi biz eşleştiriyoruz.",
  },
  {
    soru: "Bilgilerim ne olacak?",
    cevap:
      "Ad, telefon, fotoğraf ve eklediğin belgeler yalnız başvurunu değerlendirmek için kullanılır; üçüncü kişilerle paylaşılmaz.",
  },
];

export function Anlati() {
  return (
    <div className="mt-14 space-y-12">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Nasıl işliyor
        </h2>
        <ol className="mt-4 divide-y divide-slate-100">
          {ADIMLAR.map((adim, i) => (
            <li key={adim.baslik} className="flex gap-4 py-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-xs font-semibold text-slate-500">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-slate-900">{adim.baslik}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  {adim.metin}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Sık sorulanlar
        </h2>
        <div className="mt-2 divide-y divide-slate-100">
          {SSS.map((madde) => (
            <details key={madde.soru} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
                {madde.soru}
                <span
                  aria-hidden
                  className="shrink-0 text-lg leading-none text-slate-400 transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {madde.cevap}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
