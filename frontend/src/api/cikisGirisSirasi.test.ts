import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("@/api/axios", () => ({ apiClient: { post: (...a: unknown[]) => post(...a) } }));

import { login, logout } from "@/api/auth";

describe("çıkış–giriş sırası", () => {
  beforeEach(() => post.mockReset());

  it("yoldaki çıkış bitmeden giriş isteği gönderilmez (geç gelen çıkış yeni oturumun çerezini silmesin)", async () => {
    let cikisBitir!: () => void;
    post.mockImplementationOnce(() => new Promise<void>((r) => (cikisBitir = r)));
    post.mockResolvedValueOnce({ data: { access_token: "yeni" } });

    const cikis = logout();
    const giris = login("ogrenci@ornek.com", "sifre");
    await Promise.resolve();
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);

    cikisBitir();
    await cikis;
    await expect(giris).resolves.toEqual({ access_token: "yeni" });
    expect(post.mock.calls[1][0]).toBe("/auth/login");
  });

  it("çıkış hata verse de giriş devam eder", async () => {
    post.mockRejectedValueOnce(new Error("ağ"));
    post.mockResolvedValueOnce({ data: { access_token: "yeni" } });
    await expect(logout()).rejects.toThrow();
    await expect(login("a@b.com", "s")).resolves.toEqual({ access_token: "yeni" });
  });
});
