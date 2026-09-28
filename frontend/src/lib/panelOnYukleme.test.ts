import { describe, expect, it, vi } from "vitest";
import {
  birKezYukle,
  panelSayfaYukleyicileri as Y,
  sekmeYukleyicileri,
  topluOnYuklemeUygun,
} from "@/lib/panelOnYukleme";
import { TUTOR_PANO_SEKMELERI, UYE_PANO_SEKMELERI } from "@/lib/nav";
import { ROUTES } from "@/lib/routes";
import { ROLE_IDS } from "@/types";

const EGITMEN = ROLE_IDS.TUTOR;
const OGRENCI = ROLE_IDS.CLIENT;

describe("sekmeYukleyicileri", () => {
  it("rol dağıtıcı adresler App.tsx'teki dağıtıcılarla aynı sayfayı seçer", () => {
    expect(sekmeYukleyicileri(ROUTES.bookings, EGITMEN)).toEqual([Y.TutorDashboard]);
    expect(sekmeYukleyicileri(ROUTES.bookings, OGRENCI)).toEqual([Y.OgrenciPano]);
    expect(sekmeYukleyicileri(ROUTES.tutorCalendar, EGITMEN)).toEqual([Y.TutorCalendar]);
    // Öğrenci /takvim'de /dersler?sekme=takvim'e yönlenir.
    expect(sekmeYukleyicileri(ROUTES.tutorCalendar, OGRENCI)).toEqual([Y.Reservations]);
    expect(sekmeYukleyicileri(ROUTES.reservations, OGRENCI)).toEqual([Y.Reservations]);
    expect(sekmeYukleyicileri(ROUTES.reservations, EGITMEN)).toEqual([]);
  });

  it("eğitmene özel sekmeler öğrenci için yüklenmez", () => {
    for (const yol of [ROUTES.tutorListing, ROUTES.tutorStudents, ROUTES.tutorAnalytics]) {
      expect(sekmeYukleyicileri(yol, OGRENCI)).toEqual([]);
    }
  });

  it("şeritteki her sekmenin rolüne göre bir yükleyicisi vardır", () => {
    for (const item of TUTOR_PANO_SEKMELERI) {
      expect(sekmeYukleyicileri(item.to, EGITMEN), item.to).toHaveLength(1);
    }
    for (const item of UYE_PANO_SEKMELERI) {
      expect(sekmeYukleyicileri(item.to, OGRENCI), item.to).toHaveLength(1);
    }
  });

  it("tanınmayan adres ve rolsüz kullanıcıda rol dağıtıcı adres için yükleyici yok", () => {
    expect(sekmeYukleyicileri("/bilinmeyen", EGITMEN)).toEqual([]);
    expect(sekmeYukleyicileri(ROUTES.bookings, undefined)).toEqual([]);
  });
});

describe("birKezYukle", () => {
  it("aynı yükleyiciyi bir kez çağırır", () => {
    const y = vi.fn(() => Promise.resolve({}));
    birKezYukle(y);
    birKezYukle(y);
    expect(y).toHaveBeenCalledTimes(1);
  });

  it("başarısız indirmeden sonra yeniden denemeye izin verir", async () => {
    const y = vi.fn(() => Promise.reject(new Error("ağ")));
    birKezYukle(y);
    await Promise.resolve();
    await Promise.resolve();
    birKezYukle(y);
    expect(y).toHaveBeenCalledTimes(2);
  });
});

describe("topluOnYuklemeUygun", () => {
  it("veri tasarrufunda ve 2G'de toplu ön yükleme yapmaz", () => {
    expect(topluOnYuklemeUygun({ saveData: true, effectiveType: "4g" })).toBe(false);
    expect(topluOnYuklemeUygun({ effectiveType: "2g" })).toBe(false);
    expect(topluOnYuklemeUygun({ effectiveType: "slow-2g" })).toBe(false);
  });

  it("normal bağlantıda ve bağlantı bilgisi yokken yapar", () => {
    expect(topluOnYuklemeUygun({ effectiveType: "4g" })).toBe(true);
    expect(topluOnYuklemeUygun(undefined)).toBe(true);
  });
});
