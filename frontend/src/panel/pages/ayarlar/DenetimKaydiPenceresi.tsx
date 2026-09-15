// Tek denetim kaydının salt okunur ayrıntısı; açık/kapalı durumu listede yaşar.
import { Descriptions, Drawer, Flex, Tag, Typography, theme } from "antd";
import { useMobil } from "@/hooks/useMedyaSorgusu";
import { formatDateTime } from "@/lib/datetime";
import { ROL_ETIKETI } from "@/lib/roles";
import type { AuditLogOut } from "@/types";

export function aktorEtiketi(kayit: AuditLogOut): string {
  return `${ROL_ETIKETI[kayit.actor_role] ?? "Kullanıcı"} #${kayit.actor_id}`;
}

export function hedefEtiketi(kayit: AuditLogOut): string {
  return `${kayit.target_type}${kayit.target_id ? ` #${kayit.target_id}` : ""}`;
}

function JsonBlogu({ baslik, deger }: { baslik: string; deger: Record<string, unknown> }) {
  const { token } = theme.useToken();
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{baslik}</Typography.Text>
      <pre
        aria-label={baslik}
        style={{
          margin: "4px 0 0",
          maxHeight: 240,
          overflow: "auto",
          padding: 12,
          borderRadius: 4,
          fontSize: 12,
          background: token.colorBgLayout,
          color: token.colorText,
        }}
      >
        {JSON.stringify(deger, null, 2)}
      </pre>
    </div>
  );
}

const dolu = (v: Record<string, unknown> | null | undefined): v is Record<string, unknown> =>
  Boolean(v && Object.keys(v).length > 0);

// Salt okunur: Kaydet/Vazgeç altbilgisi yok; X, ESC ve maske kapatır (AntD varsayılanı).
export function DenetimKaydiPenceresi({ kayit, kapat }: { kayit?: AuditLogOut | null; kapat?: () => void }) {
  const mobil = useMobil();
  return (
    <Drawer open={kayit != null} title="Denetim kaydı" onClose={() => kapat?.()} placement="right" width={mobil ? "100%" : 480}>
      {kayit ? (
        <Flex vertical gap={16}>
          <Descriptions column={1} size="small" colon={false}>
            <Descriptions.Item label="Aksiyon"><Tag color="processing" style={{ marginInlineEnd: 0 }}>{kayit.action}</Tag></Descriptions.Item>
            <Descriptions.Item label="Hedef">{hedefEtiketi(kayit)}</Descriptions.Item>
            <Descriptions.Item label="Aktör">{aktorEtiketi(kayit)}</Descriptions.Item>
            <Descriptions.Item label="Zaman">{formatDateTime(kayit.created_at)}</Descriptions.Item>
            {kayit.reason ? <Descriptions.Item label="Gerekçe">{kayit.reason}</Descriptions.Item> : null}
            {kayit.details ? <Descriptions.Item label="Açıklama">{kayit.details}</Descriptions.Item> : null}
            {kayit.ip_address ? <Descriptions.Item label="IP">{kayit.ip_address}</Descriptions.Item> : null}
            {kayit.request_id ? (
              <Descriptions.Item label="Request ID">
                <Typography.Text style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", userSelect: "all" }}>{kayit.request_id}</Typography.Text>
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          {dolu(kayit.before_values) ? <JsonBlogu baslik="Önce" deger={kayit.before_values} /> : null}
          {dolu(kayit.after_values) ? <JsonBlogu baslik="Sonra" deger={kayit.after_values} /> : null}
          {dolu(kayit.meta) ? <JsonBlogu baslik="Ek bilgi" deger={kayit.meta} /> : null}
        </Flex>
      ) : null}
    </Drawer>
  );
}
