/**
 * ── Vitrin sayfası Puck editörü (CMS Faz 2) ──
 *
 * `/yonetim/magaza/sayfa/:pageId/duzenle` — tam ekran. Açılışta taslak
 * revizyon yüklenir: `puck_data` varsa doğrudan, yoksa blok satırları
 * `blokToPuck` ile çevrilir (tek yönlü göç). Kaydet `puck_data` gönderir;
 * sunucu blok satırlarını türetir ve normalize veriyi (üretilen block_key'ler
 * dahil) GERİ döndürür — editör onunla senkronlanır. Yayınla mevcut publish
 * ucudur; public render zinciri Puck'tan habersizdir.
 *
 * Türkçeleştirme: Puck'ın kendi header'ı `overrides.header` ile tamamen
 * bizim üst çubuğumuzla değiştirilir; kalan chrome (sürükleme ipuçları vb.)
 * kısmen İngilizce kalabilir — bilinen sınır.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";

import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import { Badge, Button, ErrorState, PageSkeleton } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";
import {
  useLandingPageRevisions,
  useLandingPages,
  useMerchandisingMutations,
} from "@/hooks/useStoreMerchandising";
import { getErrorDetail } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { toast } from "@/store/toastStore";
import type { LandingPageRevision } from "@/types";

import { blokToPuck } from "./blokToPuck";
import { puckConfig } from "./puckConfig";

function kaynakVeri(revision: LandingPageRevision): { data: Data; atlanan: string[] } {
  if (revision.puck_data) {
    return { data: revision.puck_data as unknown as Data, atlanan: [] };
  }
  const { data, atlanan } = blokToPuck(revision.blocks);
  return { data: data as unknown as Data, atlanan };
}

function simdiYerel(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const ofset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - ofset).toISOString().slice(0, 16);
}

export default function PuckEditorPage() {
  const { pageId: pageIdParam } = useParams<{ pageId: string }>();
  const pageId = Number(pageIdParam);
  const navigate = useNavigate();
  const { canManage } = useAdminAreaAccess("content");

  const { data: pages } = useLandingPages();
  const sayfa = useMemo(() => pages?.find((p) => p.id === pageId), [pages, pageId]);
  const { data: revisions, isLoading, isError, refetch } = useLandingPageRevisions(
    Number.isFinite(pageId) ? pageId : undefined
  );
  const mutations = useMerchandisingMutations();

  // Taslak varsa taslak, yoksa en son revizyon temel alınır.
  const kaynakRevizyon = useMemo(() => {
    if (!revisions?.length) return null;
    return revisions.find((r) => r.status === "DRAFT") ?? revisions[0];
  }, [revisions]);

  const [veri, setVeri] = useState<Data | null>(null);
  const [atlanan, setAtlanan] = useState<string[]>([]);
  const [kirli, setKirli] = useState(false);
  // Pencere durumu ekranda YAŞAMAZ (İP-A4): yayın onayı bir yüzeydir.
  const yayinYuzeyi = useDuzenlemeYuzeyi<void, void>();
  const [baslangic, setBaslangic] = useState(simdiYerel);
  const yuklenenRevizyon = useRef<number | null>(null);

  useEffect(() => {
    if (!kaynakRevizyon || yuklenenRevizyon.current === kaynakRevizyon.id) return;
    yuklenenRevizyon.current = kaynakRevizyon.id;
    const { data, atlanan } = kaynakVeri(kaynakRevizyon);
    setVeri(data);
    setAtlanan(atlanan);
    setKirli(false);
  }, [kaynakRevizyon]);

  if (!canManage) return <AccessDenied area="Vitrin editörü" />;
  if (isLoading || veri === null) return <div className="p-6"><PageSkeleton /></div>;
  if (isError || !kaynakRevizyon) {
    return (
      <div className="p-6">
        <ErrorState description="Sayfa revizyonları yüklenemedi." onRetry={() => void refetch()} />
      </div>
    );
  }

  const kaydet = async (guncel: Data): Promise<LandingPageRevision | null> => {
    try {
      const revision = await mutations.saveDraft.mutateAsync({
        pageId,
        payload: {
          title: kaynakRevizyon.title,
          seo_title: kaynakRevizyon.seo_title,
          seo_description: kaynakRevizyon.seo_description,
          og_image_url: kaynakRevizyon.og_image_url,
          blocks: [],
          puck_data: guncel as unknown as Record<string, unknown>,
        },
      });
      // Sunucunun normalize verisi (üretilen block_key'ler) editöre geri yazılır.
      if (revision.puck_data) setVeri(revision.puck_data as unknown as Data);
      yuklenenRevizyon.current = revision.id;
      setKirli(false);
      return revision;
    } catch (e) {
      toast.error(getErrorDetail(e, "Taslak kaydedilemedi. Blok ayarlarını kontrol edin."));
      return null;
    }
  };

  const yayimla = async () => {
    if (!veri) return;
    const revision = await kaydet(veri);
    if (!revision) return;
    try {
      await mutations.publishPage.mutateAsync({
        pageId,
        startsAt: new Date(baslangic).toISOString(),
      });
      toast.success("Sayfa yayımlandı.");
      yayinYuzeyi.kapat();
    } catch (e) {
      toast.error(getErrorDetail(e, "Yayımlanamadı."));
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (kirli && !window.confirm("Kaydedilmemiş değişiklikler var. Yine de çıkılsın mı?")) {
                return;
              }
              navigate(ROUTES.adminStorePages);
            }}
          >
            ← Listeye dön
          </Button>
          <p className="truncate text-sm font-semibold text-slate-900">
            {sayfa?.internal_name ?? `Sayfa #${pageId}`}
          </p>
          <Badge tone={kaynakRevizyon.status === "DRAFT" ? "neutral" : "success"}>
            {kaynakRevizyon.status === "DRAFT" ? `Taslak v${kaynakRevizyon.version}` : `Yayında v${kaynakRevizyon.version}`}
          </Badge>
          {kirli && <span className="text-xs text-amber-600">Kaydedilmemiş değişiklik</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => window.open(ROUTES.adminStorePreview(pageId), "_blank", "noopener")}
          >
            Önizle
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isPending={mutations.saveDraft.isPending}
            onClick={() => veri && void kaydet(veri)}
          >
            Taslağı kaydet
          </Button>
          <Button size="sm" onClick={() => yayinYuzeyi.yeniAc()}>
            Yayınla
          </Button>
        </div>
      </div>

      {atlanan.length > 0 && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
          Bu tipler Puck'a çevrilemedi ve taslaktan düşecek: {atlanan.join(", ")}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <Puck
          config={puckConfig}
          data={veri}
          onChange={(sonraki) => {
            setVeri(sonraki);
            setKirli(true);
          }}
          overrides={{
            // Kendi üst çubuğumuz var; Puck'ın İngilizce header'ı çizilmez.
            header: () => <></>,
          }}
        />
      </div>

      <Modal
        open={yayinYuzeyi.acik}
        onClose={yayinYuzeyi.kapat}
        title="Sayfayı yayınla"
        description="Önce son hali taslak olarak kaydedilir, sonra yayına alınır."
      >
        <label htmlFor="puck-yayin-baslangic" className="block text-xs font-semibold text-slate-500">
          Yayın başlangıcı
        </label>
        <input
          id="puck-yayin-baslangic"
          type="datetime-local"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={baslangic}
          onChange={(e) => setBaslangic(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={yayinYuzeyi.kapat}>
            Vazgeç
          </Button>
          <Button
            isPending={mutations.publishPage.isPending || mutations.saveDraft.isPending}
            onClick={() => void yayimla()}
          >
            Yayınla
          </Button>
        </div>
      </Modal>
    </div>
  );
}
