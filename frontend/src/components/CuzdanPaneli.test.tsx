/**
 * Öğretmen cüzdanı kutusu — "Para çek" durumları ve "Geçmişi dosya olarak ver".
 *
 * Kural (23 Eyl 2026): para öğretmen "Para çek" diyene kadar gönderilmez;
 * düğme sunucunun verdiği engel gerekçesine göre pasifleşir.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Wallet } from "@/types";

let cuzdan: Wallet;
const paraCek = vi.fn();
const indir = vi.fn();

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ data: cuzdan, isLoading: false, isError: false }),
  useRequestWithdrawal: () => ({ mutate: paraCek, isPending: false }),
  useDownloadWalletCsv: () => ({ mutate: indir, isPending: false }),
}));
vi.mock("@/store/toastStore", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { CuzdanIcerik } = await import("@/components/CuzdanPaneli");

function goster() {
  render(
    <MemoryRouter>
      <CuzdanIcerik />
    </MemoryRouter>
  );
}

const TEMEL: Wallet = {
  balance: "1250.00",
  pending: "300.00",
  currency: "TRY",
  payout_status: "ACTIVE",
  open_request: null,
  withdraw_block_reason: null,
};

beforeEach(() => {
  paraCek.mockReset();
  indir.mockReset();
  cuzdan = { ...TEMEL };
});

describe("CuzdanIcerik", () => {
  it("bakiye ve etkin Para çek; emanetteki tutar gösterilmez", () => {
    goster();
    expect(screen.getByText("1.250 ₺")).toBeTruthy();
    expect(screen.getByText("Mevcut bakiye")).toBeTruthy();
    expect(screen.queryByText(/Hesabına geçecek/)).toBeNull();
    expect(screen.queryByText(/300 ₺/)).toBeNull();
    const dugme = screen.getByRole("button", { name: "Para çek" }) as HTMLButtonElement;
    expect(dugme.disabled).toBe(false);
    fireEvent.click(dugme);
    expect(paraCek).toHaveBeenCalledTimes(1);
  });

  it("IBAN yoksa düğme pasif ve ödeme bilgilerine bağlantı var", () => {
    cuzdan = {
      ...TEMEL,
      payout_status: "NONE",
      withdraw_block_reason: "Para çekmek için önce ödeme bilgilerini (IBAN) ekle.",
    };
    goster();
    expect((screen.getByRole("button", { name: "Para çek" }) as HTMLButtonElement).disabled).toBe(true);
    const link = screen.getByRole("link", { name: "Ödeme bilgilerini ekle" });
    expect(link.getAttribute("href")).toBe("/ayarlar?bolum=odeme");
  });

  it("açık talep varken bilgi satırı ve pasif düğme", () => {
    cuzdan = {
      ...TEMEL,
      open_request: { amount: "1250.00", created_at: "2026-09-23T10:00:00Z" },
      withdraw_block_reason: "Zaten işlenmekte olan bir para çekme talebin var.",
    };
    goster();
    expect(screen.getByText("1.250 ₺ çekim talebin işleniyor.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Para çek" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Geçmişi dosya olarak ver indirmeyi tetikler", () => {
    goster();
    fireEvent.click(screen.getByRole("button", { name: /Geçmişi dosya olarak ver/ }));
    expect(indir).toHaveBeenCalledTimes(1);
  });
});
