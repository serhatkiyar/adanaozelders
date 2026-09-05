import { EducationSection } from "@/components/EducationSection";

/**
 * Adım 8 — eğitim kaydı ve belge.
 *
 * BU ADIM YAYIN KAPISIDIR. Sunucudaki `submit_for_approval`, silinmemiş en az
 * bir eğitim kaydında belge YA DA e-Devlet barkodu arıyor. Önceki düzende bu
 * alan `/profil` sayfasındaydı: eğitmen ilan ayarlarında "Onaya Gönder"e basıp
 * 422 yiyor, sonra hangi sayfaya gitmesi gerektiğini kendi bulmak zorunda
 * kalıyordu. Kapıyı, koşulun doldurulduğu ekranın kendisine taşıdık.
 */
export function AdimBelgeler() {
  return (
    <div>
      <EducationSection editable bare withDocument />
      <p className="mt-6 border-l-2 border-slate-200 pl-4 text-[13px] leading-relaxed text-slate-500">
        Belgen ilanında görünmez ve öğrencilerle paylaşılmaz. Yalnız yönetici
        doğrulaması için saklanır.
      </p>
    </div>
  );
}
