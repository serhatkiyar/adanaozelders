/**
 * Vitrin kuşağının kaydırma okları — nöbetçi.
 *
 * ## Karar (kullanıcı, 7 Eyl 2026)
 *
 * Oklar kuşağın sol/sağ kenarında, kartların ÜSTÜNE binen beyaz dairelerdi ve
 * sınıra gelince tamamen kayboluyorlardı. Kullanıcı bu görünümü beğenmedi;
 * Airbnb deseni istendi: oklar **başlık satırının sağ ucunda**, kartların
 * dışında, sınıra gelince kaybolmaz **soluklaşır** (devre dışı).
 *
 * ## Bu nöbetçinin ASIL iddiası
 *
 * İki şey sessizce geri gelebilir:
 *
 *   1. Okun kartların üstüne binmesi — yani düğmenin kaydırma kabının İÇİNDE
 *      doğması. Burada düğmenin başlık satırında, kaydırılabilir kabın DIŞINDA
 *      olduğu ölçülür.
 *   2. Sınırda kaybolma — düğme DOM'dan düşerse üstteki düzen zıplar ve satırın
 *      kaydırılabilir olduğu görünmez olur. Burada "duruyor ama `disabled`"
 *      olduğu ölçülür.
 *
 * ## Gücü ve sınırı (kök CLAUDE.md §C)
 *
 * Gerçek DOM (jsdom + gerçek `HScroll`). jsdom düzen hesaplamadığı için
 * `clientWidth`/`scrollWidth` elle kurulur — ölçülen şey görsel kayma değil,
 * **düğmelerin nerede doğduğu ve hangi durumda devre dışı kaldığıdır**.
 * Kaydırmanın kendisi (`scrollBy`) çağrıldığı için sınanır, mesafesi değil.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HScroll } from "@/components/HScroll";

/** jsdom'da düzen yok: kabın ölçülerini elle kur ve `scrollBy`yi yakala. */
function olcuKur({
  scrollLeft,
  clientWidth = 600,
  scrollWidth = 2000,
}: {
  scrollLeft: number;
  clientWidth?: number;
  scrollWidth?: number;
}) {
  const kap = document.querySelector<HTMLDivElement>(".scrollbar-hide")!;
  Object.defineProperty(kap, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(kap, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(kap, "scrollLeft", { value: scrollLeft, writable: true, configurable: true });
  kap.scrollBy = vi.fn();
  fireEvent.scroll(kap);
  return kap;
}

const ciz = () =>
  render(
    <HScroll className="gap-5" etiket="Öğretmenler" baslik={<h2>Öğretmenler</h2>}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{ width: 200 }}>
          kart {i}
        </div>
      ))}
    </HScroll>
  );

const sol = () => screen.getByRole("button", { name: "Öğretmenler: sola kaydır" });
const sag = () => screen.getByRole("button", { name: "Öğretmenler: sağa kaydır" });

afterEach(() => cleanup());

describe("vitrin kuşağı · kaydırma okları", () => {
  it("oklar BAŞLIK satırında, kaydırılabilir kabın DIŞINDA doğar", () => {
    // Kararın kendisi: eski sürümde düğmeler kabın kardeşi olarak kartların
    // üstüne biniyordu (`absolute inset-y-0`).
    ciz();
    olcuKur({ scrollLeft: 100 });

    const kap = document.querySelector(".scrollbar-hide")!;
    expect(kap.contains(sag()), "ok kaydırma kabının içinde").toBe(false);

    // Başlıkla AYNI satırda: ortak en yakın kap hem başlığı hem oku taşır.
    const satir = screen.getByText("Öğretmenler").parentElement!;
    expect(satir.contains(sag()), "ok başlık satırında değil").toBe(true);
  });

  it("sınırda KAYBOLMAZ, devre dışı kalır", () => {
    ciz();
    // Başta: sola gidilemez, sağa gidilebilir.
    olcuKur({ scrollLeft: 0 });
    expect(sol()).toBeTruthy(); // hâlâ DOM'da
    expect((sol() as HTMLButtonElement).disabled).toBe(true);
    expect((sag() as HTMLButtonElement).disabled).toBe(false);

    // Sonda: tam tersi.
    olcuKur({ scrollLeft: 1400 });
    expect((sol() as HTMLButtonElement).disabled).toBe(false);
    expect((sag() as HTMLButtonElement).disabled).toBe(true);
  });

  it("DOLULUK: etkin ok gerçekten kaydırıyor", () => {
    // Bu olmadan yukarıdaki iddialar, düğme hiçbir şey yapmasa da yeşil kalırdı.
    ciz();
    const kap = olcuKur({ scrollLeft: 0 });
    fireEvent.pointerDown(sag());
    expect(kap.scrollBy).toHaveBeenCalledTimes(1);
    const [{ left }] = (kap.scrollBy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(left).toBeGreaterThan(0);
  });

  it("ok kart aralığının TAM katına gider; ilk kaydırmada hizayı bozmaz", () => {
    ciz();
    const kap = olcuKur({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 2428 });
    Object.defineProperty(kap, "getBoundingClientRect", {
      value: () => ({ left: 32, right: 1032, width: 1000 }),
      configurable: true,
    });
    // Beş görünür kart: 5×184 + 4×20 = 1000. Bir sayfalık ok hareketi
    // dört karttır (bir kart bağlam için ekranda kalır): 4×(184+20) = 816.
    Array.from(kap.children).forEach((kart, index) => {
      Object.defineProperty(kart, "getBoundingClientRect", {
        value: () => ({
          left: 32 + index * 204,
          right: 32 + index * 204 + 184,
          width: 184,
        }),
        configurable: true,
      });
    });

    fireEvent.pointerDown(sag());
    expect(kap.scrollBy).toHaveBeenCalledWith({ left: 816, behavior: "smooth" });
  });

  it("sona karttan gider; taşan dekorun şişirdiği scrollWidth'ü hizalamaz", () => {
    ciz();
    const scrollLeft = 816;
    const kap = olcuKur({ scrollLeft, clientWidth: 1000, scrollWidth: 2430 });
    Object.defineProperty(kap, "getBoundingClientRect", {
      value: () => ({ left: 32, right: 1032, width: 1000 }),
      configurable: true,
    });
    Array.from(kap.children).forEach((kart, index) => {
      Object.defineProperty(kart, "getBoundingClientRect", {
        value: () => ({
          left: 32 + index * 204 - scrollLeft,
          right: 32 + index * 204 - scrollLeft + 184,
          width: 184,
        }),
        configurable: true,
      });
    });

    fireEvent.pointerDown(sag());
    // 12 karttan 5'i görünür: son başlangıç indeksi 7 → 7×204 = 1428.
    // scrollWidth'e göre sona gitseydi 1430'a gidip hizayı 2px bozardı.
    expect(kap.scrollBy).toHaveBeenCalledWith({ left: 612, behavior: "smooth" });
  });

  it("devre dışı ok kaydırmaz", () => {
    ciz();
    const kap = olcuKur({ scrollLeft: 0 });
    fireEvent.pointerDown(sol());
    expect(kap.scrollBy).not.toHaveBeenCalled();
  });

  it("içerik sığıyorsa ok HİÇ çizilmez", () => {
    // Kaydırılamayan bir kuşakta iki soluk düğme durmasının anlamı yok.
    ciz();
    olcuKur({ scrollLeft: 0, clientWidth: 2000, scrollWidth: 2000 });
    expect(screen.queryByRole("button", { name: /kaydır/ })).toBeNull();
    // DOLULUK: başlık yine de duruyor — kuşak render olmuş.
    expect(screen.getByText("Öğretmenler")).toBeTruthy();
  });

  it("`baslik` verilmezse ok çizilmez (eski üstüne binen desen geri gelmez)", () => {
    render(
      <HScroll className="gap-5">
        <div style={{ width: 200 }}>kart</div>
      </HScroll>
    );
    olcuKur({ scrollLeft: 100 });
    expect(screen.queryByRole("button", { name: /kaydır/ })).toBeNull();
  });
});
