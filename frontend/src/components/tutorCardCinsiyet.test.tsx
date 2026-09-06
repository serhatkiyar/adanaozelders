/**
 * Eğitmen kartında cinsiyet — asıl önemli olan OLUMSUZ iddia.
 *
 * ## Sözleşme
 *
 * `gender` API'de ta baştan vardı ve arama filtresi olarak ÇALIŞIYORDU, ama
 * hiçbir ekran onu basmıyordu: öğrenci "Kadın" filtreliyor, sonuçlar geliyor,
 * ama sonuçların neye göre geldiğini göremiyordu.
 *
 * Gösterimin kendisi kolay; kolay olmayan, BELİRTİLMEMİŞ durumda hiçbir şey
 * yazmamaktır. "Belirtilmemiş" basmak yokluğu ilan etmektir ve bugün
 * satırların çoğu boştur — kart yarısı "Belirtilmemiş" yazan bir listeye
 * dönerdi. Bu yüzden buradaki üç düğümün ikisi olumsuz.
 *
 * ## İki yönlü
 *
 * Yalnız "yazmıyor" iddiası yazılsaydı, kart tümüyle bozulup HİÇBİR ŞEY
 * basmadığında da yeşil kalırdı. Doluluk düğümü (`Kadın` gerçekten görünüyor)
 * o kaçışı kapatır.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TutorCard } from "@/components/TutorCard";
import { Gender, TeachingMode, type TutorSearchOut } from "@/types";

function egitmen(gender: Gender | null | undefined): TutorSearchOut {
  return {
    id: 7,
    slug: "ayse-yilmaz-7",
    full_name: "Ayşe Yılmaz",
    hourly_rate: "500",
    teaching_mode: TeachingMode.ONLINE,
    gender,
    rating_count: 0,
    bayesian_score: 0,
    subjects: ["Matematik"],
  };
}

const ciz = (g: Gender | null | undefined) =>
  render(
    <MemoryRouter>
      <TutorCard tutor={egitmen(g)} showBookmark={false} />
    </MemoryRouter>
  );

describe("TutorCard · cinsiyet", () => {
  it("değer varsa görünür (DOLULUK — olumsuz düğümlerin kaçış kapısı)", () => {
    ciz(Gender.FEMALE);
    expect(screen.getByText(/Kadın/)).toBeTruthy();
    // Kart gerçekten çizildi mi: cinsiyet metni tek başına yanıltıcı olmasın.
    expect(screen.getByText("Ayşe")).toBeTruthy();
  });

  it("cinsiyet, konum meta satırının İÇİNDE — ayrı rozet DEĞİL", () => {
    ciz(Gender.MALE);
    // Ayrı rozet, demografik bir özniteliğe "ilk ders ücretsiz" gibi TİCARİ
    // bir sinyalle aynı görsel ağırlığı verirdi. Aynı düğümde geçmesi şart.
    expect(screen.getByText("Uzaktan · Erkek")).toBeTruthy();
  });

  it("BELİRTİLMEMİŞ durumda 'Belirtilmemiş' YAZMAZ", () => {
    for (const bos of [null, undefined, Gender.UNSPECIFIED]) {
      const { unmount } = ciz(bos);
      expect(screen.queryByText(/Belirtilmemiş/)).toBeNull();
      // Kalem tümüyle atlanır: meta satırında yalnız konum kalır, sondaki
      // ayırıcı da düşer ("Uzaktan · " gibi sarkan bir nokta kalmamalı).
      expect(screen.getByText("Uzaktan")).toBeTruthy();
      unmount();
    }
  });
});
