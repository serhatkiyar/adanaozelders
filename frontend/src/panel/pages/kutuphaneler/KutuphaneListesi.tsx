import { useMemo } from "react";
import { Avatar, Button, Flex, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ConfirmDialog, ReasonDialog } from "@/components/admin/ui";
import {
  DuzenlemePenceresi,
  useDuzenlemeYuzeyi,
} from "@/components/admin/ui2/duzenlemeYuzeyi";
import { ExamSessionsManager } from "@/components/ExamSessionsManager";
import {
  LibraryEditorModal,
  emptyEditor,
  toEditorState,
  type EditorState,
} from "@/components/LibraryEditorModal";
import { LibraryPayoutForm } from "@/components/LibraryPayoutForm";
import { fetchLibraryAdmin } from "@/api/libraries";
import {
  useAdminLibraries,
  useApproveLibrary,
  useDeleteLibrary,
  useRejectLibrary,
} from "@/hooks/useLibraries";
import { getErrorMessage } from "@/lib/errors";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { OperatorsManager } from "@/pages/dashboards/AdminLibraries";
import { toast } from "@/store/toastStore";
import type { LibrarySearchOut } from "@/types";

const DURUM_ETIKETI: Record<string, string> = {
  PENDING: "Onay bekliyor",
  REJECTED: "Reddedildi",
  HIDDEN: "Gizli",
};

type Karar = { kind: "approve" | "reject" | "delete"; library: LibrarySearchOut };

const SAR: React.CSSProperties = { overflowWrap: "anywhere" };

/** Eski Kütüphaneler ekranının bütün işlem yüzeylerini koruyan yeni panel listesi. */
export function KutuphaneListesi() {
  const { token } = theme.useToken();
  const { canView, canManage } = useAdminAreaAccess("libraries");
  const sorgu = useAdminLibraries(canView);
  const onayla = useApproveLibrary();
  const reddet = useRejectLibrary();
  const sil = useDeleteLibrary();

  const kararYuzeyi = useDuzenlemeYuzeyi<Karar, void>();
  const editor = useDuzenlemeYuzeyi<EditorState, void>();
  const yonetim = useDuzenlemeYuzeyi<LibrarySearchOut, void>();
  const odeme = useDuzenlemeYuzeyi<LibrarySearchOut, void>();
  const karar = kararYuzeyi.kayit;

  const liste = useMemo(
    () => (Array.isArray(sorgu.data) ? sorgu.data : []),
    [sorgu.data],
  );
  const bekleyenler = liste.filter((kutuphane) => kutuphane.status === "PENDING");

  const duzenle = async (kutuphane: LibrarySearchOut) => {
    try {
      editor.ac(toEditorState(await fetchLibraryAdmin(kutuphane.id)));
    } catch (hata) {
      toast.error(getErrorMessage(hata, "Kütüphane yüklenemedi."));
    }
  };

  const onayGonder = (kutuphane: LibrarySearchOut) => {
    onayla.mutate(kutuphane.id, {
      onSuccess: () => {
        toast.success("Başvuru onaylandı, kütüphane yayında.");
        kararYuzeyi.kapat();
      },
      onError: (hata) => toast.error(getErrorMessage(hata, "Onay başarısız.")),
    });
  };

  const redGonder = (kutuphane: LibrarySearchOut, gerekce: string) => {
    reddet.mutate(
      { id: kutuphane.id, reason: gerekce || null },
      {
        onSuccess: () => {
          toast.success("Başvuru reddedildi.");
          kararYuzeyi.kapat();
        },
        onError: (hata) =>
          toast.error(getErrorMessage(hata, "Reddetme başarısız.")),
      },
    );
  };

  const silGonder = (kutuphane: LibrarySearchOut) => {
    sil.mutate(kutuphane.id, {
      onSuccess: () => {
        toast.success("Kütüphane silindi.");
        kararYuzeyi.kapat();
      },
      onError: (hata) => toast.error(getErrorMessage(hata, "Silme başarısız.")),
    });
  };

  if (!canView) return <AccessDenied area="Kütüphaneler" />;

  const ayrac = token.colorBorderSecondary;
  const kart: React.CSSProperties = {
    background: token.colorBgContainer,
    border: `1px solid ${ayrac}`,
    borderRadius: 4,
  };

  const bolumBasligi = (baslik: string, aciklama: string, sag?: React.ReactNode) => (
    <Flex
      align="center"
      justify="space-between"
      gap={12}
      wrap
      style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}
    >
      <div style={{ minWidth: 0 }}>
        <Typography.Text style={{ display: "block", fontSize: 18, fontWeight: 500 }}>
          {baslik}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {aciklama}
        </Typography.Text>
      </div>
      {sag}
    </Flex>
  );

  const satir = (kutuphane: LibrarySearchOut, son: boolean) => (
    <Flex
      key={kutuphane.id}
      data-testid={`kutuphane-${kutuphane.id}`}
      align="center"
      justify="space-between"
      gap={12}
      wrap
      style={{
        padding: "12px 0",
        borderBottom: son ? "none" : `1px solid ${ayrac}`,
      }}
    >
      <Flex align="center" gap={12} style={{ minWidth: 0, flex: "1 1 260px" }}>
        <Avatar
          shape="square"
          size={48}
          src={kutuphane.cover_url || undefined}
          style={{ flexShrink: 0 }}
        >
          📚
        </Avatar>
        <div style={{ minWidth: 0 }}>
          <Flex align="center" gap={8} wrap>
            <Typography.Text strong style={SAR}>
              {kutuphane.name}
            </Typography.Text>
            {kutuphane.status && kutuphane.status !== "ACTIVE" ? (
              <Tag
                color={
                  kutuphane.status === "PENDING"
                    ? "warning"
                    : kutuphane.status === "REJECTED"
                      ? "error"
                      : undefined
                }
                style={{ marginInlineEnd: 0 }}
              >
                {DURUM_ETIKETI[kutuphane.status] ?? kutuphane.status}
              </Tag>
            ) : null}
          </Flex>
          <Typography.Text
            type="secondary"
            style={{ display: "block", fontSize: 12, ...SAR }}
          >
            {kutuphane.location_text || "Konum yok"} · ★{" "}
            {kutuphane.rating_average != null
              ? kutuphane.rating_average.toFixed(1)
              : "-"}
          </Typography.Text>
        </div>
      </Flex>
      {canManage ? (
        <Flex gap={8} wrap>
          <Button onClick={() => yonetim.ac(kutuphane)}>
            Oturumlar &amp; Operatörler
          </Button>
          <Button onClick={() => odeme.ac(kutuphane)}>Ödeme</Button>
          <Button onClick={() => void duzenle(kutuphane)}>Düzenle</Button>
          <Button
            danger
            onClick={() => kararYuzeyi.ac({ kind: "delete", library: kutuphane })}
          >
            Sil
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );

  const anaGovde = sorgu.isPending ? (
    <YukleniyorDurumu etiket="Kütüphaneler yükleniyor…" />
  ) : sorgu.isError ? (
    <HataDurumu
      hata={getErrorMessage(sorgu.error, "Kütüphaneler yüklenemedi.")}
      hataAksiyon={
        <Button size="small" onClick={() => void sorgu.refetch()}>
          Tekrar dene
        </Button>
      }
    />
  ) : liste.length === 0 ? (
    <BosDurumu
      baslik="Henüz kütüphane eklenmedi"
      aciklama="Kütüphane kayıtları eklendikçe burada listelenir."
      aksiyon={
        canManage ? (
          <Button type="primary" onClick={() => editor.ac(emptyEditor())}>
            Kütüphane ekle
          </Button>
        ) : undefined
      }
    />
  ) : (
    liste.map((kutuphane, index) => satir(kutuphane, index === liste.length - 1))
  );

  return (
    <Flex vertical gap={16}>
      <Flex
        align="center"
        justify="space-between"
        gap={12}
        wrap
        style={{ minHeight: 40 }}
      >
        <Typography.Title
          level={3}
          style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}
        >
          Kütüphaneler
        </Typography.Title>
        {canManage && liste.length > 0 ? (
          <Button type="primary" onClick={() => editor.ac(emptyEditor())}>
            Kütüphane ekle
          </Button>
        ) : null}
      </Flex>
      {!canManage ? (
        <Typography.Text type="secondary">
          Salt okunur görünüm: kütüphane işlemleri için libraries.manage izni gerekir.
        </Typography.Text>
      ) : null}

      {bekleyenler.length > 0 ? (
        <section aria-label="Onay bekleyen kütüphaneler" style={kart}>
          {bolumBasligi(
            "Onay bekleyen başvurular",
            "Yeni kütüphane başvurularını inceleyip sonuçlandırın.",
            <Tag style={{ marginInlineEnd: 0 }}>{bekleyenler.length}</Tag>,
          )}
          <div style={{ padding: "0 24px" }}>
            {bekleyenler.map((kutuphane, index) => (
              <Flex
                key={kutuphane.id}
                align="center"
                justify="space-between"
                gap={12}
                wrap
                style={{
                  padding: "12px 0",
                  borderBottom:
                    index === bekleyenler.length - 1
                      ? "none"
                      : `1px solid ${ayrac}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Typography.Text strong style={{ display: "block", ...SAR }}>
                    {kutuphane.name}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12, ...SAR }}>
                    {[kutuphane.city, kutuphane.district]
                      .filter(Boolean)
                      .join(" · ") ||
                      kutuphane.location_text ||
                      "Konum belirtilmemiş"}
                  </Typography.Text>
                </div>
                {canManage ? (
                  <Flex gap={8} wrap>
                    <Button onClick={() => void duzenle(kutuphane)}>İncele</Button>
                    <Button
                      onClick={() =>
                        kararYuzeyi.ac({ kind: "reject", library: kutuphane })
                      }
                    >
                      Reddet
                    </Button>
                    <Button
                      type="primary"
                      onClick={() =>
                        kararYuzeyi.ac({ kind: "approve", library: kutuphane })
                      }
                    >
                      Onayla
                    </Button>
                  </Flex>
                ) : null}
              </Flex>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Kütüphane listesi" style={kart}>
        {bolumBasligi("Kütüphane listesi", `${liste.length} kütüphane`)}
        <div
          style={{
            padding:
              sorgu.isPending || sorgu.isError || liste.length === 0
                ? "24px"
                : "0 24px",
          }}
        >
          {anaGovde}
        </div>
      </section>

      <LibraryEditorModal yuzey={editor} />
      <DuzenlemePenceresi
        yuzey={yonetim}
        baslik={yonetim.kayit?.name ?? "Kütüphane"}
        genislik="genis"
      >
        {yonetim.kayit ? (
          <div className="space-y-6">
            <OperatorsManager libraryId={yonetim.kayit.id} />
            <div className="border-t border-slate-100 pt-5">
              <ExamSessionsManager libraryId={yonetim.kayit.id} />
            </div>
          </div>
        ) : null}
      </DuzenlemePenceresi>
      <DuzenlemePenceresi
        yuzey={odeme}
        baslik={`Ödeme Bilgileri · ${odeme.kayit?.name ?? ""}`}
      >
        {odeme.kayit ? <LibraryPayoutForm libraryId={odeme.kayit.id} /> : null}
      </DuzenlemePenceresi>

      <ConfirmDialog
        open={karar?.kind === "approve"}
        title="Kütüphane başvurusunu onayla"
        description={
          karar ? `${karar.library.name} onaylanıp public kataloğa alınacak.` : ""
        }
        confirmLabel="Onayla ve yayınla"
        isPending={onayla.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={() => karar && onayGonder(karar.library)}
      />
      <ConfirmDialog
        open={karar?.kind === "delete"}
        title="Kütüphaneyi sil"
        description={karar ? `${karar.library.name} katalogdan kaldırılacak.` : ""}
        confirmLabel="Kütüphaneyi sil"
        danger
        isPending={sil.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={() => karar && silGonder(karar.library)}
      />
      <ReasonDialog
        open={karar?.kind === "reject"}
        title="Kütüphane başvurusunu reddet"
        description={
          karar ? `${karar.library.name} için gerekçe operatöre iletilecek.` : ""
        }
        label="Red gerekçesi"
        required
        danger
        confirmLabel="Başvuruyu reddet"
        isPending={reddet.isPending}
        onClose={kararYuzeyi.kapat}
        onConfirm={(gerekce) => karar && redGonder(karar.library, gerekce)}
      />
    </Flex>
  );
}
