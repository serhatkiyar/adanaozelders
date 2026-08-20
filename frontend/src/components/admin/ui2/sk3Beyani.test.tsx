/**
 * İP-A7d2 · Görev 1 — SK-3 artık sessiz değil.
 *
 * A7d1'in bulgusu: `useYuzeyKirliFormBekcisi` pencereyi RENDER EDEN bileşende
 * çağrılırsa `BekciBildirimCtx`in dışında kalır, `bildir` `null` gelir, pencere
 * bekçiyi hiç tanımaz ve ×/ESC/dış tıklama kirli formu SORMADAN kapatır.
 * Kullanıcının yazdığı veri gider; tip hatası da uyarı da yoktur.
 *
 * A7d1 otomatik uyarı eklememeyi seçmişti çünkü sağlayıcısız çağrı MEŞRU bir
 * kullanımdır (satır içi form). Bu paket o sonucu çeviriyor: meşru durum
 * kendini BEYAN eder (`pencereSiz: true`), beyansız + sağlayıcısız çağrı
 * geliştirmede patlar.
 *
 * Aşağıdaki üç test o kararın TERS PROVASIDIR ve üçü birlikte anlamlıdır:
 * ilki tek başına, kanca her koşulda patlasa da geçerdi.
 */
import { render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
  useYuzeyKirliFormBekcisi,
} from "./duzenlemeYuzeyi";
import { HATA_TAKIBI_YOK } from "./kirliFormBekcisi";

class HataSiniri extends Component<
  { children: ReactNode; yakalandi: (h: Error) => void },
  { patladi: boolean }
> {
  state = { patladi: false };
  static getDerivedStateFromError() {
    return { patladi: true };
  }
  componentDidCatch(hata: Error) {
    this.props.yakalandi(hata);
  }
  render() {
    return this.state.patladi ? <p>patladı</p> : this.props.children;
  }
}

function Form({ pencereSiz }: { pencereSiz?: true }) {
  const form = useForm<{ deger: string }>({ defaultValues: { deger: "" } });
  useYuzeyKirliFormBekcisi({ form, sunucuHatasi: HATA_TAKIBI_YOK, pencereSiz });
  return <input aria-label="Değer" {...form.register("deger")} />;
}

/** Kancayı pencerenin İÇİNDE çağıran doğru yazım. */
function PencereIci() {
  const yuzey = useDuzenlemeYuzeyi<{ id: number }, void>();
  return (
    <div>
      <button onClick={() => yuzey.ac({ id: 1 })}>Aç</button>
      <DuzenlemePenceresi yuzey={yuzey} baslik="Düzenle">
        <Form />
      </DuzenlemePenceresi>
    </div>
  );
}

function kur(icerik: ReactNode) {
  const hatalar: Error[] = [];
  // React patlayan render'ı ayrıca `console.error`a yazar; testin çıktısını
  // kirletmesin (hata zaten sınırda yakalanıyor).
  const sessiz = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<HataSiniri yakalandi={(h) => hatalar.push(h)}>{icerik}</HataSiniri>);
  sessiz.mockRestore();
  return hatalar;
}

describe("İP-A7d2 · SK-3 beyanı", () => {
  it("sağlayıcı YOK + beyan YOK → geliştirmede patlar ve ne yapılacağını söyler", () => {
    const hatalar = kur(<Form />);
    expect(screen.getByText("patladı")).toBeTruthy();
    expect(hatalar).toHaveLength(1);
    // Mesaj TEŞHİS değil TALİMAT vermeli: iki çıkış yolunu da adıyla saysın.
    expect(hatalar[0].message).toContain("pencereSiz");
    expect(hatalar[0].message).toContain("DuzenlemePenceresi");
  });

  it("sağlayıcı YOK + beyan VAR → geçer (satır içi form meşrudur)", () => {
    const hatalar = kur(<Form pencereSiz />);
    expect(hatalar).toEqual([]);
    expect(screen.getByLabelText("Değer")).toBeTruthy();
  });

  it("sağlayıcı VAR + beyan YOK → geçer (doğru yazım cezalandırılmaz)", () => {
    const hatalar = kur(<PencereIci />);
    expect(hatalar).toEqual([]);
    expect(screen.getByRole("button", { name: "Aç" })).toBeTruthy();
  });
});
