import { render, screen } from "@testing-library/react";
import { App } from "antd";
import { describe, expect, it } from "vitest";
import { VideoOnayPenceresi } from "./VideoOnayPenceresi";
import type { AdminTutorIntroVideo } from "@/types";

const temel: AdminTutorIntroVideo = {
  id: 3,
  tutor_id: 7,
  tutor_name: "Ayşe",
  status: "PENDING_REVIEW",
  kind: "UPLOAD",
  created_at: "",
  updated_at: "",
};

function ciz(kayit: AdminTutorIntroVideo) {
  return render(
    <App>
      <VideoOnayPenceresi acik canManage kayit={kayit} />
    </App>
  );
}

describe("VideoOnayPenceresi", () => {
  it("bağlantı öğesi gömülü önizlemeyle incelenir (bağlantı da ön onaydan geçer)", async () => {
    ciz({ ...temel, kind: "LINK", link_url: "https://youtu.be/dQw4w9WgXcQ" });
    const oynatici = await screen.findByTitle("Ayşe tanıtım videosu bağlantısı");
    expect(oynatici).toHaveAttribute("src", expect.stringContaining("youtube-nocookie.com/embed/dQw4w9WgXcQ"));
    expect(screen.getByText("YouTube/Vimeo bağlantısı")).toBeInTheDocument();
    expect(screen.getByText("https://youtu.be/dQw4w9WgXcQ")).toBeInTheDocument();
    expect(screen.queryByText("Bu kaydın işlenmiş dosyası yok.")).toBeNull();
  });

  it("oynatıcıya çevrilemeyen bağlantıda uyarı gösterir", async () => {
    ciz({ ...temel, kind: "LINK", link_url: "https://example.com/v" });
    expect(await screen.findByText("Bu bağlantı oynatıcıya çevrilemedi.")).toBeInTheDocument();
  });
});
