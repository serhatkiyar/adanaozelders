// İP-16 B6 — askı/leech göstergelerinin GERÇEK DOM kanıtı.
//
// `is_leech` hiçbir yanıt şemasında yokken K-6 taraması yeşil çıkıyordu; alan
// eklendikten sonra hem sınır yeniden tarandı (backend D-6b) hem de alanın
// kullanıcıya gerçekten ULAŞTIĞI burada RTL ile ölçülür — "tip geçti" kanıt
// sayılmaz (kök CLAUDE.md §B/§H).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SrsCardFlags, SrsSuspendedSummary } from "./SrsCardFlags";

describe("SrsCardFlags", () => {
  it("leech kartta 'takıldın' rozeti ve açıklaması görünür", () => {
    render(<SrsCardFlags suspended isLeech />);
    expect(screen.getByText("askıda")).toBeTruthy();
    const rozet = screen.getByText("takıldın");
    expect(rozet.getAttribute("title")).toContain("8 kez unuttun");
  });

  it("leech olmayan askıdaki kartta yalnız askı rozeti var", () => {
    render(<SrsCardFlags suspended isLeech={false} />);
    expect(screen.getByText("askıda")).toBeTruthy();
    expect(screen.queryByText("takıldın")).toBeNull();
  });

  it("normal kartta hiç rozet basılmaz", () => {
    const { container } = render(
      <SrsCardFlags suspended={false} isLeech={false} />
    );
    expect(container.textContent).toBe("");
  });
});

describe("SrsSuspendedSummary", () => {
  it("askıda kart sayısını ve leech sayısını gösterir", () => {
    render(
      <SrsSuspendedSummary
        suspendedTotal={7}
        leechTotal={3}
        onShowSuspended={() => {}}
      />
    );
    expect(screen.getByText(/Askıda 7 kart/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "3 tanesinde takıldın" })).toBeTruthy();
  });

  it("leech yoksa yalnız askı sayısı görünür (buton yok)", () => {
    render(
      <SrsSuspendedSummary
        suspendedTotal={2}
        leechTotal={0}
        onShowSuspended={() => {}}
      />
    );
    expect(screen.getByText(/Askıda 2 kart/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("askıda kart yoksa şerit hiç render edilmez", () => {
    const { container } = render(
      <SrsSuspendedSummary
        suspendedTotal={0}
        leechTotal={0}
        onShowSuspended={() => {}}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("leech bağlantısı askı filtresini açar", () => {
    const filtreyiAc = vi.fn();
    render(
      <SrsSuspendedSummary
        suspendedTotal={5}
        leechTotal={1}
        onShowSuspended={filtreyiAc}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "1 tanesinde takıldın" }));
    expect(filtreyiAc).toHaveBeenCalledTimes(1);
  });
});
