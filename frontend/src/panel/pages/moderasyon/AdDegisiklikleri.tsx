import { useMemo } from "react";
import { Button, Flex, Segmented, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { ReasonDialog } from "@/components/admin/ui";
import { useDuzenlemeYuzeyi } from "@/components/admin/ui2/duzenlemeYuzeyi";
import {
  useAdminNameChangeRequests,
  useApproveNameChange,
  useRejectNameChange,
} from "@/hooks/useNameChanges";
import { useUrlDurumu } from "@/hooks/useUrlDurumu";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { toast } from "@/store/toastStore";
import type { NameChangeRequest, NameChangeStatus } from "@/types";

const GECERLI = new Set(["PENDING", "APPROVED", "REJECTED", "TUMU"]);
const DURUM_ETIKETI: Record<NameChangeStatus, string> = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  REJECTED: "Reddedildi",
};
const DURUM_RENGI: Record<NameChangeStatus, string> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "error",
};

/** Kullanıcı ad-soyad değişikliği karar kuyruğunu yeni panel kabuğuna taşır. */
export function AdDegisiklikleri() {
  const { token } = theme.useToken();
  const { canView, canManage } = useAdminAreaAccess("users");
  const url = useUrlDurumu({ talep: "PENDING" });
  const ham = String(url.degerler.talep);
  const filtre = (GECERLI.has(ham) ? ham : "TUMU") as NameChangeStatus | "TUMU";
  const sorgu = useAdminNameChangeRequests(filtre === "TUMU" ? undefined : filtre, canView);
  const onayla = useApproveNameChange();
  const reddet = useRejectNameChange();
  const redYuzeyi = useDuzenlemeYuzeyi<NameChangeRequest, void>();
  const mesgul = onayla.isPending || reddet.isPending;
  const liste = useMemo(() => (Array.isArray(sorgu.data) ? sorgu.data : []), [sorgu.data]);
  const ayrac = token.colorBorderSecondary;

  if (!canView) return <AccessDenied area="Ad değişiklikleri" />;

  return (
    <Flex vertical gap={24}>
      <div>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>
          Ad Değişiklikleri
        </Typography.Title>
        <Typography.Text type="secondary">
          {canManage
            ? "Kullanıcıların ad-soyad değişikliği taleplerini inceleyin."
            : "Salt okunur görünüm: karar vermek için users.manage izni gerekir."}
        </Typography.Text>
      </div>

      <Segmented
        aria-label="Talep durumu"
        block
        value={filtre}
        options={[
          { value: "PENDING", label: "Bekleyen" },
          { value: "APPROVED", label: "Onaylanan" },
          { value: "REJECTED", label: "Reddedilen" },
          { value: "TUMU", label: "Tümü" },
        ]}
        onChange={(value) => url.ayarla({ talep: String(value) })}
      />

      <section style={{ background: token.colorBgContainer, border: `1px solid ${ayrac}`, borderRadius: 4 }}>
        <Flex align="center" justify="space-between" wrap gap={12} style={{ padding: "16px 24px", borderBottom: `1px solid ${ayrac}` }}>
          <div>
            <Typography.Text style={{ display: "block", fontSize: 18, fontWeight: 500 }}>
              Ad-soyad talepleri
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {filtre === "TUMU" ? "Tüm kararlar" : DURUM_ETIKETI[filtre]}
            </Typography.Text>
          </div>
          {!sorgu.isPending && !sorgu.isError ? <Tag>{liste.length} kayıt</Tag> : null}
        </Flex>

        <div style={{ padding: "8px 24px 16px" }}>
          {sorgu.isPending ? (
            <YukleniyorDurumu etiket="Ad değişikliği talepleri yükleniyor" />
          ) : sorgu.isError ? (
            <HataDurumu
              hata={getErrorMessage(sorgu.error, "Talepler yüklenemedi.")}
              hataAksiyon={<Button size="small" onClick={() => void sorgu.refetch()}>Tekrar dene</Button>}
            />
          ) : liste.length === 0 ? (
            <BosDurumu baslik="Bu durumda talep yok" aciklama="Başka bir karar durumunu seçerek diğer kayıtları inceleyin." />
          ) : (
            liste.map((kayit, index) => {
              const hedef = `${kayit.new_first_name ?? ""} ${kayit.new_last_name ?? ""}`.trim();
              return (
                <Flex
                  key={kayit.id}
                  align="center"
                  justify="space-between"
                  wrap
                  gap={16}
                  style={{ padding: "16px 0", borderBottom: index === liste.length - 1 ? "none" : `1px solid ${ayrac}` }}
                >
                  <Flex vertical gap={6} style={{ minWidth: 0, flex: "1 1 360px" }}>
                    <Flex align="center" wrap gap={8}>
                      <Tag style={{ marginInlineEnd: 0 }}>Ad-Soyad · rol {kayit.role_id} · #{kayit.user_id}</Tag>
                      <Typography.Text strong style={{ overflowWrap: "anywhere" }}>→ {hedef || "Ad belirtilmedi"}</Typography.Text>
                      <Tag color={DURUM_RENGI[kayit.status]} style={{ marginInlineEnd: 0 }}>{DURUM_ETIKETI[kayit.status]}</Tag>
                    </Flex>
                    <Typography.Text style={{ overflowWrap: "anywhere" }}>Gerekçe: {kayit.reason}</Typography.Text>
                    {kayit.review_note ? <Typography.Text type="secondary">İnceleme notu: {kayit.review_note}</Typography.Text> : null}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(kayit.created_at)}</Typography.Text>
                  </Flex>
                  {canManage && kayit.status === "PENDING" ? (
                    <Flex gap={8} wrap>
                      <Button
                        disabled={mesgul}
                        onClick={() =>
                          onayla.mutate(kayit.id, {
                            onSuccess: () => toast.success("Onaylandı."),
                            onError: (error) => toast.error(getErrorMessage(error, "Onaylanamadı.")),
                          })
                        }
                      >
                        Onayla
                      </Button>
                      <Button danger disabled={mesgul} onClick={() => redYuzeyi.ac(kayit)}>Reddet</Button>
                    </Flex>
                  ) : (
                    <Typography.Text type="secondary">{canManage ? "Karar verildi" : "Salt okunur"}</Typography.Text>
                  )}
                </Flex>
              );
            })
          )}
        </div>
      </section>

      <ReasonDialog
        open={redYuzeyi.acik}
        title="Ad değişikliğini reddet"
        description="İsteğe bağlı inceleme notu kullanıcıya gösterilir."
        label="Red notu"
        placeholder="Red nedenini yazın"
        maxLength={500}
        confirmLabel="Reddet"
        danger
        isPending={reddet.isPending}
        onClose={redYuzeyi.kapat}
        onConfirm={(note) => {
          const hedef = redYuzeyi.kayit;
          if (!hedef) return;
          reddet.mutate(
            { id: hedef.id, note: note.trim() || undefined },
            {
              onSuccess: () => {
                toast.success("Reddedildi.");
                redYuzeyi.kapat();
              },
              onError: (error) => toast.error(getErrorMessage(error, "Reddedilemedi.")),
            },
          );
        }}
      />
    </Flex>
  );
}
