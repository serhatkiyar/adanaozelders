/**
 * Eğitmen kartında cinsiyet — **artık yazılmıyor** (kullanıcı kararı, 7 Eyl 2026).
 *
 * ## Değişen kabul ölçütü
 *
 * Bu dosya önce TERSİNİ çıpalıyordu: cinsiyet meta satırının içinde
 * görünmeli, "Belirtilmemiş" ise hiçbir şey yazılmamalı. Gerekçesi şuydu:
 * *"öğrenci 'Kadın' filtreliyor, sonuçlar geliyor, ama sonuçların neye göre
 * geldiğini göremiyordu."*
 *
 * Kullanıcı kararıyla ölçüt değişti: **listede cinsiyet yazılmaz.** Ölçüt
 * sessizce değil, gerekçesiyle değişiyor — eski iddia bu dosyada silinip
 * yerine yenisi geçtiği için, ileride "eskiden görünüyordu, neden kalktı"
 * sorusunun cevabı burada duruyor.
 *
 * ## Kapsam 8 Eyl'de GENİŞLEDİ
 *
 * O tur karar yalnız kartı kapsıyordu ve değer eğitmenin profilinde
 * (`PublicTutorProfile`) basılmaya devam ediyordu. Kullanıcı 8 Eyl'de orayı da
 * kaldırttı: *"cinsiyet bilgisinin yazmasına gerek var mı, fotoğraftan belli
 * olur zaten."*
 *
 * Arama tarafı İKİ TURDA DA dokunulmadan kaldı: cinsiyet filtresi çalışıyor ve
 * faset sayıları görünüyor. Asıl gerekçe oydu — öğrenci "Kadın" filtrelediğinde
 * sonuçların neye göre elendiğini görebiliyor. Kaldırılan şey o şeffaflık
 * değil, tek tek profillerdeki demografik etiket.
 *
 * ## Bu dosyanın ASIL iddiası
 *
 * "Cinsiyet yazılmıyor" tek başına yazılsaydı, kart tümüyle bozulup HİÇBİR
 * ŞEY basmadığında da yeşil kalırdı. Doluluk düğümü (konum ve ad gerçekten
 * görünüyor) o kaçışı kapatır.
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
    display_name: "Ayşe",
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

describe("TutorCard · cinsiyet listede yazılmaz", () => {
  it("DOLULUK: kart gerçekten çiziliyor ve konum satırı basılıyor", () => {
    // Olumsuz düğümlerin kaçış kapısı. Bu olmadan "Kadın yok" iddiası,
    // kart hiç render olmadığında da yeşil kalırdı.
    ciz(Gender.FEMALE);
    expect(screen.getByText("Ayşe")).toBeTruthy();
    expect(screen.getByText("Uzaktan")).toBeTruthy();
  });

  it.each([
    ["kadın", Gender.FEMALE],
    ["erkek", Gender.MALE],
  ])("%s eğitmende cinsiyet METNİ YOK", (_ad, g) => {
    ciz(g);
    expect(screen.queryByText(/Kadın/)).toBeNull();
    expect(screen.queryByText(/Erkek/)).toBeNull();
  });

  it("meta satırı sarkan ayırıcı bırakmıyor", () => {
    // Kalem kaldırılırken `" · "` birleştirmesi de kalktı; kalsaydı
    // "Uzaktan · " gibi sonu boş bir satır doğardı.
    ciz(Gender.MALE);
    expect(screen.queryByText(/·\s*$/)).toBeNull();
  });

  it("BELİRTİLMEMİŞ durumda da değişen bir şey yok", () => {
    for (const bos of [null, undefined, Gender.UNSPECIFIED]) {
      const { unmount } = ciz(bos);
      expect(screen.queryByText(/Belirtilmemiş/)).toBeNull();
      expect(screen.getByText("Uzaktan")).toBeTruthy();
      unmount();
    }
  });
});
