import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ERISIM_REDDEDILDI_BASLIK } from "@/components/admin/AccessState";
import { useAdminBlogPosts } from "@/hooks/useBlog";
import { PATHS } from "@/lib/routes";
import AdminBlogListPage from "@/pages/admin/blog/AdminBlogListPage";
import { PANEL_MENU, rotaIzniBul, seciliMenuDurumu } from "@/panel/layout/menu";
import { useAuthStore } from "@/store/authStore";
import type { BlogPostAdmin } from "@/types";

vi.mock("@/hooks/useBlog", () => ({ useAdminBlogPosts: vi.fn() }));

const yazi: BlogPostAdmin = {
  id: 8,
  slug: "tyt-rehberi",
  title: "TYT Rehberi",
  excerpt: "Özet",
  body_html: "<p>Metin</p>",
  cover_image_url: null,
  status: "DRAFT",
  published_at: null,
  seo_title: "",
  seo_description: "",
  tags: [],
  updated_at: "2026-09-14T09:00:00+03:00",
};

function izin(...izinler: string[]) {
  useAuthStore.setState({ token: "t", isAuthenticated: true, user: { id: 1, role_id: 1, admin_permissions: izinler } as never });
}

function kur() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<AdminBlogListPage yeniPanel />} />
        <Route path={PATHS.adminNewBlogNew} element={<div>Yeni blog rotası</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useAdminBlogPosts).mockReset().mockReturnValue({ data: [yazi], isLoading: false, isError: false, refetch: vi.fn() } as never);
  izin("content.view", "content.manage");
});

describe("Blog yeni panel bağlantısı", () => {
  it("view yokken sorguyu kapatır ve AccessDenied gösterir", () => {
    izin();
    kur();
    expect(vi.mocked(useAdminBlogPosts).mock.calls.at(-1)).toEqual([false]);
    expect(screen.getByText(ERISIM_REDDEDILDI_BASLIK)).toBeInTheDocument();
  });

  it("view-only görünümde yazılar var, oluşturma aksiyonu yoktur", () => {
    izin("content.view");
    kur();
    expect(screen.getByText("TYT Rehberi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yeni yazı" })).not.toBeInTheDocument();
  });

  it("liste yeni düzenleme rotasına, oluşturma düğmesi yeni rotaya gider", () => {
    kur();
    expect(screen.getByRole("link", { name: /TYT Rehberi/ })).toHaveAttribute("href", "/yonetim-yeni/pazarlama/blog/8");
    fireEvent.click(screen.getByRole("button", { name: "Yeni yazı" }));
    expect(screen.getByText("Yeni blog rotası")).toBeInTheDocument();
  });

  it("rota ve Pazarlama menü seçimi doğrudur", () => {
    expect(PATHS.adminNewBlog).toBe("/yonetim-yeni/pazarlama/blog");
    expect(rotaIzniBul(PANEL_MENU, "/yonetim-yeni/pazarlama/blog/8")).toMatchObject({ requiredPermission: "content" });
    expect(seciliMenuDurumu(PANEL_MENU, "/yonetim-yeni/pazarlama/blog/8")).toEqual({ selectedKey: "pazarlama", openKeys: [] });
  });
});
