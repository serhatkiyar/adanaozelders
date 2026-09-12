// Hata Çözme — eski AdminOperationsPage (sıkışmış para + ölü işler) panel düzeninde.
// Yalnız teşhis ve ölü outbox işini yeniden kuyruğa alma; "elle iade et" bilinçli olarak YOKTUR
// (iade kararının tek sahibi `services/escrow.py` iki fazlı claim'idir).
import { useRef, type ReactNode } from "react";
import { App, Button, Flex, Tag, Typography, theme } from "antd";
import { AccessDenied, useAdminAreaAccess } from "@/components/admin/AccessState";
import { BosDurumu, HataDurumu, YukleniyorDurumu } from "@/panel/components/Durum";
import { useFailedOutbox, useRetryOutboxEvent, useStuckEscrow } from "@/hooks/useAdminOperations";
import { formatDateTime } from "@/lib/datetime";
import { getErrorDetail } from "@/lib/errors";
import { formatTL } from "@/lib/money";
import type { FailedOutboxEvent, StuckEscrowEntity, StuckEscrowRecord } from "@/types";

const VARLIK_ETIKETI: Record<StuckEscrowEntity, string> = {
  payment: "Ders ödemesi",
  exam_registration: "Deneme bileti",
  study_reservation: "Çalışma rezervasyonu",
  order: "Sipariş",
  order_return: "İade talebi",
};

// Ölçülen ikas bölümü: beyaz, ince colorBorderSecondary, radius 4; başlık 18/500 + ince ayraç.
function Bolum({ baslik, aciklama, children }: { baslik: string; aciklama: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <section aria-label={baslik} style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4 }}>
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Typography.Text style={{ fontSize: 18, fontWeight: 500, lineHeight: "28px", display: "block" }}>{baslik}</Typography.Text>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>{aciklama}</Typography.Text>
      </div>
      <div style={{ padding: "0 24px" }}>{children}</div>
    </section>
  );
}

const satirStil = (son: boolean, cizgi: string) => ({ padding: "16px 0", borderBottom: son ? "none" : `1px solid ${cizgi}` });
const monoStil = { fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere" as const };

function SikismisParaSatiri({ kayit, son }: { kayit: StuckEscrowRecord; son: boolean }) {
  const { token } = theme.useToken();
  const manuel = kayit.reason === "MANUAL_REVIEW";
  return (
    <Flex align="flex-start" justify="space-between" gap={12} wrap style={satirStil(son, token.colorBorderSecondary)}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Flex align="center" gap={8} wrap>
          {/* Bilinmeyen entity'de ham değer basılır: satır boş görünmez, teşhis edilebilir. */}
          <Typography.Text style={{ fontWeight: 500 }}>{VARLIK_ETIKETI[kayit.entity] ?? kayit.entity} #{kayit.entity_id}</Typography.Text>
          <Tag color={manuel ? "error" : "warning"} style={{ marginInlineEnd: 0 }}>{manuel ? "Manuel inceleme" : "Deneme tükendi"}</Tag>
          {kayit.order_id !== null && kayit.order_id !== kayit.entity_id ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>Sipariş #{kayit.order_id}</Typography.Text> : null}
        </Flex>
        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
          {kayit.amount ? formatTL(kayit.amount) : "-"} · durum {kayit.money_status} · {kayit.refund_attempts} deneme
          {kayit.refund_requested_at ? ` · ilk niyet ${formatDateTime(kayit.refund_requested_at)}` : ""}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ ...monoStil, display: "block", marginTop: 4 }}>Sağlayıcı referansı: {kayit.provider_ref ?? "-"}</Typography.Text>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{kayit.updated_at ? formatDateTime(kayit.updated_at) : ""}</Typography.Text>
    </Flex>
  );
}

export function HataCozme() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const { canView, canManage } = useAdminAreaAccess("operations");
  const para = useStuckEscrow(canView);
  const isler = useFailedOutbox(canView);
  const yenidenDene = useRetryOutboxEvent();
  // Senkron kilit: aynı tick'te ikinci retry çıkmaz; uçuştaki söz paylaşılır.
  const kilitRef = useRef(false);
  const sozRef = useRef<Promise<unknown> | null>(null);

  // Event ID onay açıldığı anda sabitlenir; onay başka satıra kaymaz.
  const yenidenKuyrugaAl = (is: FailedOutboxEvent) => {
    if (kilitRef.current) return;
    const hedefId = is.id;
    modal.confirm({
      title: "İşi yeniden kuyruğa al",
      content: `"${is.kind}" işi (#${hedefId}) yeniden gönderilmek üzere kuyruğa alınacak. Bu işlem müşteriye giden bir bildirimi tetikleyebilir.`,
      okText: "İşi yeniden kuyruğa al",
      cancelText: "Vazgeç",
      // Uçuş sürerken Vazgeç/ESC kapatamaz: reddedilen söz AntD'yi açık tutar.
      onCancel: () => (kilitRef.current ? Promise.reject(new Error("bekleniyor")) : undefined),
      // Await modu: söz reddedilirse onay açık kalır; hata gerçek gerekçesiyle gösterilir.
      onOk: () => {
        if (kilitRef.current && sozRef.current) return sozRef.current;
        kilitRef.current = true;
        const soz = yenidenDene
          .mutateAsync(hedefId)
          .then((sonuc) => {
            // requeued=false hata değildir: iş bu çağrıdan önce zaten kuyruğa alınmıştı.
            message.success(sonuc.requeued ? "İş yeniden kuyruğa alındı." : "İş zaten kuyrukta bekliyordu; yeniden kuyruğa alınmadı.");
          })
          .catch((e: unknown) => {
            // 409 gerekçesi ("Gönderilmiş bir bildirim ikinci kez gönderilmez") operatöre aynen iner.
            message.error(getErrorDetail(e, "İş yeniden kuyruğa alınamadı."));
            throw e;
          })
          .finally(() => {
            kilitRef.current = false;
            sozRef.current = null;
          });
        sozRef.current = soz;
        return soz;
      },
    });
  };

  if (!canView) return <AccessDenied area="Hata çözme" />;

  const paraGovdesi = para.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Sıkışmış para listesi yükleniyor…" /></div>
  ) : para.isError ? (
    <div style={{ padding: "16px 0" }}>
      <HataDurumu hata={getErrorDetail(para.error, "Sıkışmış para listesi yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void para.refetch()}>Tekrar dene</Button>} />
    </div>
  ) : (para.data ?? []).length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Sıkışmış para kaydı yok" aciklama="Otomatik mutabakat şu an her kaydı sonuca sürebiliyor." /></div>
  ) : (
    (para.data ?? []).map((k, i, dizi) => <SikismisParaSatiri key={`${k.entity}-${k.entity_id}`} kayit={k} son={i === dizi.length - 1} />)
  );

  const isGovdesi = isler.isPending ? (
    <div style={{ padding: "16px 0" }}><YukleniyorDurumu etiket="Ölü iş listesi yükleniyor…" /></div>
  ) : isler.isError ? (
    <div style={{ padding: "16px 0" }}>
      <HataDurumu hata={getErrorDetail(isler.error, "Ölü iş listesi yüklenemedi.")} hataAksiyon={<Button size="small" onClick={() => void isler.refetch()}>Tekrar dene</Button>} />
    </div>
  ) : (isler.data ?? []).length === 0 ? (
    <div style={{ padding: "16px 0" }}><BosDurumu baslik="Ölü iş yok" aciklama="Bildirim kuyruğunda tavana çarpmış bir iş bulunmuyor." /></div>
  ) : (
    (isler.data ?? []).map((is, i, dizi) => (
      <Flex key={is.id} align="flex-start" justify="space-between" gap={12} wrap style={satirStil(i === dizi.length - 1, token.colorBorderSecondary)}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Flex align="center" gap={8} wrap>
            <Typography.Text style={{ ...monoStil, fontSize: 14, fontWeight: 500 }}>{is.kind}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>#{is.id}</Typography.Text>
            {is.order_id !== null ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>Sipariş #{is.order_id}</Typography.Text> : null}
          </Flex>
          <Typography.Text type="danger" style={{ display: "block", fontSize: 12, marginTop: 4, overflowWrap: "anywhere" }}>{is.last_error ?? "Hata metni yok"}</Typography.Text>
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
            {is.attempts} deneme{is.updated_at ? ` · son ${formatDateTime(is.updated_at)}` : ""}
          </Typography.Text>
        </div>
        {canManage ? <Button aria-label={`${is.kind} #${is.id} işini yeniden dene`} onClick={() => yenidenKuyrugaAl(is)}>Yeniden dene</Button> : null}
      </Flex>
    ))
  );

  return (
    <Flex vertical gap={24}>
      <Flex align="center" justify="space-between" wrap gap={12} style={{ minHeight: 40 }}>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20, fontWeight: 500, lineHeight: "30px" }}>Hata Çözme</Typography.Title>
      </Flex>
      {!canManage ? (
        <Typography.Text type="secondary">Bu alanda yalnız görüntüleme yetkiniz var; ölü işi yeniden kuyruğa almak için operations.manage izni gerekir.</Typography.Text>
      ) : null}
      <Bolum baslik="Sıkışmış para" aciklama="Otomatik mutabakatın artık çözemeyeceği kayıtlar. Sağlayıcı referansıyla panelde eşleştirip sonucu elle yazın; buradan para hareketi başlatılmaz.">
        {paraGovdesi}
      </Bolum>
      <Bolum baslik="Ölü işler" aciklama="Deneme tavanını aşmış bildirim işleri. Yeniden denemek işi kuyruğa geri koyar; gönderilmiş bir bildirim ikinci kez gönderilmez.">
        {isGovdesi}
      </Bolum>
    </Flex>
  );
}
